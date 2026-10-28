import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * 이미지 대조(image-match) 모듈 테이블 (2026-10).
 *
 * 원본 CJ더마켓 상품과 GS샵 상품을 쌍으로 등록하고, 배치(GitHub Actions)가
 * 썸네일·상세 이미지를 수집 → 해시 게이트 → AI 판정해 "서로 다른 쌍"을 찾는다.
 * 기존 minus / products / group 기능과 **완전히 분리**된 테이블이다.
 * 설계: _workspace/01_design_image_match.md
 *
 *   match_pair          대조 대상 + 현재 상태 (자재코드 1개 = 쌍 1개)
 *   match_run           배치 실행 1회 로그 (토큰 사용량 합계 포함)
 *   match_check         배치 1회 × 쌍 1개 수집·판정 결과 (append)
 *   match_status_log    상태 전이 이력
 *   match_common_image  GS 상세 공통 이미지 해시 (배치가 자동 갱신)
 */

/**
 * match_pair — 대조 대상.
 *
 * 업로드는 **누적 upsert**: 한 번 등록된 쌍은 이후 파일에 없어도 남고 매 배치마다 계속 확인한다.
 * 제거는 사용자가 명시적으로 삭제할 때만. URL 이 바뀌면 status 를 'new' 로 초기화.
 * status 값은 src/lib/match/types.ts MATCH_STATUSES.
 */
export const matchPair = pgTable(
  'match_pair',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matCode: text('mat_code').notNull(),
    productName: text('product_name').notNull(),
    cjUrl: text('cj_url').notNull(),
    gsUrl: text('gs_url').notNull(),
    status: text('status').notNull().default('new'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** 최근 판정의 차이 한 줄 요약 (목록 표시용). */
    diffSummary: text('diff_summary'),
    /** 마지막 시도 / 정상 수집 / AI 판정 시각 — 셋을 분리해 "확인은 됐는데 판정은 밀림"을 구분한다. */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastJudgedAt: timestamp('last_judged_at', { withTimezone: true }),
    /** 사용자가 "처리 완료" 시 남긴 메모. */
    resolvedNote: text('resolved_note'),
    /**
     * 확인자가 판정을 직접 정하거나 정정한 시각. 있으면 **판정 규칙 변경만으로는 재판정하지 않는다**
     * (이미지가 실제로 바뀌면 AI 가 다시 판정하고 이 값을 비운다). 사용자 확정 2026-10-28.
     */
    humanDecidedAt: timestamp('human_decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('match_pair_mat_code_uniq').on(t.matCode),
    index('match_pair_status_idx').on(t.status),
  ],
)

/** match_run — 배치 실행 1회. 대시보드의 "마지막 배치 시각"·사용량 패널 원천. */
export const matchRun = pgTable('match_run', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  total: integer('total').notNull().default(0),
  fetched: integer('fetched').notNull().default(0),
  judged: integer('judged').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  /** 1회 판정 상한 초과로 다음 실행에 미룬 쌍 수. */
  deferred: integer('deferred').notNull().default(0),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' })
    .notNull()
    .default(0),
  cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' })
    .notNull()
    .default(0),
  /** 구독 실행이라 실제 청구액 아님 — "API 정가로 환산한 금액"(효율 지표). */
  apiEquivUsd: numeric('api_equiv_usd', { precision: 12, scale: 4 })
    .notNull()
    .default('0'),
  error: text('error'),
})

/**
 * match_check — 배치 1회 × 쌍 1개 결과 (append).
 *
 * 해시 게이트: 직전 정상 check 의 4개 해시(CJ/GS × 썸네일/상세)와 같으면 AI 를 부르지 않는다.
 * 해시는 URL 이 아니라 이미지 바이트 기준(GS 상세 URL 은 토큰형이라 바뀔 수 있음).
 * cj_detail / gs_detail = [{ url, hash, desc? }] — 상세 이미지 순서대로.
 */
export const matchCheck = pgTable(
  'match_check',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    pairId: bigint('pair_id', { mode: 'number' })
      .notNull()
      .references(() => matchPair.id, { onDelete: 'cascade' }),
    runId: bigint('run_id', { mode: 'number' }).references(() => matchRun.id, {
      onDelete: 'set null',
    }),
    fetchOk: boolean('fetch_ok').notNull(),
    fetchError: text('fetch_error'),
    cjThumbUrl: text('cj_thumb_url'),
    gsThumbUrl: text('gs_thumb_url'),
    cjThumbHash: text('cj_thumb_hash'),
    gsThumbHash: text('gs_thumb_hash'),
    /** 상세 이미지 해시 목록(공통 영역 제외)의 합성 해시. */
    cjDetailHash: text('cj_detail_hash'),
    gsDetailHash: text('gs_detail_hash'),
    cjDetail: jsonb('cj_detail'),
    gsDetail: jsonb('gs_detail'),
    /** 이번에 AI 판정을 실제로 호출했는지 (false = 해시 게이트로 이전 판정 유지). */
    judged: boolean('judged').notNull().default(false),
    verdict: jsonb('verdict'),
    /** 판정 규칙 버전 — 규칙이 바뀌면 전체 재판정 대상을 가려낸다. */
    rulesVersion: text('rules_version'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheCreationTokens: integer('cache_creation_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    apiEquivUsd: numeric('api_equiv_usd', { precision: 12, scale: 4 }),
    judgeMs: integer('judge_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('match_check_pair_created_idx').on(t.pairId, t.createdAt),
    index('match_check_run_idx').on(t.runId),
  ],
)

/** match_status_log — 상태 전이 이력. actor = 'batch' | 'user' | 'upload'. */
export const matchStatusLog = pgTable(
  'match_status_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    pairId: bigint('pair_id', { mode: 'number' })
      .notNull()
      .references(() => matchPair.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('match_status_log_pair_idx').on(t.pairId, t.createdAt)],
)

/**
 * match_common_image — GS 상세 공통 이미지.
 *
 * GS 상세 앞에는 판매사 공통 이미지(공식 인증 판매처 / 리셀러 공지 / 고객센터 / 교환 안내)가
 * 모든 상품에 붙는다. 같은 해시가 여러 GS 상품에 반복 등장하면 공통으로 보고 비교에서 뺀다.
 * 배치가 매 실행마다 등장 횟수를 다시 집계한다 — 수동 관리 없음.
 */
export const matchCommonImage = pgTable('match_common_image', {
  hash: text('hash').primaryKey(),
  occurrences: integer('occurrences').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type MatchPair = typeof matchPair.$inferSelect
export type NewMatchPair = typeof matchPair.$inferInsert
export type MatchRun = typeof matchRun.$inferSelect
export type MatchCheck = typeof matchCheck.$inferSelect
export type NewMatchCheck = typeof matchCheck.$inferInsert
export type MatchStatusLog = typeof matchStatusLog.$inferSelect
export type MatchCommonImage = typeof matchCommonImage.$inferSelect

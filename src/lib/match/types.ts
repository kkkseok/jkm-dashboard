/**
 * 이미지 대조(image-match) 타입.
 *
 * 엑셀 파싱은 클라이언트에서, DB 반영은 Server Action 에서 한다(기존 모듈과 동일).
 */

import type { Verdict } from './judge-rules'

/** 상태값. 전이 규칙은 _workspace/01_design_image_match.md §5. */
export const MATCH_STATUSES = [
  'new',
  'match',
  'diff',
  'done',
  'unfixed',
  'unsure',
  'error',
] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  new: '미확인',
  match: '일치',
  diff: '불일치',
  done: '처리 완료',
  unfixed: '미반영',
  unsure: '판정 보류',
  error: '수집 실패',
}

/** 업로드 한 행 = 대조 쌍 1개. */
export type MatchPairInput = {
  matCode: string
  productName: string
  cjUrl: string
  gsUrl: string
}

/** 헤더 이름으로 찾은 레이아웃 (미리보기 표시용). 행은 Excel 1-based, 열은 letter. */
export type MatchSourceLayout = {
  headerRow: number
  cols: { matCode: string; productName: string; gsUrl: string; cjUrl: string }
}

export type MatchSourceParseResult = {
  layout: MatchSourceLayout
  rows: MatchPairInput[]
  stats: {
    /** 적재 대상 행 수. */
    validCount: number
    /** 자재코드 중복으로 스킵(첫 등장 채택). */
    dupCount: number
    /** URL 형식 오류·필수값 누락으로 스킵. */
    invalidCount: number
  }
  warnings: string[]
}

/** DB 와 비교한 업로드 미리보기. */
export type MatchUploadDiff = {
  newCount: number
  /** URL 이 바뀐 쌍 — 상태가 '미확인'으로 초기화된다. */
  urlChangedCount: number
  /** 상품명만 바뀐 쌍. */
  nameChangedCount: number
  sameCount: number
}

export type MatchSourcePreview = MatchSourceParseResult & { diff: MatchUploadDiff }

export type MatchUploadResult = {
  inserted: number
  urlChanged: number
  nameChanged: number
  unchanged: number
}

// ── 대시보드 (/image-match) ─────────────────────────────

/** 조치가 필요한 상태 — 대시보드 기본 필터. */
export const ACTION_STATUSES: readonly MatchStatus[] = ['diff', 'unfixed', 'unsure', 'error']

export type MatchDashboardRow = {
  id: number
  matCode: string
  productName: string
  status: MatchStatus
  diffSummary: string | null
  statusChangedAt: string
  lastCheckedAt: string | null
  lastJudgedAt: string | null
  cjUrl: string
  gsUrl: string
}

export type MatchRunSummary = {
  id: number
  startedAt: string
  finishedAt: string | null
  total: number
  fetched: number
  failed: number
  judged: number
  deferred: number
  error: string | null
}

/** 일별 판정 토큰 사용량 (KST 기준 날짜). 구독 실행이라 apiEquivUsd 는 청구액이 아닌 API 정가 환산. */
export type MatchUsageDay = {
  date: string
  runs: number
  judged: number
  inputTokens: number
  outputTokens: number
  apiEquivUsd: number
}

export type MatchDashboard = {
  rows: MatchDashboardRow[]
  byStatus: Record<MatchStatus, number>
  lastRun: MatchRunSummary | null
  /** 마지막으로 오류 없이 끝난 배치 종료 시각. */
  lastSuccessAt: string | null
  /** 그 뒤로 지난 시간(시) — DB now() 기준으로 계산(렌더 중 Date.now() 금지). */
  hoursSinceSuccess: number | null
  usage: MatchUsageDay[]
}

export type MatchDetailImage = { url: string; desc?: string }

export type MatchPairDetail = {
  pair: MatchDashboardRow & { resolvedNote: string | null }
  /** 마지막 정상 수집. 없으면 null(아직 수집 전이거나 계속 실패). */
  latest: {
    checkedAt: string
    cjThumbUrl: string | null
    gsThumbUrl: string | null
    cjDetail: MatchDetailImage[]
    /** GS 공통 공지 이미지는 제외한 목록. */
    gsDetail: MatchDetailImage[]
    gsCommonCount: number
  } | null
  /** 마지막 AI 판정. */
  judged: {
    judgedAt: string
    model: string | null
    verdict: Verdict
  } | null
  /** 가장 최근 수집 실패 메시지 (마지막 수집이 실패일 때만). */
  lastError: string | null
  logs: {
    at: string
    from: MatchStatus | null
    to: MatchStatus
    actor: string
    note: string | null
  }[]
}

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
  /** 읽은 시트 이름. */
  sheet: string
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
  /** 상품번호(prdCd·prdid)가 바뀐 쌍 — 상태가 '미확인'으로 초기화된다. */
  urlChangedCount: number
  /** 같은 상품인데 상품명이나 주소 표기(꼬리표)만 바뀐 쌍 — 상태 유지. */
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
  /** 확인자가 직접 판정·정정한 시각 (있으면 규칙 변경만으로는 재판정 안 함). */
  humanDecidedAt: string | null
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
  /** 이번 실행의 판정 예정 수(진행 표시의 분모). 수집 중이거나 예전 기록이면 0. */
  toJudge: number
  /** 시작부터 종료(진행 중이면 지금)까지 걸린 시간(초) — DB now() 기준. */
  elapsedSec: number
  /** 지금 돌고 있는 실행인지 — 종료 기록이 없고 시작한 지 RUN_STALE_HOURS 이내. */
  running: boolean
  /** 종료 기록 없이 오래된 실행 — 중간에 끊긴 것(시간 제한·취소). 끝난 판정은 남아 있다. */
  stalled: boolean
  /** 이번 실행의 토큰(입력+캐시+출력)·API 정가 환산. */
  tokens: number
  apiEquivUsd: number
}

/** 종료 기록이 없는 실행을 "진행 중"으로 보는 최대 시간(시) — Actions 작업 시간 제한(6시간)보다 조금 길게. */
export const RUN_STALE_HOURS = 6.5

/** 화면의 [지금 판정 실행] 결과. 서버 오류 메시지는 운영 빌드에서 가려지므로 값으로 돌려준다. */
export type MatchRunStartResult = { ok: boolean; message: string }

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
  /** 마지막으로 대조 대상이 새로 등록된 시각 (업로드 대화창 표시용). */
  lastRegisteredAt: string | null
  usage: MatchUsageDay[]
}

/** changed = 기준 판정(latest.changes.since) 때는 없던 이미지. */
export type MatchDetailImage = { url: string; desc?: string; changed?: boolean }

/** 기준 판정 이후 이미지 변경 요약 (gate.diffImageList). */
export type MatchImageChanges = {
  /** 비교 기준이 된 판정 시각. */
  since: string
  cjThumb: boolean
  gsThumb: boolean
  /** 기준에는 있었는데 지금은 빠진 상세 이미지 수. */
  cjRemoved: number
  gsRemoved: number
}

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
    /** 이미지가 지금과 달랐던 가장 최근 판정 대비 변경. 그런 판정이 없으면 null. */
    changes: MatchImageChanges | null
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

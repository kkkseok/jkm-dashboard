/**
 * 이미지 대조(image-match) 타입.
 *
 * 엑셀 파싱은 클라이언트에서, DB 반영은 Server Action 에서 한다(기존 모듈과 동일).
 */

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

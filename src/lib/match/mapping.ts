/**
 * 이미지 대조 대상 엑셀(url_matching_*.xlsx) 컬럼 정의.
 *
 * letter 를 고정하지 않고 **헤더 이름으로 위치를 찾는다** — 예시 파일도 A열이 비고 B2 에서 시작해서,
 * 시작 위치가 바뀌어도 파일만 올리면 인식되게 한다(group 상품 마스터와 같은 방식).
 */

export const MATCH_SOURCE = {
  /** 헤더 이름. 비교 시 공백은 무시한다. */
  headers: {
    matCode: '자재코드',
    productName: '자재명',
    gsUrl: 'GS',
    cjUrl: '본사',
  },
  /** 헤더 행을 찾을 상단 범위 (행·열 수). */
  headerScanRows: 10,
  headerScanCols: 30,
} as const

export type MatchSourceHeaderKey = keyof typeof MATCH_SOURCE.headers

/** CJ더마켓 상품 URL — prdCd 쿼리 필수. */
export const CJ_URL_RE = /^https?:\/\/(www\.)?cjthemarket\.com\/.+[?&]prdCd=\w+/i
/** GS샵 상품 URL — prdid 쿼리 필수. */
export const GS_URL_RE = /^https?:\/\/(www\.)?gsshop\.com\/.+[?&]prdid=\d+/i

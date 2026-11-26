/**
 * 이미지 대조 대상 엑셀(url_matching_*.xlsx) 컬럼 정의.
 *
 * letter 를 고정하지 않고 **헤더 이름으로 위치를 찾는다** — 예시 파일도 A열이 비고 B2 에서 시작해서,
 * 시작 위치가 바뀌어도 파일만 올리면 인식되게 한다(group 상품 마스터와 같은 방식).
 */

export const MATCH_SOURCE = {
  /**
   * 헤더 이름(첫 번째가 대표 이름, 나머지는 같은 뜻의 다른 표기). 비교 시 공백은 무시한다.
   * 2026-11: 운영 목록(list_url_matching.xlsx)은 `상품명`/`더마켓` 을 쓴다 — 예시 파일은 `자재명`/`본사`.
   */
  headers: {
    matCode: ['자재코드'],
    productName: ['자재명', '상품명'],
    gsUrl: ['GS'],
    cjUrl: ['본사', '더마켓'],
  },
  /**
   * 이 이름의 시트가 있으면 그 시트를, 없으면 첫 시트를 읽는다.
   * 운영 목록은 첫 시트가 `완료`(GS 수정을 마친 목록)이고 대상 전체는 `전체리스트` 다.
   */
  preferredSheet: '전체리스트',
  /** 헤더 행을 찾을 상단 범위 (행·열 수). */
  headerScanRows: 10,
  headerScanCols: 30,
} as const

export type MatchSourceHeaderKey = keyof typeof MATCH_SOURCE.headers

/** CJ더마켓 상품 URL — prdCd 쿼리 필수. */
export const CJ_URL_RE = /^https?:\/\/(www\.)?cjthemarket\.com\/.+[?&]prdCd=\w+/i
/** GS샵 상품 URL — prdid 쿼리 필수. */
export const GS_URL_RE = /^https?:\/\/(www\.)?gsshop\.com\/.+[?&]prdid=\d+/i

/** CJ더마켓 URL 의 상품번호(prdCd). 없으면 null. */
export const cjProductId = (url: string): string | null => url.match(/[?&]prdCd=(\w+)/i)?.[1] ?? null
/** GS샵 URL 의 상품번호(prdid). 없으면 null. */
export const gsProductId = (url: string): string | null => url.match(/[?&]prdid=(\d+)/i)?.[1] ?? null

/**
 * 두 쌍이 같은 상품을 가리키는지 — URL 문자열이 아니라 **상품번호**로 비교한다.
 * CJ 주소는 뒤에 붙는 꼬리표(`&plnId=…&areaNum=…`)가 목록마다 달라, 문자열로 비교하면
 * 같은 상품인데도 "URL 변경"으로 잡혀 상태가 초기화된다(2026-11, 기존 17쌍 중 12쌍).
 * 상품번호를 못 읽는 주소는 문자열이 같을 때만 같은 상품으로 본다.
 */
export function sameProductUrls(
  a: { cjUrl: string; gsUrl: string },
  b: { cjUrl: string; gsUrl: string },
): boolean {
  const same = (x: string | null, y: string | null, rawX: string, rawY: string) =>
    x !== null && y !== null ? x === y : rawX === rawY
  return (
    same(cjProductId(a.cjUrl), cjProductId(b.cjUrl), a.cjUrl, b.cjUrl) &&
    same(gsProductId(a.gsUrl), gsProductId(b.gsUrl), a.gsUrl, b.gsUrl)
  )
}

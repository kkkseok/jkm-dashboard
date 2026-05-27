/**
 * 상품 마스터 엑셀 import 매핑 — 한글 헤더 ↔ 내부 필드 (camelCase).
 *
 * 사용자 확정 (2026-05-27, 02_uiux_products §4-6 안 A):
 *   - 한글 헤더 (`상품코드 / 채널명 / 브랜드명 / 상품명 / 구분`)
 *   - "구분" 값 = "단품" 또는 "복합" (다른 값은 검증 실패)
 *
 * minus 의 `SALES_MAPPING` 처럼 column letter 가 아니라 **한글 헤더 텍스트** 로
 * 위치를 식별한다. 이유:
 *   - 사용자가 직접 만드는 엑셀이라 컬럼 순서가 우연히 바뀔 수 있다 (예: 상품명 ↔ 브랜드명).
 *   - 한글 헤더는 유일하고 짧아 인코딩 안정성 문제가 적다.
 *   - 헤더 5개를 모두 찾지 못하면 즉시 ParseError 로 거부.
 *
 * 헤더 동의어는 받지 않는다 (안 A 추천 이유였던 "엄격한 일치" 원칙 유지). 사용자가
 * `상품 코드` (공백 포함) 같이 적으면 `trim()` 후 비교하므로 양쪽 끝 공백만 허용.
 */

/** 내부 필드 키 — DB 컬럼명(camelCase) 과 1:1 일치 (`NewProductMaster`). */
export type ProductFieldKey =
  | 'productCode'
  | 'channelName'
  | 'brandName'
  | 'productName'
  | 'isComposite'

/** 한글 헤더 텍스트 → 내부 필드 키 매핑. */
export const PRODUCT_HEADER_MAP: ReadonlyArray<{
  header: string
  field: ProductFieldKey
}> = [
  { header: '상품코드', field: 'productCode' },
  { header: '채널명', field: 'channelName' },
  { header: '브랜드명', field: 'brandName' },
  { header: '상품명', field: 'productName' },
  { header: '구분', field: 'isComposite' },
] as const

/** import 엑셀의 헤더는 1행, 데이터는 2행부터. (minus 의 2행 병합 헤더와 다름) */
export const PRODUCT_HEADER_ROWS = 1 as const

/**
 * "구분" 셀 값 → boolean (isComposite) 변환 룰.
 *   - "단품" → false
 *   - "복합" → true
 *   - 그 외 (대소문자/공백 차이도 포함) → 매핑 실패 → ParseError
 *
 * minus 의 동의어 수용 정책(`단품/single/s`)은 채택하지 않는다.
 * 02_uiux_products §4-5 의 RadioGroup UI 와 정확히 같은 두 단어만 받는다.
 */
export const PRODUCT_TYPE_MAP: ReadonlyMap<string, boolean> = new Map([
  ['단품', false],
  ['복합', true],
])

/** 길이 제한 (02_uiux_products §4-5 zod 룰과 정확히 일치). */
export const PRODUCT_FIELD_LIMITS = {
  productCode: { min: 1, max: 64, pattern: /^[\w-]+$/ },
  channelName: { min: 1, max: 128 },
  brandName: { min: 1, max: 64 },
  productName: { min: 1, max: 128 },
} as const

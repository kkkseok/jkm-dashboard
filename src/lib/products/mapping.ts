/**
 * 상품 마스터 엑셀 import 매핑 — Wide format (v1.2 2026-05-27).
 *
 * 헤더 구조:
 *   - 고정 4컬럼: `사방넷코드 / 브랜드명 / 상품명 / 구분`
 *   - 나머지 모든 컬럼은 **채널명** 으로 자동 인식 (헤더 텍스트가 곧 channel_name)
 *
 * 동작:
 *   - 한 행 = 한 상품(사방넷코드). 채널 컬럼마다 그 채널의 productCode 가 들어있거나 비어있음
 *   - 비어있는 채널 칸은 자동 스킵 (그 상품이 그 채널에 등록 안 됨)
 *   - DB 저장 시 wide → long 으로 풀려서 (sabangnet, channel) 페어마다 한 행
 *
 * 4 고정 헤더는 모두 trim() 후 정확 일치. 동의어 미지원.
 */

/** 한 행에서 가져오는 공통(고정) 필드 키. */
export type ProductFixedFieldKey =
  | 'sabangnetCode'
  | 'brandName'
  | 'productName'
  | 'isComposite'

/** ParsedRow 가 가지는 모든 필드. */
export type ProductFieldKey = ProductFixedFieldKey | 'channelName' | 'productCode'

/** 한글 고정 헤더 텍스트 → 내부 필드 키 매핑. */
export const PRODUCT_FIXED_HEADER_MAP: ReadonlyArray<{
  header: string
  field: ProductFixedFieldKey
}> = [
  { header: '사방넷코드', field: 'sabangnetCode' },
  { header: '브랜드명', field: 'brandName' },
  { header: '상품명', field: 'productName' },
  { header: '구분', field: 'isComposite' },
] as const

/** 고정 헤더 텍스트 집합 (채널명 컬럼과 구분용). */
export const PRODUCT_FIXED_HEADER_SET: ReadonlySet<string> = new Set(
  PRODUCT_FIXED_HEADER_MAP.map((m) => m.header),
)

/** import 엑셀의 헤더는 1행, 데이터는 2행부터. (minus 의 2행 병합 헤더와 다름) */
export const PRODUCT_HEADER_ROWS = 1 as const

/**
 * "구분" 셀 값 → boolean (isComposite) 변환 룰.
 *   - "단품" → false
 *   - "복합" → true
 *   - 그 외 (대소문자/공백 차이도 포함) → 매핑 실패 → ParseError
 *
 * minus 의 동의어 수용 정책(`단품/single/s`)은 채택하지 않는다.
 * RadioGroup UI 와 정확히 같은 두 단어만 받는다.
 */
export const PRODUCT_TYPE_MAP: ReadonlyMap<string, boolean> = new Map([
  ['단품', false],
  ['복합', true],
])

/**
 * 검증 룰 (form zod 룰과 정확히 일치).
 *
 * v1.2 (2026-05-27): 사용자 결정 — 상품코드만 형식·길이 검증 유지,
 * 나머지 4개 필드는 required 만 (엑셀에 적힌 그대로 받음).
 *   - sabangnetCode UNIQUE 는 DB 가 보장 (입력 형식 자유)
 *   - 한글, 공백, 특수문자 모두 허용
 */
export const PRODUCT_FIELD_LIMITS = {
  productCode: { min: 1, max: 64, pattern: /^[\w-]+$/ },
} as const

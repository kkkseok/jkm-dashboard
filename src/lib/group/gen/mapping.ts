/**
 * 그룹 업로드 생성(no_mapping → group_upload) 의 Excel column letter / 출력 컬럼 정의.
 *
 * excel-mapping 스킬 원칙: 모든 letter 는 이 파일에만 둔다. 파서/빌더에서 하드코딩 금지.
 * 컬럼 위치는 docs/group/no_mapping_*.xlsx (사방넷 "미매핑 주문" export) 기준.
 */

/**
 * no_mapping.xlsx — 매핑 안 된 주문 목록 (입력).
 *
 * 0행 헤더(사이트코드/마켓명/…), 1행 "사이트코드: NNN" 서브헤더, 2행(0-based idx 2)부터 데이터.
 *   marketName        ← C (마켓명. "B-이랜드몰(jkmincorp)" → 채널 정규화 원천)
 *   marketCode        ← H (마켓코드. group_market_map 의 키)
 *   marketProductName ← I (마켓 상품명. 미매핑 경고 표시용)
 */
export const NO_MAPPING = {
  /** 데이터 시작 행 (0-based). 0=헤더, 1=사이트코드 서브헤더. */
  dataStart: 2,
  cols: {
    marketName: 'C',
    marketCode: 'H',
    marketProductName: 'I',
  },
} as const

/**
 * group_upload.xlsx — 그룹 상품 등록 파일 (출력). 13컬럼 A~M.
 * 채워지는 컬럼: A(그룹일련번호) B(그룹상품명) E(순번) F(상품코드) G(상품명) I(수량) J(단가=1) M(자체코드).
 * 공란: C(그룹규격) D(그룹단가) H(규격) K(단가구분) L(공인바코드).
 */
export const OUTPUT_HEADERS = [
  '그룹일련번호',
  '그룹상품명',
  '그룹규격',
  '그룹단가',
  '순번',
  '상품코드',
  '상품명',
  '규격',
  '수량',
  '단가',
  '단가구분',
  '공인바코드',
  '자체코드',
] as const

/** J(단가) 고정값. 샘플 전 행 1. */
export const FIXED_UNIT_PRICE = 1

/** 그룹상품명(B) 접미 태그. */
export const GROUP_NAME_SUFFIX_TAG = '그룹'

/**
 * 묶음 2번째 내품부터 제거하는 접두 — `(채널표기)-[제조사]-[브랜드]-`.
 * 예: "(Y)-[CJ제일제당]-[백설]-야채육수에는-1분링-80G-[상온]" → "야채육수에는-1분링-80G-[상온]"
 * 시작이 이 형태가 아니면(괄호/브랜드 구조 아님) 원본 유지.
 */
export const BRAND_PREFIX_RE = /^\([^)]*\)-\[[^\]]*\]-\[[^\]]*\]-/

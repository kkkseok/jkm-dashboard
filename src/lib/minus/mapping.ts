/**
 * Excel 매핑 설정 — 모든 column letter 는 이 파일에 집중한다.
 * 코드 어디서도 letter 를 하드코딩하지 말 것.
 *
 * 출처:
 * - sales_status_basic 의 letter (A~AG): project_minus_logic.md (사용자 확정)
 * - revenue_profit_brand 의 letter (E, Y, AH, BF): 2026-05-24 사용자 확정
 *   (이전 v1: revenue_profit_product, productName AG → 두 파일이 같은 주문집합·같은 컬럼이지만
 *    product 쪽은 BF(브랜드)·AH(상품명) 채움률이 거의 0% 라 의미가 없었음. brand 파일로 통합)
 * - 헤더 행 수(2): excel-mapping/skill.md §3 (2행짜리 병합 헤더)
 */

export const SALES_MAPPING = {
  fileName: 'sales_status_basic',
  headerRows: 2,
  /** sales 의 매핑 key (= 온라인주문번호) */
  keyCol: 'AE' as const,
  fields: {
    salesType: 'A', // 매출구분 (예: "[B2B]", "A-CJ온스타일(jkman2)")
    salesDate: 'C', // 매출일
    onlineOrderNo: 'AE', // 온라인주문번호 (매핑 key)
    K: 'K', // 매출액
    L: 'L', // 공급가
    M: 'M', // 원가
    Q: 'Q', // 물류비
    R: 'R', // 이익액(공급가)
    S: 'S', // 이익률(공급가)
    T: 'T', // 이익액(판매가)
    U: 'U', // 이익률(판매가)
  },
} as const

export const REVENUE_MAPPING = {
  /** v1.3 (2026-05-24): product → brand 로 변경. brand 가 같은 주문집합을 상위호환으로 채움 */
  fileName: 'revenue_profit_brand',
  /** 병합 헤더 2행 (실데이터로 확인 완료 2026-05-24). */
  headerRows: 2,
  /** revenue 의 매핑 key (= 주문번호) */
  keyCol: 'E' as const,
  fields: {
    productCode: 'Y', // 상품코드
    productName: 'AH', // 상품명 (v1.3: AG → AH 정정, 사용자 확정 2026-05-24)
    brandName: 'BF', // 브랜드명 (v1.3 신규)
  },
} as const

/**
 * 매출이익리스트(상품) — v1.6 (2026-05-26 사용자 확정).
 * brand 파일과 컬럼 구조 동일하지만 AQ 의미가 "세트 수량" (= 주문 단위).
 *  - brand.AQ = 단품 수량 (예: 1세트=10개일 때 20)
 *  - product.AQ = 세트 수량 (예: 2)
 * 추가후정산금 계산에 사용하는 quantity 는 product.AQ 로 확정.
 */
export const PRODUCT_MAPPING = {
  fileName: 'revenue_profit_product',
  headerRows: 2,
  /** product 의 매핑 key (= 주문번호, brand 와 동일 letter) */
  keyCol: 'E' as const,
  fields: {
    quantity: 'AQ', // 판매세트 수량
  },
} as const

export type SalesMapping = typeof SALES_MAPPING
export type RevenueMapping = typeof REVENUE_MAPPING
export type ProductMapping = typeof PRODUCT_MAPPING

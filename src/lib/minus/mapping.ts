/**
 * Excel 매핑 설정 — 모든 column letter 는 이 파일에 집중한다.
 * 코드 어디서도 letter 를 하드코딩하지 말 것.
 *
 * 출처:
 * - sales_status_basic 의 letter (A~AG): project_minus_logic.md (사용자 확정)
 * - revenue_profit_product 의 letter (E, Y, AG): project_minus_logic.md
 * - 헤더 행 수(2): excel-mapping/skill.md §3 (2행짜리 병합 헤더)
 */

export const SALES_MAPPING = {
  fileName: 'sales_status_basic',
  headerRows: 2,
  /** sales 의 매핑 key (= 온라인주문번호) */
  keyCol: 'AE' as const,
  fields: {
    salesDate: 'C', // 매출일
    onlineOrderNo: 'AE', // 온라인주문번호 (매핑 key)
    K: 'K', // 매출액
    L: 'L', // 공급가
    M: 'M', // 원가
    R: 'R', // 이익액(공급가)
    S: 'S', // 이익률(공급가)
    T: 'T', // 이익액(판매가)
    U: 'U', // 이익률(판매가)
  },
} as const

export const REVENUE_MAPPING = {
  fileName: 'revenue_profit_product',
  /**
   * revenue_profit_product 의 헤더 행 수가 정확히 몇 행인지 미확정.
   * 우선 2 로 두고, 파싱 결과 anomaly 가 있으면 진단 로그에 표시(자동 변경 금지).
   */
  headerRows: 2,
  /** revenue 의 매핑 key (= 주문번호) */
  keyCol: 'E' as const,
  fields: {
    productCode: 'Y', // 상품코드
    productName: 'AG', // 상품명
  },
} as const

export type SalesMapping = typeof SALES_MAPPING
export type RevenueMapping = typeof REVENUE_MAPPING

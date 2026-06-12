/**
 * Excel 매핑 설정 — 모든 column letter 는 이 파일에 집중한다.
 * 코드 어디서도 letter 를 하드코딩하지 말 것.
 *
 * 출처:
 * - sales_status_basic 의 letter (A~AG): project_minus_logic.md (사용자 확정)
 * - revenue_profit_brand: E(key), Y(상품코드), BF(브랜드명) — 2026-05-24 사용자 확정
 * - revenue_profit_product: E(key), AH(상품명), AQ(판매세트 수량)
 *   (v1.3 때는 당시 샘플 파일에서 product 의 BF/AH 채움률이 낮아 표시 정보를 brand 로 통합했으나,
 *    v1.7(2026-05-29) 신규 업로드 파일에선 product.AH 가 모두 채워져 있어 상품명을 product 로 되돌림.
 *    상품코드·브랜드명은 그대로 brand 유지.)
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
    brandName: 'BF', // 브랜드명 (v1.3 신규)
    // productName: 'AH' — v1.7 (2026-05-29) product 파일 AH 로 이동.
    //   사용자가 brand 상품명 대신 product 파일 상품명을 쓰기로 확정.
    //   (실제 업로드 파일에는 product.AH 가 모두 채워져 있음.)
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
    productCode: 'Y', // 상품코드 — 묶음 추가후정산금 합산의 cal_amount 룩업 키 (2026-06-08)
    productName: 'AH', // 상품명 (v1.7 2026-05-29: brand → product 파일로 이동, 사용자 확정)
    quantity: 'AQ', // 판매세트 수량
    cost: 'BA', // 원가총액 — 분석 결과 표시용 (헤더 "원가총액", 서식 #,##0). 반품은 음수. 묶음은 대표(첫) 행 값.
    // 최종이익액/최종이익률 — 계산하지 않고 product 파일 값을 그대로 표시 (2026-06-12 사용자 확정).
    //   기존: calc.ts 가 finalProfit=R-Q, finalProfitRate=finalProfit/L 로 계산.
    //   변경: product 파일 BB("공급가기준 이익액")/BC("공급가기준 이익율")를 직접 읽어 주입.
    finalProfit: 'BB', // 최종이익액 (서식 #,##0)
    // 최종이익률. BC 서식이 #,##0.00"%" 라 raw 값이 이미 퍼센트 수치(예: 17.52 = 17.52%).
    //   UI percentColumn 이 ×100 하므로 파이프라인에서 /100 해 비율(0~1)로 변환한다.
    //   (BC 서식은 항상 고정 — 사용자 확정 2026-06-12. 따라서 런타임 범위 가드는 두지 않는다.)
    finalProfitRate: 'BC',
  },
} as const

export type SalesMapping = typeof SALES_MAPPING
export type RevenueMapping = typeof REVENUE_MAPPING
export type ProductMapping = typeof PRODUCT_MAPPING

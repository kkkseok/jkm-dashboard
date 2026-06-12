/**
 * 마이너스 매출이익률 파이프라인 타입.
 *
 * data-pipeline 에이전트 입출력 프로토콜 (.claude/agents/data-pipeline.md §입력/출력 프로토콜)을
 * 그대로 따른다.
 *
 * 핵심 결정:
 * - extraSettlement = null  → cal_amount 매칭 실패 (UI 셀 "-" + ➕ 아이콘, "누락" KPI 집계 대상)
 * - extraSettlement = 0     → cal_amount 에 0 으로 등록됨 (의도적 등록, 누락 아님)
 *   계산식 안에서는 (extraSettlement ?? 0) 로 처리하지만, UI 표시는 null 을 그대로 보존한다.
 *   (project_minus_logic.md "추가후정산금 누락" 정의 2026-05-22 사용자 확정)
 */

/** SheetJS sheet_to_json header:1 결과 (2차원 배열의 한 행) */
export type RawSalesRow = unknown[]
export type RawRevenueRow = unknown[]

export type EnrichedRow = {
  // 원본 (sales_status_basic)
  salesType: string | null // A — 매출구분 (예: "[B2B]", "A-CJ온스타일(jkman2)"). 원본 그대로 보존.
  // 파생 — 매출구분을 채널 라벨로 정규화 (sales-type.ts).
  //   예: "A-CJ온스타일(jkman2)" → "CJ온스타일", "[B2B]" → "B2B".
  //   필터/그룹핑/KPI 는 이 값으로 동작. 원본 salesType 은 cell tooltip 에 보존.
  //   null = salesType 가 null/공백.
  salesChannel: string | null
  salesDate: string | null // C
  onlineOrderNo: string | null // AE (매핑 key)
  K: number | null // 매출액
  L: number | null // 공급가
  M: number | null // 원가
  Q: number | null // 물류비
  R: number | null // 이익액(공급가)
  S: number | null // 이익률(공급가)
  T: number | null // 이익액(판매가)
  U: number | null // 이익률(판매가)

  // 매핑 from revenue_profit_brand — 표시 정보 (상품 식별, 브랜드명)
  productCode: string | null // Y
  productName: string | null // AH (v1.3)
  brandName: string | null // BF (v1.3)

  // 매핑 from revenue_profit_product — 판매세트 수량 (v1.6 2026-05-26)
  // brand 의 AQ(단품 수량) 가 아니라 product 의 AQ(세트 수량) 를 quantity 로 사용한다.
  // product 매칭 실패 시 null.
  quantity: number | null

  // 매핑 from revenue_profit_product — 원가총액 (BA, 헤더 "원가총액"). (2026-06-12 사용자 확정)
  // sales 의 M(원가)과 별개 — 분석 결과 표시는 이 product.BA 값을 쓴다. 반품은 음수.
  // 묶음은 대표(첫) 행 값. product 매칭 실패 시 null. 표시 위치: 공급가(L)와 이익액(R) 사이.
  cost: number | null

  // 매핑 from product_master (P4 추가) — 단품/복합 구분.
  // null = 매칭 실패 (UI 에 "미매칭" Badge 노출). 02_uiux_products §5-1.
  isComposite: boolean | null

  // 묶음 구성 상품 (v1.8 2026-06-08) — sales 1행 ↔ product 여러 행(묶음 상품).
  // product 파일에서 같은 주문번호를 가진 행들을 그대로 보존한다. 단품이면 length 1.
  // 클라이언트 재계산(applyCalAmountUpdate)이 구성 상품별로 동작하도록 기여분(extra)까지 담는다.
  //   - productCode = product.Y (cal_amount 룩업 키)
  //   - quantity    = product.AQ (판매세트 수량)
  //   - extra       = cal_amount[productCode] × quantity (룩업/수량 실패 시 null)
  components: Array<{
    productCode: string | null
    quantity: number | null
    extra: number | null
  }>

  // 룩업 (cal_amount × quantity)
  // v1.5 (2026-05-26): extraSettlement 의 의미가 "cal_amount 의 단가 × 판매세트 수량" 으로 변경.
  // v1.6 (2026-05-26): quantity 출처가 product 파일로 명확화.
  // v1.8 (2026-06-08): 묶음이면 components.extra 중 non-null 의 합(부분합).
  // - null   = 모든 구성 상품이 cal_amount 매칭 실패(전부 미등록) OR product 매칭 실패
  // - number = 등록된 구성 상품들의 (cal_amount 입력값 × quantity) 합
  extraSettlement: number | null

  // 계산 (7개) - profit-calc 스킬 수식 적용
  commissionRate: number | null // 1 - L/K
  settlementAmount: number | null // K * (commissionRate / 2)
  totalMargin: number | null // R + settlementAmount + (extraSettlement ?? 0). Q와 무관.
  totalMarginRate: number | null // totalMargin / L
  /** 최종이익액 — product 파일(revenue_profit_product) BB("공급가기준 이익액") 값 그대로. 묶음은 대표(첫) 행. (2026-06-12) */
  finalProfit: number | null
  /** 최종이익률 — product 파일 BC("공급가기준 이익율")를 /100 한 비율(0~1). 묶음은 대표(첫) 행. (2026-06-12) */
  finalProfitRate: number | null
}

export type PipelineDiagnostics = {
  /** sales_status_basic 데이터 행 수 (헤더 제외, 빈 행 제외) */
  totalRows: number
  /** sales ↔ revenue 조인 성공 수 (revenue 의 productCode 가 매칭된 행) */
  matchedCount: number
  /** sales ↔ revenue 조인 실패 수 (productCode === null) */
  unmatchedJoinCount: number
  /** cal_amount 매칭 실패 수 (= "추가후정산금 누락" KPI). 사용자 확정 정의 (2026-05-22) */
  missingExtraCount: number
  /** K=0 또는 L=0 등으로 5개 계산 컬럼 중 하나 이상이 null 인 행 수 */
  computeNullCount: number
}

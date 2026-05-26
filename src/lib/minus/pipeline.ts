/**
 * 마이너스 매출이익률 통합 파이프라인.
 *
 * 두 파일(sales_status_basic, revenue_profit_product) + cal_amount Map 을 받아
 * EnrichedRow[] + Diagnostics 를 반환한다.
 *
 * 흐름:
 *   1. salesFile, revenueFile 각각 파싱 (header:1)
 *   2. excel-mapping/skill.md §5 leftJoin: sales(LEFT) ↔ revenue(RIGHT), key: AE ↔ E
 *   3. 각 행에서 letter 기반으로 EnrichedRow 필드 추출
 *   4. productCode 로 calAmountMap.get → extraSettlement (없으면 null)
 *   5. computeProfit({ K, L, R, extraSettlement }) → 5컬럼 계산
 *   6. Diagnostics 집계
 *
 * DB 의존 없음. 클라이언트사이드 호환.
 */

import { computeProfit } from './calc'
import { PRODUCT_MAPPING, REVENUE_MAPPING, SALES_MAPPING } from './mapping'
import {
  leftJoin,
  parseWorkbookToRows,
  readNum,
  readStr,
  sliceDataRows,
} from './parse'
import type { EnrichedRow, PipelineDiagnostics } from './types'

export type PipelineInput = {
  salesFile: File | ArrayBuffer
  /** 매출이익리스트(브랜드) — productName/brandName 등 표시 정보 출처 */
  revenueFile: File | ArrayBuffer
  /**
   * 매출이익리스트(상품) — quantity(판매세트 수량, AQ) 출처. v1.6 (2026-05-26).
   * brand.AQ 는 단품 수량이라 추가후정산금 계산에 부적합.
   */
  productFile: File | ArrayBuffer
  /**
   * productCode → extraSettlement 룩업.
   * 호출 측(next-builder)이 getCalAmountMap() 으로 가져와서 주입한다.
   * Map 에 키가 없으면 매칭 실패 (= EnrichedRow.extraSettlement === null).
   */
  calAmountMap: Map<string, number>
}

export type PipelineResult = {
  rows: EnrichedRow[]
  diagnostics: PipelineDiagnostics
}

/**
 * 두 파싱 결과(또는 ArrayBuffer/File)와 cal_amount Map 으로부터 EnrichedRow 배열 + 진단 정보 생성.
 */
export async function enrichMinusData(input: PipelineInput): Promise<PipelineResult> {
  const { salesFile, revenueFile, productFile, calAmountMap } = input

  // 1. 세 파일 병렬 파싱
  const [salesAll, revenueAll, productAll] = await Promise.all([
    parseWorkbookToRows(salesFile),
    parseWorkbookToRows(revenueFile),
    parseWorkbookToRows(productFile),
  ])

  // 헤더 행 제거 + 빈 행 필터
  const salesRows = sliceDataRows(salesAll, SALES_MAPPING.headerRows)
  const revenueRows = sliceDataRows(revenueAll, REVENUE_MAPPING.headerRows)
  const productRows = sliceDataRows(productAll, PRODUCT_MAPPING.headerRows)

  // 2. LEFT JOIN 두 번 — sales ↔ brand(표시), sales ↔ product(수량)
  // 두 revenue 파일 모두 매핑 키가 E 라서 같은 키로 두 번 조인한다.
  const joinedRevenue = leftJoin(
    salesRows,
    revenueRows,
    SALES_MAPPING.keyCol,
    REVENUE_MAPPING.keyCol,
  )
  const joinedProduct = leftJoin(
    salesRows,
    productRows,
    SALES_MAPPING.keyCol,
    PRODUCT_MAPPING.keyCol,
  )
  // 동일한 sales 순서를 기준으로 두 결과를 인덱스로 묶는다.
  const joined = joinedRevenue.map((r, i) => ({
    left: r.left,
    revenue: r.right,
    product: joinedProduct[i]?.right ?? null,
  }))

  // 3~5. 각 행 enrich
  const rows: EnrichedRow[] = []
  let matchedCount = 0
  let unmatchedJoinCount = 0
  let missingExtraCount = 0
  let computeNullCount = 0

  for (const { left, revenue, product } of joined) {
    // 원본 (sales)
    const salesType = readStr(left, SALES_MAPPING.fields.salesType)
    const salesDate = readStr(left, SALES_MAPPING.fields.salesDate)
    const onlineOrderNo = readStr(left, SALES_MAPPING.fields.onlineOrderNo)
    const K = readNum(left, SALES_MAPPING.fields.K)
    const L = readNum(left, SALES_MAPPING.fields.L)
    const M = readNum(left, SALES_MAPPING.fields.M)
    const Q = readNum(left, SALES_MAPPING.fields.Q)
    const R = readNum(left, SALES_MAPPING.fields.R)
    const S = readNum(left, SALES_MAPPING.fields.S)
    const T = readNum(left, SALES_MAPPING.fields.T)
    const U = readNum(left, SALES_MAPPING.fields.U)

    // 매핑 (revenue_profit_brand) — 표시 정보만
    const productCode = revenue ? readStr(revenue, REVENUE_MAPPING.fields.productCode) : null
    const productName = revenue ? readStr(revenue, REVENUE_MAPPING.fields.productName) : null
    const brandName = revenue ? readStr(revenue, REVENUE_MAPPING.fields.brandName) : null

    // 매핑 (revenue_profit_product) — 판매세트 수량
    const quantity = product ? readNum(product, PRODUCT_MAPPING.fields.quantity) : null

    if (productCode != null) matchedCount++
    else unmatchedJoinCount++

    // 룩업 (cal_amount × quantity) — v1.5 (2026-05-26 사용자 확정)
    // extraSettlement = cal_amount 단가 × revenue 판매수량 (AQ)
    // - cal_amount 매칭 실패 OR quantity null → extraSettlement = null
    // - cal_amount 0 등록 + quantity 양수 → extraSettlement = 0 (누락 아님)
    let extraSettlement: number | null = null
    if (productCode != null && calAmountMap.has(productCode) && quantity != null) {
      const perUnit = calAmountMap.get(productCode) ?? null
      extraSettlement = perUnit != null ? perUnit * quantity : null
    }
    if (extraSettlement == null) missingExtraCount++

    // 계산 7개 (수수료/후정산/총마진액/총마진율/최종이익액/최종이익률)
    const profit = computeProfit({ K, L, Q, R, extraSettlement })

    // 일부 계산이 null 인 행 카운트 (기존 4개 컬럼 기준 유지 — finalProfit 계열은
    // Q=null 만으로도 null 이 자주 나올 수 있어 별도 카운트 미적용)
    if (
      profit.commissionRate == null ||
      profit.settlementAmount == null ||
      profit.totalMargin == null ||
      profit.totalMarginRate == null
    ) {
      computeNullCount++
    }

    rows.push({
      salesType,
      salesDate,
      onlineOrderNo,
      K,
      L,
      M,
      Q,
      R,
      S,
      T,
      U,
      productCode,
      productName,
      brandName,
      quantity,
      extraSettlement,
      ...profit,
    })
  }

  const diagnostics: PipelineDiagnostics = {
    totalRows: salesRows.length,
    matchedCount,
    unmatchedJoinCount,
    missingExtraCount,
    computeNullCount,
  }

  return { rows, diagnostics }
}

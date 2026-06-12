/**
 * 마이너스 매출이익률 통합 파이프라인.
 *
 * 두 파일(sales_status_basic, revenue_profit_product) + cal_amount Map 을 받아
 * EnrichedRow[] + Diagnostics 를 반환한다.
 *
 * 흐름:
 *   1. salesFile, revenueFile 각각 파싱 (header:1)
 *   2. leftJoinByVoucher: sales(LEFT) ↔ revenue(RIGHT), 라인 키 = 전표번호(AF ↔ F base).
 *      전표 없는 행은 주문번호(AE ↔ E) 폴백. (2026-06-12: 다중 라인 주문 라인별 분리)
 *   3. 각 행에서 letter 기반으로 EnrichedRow 필드 추출
 *   4. productCode 로 calAmountMap.get → extraSettlement (없으면 null)
 *   5. computeProfit({ K, L, R, extraSettlement }) → 5컬럼 계산
 *   6. Diagnostics 집계
 *
 * DB 의존 없음. 클라이언트사이드 호환.
 */

import { applyCommissionClearing, computeProfit } from './calc'
import { PRODUCT_MAPPING, REVENUE_MAPPING, SALES_MAPPING } from './mapping'
import {
  groupByKey,
  leftJoinByVoucher,
  parseWorkbookToRows,
  readNum,
  readStr,
  sliceDataRows,
  voucherBase,
} from './parse'
import { normalizeSalesType } from './sales-type'
import type { EnrichedRow, PipelineDiagnostics } from './types'

/**
 * productCode → 상품 마스터 메타.
 * P4 추가. 호출 측(next-builder)이 `getProductMasterMap()` 서버 액션으로 가져와 주입.
 * Map 에 키가 없으면 매칭 실패 (= EnrichedRow.isComposite === null).
 *
 * value 구조는 P3 가 확정한 `getProductMasterMap()` 반환 타입을 따른다.
 * 본 파이프라인은 isComposite 만 소비한다. 다른 필드는 향후 UI 확장 시 사용.
 */
export type ProductMasterMap = Map<
  string,
  {
    isComposite: boolean
    channelName: string
    brandName: string
    productName: string
  }
>

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
  /**
   * productCode → 상품 마스터 메타. P4 추가 (`getProductMasterMap()` 결과).
   * 빈 Map 을 넘기면 모든 행이 isComposite=null (미매칭) 상태가 된다.
   */
  productMasterMap: ProductMasterMap
}

export type PipelineResult = {
  rows: EnrichedRow[]
  diagnostics: PipelineDiagnostics
}

/**
 * 두 파싱 결과(또는 ArrayBuffer/File)와 cal_amount Map 으로부터 EnrichedRow 배열 + 진단 정보 생성.
 */
export async function enrichMinusData(input: PipelineInput): Promise<PipelineResult> {
  const { salesFile, revenueFile, productFile, calAmountMap, productMasterMap } = input

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
  // 라인 단위 키 = 전표번호(AF ↔ F base). 한 주문에 상품 여러 개여도 라인별 정확 매칭.
  // 전표번호 없는 sales 행은 주문번호(AE↔E)로 폴백(사용자 확정 B, 2026-06-12).
  const joinedRevenue = leftJoinByVoucher(
    salesRows,
    revenueRows,
    SALES_MAPPING.voucherCol,
    SALES_MAPPING.keyCol,
    REVENUE_MAPPING.voucherCol,
    REVENUE_MAPPING.keyCol,
  )
  const joinedProduct = leftJoinByVoucher(
    salesRows,
    productRows,
    SALES_MAPPING.voucherCol,
    SALES_MAPPING.keyCol,
    PRODUCT_MAPPING.voucherCol,
    PRODUCT_MAPPING.keyCol,
  )
  // 동일한 sales 순서를 기준으로 두 결과를 인덱스로 묶는다.
  const joined = joinedRevenue.map((r, i) => ({
    left: r.left,
    revenue: r.right,
    product: joinedProduct[i]?.right ?? null,
  }))

  // 묶음 상품 대응 (v1.8 2026-06-08, v1.10 2026-06-12 전표 단위로 변경):
  // 진짜 묶음 = 한 전표(F base)에 product 여러 행. 추가후정산금을 구성 상품별로 합산.
  // 전표 단위 그룹이 기본이고, 전표 없는 행은 주문번호 그룹으로 폴백(B).
  const productGroupsByVoucher = groupByKey(
    productRows,
    PRODUCT_MAPPING.voucherCol,
    voucherBase,
  )
  const productGroupsByOrder = groupByKey(productRows, PRODUCT_MAPPING.keyCol)

  // 3~5. 각 행 enrich
  const rows: EnrichedRow[] = []
  let matchedCount = 0
  let unmatchedJoinCount = 0
  let missingExtraCount = 0
  let computeNullCount = 0

  for (const { left, revenue, product } of joined) {
    // 원본 (sales)
    const salesType = readStr(left, SALES_MAPPING.fields.salesType)
    const salesChannel = normalizeSalesType(salesType)
    const salesDate = readStr(left, SALES_MAPPING.fields.salesDate)
    const onlineOrderNo = readStr(left, SALES_MAPPING.fields.onlineOrderNo)
    const voucherNo = readStr(left, SALES_MAPPING.voucherCol)
    const K = readNum(left, SALES_MAPPING.fields.K)
    const L = readNum(left, SALES_MAPPING.fields.L)
    const M = readNum(left, SALES_MAPPING.fields.M)
    const Q = readNum(left, SALES_MAPPING.fields.Q)
    const R = readNum(left, SALES_MAPPING.fields.R)
    const S = readNum(left, SALES_MAPPING.fields.S)
    const T = readNum(left, SALES_MAPPING.fields.T)
    const U = readNum(left, SALES_MAPPING.fields.U)

    // 매핑 (revenue_profit_brand) — 상품코드/브랜드명
    const productCode = revenue ? readStr(revenue, REVENUE_MAPPING.fields.productCode) : null
    const brandName = revenue ? readStr(revenue, REVENUE_MAPPING.fields.brandName) : null

    // 매핑 (revenue_profit_product) — 상품명(v1.7) + 판매세트 수량
    const productName = product ? readStr(product, PRODUCT_MAPPING.fields.productName) : null
    const quantity = product ? readNum(product, PRODUCT_MAPPING.fields.quantity) : null
    // 원가총액(BA) — 분석 결과 표시용. 묶음은 대표(첫) 행. product 매칭 실패 시 null.
    const cost = product ? readNum(product, PRODUCT_MAPPING.fields.cost) : null

    // 최종이익액/최종이익률 — 계산하지 않고 product 파일 BB/BC 를 그대로 표시 (2026-06-12 사용자 확정).
    // 묶음(복합)은 대표(첫) 행 값. product 매칭 실패 시 null.
    const finalProfit = product ? readNum(product, PRODUCT_MAPPING.fields.finalProfit) : null
    // BC 서식이 #,##0.00"%" → raw 가 이미 퍼센트 수치(예: 17.52). UI(×100)에 맞춰 /100 로 비율 변환.
    const finalProfitRateRaw = product ? readNum(product, PRODUCT_MAPPING.fields.finalProfitRate) : null
    const finalProfitRate = finalProfitRateRaw != null ? finalProfitRateRaw / 100 : null

    if (productCode != null) matchedCount++
    else unmatchedJoinCount++

    // 상품 마스터 매칭 (P4 추가)
    // productCode null 이거나 마스터에 등록되지 않은 경우 isComposite = null (UI "미매칭" Badge).
    const masterRow =
      productCode != null ? (productMasterMap.get(productCode) ?? null) : null
    const isComposite = masterRow ? masterRow.isComposite : null

    // 룩업 (cal_amount × quantity) — v1.5 (2026-05-26) / v1.8 묶음 합산 (2026-06-08)
    // 묶음 상품: 주문번호의 product 행마다 (cal_amount[product.Y] × product.AQ) 를
    // 구성 기여분(extra)으로 만들고, non-null 들을 합산(부분합)한다.
    //   - 구성 상품 cal_amount 매칭 실패 OR quantity null → 그 구성 extra = null
    //   - cal_amount 0 등록 + quantity 양수 → extra = 0 (누락 아님)
    //   - 전부 미등록(모든 extra null) → extraSettlement = null (누락 KPI 집계)
    //   - 단품(group 1행)은 기존과 동일 결과.
    // 전표번호 그룹이 기본(라인 단위). 전표 없는 행만 주문번호 그룹으로 폴백(B).
    const productGroup =
      voucherNo != null
        ? productGroupsByVoucher.get(voucherBase(voucherNo)) ?? []
        : onlineOrderNo != null
          ? productGroupsByOrder.get(onlineOrderNo) ?? []
          : []
    const components = productGroup.map((prow) => {
      const pc = readStr(prow, PRODUCT_MAPPING.fields.productCode)
      const qty = readNum(prow, PRODUCT_MAPPING.fields.quantity)
      const extra =
        pc != null && calAmountMap.has(pc) && qty != null
          ? (calAmountMap.get(pc) ?? 0) * qty
          : null
      return { productCode: pc, quantity: qty, extra }
    })
    const settledComponents = components.filter((c) => c.extra != null)
    const extraSettlement: number | null =
      settledComponents.length > 0
        ? settledComponents.reduce((sum, c) => sum + (c.extra ?? 0), 0)
        : null
    if (extraSettlement == null) missingExtraCount++

    // 계산 4개 (수수료/후정산/총마진액/총마진율). 최종이익액/최종이익률은 product 파일 값.
    const profitRaw = computeProfit({ K, L, R, extraSettlement })

    // 일부 계산이 null 인 행 카운트 (기존 4개 컬럼 기준 유지 — finalProfit 계열은
    // Q=null 만으로도 null 이 자주 나올 수 있어 별도 카운트 미적용)
    // 채널/브랜드 규칙에 의한 "의도적 제거"는 계산 실패가 아니므로 원본(profitRaw) 기준으로 집계.
    if (
      profitRaw.commissionRate == null ||
      profitRaw.settlementAmount == null ||
      profitRaw.totalMargin == null ||
      profitRaw.totalMarginRate == null
    ) {
      computeNullCount++
    }

    // 채널/브랜드별 수수료·후정산금 제거 후처리 (사용자 확정 2026-05-29).
    const profit = applyCommissionClearing(profitRaw, {
      brandName,
      salesChannel,
      isComposite,
      R,
      L,
      extraSettlement,
    })

    rows.push({
      salesType,
      salesChannel,
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
      cost,
      isComposite,
      components,
      extraSettlement,
      ...profit,
      finalProfit,
      finalProfitRate,
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

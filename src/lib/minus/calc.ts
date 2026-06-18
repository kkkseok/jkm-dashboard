/**
 * profit-calc 스킬의 computeProfit 을 EnrichedRow 필드명에 맞춰 재구현.
 * 수식은 절대 변경 금지 (profit-calc/skill.md §6).
 *
 * 입력 측 차이: 본 파이프라인에서는 extraSettlement 가 null 일 수 있다 (cal_amount 매칭 실패).
 *   - 사용자 지시문: totalMargin = R + settlementAmount + (extraSettlement ?? 0)
 *   - profit-calc 스킬 §3 "룩업 실패 시 0" 룰과 호환됨.
 *   - 단, UI 표시는 null 을 보존해야 하므로 본 함수는 ProfitOutput 에 extraSettlement 를 포함하지 않는다.
 *     (호출 측에서 별도 보존 → EnrichedRow.extraSettlement 로 직접 set)
 */

import type { EnrichedRow } from './types'

// 최종이익액/최종이익률은 더 이상 계산하지 않는다 (2026-06-12 사용자 확정).
//   product 파일(revenue_profit_product) 의 BB/BC 값을 파이프라인이 직접 주입한다.
//   → computeProfit 은 Q(물류비) 를 받지 않으며 ProfitOutput 에 finalProfit 계열도 없다.
export type ProfitInput = Pick<EnrichedRow, 'K' | 'L' | 'R' | 'extraSettlement'>
export type ProfitOutput = Pick<
  EnrichedRow,
  | 'commissionRate'
  | 'settlementAmount'
  | 'totalMargin'
  | 'totalMarginRate'
>

export function computeProfit(input: ProfitInput): ProfitOutput {
  const { K, L, R, extraSettlement } = input

  // 1. 수수료 = 1 - (L/K). K=0 또는 K/L null 이면 null.
  const commissionRate =
    K != null && K !== 0 && L != null ? 1 - L / K : null

  // 2. 후정산금 = K * (수수료 / 2). 수수료 null 또는 K null 이면 null.
  const settlementAmount =
    K != null && commissionRate != null ? K * (commissionRate / 2) : null

  // 3. 추가후정산금 (extraSettlement) 은 그대로 사용 — 본 함수는 출력에 포함하지 않는다.
  //    매칭 실패 시 null 이지만, 4번 계산 시에는 (extraSettlement ?? 0) 으로 0 처리.

  // 4. 총마진액 = R + 후정산금 + (추가후정산금 ?? 0). R 또는 후정산금 null 이면 null.
  //    사용자 확정 (2026-05-24): 수식은 Q(물류비) 항을 별도로 더하지 않는다.
  //    2026-06-18: 입력 sales 파일이 `sales_status_mod_*` 로 바뀌며 R(이익액) 자체에 물류비가
  //    차감됨(product BB 와 정렬). → 수식은 불변이나 totalMargin/총마진율은 이제 실질적으로
  //    물류비를 반영한다(사용자 확정 옵션 A). 절대 R 에 Q 를 더해 '복원'하지 말 것.
  const totalMargin =
    R != null && settlementAmount != null
      ? R + settlementAmount + (extraSettlement ?? 0)
      : null

  // 5. 총마진율 = 총마진액 / L. L=0 또는 L null 또는 총마진액 null 이면 null.
  const totalMarginRate =
    totalMargin != null && L != null && L !== 0 ? totalMargin / L : null

  // 최종이익액/최종이익률은 여기서 계산하지 않는다 — product 파일 BB/BC 를 파이프라인이 주입.

  return {
    commissionRate,
    settlementAmount,
    totalMargin,
    totalMarginRate,
  }
}

/**
 * 수수료·후정산금(= "수수료 지원")을 유지하는 유일한 브랜드.
 * 이 브랜드가 아니면 무조건 제거 대상.
 */
export const COMMISSION_BRAND = 'CJ-씨제이제일제당(주)'

/**
 * 채널/브랜드별 "수수료 지원"(수수료 + 후정산금) 제거 여부 (사용자 확정 2026-05-29).
 *
 * 수수료(commissionRate)·후정산금(settlementAmount)을 "-"(null)로 비우는 조건:
 *   A) 브랜드명 = CJ제일제당 AND 매출구분 = 토스
 *   B) 브랜드명 = CJ제일제당 AND 매출구분 ∈ {쇼핑엔티, W쇼핑} AND 단품(isComposite === false)
 *   C) 브랜드명이 있으나 CJ제일제당이 아닌 경우 (전부)
 * 그 외(= CJ제일제당 + A/B 아님)는 유지.
 * - 브랜드 매칭 실패(brandName === null)는 현행 유지 — 사용자 확정 "매칭 실패는 우선 놔둠" (2026-05-29).
 * - isComposite === null(미매칭)은 단품이 아니므로 B 미적용 — 사용자 확정 "미매칭은 놔둠".
 *
 * 비교 대상 salesChannel 은 정규화 라벨(sales-type.ts). 사용자 확정 라벨: 토스 / 쇼핑엔티 / W쇼핑.
 */
export function shouldClearCommission(
  brandName: string | null,
  salesChannel: string | null,
  isComposite: boolean | null,
): boolean {
  if (brandName == null) return false // 브랜드 매칭 실패 → 현행 유지
  if (brandName !== COMMISSION_BRAND) return true // C
  if (salesChannel === '토스') return true // A
  if (
    (salesChannel === '쇼핑엔티' || salesChannel === 'W쇼핑') &&
    isComposite === false
  ) {
    return true // B (단품만)
  }
  return false
}

export type CommissionClearingContext = {
  brandName: string | null
  salesChannel: string | null
  isComposite: boolean | null
  R: number | null
  L: number | null
  extraSettlement: number | null
}

/**
 * computeProfit 결과에 채널/브랜드 규칙을 후처리로 적용 (분석 이후 단계).
 * 제거 대상이면 수수료·후정산금을 null 로 비우고, 총마진액을 후정산금 항 없이 재계산한다.
 *   총마진액 = R + (추가후정산금 ?? 0)      (후정산금 항 제거)
 *   총마진율 = 총마진액 / L
 * 제거 대상이 아니면 입력 profit 을 그대로 반환.
 * (최종이익액/최종이익률은 profit 에 없다 — product 파일 값이라 이 후처리와 무관하게 불변.)
 */
export function applyCommissionClearing(
  profit: ProfitOutput,
  ctx: CommissionClearingContext,
): ProfitOutput {
  if (!shouldClearCommission(ctx.brandName, ctx.salesChannel, ctx.isComposite)) {
    return profit
  }
  const totalMargin = ctx.R != null ? ctx.R + (ctx.extraSettlement ?? 0) : null
  const totalMarginRate =
    totalMargin != null && ctx.L != null && ctx.L !== 0
      ? totalMargin / ctx.L
      : null
  return {
    ...profit,
    commissionRate: null,
    settlementAmount: null,
    totalMargin,
    totalMarginRate,
  }
}

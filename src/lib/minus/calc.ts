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

export type ProfitInput = Pick<EnrichedRow, 'K' | 'L' | 'R' | 'extraSettlement'>
export type ProfitOutput = Pick<
  EnrichedRow,
  'commissionRate' | 'settlementAmount' | 'totalMargin' | 'totalMarginRate'
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
  const totalMargin =
    R != null && settlementAmount != null
      ? R + settlementAmount + (extraSettlement ?? 0)
      : null

  // 5. 총마진율 = 총마진액 / L. L=0 또는 L null 또는 총마진액 null 이면 null.
  const totalMarginRate =
    totalMargin != null && L != null && L !== 0 ? totalMargin / L : null

  return {
    commissionRate,
    settlementAmount,
    totalMargin,
    totalMarginRate,
  }
}

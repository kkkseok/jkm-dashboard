import { describe, expect, it } from 'vitest'
import { computeProfit } from '../calc'

describe('computeProfit', () => {
  it('정상 계산: K=1000, L=900, R=100, extra=50', () => {
    const out = computeProfit({ K: 1000, L: 900, R: 100, extraSettlement: 50 })
    // 수수료 = 1 - 900/1000 = 0.1
    expect(out.commissionRate).toBeCloseTo(0.1, 10)
    // 후정산금 = 1000 * (0.1 / 2) = 50
    expect(out.settlementAmount).toBeCloseTo(50, 10)
    // 총마진액 = 100 + 50 + 50 = 200
    expect(out.totalMargin).toBeCloseTo(200, 10)
    // 총마진율 = 200 / 900
    expect(out.totalMarginRate).toBeCloseTo(200 / 900, 10)
  })

  it('K=0: 모든 계산 컬럼 null', () => {
    const out = computeProfit({ K: 0, L: 900, R: 100, extraSettlement: 50 })
    expect(out.commissionRate).toBeNull()
    expect(out.settlementAmount).toBeNull()
    expect(out.totalMargin).toBeNull()
    expect(out.totalMarginRate).toBeNull()
  })

  it('L=0: 수수료/후정산금은 계산되지만 totalMargin/totalMarginRate 영향', () => {
    // L=0 이면 commissionRate = 1 - 0/1000 = 1 → settlementAmount = 1000 * 0.5 = 500
    // totalMargin = 100 + 500 + 50 = 650 (정상). 단 L=0 → totalMarginRate = null
    const out = computeProfit({ K: 1000, L: 0, R: 100, extraSettlement: 50 })
    expect(out.commissionRate).toBeCloseTo(1, 10)
    expect(out.settlementAmount).toBeCloseTo(500, 10)
    expect(out.totalMargin).toBeCloseTo(650, 10)
    expect(out.totalMarginRate).toBeNull()
  })

  it('extraSettlement=null (매칭 실패): totalMargin 은 R + settlementAmount + 0', () => {
    const out = computeProfit({ K: 1000, L: 900, R: 100, extraSettlement: null })
    expect(out.commissionRate).toBeCloseTo(0.1, 10)
    expect(out.settlementAmount).toBeCloseTo(50, 10)
    // totalMargin = 100 + 50 + 0 = 150 (extraSettlement null → 0 처리)
    expect(out.totalMargin).toBeCloseTo(150, 10)
    expect(out.totalMarginRate).toBeCloseTo(150 / 900, 10)
  })

  it('extraSettlement=0 (등록됨): null 과 결과 동일하지만 의미가 다름', () => {
    const outZero = computeProfit({ K: 1000, L: 900, R: 100, extraSettlement: 0 })
    const outNull = computeProfit({ K: 1000, L: 900, R: 100, extraSettlement: null })
    expect(outZero.totalMargin).toBe(outNull.totalMargin)
    expect(outZero.totalMarginRate).toBe(outNull.totalMarginRate)
  })

  it('음수 케이스: R 이 음수면 totalMargin 도 음수', () => {
    // K=500, L=550 → 수수료 = 1 - 550/500 = -0.1
    // settlementAmount = 500 * (-0.05) = -25
    // totalMargin = -100 + (-25) + 30 = -95
    const out = computeProfit({ K: 500, L: 550, R: -100, extraSettlement: 30 })
    expect(out.commissionRate).toBeCloseTo(-0.1, 10)
    expect(out.settlementAmount).toBeCloseTo(-25, 10)
    expect(out.totalMargin).toBeCloseTo(-95, 10)
    expect(out.totalMarginRate).toBeCloseTo(-95 / 550, 10)
  })

  it('R=null: totalMargin / totalMarginRate null', () => {
    const out = computeProfit({ K: 1000, L: 900, R: null, extraSettlement: 50 })
    expect(out.commissionRate).toBeCloseTo(0.1, 10)
    expect(out.settlementAmount).toBeCloseTo(50, 10)
    expect(out.totalMargin).toBeNull()
    expect(out.totalMarginRate).toBeNull()
  })

  it('K/L 모두 null: 전부 null', () => {
    const out = computeProfit({ K: null, L: null, R: 100, extraSettlement: 50 })
    expect(out.commissionRate).toBeNull()
    expect(out.settlementAmount).toBeNull()
    expect(out.totalMargin).toBeNull()
    expect(out.totalMarginRate).toBeNull()
  })

  it('L=null 하지만 K!=0: commissionRate null (L 없으면 수수료 계산 불가)', () => {
    const out = computeProfit({ K: 1000, L: null, R: 100, extraSettlement: 50 })
    expect(out.commissionRate).toBeNull()
    expect(out.settlementAmount).toBeNull()
    expect(out.totalMargin).toBeNull()
    expect(out.totalMarginRate).toBeNull()
  })
})

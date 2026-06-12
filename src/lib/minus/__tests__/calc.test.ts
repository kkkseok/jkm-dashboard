import { describe, expect, it } from 'vitest'
import {
  COMMISSION_BRAND,
  applyCommissionClearing,
  computeProfit,
  shouldClearCommission,
} from '../calc'

// 최종이익액/최종이익률은 computeProfit 이 더 이상 계산하지 않는다 (2026-06-12 사용자 확정).
// product 파일(revenue_profit_product) BA/BB 를 파이프라인이 직접 주입하므로
// 본 테스트는 수수료/후정산/총마진액/총마진율 4컬럼만 검증한다.

describe('computeProfit — 수수료/후정산/총마진액/총마진율', () => {
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

describe('shouldClearCommission — 채널/브랜드 규칙 (사용자 확정 2026-05-29)', () => {
  const CJ = COMMISSION_BRAND

  it('C) 브랜드명이 있으나 CJ제일제당이 아니면 채널/구분 무관하게 항상 제거', () => {
    expect(shouldClearCommission('다른브랜드', 'CJ온스타일', true)).toBe(true)
    expect(shouldClearCommission('다른브랜드', '토스', false)).toBe(true)
    expect(shouldClearCommission('다른브랜드', '쇼핑엔티', null)).toBe(true)
  })

  it('브랜드 매칭 실패(null) → 현행 유지 (사용자: 매칭 실패는 놔둠)', () => {
    expect(shouldClearCommission(null, '토스', false)).toBe(false)
    expect(shouldClearCommission(null, '쇼핑엔티', false)).toBe(false)
    expect(shouldClearCommission(null, 'CJ온스타일', null)).toBe(false)
    expect(shouldClearCommission(null, null, null)).toBe(false)
  })

  it('A) CJ제일제당 + 토스 → 구분 무관하게 제거', () => {
    expect(shouldClearCommission(CJ, '토스', false)).toBe(true)
    expect(shouldClearCommission(CJ, '토스', true)).toBe(true)
    expect(shouldClearCommission(CJ, '토스', null)).toBe(true)
  })

  it('B) CJ제일제당 + 쇼핑엔티/W쇼핑 + 단품(false) → 제거', () => {
    expect(shouldClearCommission(CJ, '쇼핑엔티', false)).toBe(true)
    expect(shouldClearCommission(CJ, 'W쇼핑', false)).toBe(true)
  })

  it('B) CJ제일제당 + 쇼핑엔티/W쇼핑 + 복합(true) → 유지', () => {
    expect(shouldClearCommission(CJ, '쇼핑엔티', true)).toBe(false)
    expect(shouldClearCommission(CJ, 'W쇼핑', true)).toBe(false)
  })

  it('B) CJ제일제당 + 쇼핑엔티/W쇼핑 + 미매칭(null) → 유지 (사용자: 미매칭 놔둠)', () => {
    expect(shouldClearCommission(CJ, '쇼핑엔티', null)).toBe(false)
    expect(shouldClearCommission(CJ, 'W쇼핑', null)).toBe(false)
  })

  it('CJ제일제당 + 그 외 채널 → 유지 (현행)', () => {
    expect(shouldClearCommission(CJ, 'CJ온스타일', false)).toBe(false)
    expect(shouldClearCommission(CJ, 'GSshop', null)).toBe(false)
    expect(shouldClearCommission(CJ, null, true)).toBe(false)
  })
})

describe('applyCommissionClearing — 후처리(수수료/후정산금 제거 + 총마진액 재계산)', () => {
  // 기준 profit: K=1000,L=900,R=100,extra=50 → commission 0.1, settlement 50, totalMargin 200
  const baseInput = { K: 1000, L: 900, R: 100, extraSettlement: 50 } as const
  const baseProfit = computeProfit(baseInput)

  it('제거 대상(non-CJ): 수수료/후정산금 null, 총마진액 = R + 추가후정산금', () => {
    const out = applyCommissionClearing(baseProfit, {
      brandName: '다른브랜드',
      salesChannel: 'CJ온스타일',
      isComposite: true,
      R: 100,
      L: 900,
      extraSettlement: 50,
    })
    expect(out.commissionRate).toBeNull()
    expect(out.settlementAmount).toBeNull()
    // 총마진액 = 100 + 50 = 150 (후정산금 항 제거)
    expect(out.totalMargin).toBeCloseTo(150, 10)
    expect(out.totalMarginRate).toBeCloseTo(150 / 900, 10)
  })

  it('제거 대상 아님(CJ + 일반채널): profit 그대로 반환', () => {
    const out = applyCommissionClearing(baseProfit, {
      brandName: COMMISSION_BRAND,
      salesChannel: 'CJ온스타일',
      isComposite: false,
      R: 100,
      L: 900,
      extraSettlement: 50,
    })
    expect(out).toEqual(baseProfit)
    expect(out.totalMargin).toBeCloseTo(200, 10) // 현행 (R+후정산금+추가후정산금)
  })

  it('제거 대상 + 추가후정산금 null: 총마진액 = R (0 처리)', () => {
    const out = applyCommissionClearing(baseProfit, {
      brandName: '다른브랜드',
      salesChannel: '토스',
      isComposite: null,
      R: 100,
      L: 900,
      extraSettlement: null,
    })
    expect(out.totalMargin).toBeCloseTo(100, 10)
    expect(out.totalMarginRate).toBeCloseTo(100 / 900, 10)
  })

  it('제거 대상 + R null: 총마진액/총마진율 null', () => {
    const out = applyCommissionClearing(baseProfit, {
      brandName: '다른브랜드',
      salesChannel: '토스',
      isComposite: null,
      R: null,
      L: 900,
      extraSettlement: 50,
    })
    expect(out.totalMargin).toBeNull()
    expect(out.totalMarginRate).toBeNull()
  })

  it('제거 대상 + L=0: 총마진액은 계산되지만 총마진율 null', () => {
    const out = applyCommissionClearing(baseProfit, {
      brandName: '다른브랜드',
      salesChannel: '토스',
      isComposite: null,
      R: 100,
      L: 0,
      extraSettlement: 50,
    })
    expect(out.totalMargin).toBeCloseTo(150, 10)
    expect(out.totalMarginRate).toBeNull()
  })
})

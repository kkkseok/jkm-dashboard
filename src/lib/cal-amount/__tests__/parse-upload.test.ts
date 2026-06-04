import { describe, expect, it } from 'vitest'
import { parseCalAmountRows } from '../parse-upload'

/**
 * cal_amount 대량 업로드 파싱 단위 테스트.
 * header:1 로 파싱된 2차원 배열을 직접 넣어 검증 로직만 확인한다.
 * (allRows[0] = 헤더 행, allRows[1..] = 데이터)
 */
describe('parseCalAmountRows', () => {
  it('정상 행을 엑셀 원본 순서로 파싱한다', () => {
    const rows: unknown[][] = [
      ['상품코드', '후정산금'],
      ['P-0001', 1500],
      ['P-0002', -300],
      ['P-0003', 900],
    ]
    const { valid, skipped, totalDataRows } = parseCalAmountRows(rows)
    expect(valid).toEqual([
      { productCode: 'P-0001', extraSettlement: 1500 },
      { productCode: 'P-0002', extraSettlement: -300 },
      { productCode: 'P-0003', extraSettlement: 900 },
    ])
    expect(skipped).toHaveLength(0)
    expect(totalDataRows).toBe(3)
  })

  it('상품코드가 비면 스킵하고 1-based 엑셀 행 번호로 보고한다', () => {
    const rows: unknown[][] = [
      ['상품코드', '후정산금'],
      ['P-0001', 100],
      [null, 200], // 엑셀 3행
      ['  ', 300], // 공백만 → 비어있음 취급, 엑셀 4행
    ]
    const { valid, skipped } = parseCalAmountRows(rows)
    expect(valid).toEqual([{ productCode: 'P-0001', extraSettlement: 100 }])
    expect(skipped).toEqual([
      { row: 3, reason: '상품코드 비어있음' },
      { row: 4, reason: '상품코드 비어있음' },
    ])
  })

  it('후정산금이 숫자가 아니면 스킵한다', () => {
    const rows: unknown[][] = [
      ['상품코드', '후정산금'],
      ['P-0001', 'abc'], // 엑셀 2행
      ['P-0002', null], // 엑셀 3행
    ]
    const { valid, skipped } = parseCalAmountRows(rows)
    expect(valid).toHaveLength(0)
    expect(skipped).toEqual([
      { row: 2, reason: '후정산금 파싱 실패' },
      { row: 3, reason: '후정산금 파싱 실패' },
    ])
  })

  it('콤마 표기 숫자("1,000")와 소수는 정수로 처리한다', () => {
    const rows: unknown[][] = [
      ['상품코드', '후정산금'],
      ['P-0001', '1,000'],
      ['P-0002', 1234.9], // trunc → 1234
    ]
    const { valid } = parseCalAmountRows(rows)
    expect(valid).toEqual([
      { productCode: 'P-0001', extraSettlement: 1000 },
      { productCode: 'P-0002', extraSettlement: 1234 },
    ])
  })

  it('완전 빈 행은 보고 없이 무시한다', () => {
    const rows: unknown[][] = [
      ['상품코드', '후정산금'],
      ['P-0001', 100],
      [null, null], // 완전 빈 행
      ['', ''],
      ['P-0002', 200],
    ]
    const { valid, skipped, totalDataRows } = parseCalAmountRows(rows)
    expect(valid).toHaveLength(2)
    expect(skipped).toHaveLength(0)
    expect(totalDataRows).toBe(2)
  })

  it('헤더만 있으면 빈 결과를 반환한다', () => {
    const rows: unknown[][] = [['상품코드', '후정산금']]
    const { valid, skipped, totalDataRows } = parseCalAmountRows(rows)
    expect(valid).toHaveLength(0)
    expect(skipped).toHaveLength(0)
    expect(totalDataRows).toBe(0)
  })

  it('숫자형 상품코드도 문자열로 변환해 받는다', () => {
    const rows: unknown[][] = [
      ['상품코드', '후정산금'],
      [123456, 500],
    ]
    const { valid } = parseCalAmountRows(rows)
    expect(valid).toEqual([{ productCode: '123456', extraSettlement: 500 }])
  })
})

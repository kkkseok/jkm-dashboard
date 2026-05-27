/**
 * `parseProductsXlsx` 단위 테스트 (v1.2 Wide format, 2026-05-27).
 *
 * 헤더:
 *   - 고정 4컬럼: `사방넷코드 / 브랜드명 / 상품명 / 구분`
 *   - 그 외 모든 컬럼은 채널명 (가변, 헤더 텍스트 = channel_name)
 *
 * 검증 케이스:
 *   1. 정상 — 한 사방넷 → 여러 채널, wide → long 풀린 결과
 *   2. 헤더 4 고정 누락 → header_missing
 *   3. 채널 컬럼 0개 → no_channel_column (신규 kind)
 *   4. 빈 채널 칸 → 그 채널은 스킵 (오류 아님)
 *   5. "구분" 값 != 단품/복합 → invalid_type_value (행 전체 제외)
 *   6. 같은 사방넷이 두 행 → 둘 다 처리되지만 (sabangnet, channel) 페어 중복은 duplicate_in_file
 *   7. productCode 형식 위반 → format_violation (그 채널만 제외)
 *   8. detectedChannels 가 헤더 등장 순서를 보존
 *   9. 합계행/빈 행 자동 제외 + 행 번호 유지
 *  10. 필수 4고정 필드 빈 칸 → required_field
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseProductsXlsx } from '../parse'

function makeBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 표준 4 고정 헤더 + 3 채널 헤더 (v1.2 wide format) */
const HEADER = ['사방넷코드', '브랜드명', '상품명', '구분', 'GSshop', '쿠팡', '오늘의집']

describe('parseProductsXlsx (wide format)', () => {
  it('정상: 한 사방넷 → 여러 채널 (wide → long 풀린 결과)', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001', 'CP-001', ''],
      ['SBG-1002', '글리치', '세트A', '복합', '', 'CP-002', 'OH-002'],
    ])
    const { rows, errors, detectedChannels } = await parseProductsXlsx(buf)
    expect(errors).toEqual([])
    expect(detectedChannels).toEqual(['GSshop', '쿠팡', '오늘의집'])

    // SBG-1001 → GSshop / 쿠팡 (오늘의집 빈칸 스킵) = 2행
    // SBG-1002 → 쿠팡 / 오늘의집 (GSshop 빈칸 스킵) = 2행
    expect(rows).toHaveLength(4)

    expect(rows[0]).toEqual({
      excelRowIndex: 2,
      sabangnetCode: 'SBG-1001',
      brandName: '글리치',
      channelName: 'GSshop',
      productCode: 'GS-001',
      productName: '워시팩',
      isComposite: false,
    })
    expect(rows[1]).toEqual({
      excelRowIndex: 2,
      sabangnetCode: 'SBG-1001',
      brandName: '글리치',
      channelName: '쿠팡',
      productCode: 'CP-001',
      productName: '워시팩',
      isComposite: false,
    })
    expect(rows[2].channelName).toBe('쿠팡')
    expect(rows[2].sabangnetCode).toBe('SBG-1002')
    expect(rows[2].isComposite).toBe(true)
    expect(rows[3].channelName).toBe('오늘의집')
    expect(rows[3].productCode).toBe('OH-002')
  })

  it('헤더 4 고정 누락 (구분 빠짐) → header_missing', async () => {
    const buf = makeBuffer([
      ['사방넷코드', '브랜드명', '상품명', 'GSshop', '쿠팡'], // 구분 누락
      ['SBG-1001', '글리치', '워시팩', 'GS-001', 'CP-001'],
    ])
    const { rows, errors, detectedChannels } = await parseProductsXlsx(buf)
    expect(rows).toEqual([])
    expect(detectedChannels).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('header_missing')
    expect(errors[0].message).toContain('구분')
  })

  it('헤더 4 고정 누락 (사방넷코드 빠짐) → header_missing', async () => {
    const buf = makeBuffer([
      ['브랜드명', '상품명', '구분', 'GSshop'], // 사방넷코드 누락
      ['글리치', '워시팩', '단품', 'GS-001'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('header_missing')
    expect(errors[0].message).toContain('사방넷코드')
  })

  it('채널 컬럼 0개 → no_channel_column', async () => {
    const buf = makeBuffer([
      ['사방넷코드', '브랜드명', '상품명', '구분'], // 채널 헤더 0개
      ['SBG-1001', '글리치', '워시팩', '단품'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('no_channel_column')
  })

  it('빈 채널 칸은 스킵 (오류 아님)', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001', '', ''], // GSshop 만 채워짐
      ['SBG-1002', '글리치', '세트A', '복합', null, 'CP-002', null], // 쿠팡 만
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0].channelName).toBe('GSshop')
    expect(rows[0].productCode).toBe('GS-001')
    expect(rows[1].channelName).toBe('쿠팡')
    expect(rows[1].productCode).toBe('CP-002')
  })

  it('"구분" 값 != 단품/복합 → invalid_type_value (행 전체 제외)', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001', 'CP-001', ''], // 정상 (2행)
      ['SBG-1002', '글리치', '세트', 'single', 'GS-002', '', ''], // ✗ 영문 → 행 전체 제외
      ['SBG-1003', '글리치', '세트2', '단 품', '', 'CP-003', ''], // ✗ 공백 → 행 전체 제외
      ['SBG-1004', '글리치', '복합세트', '복합', '', '', 'OH-004'], // 정상 (5행)
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    // 정상 행만 통과 (SBG-1001 2개 채널 + SBG-1004 1개 채널 = 3개 long row)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.sabangnetCode)).toEqual([
      'SBG-1001',
      'SBG-1001',
      'SBG-1004',
    ])
    const typeErrors = errors.filter((e) => e.kind === 'invalid_type_value')
    expect(typeErrors).toHaveLength(2)
    expect(typeErrors[0].excelRowIndex).toBe(3)
    expect(typeErrors[0].field).toBe('isComposite')
    expect(typeErrors[0].message).toContain('"single"')
    expect(typeErrors[1].excelRowIndex).toBe(4)
    expect(typeErrors[1].message).toContain('"단 품"')
  })

  it('같은 사방넷이 두 행 → 둘 다 처리 / (sabangnet, channel) 페어 중복은 duplicate_in_file', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001', '', ''], // 첫 등장: SBG-1001 + GSshop
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001-DUP', 'CP-001', ''], // GSshop 중복 (4행이 아니고 3행)
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    // 두 행 모두 처리되되, (SBG-1001, GSshop) 페어 두 번째는 제외
    expect(rows.map((r) => `${r.sabangnetCode}|${r.channelName}`)).toEqual([
      'SBG-1001|GSshop',
      'SBG-1001|쿠팡',
    ])
    const dups = errors.filter((e) => e.kind === 'duplicate_in_file')
    expect(dups).toHaveLength(1)
    expect(dups[0].excelRowIndex).toBe(3)
    expect(dups[0].field).toBe('channelName')
    expect(dups[0].message).toContain('SBG-1001')
    expect(dups[0].message).toContain('GSshop')
  })

  it('productCode 형식 위반 → format_violation (그 채널만 제외, 다른 채널은 통과)', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS 001', 'CP-001', ''], // GSshop 공백 포함 → format_violation
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    // 쿠팡만 통과
    expect(rows).toHaveLength(1)
    expect(rows[0].channelName).toBe('쿠팡')
    expect(rows[0].productCode).toBe('CP-001')
    const fmt = errors.filter((e) => e.kind === 'format_violation')
    expect(fmt).toHaveLength(1)
    expect(fmt[0].excelRowIndex).toBe(2)
    expect(fmt[0].field).toBe('productCode')
    expect(fmt[0].message).toContain('GSshop')
  })

  it('detectedChannels 가 헤더 등장 순서를 보존', async () => {
    const buf = makeBuffer([
      ['사방넷코드', '브랜드명', 'CJ온스타일', '상품명', 'GSshop', '구분', '쿠팡'],
      ['SBG-1001', '글리치', '', '워시팩', '', '단품', 'CP-001'],
    ])
    const { detectedChannels } = await parseProductsXlsx(buf)
    expect(detectedChannels).toEqual(['CJ온스타일', 'GSshop', '쿠팡'])
  })

  it('빈 행 / 합계행 자동 제외 + 행 번호 보존', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001', '', ''],
      [null, null, null, null, null, null, null], // 빈 행
      ['', '', '', '', '', '', ''], // 또 다른 빈 행
      ['SBG-1002', '글리치', '세트', '복합', '', 'CP-002', ''],
      ['총계', null, null, null, null, null, null], // 합계 행
      ['합계', '-', '-', '단품', '-', '-', '-'], // 합계 행 (값 있어도 키워드면 제외)
      ['SBG-1003', '글리치', '세트2', '단품', '', '', 'OH-003'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.excelRowIndex)).toEqual([2, 5, 8])
    expect(rows.map((r) => r.sabangnetCode)).toEqual([
      'SBG-1001',
      'SBG-1002',
      'SBG-1003',
    ])
  })

  it('필수 4고정 필드 빈 칸 → required_field', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SBG-1001', '글리치', '워시팩', '단품', 'GS-001', '', ''], // 정상
      ['', '글리치', '세트', '복합', '', 'CP-002', ''], // 사방넷코드 빈 칸
      ['SBG-1003', '글리치', '', '단품', '', '', 'OH-003'], // 상품명 빈 칸
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].sabangnetCode).toBe('SBG-1001')
    const reqErrors = errors.filter((e) => e.kind === 'required_field')
    expect(reqErrors.length).toBeGreaterThanOrEqual(2)
    const fields = new Set(reqErrors.map((e) => e.field))
    expect(fields.has('sabangnetCode')).toBe(true)
    expect(fields.has('productName')).toBe(true)
  })
})

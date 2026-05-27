/**
 * `parseProductsXlsx` 단위 테스트.
 *
 * 케이스:
 *   1. 정상 케이스 (3행, "단품"/"복합" 섞임) — errors 비어있음
 *   2. 헤더 누락 → header_missing 에러
 *   3. "구분" 값이 "단품"/"복합" 외 → invalid_type_value + 해당 행 index 명시
 *   4. 빈 행 / 합계행 자동 제외
 *   5. 파일 내 productCode 중복 → duplicate_in_file
 *   6. 모든 행 정상 시 errors=[]
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseProductsXlsx } from '../parse'

/**
 * 행 배열에서 xlsx ArrayBuffer 를 만든다. (minus 테스트와 동일 패턴)
 */
function makeBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 표준 헤더 행 (사용자 확정 5컬럼) */
const HEADER = ['상품코드', '채널명', '브랜드명', '상품명', '구분']

describe('parseProductsXlsx', () => {
  it('정상 케이스: 3행 (단품/복합 섞임) → rows 3, errors 0', async () => {
    const buf = makeBuffer([
      HEADER,
      ['ABC-001', 'A-CJ온스타일', '글리치', '워시팩', '단품'],
      ['ABC-002', 'A-쿠팡', '글리치', '세트A', '복합'],
      ['XYZ_555', '[B2B]', '모브', '콤보2', '복합'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      excelRowIndex: 2,
      productCode: 'ABC-001',
      channelName: 'A-CJ온스타일',
      brandName: '글리치',
      productName: '워시팩',
      isComposite: false,
    })
    expect(rows[1].isComposite).toBe(true)
    expect(rows[2].productCode).toBe('XYZ_555')
    expect(rows[2].isComposite).toBe(true)
  })

  it('헤더 누락 (구분 컬럼 빠짐) → header_missing 에러 + rows=[]', async () => {
    const buf = makeBuffer([
      ['상품코드', '채널명', '브랜드명', '상품명'], // 구분 누락
      ['ABC-001', 'A-CJ', '글리치', '워시팩'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('header_missing')
    expect(errors[0].excelRowIndex).toBe(1)
    expect(errors[0].message).toContain('구분')
  })

  it('"구분" 값이 "단품"/"복합" 외 → invalid_type_value + 해당 행 index', async () => {
    const buf = makeBuffer([
      HEADER,
      ['ABC-001', 'A-CJ', '글리치', '워시팩', '단품'], // 정상
      ['ABC-002', 'A-CJ', '글리치', '세트', 'single'], // ✗ 영문
      ['ABC-003', 'A-CJ', '글리치', '세트', '단 품'], // ✗ 공백
      ['ABC-004', 'A-CJ', '글리치', '세트', '복합'], // 정상
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    // 정상 2건만 통과
    expect(rows).toHaveLength(2)
    expect(rows[0].productCode).toBe('ABC-001')
    expect(rows[1].productCode).toBe('ABC-004')
    // 에러 2건 — ABC-002(3행), ABC-003(4행)
    const typeErrors = errors.filter((e) => e.kind === 'invalid_type_value')
    expect(typeErrors).toHaveLength(2)
    expect(typeErrors[0].excelRowIndex).toBe(3)
    expect(typeErrors[0].field).toBe('isComposite')
    expect(typeErrors[0].message).toContain('"single"')
    expect(typeErrors[1].excelRowIndex).toBe(4)
    expect(typeErrors[1].message).toContain('"단 품"')
  })

  it('빈 행 / 합계행 자동 제외', async () => {
    const buf = makeBuffer([
      HEADER,
      ['ABC-001', 'A-CJ', '글리치', '워시팩', '단품'],
      [null, null, null, null, null], // 빈 행
      ['', '', '', '', ''], // 또 다른 빈 행
      ['ABC-002', 'A-쿠팡', '글리치', '세트', '복합'],
      ['총계', null, null, null, null], // 합계 행
      ['합계', '-', '-', '-', '단품'], // 합계 행 (값 채워져 있어도 A열 키워드면 제외)
      ['ABC-003', 'A-CJ', '글리치', '세트2', '단품'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    // 행 번호는 실제 엑셀 위치를 따라간다 (헤더 1, 데이터 시작 2)
    expect(rows[0].excelRowIndex).toBe(2)
    expect(rows[1].excelRowIndex).toBe(5)
    expect(rows[2].excelRowIndex).toBe(8)
    expect(rows.map((r) => r.productCode)).toEqual([
      'ABC-001',
      'ABC-002',
      'ABC-003',
    ])
  })

  it('파일 내 productCode 중복 → duplicate_in_file, 첫 등장만 채택', async () => {
    const buf = makeBuffer([
      HEADER,
      ['ABC-001', 'A-CJ', '글리치', '워시팩', '단품'], // 첫 등장 (2행)
      ['ABC-002', 'A-쿠팡', '글리치', '세트', '복합'],
      ['ABC-001', 'A-쿠팡', '글리치', '워시팩2', '복합'], // 중복 (4행) → 제외
      ['ABC-003', 'A-CJ', '글리치', '세트2', '단품'],
      ['ABC-001', 'B-네이버', '글리치', '워시팩3', '단품'], // 또 중복 (6행)
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.productCode)).toEqual([
      'ABC-001',
      'ABC-002',
      'ABC-003',
    ])
    const dups = errors.filter((e) => e.kind === 'duplicate_in_file')
    expect(dups).toHaveLength(2)
    expect(dups[0].excelRowIndex).toBe(4)
    expect(dups[0].message).toContain('"ABC-001"')
    expect(dups[0].message).toContain('첫 등장은 2행')
    expect(dups[1].excelRowIndex).toBe(6)
    expect(dups[1].message).toContain('첫 등장은 2행')
  })

  it('모든 행 정상 시 errors=[] (다양한 채널/브랜드, 한글/영문 productCode)', async () => {
    const buf = makeBuffer([
      HEADER,
      ['SKU_001', 'A-CJ온스타일(jkman2)', '글리치', '워시팩 v1', '단품'],
      ['SKU-002', 'B-네이버스토어', '모브', '세트A', '복합'],
      ['ABC123', '[B2B]', '글리치', '오일클렌저', '단품'],
      ['XYZ-999_v2', 'C-쿠팡', '에이브', '콤보2 (대용량)', '복합'],
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(4)
    // 모든 행 isComposite 정확히 매핑
    expect(rows.map((r) => r.isComposite)).toEqual([false, true, false, true])
  })

  // 보너스: 필수 필드 빈칸 검증
  it('필수 필드 빈칸 → required_field 에러, 정상 행은 통과', async () => {
    const buf = makeBuffer([
      HEADER,
      ['ABC-001', 'A-CJ', '글리치', '워시팩', '단품'], // 정상
      ['', 'A-쿠팡', '글리치', '세트', '복합'], // 상품코드 빈칸
      ['ABC-003', null, '글리치', '세트', '단품'], // 채널명 빈칸
    ])
    const { rows, errors } = await parseProductsXlsx(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0].productCode).toBe('ABC-001')
    const reqErrors = errors.filter((e) => e.kind === 'required_field')
    expect(reqErrors).toHaveLength(2)
    expect(reqErrors[0].excelRowIndex).toBe(3)
    expect(reqErrors[0].field).toBe('productCode')
    expect(reqErrors[1].excelRowIndex).toBe(4)
    expect(reqErrors[1].field).toBe('channelName')
  })
})

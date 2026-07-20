/**
 * parseProductMasterRaw — 묶음 매입가 수식 분해 회귀 테스트.
 *
 * 핵심 회귀: 마스터가 ×1 묶음엔 `*1` 을 생략하고 행을 그냥 더한다
 * (예: x1 변형 `(BH7+BH8)` vs x2 변형 `(BH7*2)+(BH8*2)`).
 * 예전 정규식은 `*수량` 을 강제해 bare-sum 형태를 0개로 보고
 * 묶음 내품을 통째로 누락했다(product_master_0630 에서 12건). qty 생략 = 1 로 처리한다.
 *
 * 수식 컬럼 letter 는 mapping 의 cols.bundleFormula 에서 파생해 픽스처를 만든다
 * (2026-07 채널 추가로 BG→BH 밀린 것처럼 letter 는 계속 바뀔 수 있다).
 *
 * 인메모리 평문 xlsx(PK) 버퍼로 검증한다 — decryptIfNeeded 는 CFB 가 아니면 그대로 통과.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { colToIdx } from '@/lib/minus/parse'
import { PRODUCT_MASTER_HEADER_GUARD, PRODUCT_MASTER_RAW as PM } from '../mapping'
import { parseProductMasterRaw } from '../parse'

const C = PM.cols
/** 수식 컬럼 letter (현재 BH) — 픽스처 수식 문자열에 사용. */
const F = C.bundleFormula
/** 가장 오른쪽 매핑 컬럼(구성, 현재 BI)까지 포함하는 충분한 폭. */
const WIDTH = colToIdx(C.quantity) + 2

type Cell = string | number | null

/** 지정 컬럼 letter 에 값을 채운 한 행(길이 WIDTH) 생성. */
function makeRow(values: Record<string, Cell>): Cell[] {
  const row: Cell[] = new Array(WIDTH).fill(null)
  for (const [letter, v] of Object.entries(values)) {
    row[colToIdx(letter)] = v
  }
  return row
}

/**
 * AOA + 수식맵으로 평문 xlsx 버퍼 생성.
 * formulas 키 = Excel 행 번호(1-based), 값 = 수식 컬럼(cols.bundleFormula) 셀의 .f.
 */
function buildMasterBuffer(
  aoa: Cell[][],
  formulas: Record<number, string>,
): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // 수식/구성 컬럼이 range 밖으로 잘리지 않도록 폭을 명시.
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: aoa.length - 1, c: WIDTH - 1 },
  })
  for (const [excelRow, f] of Object.entries(formulas)) {
    ws[`${C.bundleFormula}${excelRow}`] = { t: 'n', v: 0, f }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 헤더 가드를 통과하는 헤더 행 (레이아웃 검증 대상 컬럼에 기대 텍스트). */
function guardHeaderRow(): Cell[] {
  return makeRow(
    Object.fromEntries(PRODUCT_MASTER_HEADER_GUARD.map((g) => [g.col, g.expect])),
  )
}

/**
 * 표준 픽스처 (F = cols.bundleFormula letter):
 *   excel 7~9 : 단품 내품 A1/B1/C1
 *   excel 10  : x1 묶음(2001) — `F7+F8`            (※ *수량 생략 = 회귀 케이스)
 *   excel 11  : x2 묶음(2002) — `(F7*2)+(F8*2)`    (기존 동작 보존)
 *   excel 12  : 혼합 묶음(2003) — `(F7)+(F9*3)`     (생략/명시 혼재)
 *   excel 13  : 깨진 수식(2004) — `100+200`         (수식 컬럼 참조 없음 → 진짜 실패)
 */
function buildFixture() {
  const aoa: Cell[][] = []
  for (let i = 0; i < PM.dataStart; i++) aoa.push(new Array(WIDTH).fill(null))
  aoa[PM.headerRow] = guardHeaderRow()
  // 내품(단품)
  aoa.push(makeRow({ [C.sabangnetCode]: '1001', [C.productName]: '내품A', [C.selfCode]: 'A1', [C.type]: '단품' })) // excel 7
  aoa.push(makeRow({ [C.sabangnetCode]: '1002', [C.productName]: '내품B', [C.selfCode]: 'B1', [C.type]: '단품' })) // excel 8
  aoa.push(makeRow({ [C.sabangnetCode]: '1003', [C.productName]: '내품C', [C.selfCode]: 'C1', [C.type]: '단품' })) // excel 9
  // 묶음(복합)
  aoa.push(makeRow({ [C.sabangnetCode]: '2001', [C.productName]: '묶음x1', [C.selfCode]: '★A1_B1', [C.type]: '복합', [C.quantity]: 1 })) // excel 10
  aoa.push(makeRow({ [C.sabangnetCode]: '2002', [C.productName]: '묶음x2', [C.selfCode]: '★A1_B1', [C.type]: '복합', [C.quantity]: 1 })) // excel 11
  aoa.push(makeRow({ [C.sabangnetCode]: '2003', [C.productName]: '묶음혼합', [C.selfCode]: '★A1_C1', [C.type]: '복합', [C.quantity]: 1 })) // excel 12
  aoa.push(makeRow({ [C.sabangnetCode]: '2004', [C.productName]: '묶음깨짐', [C.selfCode]: '★X_Y', [C.type]: '복합', [C.quantity]: 1 })) // excel 13

  const formulas: Record<number, string> = {
    10: `${F}7+${F}8`,
    11: `(${F}7*2)+(${F}8*2)`,
    12: `(${F}7)+(${F}9*3)`,
    13: '100+200',
  }
  return buildMasterBuffer(aoa, formulas)
}

describe('parseProductMasterRaw — 묶음 매입가 수식 분해', () => {
  it('×1 묶음(*수량 생략)을 내품 수량 1 로 분해한다 (회귀)', async () => {
    const res = await parseProductMasterRaw(buildFixture())
    const bare = res.bundleRows.filter((r) => r.bundleSabangnetCode === '2001')
    expect(bare).toEqual([
      { bundleSabangnetCode: '2001', seq: 1, componentSelfCode: 'A1', quantity: 1 },
      { bundleSabangnetCode: '2001', seq: 2, componentSelfCode: 'B1', quantity: 1 },
    ])
  })

  it('×N 묶음의 수량(*N)을 그대로 보존한다', async () => {
    const res = await parseProductMasterRaw(buildFixture())
    const x2 = res.bundleRows.filter((r) => r.bundleSabangnetCode === '2002')
    expect(x2).toEqual([
      { bundleSabangnetCode: '2002', seq: 1, componentSelfCode: 'A1', quantity: 2 },
      { bundleSabangnetCode: '2002', seq: 2, componentSelfCode: 'B1', quantity: 2 },
    ])
  })

  it('생략/명시가 혼재된 수식을 항목별로 올바르게 분해한다', async () => {
    const res = await parseProductMasterRaw(buildFixture())
    const mix = res.bundleRows.filter((r) => r.bundleSabangnetCode === '2003')
    expect(mix).toEqual([
      { bundleSabangnetCode: '2003', seq: 1, componentSelfCode: 'A1', quantity: 1 },
      { bundleSabangnetCode: '2003', seq: 2, componentSelfCode: 'C1', quantity: 3 },
    ])
  })

  it('수식 컬럼 참조가 전혀 없는 진짜 깨진 수식만 실패로 카운트한다', async () => {
    const res = await parseProductMasterRaw(buildFixture())
    expect(res.bundleRows.some((r) => r.bundleSabangnetCode === '2004')).toBe(false)
    expect(res.stats.bundleFormulaFailCount).toBe(1)
    expect(
      res.warnings.some((w) => w.startsWith('[묶음 수식 해석 실패] ')),
    ).toBe(true)
  })

  it('정상 분해된 묶음/내품 수 집계가 맞다', async () => {
    const res = await parseProductMasterRaw(buildFixture())
    expect(res.stats.bundleCount).toBe(3) // 2001, 2002, 2003 (2004 제외)
    expect(res.stats.bundleItemCount).toBe(6) // 2+2+2
  })
})

describe('parseProductMasterRaw — 레이아웃 가드', () => {
  it('컬럼이 밀린 다른 버전 파일(가드 헤더 불일치)은 명확한 에러로 차단한다', async () => {
    // 구버전(0630 이전) 레이아웃 흉내: 가드 대상 컬럼들이 한 칸 왼쪽에 있음.
    const aoa: Cell[][] = []
    for (let i = 0; i < PM.dataStart; i++) aoa.push(new Array(WIDTH).fill(null))
    aoa[PM.headerRow] = makeRow(
      Object.fromEntries(
        PRODUCT_MASTER_HEADER_GUARD.map((g) => [
          XLSX.utils.encode_col(colToIdx(g.col) - 1),
          g.expect,
        ]),
      ),
    )
    aoa.push(makeRow({ [C.sabangnetCode]: '1001' }))
    await expect(parseProductMasterRaw(buildMasterBuffer(aoa, {}))).rejects.toThrow(
      '상품 마스터 컬럼 레이아웃이 예상과 다릅니다',
    )
  })

  it('가드 헤더가 맞으면 통과한다', async () => {
    await expect(parseProductMasterRaw(buildFixture())).resolves.toBeTruthy()
  })
})

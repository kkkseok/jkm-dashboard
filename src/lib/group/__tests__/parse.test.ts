/**
 * parseProductMasterRaw — 묶음 BG 수식 분해 회귀 테스트.
 *
 * 핵심 회귀: 마스터가 ×1 묶음엔 `*1` 을 생략하고 행을 그냥 더한다
 * (예: x1 변형 `(BG7+BG8)` vs x2 변형 `(BG7*2)+(BG8*2)`).
 * 예전 정규식 `/BG(\d+)\*(\d+)/g` 은 `*수량` 을 강제해 bare-sum 형태를 0개로 보고
 * 묶음 내품을 통째로 누락했다(product_master_0630 에서 12건). qty 생략 = 1 로 처리한다.
 *
 * 인메모리 평문 xlsx(PK) 버퍼로 검증한다 — decryptIfNeeded 는 CFB 가 아니면 그대로 통과.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { colToIdx } from '@/lib/minus/parse'
import { PRODUCT_MASTER_RAW as PM } from '../mapping'
import { parseProductMasterRaw } from '../parse'

const C = PM.cols
const WIDTH = 60 // BH(idx 59) 까지 포함하는 충분한 폭

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
 * AOA + BG 수식맵으로 평문 xlsx 버퍼 생성.
 * bgFormulas 키 = Excel 행 번호(1-based), 값 = BG 셀의 .f 수식.
 */
function buildMasterBuffer(
  aoa: Cell[][],
  bgFormulas: Record<number, string>,
): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // BG/BH 가 range 밖으로 잘리지 않도록 폭을 명시.
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: aoa.length - 1, c: WIDTH - 1 },
  })
  for (const [excelRow, f] of Object.entries(bgFormulas)) {
    ws[`${C.bundleFormula}${excelRow}`] = { t: 'n', v: 0, f }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/**
 * 표준 픽스처:
 *   excel 7~9 : 단품 내품 A1/B1/C1
 *   excel 10  : x1 묶음(2001) — `BG7+BG8`            (※ *수량 생략 = 회귀 케이스)
 *   excel 11  : x2 묶음(2002) — `(BG7*2)+(BG8*2)`    (기존 동작 보존)
 *   excel 12  : 혼합 묶음(2003) — `(BG7)+(BG9*3)`     (생략/명시 혼재)
 *   excel 13  : 깨진 수식(2004) — `100+200`           (BG 참조 없음 → 진짜 실패)
 */
function buildFixture() {
  const aoa: Cell[][] = []
  for (let i = 0; i < PM.dataStart; i++) aoa.push(new Array(WIDTH).fill(null))
  // 내품(단품)
  aoa.push(makeRow({ [C.sabangnetCode]: '1001', [C.productName]: '내품A', [C.selfCode]: 'A1', [C.type]: '단품' })) // excel 7
  aoa.push(makeRow({ [C.sabangnetCode]: '1002', [C.productName]: '내품B', [C.selfCode]: 'B1', [C.type]: '단품' })) // excel 8
  aoa.push(makeRow({ [C.sabangnetCode]: '1003', [C.productName]: '내품C', [C.selfCode]: 'C1', [C.type]: '단품' })) // excel 9
  // 묶음(복합)
  aoa.push(makeRow({ [C.sabangnetCode]: '2001', [C.productName]: '묶음x1', [C.selfCode]: '★A1_B1', [C.type]: '복합', [C.quantity]: 1 })) // excel 10
  aoa.push(makeRow({ [C.sabangnetCode]: '2002', [C.productName]: '묶음x2', [C.selfCode]: '★A1_B1', [C.type]: '복합', [C.quantity]: 1 })) // excel 11
  aoa.push(makeRow({ [C.sabangnetCode]: '2003', [C.productName]: '묶음혼합', [C.selfCode]: '★A1_C1', [C.type]: '복합', [C.quantity]: 1 })) // excel 12
  aoa.push(makeRow({ [C.sabangnetCode]: '2004', [C.productName]: '묶음깨짐', [C.selfCode]: '★X_Y', [C.type]: '복합', [C.quantity]: 1 })) // excel 13

  const bgFormulas: Record<number, string> = {
    10: 'BG7+BG8',
    11: '(BG7*2)+(BG8*2)',
    12: '(BG7)+(BG9*3)',
    13: '100+200',
  }
  return buildMasterBuffer(aoa, bgFormulas)
}

describe('parseProductMasterRaw — 묶음 BG 수식 분해', () => {
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

  it('BG 참조가 전혀 없는 진짜 깨진 수식만 실패로 카운트한다', async () => {
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

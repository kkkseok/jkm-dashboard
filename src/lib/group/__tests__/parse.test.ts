/**
 * parseProductMasterRaw — 헤더 이름 기반 레이아웃 탐지 + 묶음 매입가 수식 분해 회귀 테스트.
 *
 * 레이아웃: 마스터는 채널 신설·월 매입가 추가·헤더 행 이동이 계속 일어나(2607 트러스테이,
 * 261001 홈앤쇼핑·서브원 + 헤더 4행→5행) letter 대신 헤더 텍스트로 위치를 찾는다.
 * 픽스처는 서로 다른 두 레이아웃(구버전형/신버전형)으로 같은 결과가 나오는지 검증한다.
 *
 * 묶음 회귀: 마스터가 ×1 묶음엔 `*1` 을 생략하고 행을 그냥 더한다
 * (예: x1 변형 `(BH7+BH8)` vs x2 변형 `(BH7*2)+(BH8*2)`).
 * 예전 정규식은 `*수량` 을 강제해 bare-sum 형태를 0개로 보고
 * 묶음 내품을 통째로 누락했다(product_master_0630 에서 12건). qty 생략 = 1 로 처리한다.
 *
 * 인메모리 평문 xlsx(PK) 버퍼로 검증한다 — decryptIfNeeded 는 CFB 가 아니면 그대로 통과.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { colToIdx } from '@/lib/minus/parse'
import { parseProductMasterRaw } from '../parse'

type Cell = string | number | null

/** 픽스처 레이아웃 — 헤더 행(0-based)과 각 헤더의 letter. */
type FixtureLayout = {
  headerRow: number
  channels: Record<string, string>
  sabangnetCode: string
  productName: string
  selfCode: string
  type: string
  /** 이전 월 매입가(수식 없음) — 가장 오른쪽 매입가가 선택되는지 확인용. */
  prevPrice: string
  /** 최신 월 매입가 = 묶음 수식 컬럼. */
  price: string
  quantity: string
}

/** 구버전형(2607 유사): 헤더 4행, 채널 2개. */
const OLD: FixtureLayout = {
  headerRow: 3,
  sabangnetCode: 'D',
  channels: { E: 'GSshop (18%)', F: '트러스테이 (공급가)' },
  productName: 'G',
  selfCode: 'H',
  type: 'I',
  prevPrice: 'J',
  price: 'K',
  quantity: 'L',
}

/** 신버전형(261001 유사): 헤더 5행, 채널 4개(홈앤쇼핑·서브원 신설), 컬럼 전부 밀림. */
const NEW: FixtureLayout = {
  headerRow: 4,
  sabangnetCode: 'D',
  channels: {
    E: 'GSshop (18%)',
    F: '홈앤쇼핑 (35%)',
    G: '트러스테이 (공급가)',
    H: '서브원 (공급가)',
  },
  productName: 'J', // I 는 채널명 없는 빈 헤더 칸
  selfCode: 'L',
  type: 'M',
  prevPrice: 'N',
  price: 'O',
  quantity: 'P',
}

const widthOf = (l: FixtureLayout) => colToIdx(l.quantity) + 2

function makeRow(l: FixtureLayout, values: Record<string, Cell>): Cell[] {
  const row: Cell[] = new Array(widthOf(l)).fill(null)
  for (const [letter, v] of Object.entries(values)) row[colToIdx(letter)] = v
  return row
}

function headerRow(l: FixtureLayout): Cell[] {
  return makeRow(l, {
    C: '구분',
    [l.sabangnetCode]: '사방넷 코드',
    ...l.channels,
    [l.productName]: '상품명',
    [l.selfCode]: '자재코드',
    [l.type]: '상품구분',
    [l.prevPrice]: '09월 매입가 (vat+)',
    [l.price]: '10월 매입가\n(vat+)',
    [l.quantity]: '구성',
  })
}

/**
 * AOA + 수식맵으로 평문 xlsx 버퍼 생성.
 * formulas 키 = Excel 행 번호(1-based), 값 = 최신 월 매입가 셀의 .f.
 */
function buildMasterBuffer(
  l: FixtureLayout,
  aoa: Cell[][],
  formulas: Record<number, string>,
): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: aoa.length - 1, c: widthOf(l) - 1 },
  })
  for (const [excelRow, f] of Object.entries(formulas)) {
    ws[`${l.price}${excelRow}`] = { t: 'n', v: 0, f }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'CJ제일제당')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/**
 * 표준 픽스처 (F = 최신 월 매입가 letter). 헤더 아래 빈 보조행 2개 후 데이터:
 *   내품 A1/B1/C1 → 묶음 2001(`F a+F b`, *수량 생략), 2002(`(F a*2)+(F b*2)`),
 *   2003(`(F a)+(F c*3)`), 2004(`100+200` 깨진 수식).
 * 채널 마켓코드는 각 행의 첫/마지막 채널에 채운다.
 */
function buildFixture(l: FixtureLayout) {
  const aoa: Cell[][] = []
  for (let i = 0; i < l.headerRow; i++) aoa.push(makeRow(l, {}))
  aoa.push(headerRow(l))
  aoa.push(makeRow(l, {}), makeRow(l, {})) // 보조 헤더/빈 행
  const chLetters = Object.keys(l.channels)
  const chFirst = chLetters[0]
  const chLast = chLetters[chLetters.length - 1]

  const add = (code: string, name: string, self: string, type: string, qty: number | null) => {
    aoa.push(
      makeRow(l, {
        [l.sabangnetCode]: code,
        [chFirst]: `M${code}`,
        [chLast]: `N${code}`,
        [l.productName]: name,
        [l.selfCode]: self,
        [l.type]: type,
        [l.quantity]: qty,
      }),
    )
    return aoa.length // Excel 행 번호
  }
  const a = add('1001', '내품A', 'A1', '단품', 1)
  const b = add('1002', '내품B', 'B1', '단품', 1)
  const c = add('1003', '내품C', 'C1', '단품', 1)
  const r1 = add('2001', '묶음x1', '★A1_B1', '복합', 1)
  const r2 = add('2002', '묶음x2', '★A1_B1', '복합', 1)
  const r3 = add('2003', '묶음혼합', '★A1_C1', '복합', 1)
  const r4 = add('2004', '묶음깨짐', '★X_Y', '복합', 1)

  const F = l.price
  return buildMasterBuffer(l, aoa, {
    [r1]: `${F}${a}+${F}${b}`,
    [r2]: `(${F}${a}*2)+(${F}${b}*2)`,
    [r3]: `(${F}${a})+(${F}${c}*3)`,
    [r4]: '100+200',
  })
}

describe.each([
  ['구버전형(헤더 4행)', OLD],
  ['신버전형(헤더 5행, 채널 추가)', NEW],
])('parseProductMasterRaw — %s', (_label, L) => {
  it('헤더 이름으로 레이아웃을 탐지한다', async () => {
    const { layout } = await parseProductMasterRaw(buildFixture(L))
    const chLetters = Object.keys(L.channels)
    expect(layout.headerRow).toBe(L.headerRow + 1)
    expect(layout.cols).toEqual({
      sabangnetCode: L.sabangnetCode,
      productName: L.productName,
      selfCode: L.selfCode,
      type: L.type,
      quantity: L.quantity,
      bundleFormula: L.price, // 가장 오른쪽 매입가
    })
    expect(layout.bundleFormulaLabel).toBe('10월 매입가 (vat+)')
    expect(layout.channelRange).toEqual({
      first: chLetters[0],
      last: XLSX.utils.encode_col(colToIdx(L.productName) - 1),
    })
    expect(layout.channelNames).toEqual(Object.values(L.channels))
  })

  it('채널 범위 전체의 마켓코드를 펼친다 (신설 채널 포함)', async () => {
    const res = await parseProductMasterRaw(buildFixture(L))
    const codes = res.marketRows.map((r) => r.marketCode)
    expect(codes).toContain('M1001') // 첫 채널
    expect(codes).toContain('N1001') // 마지막 채널
    expect(res.stats.marketCount).toBe(14) // 7행 × 2채널
    expect(res.marketRows.find((r) => r.marketCode === 'M2001')).toMatchObject({
      sabangnetCode: '2001',
      selfCode: '★A1_B1',
      productName: '묶음x1',
      isComposite: true,
      quantity: 1,
    })
  })

  it('×1 묶음(*수량 생략)을 내품 수량 1 로 분해한다 (회귀)', async () => {
    const res = await parseProductMasterRaw(buildFixture(L))
    expect(res.bundleRows.filter((r) => r.bundleSabangnetCode === '2001')).toEqual([
      { bundleSabangnetCode: '2001', seq: 1, componentSelfCode: 'A1', quantity: 1 },
      { bundleSabangnetCode: '2001', seq: 2, componentSelfCode: 'B1', quantity: 1 },
    ])
  })

  it('×N 묶음의 수량(*N)을 그대로 보존한다', async () => {
    const res = await parseProductMasterRaw(buildFixture(L))
    expect(res.bundleRows.filter((r) => r.bundleSabangnetCode === '2002')).toEqual([
      { bundleSabangnetCode: '2002', seq: 1, componentSelfCode: 'A1', quantity: 2 },
      { bundleSabangnetCode: '2002', seq: 2, componentSelfCode: 'B1', quantity: 2 },
    ])
  })

  it('생략/명시가 혼재된 수식을 항목별로 올바르게 분해한다', async () => {
    const res = await parseProductMasterRaw(buildFixture(L))
    expect(res.bundleRows.filter((r) => r.bundleSabangnetCode === '2003')).toEqual([
      { bundleSabangnetCode: '2003', seq: 1, componentSelfCode: 'A1', quantity: 1 },
      { bundleSabangnetCode: '2003', seq: 2, componentSelfCode: 'C1', quantity: 3 },
    ])
  })

  it('수식 컬럼 참조가 없는 깨진 수식만 실패로 카운트하고 집계가 맞다', async () => {
    const res = await parseProductMasterRaw(buildFixture(L))
    expect(res.bundleRows.some((r) => r.bundleSabangnetCode === '2004')).toBe(false)
    expect(res.stats.bundleFormulaFailCount).toBe(1)
    expect(res.warnings.some((w) => w.startsWith('[묶음 수식 해석 실패] '))).toBe(true)
    expect(res.stats.bundleCount).toBe(3)
    expect(res.stats.bundleItemCount).toBe(6)
  })
})

describe('parseProductMasterRaw — 헤더 탐지 실패', () => {
  /** 헤더 행만 있는 시트 버퍼. override 로 특정 letter 의 헤더를 바꾼다. */
  function headerOnly(override: Record<string, Cell>): ArrayBuffer {
    const aoa: Cell[][] = []
    for (let i = 0; i < NEW.headerRow; i++) aoa.push(makeRow(NEW, {}))
    const hr = headerRow(NEW)
    for (const [letter, v] of Object.entries(override)) hr[colToIdx(letter)] = v
    aoa.push(hr)
    aoa.push(makeRow(NEW, { [NEW.sabangnetCode]: '1001', [NEW.productName]: 'x' }))
    return buildMasterBuffer(NEW, aoa, {})
  }

  it('사방넷 코드 헤더가 없으면 명확한 에러로 차단한다', async () => {
    await expect(
      parseProductMasterRaw(headerOnly({ [NEW.sabangnetCode]: '코드' })),
    ).rejects.toThrow('상품 마스터 헤더를 찾을 수 없습니다')
  })

  it('필수 헤더가 바뀌면 어떤 헤더가 없는지 알려준다', async () => {
    await expect(
      parseProductMasterRaw(headerOnly({ [NEW.productName]: '품명', [NEW.quantity]: null })),
    ).rejects.toThrow('"상품명", "구성" 헤더를 찾을 수 없습니다')
  })

  it('월 매입가 헤더가 없으면 차단한다', async () => {
    await expect(
      parseProductMasterRaw(headerOnly({ [NEW.prevPrice]: null, [NEW.price]: '매입가' })),
    ).rejects.toThrow('"NN월 매입가"')
  })

  it('헤더의 공백 차이(사방넷코드 / 상품 구분)는 허용한다', async () => {
    await expect(
      parseProductMasterRaw(
        headerOnly({ [NEW.sabangnetCode]: '사방넷코드', [NEW.type]: '상품 구분' }),
      ),
    ).resolves.toBeTruthy()
  })
})

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { colToIdx, idxToCol, leftJoin, readNum, readStr } from '../parse'
import { enrichMinusData } from '../pipeline'

/**
 * Excel column letter 위치에 값을 채운 row 를 만든다.
 * `entries`: { letter: value } 형태.
 * 결과 배열의 길이는 가장 큰 letter 인덱스 + 1.
 */
function makeRow(entries: Record<string, unknown>): unknown[] {
  const maxIdx = Math.max(0, ...Object.keys(entries).map((l) => colToIdx(l)))
  const row: unknown[] = new Array(maxIdx + 1).fill(null)
  for (const [letter, value] of Object.entries(entries)) {
    row[colToIdx(letter)] = value
  }
  return row
}

/**
 * 2차원 배열(첫 2행은 더미 헤더)에서 xlsx ArrayBuffer 생성.
 */
function makeWorkbookBuffer(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

describe('parse utilities', () => {
  it('colToIdx / idxToCol', () => {
    expect(colToIdx('A')).toBe(0)
    expect(colToIdx('Z')).toBe(25)
    expect(colToIdx('AA')).toBe(26)
    expect(colToIdx('AE')).toBe(30)
    expect(colToIdx('AG')).toBe(32)
    expect(idxToCol(0)).toBe('A')
    expect(idxToCol(30)).toBe('AE')
    expect(idxToCol(32)).toBe('AG')
  })

  it('readNum: 숫자/문자열 숫자/null', () => {
    const row = makeRow({ A: 1000, B: '1,234', C: null, D: '', E: 'NaN' })
    expect(readNum(row, 'A')).toBe(1000)
    expect(readNum(row, 'B')).toBe(1234)
    expect(readNum(row, 'C')).toBeNull()
    expect(readNum(row, 'D')).toBeNull()
    expect(readNum(row, 'E')).toBeNull()
  })

  it('readStr: 공백/null', () => {
    const row = makeRow({ A: '  hello  ', B: '', C: null, D: 42 })
    expect(readStr(row, 'A')).toBe('hello')
    expect(readStr(row, 'B')).toBeNull()
    expect(readStr(row, 'C')).toBeNull()
    expect(readStr(row, 'D')).toBe('42')
  })

  it('leftJoin: 매칭 / 미매칭 / 중복 키 첫 행 보존', () => {
    const left = [
      makeRow({ AE: 'ORD-1' }),
      makeRow({ AE: 'ORD-2' }),
      makeRow({ AE: 'ORD-MISS' }),
    ]
    const right = [
      makeRow({ E: 'ORD-1', Y: 'P-1' }),
      makeRow({ E: 'ORD-2', Y: 'P-2' }),
      makeRow({ E: 'ORD-1', Y: 'P-DUP' }), // 중복 — 무시되어야 함
    ]
    const joined = leftJoin(left, right, 'AE', 'E')
    expect(joined).toHaveLength(3)
    expect(joined[0].right).not.toBeNull()
    expect(readStr(joined[0].right!, 'Y')).toBe('P-1') // 첫 행 보존
    expect(readStr(joined[1].right!, 'Y')).toBe('P-2')
    expect(joined[2].right).toBeNull()
  })
})

describe('enrichMinusData', () => {
  it('정상 흐름: 두 파일 + cal_amount Map 으로 EnrichedRow 생성 + diagnostics 집계', async () => {
    // sales_status_basic: 헤더 2행 + 데이터 3행
    const salesRows: unknown[][] = [
      makeRow({ A: 'header1' }), // 헤더 행 1
      makeRow({ A: 'header2' }), // 헤더 행 2
      // 행1: 정상 + cal_amount 등록됨
      makeRow({
        A: 'A-CJ온스타일(jkman2)',
        C: '2026-05-22',
        K: 1000,
        L: 900,
        M: 800,
        R: 100,
        S: 0.1,
        T: 100,
        U: 0.1,
        AE: 'ORD-1',
      }),
      // 행2: K=0 → 계산 일부 null + cal_amount 매칭 실패
      makeRow({
        A: 'B-GS SHOP(1026971)',
        C: '2026-05-22',
        K: 0,
        L: 900,
        M: 800,
        R: -100,
        S: -0.1,
        T: -100,
        U: -0.1,
        AE: 'ORD-2',
      }),
      // 행3: revenue 조인 실패 (ORD-NONE) → productCode null → extra null
      makeRow({
        A: '[B2B]',
        C: '2026-05-22',
        K: 500,
        L: 550,
        M: 400,
        R: -50,
        S: -0.1,
        T: -50,
        U: -0.1,
        AE: 'ORD-NONE',
      }),
      // 빈 행 (필터로 제거되어야 함)
      [],
    ]

    // revenue_profit_brand: 표시 정보 (v1.3: AG → AH, BF 추가). v1.6: AQ 는 product 에서 가져옴.
    const revenueRows: unknown[][] = [
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
      makeRow({ E: 'ORD-1', Y: 'P-100', AH: '상품 100', BF: '브랜드 A' }),
      makeRow({ E: 'ORD-2', Y: 'P-200', AH: '상품 200', BF: '브랜드 B' }),
    ]

    // revenue_profit_product: 판매세트 수량 (v1.6 2026-05-26)
    const productRows: unknown[][] = [
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
      makeRow({ E: 'ORD-1', AQ: 3 }),
      makeRow({ E: 'ORD-2', AQ: 2 }),
    ]

    const salesBuf = makeWorkbookBuffer(salesRows)
    const revenueBuf = makeWorkbookBuffer(revenueRows)
    const productBuf = makeWorkbookBuffer(productRows)

    // cal_amount: P-100 만 등록, P-200 은 미등록 (매칭 실패)
    const calMap = new Map<string, number>([['P-100', 50]])

    const { rows, diagnostics } = await enrichMinusData({
      salesFile: salesBuf,
      revenueFile: revenueBuf,
      productFile: productBuf,
      calAmountMap: calMap,
      productMasterMap: new Map(),
    })

    expect(rows).toHaveLength(3)

    // 행1 — 정상
    expect(rows[0].salesType).toBe('A-CJ온스타일(jkman2)')
    expect(rows[0].onlineOrderNo).toBe('ORD-1')
    expect(rows[0].productCode).toBe('P-100')
    expect(rows[0].productName).toBe('상품 100')
    expect(rows[0].brandName).toBe('브랜드 A')
    expect(rows[0].K).toBe(1000)
    expect(rows[0].L).toBe(900)
    expect(rows[0].R).toBe(100)
    // cal_amount 단가 50 × 수량 3 = 150
    expect(rows[0].quantity).toBe(3)
    expect(rows[0].extraSettlement).toBe(150)
    expect(rows[0].commissionRate).toBeCloseTo(0.1, 10)
    expect(rows[0].settlementAmount).toBeCloseTo(50, 10)
    // totalMargin = R(100) + settlement(50) + extraSettlement(150) = 300
    expect(rows[0].totalMargin).toBeCloseTo(300, 10)
    expect(rows[0].totalMarginRate).toBeCloseTo(300 / 900, 10)

    // 행2 — K=0, cal_amount 미등록(P-200 미등록)
    expect(rows[1].onlineOrderNo).toBe('ORD-2')
    expect(rows[1].productCode).toBe('P-200')
    expect(rows[1].K).toBe(0)
    expect(rows[1].extraSettlement).toBeNull() // 매칭 실패
    expect(rows[1].commissionRate).toBeNull()
    expect(rows[1].settlementAmount).toBeNull()
    expect(rows[1].totalMargin).toBeNull()
    expect(rows[1].totalMarginRate).toBeNull()

    // 행3 — revenue 조인 실패
    expect(rows[2].onlineOrderNo).toBe('ORD-NONE')
    expect(rows[2].productCode).toBeNull()
    expect(rows[2].productName).toBeNull()
    expect(rows[2].brandName).toBeNull()
    expect(rows[2].extraSettlement).toBeNull() // productCode null → cal lookup 못 함
    // 그래도 K/L/R 이 있으면 totalMargin 계산은 (null ?? 0) 처리로 진행
    // commissionRate = 1 - 550/500 = -0.1
    expect(rows[2].commissionRate).toBeCloseTo(-0.1, 10)
    expect(rows[2].settlementAmount).toBeCloseTo(-25, 10) // 500 * -0.05
    expect(rows[2].totalMargin).toBeCloseTo(-75, 10) // -50 + -25 + 0
    expect(rows[2].totalMarginRate).toBeCloseTo(-75 / 550, 10)

    // diagnostics
    expect(diagnostics.totalRows).toBe(3)
    expect(diagnostics.matchedCount).toBe(2) // ORD-1, ORD-2
    expect(diagnostics.unmatchedJoinCount).toBe(1) // ORD-NONE
    expect(diagnostics.missingExtraCount).toBe(2) // ORD-2(P-200 미등록) + ORD-NONE(productCode null)
    expect(diagnostics.computeNullCount).toBe(1) // ORD-2 (K=0)
  })

  it('빈 파일: rows=[], diagnostics 모두 0', async () => {
    const emptySales = makeWorkbookBuffer([
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
    ])
    const emptyRevenue = makeWorkbookBuffer([
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
    ])
    const emptyProduct = makeWorkbookBuffer([
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
    ])
    const { rows, diagnostics } = await enrichMinusData({
      salesFile: emptySales,
      revenueFile: emptyRevenue,
      productFile: emptyProduct,
      calAmountMap: new Map(),
      productMasterMap: new Map(),
    })
    expect(rows).toEqual([])
    expect(diagnostics).toEqual({
      totalRows: 0,
      matchedCount: 0,
      unmatchedJoinCount: 0,
      missingExtraCount: 0,
      computeNullCount: 0,
    })
  })

  it('합계/총계 행은 제외된다 (A열 텍스트 매칭)', async () => {
    const salesRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      // 정상 데이터 2행
      makeRow({
        A: 'C-NS홈쇼핑(109267)',
        C: '2026-05-22',
        K: 1000,
        L: 900,
        R: 100,
        AE: 'ORD-1',
      }),
      makeRow({
        A: 'C-NS홈쇼핑(109267)',
        C: '2026-05-22',
        K: 2000,
        L: 1800,
        R: 200,
        AE: 'ORD-2',
      }),
      // 합계 행 — 제외되어야 함
      makeRow({ A: '총계', K: 3000, L: 2700, R: 300 }),
    ]
    const revenueRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-1', Y: 'P-1', AH: '상품1', BF: '브랜드1' }),
      makeRow({ E: 'ORD-2', Y: 'P-2', AH: '상품2', BF: '브랜드2' }),
    ]
    const productRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-1', AQ: 1 }),
      makeRow({ E: 'ORD-2', AQ: 1 }),
    ]

    const { rows, diagnostics } = await enrichMinusData({
      salesFile: makeWorkbookBuffer(salesRows),
      revenueFile: makeWorkbookBuffer(revenueRows),
      productFile: makeWorkbookBuffer(productRows),
      calAmountMap: new Map(),
      productMasterMap: new Map(),
    })

    expect(rows).toHaveLength(2) // 합계 행 제외 후 2행
    expect(diagnostics.totalRows).toBe(2)
    // K 합 = 1000 + 2000 = 3000 (합계 행 3000 안 더해짐 — 만약 더해지면 6000)
    const totalK = rows.reduce((s, r) => s + (r.K ?? 0), 0)
    expect(totalK).toBe(3000)
  })

  it('합계 키워드 변형 (합계/소계/TOTAL/대소문자) 도 제외', async () => {
    const variants = ['합계', '소계', '총합', 'TOTAL', 'total', 'Summary']
    for (const label of variants) {
      const salesRows: unknown[][] = [
        makeRow({ A: 'h1' }),
        makeRow({ A: 'h2' }),
        makeRow({
          A: 'NS',
          C: '2026-05-22',
          K: 100,
          L: 90,
          R: 10,
          AE: 'ORD-X',
        }),
        makeRow({ A: label, K: 100, L: 90, R: 10 }),
      ]
      const revenueRows: unknown[][] = [
        makeRow({ A: 'h1' }),
        makeRow({ A: 'h2' }),
        makeRow({ E: 'ORD-X', Y: 'P-X', AH: '상품X', BF: '브랜드X' }),
      ]
      const productRows: unknown[][] = [
        makeRow({ A: 'h1' }),
        makeRow({ A: 'h2' }),
        makeRow({ E: 'ORD-X', AQ: 1 }),
      ]
      const { rows } = await enrichMinusData({
        salesFile: makeWorkbookBuffer(salesRows),
        revenueFile: makeWorkbookBuffer(revenueRows),
        productFile: makeWorkbookBuffer(productRows),
        calAmountMap: new Map(),
        productMasterMap: new Map(),
      })
      expect(rows, `라벨 "${label}" 합계 행 미제외`).toHaveLength(1)
    }
  })

  it('productMasterMap 매칭: 단품/복합/미매칭이 isComposite 에 반영된다 (P4 §7)', async () => {
    const salesRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-A' }),
      makeRow({ C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-B' }),
      makeRow({ C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-C' }),
      makeRow({ C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-NONE' }), // join 실패
    ]
    const revenueRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-A', Y: 'P-SINGLE', AH: '단품상품', BF: 'BR1' }),
      makeRow({ E: 'ORD-B', Y: 'P-COMP', AH: '복합상품', BF: 'BR1' }),
      makeRow({ E: 'ORD-C', Y: 'P-MISS', AH: '미매칭상품', BF: 'BR1' }), // master 누락
    ]
    const productRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-A', AQ: 1 }),
      makeRow({ E: 'ORD-B', AQ: 1 }),
      makeRow({ E: 'ORD-C', AQ: 1 }),
    ]

    const productMasterMap = new Map([
      [
        'P-SINGLE',
        {
          isComposite: false,
          channelName: 'CH1',
          brandName: 'BR1',
          productName: '단품상품',
        },
      ],
      [
        'P-COMP',
        {
          isComposite: true,
          channelName: 'CH1',
          brandName: 'BR1',
          productName: '복합상품',
        },
      ],
    ])

    const { rows } = await enrichMinusData({
      salesFile: makeWorkbookBuffer(salesRows),
      revenueFile: makeWorkbookBuffer(revenueRows),
      productFile: makeWorkbookBuffer(productRows),
      calAmountMap: new Map(),
      productMasterMap,
    })

    expect(rows).toHaveLength(4)
    // 행1 — 단품
    expect(rows[0].productCode).toBe('P-SINGLE')
    expect(rows[0].isComposite).toBe(false)
    // 행2 — 복합
    expect(rows[1].productCode).toBe('P-COMP')
    expect(rows[1].isComposite).toBe(true)
    // 행3 — productCode 있으나 master 미등록
    expect(rows[2].productCode).toBe('P-MISS')
    expect(rows[2].isComposite).toBeNull()
    // 행4 — revenue 조인 실패 → productCode null → master 조회 자체 안 함
    expect(rows[3].productCode).toBeNull()
    expect(rows[3].isComposite).toBeNull()
  })

  it('cal_amount 에 0 등록된 상품: extraSettlement=0 (누락 아님)', async () => {
    const salesRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-Z' }),
    ]
    const revenueRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-Z', Y: 'P-ZERO', AH: '상품 Z', BF: '브랜드 Z' }),
    ]
    const productRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-Z', AQ: 2 }),
    ]
    const calMap = new Map<string, number>([['P-ZERO', 0]])

    const { rows, diagnostics } = await enrichMinusData({
      salesFile: makeWorkbookBuffer(salesRows),
      revenueFile: makeWorkbookBuffer(revenueRows),
      productFile: makeWorkbookBuffer(productRows),
      calAmountMap: calMap,
      productMasterMap: new Map(),
    })

    expect(rows[0].extraSettlement).toBe(0) // null 아님 — 등록됨
    expect(diagnostics.missingExtraCount).toBe(0) // 누락 아님
    // totalMargin = 100 + 50 + 0 = 150
    expect(rows[0].totalMargin).toBeCloseTo(150, 10)
  })
})

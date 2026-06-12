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

    // revenue_profit_brand: 표시 정보 (productCode/brandName).
    //   v1.6: AQ 는 product 에서. v1.7(2026-05-29): productName(AH) 도 product 로 이동.
    const revenueRows: unknown[][] = [
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
      // 브랜드명 CJ제일제당 → 채널 규칙상 수수료·후정산금 유지(정상 계산 경로 검증)
      makeRow({ E: 'ORD-1', Y: 'P-100', BF: 'CJ-씨제이제일제당(주)' }),
      makeRow({ E: 'ORD-2', Y: 'P-200', BF: 'CJ-씨제이제일제당(주)' }),
    ]

    // revenue_profit_product: 판매세트 수량(AQ) + 상품명(AH, v1.7 2026-05-29)
    const productRows: unknown[][] = [
      makeRow({ A: 'header1' }),
      makeRow({ A: 'header2' }),
      // BA=원가총액, BB=최종이익액, BC=최종이익률(퍼센트 수치 — /100 해 비율로 변환됨)
      makeRow({ E: 'ORD-1', Y: 'P-100', AH: '상품 100', AQ: 3, BA: 700, BB: 250, BC: 17.52 }),
      makeRow({ E: 'ORD-2', Y: 'P-200', AH: '상품 200', AQ: 2, BA: 800, BB: -30, BC: -5 }),
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
    expect(rows[0].brandName).toBe('CJ-씨제이제일제당(주)')
    expect(rows[0].K).toBe(1000)
    expect(rows[0].L).toBe(900)
    expect(rows[0].R).toBe(100)
    // cal_amount 단가 50 × 수량 3 = 150
    expect(rows[0].quantity).toBe(3)
    expect(rows[0].extraSettlement).toBe(150)
    // 단품 → components length 1, 기여분 보존
    expect(rows[0].components).toHaveLength(1)
    expect(rows[0].components[0]).toEqual({
      productCode: 'P-100',
      quantity: 3,
      extra: 150,
    })
    expect(rows[0].commissionRate).toBeCloseTo(0.1, 10)
    expect(rows[0].settlementAmount).toBeCloseTo(50, 10)
    // totalMargin = R(100) + settlement(50) + extraSettlement(150) = 300
    expect(rows[0].totalMargin).toBeCloseTo(300, 10)
    expect(rows[0].totalMarginRate).toBeCloseTo(300 / 900, 10)
    // 원가총액(BA)/최종이익액(BB)/최종이익률(BC) — 이익률은 17.52 → /100 = 0.1752 비율
    expect(rows[0].cost).toBe(700)
    expect(rows[0].finalProfit).toBe(250)
    expect(rows[0].finalProfitRate).toBeCloseTo(0.1752, 10)

    // 행2 — K=0, cal_amount 미등록(P-200 미등록)
    expect(rows[1].onlineOrderNo).toBe('ORD-2')
    expect(rows[1].productCode).toBe('P-200')
    expect(rows[1].K).toBe(0)
    expect(rows[1].extraSettlement).toBeNull() // 매칭 실패
    expect(rows[1].commissionRate).toBeNull()
    expect(rows[1].settlementAmount).toBeNull()
    expect(rows[1].totalMargin).toBeNull()
    expect(rows[1].totalMarginRate).toBeNull()
    // 원가/최종이익액/최종이익률은 cal_amount 와 무관 — product 파일 값(음수 포함). BC -5 → /100 = -0.05
    expect(rows[1].cost).toBe(800)
    expect(rows[1].finalProfit).toBe(-30)
    expect(rows[1].finalProfitRate).toBeCloseTo(-0.05, 10)

    // 행3 — revenue 조인 실패
    expect(rows[2].onlineOrderNo).toBe('ORD-NONE')
    expect(rows[2].productCode).toBeNull()
    expect(rows[2].productName).toBeNull()
    expect(rows[2].brandName).toBeNull()
    expect(rows[2].extraSettlement).toBeNull() // productCode null → cal lookup 못 함
    // 브랜드명 null(revenue 조인 실패) → 채널 규칙 미적용(현행 유지, 2026-05-29).
    // 그래도 K/L/R 이 있으면 totalMargin 계산은 (null ?? 0) 처리로 진행
    // commissionRate = 1 - 550/500 = -0.1
    expect(rows[2].commissionRate).toBeCloseTo(-0.1, 10)
    expect(rows[2].settlementAmount).toBeCloseTo(-25, 10) // 500 * -0.05
    expect(rows[2].totalMargin).toBeCloseTo(-75, 10) // -50 + -25 + 0
    expect(rows[2].totalMarginRate).toBeCloseTo(-75 / 550, 10)
    // product 조인 실패 → 원가/최종이익액/최종이익률 읽을 행 없음 → null
    expect(rows[2].cost).toBeNull()
    expect(rows[2].finalProfit).toBeNull()
    expect(rows[2].finalProfitRate).toBeNull()

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
      // CJ제일제당 브랜드(매출구분 null) → 수수료·후정산금 유지
      makeRow({ E: 'ORD-Z', Y: 'P-ZERO', AH: '상품 Z', BF: 'CJ-씨제이제일제당(주)' }),
    ]
    const productRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-Z', Y: 'P-ZERO', AQ: 2 }),
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

  it('채널/브랜드 규칙: 수수료·후정산금 제거가 enrich 결과에 반영된다 (2026-05-29)', async () => {
    const CJ = 'CJ-씨제이제일제당(주)'
    // 모든 행 K=1000,L=900,R=100, cal 단가 50 × AQ 1 → extra=50.
    //   유지 시 총마진액 = 100+50+50 = 200, 수수료 0.1, 후정산금 50.
    //   제거 시 총마진액 = 100+50    = 150, 수수료/후정산금 null.
    const salesRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ A: '토스', C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-T' }),
      makeRow({ A: '쇼핑엔티', C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-S1' }),
      makeRow({ A: '쇼핑엔티', C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-S2' }),
      makeRow({ A: '쇼핑엔티', C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-S3' }),
      makeRow({ A: 'CJ온스타일', C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-C' }),
      makeRow({ A: 'CJ온스타일', C: '2026-05-22', K: 1000, L: 900, R: 100, AE: 'ORD-X' }),
    ]
    const revenueRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-T', Y: 'P-T', BF: CJ }),
      makeRow({ E: 'ORD-S1', Y: 'P-S1', BF: CJ }),
      makeRow({ E: 'ORD-S2', Y: 'P-S2', BF: CJ }),
      makeRow({ E: 'ORD-S3', Y: 'P-S3', BF: CJ }),
      makeRow({ E: 'ORD-C', Y: 'P-C', BF: CJ }),
      makeRow({ E: 'ORD-X', Y: 'P-X', BF: '다른브랜드' }), // non-CJ
    ]
    const productRows: unknown[][] = [
      makeRow({ A: 'h1' }),
      makeRow({ A: 'h2' }),
      makeRow({ E: 'ORD-T', Y: 'P-T', AH: '상품T', AQ: 1 }),
      makeRow({ E: 'ORD-S1', Y: 'P-S1', AH: '상품S1', AQ: 1 }),
      makeRow({ E: 'ORD-S2', Y: 'P-S2', AH: '상품S2', AQ: 1 }),
      makeRow({ E: 'ORD-S3', Y: 'P-S3', AH: '상품S3', AQ: 1 }),
      makeRow({ E: 'ORD-C', Y: 'P-C', AH: '상품C', AQ: 1 }),
      makeRow({ E: 'ORD-X', Y: 'P-X', AH: '상품X', AQ: 1 }),
    ]
    const calMap = new Map<string, number>([
      ['P-T', 50],
      ['P-S1', 50],
      ['P-S2', 50],
      ['P-S3', 50],
      ['P-C', 50],
      ['P-X', 50],
    ])
    // 쇼핑엔티: S1=단품, S2=복합, S3=미등록(미매칭=null)
    const productMasterMap = new Map([
      ['P-S1', { isComposite: false, channelName: '', brandName: CJ, productName: '상품S1' }],
      ['P-S2', { isComposite: true, channelName: '', brandName: CJ, productName: '상품S2' }],
    ])

    const { rows } = await enrichMinusData({
      salesFile: makeWorkbookBuffer(salesRows),
      revenueFile: makeWorkbookBuffer(revenueRows),
      productFile: makeWorkbookBuffer(productRows),
      calAmountMap: calMap,
      productMasterMap,
    })

    const byOrder = Object.fromEntries(rows.map((r) => [r.onlineOrderNo, r]))

    // A) CJ + 토스 → 제거
    expect(byOrder['ORD-T'].commissionRate).toBeNull()
    expect(byOrder['ORD-T'].settlementAmount).toBeNull()
    expect(byOrder['ORD-T'].totalMargin).toBeCloseTo(150, 10)

    // B) CJ + 쇼핑엔티 + 단품 → 제거
    expect(byOrder['ORD-S1'].settlementAmount).toBeNull()
    expect(byOrder['ORD-S1'].totalMargin).toBeCloseTo(150, 10)

    // B) CJ + 쇼핑엔티 + 복합 → 유지
    expect(byOrder['ORD-S2'].settlementAmount).toBeCloseTo(50, 10)
    expect(byOrder['ORD-S2'].totalMargin).toBeCloseTo(200, 10)

    // B) CJ + 쇼핑엔티 + 미매칭(null) → 유지 (사용자: 미매칭 놔둠)
    expect(byOrder['ORD-S3'].settlementAmount).toBeCloseTo(50, 10)
    expect(byOrder['ORD-S3'].totalMargin).toBeCloseTo(200, 10)

    // CJ + 일반채널(CJ온스타일) → 유지
    expect(byOrder['ORD-C'].settlementAmount).toBeCloseTo(50, 10)
    expect(byOrder['ORD-C'].totalMargin).toBeCloseTo(200, 10)

    // C) non-CJ 브랜드 → 제거
    expect(byOrder['ORD-X'].commissionRate).toBeNull()
    expect(byOrder['ORD-X'].settlementAmount).toBeNull()
    expect(byOrder['ORD-X'].totalMargin).toBeCloseTo(150, 10)
  })

  /**
   * 묶음 상품: sales 1행 ↔ product 여러 행. 추가후정산금은 각 구성 상품의
   * cal_amount단가 × AQ 를 모두 합산(부분합)한다. (사용자 확정 2026-06-08)
   *   실데이터 예: 주문 20260603029208 = 상품 2종(AQ 1, AQ 2).
   */
  describe('묶음 상품 추가후정산금 합산', () => {
    // 공통: sales 1행(R=100, L=900), brand 1행(대표 표시), product 2행(구성 상품).
    function buildBundle(calMap: Map<string, number>) {
      const salesRows: unknown[][] = [
        makeRow({ A: 'h1' }),
        makeRow({ A: 'h2' }),
        makeRow({
          A: 'CJ온스타일',
          C: '2026-06-03',
          K: 1000,
          L: 900,
          R: 100,
          AE: 'ORD-BUNDLE',
        }),
      ]
      // brand 는 같은 주문에 여러 행이 있어도 첫 행이 대표(표시 productCode/brandName).
      const revenueRows: unknown[][] = [
        makeRow({ A: 'h1' }),
        makeRow({ A: 'h2' }),
        makeRow({ E: 'ORD-BUNDLE', Y: 'P-A', BF: 'CJ-씨제이제일제당(주)' }),
        makeRow({ E: 'ORD-BUNDLE', Y: 'P-B', BF: 'CJ-씨제이제일제당(주)' }),
      ]
      // product 2행 = 구성 상품 2종. AQ 가 서로 다름.
      const productRows: unknown[][] = [
        makeRow({ A: 'h1' }),
        makeRow({ A: 'h2' }),
        makeRow({ E: 'ORD-BUNDLE', Y: 'P-A', AH: '구성상품 A', AQ: 1 }),
        makeRow({ E: 'ORD-BUNDLE', Y: 'P-B', AH: '구성상품 B', AQ: 2 }),
      ]
      return enrichMinusData({
        salesFile: makeWorkbookBuffer(salesRows),
        revenueFile: makeWorkbookBuffer(revenueRows),
        productFile: makeWorkbookBuffer(productRows),
        calAmountMap: calMap,
        productMasterMap: new Map(),
      })
    }

    it('두 구성 상품 모두 등록 → 합산 (10×1 + 100×2 = 210)', async () => {
      const { rows, diagnostics } = await buildBundle(
        new Map([
          ['P-A', 10],
          ['P-B', 100],
        ]),
      )
      expect(rows).toHaveLength(1)
      const r = rows[0]
      // components 2종 + 각 기여분
      expect(r.components).toHaveLength(2)
      expect(r.components[0]).toEqual({ productCode: 'P-A', quantity: 1, extra: 10 })
      expect(r.components[1]).toEqual({ productCode: 'P-B', quantity: 2, extra: 200 })
      // 합산
      expect(r.extraSettlement).toBe(210)
      // 표시 대표값: 첫 구성 quantity, brand 첫 행 productCode/brandName
      expect(r.quantity).toBe(1)
      expect(r.productCode).toBe('P-A')
      expect(r.brandName).toBe('CJ-씨제이제일제당(주)')
      // totalMargin = R(100) + settlement(50) + extra(210) = 360
      expect(r.totalMargin).toBeCloseTo(360, 10)
      expect(diagnostics.missingExtraCount).toBe(0)
    })

    it('부분합: 구성 중 하나만 등록 → 등록분만 합산 (10×1 = 10)', async () => {
      const { rows, diagnostics } = await buildBundle(new Map([['P-A', 10]]))
      const r = rows[0]
      expect(r.components[0].extra).toBe(10)
      expect(r.components[1].extra).toBeNull() // P-B 미등록
      // 부분합: 등록된 P-A 만
      expect(r.extraSettlement).toBe(10)
      // 부분 누락이라도 extraSettlement != null → 누락 KPI 미집계
      expect(diagnostics.missingExtraCount).toBe(0)
      // totalMargin = 100 + 50 + 10 = 160
      expect(r.totalMargin).toBeCloseTo(160, 10)
    })

    it('전부 미등록 → extraSettlement null + 누락 집계', async () => {
      const { rows, diagnostics } = await buildBundle(new Map())
      const r = rows[0]
      expect(r.components[0].extra).toBeNull()
      expect(r.components[1].extra).toBeNull()
      expect(r.extraSettlement).toBeNull()
      expect(diagnostics.missingExtraCount).toBe(1)
      // totalMargin = 100 + 50 + 0 = 150 (extra ?? 0)
      expect(r.totalMargin).toBeCloseTo(150, 10)
    })
  })
})

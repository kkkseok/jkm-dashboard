/**
 * 그룹 매핑 소스 파서 (클라이언트사이드).
 *
 *   - parseProductMasterRaw: product_master.xlsx 원본 → group_market_map + group_bundle_item 입력
 *   - parseProductInfo:      product_info.xlsx        → group_erp_code 입력
 *
 * 상품 마스터는 컬럼 letter 를 고정하지 않고 헤더 이름으로 위치를 찾는다(detectMasterLayout).
 * 채널·월 매입가 컬럼이 추가되거나 헤더 행이 움직여도 파일만 올리면 인식된다.
 *
 * 묶음 내품 구성·수량은 ★자체코드(★A_B) 분해가 아니라 **최신 월 매입가 수식 컬럼**
 * (`({수식컬럼}{내품행}*{수량})+…`)에서 뽑는다.
 * 행 참조라 순서·표기 흔들림이 없고 수량까지 정확하다(검증: no_mapping_0609 → group_upload_0609 6/6 재현).
 * 수식은 행 배열엔 안 담기므로 워크북 셀(.f)에 직접 접근한다.
 */

import * as XLSX from 'xlsx'
import { colToIdx, decryptWorkbookBuffer } from '@/lib/minus/parse'
import {
  BUNDLE_PREFIX,
  COMPOSITE_LABEL,
  MARKET_CODE_RE,
  PRODUCT_INFO,
  PRODUCT_MASTER_RAW as PM,
  type ProductMasterHeaderKey,
  SABANGNET_CODE_RE,
  bundleFormulaRe,
} from './mapping'
import type {
  BundleItemInput,
  MarketMapInput,
  ProductInfoParseResult,
  ProductMasterLayout,
  ProductMasterParseResult,
} from './types'

const norm = (v: unknown): string => (v == null ? '' : String(v).trim())

/** 정수 파싱. 빈/비정수 → null. */
function parseIntOrNull(v: unknown): number | null {
  const n = Number.parseInt(norm(v), 10)
  return Number.isFinite(n) ? n : null
}

/** 경고 배열에 최대 maxSamples 개까지만 추가하는 헬퍼. */
function pushSample(warnings: string[], prefix: string, msg: string, cap: number) {
  const count = warnings.filter((w) => w.startsWith(prefix)).length
  if (count < cap) warnings.push(`${prefix}${msg}`)
}

/** 헤더 비교용 정규화 — 공백(줄바꿈 포함) 전부 제거. */
const normHeader = (v: unknown): string => norm(v).replace(/\s+/g, '')

/**
 * 상품 마스터 시트에서 헤더 이름으로 레이아웃을 찾는다.
 *
 * 1) 상단 headerScanRows 행 중 `사방넷 코드` 셀이 있는 행 = 헤더 행
 * 2) 그 행에서 필수 헤더(상품명/자재코드/상품구분/구성) 위치
 * 3) `NN월 매입가` 중 가장 오른쪽 = 묶음 수식 컬럼
 * 4) 채널 범위 = 사방넷 코드 다음 ~ 상품명 직전
 *
 * 하나라도 못 찾으면 에러 — 조용히 빈/엉뚱한 결과가 적재되는 것을 막는다.
 */
export function detectMasterLayout(ws: XLSX.WorkSheet): ProductMasterLayout {
  const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const maxRow = Math.min(ref.e.r, PM.headerScanRows - 1)
  const maxCol = Math.min(ref.e.c, PM.headerScanCols - 1)
  const cellAt = (r: number, c: number): unknown =>
    ws[XLSX.utils.encode_cell({ r, c })]?.v
  const col = (c: number) => XLSX.utils.encode_col(c)

  const anchor = normHeader(PM.headers.sabangnetCode)
  let headerR = -1
  let codeC = -1
  for (let r = 0; r <= maxRow && headerR < 0; r++) {
    for (let c = 0; c <= maxCol; c++) {
      if (normHeader(cellAt(r, c)) === anchor) {
        headerR = r
        codeC = c
        break
      }
    }
  }
  if (headerR < 0) {
    throw new Error(
      `상품 마스터 헤더를 찾을 수 없습니다 — 첫 번째 시트 상단 ${PM.headerScanRows}행 안에 ` +
        `"${PM.headers.sabangnetCode}" 헤더가 없습니다. 마스터 시트가 맨 앞에 있는지 확인하세요.`,
    )
  }

  // 헤더 행의 나머지 필수 헤더 위치 (첫 등장).
  const found: Partial<Record<ProductMasterHeaderKey, number>> = { sabangnetCode: codeC }
  let fmlC = -1
  for (let c = 0; c <= maxCol; c++) {
    const h = normHeader(cellAt(headerR, c))
    if (h === '') continue
    for (const key of Object.keys(PM.headers) as ProductMasterHeaderKey[]) {
      if (found[key] === undefined && h === normHeader(PM.headers[key])) found[key] = c
    }
    if (PM.bundleFormulaHeader.test(h)) fmlC = c // 가장 오른쪽이 남는다
  }

  const missing = (Object.keys(PM.headers) as ProductMasterHeaderKey[])
    .filter((k) => found[k] === undefined)
    .map((k) => `"${PM.headers[k]}"`)
  if (fmlC < 0) missing.push('"NN월 매입가"')
  if (missing.length > 0) {
    throw new Error(
      `상품 마스터 ${headerR + 1}행(헤더)에서 ${missing.join(', ')} 헤더를 찾을 수 없습니다. ` +
        '헤더 이름이 바뀌었는지 확인하세요.',
    )
  }
  const idx = found as Record<ProductMasterHeaderKey, number>
  if (idx.productName - idx.sabangnetCode < 2) {
    throw new Error(
      `상품 마스터 채널 컬럼이 없습니다 — "${PM.headers.sabangnetCode}"(${col(idx.sabangnetCode)}) 와 ` +
        `"${PM.headers.productName}"(${col(idx.productName)}) 사이에 채널 컬럼이 있어야 합니다.`,
    )
  }

  const chFirst = idx.sabangnetCode + 1
  const chLast = idx.productName - 1
  const channelNames: string[] = []
  for (let c = chFirst; c <= chLast; c++) {
    const name = norm(cellAt(headerR, c)).replace(/\s+/g, ' ')
    if (name !== '' && !channelNames.includes(name)) channelNames.push(name)
  }

  return {
    headerRow: headerR + 1,
    cols: {
      sabangnetCode: col(idx.sabangnetCode),
      productName: col(idx.productName),
      selfCode: col(idx.selfCode),
      type: col(idx.type),
      quantity: col(idx.quantity),
      bundleFormula: col(fmlC),
    },
    bundleFormulaLabel: norm(cellAt(headerR, fmlC)).replace(/\s+/g, ' '),
    channelRange: { first: col(chFirst), last: col(chLast) },
    channelNames,
  }
}

export async function parseProductMasterRaw(
  input: File | ArrayBuffer,
): Promise<ProductMasterParseResult> {
  const buf = await decryptWorkbookBuffer(input)
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellFormula: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const layout = detectMasterLayout(ws)
  const L = layout.cols

  // 마스터 시트는 잡서식 탓에 !ref 가 XEJ(1만6천 컬럼)까지 잡혀 있어,
  // 전체를 펼치면(defval 이 전 컬럼을 채움) 분 단위로 느리다.
  // 탐지된 가장 오른쪽 컬럼까지만 펼친다 — 그 밖은 어차피 읽지 않는다.
  const lastColIdx = Math.max(...Object.values(L).map(colToIdx))
  const fullRange = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
    range: { s: { r: 0, c: 0 }, e: { r: fullRange.e.r, c: lastColIdx } },
  })

  const codeIdx = colToIdx(L.sabangnetCode)
  const nameIdx = colToIdx(L.productName)
  const selfIdx = colToIdx(L.selfCode)
  const typeIdx = colToIdx(L.type)
  const qtyIdx = colToIdx(L.quantity)
  const chFirst = colToIdx(layout.channelRange.first)
  const chLast = colToIdx(layout.channelRange.last)
  const fmlCol = L.bundleFormula
  const formulaRe = bundleFormulaRe(fmlCol)

  const marketRows: MarketMapInput[] = []
  const bundleRows: BundleItemInput[] = []
  const seenMarket = new Map<string, number>()
  // 묶음 dedup 은 사방넷코드(D) 기준. ★자체코드는 수량 변형 SKU 끼리 충돌하므로 키로 못 쓴다.
  const seenBundle = new Set<string>()
  let dupMarketCount = 0
  let bundleCount = 0
  let bundleFormulaFailCount = 0
  const warnings: string[] = []

  /** 엑셀 행 번호(1-based) 의 자체코드 조회 — 매입가 수식 참조행 해석용. */
  const selfCodeAtExcelRow = (excelRow: number): string =>
    norm(rows[excelRow - 1]?.[selfIdx])

  // 데이터는 헤더 행 바로 아래부터 (layout.headerRow 는 1-based 라 그대로 다음 행의 0-based 인덱스).
  // 사이의 보조 헤더/빈 행은 사방넷코드 형식 검사로 걸러진다.
  for (let ri = layout.headerRow; ri < rows.length; ri++) {
    const row = rows[ri]
    if (!Array.isArray(row)) continue
    const sabangnetCode = norm(row[codeIdx])
    if (!SABANGNET_CODE_RE.test(sabangnetCode)) continue // 헤더/잡행 제외

    const productName = norm(row[nameIdx])
    if (productName === '') continue
    const selfCode = norm(row[selfIdx]) || null
    const isComposite = norm(row[typeIdx]) === COMPOSITE_LABEL
    const quantity = parseIntOrNull(row[qtyIdx])

    // 1) 채널 마켓코드(탐지된 채널 범위 전체) 펼치기 — 마켓코드가 키.
    for (let ci = chFirst; ci <= chLast; ci++) {
      const marketCode = norm(row[ci])
      if (marketCode === '') continue
      if (!MARKET_CODE_RE.test(marketCode)) continue // "등록안함" 등 상태 텍스트 제외
      if (seenMarket.has(marketCode)) {
        dupMarketCount++
        pushSample(
          warnings,
          '[마켓코드 중복] ',
          `${marketCode} (사방넷 ${sabangnetCode}) — 첫 등장만 사용`,
          5,
        )
        continue
      }
      seenMarket.set(marketCode, ri)
      marketRows.push({
        marketCode,
        sabangnetCode,
        selfCode,
        productName,
        isComposite,
        quantity,
      })
    }

    // 2) 묶음(복합 + ★) → 매입가 수식 분해. 키는 SKU 유일한 사방넷코드(D).
    if (
      isComposite &&
      selfCode &&
      selfCode.startsWith(BUNDLE_PREFIX) &&
      !seenBundle.has(sabangnetCode)
    ) {
      const formula = ws[`${fmlCol}${ri + 1}`]?.f as string | undefined
      const parts = [...(formula ?? '').matchAll(formulaRe)].map((m) => ({
        excelRow: Number(m[1]),
        // `*수량` 생략 시 1 — 마스터가 ×1 묶음엔 `*1` 을 안 쓰고 행을 그냥 더한다.
        qty: m[2] ? Number(m[2]) : 1,
      }))
      if (parts.length === 0) {
        bundleFormulaFailCount++
        pushSample(
          warnings,
          '[묶음 수식 해석 실패] ',
          `${selfCode} — 매입가 수식이 표준 형태가 아님`,
          5,
        )
        continue
      }
      seenBundle.add(sabangnetCode)
      bundleCount++
      parts.forEach((p, i) => {
        const componentSelfCode = selfCodeAtExcelRow(p.excelRow)
        if (componentSelfCode === '') {
          pushSample(
            warnings,
            '[묶음 내품 자체코드 없음] ',
            `${selfCode} 순번 ${i + 1}`,
            5,
          )
          return
        }
        bundleRows.push({
          bundleSabangnetCode: sabangnetCode,
          seq: i + 1,
          componentSelfCode,
          quantity: p.qty,
        })
      })
    }
  }

  return {
    layout,
    marketRows,
    bundleRows,
    stats: {
      marketCount: marketRows.length,
      dupMarketCount,
      bundleCount,
      bundleItemCount: bundleRows.length,
      bundleFormulaFailCount,
    },
    warnings,
  }
}

export async function parseProductInfo(
  input: File | ArrayBuffer,
): Promise<ProductInfoParseResult> {
  const buf = await decryptWorkbookBuffer(input)
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  })

  const erpCodeIdx = colToIdx(PRODUCT_INFO.cols.erpCode)
  const erpNameIdx = colToIdx(PRODUCT_INFO.cols.erpName)
  const selfCodeIdx = colToIdx(PRODUCT_INFO.cols.selfCode)

  const erpRows: ProductInfoParseResult['erpRows'] = []
  const seenSelf = new Set<string>()
  let dupSelfCount = 0
  const warnings: string[] = []

  for (let ri = PRODUCT_INFO.dataStart; ri < rows.length; ri++) {
    const row = rows[ri]
    if (!Array.isArray(row)) continue
    const selfCode = norm(row[selfCodeIdx])
    const erpCode = norm(row[erpCodeIdx])
    if (selfCode === '' || erpCode === '') continue // 자체코드/ERP코드 둘 다 있어야
    if (seenSelf.has(selfCode)) {
      dupSelfCount++
      pushSample(
        warnings,
        '[자체코드 중복] ',
        `${selfCode} — 첫 등장만 사용`,
        5,
      )
      continue
    }
    seenSelf.add(selfCode)
    erpRows.push({ selfCode, erpCode, erpName: norm(row[erpNameIdx]) })
  }

  return {
    erpRows,
    stats: { erpCount: erpRows.length, dupSelfCount },
    warnings,
  }
}

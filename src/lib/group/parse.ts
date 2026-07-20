/**
 * 그룹 매핑 소스 파서 (클라이언트사이드).
 *
 *   - parseProductMasterRaw: product_master.xlsx 원본 → group_market_map + group_bundle_item 입력
 *   - parseProductInfo:      product_info.xlsx        → group_erp_code 입력
 *
 * 묶음 내품 구성·수량은 ★자체코드(★A_B) 분해가 아니라 **매입가 수식 컬럼**
 * (`cols.bundleFormula`, `({수식컬럼}{내품행}*{수량})+…`)에서 뽑는다.
 * 행 참조라 순서·표기 흔들림이 없고 수량까지 정확하다(검증: no_mapping_0609 → group_upload_0609 6/6 재현).
 * 수식은 행 배열엔 안 담기므로 워크북 셀(.f)에 직접 접근한다.
 */

import * as XLSX from 'xlsx'
import { colToIdx, decryptWorkbookBuffer } from '@/lib/minus/parse'
import {
  BUNDLE_FORMULA_RE,
  BUNDLE_PREFIX,
  COMPOSITE_LABEL,
  MARKET_CODE_RE,
  PRODUCT_INFO,
  PRODUCT_MASTER_HEADER_GUARD,
  PRODUCT_MASTER_RAW as PM,
  SABANGNET_CODE_RE,
} from './mapping'
import type {
  BundleItemInput,
  MarketMapInput,
  ProductInfoParseResult,
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

export async function parseProductMasterRaw(
  input: File | ArrayBuffer,
): Promise<ProductMasterParseResult> {
  const buf = await decryptWorkbookBuffer(input)
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellFormula: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  // 마스터 시트는 잡서식 탓에 !ref 가 XEJ(1만6천 컬럼)까지 잡혀 있어,
  // 전체를 펼치면(defval 이 전 컬럼을 채움) 분 단위로 느리다.
  // 매핑상 가장 오른쪽 컬럼까지만 펼친다 — 그 밖은 어차피 읽지 않는다.
  const lastColIdx = Math.max(
    ...Object.values(PM.cols).map(colToIdx),
    colToIdx(PM.channelRange.last),
  )
  const fullRange = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
    range: { s: { r: 0, c: 0 }, e: { r: fullRange.e.r, c: lastColIdx } },
  })

  const codeIdx = colToIdx(PM.cols.sabangnetCode)
  const nameIdx = colToIdx(PM.cols.productName)
  const selfIdx = colToIdx(PM.cols.selfCode)
  const typeIdx = colToIdx(PM.cols.type)
  const qtyIdx = colToIdx(PM.cols.quantity)
  const chFirst = colToIdx(PM.channelRange.first)
  const chLast = colToIdx(PM.channelRange.last)
  const fmlCol = PM.cols.bundleFormula

  // 레이아웃 가드 — 채널/월 컬럼 추가로 letter 가 밀린 다른 버전 파일을 조기 차단.
  // (구버전 파일을 그대로 파싱하면 상품명 자리에 다른 값이 와서 조용히 빈/엉뚱한 결과가 적재된다)
  const headerRow = rows[PM.headerRow]
  const mismatches = PRODUCT_MASTER_HEADER_GUARD.filter(
    (g) => norm(headerRow?.[colToIdx(g.col)]) !== g.expect,
  )
  if (mismatches.length > 0) {
    const detail = mismatches
      .map((g) => `${g.col}열="${norm(headerRow?.[colToIdx(g.col)])}"(기대: "${g.expect}")`)
      .join(', ')
    throw new Error(
      `상품 마스터 컬럼 레이아웃이 예상과 다릅니다 — ${detail}. ` +
        '채널이 추가/삭제돼 컬럼이 밀린 다른 버전 파일인지 확인하세요 (현재 기준: 2026-07 product_master_2607).',
    )
  }

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

  for (let ri = PM.dataStart; ri < rows.length; ri++) {
    const row = rows[ri]
    if (!Array.isArray(row)) continue
    const sabangnetCode = norm(row[codeIdx])
    if (!SABANGNET_CODE_RE.test(sabangnetCode)) continue // 헤더/잡행 제외

    const productName = norm(row[nameIdx])
    if (productName === '') continue
    const selfCode = norm(row[selfIdx]) || null
    const isComposite = norm(row[typeIdx]) === COMPOSITE_LABEL
    const quantity = parseIntOrNull(row[qtyIdx])

    // 1) 채널 마켓코드(channelRange 전 범위) 펼치기 — 마켓코드가 키.
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
      const parts = [...(formula ?? '').matchAll(BUNDLE_FORMULA_RE)].map((m) => ({
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

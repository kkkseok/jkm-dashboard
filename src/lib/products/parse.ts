/**
 * 상품 마스터 엑셀 import 파서 (Wide format, v1.2 2026-05-27).
 *
 * 헤더 1행:
 *   - 고정 4컬럼: 사방넷코드 / 브랜드명 / 상품명 / 구분
 *   - 그 외 모든 컬럼은 채널명으로 인식 (헤더 텍스트가 channel_name)
 *
 * 데이터 2행부터:
 *   - 한 행 = 한 상품(사방넷코드)
 *   - 각 채널 컬럼: 그 채널의 productCode 또는 빈 칸(등록 안 됨)
 *   - 비어있는 채널은 자동 스킵 (DB 행 생성하지 않음)
 *
 * 검증:
 *   - 4 고정 헤더 누락 → header_missing (파일 단위)
 *   - 채널 컬럼 0개 → no_channel_column (파일 단위)
 *   - 사방넷·브랜드·상품명·구분 비어있음 → required_field
 *   - "구분" 값 != 단품/복합 → invalid_type_value
 *   - 빈 채널 칸 → 스킵 (오류 아님)
 *   - 채워진 productCode 가 형식 위반(`/^[\w-]+$/`) → format_violation
 *   - 채워진 productCode 가 길이 초과 → length_violation
 *   - 파일 내 (사방넷, 채널) 중복 → duplicate_in_file
 *   - 파일 내 productCode 중복 → duplicate_in_file (다른 사방넷 행 또는 같은 사방넷 다른 채널)
 *
 * 결과:
 *   - rows: wide → long 으로 풀린 ParsedRow[] (한 행 = 한 (사방넷, 채널) 페어)
 *   - errors: ParseError[]
 *   - detectedChannels: 헤더에서 감지된 채널명 (display 순)
 */

import * as XLSX from 'xlsx'
import { sliceDataRows } from '@/lib/minus/parse'
import {
  PRODUCT_FIELD_LIMITS,
  PRODUCT_FIXED_HEADER_MAP,
  PRODUCT_FIXED_HEADER_SET,
  PRODUCT_HEADER_ROWS,
  PRODUCT_TYPE_MAP,
  type ProductFixedFieldKey,
} from './mapping'
import type { ParseError, ParseResult, ParsedRow } from './types'

/** SheetJS sheet_to_json header:1 결과의 한 셀 타입 (느슨). */
type Cell = unknown

type HeaderLayout = {
  /** 고정 4컬럼 인덱스 */
  fixed: Record<ProductFixedFieldKey, number>
  /** 채널 컬럼 (헤더 텍스트 + 컬럼 인덱스) — 헤더 등장 순서 보존 */
  channels: Array<{ name: string; col: number }>
}

/**
 * 헤더 행 분석:
 *   - 4 고정 헤더 모두 찾기
 *   - 나머지 비어있지 않은 헤더는 모두 채널 컬럼
 *   - 헤더가 trim() 후 공백이면 무시
 */
function locateHeaders(
  headerRow: Cell[],
  errors: ParseError[],
): HeaderLayout | null {
  const fixed: Partial<Record<ProductFixedFieldKey, number>> = {}
  const channels: HeaderLayout['channels'] = []
  const seenChannelNames = new Set<string>()

  for (let i = 0; i < headerRow.length; i++) {
    const raw = headerRow[i]
    if (raw == null) continue
    const text = String(raw).trim()
    if (text === '') continue

    const fixedMatch = PRODUCT_FIXED_HEADER_MAP.find((m) => m.header === text)
    if (fixedMatch) {
      if (!(fixedMatch.field in fixed)) {
        fixed[fixedMatch.field] = i
      }
      continue
    }

    // 그 외 → 채널 컬럼. 같은 헤더 중복 시 첫 번째만 채택.
    if (!seenChannelNames.has(text)) {
      channels.push({ name: text, col: i })
      seenChannelNames.add(text)
    }
  }

  const missing = PRODUCT_FIXED_HEADER_MAP.filter((m) => !(m.field in fixed))
  if (missing.length > 0) {
    errors.push({
      kind: 'header_missing',
      excelRowIndex: 1,
      field: null,
      message: `필수 헤더 누락: ${missing.map((m) => `"${m.header}"`).join(', ')}. 첫 행에 ${PRODUCT_FIXED_HEADER_MAP.map((m) => `"${m.header}"`).join(' / ')} 4개 고정 컬럼이 모두 있어야 합니다.`,
    })
    return null
  }

  if (channels.length === 0) {
    errors.push({
      kind: 'no_channel_column',
      excelRowIndex: 1,
      field: null,
      message: '채널 컬럼이 하나도 없습니다. 고정 4컬럼 외에 채널명 헤더 (예: GSshop / CJ온스타일) 가 최소 1개 필요합니다.',
    })
    return null
  }

  return { fixed: fixed as Record<ProductFixedFieldKey, number>, channels }
}

function readCellAsString(cell: Cell): string | null {
  if (cell == null) return null
  if (cell instanceof Date) {
    const y = cell.getFullYear()
    const m = String(cell.getMonth() + 1).padStart(2, '0')
    const d = String(cell.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(cell).trim()
  return s === '' ? null : s
}

/**
 * 한 행에서 공통 필드 4개 + 각 채널 컬럼을 읽어 ParsedRow[] 로 풀어낸다.
 * 비어있는 채널은 스킵 (DB 행 생성 안 함).
 */
function expandRow(
  row: Cell[],
  layout: HeaderLayout,
  excelRowIndex: number,
  errors: ParseError[],
): ParsedRow[] {
  let hasFixedError = false

  const sabangnetCode = readCellAsString(row[layout.fixed.sabangnetCode])
  const brandName = readCellAsString(row[layout.fixed.brandName])
  const productName = readCellAsString(row[layout.fixed.productName])
  const typeText = readCellAsString(row[layout.fixed.isComposite])

  type Slot = {
    field: ProductFixedFieldKey
    label: string
    value: string | null
  }
  const slots: Slot[] = [
    { field: 'sabangnetCode', label: '사방넷코드', value: sabangnetCode },
    { field: 'brandName', label: '브랜드명', value: brandName },
    { field: 'productName', label: '상품명', value: productName },
    { field: 'isComposite', label: '구분', value: typeText },
  ]
  for (const slot of slots) {
    if (slot.value == null) {
      errors.push({
        kind: 'required_field',
        excelRowIndex,
        field: slot.field,
        message: `"${slot.label}" 칸이 비어있습니다.`,
      })
      hasFixedError = true
    }
  }
  if (hasFixedError) return []

  const sn = sabangnetCode as string
  const br = brandName as string
  const pn = productName as string
  const tt = typeText as string

  const isComposite = PRODUCT_TYPE_MAP.get(tt)
  if (isComposite === undefined) {
    errors.push({
      kind: 'invalid_type_value',
      excelRowIndex,
      field: 'isComposite',
      message: `구분 값 오류: "${tt}". "단품" 또는 "복합" 중 하나여야 합니다.`,
    })
    return []
  }

  // 채널별로 productCode 가 채워진 칸만 행으로 풀어낸다.
  const out: ParsedRow[] = []
  for (const ch of layout.channels) {
    const pc = readCellAsString(row[ch.col])
    if (pc == null) continue // 비어있는 채널 → 스킵

    // productCode 형식·길이 (사용자 결정: productCode 만 검증 유지)
    if (pc.length > PRODUCT_FIELD_LIMITS.productCode.max) {
      errors.push({
        kind: 'length_violation',
        excelRowIndex,
        field: 'productCode',
        message: `"${ch.name}" 채널 상품코드 길이 초과 (${pc.length}자, 최대 ${PRODUCT_FIELD_LIMITS.productCode.max}자).`,
      })
      continue
    }
    if (!PRODUCT_FIELD_LIMITS.productCode.pattern.test(pc)) {
      errors.push({
        kind: 'format_violation',
        excelRowIndex,
        field: 'productCode',
        message: `"${ch.name}" 채널 상품코드 형식 오류: "${pc}". 영문/숫자/하이픈(-)/언더바(_)만 사용 가능합니다.`,
      })
      continue
    }

    out.push({
      excelRowIndex,
      sabangnetCode: sn,
      brandName: br,
      channelName: ch.name,
      productCode: pc,
      productName: pn,
      isComposite,
    })
  }

  return out
}

async function readSheetRows(input: File | ArrayBuffer): Promise<Cell[][]> {
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) return []
  const ws = wb.Sheets[firstSheetName]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  })
}

/**
 * Wide format 엑셀을 파싱하고 검증한다.
 * 결과는 long format (한 행 = 한 (사방넷, 채널) 페어).
 */
export async function parseProductsXlsx(
  input: File | ArrayBuffer,
): Promise<ParseResult> {
  const errors: ParseError[] = []
  const allRows = await readSheetRows(input)

  if (allRows.length === 0) {
    errors.push({
      kind: 'empty_sheet',
      excelRowIndex: null,
      field: null,
      message: '시트가 비어있습니다. 헤더와 데이터를 확인하세요.',
    })
    return { rows: [], errors, detectedChannels: [] }
  }

  const headerRow = allRows[0] ?? []
  const layout = locateHeaders(headerRow, errors)
  if (!layout) {
    return { rows: [], errors, detectedChannels: [] }
  }

  const detectedChannels = layout.channels.map((c) => c.name)

  // sliceDataRows 의 빈 행/합계행 제외 룰 — 인라인으로 재구현하여 1-based 행 번호 보존
  void sliceDataRows

  // (sabangnetCode, channelName) 중복 + productCode 전체 중복 추적
  const seenSnCh = new Map<string, number>() // "sn||ch" → 첫 등장 row
  const seenProductCode = new Map<string, number>() // productCode → 첫 등장 row

  const rows: ParsedRow[] = []

  for (let i = PRODUCT_HEADER_ROWS; i < allRows.length; i++) {
    const row = allRows[i] ?? []
    if (!Array.isArray(row)) continue
    if (!row.some((c) => c != null && c !== '')) continue
    const a = row[0]
    if (a != null) {
      const aStr = String(a).trim().toLowerCase()
      if (
        aStr === '총계' ||
        aStr === '합계' ||
        aStr === '소계' ||
        aStr === '총합' ||
        aStr === 'total' ||
        aStr === 'summary'
      )
        continue
    }

    const excelRowIndex = i + 1 // 1-based

    const expanded = expandRow(row, layout, excelRowIndex, errors)
    for (const r of expanded) {
      const key = `${r.sabangnetCode}||${r.channelName}`

      const prevSnCh = seenSnCh.get(key)
      if (prevSnCh !== undefined) {
        errors.push({
          kind: 'duplicate_in_file',
          excelRowIndex,
          field: 'channelName',
          message: `(사방넷 "${r.sabangnetCode}", 채널 "${r.channelName}") 조합이 중복됩니다. 첫 등장은 ${prevSnCh}행, 본 행(${excelRowIndex})은 제외됩니다.`,
        })
        continue
      }

      const prevPc = seenProductCode.get(r.productCode)
      if (prevPc !== undefined) {
        errors.push({
          kind: 'duplicate_in_file',
          excelRowIndex,
          field: 'productCode',
          message: `상품코드 "${r.productCode}" 중복. 첫 등장은 ${prevPc}행, 본 행(${excelRowIndex})은 제외됩니다.`,
        })
        continue
      }

      seenSnCh.set(key, excelRowIndex)
      seenProductCode.set(r.productCode, excelRowIndex)
      rows.push(r)
    }
  }

  return { rows, errors, detectedChannels }
}

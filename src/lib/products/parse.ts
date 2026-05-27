/**
 * 상품 마스터 엑셀 import 파서.
 *
 * minus 의 `src/lib/minus/parse.ts` 와 같은 SheetJS 사용 패턴이지만 다음이 다르다:
 *   - 헤더 1행 (minus 는 2행 병합 헤더)
 *   - 컬럼은 letter 가 아니라 **한글 헤더 텍스트**로 식별 (사용자 직접 작성 엑셀)
 *   - 행별 검증을 통과한 행만 `rows` 에, 실패한 행은 `errors` 에 누적
 *
 * 클라이언트사이드(브라우저) 사용이 기본이지만 ArrayBuffer 입력도 받아
 * Node 환경(테스트) 에서도 동작한다. minus parse 의 `sliceDataRows` 합계행 제외 로직을
 * 차용한다.
 */

import * as XLSX from 'xlsx'
import { sliceDataRows } from '@/lib/minus/parse'
import {
  PRODUCT_FIELD_LIMITS,
  PRODUCT_HEADER_MAP,
  PRODUCT_HEADER_ROWS,
  PRODUCT_TYPE_MAP,
  type ProductFieldKey,
} from './mapping'
import type { ParseError, ParseResult, ParsedRow, ProductInput } from './types'

/** SheetJS sheet_to_json header:1 결과의 한 셀 타입 (느슨). */
type Cell = unknown

/**
 * 헤더 행에서 각 한글 헤더가 어떤 컬럼 인덱스에 있는지 찾는다.
 *
 * - 헤더 텍스트는 `String().trim()` 후 비교.
 * - 5개 중 하나라도 못 찾으면 `errors` 에 `header_missing` 으로 누적해 null 반환.
 * - 같은 헤더가 두 번 나오면 첫 번째 컬럼만 채택 (사용자 실수 방지).
 */
function locateHeaders(
  headerRow: Cell[],
  errors: ParseError[],
): Record<ProductFieldKey, number> | null {
  const found: Partial<Record<ProductFieldKey, number>> = {}
  for (let i = 0; i < headerRow.length; i++) {
    const raw = headerRow[i]
    if (raw == null) continue
    const text = String(raw).trim()
    if (text === '') continue
    const match = PRODUCT_HEADER_MAP.find((m) => m.header === text)
    if (match && !(match.field in found)) {
      found[match.field] = i
    }
  }
  const missing = PRODUCT_HEADER_MAP.filter((m) => !(m.field in found))
  if (missing.length > 0) {
    errors.push({
      kind: 'header_missing',
      excelRowIndex: 1,
      field: null,
      message: `필수 헤더 누락: ${missing.map((m) => `"${m.header}"`).join(', ')}. 첫 행에 ${PRODUCT_HEADER_MAP.map((m) => `"${m.header}"`).join(' / ')} 5개 컬럼이 모두 있어야 합니다.`,
    })
    return null
  }
  return found as Record<ProductFieldKey, number>
}

/** 셀을 문자열로 안전하게 읽기. 빈 문자열은 null. */
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
 * 한 데이터 행을 검증해 ParsedRow 또는 null (에러) 로 변환.
 * 에러는 `errors` 에 push.
 */
function validateRow(
  row: Cell[],
  cols: Record<ProductFieldKey, number>,
  excelRowIndex: number,
  errors: ParseError[],
): ParsedRow | null {
  let hasError = false

  // 1. 5개 텍스트 필드 추출
  const productCode = readCellAsString(row[cols.productCode])
  const channelName = readCellAsString(row[cols.channelName])
  const brandName = readCellAsString(row[cols.brandName])
  const productName = readCellAsString(row[cols.productName])
  const typeText = readCellAsString(row[cols.isComposite])

  // 2. 필수 필드 검사
  type Slot = {
    field: keyof ProductInput
    label: string
    value: string | null
  }
  const slots: Slot[] = [
    { field: 'productCode', label: '상품코드', value: productCode },
    { field: 'channelName', label: '채널명', value: channelName },
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
      hasError = true
    }
  }
  if (hasError) return null

  // 이 시점 이후로 위 5개는 모두 string (필수 필드 검사 통과)
  // TS narrowing 은 안되므로 non-null assertion 사용.
  const pc = productCode as string
  const ch = channelName as string
  const br = brandName as string
  const pn = productName as string
  const tt = typeText as string

  // 3. productCode 형식·길이
  if (pc.length > PRODUCT_FIELD_LIMITS.productCode.max) {
    errors.push({
      kind: 'length_violation',
      excelRowIndex,
      field: 'productCode',
      message: `상품코드 길이 초과 (${pc.length}자, 최대 ${PRODUCT_FIELD_LIMITS.productCode.max}자).`,
    })
    hasError = true
  }
  if (!PRODUCT_FIELD_LIMITS.productCode.pattern.test(pc)) {
    errors.push({
      kind: 'format_violation',
      excelRowIndex,
      field: 'productCode',
      message: `상품코드 형식 오류: "${pc}". 영문/숫자/하이픈(-)/언더바(_)만 사용 가능합니다.`,
    })
    hasError = true
  }

  // 4. 나머지 길이 제한
  if (ch.length > PRODUCT_FIELD_LIMITS.channelName.max) {
    errors.push({
      kind: 'length_violation',
      excelRowIndex,
      field: 'channelName',
      message: `채널명 길이 초과 (${ch.length}자, 최대 ${PRODUCT_FIELD_LIMITS.channelName.max}자).`,
    })
    hasError = true
  }
  if (br.length > PRODUCT_FIELD_LIMITS.brandName.max) {
    errors.push({
      kind: 'length_violation',
      excelRowIndex,
      field: 'brandName',
      message: `브랜드명 길이 초과 (${br.length}자, 최대 ${PRODUCT_FIELD_LIMITS.brandName.max}자).`,
    })
    hasError = true
  }
  if (pn.length > PRODUCT_FIELD_LIMITS.productName.max) {
    errors.push({
      kind: 'length_violation',
      excelRowIndex,
      field: 'productName',
      message: `상품명 길이 초과 (${pn.length}자, 최대 ${PRODUCT_FIELD_LIMITS.productName.max}자).`,
    })
    hasError = true
  }

  // 5. "구분" 값 매핑
  const isComposite = PRODUCT_TYPE_MAP.get(tt)
  if (isComposite === undefined) {
    errors.push({
      kind: 'invalid_type_value',
      excelRowIndex,
      field: 'isComposite',
      message: `구분 값 오류: "${tt}". "단품" 또는 "복합" 중 하나여야 합니다.`,
    })
    hasError = true
  }

  if (hasError) return null

  return {
    excelRowIndex,
    productCode: pc,
    channelName: ch,
    brandName: br,
    productName: pn,
    isComposite: isComposite as boolean,
  }
}

/**
 * 엑셀 파일에서 워크북의 첫 시트를 읽어 2차원 배열로 반환.
 * minus 의 `parseWorkbookToRows` 와 비슷하지만 비밀번호 보호는 다루지 않는다.
 * (상품 마스터 엑셀은 사내 양식 파일 → 사용자가 직접 만드는 파일이라 암호화될 일 없음)
 */
async function readSheetRows(input: File | ArrayBuffer): Promise<Cell[][]> {
  const buf =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer()
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
 * 상품 마스터 엑셀을 파싱하고 검증한다.
 *
 * 흐름:
 *   1. 첫 시트를 header:1 로 파싱 (2D 배열).
 *   2. 1행에서 한글 헤더 5개의 컬럼 인덱스를 찾는다. 누락 시 errors 에 추가하고 즉시 반환.
 *   3. 2행부터를 데이터로 보고, minus 의 `sliceDataRows` 로 빈 행/합계행 제외.
 *   4. 각 행을 validateRow 로 검증.
 *   5. 파일 내 productCode 중복 검사 — 첫 번째는 통과, 두 번째 이후는 `duplicate_in_file` 에러.
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
    return { rows: [], errors }
  }

  // 1. 헤더 위치 파악
  const headerRow = allRows[0] ?? []
  const cols = locateHeaders(headerRow, errors)
  if (!cols) {
    // 헤더 누락이면 데이터 검증 진행 의미 없음.
    return { rows: [], errors }
  }

  // 2. 데이터 행만 추출 (헤더 1행 제외 + 빈 행/합계행 제외).
  //    sliceDataRows 는 (allRows, headerRows) 시그니처. 빈 행 필터링은
  //    `Array.isArray(r) && r.some((c) => c != null && c !== '')` 조건이라
  //    헤더 위치 변경에 영향받지 않는다.
  const dataRows = sliceDataRows(allRows, PRODUCT_HEADER_ROWS)

  // 3. 각 행 검증 — 단, sliceDataRows 는 인덱스를 잃어버린다.
  //    엑셀 행 번호(1-based) 를 보존하기 위해 원본 인덱스를 재추적한다.
  //    sliceDataRows 의 결과는 (allRows 의 헤더 이후 + 빈 행/합계 제외) 이므로
  //    원본 인덱스를 다시 매핑하기 위해 allRows 를 직접 순회한다.
  const seenCodes = new Map<string, number>() // productCode → 첫 등장 excelRowIndex
  const rows: ParsedRow[] = []

  for (let i = PRODUCT_HEADER_ROWS; i < allRows.length; i++) {
    const row = allRows[i] ?? []
    // 빈 행 / 합계 행 필터 — sliceDataRows 와 동일 조건
    if (!Array.isArray(row)) continue
    if (!row.some((c) => c != null && c !== '')) continue
    // 합계 행: A열이 합계 키워드
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
    const parsed = validateRow(row, cols, excelRowIndex, errors)
    if (!parsed) continue

    // 파일 내 productCode 중복 검사
    const prev = seenCodes.get(parsed.productCode)
    if (prev !== undefined) {
      errors.push({
        kind: 'duplicate_in_file',
        excelRowIndex,
        field: 'productCode',
        message: `상품코드 "${parsed.productCode}" 중복. 첫 등장은 ${prev}행, 본 행(${excelRowIndex})은 제외됩니다.`,
      })
      continue
    }
    seenCodes.set(parsed.productCode, excelRowIndex)
    rows.push(parsed)
  }

  // sliceDataRows 호출은 _ 로 두지 않고 호출 의도(빈 행 제외 일관성) 명시 — TS unused 방지
  void dataRows

  return { rows, errors }
}

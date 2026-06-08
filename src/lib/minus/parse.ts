/**
 * Excel 파싱 유틸 — excel-mapping 스킬의 패턴을 그대로 적용.
 *
 * 클라이언트사이드(브라우저) 사용이 기본이지만, Node 환경(테스트 등)에서도
 * 동작하도록 ArrayBuffer 입력을 허용. Node 전용 API import 금지.
 *
 * 비밀번호 보호(.xlsx with password) 파일도 자동 해제 — 사내 운영 규칙상
 * 비밀번호는 일괄 '1111' 로 고정되어 있어 하드코딩.
 */

import * as XLSX from 'xlsx'

/** 사내 일괄 비밀번호 — 운영 규칙으로 고정. */
const FIXED_XLSX_PASSWORD = '1111'

/** CFB(Compound File Binary) 시그니처 = OOXML 암호화된 .xlsx 의 첫 8바이트. */
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function hasCfbSignature(buf: ArrayBuffer): boolean {
  if (buf.byteLength < CFB_SIGNATURE.length) return false
  const head = new Uint8Array(buf, 0, CFB_SIGNATURE.length)
  for (let i = 0; i < CFB_SIGNATURE.length; i++) {
    if (head[i] !== CFB_SIGNATURE[i]) return false
  }
  return true
}

/**
 * 브라우저에서 officecrypto-tool 이 `Buffer.from()` 을 호출하므로
 * 클라이언트에서는 `buffer` polyfill 의 Buffer 를 글로벌에 주입.
 * 서버(Node) 에서는 이미 글로벌에 있으므로 noop.
 */
async function ensureBufferGlobal(): Promise<void> {
  if (typeof window === 'undefined') return
  const g = globalThis as typeof globalThis & { Buffer?: unknown }
  if (g.Buffer) return
  const { Buffer } = await import('buffer')
  g.Buffer = Buffer
}

/**
 * 암호화된 .xlsx 면 고정 비번 '1111' 로 복호화한 ArrayBuffer 반환.
 * 일반 .xlsx (PK 시작) 면 입력을 그대로 반환.
 */
async function decryptIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (!hasCfbSignature(buf)) return buf
  await ensureBufferGlobal()
  const { default: officeCrypto } = await import('officecrypto-tool')
  try {
    // 라이브러리는 Buffer 타입을 선언하지만, 내부에서 ArrayBuffer/Uint8Array 입력을
    // Buffer.from() 으로 자동 변환하므로 Uint8Array 를 그대로 넘겨도 동작.
    const decrypted = await officeCrypto.decrypt(
      new Uint8Array(buf) as unknown as Buffer,
      { password: FIXED_XLSX_PASSWORD },
    )
    // Buffer(=Uint8Array) → ArrayBuffer (offset 보정)
    return decrypted.buffer.slice(
      decrypted.byteOffset,
      decrypted.byteOffset + decrypted.byteLength,
    ) as ArrayBuffer
  } catch (e) {
    throw new Error(
      '비밀번호로 보호된 파일을 열 수 없습니다. ' +
        '사내 비밀번호(1111) 가 아닌 다른 비밀번호로 설정되어 있거나, 손상된 파일일 수 있습니다.',
      { cause: e },
    )
  }
}

/**
 * Excel column letter → 0-based index.
 * A=0, B=1, …, Z=25, AA=26, AB=27, …, AE=30, AG=32
 */
export function colToIdx(letter: string): number {
  let n = 0
  for (const ch of letter.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

/** 0-based index → Excel column letter (역변환). */
export function idxToCol(idx: number): string {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * 셀을 숫자로 안전하게 읽기. "1,000" 같은 문자열 숫자도 처리.
 * 빈 값/공백/파싱 불가 → null.
 */
export function readNum(row: unknown[], colLetter: string): number | null {
  const v = row[colToIdx(colLetter)]
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // 문자열 숫자 ("1,000") 방어
  const cleaned = String(v).replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * 셀을 문자열로 안전하게 읽기. 빈 문자열은 null 로 변환.
 * Date 객체(cellDates: true) 인 경우 ISO 날짜 문자열(YYYY-MM-DD) 로 변환.
 */
export function readStr(row: unknown[], colLetter: string): string | null {
  const v = row[colToIdx(colLetter)]
  if (v == null) return null
  if (v instanceof Date) {
    // 로컬 타임존 영향 회피 — 직접 YYYY-MM-DD 조립
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * 워크북의 첫 시트를 header:1 모드로 파싱.
 * - 클라이언트(File) 와 서버(ArrayBuffer) 둘 다 허용.
 * - cellDates: true 로 날짜 셀을 Date 로 자동 변환.
 * - raw: true 로 숫자/날짜 원본 보존.
 * - defval: null 로 빈 셀을 명시적으로 null 로 채움.
 */
export async function parseWorkbookToRows(
  input: File | ArrayBuffer,
): Promise<unknown[][]> {
  let buf: ArrayBuffer
  if (input instanceof ArrayBuffer) {
    buf = input
  } else {
    // File / Blob
    buf = await input.arrayBuffer()
  }
  buf = await decryptIfNeeded(buf)
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) return []
  const ws = wb.Sheets[firstSheetName]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  })
  return rows
}

/**
 * Excel 데이터의 마지막에 흔히 붙는 "합계/총계" 행을 식별하는 A열 키워드.
 * sales_status_basic 마지막 행 A="총계" 케이스 등에서 KPI 합산이 두 배가 되는 문제 방지.
 * 정상 데이터 행의 A열에는 절대 들어가지 않는 단어들만 등록.
 */
const SUMMARY_ROW_LABELS = new Set([
  '총계',
  '합계',
  '소계',
  '총합',
  'total',
  'summary',
])

function isSummaryRow(row: unknown[]): boolean {
  const a = row[0]
  if (a == null) return false
  const s = String(a).trim().toLowerCase()
  return SUMMARY_ROW_LABELS.has(s)
}

/**
 * 헤더 행을 건너뛰고 데이터 행만 추출 + 완전 빈 행 제거 + 합계/총계 행 제거.
 */
export function sliceDataRows(allRows: unknown[][], headerRows: number): unknown[][] {
  return allRows
    .slice(headerRows)
    .filter((r) => Array.isArray(r) && r.some((c) => c != null && c !== ''))
    .filter((r) => !isSummaryRow(r))
}

/**
 * LEFT JOIN 패턴 — Map 기반 O(n).
 * 양쪽 키는 String() 으로 정규화. 중복 키는 첫 행 보존 (덮어쓰기 방지).
 *
 * @returns 각 left 행에 대해 right 행 또는 null (매칭 실패) 을 페어로 반환.
 */
export function leftJoin(
  leftRows: unknown[][],
  rightRows: unknown[][],
  leftKeyCol: string,
  rightKeyCol: string,
): Array<{ left: unknown[]; right: unknown[] | null }> {
  const idx = new Map<string, unknown[]>()
  const rk = colToIdx(rightKeyCol)
  for (const r of rightRows) {
    const k = r[rk]
    if (k != null && k !== '') {
      const key = String(k).trim()
      if (key !== '' && !idx.has(key)) idx.set(key, r)
    }
  }

  const lk = colToIdx(leftKeyCol)
  return leftRows.map((l) => {
    const k = l[lk]
    if (k == null || k === '') return { left: l, right: null }
    const key = String(k).trim()
    return { left: l, right: key === '' ? null : idx.get(key) ?? null }
  })
}

/**
 * 키 컬럼 기준으로 행들을 그룹핑. 키는 String().trim() 으로 정규화하고
 * 그룹 내 순서는 입력 순서를 보존한다(첫 등장 = 대표 행).
 * 묶음 상품(sales 1행 ↔ revenue 여러 행) 처리에 사용. (v1.8 2026-06-08)
 *
 * 키가 null/공백인 행은 어떤 그룹에도 넣지 않는다.
 */
export function groupByKey(
  rows: unknown[][],
  keyCol: string,
): Map<string, unknown[][]> {
  const map = new Map<string, unknown[][]>()
  const k = colToIdx(keyCol)
  for (const r of rows) {
    const raw = r[k]
    if (raw == null || raw === '') continue
    const key = String(raw).trim()
    if (key === '') continue
    const arr = map.get(key)
    if (arr) arr.push(r)
    else map.set(key, [r])
  }
  return map
}

/**
 * 이미지 대조 대상 엑셀 파서 (클라이언트사이드).
 *
 * 헤더 이름(`자재코드`/`자재명`/`GS`/`본사`)으로 위치를 찾고, 그 아래 행을 대조 쌍으로 읽는다.
 * 필수 헤더를 못 찾으면 에러로 차단 — 엉뚱한 열이 조용히 적재되는 것을 막는다.
 */

import * as XLSX from 'xlsx'
import { decryptWorkbookBuffer } from '@/lib/minus/parse'
import {
  CJ_URL_RE,
  GS_URL_RE,
  MATCH_SOURCE,
  type MatchSourceHeaderKey,
} from './mapping'
import type {
  MatchPairInput,
  MatchSourceLayout,
  MatchSourceParseResult,
} from './types'

const norm = (v: unknown): string => (v == null ? '' : String(v).trim())

/** 헤더 비교용 정규화 — 공백(줄바꿈 포함) 전부 제거. */
const normHeader = (v: unknown): string => norm(v).replace(/\s+/g, '')

/** 경고 배열에 prefix 별 최대 cap 개까지만 추가. */
function pushSample(warnings: string[], prefix: string, msg: string, cap: number) {
  const count = warnings.filter((w) => w.startsWith(prefix)).length
  if (count < cap) warnings.push(`${prefix}${msg}`)
}

/** 상단 범위에서 필수 헤더 4개가 모두 있는 행을 찾는다. */
function detectLayout(ws: XLSX.WorkSheet): {
  layout: MatchSourceLayout
  idx: Record<MatchSourceHeaderKey, number>
  headerR: number
} {
  const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const maxRow = Math.min(ref.e.r, MATCH_SOURCE.headerScanRows - 1)
  const maxCol = Math.min(ref.e.c, MATCH_SOURCE.headerScanCols - 1)
  const keys = Object.keys(MATCH_SOURCE.headers) as MatchSourceHeaderKey[]

  for (let r = 0; r <= maxRow; r++) {
    const found: Partial<Record<MatchSourceHeaderKey, number>> = {}
    for (let c = 0; c <= maxCol; c++) {
      const v = normHeader(ws[XLSX.utils.encode_cell({ r, c })]?.v)
      const key = keys.find((k) => normHeader(MATCH_SOURCE.headers[k]) === v)
      if (key && found[key] === undefined) found[key] = c
    }
    if (keys.every((k) => found[k] !== undefined)) {
      const idx = found as Record<MatchSourceHeaderKey, number>
      const col = (c: number) => XLSX.utils.encode_col(c)
      return {
        headerR: r,
        idx,
        layout: {
          headerRow: r + 1,
          cols: {
            matCode: col(idx.matCode),
            productName: col(idx.productName),
            gsUrl: col(idx.gsUrl),
            cjUrl: col(idx.cjUrl),
          },
        },
      }
    }
  }
  const names = keys.map((k) => MATCH_SOURCE.headers[k]).join(' / ')
  throw new Error(
    `헤더를 찾지 못했습니다. 상단 ${MATCH_SOURCE.headerScanRows}행 안에 "${names}" 가 한 행에 모두 있어야 합니다.`,
  )
}

/** 워크북 버퍼(평문) → 대조 쌍. 테스트에서 직접 호출한다. */
export function parseMatchSourceBuffer(buf: ArrayBuffer): MatchSourceParseResult {
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const { layout, idx, headerR } = detectLayout(ws)
  // sheet_to_json 은 기본으로 !ref 시작 셀(예시 파일은 B2)부터 배열을 만들어 행·열이 모두 밀린다.
  // 범위를 A1 부터로 강제해 배열 인덱스 = 시트 행·열 인덱스로 맞춘다.
  const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
    range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e }),
  })

  const out: MatchPairInput[] = []
  const seen = new Set<string>()
  const warnings: string[] = []
  let dupCount = 0
  let invalidCount = 0

  for (let ri = headerR + 1; ri < rows.length; ri++) {
    const row = rows[ri]
    if (!Array.isArray(row)) continue
    const excelRow = ri + 1
    const matCode = norm(row[idx.matCode])
    const productName = norm(row[idx.productName])
    const cjUrl = norm(row[idx.cjUrl])
    const gsUrl = norm(row[idx.gsUrl])
    if (!matCode && !productName && !cjUrl && !gsUrl) continue // 빈 행

    if (!matCode) {
      invalidCount++
      pushSample(warnings, '[자재코드 없음] ', `${excelRow}행 — 제외`, 5)
      continue
    }
    if (!CJ_URL_RE.test(cjUrl)) {
      invalidCount++
      pushSample(warnings, '[본사 URL 오류] ', `${excelRow}행 ${matCode} — 제외`, 5)
      continue
    }
    if (!GS_URL_RE.test(gsUrl)) {
      invalidCount++
      pushSample(warnings, '[GS URL 오류] ', `${excelRow}행 ${matCode} — 제외`, 5)
      continue
    }
    if (seen.has(matCode)) {
      dupCount++
      pushSample(warnings, '[자재코드 중복] ', `${matCode} — 첫 등장만 사용`, 5)
      continue
    }
    seen.add(matCode)
    out.push({ matCode, productName, cjUrl, gsUrl })
  }

  return {
    layout,
    rows: out,
    stats: { validCount: out.length, dupCount, invalidCount },
    warnings,
  }
}

/** 업로드 파일 → 대조 쌍 (비밀번호 1111 보호 파일 자동 복호화). */
export async function parseMatchSource(
  input: File | ArrayBuffer,
): Promise<MatchSourceParseResult> {
  const buf = await decryptWorkbookBuffer(input)
  return parseMatchSourceBuffer(buf)
}

/**
 * no_mapping.xlsx 파서 (클라이언트사이드).
 *
 * 매핑 안 된 주문 목록에서 마켓코드/마켓명/마켓상품명만 뽑는다.
 * 실제 매핑(DB 조회)·출력 빌드는 actions(resolveGroupUpload)·build 에서 한다.
 */

import * as XLSX from 'xlsx'
import { colToIdx, decryptWorkbookBuffer } from '@/lib/minus/parse'
import { NO_MAPPING } from './mapping'
import type { NoMappingLine } from './types'

const norm = (v: unknown): string => (v == null ? '' : String(v).trim())

export async function parseNoMapping(
  input: File | ArrayBuffer,
): Promise<NoMappingLine[]> {
  const buf = await decryptWorkbookBuffer(input)
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  })

  const cName = colToIdx(NO_MAPPING.cols.marketName)
  const cCode = colToIdx(NO_MAPPING.cols.marketCode)
  const cProd = colToIdx(NO_MAPPING.cols.marketProductName)

  const lines: NoMappingLine[] = []
  for (let ri = NO_MAPPING.dataStart; ri < rows.length; ri++) {
    const row = rows[ri]
    if (!Array.isArray(row)) continue
    const marketCode = norm(row[cCode])
    if (marketCode === '') continue // 마켓코드 없는 행(소계/잡행) 제외
    lines.push({
      marketCode,
      marketName: norm(row[cName]),
      marketProductName: norm(row[cProd]),
    })
  }
  return lines
}

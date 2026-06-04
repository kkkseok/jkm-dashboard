/**
 * 후정산금 대량 업로드 — 엑셀 파싱 (순수 로직).
 *
 * 입력 엑셀은 기존 `cal_amount.xlsx` 형식 고정:
 *   - 1행: 헤더 (A: 상품코드, B: 후정산금)
 *   - 2행~: 데이터
 *
 * column letter 는 minus 와 달리 단순(A/B)하지만, 일관성을 위해
 * `@/lib/minus/parse` 의 `readStr`/`readNum`(letter 기반)을 그대로 재사용한다.
 *
 * 검증 강도는 폼(`calAmountInputSchema`)의 엄격한 정규식이 아니라
 * **import 스크립트와 동일한 관대한 규칙**을 따른다:
 *   - 상품코드: trim 후 비어있지 않으면 통과 (대량 실데이터의 다양한 코드 허용)
 *   - 후정산금: 정수로 파싱 가능하면 통과 ("1,000" 같은 콤마 표기도 readNum 이 처리)
 * 빈 상품코드 / 후정산금 파싱 실패 행은 스킵하고 사유와 함께 보고한다.
 *
 * 반환 `valid` 의 순서는 **엑셀 원본 순서**(1행 데이터가 배열 첫 원소).
 * "엑셀 1행 = 최신(최상단)" 멘탈 모델은 INSERT 단계(역순 삽입)에서 처리한다.
 */

import {
  parseWorkbookToRows,
  readNum,
  readStr,
} from '@/lib/minus/parse'

/** 헤더 행 수 (cal_amount.xlsx 는 1행 헤더). */
const HEADER_ROWS = 1
/** A: 상품코드 */
const COL_PRODUCT_CODE = 'A'
/** B: 후정산금 */
const COL_EXTRA_SETTLEMENT = 'B'

export type SkippedRow = {
  /** 1-based 엑셀 행 번호 (헤더 = 1행). */
  row: number
  reason: string
}

export type ParsedCalAmountUpload = {
  /** 통과한 행 (엑셀 원본 순서). */
  valid: { productCode: string; extraSettlement: number }[]
  /** 스킵된 행 (사유 포함). */
  skipped: SkippedRow[]
  /** 헤더 제외, 내용이 있는 데이터 행 총수 (valid + skipped). */
  totalDataRows: number
}

/**
 * 이미 `header:1` 로 파싱된 2차원 배열을 받아 검증/분류한다.
 * (테스트에서 파일 없이 직접 호출 가능하도록 분리.)
 */
export function parseCalAmountRows(allRows: unknown[][]): ParsedCalAmountUpload {
  const valid: ParsedCalAmountUpload['valid'] = []
  const skipped: SkippedRow[] = []

  for (let i = HEADER_ROWS; i < allRows.length; i++) {
    const r = allRows[i]
    // 완전 빈 행은 보고 없이 무시.
    if (!Array.isArray(r) || !r.some((c) => c != null && c !== '')) continue

    const excelRow = i + 1 // 0-based index → 1-based 엑셀 행 번호

    const productCode = readStr(r, COL_PRODUCT_CODE)
    if (!productCode) {
      skipped.push({ row: excelRow, reason: '상품코드 비어있음' })
      continue
    }

    const amount = readNum(r, COL_EXTRA_SETTLEMENT)
    if (amount == null) {
      skipped.push({ row: excelRow, reason: '후정산금 파싱 실패' })
      continue
    }

    valid.push({ productCode, extraSettlement: Math.trunc(amount) })
  }

  return { valid, skipped, totalDataRows: valid.length + skipped.length }
}

/**
 * File/ArrayBuffer → 파싱 결과. 비밀번호 보호 xlsx 도 parseWorkbookToRows 가 자동 복호화.
 */
export async function parseCalAmountUpload(
  input: File | ArrayBuffer,
): Promise<ParsedCalAmountUpload> {
  const allRows = await parseWorkbookToRows(input)
  return parseCalAmountRows(allRows)
}

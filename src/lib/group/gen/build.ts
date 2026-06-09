/**
 * group_upload.xlsx 빌드 + 다운로드 (클라이언트사이드).
 *
 * resolveGroupUpload 가 채워주는 컬럼(A·B·E·F·G·I·J·M)만 매핑하고
 * 나머지(C·D·H·K·L)는 공란으로 13컬럼 시트를 만든다.
 * 상품코드(F)·자체코드(M)는 코드라 문자열로 둔다(정밀도/표기 보존).
 */

import * as XLSX from 'xlsx'
import { FIXED_UNIT_PRICE, OUTPUT_HEADERS } from './mapping'
import type { OutputRow } from './types'

/** 출력 행 → 13컬럼 AOA (header 포함). */
export function toOutputAoa(rows: OutputRow[]): (string | number)[][] {
  const body = rows.map((r) => [
    r.groupNo, // A 그룹일련번호
    r.groupName, // B 그룹상품명
    '', // C 그룹규격
    '', // D 그룹단가
    r.seq, // E 순번
    r.erpCode, // F 상품코드
    r.erpName, // G 상품명
    '', // H 규격
    r.quantity, // I 수량
    FIXED_UNIT_PRICE, // J 단가
    '', // K 단가구분
    '', // L 공인바코드
    r.selfCode, // M 자체코드
  ])
  return [[...OUTPUT_HEADERS], ...body]
}

/** group_upload.xlsx 생성 후 브라우저 다운로드 트리거. */
export function downloadGroupUpload(rows: OutputRow[], fileName: string): void {
  const ws = XLSX.utils.aoa_to_sheet(toOutputAoa(rows))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'group_upload')
  XLSX.writeFile(wb, fileName)
}

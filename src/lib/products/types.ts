/**
 * 상품 마스터 엑셀 import 파이프라인 타입.
 *
 * 흐름: File → parseProductsXlsx → { rows: ParsedRow[]; errors: ParseError[] }
 *                                   → toProductInputs (필터 + 매핑) → ProductInput[]
 *                                   → Server Action `importProducts`
 *
 * ProductInput 의 형태는 P3 의 DB 스키마(`src/db/schema/product_master.ts`)와 일치.
 * P3 에서 `NewProductMaster` (Drizzle inferInsert) 가 정의되어 있으므로 그것의
 * 서브셋(사용자 입력 가능 필드만)으로 alias.
 *
 * P3 가 늦게 끝났을 경우를 대비해 잠정 타입도 같이 노출 (`ProductInputShape`).
 * 최종 정합화는 P5(next-builder) 에서 검토.
 */

import type { NewProductMaster } from '@/db/schema/product_master'

/**
 * 엑셀에서 사용자가 입력해야 하는 5개 필드만 추린 shape.
 * `id`, `createdAt`, `updatedAt` 은 DB 가 채운다.
 */
export type ProductInput = Pick<
  NewProductMaster,
  'productCode' | 'channelName' | 'brandName' | 'productName' | 'isComposite'
>

/**
 * 잠정 타입 — P3 가 늦으면 import 충돌이 없도록 동등 shape 를 같은 곳에 노출.
 * (현재 P3 스키마 파일은 존재. 본 파일은 위 `ProductInput` 를 NewProductMaster 기반으로 정의.)
 */
export type ProductInputShape = {
  productCode: string
  channelName: string
  brandName: string
  productName: string
  isComposite: boolean
}

/**
 * 파싱 단계에서 검증을 통과한 한 행. 아직 DB insert 전 상태.
 * `excelRowIndex` 는 1-based (사용자가 엑셀에서 보는 행 번호 — 헤더가 1, 첫 데이터가 2).
 */
export type ParsedRow = ProductInput & {
  /** 사용자가 엑셀에서 보는 1-based 행 번호. UI 에러 메시지·CSV 출력에 사용. */
  excelRowIndex: number
}

/** 파싱·검증 단계에서 발생한 에러. row 단위 또는 파일 단위. */
export type ParseError = {
  /** 어떤 종류의 에러인가 — UI 그룹핑·CSV 컬럼 분리에 사용 */
  kind:
    | 'header_missing' // 헤더 5컬럼 중 하나라도 누락 (파일 단위 에러)
    | 'empty_sheet' // 시트 자체가 비어있음
    | 'required_field' // 필수 필드 빈칸
    | 'invalid_type_value' // "구분" 값이 "단품"/"복합" 외
    | 'length_violation' // 길이 제한 위반
    | 'format_violation' // productCode 형식 위반 (영숫자/-/_ 만 허용)
    | 'duplicate_in_file' // 파일 내 productCode 중복 (두 번째 이후)
  /** 1-based 엑셀 행 번호. 파일 단위 에러는 null. */
  excelRowIndex: number | null
  /** 어느 필드에서 발생했는지 (UI 셀 강조에 사용). 파일 단위 에러는 null. */
  field: keyof ProductInput | null
  /** 사람이 읽는 한글 메시지. UI/Alert/CSV 에서 그대로 사용. */
  message: string
}

/** parseProductsXlsx 결과. */
export type ParseResult = {
  /** 검증 통과 + 중복 제거된 행. import 가능 상태. */
  rows: ParsedRow[]
  /** 행/파일 단위 에러 목록. UI 의 "형식 오류 (제외)" 카운트·미리보기 사유 셀에 사용. */
  errors: ParseError[]
}

/**
 * Server Action `importProducts` 의 응답 형태.
 * 본 파일은 P4 (파이프라인) 책임이므로 실제 Server Action 구현은 P5 가 만든다.
 * 본 타입은 클라이언트 헬퍼(`importProductsAction`)의 반환 shape 합의용 stub.
 */
export type ImportResult = {
  /** insert 성공 건수 */
  successCount: number
  /** DB 에 이미 존재하여 건너뛴 건수 (upsert OFF 시) */
  skippedCount: number
  /** insert 실패 건수 (예: 동시성 race, 외부 제약 위반) */
  failedCount: number
  /** 실패 행 상세 (CSV 다운로드용) */
  failures: Array<{
    productCode: string
    reason: string
  }>
}

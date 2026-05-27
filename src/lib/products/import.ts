/**
 * 클라이언트 측 import 헬퍼.
 *
 * 책임:
 *   1. ParsedRow[] → ProductInput[] 평탄화 (excelRowIndex 제거).
 *   2. Server Action `importProducts` 호출을 위한 thin wrapper.
 *
 * Server Action 본체는 P5(next-builder)가 구현한다 (DB 트랜잭션, upsert 토글,
 * unique_violation 캐치 등). 본 모듈은 그 호출 시그니처만 정의하고, 클라이언트가
 * 일관되게 호출할 수 있도록 한다.
 *
 * 파싱 자체는 클라이언트에서 (Vercel 함수 시간 회피, 큰 파일 즉시 미리보기) —
 * minus 와 동일 결정. Server 에는 POJO 인 ProductInput[] 만 전달한다.
 */

import type { ImportResult, ParsedRow, ProductInput } from './types'

/**
 * 검증을 통과한 ParsedRow[] 를 Server Action 에 보낼 ProductInput[] 로 변환.
 * `excelRowIndex` 는 사용자 UI 용 메타라 서버에 보내지 않는다.
 */
export function toProductInputs(parsed: ParsedRow[]): ProductInput[] {
  return parsed.map((p) => ({
    sabangnetCode: p.sabangnetCode,
    brandName: p.brandName,
    channelName: p.channelName,
    productCode: p.productCode,
    productName: p.productName,
    isComposite: p.isComposite,
  }))
}

/**
 * Server Action 시그니처. 실제 구현은 P5 (`src/lib/products/actions.ts`).
 * 본 타입은 클라이언트가 호출 시점에 사용할 인터페이스 합의용.
 */
export type ImportProductsAction = (
  inputs: ProductInput[],
  options?: { upsert?: boolean },
) => Promise<ImportResult>

/**
 * 클라이언트가 Dialog 안에서 호출하는 래퍼.
 * P5 에서 Server Action 을 import 해 전달.
 *
 * 큰 파일(수천 행) 대비 1,000 행씩 chunk 호출하여 부분 진행 표시를 가능하게 한다.
 * `onProgress` 가 주어지면 매 chunk 후 누적 결과를 콜백한다.
 */
export async function importProductsInChunks(
  inputs: ProductInput[],
  action: ImportProductsAction,
  options: {
    chunkSize?: number
    upsert?: boolean
    onProgress?: (done: number, total: number, partial: ImportResult) => void
  } = {},
): Promise<ImportResult> {
  const chunkSize = options.chunkSize ?? 1000
  const total = inputs.length
  const merged: ImportResult = {
    successCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  }
  for (let i = 0; i < inputs.length; i += chunkSize) {
    const chunk = inputs.slice(i, i + chunkSize)
    const result = await action(chunk, { upsert: options.upsert })
    merged.successCount += result.successCount
    merged.skippedCount += result.skippedCount
    merged.failedCount += result.failedCount
    merged.failures.push(...result.failures)
    options.onProgress?.(Math.min(i + chunk.length, total), total, merged)
  }
  return merged
}

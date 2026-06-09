/**
 * 클라이언트 → Server Action 청크 업로드 헬퍼.
 *
 * 파싱 결과(ProductMasterParseResult / ProductInfoParseResult)를 받아
 * "비우고 새로" 적재한다. 대량은 청크로 나눠 Server Action body 제한(1MB)을 회피.
 * UI 컴포넌트에서 호출하며, onProgress 로 진행률을 표시한다.
 */

import {
  insertGroupBundleChunk,
  insertGroupErpChunk,
  insertGroupMarketChunk,
  resetGroupErp,
  resetGroupMarketData,
} from './actions'
import type { ProductInfoParseResult, ProductMasterParseResult } from './types'

/** 한 청크 행 수. 마켓맵 6컬럼 × 2000 = 12,000 파라미터 (<65535), payload <1MB. */
const CHUNK_SIZE = 2000

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** 상품 마스터 raw 적재 — group_market_map + group_bundle_item 전체 교체. */
export async function uploadProductMasterData(
  parsed: ProductMasterParseResult,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = parsed.marketRows.length + parsed.bundleRows.length
  let done = 0
  await resetGroupMarketData()
  for (const c of chunk(parsed.marketRows, CHUNK_SIZE)) {
    await insertGroupMarketChunk(c)
    done += c.length
    onProgress?.(done, total)
  }
  for (const c of chunk(parsed.bundleRows, CHUNK_SIZE)) {
    await insertGroupBundleChunk(c)
    done += c.length
    onProgress?.(done, total)
  }
}

/** product_info 적재 — group_erp_code 전체 교체. */
export async function uploadProductInfoData(
  parsed: ProductInfoParseResult,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = parsed.erpRows.length
  let done = 0
  await resetGroupErp()
  for (const c of chunk(parsed.erpRows, CHUNK_SIZE)) {
    await insertGroupErpChunk(c)
    done += c.length
    onProgress?.(done, total)
  }
}

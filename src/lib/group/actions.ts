'use server'

import { db } from '@/db/client'
import {
  groupBundleItem,
  groupErpCode,
  groupMarketMap,
} from '@/db/schema'
import { sql } from 'drizzle-orm'
import type { BundleItemInput, ErpCodeInput, MarketMapInput } from './types'

/**
 * 그룹 매핑 소스 적재 Server Action.
 *
 * 상품 마스터 raw / product_info 는 매 업로드가 **전체 스냅샷**이므로 "비우고 새로" 적재한다.
 * 파싱은 클라이언트(브라우저)에서 끝내고, 결과 POJO 만 청크로 보내온다 (minus/products 와 동일).
 * Next.js Server Action body 제한(기본 1MB) 때문에 대량(마켓맵 ~10만 행)은 반드시 청크 호출.
 *
 * 호출 순서(클라이언트):
 *   상품 마스터 raw:  resetGroupMarketData() → insertGroupMarketChunk()* → insertGroupBundleChunk()*
 *   product_info:     resetGroupErp()        → insertGroupErpChunk()*
 */

/** group_market_map + group_bundle_item 비우기 (상품 마스터 raw 재적재 시작). */
export async function resetGroupMarketData(): Promise<void> {
  await db.execute(
    sql`truncate table ${groupMarketMap}, ${groupBundleItem} restart identity`,
  )
}

export async function insertGroupMarketChunk(
  rows: MarketMapInput[],
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 }
  await db.insert(groupMarketMap).values(rows)
  return { inserted: rows.length }
}

export async function insertGroupBundleChunk(
  rows: BundleItemInput[],
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 }
  await db.insert(groupBundleItem).values(rows)
  return { inserted: rows.length }
}

/** group_erp_code 비우기 (product_info 재적재 시작). */
export async function resetGroupErp(): Promise<void> {
  await db.execute(sql`truncate table ${groupErpCode} restart identity`)
}

export async function insertGroupErpChunk(
  rows: ErpCodeInput[],
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 }
  await db.insert(groupErpCode).values(rows)
  return { inserted: rows.length }
}

/** 현재 적재 현황(화면 "마지막 갱신: N건" 표시용). */
export type GroupSourceStatus = {
  marketCount: number
  bundleCount: number
  erpCount: number
  marketUpdatedAt: string | null
  erpUpdatedAt: string | null
}

export async function getGroupSourceStatus(): Promise<GroupSourceStatus> {
  const [market] = await db
    .select({
      count: sql<number>`count(*)::int`,
      updatedAt: sql<string | null>`max(${groupMarketMap.updatedAt})`,
    })
    .from(groupMarketMap)
  const [bundle] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groupBundleItem)
  const [erp] = await db
    .select({
      count: sql<number>`count(*)::int`,
      updatedAt: sql<string | null>`max(${groupErpCode.updatedAt})`,
    })
    .from(groupErpCode)

  return {
    marketCount: market?.count ?? 0,
    bundleCount: bundle?.count ?? 0,
    erpCount: erp?.count ?? 0,
    marketUpdatedAt: market?.updatedAt ?? null,
    erpUpdatedAt: erp?.updatedAt ?? null,
  }
}

'use server'

import { db } from '@/db/client'
import {
  groupBundleItem,
  groupErpCode,
  groupMarketMap,
} from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { buildGroupName, type GroupNameItem } from './name'
import type {
  NoMappingLine,
  OutputRow,
  ResolveResult,
  UnmappedLine,
} from './types'

/**
 * no_mapping 주문 목록 → group_upload 출력 행 + 미매핑 목록 해석.
 *
 * 매핑 체인: 마켓코드 → group_market_map → (단품) group_erp_code / (복합) group_bundle_item → group_erp_code.
 * 미매핑(A 정책): 시장맵 없음 / erp 없음 / 묶음 없음·내품 erp 없음 → 출력 제외 + 경고.
 * 그룹일련번호는 매핑 성공 행만 입력 순서대로 1..N 재부여(미매핑 제외 후에도 연번).
 *
 * DB 조회는 마켓코드/자체코드 단위 벌크 IN 으로 N+1 회피.
 */
export async function resolveGroupUpload(
  lines: NoMappingLine[],
): Promise<ResolveResult> {
  const inputCount = lines.length

  // 1) 마켓코드 dedup (첫 등장만, 순서 보존)
  const seen = new Set<string>()
  const deduped: NoMappingLine[] = []
  for (const l of lines) {
    if (seen.has(l.marketCode)) continue
    seen.add(l.marketCode)
    deduped.push(l)
  }
  const dupCount = inputCount - deduped.length

  if (deduped.length === 0) {
    return {
      rows: [],
      unmapped: [],
      stats: { inputCount, dupCount, groupCount: 0, rowCount: 0, unmappedCount: 0 },
    }
  }

  // 2) 마켓코드 벌크 조회
  const marketRows = await db
    .select({
      marketCode: groupMarketMap.marketCode,
      selfCode: groupMarketMap.selfCode,
      isComposite: groupMarketMap.isComposite,
      quantity: groupMarketMap.quantity,
    })
    .from(groupMarketMap)
    .where(inArray(groupMarketMap.marketCode, deduped.map((l) => l.marketCode)))
  const marketByCode = new Map(marketRows.map((m) => [m.marketCode, m]))

  // 3) 복합 자체코드의 내품 벌크 조회 → bundleSelfCode 별 순번 정렬
  const compositeSelfCodes = [
    ...new Set(
      marketRows
        .filter((m) => m.isComposite && m.selfCode)
        .map((m) => m.selfCode as string),
    ),
  ]
  const bundleBySelf = new Map<string, { seq: number; componentSelfCode: string; quantity: number }[]>()
  if (compositeSelfCodes.length > 0) {
    const items = await db
      .select({
        bundleSelfCode: groupBundleItem.bundleSelfCode,
        seq: groupBundleItem.seq,
        componentSelfCode: groupBundleItem.componentSelfCode,
        quantity: groupBundleItem.quantity,
      })
      .from(groupBundleItem)
      .where(inArray(groupBundleItem.bundleSelfCode, compositeSelfCodes))
    for (const it of items) {
      const arr = bundleBySelf.get(it.bundleSelfCode) ?? []
      arr.push({ seq: it.seq, componentSelfCode: it.componentSelfCode, quantity: it.quantity })
      bundleBySelf.set(it.bundleSelfCode, arr)
    }
    for (const arr of bundleBySelf.values()) arr.sort((a, b) => a.seq - b.seq)
  }

  // 4) 필요한 모든 자체코드(단품 self + 내품 self) erp 벌크 조회
  const neededSelfCodes = new Set<string>()
  for (const m of marketRows) {
    if (!m.selfCode) continue
    if (m.isComposite) {
      for (const c of bundleBySelf.get(m.selfCode) ?? []) neededSelfCodes.add(c.componentSelfCode)
    } else {
      neededSelfCodes.add(m.selfCode)
    }
  }
  const erpBySelf = new Map<string, { erpCode: string; erpName: string }>()
  if (neededSelfCodes.size > 0) {
    const erps = await db
      .select({
        selfCode: groupErpCode.selfCode,
        erpCode: groupErpCode.erpCode,
        erpName: groupErpCode.erpName,
      })
      .from(groupErpCode)
      .where(inArray(groupErpCode.selfCode, [...neededSelfCodes]))
    for (const e of erps) erpBySelf.set(e.selfCode, { erpCode: e.erpCode, erpName: e.erpName })
  }

  // 5) 입력 순서대로 그룹 빌드
  const rows: OutputRow[] = []
  const unmapped: UnmappedLine[] = []
  let groupNo = 0

  for (const line of deduped) {
    const m = marketByCode.get(line.marketCode)
    if (!m || !m.selfCode) {
      unmapped.push({ marketCode: line.marketCode, marketProductName: line.marketProductName, reason: '상품 마스터에 마켓코드 없음' })
      continue
    }

    // 내품 목록 구성 (단품=1개 / 묶음=내품들)
    type Comp = { selfCode: string; quantity: number; erpCode: string; erpName: string }
    const comps: Comp[] = []
    let failReason = ''

    if (!m.isComposite) {
      const e = erpBySelf.get(m.selfCode)
      if (!e) failReason = `단품 ERP 코드 없음 (자체코드 ${m.selfCode})`
      else comps.push({ selfCode: m.selfCode, quantity: m.quantity ?? 1, erpCode: e.erpCode, erpName: e.erpName })
    } else {
      const items = bundleBySelf.get(m.selfCode) ?? []
      if (items.length === 0) failReason = `묶음 구성 정보 없음 (자체코드 ${m.selfCode})`
      for (const c of items) {
        const e = erpBySelf.get(c.componentSelfCode)
        if (!e) { failReason = `묶음 내품 ERP 코드 없음 (자체코드 ${c.componentSelfCode})`; break }
        comps.push({ selfCode: c.componentSelfCode, quantity: c.quantity, erpCode: e.erpCode, erpName: e.erpName })
      }
    }

    if (failReason || comps.length === 0) {
      unmapped.push({ marketCode: line.marketCode, marketProductName: line.marketProductName, reason: failReason || '구성 항목 없음' })
      continue
    }

    groupNo++
    const groupName = buildGroupName({
      marketName: line.marketName,
      marketCode: line.marketCode,
      items: comps.map<GroupNameItem>((c) => ({ erpName: c.erpName, quantity: c.quantity })),
    })
    comps.forEach((c, i) => {
      rows.push({
        groupNo,
        groupName,
        seq: i + 1,
        erpCode: c.erpCode,
        erpName: c.erpName,
        quantity: c.quantity,
        selfCode: c.selfCode,
      })
    })
  }

  return {
    rows,
    unmapped,
    stats: {
      inputCount,
      dupCount,
      groupCount: groupNo,
      rowCount: rows.length,
      unmappedCount: unmapped.length,
    },
  }
}

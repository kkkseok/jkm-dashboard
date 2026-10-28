'use server'

import { db } from '@/db/client'
import { matchCheck, matchPair, matchRun, matchStatusLog } from '@/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Verdict } from './judge-rules'
import {
  MATCH_STATUSES,
  type MatchDashboard,
  type MatchDashboardRow,
  type MatchDetailImage,
  type MatchPairDetail,
  type MatchStatus,
} from './types'

/**
 * 이미지 대조 대시보드(/image-match) Server Action.
 *
 * 읽기: 목록·상태 집계·배치 현황·일별 토큰 사용량 / 쌍 상세(최근 수집·판정·이력).
 * 쓰기: 사용자 상태 전이 — 처리 완료, 판정 보류 확정, 삭제. 전이 가능 여부는 서버에서 다시 검사한다.
 * 상태 규칙: _workspace/01_design_image_match.md §5.
 */

const isStatus = (s: string): s is MatchStatus => (MATCH_STATUSES as readonly string[]).includes(s)
const iso = (d: Date | string | null): string | null =>
  d == null ? null : (d instanceof Date ? d : new Date(d)).toISOString()

/** 사용량 패널 기간(일). */
const USAGE_DAYS = 30

export async function getMatchDashboard(): Promise<MatchDashboard> {
  const pairs = await db.select().from(matchPair).orderBy(matchPair.matCode)
  const rows: MatchDashboardRow[] = pairs.map((p) => ({
    id: p.id,
    matCode: p.matCode,
    productName: p.productName,
    status: isStatus(p.status) ? p.status : 'new',
    diffSummary: p.diffSummary,
    statusChangedAt: iso(p.statusChangedAt)!,
    lastCheckedAt: iso(p.lastCheckedAt),
    lastJudgedAt: iso(p.lastJudgedAt),
    cjUrl: p.cjUrl,
    gsUrl: p.gsUrl,
  }))
  const byStatus = Object.fromEntries(MATCH_STATUSES.map((s) => [s, 0])) as Record<MatchStatus, number>
  for (const r of rows) byStatus[r.status]++

  const [lastRun] = await db.select().from(matchRun).orderBy(desc(matchRun.id)).limit(1)
  const [lastOk] = await db
    .select({
      finishedAt: matchRun.finishedAt,
      hours: sql<number>`(extract(epoch from now() - ${matchRun.finishedAt}) / 3600)::float8`,
    })
    .from(matchRun)
    .where(and(isNull(matchRun.error), sql`${matchRun.finishedAt} is not null`))
    .orderBy(desc(matchRun.id))
    .limit(1)

  const day = sql<string>`to_char(${matchRun.startedAt} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`
  const usage = await db
    .select({
      date: day,
      runs: sql<number>`count(*)::int`,
      judged: sql<number>`coalesce(sum(${matchRun.judged}), 0)::int`,
      inputTokens: sql<number>`coalesce(sum(${matchRun.inputTokens} + ${matchRun.cacheCreationTokens} + ${matchRun.cacheReadTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${matchRun.outputTokens}), 0)::bigint`,
      apiEquivUsd: sql<number>`coalesce(sum(${matchRun.apiEquivUsd}), 0)::float8`,
    })
    .from(matchRun)
    .where(sql`${matchRun.startedAt} >= now() - make_interval(days => ${USAGE_DAYS})`)
    .groupBy(day)
    .orderBy(desc(day))

  return {
    rows,
    byStatus,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: iso(lastRun.startedAt)!,
          finishedAt: iso(lastRun.finishedAt),
          total: lastRun.total,
          fetched: lastRun.fetched,
          failed: lastRun.failed,
          judged: lastRun.judged,
          deferred: lastRun.deferred,
          error: lastRun.error,
        }
      : null,
    lastSuccessAt: iso(lastOk?.finishedAt ?? null),
    hoursSinceSuccess: lastOk ? Number(lastOk.hours) : null,
    usage: usage.map((u) => ({
      ...u,
      inputTokens: Number(u.inputTokens),
      outputTokens: Number(u.outputTokens),
      apiEquivUsd: Number(u.apiEquivUsd),
    })),
  }
}

type StoredImage = { url: string; desc?: string; common?: boolean }

export async function getMatchPairDetail(pairId: number): Promise<MatchPairDetail> {
  const [p] = await db.select().from(matchPair).where(eq(matchPair.id, pairId))
  if (!p) throw new Error('대조 쌍을 찾을 수 없습니다.')

  const [latestAny] = await db
    .select({ fetchOk: matchCheck.fetchOk, fetchError: matchCheck.fetchError })
    .from(matchCheck)
    .where(eq(matchCheck.pairId, pairId))
    .orderBy(desc(matchCheck.id))
    .limit(1)
  const [ok] = await db
    .select()
    .from(matchCheck)
    .where(and(eq(matchCheck.pairId, pairId), eq(matchCheck.fetchOk, true)))
    .orderBy(desc(matchCheck.id))
    .limit(1)
  const [judged] = await db
    .select({ createdAt: matchCheck.createdAt, model: matchCheck.model, verdict: matchCheck.verdict })
    .from(matchCheck)
    .where(and(eq(matchCheck.pairId, pairId), eq(matchCheck.judged, true)))
    .orderBy(desc(matchCheck.id))
    .limit(1)
  const logs = await db
    .select()
    .from(matchStatusLog)
    .where(eq(matchStatusLog.pairId, pairId))
    .orderBy(desc(matchStatusLog.id))
    .limit(20)

  const toImages = (v: unknown): StoredImage[] => (Array.isArray(v) ? (v as StoredImage[]) : [])
  const strip = (d: StoredImage): MatchDetailImage => (d.desc ? { url: d.url, desc: d.desc } : { url: d.url })
  const gsAll = toImages(ok?.gsDetail)

  return {
    pair: {
      id: p.id,
      matCode: p.matCode,
      productName: p.productName,
      status: isStatus(p.status) ? p.status : 'new',
      diffSummary: p.diffSummary,
      statusChangedAt: iso(p.statusChangedAt)!,
      lastCheckedAt: iso(p.lastCheckedAt),
      lastJudgedAt: iso(p.lastJudgedAt),
      cjUrl: p.cjUrl,
      gsUrl: p.gsUrl,
      resolvedNote: p.resolvedNote,
    },
    latest: ok
      ? {
          checkedAt: iso(ok.createdAt)!,
          cjThumbUrl: ok.cjThumbUrl,
          gsThumbUrl: ok.gsThumbUrl,
          cjDetail: toImages(ok.cjDetail).map(strip),
          gsDetail: gsAll.filter((d) => !d.common).map(strip),
          gsCommonCount: gsAll.filter((d) => d.common).length,
        }
      : null,
    judged: judged?.verdict
      ? { judgedAt: iso(judged.createdAt)!, model: judged.model, verdict: judged.verdict as Verdict }
      : null,
    lastError: latestAny && !latestAny.fetchOk ? latestAny.fetchError : null,
    logs: logs.map((l) => ({
      at: iso(l.createdAt)!,
      from: l.fromStatus && isStatus(l.fromStatus) ? l.fromStatus : null,
      to: isStatus(l.toStatus) ? l.toStatus : 'new',
      actor: l.actor,
      note: l.note,
    })),
  }
}

/** 사용자 상태 전이 공통 — 현재 상태가 허용 목록에 있을 때만 바꾸고 이력을 남긴다. */
async function transition(
  pairId: number,
  allowedFrom: readonly MatchStatus[],
  to: MatchStatus,
  note: string,
  extra: Partial<typeof matchPair.$inferInsert> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ status: matchPair.status }).from(matchPair).where(eq(matchPair.id, pairId)).for('update')
    if (!p) throw new Error('대조 쌍을 찾을 수 없습니다.')
    if (!isStatus(p.status) || !allowedFrom.includes(p.status)) {
      throw new Error('현재 상태에서는 할 수 없는 작업입니다. 화면을 새로고침해 주세요.')
    }
    const now = new Date()
    await tx
      .update(matchPair)
      .set({ status: to, statusChangedAt: now, updatedAt: now, ...extra })
      .where(eq(matchPair.id, pairId))
    await tx.insert(matchStatusLog).values({ pairId, fromStatus: p.status, toStatus: to, actor: 'user', note: note || null })
  })
}

/** 처리 완료 — GS 를 고친 뒤 표시. 다음 배치가 다시 확인해 일치/미반영으로 바꾼다. */
export async function markMatchDone(pairId: number, note: string): Promise<void> {
  const memo = note.trim().slice(0, 500)
  await transition(pairId, ['diff', 'unfixed'], 'done', memo, { resolvedNote: memo || null })
}

/** 판정 보류 확정 — 사람이 보고 일치/불일치로 정한다. */
export async function resolveMatchUnsure(pairId: number, to: 'match' | 'diff', note: string): Promise<void> {
  if (to !== 'match' && to !== 'diff') throw new Error('잘못된 상태입니다.')
  await transition(pairId, ['unsure'], to, note.trim().slice(0, 500) || '사용자 확정')
}

/** 대조 대상 삭제 — 수집·판정·이력도 함께 지워진다(FK cascade). */
export async function deleteMatchPair(pairId: number): Promise<void> {
  await db.delete(matchPair).where(eq(matchPair.id, pairId))
}

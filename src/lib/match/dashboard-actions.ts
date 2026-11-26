'use server'

import { db } from '@/db/client'
import { matchCheck, matchPair, matchRun, matchStatusLog } from '@/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { diffImageList } from './gate'
import type { Verdict } from './judge-rules'
import {
  MATCH_STATUSES,
  type MatchDashboard,
  type MatchDashboardRow,
  type MatchDetailImage,
  type MatchPairDetail,
  type MatchRunSummary,
  type MatchStatus,
  RUN_STALE_HOURS,
} from './types'

/**
 * 이미지 대조 대시보드(/image-match) Server Action.
 *
 * 읽기: 목록·상태 집계·배치 현황 / 쌍 상세(최근 수집·판정·이력).
 * 쓰기: 사용자 상태 전이 — 처리 완료, 판정 보류 확정, 삭제. 전이 가능 여부는 서버에서 다시 검사한다.
 * 상태 규칙: _workspace/01_design_image_match.md §5.
 */

const isStatus = (s: string): s is MatchStatus => (MATCH_STATUSES as readonly string[]).includes(s)
const iso = (d: Date | string | null): string | null =>
  d == null ? null : (d instanceof Date ? d : new Date(d)).toISOString()

/** 지금 돌고 있는 실행, 없으면 가장 최근 배치 실행 1건 — 경과 시간·진행 중 여부는 DB now() 기준으로 계산한다. */
async function latestRun(): Promise<MatchRunSummary | null> {
  const [row] = await db
    .select({
      run: matchRun,
      elapsedSec: sql<number>`extract(epoch from coalesce(${matchRun.finishedAt}, now()) - ${matchRun.startedAt})::float8`,
    })
    .from(matchRun)
    // 돌고 있는 실행이 있으면 그것을 먼저 — 그 사이 다른 실행(로컬 단건 등)이 끝나도 진행 표시가 가려지지 않게.
    .orderBy(
      sql`(${matchRun.finishedAt} is null and ${matchRun.startedAt} > now() - make_interval(secs => ${RUN_STALE_HOURS * 3600})) desc`,
      desc(matchRun.id),
    )
    .limit(1)
  if (!row) return null
  const r = row.run
  const elapsedSec = Math.max(0, Math.round(Number(row.elapsedSec)))
  const open = r.finishedAt == null
  const fresh = elapsedSec < RUN_STALE_HOURS * 3600
  return {
    id: r.id,
    startedAt: iso(r.startedAt)!,
    finishedAt: iso(r.finishedAt),
    total: r.total,
    fetched: r.fetched,
    failed: r.failed,
    judged: r.judged,
    deferred: r.deferred,
    error: r.error,
    toJudge: r.toJudge,
    elapsedSec,
    running: open && fresh,
    stalled: open && !fresh,
  }
}

/** 진행 표시용 — 화면이 실행 중에 몇 초마다 부른다. */
export async function getMatchRunProgress(): Promise<MatchRunSummary | null> {
  return latestRun()
}

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
    humanDecidedAt: iso(p.humanDecidedAt),
    cjUrl: p.cjUrl,
    gsUrl: p.gsUrl,
  }))
  const byStatus = Object.fromEntries(MATCH_STATUSES.map((s) => [s, 0])) as Record<MatchStatus, number>
  for (const r of rows) byStatus[r.status]++
  const lastRegisteredAt = pairs.reduce<Date | null>((m, p) => (!m || p.createdAt > m ? p.createdAt : m), null)

  const lastRun = await latestRun()
  const [lastOk] = await db
    .select({
      finishedAt: matchRun.finishedAt,
      hours: sql<number>`(extract(epoch from now() - ${matchRun.finishedAt}) / 3600)::float8`,
    })
    .from(matchRun)
    .where(and(isNull(matchRun.error), sql`${matchRun.finishedAt} is not null`))
    .orderBy(desc(matchRun.id))
    .limit(1)

  return {
    rows,
    byStatus,
    lastRun,
    lastSuccessAt: iso(lastOk?.finishedAt ?? null),
    hoursSinceSuccess: lastOk ? Number(lastOk.hours) : null,
    lastRegisteredAt: iso(lastRegisteredAt),
  }
}

type StoredImage = { url: string; desc?: string; hash?: string | null; common?: boolean }

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
  // 최근 판정 2건 — [0] 은 현재 판정, 이미지 변경 표시의 기준은 둘 중 "지금과 이미지가 달랐던" 최근 판정.
  const judgedChecks = await db
    .select()
    .from(matchCheck)
    .where(and(eq(matchCheck.pairId, pairId), eq(matchCheck.judged, true)))
    .orderBy(desc(matchCheck.id))
    .limit(2)
  const judged = judgedChecks.at(0)
  const logs = await db
    .select()
    .from(matchStatusLog)
    .where(eq(matchStatusLog.pairId, pairId))
    .orderBy(desc(matchStatusLog.id))
    .limit(20)

  const toImages = (v: unknown): StoredImage[] => (Array.isArray(v) ? (v as StoredImage[]) : [])
  const gsAll = toImages(ok?.gsDetail)
  const cjShown = toImages(ok?.cjDetail)
  const gsShown = gsAll.filter((d) => !d.common)

  // 이미지 변경 표시: 기준 = 지금과 해시가 다른 가장 최근 판정. 대기 중인 재판정이면 "판정 이후 바뀐 것",
  // 이미 재판정됐으면 "그 판정을 일으킨 변경"이 된다.
  const hashes = (list: StoredImage[]) => list.map((d) => d.hash ?? null)
  const base = ok
    ? judgedChecks.find(
        (j) =>
          j.id !== ok.id &&
          (j.cjThumbHash !== ok.cjThumbHash ||
            j.gsThumbHash !== ok.gsThumbHash ||
            j.cjDetailHash !== ok.cjDetailHash ||
            j.gsDetailHash !== ok.gsDetailHash),
      )
    : undefined
  // GS 기준 목록은 공통 이미지도 포함한다 — 공통 판정만 바뀐 이미지를 새 이미지로 잘못 표시하지 않게.
  const cjDiff = base ? diffImageList(hashes(cjShown), hashes(toImages(base.cjDetail))) : null
  const gsDiff = base ? diffImageList(hashes(gsShown), hashes(toImages(base.gsDetail))) : null
  const strip = (d: StoredImage, changed: boolean | undefined): MatchDetailImage => ({
    url: d.url,
    ...(d.desc && { desc: d.desc }),
    ...(changed && { changed: true }),
  })

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
      humanDecidedAt: iso(p.humanDecidedAt),
      cjUrl: p.cjUrl,
      gsUrl: p.gsUrl,
      resolvedNote: p.resolvedNote,
    },
    latest: ok
      ? {
          checkedAt: iso(ok.createdAt)!,
          cjThumbUrl: ok.cjThumbUrl,
          gsThumbUrl: ok.gsThumbUrl,
          cjDetail: cjShown.map((d, i) => strip(d, cjDiff?.changed[i])),
          gsDetail: gsShown.map((d, i) => strip(d, gsDiff?.changed[i])),
          gsCommonCount: gsAll.filter((d) => d.common).length,
          changes:
            base && cjDiff && gsDiff
              ? {
                  since: iso(base.createdAt)!,
                  cjThumb: base.cjThumbHash !== ok.cjThumbHash,
                  gsThumb: base.gsThumbHash !== ok.gsThumbHash,
                  cjRemoved: cjDiff.removed,
                  gsRemoved: gsDiff.removed,
                }
              : null,
        }
      : null,
    judged: judged?.verdict
      ? // 판정에 쓴 모델 이름은 화면에 내보내지 않는다(DB match_check.model 에만 남긴다).
        { judgedAt: iso(judged.createdAt)!, verdict: judged.verdict as Verdict }
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

/**
 * 확인자 판정 — 판정 보류를 확정하거나, AI 판정(일치/불일치/미반영)을 사람이 정정한다.
 * humanDecidedAt 을 남겨, 이후 판정 규칙이 바뀌어도 이 쌍은 재판정하지 않는다(이미지가 바뀌면 재판정).
 */
export async function decideMatchByHuman(pairId: number, to: 'match' | 'diff', note: string): Promise<void> {
  if (to !== 'match' && to !== 'diff') throw new Error('잘못된 상태입니다.')
  const memo = note.trim().slice(0, 500)
  await transition(
    pairId,
    ['unsure', 'match', 'diff', 'unfixed', 'done'],
    to,
    `확인자 판정: ${to === 'match' ? '같은 상품' : '다름'}${memo ? ` — ${memo}` : ''}`,
    { humanDecidedAt: new Date() },
  )
}

/** 대조 대상 삭제 — 수집·판정·이력도 함께 지워진다(FK cascade). */
export async function deleteMatchPair(pairId: number): Promise<void> {
  await db.delete(matchPair).where(eq(matchPair.id, pairId))
}

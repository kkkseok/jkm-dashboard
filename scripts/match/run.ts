/**
 * 이미지 대조 배치: 수집 → 공통 이미지 제외 → 해시 게이트 → AI 판정 → 기록.
 *
 * 흐름: match_pair 전체 → CJ/GS 페이지 수집 → 이미지 해시 → GS 공통 이미지 판별
 *       → 판정 기준(마지막 AI 판정 check) 대비 변경 여부 → 바뀐 쌍만 `claude -p` 판정(./judge.ts)
 *       → match_check 기록(토큰 사용량 포함) · 상태 전이 · match_run 합계.
 * 설계: _workspace/01_design_image_match.md
 *
 * 실행: `pnpm tsx scripts/match/run.ts [--only 자재코드,…] [--full] [--no-judge] [--judge-model sonnet] [--judge-limit 30]`
 *   --only         지정한 자재코드만 처리 (공통 이미지는 DB 에 저장된 목록을 사용)
 *   --full         상세 이미지 URL 캐시를 쓰지 않고 전부 다시 내려받는다
 *   --no-judge     수집·게이트만 (판정 필요 쌍은 다음 실행으로 미룸)
 *   --judge-model  판정 모델 (기본 MATCH_JUDGE_MODEL 또는 sonnet)
 *   --judge-limit  1회 판정 상한 (기본 MATCH_JUDGE_LIMIT 또는 30) — 넘는 쌍은 다음 실행으로
 * 환경변수: DATABASE_URL_UNPOOLED (Supabase Session Pooler 5432)
 *           판정 인증은 Claude Code 구독(로컬 로그인 / Actions 는 CLAUDE_CODE_OAUTH_TOKEN)
 *
 * 로그는 GitHub Actions(공개 저장소)에서 공개되므로 자재코드·건수만 찍는다.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, desc, eq, inArray } from 'drizzle-orm'
import * as schema from '../../src/db/schema'
import { matchCheck, matchCommonImage, matchPair, matchRun, matchStatusLog } from '../../src/db/schema'
import {
  describePage,
  extractCjDetail,
  extractCjThumb,
  extractGsDescUrl,
  extractGsDetail,
  extractGsThumb,
  type DetailImageRef,
} from '../../src/lib/match/extract'
import {
  combineHashes,
  decide,
  findCommonHashes,
  sha256,
  mergeVerdict,
  statusAfterVerdict,
  type GateDecision,
  type HashChanges,
  type SideHashes,
} from '../../src/lib/match/gate'
import { RULES_VERSION, type Verdict } from '../../src/lib/match/judge-rules'
import { judgePair, type JudgeResult } from './judge'
import { MATCH_STATUSES, type MatchStatus } from '../../src/lib/match/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
/** 동시 요청 수 — 사이트 부하·차단 방지. */
const CONCURRENCY = 4
const TIMEOUT_MS = 20_000
const RETRIES = 2
/** 공통 이미지: 활성 GS 상품의 30% 이상(최소 3개)에 등장. 수집 상품이 적으면 DB 목록 사용. */
const COMMON = { ratio: 0.3, minCount: 3, minProducts: 10 }
/** AI 판정 — 구독 사용량을 평소 대화형 사용과 공유하므로 1회 상한을 둔다. 첫 500쌍 기준 판정은 며칠에 나눠 진행. */
const DEFAULT_JUDGE_MODEL = 'sonnet'
const DEFAULT_JUDGE_LIMIT = 30
const JUDGE_CONCURRENCY = 2

type DetailImage = DetailImageRef & { hash: string | null; common?: boolean }

type Collected = {
  cjThumbUrl: string
  gsThumbUrl: string
  cjThumbHash: string
  gsThumbHash: string
  cjDetail: DetailImage[]
  gsDetail: DetailImage[]
}

// ── 요청 ─────────────────────────────────────────────

/** 동시 실행 수 제한. */
function limiter(n: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}
const limit = limiter(CONCURRENCY)

async function request(url: string, referer?: string): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await limit(() =>
        fetch(url, {
          headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      )
      if (res.ok) return res
      lastErr = new Error(`HTTP ${res.status}`)
      if (res.status === 404) break // 재시도해도 같음
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * GS샵 페이지는 해외 IP 에 오류 페이지를 준다 → MATCH_GS_PROXY_URL 이 있으면 서울 리전 중계
 * (src/app/api/match/gs-page) 를 거친다. 로컬(국내)에서는 비워 두면 직접 요청.
 */
const GS_PROXY = process.env.MATCH_GS_PROXY_URL
const GS_PAGE_RE = /^https:\/\/www\.gsshop\.com\//

async function getText(url: string, referer?: string): Promise<string> {
  if (GS_PROXY && GS_PAGE_RE.test(url)) {
    const q = new URLSearchParams({ url, ...(referer ? { referer } : {}) })
    const res = await limit(() =>
      fetch(`${GS_PROXY}?${q}`, {
        headers: { 'x-match-proxy-key': process.env.MATCH_PROXY_KEY ?? '' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    )
    if (!res.ok) throw new Error(`GS 중계 HTTP ${res.status} (${res.headers.get('x-proxy-region') ?? '-'})`)
    return res.text()
  }
  return (await request(url, referer)).text()
}
const getHash = async (url: string, referer?: string) =>
  sha256(new Uint8Array(await (await request(url, referer)).arrayBuffer()))

/** 상세 이미지 해시. 같은 URL 은 직전 수집 해시를 재사용(cache) — CJ 는 업로드마다 새 파일명, GS 는 리소스별 토큰 URL. */
async function hashDetail(
  refs: DetailImageRef[],
  cache: Map<string, string>,
  referer?: string,
): Promise<DetailImage[]> {
  return Promise.all(
    refs.map(async (r) => {
      const cached = cache.get(r.url)
      if (cached) return { ...r, hash: cached }
      try {
        return { ...r, hash: await getHash(r.url, referer) }
      } catch {
        return { ...r, hash: null } // 깨진 이미지도 "상태"로 기록 → combineHashes 에서 missing
      }
    }),
  )
}

async function collect(
  pair: { cjUrl: string; gsUrl: string },
  cache: Map<string, string>,
): Promise<Collected> {
  const [cjHtml, gsHtml] = await Promise.all([getText(pair.cjUrl), getText(pair.gsUrl)])
  const cjThumbUrl = extractCjThumb(cjHtml)
  if (!cjThumbUrl) throw new Error(`CJ 썸네일(og:image) 없음 — ${describePage(cjHtml)}`)
  const gsThumbUrl = extractGsThumb(gsHtml)
  if (!gsThumbUrl) throw new Error(`GS 썸네일(og:image) 없음 — ${describePage(gsHtml)}`)
  const gsDescUrl = extractGsDescUrl(gsHtml)
  if (!gsDescUrl) throw new Error(`GS 상세 iframe 없음 — ${describePage(gsHtml)}`)

  const cjRefs = extractCjDetail(cjHtml)
  const gsRefs = extractGsDetail(await getText(gsDescUrl, pair.gsUrl))
  if (gsRefs.length === 0) throw new Error('GS 상세 이미지 0장')

  // 썸네일은 URL 이 고정(GS /prod/{id}/1/1000)이라 캐시 없이 매번 내려받는다.
  const [cjThumbHash, gsThumbHash, cjDetail, gsDetail] = await Promise.all([
    getHash(cjThumbUrl),
    getHash(gsThumbUrl, pair.gsUrl),
    hashDetail(cjRefs, cache),
    hashDetail(gsRefs, cache, pair.gsUrl),
  ])
  return { cjThumbUrl, gsThumbUrl, cjThumbHash, gsThumbHash, cjDetail, gsDetail }
}

// ── 메인 ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  return {
    only: value('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
    full: args.includes('--full'),
    judge: !args.includes('--no-judge'),
    judgeModel: value('--judge-model') ?? process.env.MATCH_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
    judgeLimit: Number(value('--judge-limit') ?? process.env.MATCH_JUDGE_LIMIT ?? DEFAULT_JUDGE_LIMIT),
  }
}
type Opts = ReturnType<typeof parseArgs>

const isStatus = (s: string): s is MatchStatus => (MATCH_STATUSES as readonly string[]).includes(s)

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set.')
  const sql = postgres(url, { max: 4 })
  const db = drizzle(sql, { schema })
  const opts = parseArgs()
  const { only, full } = opts

  const pairs = await db
    .select()
    .from(matchPair)
    .where(only ? inArray(matchPair.matCode, only) : undefined)
    .orderBy(matchPair.id)
  const [run] = await db.insert(matchRun).values({ total: pairs.length }).returning({ id: matchRun.id })
  console.log(`[run ${run.id}] 대상 ${pairs.length}쌍${full ? ' (--full)' : ''}`)
  try {
    await processRun(db, run.id, pairs, opts)
  } catch (e) {
    // 실패를 숨기지 않는다 — match_run 에 남기고 프로세스도 실패로 끝낸다(Actions 빨간불).
    await db
      .update(matchRun)
      .set({ finishedAt: new Date(), error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) })
      .where(eq(matchRun.id, run.id))
    throw e
  } finally {
    await sql.end()
  }
}

type Db = ReturnType<typeof drizzle<typeof schema>>
type PairRow = typeof matchPair.$inferSelect

async function processRun(db: Db, runId: number, pairs: PairRow[], opts: Opts) {
  const run = { id: runId }
  const { full } = opts

  // 쌍별 직전 정상 check(URL→해시 캐시) / 마지막 판정 check(baseline)
  const pairIds = pairs.map((p) => p.id)
  const prevChecks = pairIds.length
    ? await db
        .select()
        .from(matchCheck)
        .where(and(inArray(matchCheck.pairId, pairIds), eq(matchCheck.fetchOk, true)))
        .orderBy(desc(matchCheck.createdAt))
    : []
  const lastOk = new Map<number, (typeof prevChecks)[number]>()
  const lastJudged = new Map<number, (typeof prevChecks)[number]>()
  for (const c of prevChecks) {
    if (!lastOk.has(c.pairId)) lastOk.set(c.pairId, c)
    if (c.judged && !lastJudged.has(c.pairId)) lastJudged.set(c.pairId, c)
  }

  // 1) 수집
  const results = new Map<number, Collected | Error>()
  let done = 0
  await Promise.all(
    pairs.map(async (p) => {
      const cache = new Map<string, string>()
      const prev = lastOk.get(p.id)
      if (prev && !full) {
        for (const img of [...((prev.cjDetail as DetailImage[]) ?? []), ...((prev.gsDetail as DetailImage[]) ?? [])]) {
          if (img.hash) cache.set(img.url, img.hash)
        }
      }
      try {
        results.set(p.id, await collect(p, cache))
      } catch (e) {
        results.set(p.id, e instanceof Error ? e : new Error(String(e)))
      }
      done++
      if (done % 20 === 0 || done === pairs.length) console.log(`  수집 ${done}/${pairs.length}`)
    }),
  )

  // 2) GS 공통 이미지 — 이번 수집이 충분하면 새로 계산해 저장, 아니면 DB 목록 사용
  const okResults = [...results.values()].filter((r): r is Collected => !(r instanceof Error))
  let common: Set<string>
  if (okResults.length >= COMMON.minProducts) {
    const counted = findCommonHashes(
      okResults.map((r) => r.gsDetail.map((d) => d.hash)),
      COMMON,
    )
    common = new Set(counted.keys())
    await db.transaction(async (tx) => {
      await tx.delete(matchCommonImage)
      if (counted.size > 0) {
        await tx
          .insert(matchCommonImage)
          .values([...counted].map(([hash, occurrences]) => ({ hash, occurrences })))
      }
    })
    console.log(`  공통 이미지 ${common.size}종 갱신 (GS ${okResults.length}개 기준)`)
  } else {
    common = new Set((await db.select({ hash: matchCommonImage.hash }).from(matchCommonImage)).map((r) => r.hash))
    console.log(`  공통 이미지 ${common.size}종 (DB 목록 사용 — 수집 ${okResults.length}개 < ${COMMON.minProducts})`)
  }

  // 3) 게이트
  const now = new Date()
  const tally = {
    fetched: 0,
    failed: 0,
    toJudge: 0,
    judged: 0,
    deferred: 0,
    judgeFailed: 0,
    keep: 0,
    unfixed: 0,
    changedSincePrev: 0,
  }
  const logStatus = (pairId: number, from: MatchStatus, to: MatchStatus, note: string) =>
    db.insert(matchStatusLog).values({ pairId, fromStatus: from, toStatus: to, actor: 'batch', note: note.slice(0, 300) })

  type Entry = {
    p: PairRow
    status: MatchStatus
    r: Collected
    gsDetail: DetailImage[]
    current: SideHashes
    decision: GateDecision
    /** 기준(마지막 판정) 대비 해시 변경 — 재판정 시 바뀐 영역만 새 판정을 받는 데 쓴다. */
    changes: HashChanges | null
    prevVerdict: Verdict | null
    judge?: JudgeResult
  }
  const entries: Entry[] = []

  for (const p of pairs) {
    const r = results.get(p.id)!
    let status: MatchStatus = isStatus(p.status) ? p.status : 'new'

    if (r instanceof Error) {
      tally.failed++
      await db.insert(matchCheck).values({ pairId: p.id, runId: run.id, fetchOk: false, fetchError: r.message.slice(0, 500) })
      if (status !== 'error') await logStatus(p.id, status, 'error', r.message)
      await db
        .update(matchPair)
        .set({ status: 'error', statusChangedAt: status === 'error' ? p.statusChangedAt : now, lastCheckedAt: now, updatedAt: now })
        .where(eq(matchPair.id, p.id))
      console.log(`  ${p.matCode} 수집 실패: ${r.message.slice(0, 120)}`)
      continue
    }
    tally.fetched++

    // 수집 실패에서 회복 → 실패 직전 상태로 복원
    if (status === 'error') {
      const [log] = await db
        .select({ from: matchStatusLog.fromStatus })
        .from(matchStatusLog)
        .where(and(eq(matchStatusLog.pairId, p.id), eq(matchStatusLog.toStatus, 'error')))
        .orderBy(desc(matchStatusLog.createdAt))
        .limit(1)
      const restored = log?.from && isStatus(log.from) && log.from !== 'error' ? log.from : 'new'
      await logStatus(p.id, status, restored, '수집 회복')
      status = restored
    }

    const gsDetail = r.gsDetail.map((d) => (d.hash && common.has(d.hash) ? { ...d, common: true } : d))
    const current: SideHashes = {
      cjThumb: r.cjThumbHash,
      gsThumb: r.gsThumbHash,
      cjDetail: combineHashes(r.cjDetail.map((d) => d.hash)),
      gsDetail: combineHashes(gsDetail.filter((d) => !d.common).map((d) => d.hash)),
    }
    const toSide = (c: (typeof prevChecks)[number] | undefined): SideHashes | null =>
      c && c.cjThumbHash && c.gsThumbHash && c.cjDetailHash && c.gsDetailHash
        ? { cjThumb: c.cjThumbHash, gsThumb: c.gsThumbHash, cjDetail: c.cjDetailHash, gsDetail: c.gsDetailHash }
        : null

    const prevSide = toSide(lastOk.get(p.id))
    if (prevSide && JSON.stringify(prevSide) !== JSON.stringify(current)) tally.changedSincePrev++

    const baseline = lastJudged.get(p.id)
    // 확인자가 직접 정한 쌍은 규칙 변경만으로는 재판정하지 않는다(이미지가 바뀌면 재판정) — 사용자 확정 2026-10-28.
    const rulesChanged = !!baseline && baseline.rulesVersion !== RULES_VERSION && !p.humanDecidedAt
    const { decision, changes } = decide(status, toSide(baseline), current, rulesChanged)
    if (decision.kind === 'judge') tally.toJudge++
    else if (decision.kind === 'keep') tally.keep++
    else {
      tally.unfixed++
      await logStatus(p.id, status, 'unfixed', '처리 완료 후 변경 없음')
      status = 'unfixed'
    }
    entries.push({
      p,
      status,
      r,
      gsDetail,
      current,
      decision,
      changes,
      prevVerdict: (baseline?.verdict as Verdict | null) ?? null,
    })
    console.log(
      `  ${p.matCode} CJ 상세 ${r.cjDetail.length}장 · GS 상세 ${gsDetail.length}장(공통 ${gsDetail.filter((d) => d.common).length}) → ${decision.kind}${decision.kind === 'judge' ? `(${decision.reason})` : ''}`,
    )
  }

  // 4) AI 판정 — 1회 상한까지, 동시 JUDGE_CONCURRENCY. 한도·인증 오류가 나면 남은 쌍은 다음 실행으로 미룬다.
  const queue = opts.judge ? entries.filter((e) => e.decision.kind === 'judge').slice(0, opts.judgeLimit) : []
  let stopJudging = false
  async function judgeWorker() {
    for (let e = queue.shift(); e && !stopJudging; e = queue.shift()) {
      try {
        e.judge = await judgePair(
          {
            cjThumbUrl: e.r.cjThumbUrl,
            gsThumbUrl: e.r.gsThumbUrl,
            gsPageUrl: e.p.gsUrl,
            cjDetail: e.r.cjDetail,
            gsDetail: e.gsDetail.filter((d) => !d.common),
          },
          opts.judgeModel,
        )
        // 바뀐 영역만 새 판정 — 안 바뀐 영역은 직전 판정 유지(AI 판정 흔들림 방지)
        e.judge.verdict = mergeVerdict(e.prevVerdict, e.judge.verdict, e.changes)
        const v = e.judge.verdict
        console.log(`  ${e.p.matCode} 판정 ${v.thumbnail}/${v.detail} (${Math.round(e.judge.usage.judgeMs / 1000)}s)`)
      } catch (err) {
        tally.judgeFailed++
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  ${e.p.matCode} 판정 실패: ${msg.slice(0, 160)}`)
        if (/limit|quota|rate|usage|credit|overloaded|auth/i.test(msg)) stopJudging = true
      }
    }
  }
  if (queue.length > 0) {
    console.log(`  판정 ${queue.length}쌍 (모델 ${opts.judgeModel}, 상한 ${opts.judgeLimit})`)
    await Promise.all(Array.from({ length: JUDGE_CONCURRENCY }, judgeWorker))
  }

  // 5) 기록
  const sum = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, apiEquivUsd: 0 }
  for (const e of entries) {
    const { p, r, current, judge } = e
    let status = e.status
    if (judge) {
      tally.judged++
      const next = statusAfterVerdict(status, judge.verdict)
      if (next !== status) await logStatus(p.id, status, next, judge.verdict.summary)
      status = next
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += judge.usage[k]
    } else if (e.decision.kind === 'judge') {
      tally.deferred++
    }

    await db.insert(matchCheck).values({
      pairId: p.id,
      runId: run.id,
      fetchOk: true,
      cjThumbUrl: r.cjThumbUrl,
      gsThumbUrl: r.gsThumbUrl,
      cjThumbHash: current.cjThumb,
      gsThumbHash: current.gsThumb,
      cjDetailHash: current.cjDetail,
      gsDetailHash: current.gsDetail,
      cjDetail: r.cjDetail,
      gsDetail: e.gsDetail,
      judged: !!judge,
      ...(judge && {
        verdict: judge.verdict,
        rulesVersion: RULES_VERSION,
        model: judge.usage.model,
        inputTokens: judge.usage.inputTokens,
        outputTokens: judge.usage.outputTokens,
        cacheCreationTokens: judge.usage.cacheCreationTokens,
        cacheReadTokens: judge.usage.cacheReadTokens,
        apiEquivUsd: judge.usage.apiEquivUsd.toFixed(4),
        judgeMs: judge.usage.judgeMs,
      }),
    })
    await db
      .update(matchPair)
      .set({
        status,
        statusChangedAt: p.status === status ? p.statusChangedAt : now,
        lastCheckedAt: now,
        lastSuccessAt: now,
        updatedAt: now,
        // AI 가 다시 판정했으면(= 이미지 변경 또는 첫 판정) 확인자 판정 표시는 지운다.
        ...(judge && { lastJudgedAt: now, diffSummary: judge.verdict.summary, humanDecidedAt: null }),
      })
      .where(eq(matchPair.id, p.id))
  }

  await db
    .update(matchRun)
    .set({
      finishedAt: new Date(),
      fetched: tally.fetched,
      failed: tally.failed,
      judged: tally.judged,
      deferred: tally.deferred,
      inputTokens: sum.inputTokens,
      outputTokens: sum.outputTokens,
      cacheCreationTokens: sum.cacheCreationTokens,
      cacheReadTokens: sum.cacheReadTokens,
      apiEquivUsd: sum.apiEquivUsd.toFixed(4),
      error:
        tally.judgeFailed > 0
          ? `판정 실패 ${tally.judgeFailed}건${stopJudging ? ' (한도·인증 오류로 중단)' : ''}`
          : null,
    })
    .where(eq(matchRun.id, run.id))
  console.log(
    `[run ${run.id}] 수집 ${tally.fetched} · 실패 ${tally.failed} · 직전 대비 변경 ${tally.changedSincePrev} · 판정 필요 ${tally.toJudge} → 판정 ${tally.judged} / 미룸 ${tally.deferred} (판정 실패 ${tally.judgeFailed}) · 유지 ${tally.keep} · 미반영 전환 ${tally.unfixed}`,
  )
  console.log(
    `  토큰 입력 ${sum.inputTokens} · 출력 ${sum.outputTokens} · 캐시생성 ${sum.cacheCreationTokens} · 캐시읽기 ${sum.cacheReadTokens} · API 환산 $${sum.apiEquivUsd.toFixed(2)}`,
  )

  // 수집이 절반 이상 실패하면 차단·구조 변경 같은 전면 장애 — 실행 자체를 실패로 끝내 Actions 에서 바로 보이게 한다.
  // (개별 상품 몇 개의 실패는 해당 쌍의 '수집 실패' 상태로만 남긴다.)
  if (pairs.length > 0 && tally.failed * 2 >= pairs.length) {
    throw new Error(`수집 실패 ${tally.failed}/${pairs.length} — 사이트 차단 또는 페이지 구조 변경 의심`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

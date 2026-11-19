/**
 * 정렬 선별 리포트 — 쌍별로 상세 구간 중 몇 개가 AI 에 가는지 본다. **DB 는 읽기만 하고 아무것도 기록하지 않는다.**
 *
 * 최근 정상 수집(match_check)의 이미지 URL 로 실제 판정 경로(judge.buildContent)를 그대로 태운다.
 *   기본        AI 호출 없음 — 구간 수·대응률만 출력
 *   --judge     AI 판정까지 실행해 DB 에 저장된 마지막 판정과 나란히 출력(구독 사용량 소모, DB 기록 없음)
 *               MATCH_VERIFY=on 이면 근거 재검증까지 하고 차이별 결과를 함께 출력
 *
 * 실행: pnpm tsx scripts/match/align-report.ts [--only 자재코드,…] [--judge] [--judge-model sonnet]
 *       이 스크립트는 정렬 선별을 켠 상태(MATCH_ALIGN=on)로 본다. MATCH_ALIGN=off 를 주면 전 구간(비교용).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.MATCH_ALIGN ??= 'on'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, desc, eq, inArray } from 'drizzle-orm'
import * as schema from '../../src/db/schema'
import { matchCheck, matchPair } from '../../src/db/schema'
import type { Verdict } from '../../src/lib/match/judge-rules'
import { buildContent, judgePair, type JudgeInput } from './judge'

type Img = { url: string; desc?: string; hash: string | null; common?: boolean }

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4)

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set.')
  const args = process.argv.slice(2)
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const only = value('--only')?.split(',') ?? null
  const judge = args.includes('--judge')
  const model = value('--judge-model') ?? 'sonnet'

  const sql = postgres(url, { max: 2 })
  const db = drizzle(sql, { schema })
  try {
    const pairs = await db
      .select()
      .from(matchPair)
      .where(only ? inArray(matchPair.matCode, only) : undefined)
      .orderBy(matchPair.id)
    console.log('자재코드   상태     저장된판정(썸/상세)  조각  CJ전송  GS전송  CJ→GS GS→CJ' + (judge ? '  새판정(썸/상세)  토큰(입력+캐시)  요약' : ''))
    const total = { cjSentPx: 0, cjTotalPx: 0, gsSentPx: 0, gsTotalPx: 0 }
    let failed = 0
    for (const p of pairs) {
      const [c] = await db
        .select()
        .from(matchCheck)
        .where(and(eq(matchCheck.pairId, p.id), eq(matchCheck.fetchOk, true)))
        .orderBy(desc(matchCheck.id))
        .limit(1)
      const [j] = await db
        .select({ verdict: matchCheck.verdict })
        .from(matchCheck)
        .where(and(eq(matchCheck.pairId, p.id), eq(matchCheck.judged, true)))
        .orderBy(desc(matchCheck.id))
        .limit(1)
      if (!c?.cjThumbUrl || !c.gsThumbUrl) {
        console.log(`${p.matCode.padEnd(10)} 정상 수집 기록 없음`)
        continue
      }
      const input: JudgeInput = {
        cjThumbUrl: c.cjThumbUrl,
        gsThumbUrl: c.gsThumbUrl,
        gsPageUrl: p.gsUrl,
        cjDetail: (c.cjDetail as Img[]) ?? [],
        gsDetail: ((c.gsDetail as Img[]) ?? []).filter((d) => !d.common),
      }
      const stored = j?.verdict as Verdict | null | undefined
      const detail: string[] = []
      let result: Awaited<ReturnType<typeof judgePair>> | null = null
      let a: Awaited<ReturnType<typeof buildContent>>['align']
      try {
        result = judge ? await judgePair(input, model) : null
        a = result ? result.align : (await buildContent(input)).align
      } catch (e) {
        // 한 쌍의 실패(다운로드 시간 초과 등)로 전체를 멈추지 않는다 — 실패는 그대로 보여준다.
        console.log(`${p.matCode.padEnd(10)} 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
        failed++
        continue
      }
      const cols = [
        p.matCode.padEnd(10),
        p.status.padEnd(8),
        (stored ? `${stored.thumbnail}/${stored.detail}` : '-').padEnd(19),
      ]
      if (a) {
        for (const k of ['cjSentPx', 'cjTotalPx', 'gsSentPx', 'gsTotalPx'] as const) total[k] += a[k]
        cols.push(String(a.pieces).padStart(4), pct(a.cjSentPx / a.cjTotalPx).padStart(7), pct(a.gsSentPx / a.gsTotalPx).padStart(7), pct(a.cjMatchRate).padStart(6), pct(a.gsMatchRate).padStart(5))
      } else {
        cols.push('선별 없음(전 구간)'.padEnd(32))
      }
      if (result) {
        const u = result.usage
        cols.push(
          `  ${result.verdict.thumbnail}/${result.verdict.detail}`.padEnd(16),
          String(u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens).padStart(15),
          ` ${result.verdict.summary}`,
        )
        const vs = result.verify
        if (vs) cols.push(vs.failed ? `| 재검증 실패: ${vs.failed}` : `| 재검증 확인 ${vs.confirmed}·엇갈림 ${vs.rejected}·불가 ${vs.unsure}`)
        for (const d of result.verdict.differences) {
          if (d.verify) detail.push(`      - [${d.verify}] ${d.area} ${d.what}${d.verifyNote ? ` — ${d.verifyNote}` : ''}`)
        }
      }
      console.log(cols.join(' '))
      for (const line of detail) console.log(line)
    }
    const sent = total.cjSentPx + total.gsSentPx
    const all = total.cjTotalPx + total.gsTotalPx
    if (all > 0) console.log(`합계(선별한 쌍): 상세 높이의 ${Math.round((sent / all) * 100)}% 전송 — CJ ${pct(total.cjSentPx / total.cjTotalPx)}, GS ${pct(total.gsSentPx / total.gsTotalPx)}`)
    if (failed > 0) {
      console.log(`실패 ${failed}쌍`)
      process.exitCode = 1
    }
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

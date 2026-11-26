'use server'

import { db } from '@/db/client'
import { matchRun } from '@/db/schema'
import { desc, sql } from 'drizzle-orm'
import { RUN_STALE_HOURS, type MatchRunStartResult } from './types'

/**
 * 화면의 [지금 판정 실행] — GitHub Actions 의 image-match 워크플로를 수동 실행(workflow_dispatch)한다.
 *
 * 판정은 Actions 러너에서 돈다(scripts/match/run.ts). 이 액션은 실행 요청만 보낸다.
 * 필요한 환경변수(Vercel): GITHUB_DISPATCH_TOKEN — 이 저장소의 Actions 읽기·쓰기 권한만 가진 토큰.
 *
 * 화면에 로그인이 없으므로 실행 조건은 전부 서버에서 고정한다(입력을 받지 않는다):
 *   - 이미 돌고 있거나 대기 중인 실행이 있으면 거절 — 겹쳐 눌러 여러 번 돌리는 것을 막는다.
 *   - 판정 상한은 RUN_ALL_LIMIT 고정 — 대기 중인 쌍을 한 번에 판정한다.
 * 판정할 쌍이 없으면 실행해도 수집만 하고 끝나므로, 반복 실행해도 구독 사용량을 더 쓰지 않는다.
 */

const REPO = 'kkkseok/jkm-dashboard'
const WORKFLOW = 'image-match.yml'
const REF = 'main'
/** 한 번에 판정할 상한 — 등록된 쌍 전체를 덮는 값(run.ts 기본값과 같다). */
const RUN_ALL_LIMIT = 1000
/** GitHub 에서 아직 끝나지 않은 실행 상태. */
const ACTIVE = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending'])

const fail = (message: string): MatchRunStartResult => ({ ok: false, message })

export async function startMatchRun(): Promise<MatchRunStartResult> {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    return fail('실행 권한이 설정되지 않았습니다 — Vercel 환경변수 GITHUB_DISPATCH_TOKEN 을 등록해 주세요.')
  }

  // 1) DB 기준: 종료 기록이 없는 최근 실행이 있으면 진행 중.
  const [open] = await db
    .select({ id: matchRun.id })
    .from(matchRun)
    .where(
      sql`${matchRun.finishedAt} is null and ${matchRun.startedAt} > now() - make_interval(secs => ${RUN_STALE_HOURS * 3600})`,
    )
    .orderBy(desc(matchRun.id))
    .limit(1)
  if (open) return fail('이미 배치가 돌고 있습니다. 끝난 뒤 다시 실행해 주세요.')

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'jkm-dashboard',
  }
  const base = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`

  try {
    // 2) GitHub 기준: 방금 눌러 아직 DB 에 기록이 없는 실행(준비 단계)도 잡는다.
    const list = await fetch(`${base}/runs?per_page=10`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!list.ok) return fail(`GitHub 실행 목록을 읽지 못했습니다 (HTTP ${list.status}). 토큰 권한을 확인해 주세요.`)
    const runs = ((await list.json()) as { workflow_runs?: { status: string }[] }).workflow_runs ?? []
    if (runs.some((r) => ACTIVE.has(r.status))) {
      return fail('이미 실행 요청이 들어가 있습니다. 잠시 뒤 진행 상황이 표시됩니다.')
    }

    const res = await fetch(`${base}/dispatches`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: REF, inputs: { judge: 'true', judge_limit: String(RUN_ALL_LIMIT) } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status !== 204) return fail(`실행 요청이 거절됐습니다 (HTTP ${res.status}). 토큰 권한(Actions 쓰기)을 확인해 주세요.`)
  } catch (e) {
    return fail(`GitHub 에 연결하지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`)
  }
  return { ok: true, message: '실행을 요청했습니다. 준비에 1~2분 걸린 뒤 진행 상황이 표시됩니다.' }
}

/**
 * 수집 결과 → "AI 판정이 필요한가" 결정 (순수 함수).
 *
 * 해시는 "다르다"를 판정하지 않는다. CJ 와 GS 는 이미지를 따로 호스팅해서 바이트가 원래 다르다.
 * 해시는 **판정 기준(baseline) 이후 어느 쪽이든 바뀌었는지**만 알려주고, 바뀐 쌍만 AI 로 보낸다.
 *
 * baseline = 마지막으로 AI 판정을 실제로 한 check 의 해시.
 * (직전 수집이 아니라 판정 기준과 비교해야, 판정이 밀린 사이의 변경을 놓치지 않는다.)
 */

import { createHash } from 'node:crypto'
import type { Confidence, Verdict, VerifyResult } from './judge-rules'
import type { MatchStatus } from './types'

export type SideHashes = {
  cjThumb: string
  gsThumb: string
  cjDetail: string
  gsDetail: string
}

export type HashChanges = Record<keyof SideHashes, boolean>

export type GateDecision =
  /** AI 판정 필요. */
  | { kind: 'judge'; reason: 'first' | 'changed' | 'rules' }
  /** 판정 유지 — 기준 이후 변화 없음. */
  | { kind: 'keep' }
  /** 처리 완료였는데 기준 이후 양쪽 다 그대로 → AI 없이 미반영. */
  | { kind: 'unfixed' }

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * 상세 이미지 해시 목록 → 합성 해시. 순서도 내용의 일부로 본다.
 * 다운로드 실패한 이미지는 null → 'missing' 으로 넣어 "깨진 이미지"도 변화로 잡는다.
 */
export function combineHashes(hashes: (string | null)[]): string {
  return sha256(hashes.map((h) => h ?? 'missing').join('\n'))
}

/**
 * GS 상세 공통 이미지 판별 — 여러 GS 상품에 반복 등장하는 해시.
 * 상품 하나 안에서 같은 이미지가 여러 번 나와도 1회로 센다.
 * threshold = max(minCount, ceil(ratio × 상품 수)).
 */
export function findCommonHashes(
  perProduct: (string | null)[][],
  opts: { ratio: number; minCount: number },
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const list of perProduct) {
    for (const h of new Set(list)) {
      if (h) counts.set(h, (counts.get(h) ?? 0) + 1)
    }
  }
  const threshold = Math.max(opts.minCount, Math.ceil(opts.ratio * perProduct.length))
  const common = new Map<string, number>()
  for (const [h, n] of counts) if (n >= threshold) common.set(h, n)
  return common
}

export function diffHashes(baseline: SideHashes, current: SideHashes): HashChanges {
  return {
    cjThumb: baseline.cjThumb !== current.cjThumb,
    gsThumb: baseline.gsThumb !== current.gsThumb,
    cjDetail: baseline.cjDetail !== current.cjDetail,
    gsDetail: baseline.gsDetail !== current.gsDetail,
  }
}

/**
 * 이미지 목록에서 기준(reference) 대비 바뀐 것 찾기 — 화면에 "새로 들어온 이미지"를 표시하는 데 쓴다.
 *   changed[i] = current[i] 의 해시가 기준 목록에 없음(새 이미지·교체된 이미지). 해시 없는(깨진) 이미지는 false.
 *   removed    = 기준에는 있었는데 지금은 없는 이미지 종류 수.
 * 순서만 바뀐 것은 변경으로 치지 않는다.
 */
export function diffImageList(
  current: (string | null)[],
  reference: (string | null)[],
): { changed: boolean[]; removed: number } {
  const ref = new Set(reference.filter((h): h is string => !!h))
  const cur = new Set(current.filter((h): h is string => !!h))
  return {
    changed: current.map((h) => !!h && !ref.has(h)),
    removed: [...ref].filter((h) => !cur.has(h)).length,
  }
}

/**
 * @param status   현재 상태 ('error' 는 호출 전에 직전 상태로 복원해서 넘긴다)
 * @param baseline 마지막 AI 판정 check 의 해시. 판정 이력이 없으면 null.
 * @param rulesChanged 기준 판정의 규칙 버전이 현재 RULES_VERSION 과 다름.
 */
export function decide(
  status: MatchStatus,
  baseline: SideHashes | null,
  current: SideHashes,
  rulesChanged = false,
): { decision: GateDecision; changes: HashChanges | null } {
  // 'new' = 미판정 또는 URL 변경으로 초기화된 쌍 → 이전 판정 기준은 쓰지 않는다.
  if (!baseline || status === 'new') {
    return { decision: { kind: 'judge', reason: 'first' }, changes: null }
  }
  // 판정 규칙이 바뀌었으면 해시와 무관하게 전체 재판정 (changes=null → 직전 판정과 병합하지 않음).
  if (rulesChanged) return { decision: { kind: 'judge', reason: 'rules' }, changes: null }
  const changes = diffHashes(baseline, current)
  const anyChanged = Object.values(changes).some(Boolean)
  if (anyChanged) return { decision: { kind: 'judge', reason: 'changed' }, changes }
  if (status === 'done') return { decision: { kind: 'unfixed' }, changes }
  return { decision: { kind: 'keep' }, changes }
}

/**
 * AI 판정 결과 → 다음 상태.
 *   diff 가 있고 그중 확신 높은(high) 차이가 있으면 불일치(처리 완료 후라면 미반영).
 *   diff 인데 확신 높은 차이가 없으면 판정 보류 — 사람이 근거 이미지를 보고 정한다(사용자 확정 2026-10-28).
 *   diff 가 없고 unsure 가 있으면 판정 보류, 둘 다 same 이면 일치.
 * 확신도가 없는 예전 판정·근거 항목이 없는 diff 는 확신 높음으로 본다.
 */
export function statusAfterVerdict(status: MatchStatus, v: Verdict): MatchStatus {
  const parts = [v.thumbnail, v.detail]
  if (parts.includes('diff')) {
    const diffItems = v.differences.filter((d) => v[d.area] === 'diff')
    const confident = diffItems.length === 0 || diffItems.some((d) => (d.confidence ?? 'high') === 'high')
    if (!confident) return 'unsure'
    return status === 'done' || status === 'unfixed' ? 'unfixed' : 'diff'
  }
  if (parts.includes('unsure')) return 'unsure'
  return 'match'
}

/** 판정 실패 기록의 note 접두어 — match_status_log 에서 쌍별 연속 실패 횟수를 세는 데 쓴다. */
export const JUDGE_FAIL_NOTE = '판정 실패'
/** 마지막 판정 이후 이 횟수 이상 실패한 쌍은 대기열 맨 뒤로 보낸다(계속 실패하는 쌍이 상한을 차지하지 않게). */
export const JUDGE_FAIL_DEMOTE = 2

export type JudgeQueueItem = {
  id: number
  status: MatchStatus
  reason: 'first' | 'changed' | 'rules'
  lastJudgedAt: Date | null
  /** 마지막 판정 이후 판정 실패 횟수. */
  recentFailures: number
}

/**
 * 판정 순위(작을수록 먼저). 1회 판정 상한이 있어 뒤쪽은 다음 실행으로 밀린다.
 *   0 처리 완료·미반영 — 사용자가 GS 를 고치고 결과를 기다리는 쌍
 *   1 이미지 변경       — 기존 판정이 더는 맞지 않을 수 있음
 *   2 첫 판정           — 아직 결과가 없음
 *   3 규칙 변경         — 기존 판정이 있어 가장 덜 급함
 */
export function judgeRank(item: Pick<JudgeQueueItem, 'status' | 'reason'>): number {
  if (item.status === 'done' || item.status === 'unfixed') return 0
  if (item.reason === 'changed') return 1
  if (item.reason === 'first') return 2
  return 3
}

/** 판정 대기열 정렬: 반복 실패 쌍은 맨 뒤 → 순위 → 오래 판정 안 된 쌍(미판정 먼저) → id. 원본 배열은 건드리지 않는다. */
export function sortJudgeQueue<T extends JudgeQueueItem>(items: T[]): T[] {
  const demoted = (x: T) => (x.recentFailures >= JUDGE_FAIL_DEMOTE ? 1 : 0)
  const judgedAt = (x: T) => x.lastJudgedAt?.getTime() ?? 0
  return [...items].sort(
    (a, b) =>
      demoted(a) - demoted(b) || judgeRank(a) - judgeRank(b) || judgedAt(a) - judgedAt(b) || a.id - b.id,
  )
}

/**
 * AI 에 넣을 수 없는 쌍(이미지 수 상한 초과 등)의 판정 — 양쪽 다 unsure 로 두어 사람이 확인하게 한다.
 * 판정으로 기록해야 해시 기준(baseline)이 생겨, 이미지가 바뀌기 전까지 매 실행마다 다시 시도하지 않는다.
 */
export function skippedVerdict(reason: string): Verdict {
  return { thumbnail: 'unsure', detail: 'unsure', differences: [], summary: reason.slice(0, 60) }
}

/** 근거 재검증 대상 = 판정이 diff 인 영역의 차이 항목(differences 의 위치). 한 번에 max 개까지. */
export function verifyTargets(v: Verdict, max = 6): number[] {
  return v.differences.flatMap((d, i) => (v[d.area] === 'diff' ? [i] : [])).slice(0, max)
}

/**
 * 근거 재검증 결과를 판정에 반영한다 — **차이 항목을 지우지 않고 확신도만 조정**한다.
 *   confirmed 두 번 봐서 같은 결론 → 확신 높음
 *   rejected  1차와 엇갈림        → 확신 낮음 (확신 높은 차이가 남지 않으면 statusAfterVerdict 가 판정 보류로 보낸다)
 *   unsure    근거로 확인 불가    → 높음이었다면 보통으로
 * 재검증이 1차 판정을 뒤집어 '일치'로 만들지는 않는다 — 재검증도 틀릴 수 있어서, 엇갈리면 사람이 본다.
 *
 * @param targets verifyTargets 가 고른 differences 위치
 * @param results index = targets 의 순번(1-based)
 */
export function applyVerification(
  v: Verdict,
  targets: number[],
  results: { index: number; result: VerifyResult; note?: string }[],
): Verdict {
  const byPos = new Map<number, { result: VerifyResult; note?: string }>()
  for (const r of results) {
    const pos = targets[r.index - 1]
    if (pos !== undefined && !byPos.has(pos)) byPos.set(pos, r)
  }
  return {
    ...v,
    differences: v.differences.map((d, i) => {
      const r = byPos.get(i)
      if (!r) return d
      const before: Confidence = d.confidence ?? 'high'
      const confidence: Confidence =
        r.result === 'confirmed' ? 'high' : r.result === 'rejected' ? 'low' : before === 'high' ? 'medium' : before
      return { ...d, confidence, verify: r.result, ...(r.note && { verifyNote: r.note.slice(0, 80) }) }
    }),
  }
}

const AREA_LABEL = { thumbnail: '썸네일', detail: '상세' } as const

/**
 * 재판정 결과 병합 — **해시가 바뀐 영역의 판정만 새 결과로 받는다.**
 *
 * 같은 이미지에도 AI 판정은 흔들릴 수 있다(2026-10-28 실측: 199909 썸네일은 그대로인데
 * GS 상세 공지 이미지 교체로 재판정되자 썸네일 판정이 same → diff 로 뒤집힘).
 * 바뀌지 않은 영역은 직전 판정(근거 포함)을 유지해 엉뚱한 알림을 막는다.
 *
 * @param prev    기준(마지막 판정) verdict. 없으면 next 그대로.
 * @param changes 기준 대비 해시 변경. null(첫 판정)이면 next 그대로.
 */
export function mergeVerdict(prev: Verdict | null, next: Verdict, changes: HashChanges | null): Verdict {
  if (!prev || !changes) return next
  const thumbChanged = changes.cjThumb || changes.gsThumb
  const detailChanged = changes.cjDetail || changes.gsDetail
  if (thumbChanged && detailChanged) return next

  const t = thumbChanged ? next : prev
  const d = detailChanged ? next : prev
  const differences = [
    ...t.differences.filter((x) => x.area === 'thumbnail'),
    ...d.differences.filter((x) => x.area === 'detail'),
  ]
  const summary =
    differences.length === 0
      ? '일치'
      : differences
          .map((x) => `${AREA_LABEL[x.area]}: ${x.what}`)
          .join(' / ')
          .slice(0, 80)
  return { thumbnail: t.thumbnail, detail: d.detail, differences, summary }
}

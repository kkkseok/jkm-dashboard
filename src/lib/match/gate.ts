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
import type { Verdict } from './judge-rules'
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
  | { kind: 'judge'; reason: 'first' | 'changed' }
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
 * @param status   현재 상태 ('error' 는 호출 전에 직전 상태로 복원해서 넘긴다)
 * @param baseline 마지막 AI 판정 check 의 해시. 판정 이력이 없으면 null.
 */
export function decide(
  status: MatchStatus,
  baseline: SideHashes | null,
  current: SideHashes,
): { decision: GateDecision; changes: HashChanges | null } {
  // 'new' = 미판정 또는 URL 변경으로 초기화된 쌍 → 이전 판정 기준은 쓰지 않는다.
  if (!baseline || status === 'new') {
    return { decision: { kind: 'judge', reason: 'first' }, changes: null }
  }
  const changes = diffHashes(baseline, current)
  const anyChanged = Object.values(changes).some(Boolean)
  if (anyChanged) return { decision: { kind: 'judge', reason: 'changed' }, changes }
  if (status === 'done') return { decision: { kind: 'unfixed' }, changes }
  return { decision: { kind: 'keep' }, changes }
}

/**
 * AI 판정 결과 → 다음 상태.
 *   diff 가 하나라도 있으면 불일치(처리 완료 후라면 미반영), 아니면 unsure 가 있으면 판정 보류, 둘 다 same 이면 일치.
 */
export function statusAfterVerdict(status: MatchStatus, v: Verdict): MatchStatus {
  const parts = [v.thumbnail, v.detail]
  if (parts.includes('diff')) return status === 'done' || status === 'unfixed' ? 'unfixed' : 'diff'
  if (parts.includes('unsure')) return 'unsure'
  return 'match'
}

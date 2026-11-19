/**
 * gate — 해시 게이트 / 공통 이미지 판별 규칙 테스트.
 * 규칙 원본: _workspace/01_design_image_match.md §3, §5.
 */

import { describe, expect, it } from 'vitest'
import {
  combineHashes,
  decide,
  diffImageList,
  findCommonHashes,
  applyVerification,
  JUDGE_FAIL_DEMOTE,
  mergeVerdict,
  skippedVerdict,
  sortJudgeQueue,
  statusAfterVerdict,
  verifyTargets,
  type JudgeQueueItem,
  type SideHashes,
} from '../gate'
import type { Verdict } from '../judge-rules'

const H: SideHashes = { cjThumb: 'a', gsThumb: 'b', cjDetail: 'c', gsDetail: 'd' }

describe('decide', () => {
  it('판정 이력이 없으면 첫 판정', () => {
    expect(decide('match', null, H).decision).toEqual({ kind: 'judge', reason: 'first' })
  })

  it("'new' 는 기준이 있어도 다시 판정 (URL 변경 초기화)", () => {
    expect(decide('new', H, H).decision).toEqual({ kind: 'judge', reason: 'first' })
  })

  it('기준 이후 변화 없으면 판정 유지', () => {
    for (const s of ['match', 'diff', 'unfixed', 'unsure'] as const) {
      expect(decide(s, H, { ...H }).decision).toEqual({ kind: 'keep' })
    }
  })

  it('어느 쪽이든 해시가 바뀌면 재판정', () => {
    const r = decide('match', H, { ...H, cjDetail: 'c2' })
    expect(r.decision).toEqual({ kind: 'judge', reason: 'changed' })
    expect(r.changes).toEqual({ cjThumb: false, gsThumb: false, cjDetail: true, gsDetail: false })
  })

  it('판정 규칙이 바뀌면 해시가 그대로여도 전체 재판정 (병합 안 함)', () => {
    for (const s of ['match', 'diff', 'done'] as const) {
      expect(decide(s, H, { ...H }, true)).toEqual({ decision: { kind: 'judge', reason: 'rules' }, changes: null })
    }
  })

  it('처리 완료인데 양쪽 다 그대로면 AI 없이 미반영', () => {
    expect(decide('done', H, { ...H }).decision).toEqual({ kind: 'unfixed' })
  })

  it('처리 완료 후 GS 가 바뀌면 재판정', () => {
    expect(decide('done', H, { ...H, gsThumb: 'b2' }).decision).toEqual({
      kind: 'judge',
      reason: 'changed',
    })
  })
})

describe('findCommonHashes', () => {
  it('여러 상품에 반복되는 해시만 공통으로 본다 (상품 내 중복은 1회)', () => {
    const lists = [
      ['hdr', 'notice', 'p1a', 'p1a'],
      ['hdr', 'notice', 'p2a'],
      ['hdr', 'p3a', 'brand'],
      ['hdr', 'notice', 'p4a', 'brand'],
    ]
    // threshold = max(2, ceil(0.5 × 4)) = 2
    const common = findCommonHashes(lists, { ratio: 0.5, minCount: 2 })
    expect([...common.keys()].sort()).toEqual(['brand', 'hdr', 'notice'])
    expect(common.get('hdr')).toBe(4)
  })

  it('상품 수가 적으면 minCount 가 하한', () => {
    const common = findCommonHashes([['x'], ['x']], { ratio: 0.3, minCount: 3 })
    expect(common.size).toBe(0)
  })
})

describe('combineHashes', () => {
  it('순서와 누락(null)을 구분한다', () => {
    expect(combineHashes(['a', 'b'])).not.toBe(combineHashes(['b', 'a']))
    expect(combineHashes(['a', null])).not.toBe(combineHashes(['a']))
    expect(combineHashes(['a', 'b'])).toBe(combineHashes(['a', 'b']))
  })
})

describe('statusAfterVerdict', () => {
  const v = (thumbnail: Verdict['thumbnail'], detail: Verdict['detail']): Verdict => ({
    thumbnail,
    detail,
    differences: [],
    summary: '',
  })

  it('하나라도 diff 면 불일치', () => {
    expect(statusAfterVerdict('new', v('diff', 'same'))).toBe('diff')
    expect(statusAfterVerdict('match', v('same', 'diff'))).toBe('diff')
  })

  it('처리 완료/미반영 상태에서 여전히 diff 면 미반영', () => {
    expect(statusAfterVerdict('done', v('diff', 'same'))).toBe('unfixed')
    expect(statusAfterVerdict('unfixed', v('same', 'diff'))).toBe('unfixed')
  })

  it('diff 인데 확신 높은 차이가 없으면 판정 보류 (사람 확인)', () => {
    const low: Verdict = {
      thumbnail: 'same',
      detail: 'diff',
      differences: [
        { area: 'detail', what: '함량', cj: '94%', gs: '93%', confidence: 'medium' },
        { area: 'detail', what: '사진', cj: 'a', gs: 'b', confidence: 'low' },
      ],
      summary: '',
    }
    expect(statusAfterVerdict('new', low)).toBe('unsure')
    expect(statusAfterVerdict('done', low)).toBe('unsure')
    const oneHigh = { ...low, differences: [...low.differences, { ...low.differences[0], confidence: 'high' as const }] }
    expect(statusAfterVerdict('new', oneHigh)).toBe('diff')
  })

  it('same 영역의 확신 높은 항목은 diff 근거로 치지 않는다', () => {
    const v: Verdict = {
      thumbnail: 'same',
      detail: 'diff',
      differences: [
        { area: 'thumbnail', what: '구도', cj: 'a', gs: 'b', confidence: 'high' },
        { area: 'detail', what: '사진', cj: 'a', gs: 'b', confidence: 'low' },
      ],
      summary: '',
    }
    expect(statusAfterVerdict('new', v)).toBe('unsure')
  })

  it('diff 없이 unsure 가 있으면 판정 보류', () => {
    expect(statusAfterVerdict('new', v('same', 'unsure'))).toBe('unsure')
  })

  it('둘 다 same 이면 일치 (처리 완료 → 해결)', () => {
    expect(statusAfterVerdict('done', v('same', 'same'))).toBe('match')
  })
})

describe('diffImageList', () => {
  it('기준에 없던 이미지만 변경으로 표시하고, 빠진 이미지 수를 센다', () => {
    expect(diffImageList(['a', 'x', 'c'], ['a', 'b', 'c'])).toEqual({ changed: [false, true, false], removed: 1 })
  })

  it('순서만 바뀐 것은 변경이 아니다', () => {
    expect(diffImageList(['b', 'a'], ['a', 'b'])).toEqual({ changed: [false, false], removed: 0 })
  })

  it('해시 없는(깨진) 이미지는 변경으로 치지 않는다', () => {
    expect(diffImageList(['a', null], [null, 'a'])).toEqual({ changed: [false, false], removed: 0 })
  })
})

describe('sortJudgeQueue', () => {
  const item = (id: number, over: Partial<JudgeQueueItem> = {}): JudgeQueueItem => ({
    id,
    status: 'match',
    reason: 'changed',
    lastJudgedAt: new Date('2026-11-01'),
    recentFailures: 0,
    ...over,
  })
  const ids = (items: JudgeQueueItem[]) => sortJudgeQueue(items).map((x) => x.id)

  it('처리 완료·미반영 → 이미지 변경 → 첫 판정 → 규칙 변경 순', () => {
    expect(
      ids([
        item(1, { reason: 'rules' }),
        item(2, { status: 'new', reason: 'first', lastJudgedAt: null }),
        item(3),
        item(4, { status: 'unfixed' }),
        item(5, { status: 'done', reason: 'rules' }),
      ]),
    ).toEqual([4, 5, 3, 2, 1])
  })

  it('같은 순위면 오래 판정 안 된 쌍 먼저(미판정이 맨 앞), 그다음 id', () => {
    expect(
      ids([
        item(1, { lastJudgedAt: new Date('2026-11-10') }),
        item(2, { lastJudgedAt: new Date('2026-11-05') }),
        item(4, { lastJudgedAt: null }),
        item(3, { lastJudgedAt: null }),
      ]),
    ).toEqual([3, 4, 2, 1])
  })

  it('계속 실패하는 쌍은 순위와 무관하게 맨 뒤 (1회 실패는 그대로)', () => {
    expect(
      ids([
        item(1, { status: 'done', recentFailures: JUDGE_FAIL_DEMOTE }),
        item(2, { reason: 'rules' }),
        item(3, { status: 'done', recentFailures: JUDGE_FAIL_DEMOTE - 1 }),
      ]),
    ).toEqual([3, 2, 1])
  })

  it('원본 배열은 바꾸지 않는다', () => {
    const items = [item(2, { reason: 'rules' }), item(1)]
    sortJudgeQueue(items)
    expect(items.map((x) => x.id)).toEqual([2, 1])
  })
})

describe('skippedVerdict', () => {
  it('양쪽 unsure → 판정 보류, 요약은 60자 이내', () => {
    const v = skippedVerdict('가'.repeat(100))
    expect(statusAfterVerdict('new', v)).toBe('unsure')
    expect(statusAfterVerdict('done', v)).toBe('unsure')
    expect(v.summary).toHaveLength(60)
  })
})

describe('verifyTargets / applyVerification', () => {
  const v: Verdict = {
    thumbnail: 'same',
    detail: 'diff',
    differences: [
      { area: 'thumbnail', what: '구도', cj: 'a', gs: 'b', confidence: 'high' },
      { area: 'detail', what: '함량', cj: '94%', gs: '93%', confidence: 'high' },
      { area: 'detail', what: '사진', cj: 'a', gs: 'b', confidence: 'medium' },
    ],
    summary: '상세 다름',
  }

  it('diff 영역의 차이만 대상, 최대 개수로 자른다', () => {
    expect(verifyTargets(v)).toEqual([1, 2])
    expect(verifyTargets(v, 1)).toEqual([1])
    expect(verifyTargets({ ...v, detail: 'unsure' })).toEqual([])
  })

  it('확인되면 확신 높음 — 불일치 유지', () => {
    const r = applyVerification(v, [1, 2], [
      { index: 1, result: 'confirmed', note: '수치 다름 확인' },
      { index: 2, result: 'confirmed' },
    ])
    expect(r.differences.map((d) => [d.confidence, d.verify])).toEqual([
      ['high', undefined],
      ['high', 'confirmed'],
      ['high', 'confirmed'],
    ])
    expect(r.differences[1].verifyNote).toBe('수치 다름 확인')
    expect(statusAfterVerdict('new', r)).toBe('diff')
  })

  it('전부 엇갈리면 항목은 남기고 확신만 낮춰 판정 보류로', () => {
    const r = applyVerification(v, [1, 2], [
      { index: 1, result: 'rejected' },
      { index: 2, result: 'rejected' },
    ])
    expect(r.differences).toHaveLength(3)
    expect(r.detail).toBe('diff')
    expect(statusAfterVerdict('new', r)).toBe('unsure')
    expect(statusAfterVerdict('done', r)).toBe('unsure')
  })

  it('하나라도 확인되면 불일치', () => {
    const r = applyVerification(v, [1, 2], [
      { index: 1, result: 'rejected' },
      { index: 2, result: 'confirmed' },
    ])
    expect(statusAfterVerdict('new', r)).toBe('diff')
  })

  it('확인 불가(unsure)는 높음만 보통으로 낮춘다', () => {
    const r = applyVerification(v, [1, 2], [
      { index: 1, result: 'unsure' },
      { index: 2, result: 'unsure' },
    ])
    expect(r.differences.map((d) => d.confidence)).toEqual(['high', 'medium', 'medium'])
    expect(statusAfterVerdict('new', r)).toBe('unsure')
  })

  it('답이 없는 항목·범위 밖 번호는 그대로 둔다', () => {
    const r = applyVerification(v, [1, 2], [{ index: 5, result: 'rejected' }])
    expect(r.differences).toEqual(v.differences)
  })
})

describe('mergeVerdict', () => {
  const prev: Verdict = { thumbnail: 'same', detail: 'diff', differences: [{ area: 'detail', what: '함량 표기', cj: '94%', gs: '93%' }], summary: '상세 함량 다름' }
  const flipped: Verdict = { thumbnail: 'diff', detail: 'same', differences: [{ area: 'thumbnail', what: '패키지 색', cj: '주황', gs: '갈색' }], summary: '썸네일 다름' }
  const noChange = { cjThumb: false, gsThumb: false, cjDetail: false, gsDetail: false }

  it('바뀐 영역만 새 판정, 나머지는 직전 판정 유지', () => {
    const r = mergeVerdict(prev, flipped, { ...noChange, gsDetail: true })
    expect(r.thumbnail).toBe('same') // 썸네일 해시 그대로 → 흔들린 diff 무시
    expect(r.detail).toBe('same') // 상세는 바뀌었으니 새 판정
    expect(r.differences).toEqual([])
    expect(r.summary).toBe('일치')
  })

  it('직전 판정의 근거도 영역별로 유지된다', () => {
    const r = mergeVerdict(prev, flipped, { ...noChange, cjThumb: true })
    expect(r).toEqual({
      thumbnail: 'diff',
      detail: 'diff',
      differences: [flipped.differences[0], prev.differences[0]],
      summary: '썸네일: 패키지 색 / 상세: 함량 표기',
    })
  })

  it('첫 판정이거나 양쪽 다 바뀌면 새 판정 그대로', () => {
    expect(mergeVerdict(null, flipped, null)).toBe(flipped)
    expect(mergeVerdict(prev, flipped, { cjThumb: true, gsThumb: false, cjDetail: false, gsDetail: true })).toBe(flipped)
  })
})

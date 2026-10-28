/**
 * gate — 해시 게이트 / 공통 이미지 판별 규칙 테스트.
 * 규칙 원본: _workspace/01_design_image_match.md §3, §5.
 */

import { describe, expect, it } from 'vitest'
import { combineHashes, decide, findCommonHashes, mergeVerdict, statusAfterVerdict, type SideHashes } from '../gate'
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

  it('diff 없이 unsure 가 있으면 판정 보류', () => {
    expect(statusAfterVerdict('new', v('same', 'unsure'))).toBe('unsure')
  })

  it('둘 다 same 이면 일치 (처리 완료 → 해결)', () => {
    expect(statusAfterVerdict('done', v('same', 'same'))).toBe('match')
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

/**
 * gate — 해시 게이트 / 공통 이미지 판별 규칙 테스트.
 * 규칙 원본: _workspace/01_design_image_match.md §3, §5.
 */

import { describe, expect, it } from 'vitest'
import { combineHashes, decide, findCommonHashes, statusAfterVerdict, type SideHashes } from '../gate'
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

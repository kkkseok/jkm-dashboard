/**
 * align — 정렬 선별(같은 부분은 코드로 걸러내고 안 맞는 구간만 AI 에) 테스트.
 * 띠는 블록마다 서로 다른 무늬(굵은 칸 단위 밝기)를 넣어 만든다(시드 고정 난수).
 */

import { describe, expect, it } from 'vitest'
import {
  ALIGN,
  alignBlocks,
  matchRate,
  counterpartRange,
  planPieces,
  splitPieces,
  tileDiffAt,
  unmatchedRanges,
  type Gray,
} from '../align'

const B = ALIGN.block
/** 블록 1개의 띠 높이(px). */
const BPX = B * ALIGN.scale
const W = 200
const CELL_W = W / ALIGN.cols

/** 블록 하나 = id 로 정해지는 무늬. 'flat' 은 단색 여백. noise = 재압축 잡음 흉내(픽셀마다 ±noise). */
function strip(ids: (number | 'flat')[], noise = 0): Gray {
  const data = new Uint8Array(ids.length * BPX * W)
  ids.forEach((id, k) => {
    // 굵은 칸(CELL_W × SCALE px)마다 밝기 하나
    const cells: number[] = []
    let seed = id === 'flat' ? 0 : id * 7919 + 13
    for (let i = 0; i < B * ALIGN.cols; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      cells.push(id === 'flat' ? 255 : 40 + (seed % 180))
    }
    for (let y = 0; y < BPX; y++) {
      for (let x = 0; x < W; x++) {
        const base = cells[Math.floor(y / ALIGN.scale) * ALIGN.cols + Math.floor(x / CELL_W)]
        data[(k * BPX + y) * W + x] = id === 'flat' ? base : base + ((x + y) % 2 ? noise : -noise)
      }
    }
  })
  return { data, width: W, rows: ids.length * BPX }
}

/** 띠의 (x, y) 에서 w×h px 를 delta 만큼 밝게 — 작은 글자 하나가 바뀐 상황. */
function patched(g: Gray, x: number, y: number, w: number, h: number, delta: number): Gray {
  const data = new Uint8Array(g.data)
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data[yy * g.width + xx] = Math.min(255, data[yy * g.width + xx] + delta)
  return { ...g, data }
}

const EMPTY: Gray = { data: new Uint8Array(0), width: W, rows: 0 }
const matches = (a: Gray, b: Gray) => alignBlocks(a, b).map((x) => x.match)

describe('alignBlocks', () => {
  it('같은 블록은 위치가 달라도 찾고, 없는 블록은 대응 없음', () => {
    const blocks = alignBlocks(strip([1, 2, 3]), strip([9, 3, 1]))
    expect(blocks.map((b) => b.match)).toEqual([2 * BPX, null, BPX])
    expect(matchRate(blocks)).toBeCloseTo(2 / 3)
  })

  it('재압축 수준의 잡음은 같은 것으로 본다', () => {
    expect(matches(strip([1, 2]), strip([1, 2], 4))).toEqual([0, BPX])
  })

  it('단색 블록은 판단에서 뺀다', () => {
    const blocks = alignBlocks(strip([1, 'flat', 2]), strip([1, 2]))
    expect(blocks.map((b) => b.flat)).toEqual([false, true, false])
    expect(matchRate(blocks)).toBe(1)
  })

  it('블록 경계가 어긋나 있어도(앞에 반 블록 삽입) 찾는다', () => {
    const b = strip([1, 2])
    const half = (BPX / 2) * W
    const shifted: Gray = { data: new Uint8Array([...strip([7]).data.slice(0, half), ...b.data]), width: W, rows: b.rows + BPX / 2 }
    expect(matches(b, shifted)).toEqual([BPX / 2, BPX + BPX / 2])
  })

  it('굵은 격자와 어긋난 몇 px 밀림도 정밀 확인에서 다시 맞춘다', () => {
    const b = strip([1, 2, 3])
    const shifted: Gray = { data: new Uint8Array([...new Uint8Array(3 * W).fill(255), ...b.data]), width: W, rows: b.rows + 3 }
    expect(matches(b, shifted)).toEqual([3, BPX + 3, 2 * BPX + 3])
  })

  it('작은 글자 크기(20×12px)만 달라도 그 블록은 대응 없음 — 굵은 탐색으로는 같아 보이는 경우', () => {
    const a = strip([1, 2, 3])
    const b = patched(a, 60, BPX + 40, 20, 12, 120)
    const blocks = alignBlocks(a, b)
    expect(blocks.map((x) => x.match)).toEqual([0, null, 2 * BPX])
    // 굵은 탐색은 후보를 찾았고(tileDiff 있음), 정밀 확인이 걸러냈다
    expect(blocks[1].tileDiff).toBeGreaterThan(ALIGN.tileThreshold)
  })

  it('반대쪽이 비었거나 자신이 블록보다 짧으면 대응 없음', () => {
    expect(matches(strip([1]), EMPTY)).toEqual([null])
    expect(matches({ data: new Uint8Array(W * ALIGN.scale), width: W, rows: ALIGN.scale }, strip([1]))).toEqual([null])
    expect(alignBlocks(EMPTY, strip([1]))).toEqual([])
  })
})

describe('tileDiffAt', () => {
  it('같으면 0, 맞춰 볼 자리가 없으면 Infinity', () => {
    const a = strip([1, 2])
    expect(tileDiffAt(a, 0, a, 0, BPX)).toBe(0)
    expect(tileDiffAt(a, 0, EMPTY, 0, BPX)).toBe(Infinity)
  })
})

describe('unmatchedRanges', () => {
  it('이웃한 미대응 블록은 한 범위로 묶는다', () => {
    const blocks = alignBlocks(strip([1, 2, 3, 4, 5]), strip([1, 8, 9, 4, 5]))
    expect(unmatchedRanges(blocks)).toEqual([{ start: B, end: 3 * B }])
  })

  it('미대응 범위 사이의 단색 블록은 범위에 포함한다', () => {
    const r = unmatchedRanges(alignBlocks(strip([1, 2, 'flat', 3, 4]), strip([1, 4])))
    expect(r).toEqual([{ start: B, end: 4 * B }])
  })
})

describe('counterpartRange', () => {
  it('반대쪽 같은 자리 = 앞뒤 대응 블록 사이', () => {
    const blocks = alignBlocks(strip([1, 2, 3, 4, 5]), strip([1, 8, 9, 4, 5]))
    expect(counterpartRange(blocks, { top: BPX, bottom: 3 * BPX }, 5 * BPX)).toEqual({ top: BPX, bottom: 3 * BPX })
  })

  it('반대쪽에 그 자리가 없으면(앞뒤가 맞닿음) null', () => {
    const blocks = alignBlocks(strip([1, 2, 3]), strip([1, 3]))
    expect(counterpartRange(blocks, { top: BPX, bottom: 2 * BPX }, 2 * BPX)).toBeNull()
  })

  it('앞뒤에 대응 블록이 없으면 반대쪽 끝까지', () => {
    const blocks = alignBlocks(strip([2, 1]), strip([8, 9, 1]))
    expect(counterpartRange(blocks, { top: 0, bottom: BPX }, 3 * BPX)).toEqual({ top: 0, bottom: 2 * BPX })
  })
})

describe('planPieces', () => {
  it('완전히 같으면 조각이 없다', () => {
    expect(planPieces(strip([1, 2, 3, 4]), strip([1, 2, 3, 4], 3))).toEqual({ pieces: [], cjMatchRate: 1, gsMatchRate: 1 })
  })

  it('한 곳만 다르면 양쪽의 그 자리를 짝지은 조각 하나', () => {
    const plan = planPieces(strip([1, 2, 3, 4, 5, 6]), strip([1, 2, 3, 9, 5, 6]))
    expect(plan.pieces).toEqual([{ cj: { top: 3 * BPX, bottom: 4 * BPX }, gs: { top: 3 * BPX, bottom: 4 * BPX } }])
  })

  it('작은 표기 하나만 달라도 그 자리가 조각이 된다', () => {
    const cj = strip([1, 2, 3, 4, 5, 6])
    const plan = planPieces(cj, patched(cj, 100, 4 * BPX + 30, 20, 12, 120))
    expect(plan.pieces).toEqual([{ cj: { top: 4 * BPX, bottom: 5 * BPX }, gs: { top: 4 * BPX, bottom: 5 * BPX } }])
  })

  it('GS 에만 추가된 내용은 GS 만 있는 조각', () => {
    const plan = planPieces(strip([1, 2, 3, 4]), strip([1, 2, 8, 9, 3, 4]))
    expect(plan.pieces).toEqual([{ cj: null, gs: { top: 2 * BPX, bottom: 4 * BPX } }])
    expect(plan.cjMatchRate).toBe(1)
  })

  it('GS 에서 빠진 내용은 CJ 만 있는 조각', () => {
    const plan = planPieces(strip([1, 2, 8, 9, 3, 4]), strip([1, 2, 3, 4]))
    expect(plan.pieces).toEqual([{ cj: { top: 2 * BPX, bottom: 4 * BPX }, gs: null }])
  })

  it('가까운 미대응 범위(사이 2블록 이하)는 한 조각으로, 멀면 따로', () => {
    const near = planPieces(strip([1, 2, 3, 4, 5, 6, 7, 8]), strip([1, 90, 3, 4, 91, 6, 7, 8]))
    expect(near.pieces).toEqual([{ cj: { top: BPX, bottom: 5 * BPX }, gs: { top: BPX, bottom: 5 * BPX } }])
    const far = planPieces(strip([1, 2, 3, 4, 5, 6, 7, 8]), strip([1, 90, 3, 4, 5, 91, 7, 8]))
    expect(far.pieces).toEqual([
      { cj: { top: BPX, bottom: 2 * BPX }, gs: { top: BPX, bottom: 2 * BPX } },
      { cj: { top: 5 * BPX, bottom: 6 * BPX }, gs: { top: 5 * BPX, bottom: 6 * BPX } },
    ])
  })

  it('전혀 다르면 전체가 한 조각', () => {
    const plan = planPieces(strip([1, 2, 3, 4]), strip([5, 6, 7, 8]))
    expect(plan).toEqual({ pieces: [{ cj: { top: 0, bottom: 4 * BPX }, gs: { top: 0, bottom: 4 * BPX } }], cjMatchRate: 0, gsMatchRate: 0 })
  })

  it('한쪽 상세가 없으면 반대쪽 전체가 한쪽만 있는 조각', () => {
    expect(planPieces(strip([1, 2]), EMPTY).pieces).toEqual([{ cj: { top: 0, bottom: 2 * BPX }, gs: null }])
  })
})

describe('splitPieces', () => {
  it('긴 조각은 양쪽을 같은 걸음으로 나누고, 짧은 쪽이 끝나면 한쪽만 남는다', () => {
    expect(splitPieces([{ cj: { top: 0, bottom: 2000 }, gs: { top: 100, bottom: 900 } }], 800)).toEqual([
      { cj: { top: 0, bottom: 800 }, gs: { top: 100, bottom: 900 } },
      { cj: { top: 800, bottom: 1600 }, gs: null },
      { cj: { top: 1600, bottom: 2000 }, gs: null },
    ])
  })

  it('짧은 조각은 그대로', () => {
    const p = [{ cj: null, gs: { top: 10, bottom: 300 } }]
    expect(splitPieces(p, 800)).toEqual(p)
  })
})

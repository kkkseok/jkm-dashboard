/**
 * 정렬 선별 — CJ·GS 상세에서 "픽셀 수준으로 같은 부분"을 코드로 걸러내고, 안 맞는 구간만 AI 에 보낸다 (순수 함수).
 *
 * 배경(2026-11-19 실측, 18쌍): GS 상세는 대부분 CJ 원본 이미지를 다시 올린 것이라, 일치 쌍은 CJ 블록의
 * 78~98% 가 GS 에서 그대로 발견되고 불일치 쌍은 8~66% 였다. 같은 부분까지 AI 에 다 보여 주면
 * 토큰이 들고, 수십 장 사이에서 대응 위치를 찾다가 차이를 놓치거나 판정이 흔들린다.
 *
 * 2단계로 판단한다 — 굵은 탐색만으로는 숫자 하나 바뀐 정도의 표기 차이(중량·kcal)가 평균에 묻히기 때문.
 *   1) 굵은 탐색: 띠(상세를 세로로 이어 붙인 흑백 이미지)를 SCALE 배 줄인 밝기 프로필로 만들고, 한쪽을 BLOCK 행
 *      단위로 잘라 반대쪽 전체에서 가장 비슷한 위치를 찾는다(평균 절대 오차 ≤ THRESHOLD).
 *   2) 정밀 확인(tileDiffAt): 찾은 위치에서 원본 해상도로 칸(TILE)마다 위치를 다시 맞추고,
 *      **가장 많이 다른 칸**의 값이 TILE_THRESHOLD 이하일 때만 "같다". 작은 글자만 달라도 그 칸에서 걸린다.
 * 단색(여백) 블록은 어디에나 맞으므로 판단에서 뺀다.
 * 맞지 않는 부분은 "조각"으로 묶어(planPieces) CJ·GS 같은 자리를 나란히 AI 에 보낸다.
 * 해시 게이트(gate.ts)와 달리 재압축·재업로드된 같은 이미지도 같다고 본다.
 */

export const ALIGN = {
  /** 굵은 프로필 축소 배율 — 프로필 1행 = 띠 SCALE px. */
  scale: 5,
  /** 프로필 행당 밝기 칸 수. */
  cols: 10,
  /** 블록 높이(프로필 행). */
  block: 32,
  /** 굵은 탐색 임계 — 블록 평균 절대 오차(0~255). */
  threshold: 6,
  /** 단색 블록 판정 — 원본 해상도 표준편차가 이 값 미만. */
  flatStd: 3,
  /** 정밀 확인 칸 크기(px) · 칸 안에서 평균을 내는 셀 크기(px) · 칸별 위치 보정 범위(±px). */
  tile: 20,
  cell: 4,
  shift: 3,
  /**
   * 정밀 확인 임계 — 가장 많이 다른 칸의 "셀 평균 최대 차이"(0~255).
   * 2026-11-19 실측(18쌍): 일치 쌍의 같은 내용 블록 72% 가 30 미만. 대응된 블록에 글자 크기 조각을 바꿔치기한
   * 합성 변경은 14×10px 이상에서 99% 이상(642/673), 10×8px 에서 90% 가 30 이상으로 걸렸다.
   * 올리면 AI 에 덜 보내지만 작은 표기 변경을 놓칠 수 있다(40: 통과 93%, 14×10px 검출 87%).
   */
  tileThreshold: 30,
  /** 정밀 확인 때 블록 전체를 세로로 다시 맞춰 보는 범위(±px). */
  slack: 6,
} as const

/** 흑백 띠: data.length = width × rows (0~255). */
export type Gray = { data: Uint8Array; width: number; rows: number }

/** 굵은 프로필: data.length = rows × ALIGN.cols. */
export type Profile = { data: Uint8Array; rows: number }

export type BlockMatch = {
  /** 블록 시작 행(프로필 행 = 띠 px / SCALE). */
  row: number
  /** 단색(여백) — 대응 판단에서 제외. */
  flat: boolean
  /** 반대쪽 띠에서 대응되는 시작 위치(px). 없으면 null. */
  match: number | null
  /** 굵은 탐색으로 후보를 찾은 블록의 정밀 확인 값(tileDiffAt). 후보가 없으면 null. */
  tileDiff: number | null
}

/** 프로필 행 범위 [start, end). */
export type RowRange = { start: number; end: number }

/** @param phase 시작 px(0 ~ SCALE-1) — 프로필 r 행 = 띠의 [phase + r×SCALE, +SCALE) px. */
export function toProfile(g: Gray, phase = 0): Profile {
  const { scale, cols } = ALIGN
  const rows = Math.max(0, Math.floor((g.rows - phase) / scale))
  const cellW = Math.floor(g.width / cols)
  const data = new Uint8Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0
      for (let y = phase + r * scale; y < phase + (r + 1) * scale; y++) {
        const from = y * g.width + c * cellW
        for (let i = from; i < from + cellW; i++) sum += g.data[i]
      }
      data[r * cols + c] = Math.round(sum / (scale * cellW))
    }
  }
  return { data, rows }
}

/** 띠의 [top, top+height) px 영역이 단색인지. */
function isFlat(g: Gray, top: number, height: number): boolean {
  const from = top * g.width
  const n = height * g.width
  let sum = 0
  let sq = 0
  for (let i = from; i < from + n; i++) {
    sum += g.data[i]
    sq += g.data[i] * g.data[i]
  }
  const mean = sum / n
  return Math.sqrt(Math.max(0, sq / n - mean * mean)) < ALIGN.flatStd
}

/** 띠의 [top, top+height) 영역 적분 영상 → (x, y, w, h) 사각형 합을 O(1) 로. */
function integral(g: Gray, top: number, height: number) {
  const W = g.width + 1
  const s = new Float64Array(W * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < g.width; x++) {
      row += g.data[(top + y) * g.width + x]
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row
    }
  }
  return (x: number, y: number, w: number, h: number) => s[(y + h) * W + x + w] - s[y * W + x + w] - s[(y + h) * W + x] + s[y * W + x]
}

/**
 * 정밀 확인 — a 의 [aTop, aTop+height) 와 b 의 bTop 부근을 원본 해상도로 비교한 값(작을수록 같다).
 *
 *   1) 블록 전체를 세로 ±SLACK px 안에서 가장 잘 맞는 자리에 놓는다.
 *   2) 칸(TILE, 절반씩 겹침)마다 ±SHIFT px 를 더 움직여 가며, CELL×CELL 평균값끼리의 **최대 차이**가 가장 작은 자리를 찾는다.
 *   3) 그 값이 가장 큰 칸의 값을 돌려준다. 맞춰 볼 자리가 없으면 Infinity.
 *
 * 칸마다 따로 맞추는 이유(2026-11-19 진단): GS 이미지는 CJ 와 배율이 미세하게 달라 블록 안에서도 0.5px 씩 밀린다.
 * 픽셀 단위로 비교하면 같은 내용인데도 굵은 글자 테두리에서 오차가 커서 실제 변경과 구분되지 않았다.
 * CELL 평균으로 보면 테두리 어긋남은 줄고, 글자가 바뀐 자리(잉크 위치가 다름)는 그대로 크게 남는다.
 */
export function tileDiffAt(a: Gray, aTop: number, b: Gray, bTop: number, height: number): number {
  const { tile, cell, shift, slack } = ALIGN
  const w = Math.min(a.width, b.width)
  // 1) 블록 전체 세로 위치 — 2px 간격 표본으로 빠르게.
  let bestSum = Infinity
  let bestTop = -1
  for (let d = -slack; d <= slack; d++) {
    const top = bTop + d
    if (top < 0 || top + height > b.rows) continue
    let sum = 0
    for (let y = 0; y < height && sum < bestSum; y += 2) {
      const ai = (aTop + y) * a.width
      const bi = (top + y) * b.width
      for (let x = 0; x < w; x += 2) sum += Math.abs(a.data[ai + x] - b.data[bi + x])
    }
    if (sum < bestSum) {
      bestSum = sum
      bestTop = top
    }
  }
  if (bestTop < 0) return Infinity

  // 2) 칸별 위치 보정 + 셀 평균 최대 차이
  const b0 = Math.max(0, bestTop - shift)
  const bh = Math.min(b.rows, bestTop + height + shift) - b0
  const ia = integral(a, aTop, height)
  const ib = integral(b, b0, bh)
  const stride = Math.max(1, Math.floor(tile / 2))
  const cells = Math.floor(tile / cell)
  const area = cell * cell
  let worst = 0
  for (let ty = 0; ty + tile <= height; ty += stride) {
    for (let tx = 0; tx + tile <= w; tx += stride) {
      let best = Infinity
      for (let dy = -shift; dy <= shift; dy++) {
        const by = bestTop + ty + dy - b0
        if (by < 0 || by + tile > bh) continue
        for (let dx = -shift; dx <= shift; dx++) {
          const bx = tx + dx
          if (bx < 0 || bx + tile > w) continue
          let max = 0
          for (let cy = 0; cy < cells && max < best; cy++) {
            for (let cx = 0; cx < cells; cx++) {
              const v = Math.abs(ia(tx + cx * cell, ty + cy * cell, cell, cell) - ib(bx + cx * cell, by + cy * cell, cell, cell)) / area
              if (v > max) max = v
            }
          }
          if (max < best) best = max
        }
      }
      if (best > worst) worst = best
    }
  }
  return worst
}

/**
 * a 를 블록으로 잘라 각 블록이 b 의 어디와 같은지 찾는다(굵은 탐색 → 정밀 확인).
 * 마지막 자투리는 끝에서 BLOCK 행을 한 블록으로 본다. a 가 BLOCK 보다 짧으면 통째로 한 블록(대응 없음).
 * 반대쪽은 SCALE 가지 위상으로 모두 훑는다 — 이미지 높이가 제각각이라 양쪽의 굵은 격자가 어긋나 있기 때문.
 */
export function alignBlocks(a: Gray, b: Gray): BlockMatch[] {
  const { block, cols, threshold, scale, tileThreshold } = ALIGN
  const pa = toProfile(a)
  const pbs = Array.from({ length: scale }, (_, phase) => toProfile(b, phase))
  if (pa.rows === 0) return []
  if (pa.rows < block) return [{ row: 0, flat: false, match: null, tileDiff: null }]
  const starts: number[] = []
  for (let row = 0; row + block <= pa.rows; row += block) starts.push(row)
  if (pa.rows % block !== 0) starts.push(pa.rows - block)

  const n = block * cols
  const limit = threshold * n
  return starts.map((row): BlockMatch => {
    if (isFlat(a, row * scale, block * scale)) return { row, flat: true, match: null, tileDiff: null }
    const a0 = row * cols
    let best = limit + 1
    let candidate: number | null = null
    pbs.forEach((pb, phase) => {
      for (let off = 0; off + block <= pb.rows; off++) {
        const b0 = off * cols
        let sum = 0
        for (let i = 0; i < n && sum < best; i++) sum += Math.abs(pa.data[a0 + i] - pb.data[b0 + i])
        if (sum < best) {
          best = sum
          candidate = off * scale + phase
        }
      }
    })
    if (candidate === null) return { row, flat: false, match: null, tileDiff: null }
    const tileDiff = tileDiffAt(a, row * scale, b, candidate, block * scale)
    return { row, flat: false, match: tileDiff <= tileThreshold ? candidate : null, tileDiff }
  })
}

/** 대응률 = 대응된 블록 / 단색 아닌 블록. 단색뿐이면 1. */
export function matchRate(blocks: BlockMatch[]): number {
  const solid = blocks.filter((b) => !b.flat)
  return solid.length === 0 ? 1 : solid.filter((b) => b.match !== null).length / solid.length
}

/** 대응 안 된 블록을 이어 붙인 행 범위. 사이에 낀 단색 블록은 범위에 포함한다. */
export function unmatchedRanges(blocks: BlockMatch[]): RowRange[] {
  const ranges: RowRange[] = []
  let open: RowRange | null = null
  for (const b of blocks) {
    if (b.flat) continue
    if (b.match !== null) {
      open = null
      continue
    }
    const end = b.row + ALIGN.block
    if (open) open.end = Math.max(open.end, end)
    else ranges.push((open = { start: b.row, end }))
  }
  return ranges
}

/** 띠의 세로 범위 [top, bottom) px. */
export type PxRange = { top: number; bottom: number }

/**
 * AI 에 보낼 조각 — 양쪽이 서로 맞지 않는 부분. cj·gs 가 다 있으면 "같은 자리"의 두 쪽(나란히 붙여 보낸다),
 * 한쪽만 있으면 반대쪽 그 자리에는 맞지 않는 내용이 없다(= 그쪽에만 있는 내용).
 */
export type Piece = { cj: PxRange | null; gs: PxRange | null }

export type PiecePlan = {
  pieces: Piece[]
  /** 각 쪽 블록이 반대쪽에서 발견된 비율(0~1). */
  cjMatchRate: number
  gsMatchRate: number
}

/** 미대응 범위(프로필 행) → px. 사이가 gapBlocks 블록 이하로 가까운 범위는 하나로 합친다(조각 수를 줄이려고). */
function toPxRanges(ranges: RowRange[], rows: number, gapBlocks = 2): PxRange[] {
  const out: PxRange[] = []
  for (const r of ranges) {
    const top = r.start * ALIGN.scale
    const bottom = Math.min(rows, r.end * ALIGN.scale)
    const last = out[out.length - 1]
    if (last && top - last.bottom <= gapBlocks * ALIGN.block * ALIGN.scale) last.bottom = Math.max(last.bottom, bottom)
    else out.push({ top, bottom })
  }
  return out
}

/**
 * 미대응 범위의 "반대쪽 같은 자리" — 범위 앞뒤로 가장 가까운 대응 블록 사이(px).
 * 앞뒤가 맞닿거나 순서가 뒤집혀 있으면(반대쪽에 그 자리가 없음) null.
 */
export function counterpartRange(blocks: BlockMatch[], range: PxRange, otherRows: number): PxRange | null {
  const bpx = ALIGN.block * ALIGN.scale
  let top = 0
  let bottom = otherRows
  for (const b of blocks) {
    if (b.match === null) continue
    const y = b.row * ALIGN.scale
    if (y + bpx <= range.top) top = b.match + bpx
    else if (y >= range.bottom) {
      bottom = b.match
      break
    }
  }
  top = Math.min(top, otherRows)
  return bottom > top ? { top, bottom } : null
}

/**
 * 양쪽 띠 → AI 에 보낼 조각.
 *   1) 각 쪽에서 반대쪽에 같은 모습으로 없는 범위를 구한다.
 *   2) CJ 범위마다 GS 의 같은 자리(counterpartRange)와 겹치는 GS 범위를 짝지운다.
 *   3) 짝이 없는 범위는 한쪽만 있는 조각이 된다.
 * 한쪽이 비어 있으면(상세 없음) 반대쪽 전체가 한쪽만 있는 조각이 된다.
 */
export function planPieces(cj: Gray, gs: Gray): PiecePlan {
  const cjBlocks = alignBlocks(cj, gs)
  const gsBlocks = alignBlocks(gs, cj)
  const cjRanges = toPxRanges(unmatchedRanges(cjBlocks), cj.rows)
  const gsRanges = toPxRanges(unmatchedRanges(gsBlocks), gs.rows)
  const used = new Set<number>()
  const pieces: Piece[] = cjRanges.map((range) => {
    const spot = counterpartRange(cjBlocks, range, gs.rows)
    let paired: PxRange | null = null
    if (spot) {
      gsRanges.forEach((g, i) => {
        if (used.has(i) || g.bottom <= spot.top || g.top >= spot.bottom) return
        used.add(i)
        paired = paired ? { top: Math.min(paired.top, g.top), bottom: Math.max(paired.bottom, g.bottom) } : { ...g }
      })
    }
    return { cj: range, gs: paired }
  })
  gsRanges.forEach((g, i) => {
    if (!used.has(i)) pieces.push({ cj: null, gs: g })
  })
  return { pieces, cjMatchRate: matchRate(cjBlocks), gsMatchRate: matchRate(gsBlocks) }
}

/** 긴 조각을 maxHeight px 이하로 위에서부터 나눈다(양쪽을 같은 걸음으로 — 나란히 놓았을 때 같은 자리가 유지되게). */
export function splitPieces(pieces: Piece[], maxHeight: number): Piece[] {
  const out: Piece[] = []
  const cut = (r: PxRange | null, k: number): PxRange | null => {
    if (!r) return null
    const top = r.top + k * maxHeight
    return top < r.bottom ? { top, bottom: Math.min(r.bottom, top + maxHeight) } : null
  }
  for (const p of pieces) {
    const height = Math.max(p.cj ? p.cj.bottom - p.cj.top : 0, p.gs ? p.gs.bottom - p.gs.top : 0)
    for (let k = 0; k * maxHeight < height; k++) out.push({ cj: cut(p.cj, k), gs: cut(p.gs, k) })
  }
  return out
}

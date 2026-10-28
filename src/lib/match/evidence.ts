/**
 * 차이 근거 이미지 — AI 가 지목한 "상세 구간 번호"를 원본 이미지의 위치로 되돌린다.
 *
 * 판정 때 상세 이미지들을 폭 DETAIL_WIDTH 로 세로로 이어 붙이고 SEGMENT 높이로 잘라
 * `[GS 상세 5/11]` 처럼 번호를 붙여 보낸다. 이어 붙인 위치(StripPart)를 알고 있으므로
 * 구간 n 이 어느 원본 이미지의 어디부터 어디까지인지 정확히 계산할 수 있다.
 * 이미지는 저장하지 않고(설계 §3, 사용자 확정 1-a) 화면이 원본 URL 에서 그 위치만 잘라 보여준다.
 */

/** 이어 붙인 띠 안에서 원본 이미지 한 장의 위치 (px, 폭은 띠 폭으로 정규화). */
export type StripPart = { url: string; top: number; height: number }

/** 원본 이미지의 일부. top/bottom 은 그 이미지 높이 대비 0~1, aspect = 높이/폭. */
export type EvidenceCrop = { url: string; top: number; bottom: number; aspect: number }

/**
 * 1-based 구간 번호 → 겹치는 원본 이미지 조각들.
 * @param width 띠 폭(px) — aspect 계산용
 */
export function segmentToCrops(
  parts: StripPart[],
  segment: number,
  segmentHeight: number,
  width: number,
): EvidenceCrop[] {
  const y0 = (segment - 1) * segmentHeight
  const y1 = y0 + segmentHeight
  const out: EvidenceCrop[] = []
  for (const p of parts) {
    const a = Math.max(y0, p.top)
    const b = Math.min(y1, p.top + p.height)
    if (b <= a || p.height <= 0) continue
    out.push({
      url: p.url,
      top: round((a - p.top) / p.height),
      bottom: round((b - p.top) / p.height),
      aspect: round(p.height / width),
    })
  }
  return out
}

/** 여러 구간 → 조각들. 같은 이미지의 붙어 있는 조각은 하나로 합친다. 구간 수는 maxSegments 로 제한. */
export function segmentsToCrops(
  parts: StripPart[],
  segments: number[],
  segmentHeight: number,
  width: number,
  maxSegments = 3,
): EvidenceCrop[] {
  const total = parts.reduce((m, p) => Math.max(m, p.top + p.height), 0)
  const count = Math.ceil(total / segmentHeight)
  const valid = [...new Set(segments)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= count)
    .sort((a, b) => a - b)
    .slice(0, maxSegments)
  const merged: EvidenceCrop[] = []
  for (const c of valid.flatMap((n) => segmentToCrops(parts, n, segmentHeight, width))) {
    const last = merged[merged.length - 1]
    if (last && last.url === c.url && Math.abs(last.bottom - c.top) < 1e-3) last.bottom = c.bottom
    else merged.push({ ...c })
  }
  return merged
}

const round = (n: number) => Math.round(n * 10000) / 10000

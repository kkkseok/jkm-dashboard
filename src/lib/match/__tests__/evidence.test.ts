/**
 * evidence — 상세 구간 번호 → 원본 이미지 위치 변환 테스트.
 */

import { describe, expect, it } from 'vitest'
import { segmentToCrops, segmentsToCrops, type StripPart } from '../evidence'

// 폭 700 띠: a(0~1000) · b(1000~3800) · c(3800~4200)
const W = 700
const SEG = 1400
const parts: StripPart[] = [
  { url: 'a', top: 0, height: 1000 },
  { url: 'b', top: 1000, height: 2800 },
  { url: 'c', top: 3800, height: 400 },
]

describe('segmentToCrops', () => {
  it('구간 1 = a 전체 + b 위쪽 400px', () => {
    expect(segmentToCrops(parts, 1, SEG, W)).toEqual([
      { url: 'a', top: 0, bottom: 1, aspect: 1.4286 },
      { url: 'b', top: 0, bottom: 0.1429, aspect: 4 },
    ])
  })

  it('구간 3(2800~4200) = b 아래쪽(1800/2800 지점부터) + c 전체', () => {
    expect(segmentToCrops(parts, 3, SEG, W)).toEqual([
      { url: 'b', top: 0.6429, bottom: 1, aspect: 4 },
      { url: 'c', top: 0, bottom: 1, aspect: 0.5714 },
    ])
  })
})

describe('segmentsToCrops', () => {
  it('연속 구간의 같은 이미지는 합친다', () => {
    expect(segmentsToCrops(parts, [2, 1], SEG, W)).toEqual([
      { url: 'a', top: 0, bottom: 1, aspect: 1.4286 },
      { url: 'b', top: 0, bottom: 0.6429, aspect: 4 },
    ])
  })

  it('범위 밖·중복·소수 구간 번호는 버리고 최대 개수로 자른다', () => {
    expect(segmentsToCrops(parts, [0, 4, 1.5, 3, 3], SEG, W).map((c) => c.url)).toEqual(['b', 'c'])
    expect(segmentsToCrops(parts, [1, 2, 3], SEG, W, 1).map((c) => c.url)).toEqual(['a', 'b'])
  })
})

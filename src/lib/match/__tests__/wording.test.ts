import { describe, expect, it } from 'vitest'
import { friendlyFetchError, friendlyLogNote, friendlyRunError } from '../wording'

/** 화면에 나가면 안 되는 표현 — 내부 필드·도구 이름·HTTP 상태. */
const LEAK = /HTTP|og:image|prdImgDescd|NUXT|claude|exit|중계|icn1/i

describe('friendlyFetchError', () => {
  const cases: [string, RegExp][] = [
    ['HTTP 404', /찾을 수 없습니다/],
    ['HTTP 503', /불러오지 못했습니다/],
    ['GS 중계 HTTP 502 (icn1)', /불러오지 못했습니다/],
    ['CJ 썸네일(og:image) 없음 — title=점검중', /^CJ 상품 페이지에서 대표 이미지/],
    ['GS 썸네일(og:image) 없음 — HTTP 404 안내', /^GS 상품 페이지에서 대표 이미지/],
    ['GS 상세 기술서(prdImgDescd·prdDescUrl) 없음 — title=GS SHOP', /^GS 상품 페이지에서 상세 이미지/],
    ['GS 상세 이미지 0장', /^GS 상품 페이지에서 상세 이미지/],
    ['CJ __NUXT_DATA__ 없음', /^CJ 상품 페이지에서 상세 이미지/],
    ['fetch failed', /불러오지 못했습니다/],
    ['알 수 없는 오류', /이미지를 가져오지 못했습니다/],
  ]
  it.each(cases)('%s', (raw, expected) => {
    const out = friendlyFetchError(raw)
    expect(out).toMatch(expected)
    expect(out).not.toMatch(LEAK)
  })
})

describe('friendlyRunError', () => {
  it('판정 실패 건수', () => {
    expect(friendlyRunError('판정 실패 3건')).toBe('3건을 판정하지 못했습니다. 다음 실행에서 다시 시도합니다.')
  })
  it('한도·인증으로 중단', () => {
    expect(friendlyRunError('판정 실패 12건 (한도·인증 오류로 중단)')).toMatch(/^12건을 판정하지 못하고 중간에 멈췄습니다/)
  })
  it('수집 전면 실패', () => {
    expect(friendlyRunError('수집 실패 300/483 — 사이트 차단 또는 페이지 구조 변경 의심')).toMatch(/^대상 483건 중 300건/)
  })
  it('그 밖의 원문은 내보내지 않는다', () => {
    const out = friendlyRunError('connect ECONNREFUSED 10.0.0.1:5432')
    expect(out).not.toMatch(/ECONN|5432/)
  })
})

describe('friendlyLogNote', () => {
  it('판정 실패 메모의 원문을 가린다', () => {
    const out = friendlyLogNote('판정 실패: claude 결과 없음 (exit 1) rate limit', 'batch', 'diff')
    expect(out).not.toMatch(LEAK)
  })
  it('수집 실패 전환 메모', () => {
    expect(friendlyLogNote('HTTP 404', 'batch', 'error')).toMatch(/찾을 수 없습니다/)
  })
  it('판정 요약·확인자 메모는 그대로', () => {
    expect(friendlyLogNote('GS는 구 패키지', 'batch', 'diff')).toBe('GS는 구 패키지')
    expect(friendlyLogNote('확인자 판정: 같은 상품 — HTTP 얘기', 'user', 'match')).toBe('확인자 판정: 같은 상품 — HTTP 얘기')
  })
})

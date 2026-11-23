/**
 * extract — 상품 페이지 HTML 추출 테스트.
 * 픽스처는 2026-10 PoC 에서 확인한 실제 구조를 최소화한 것.
 */

import { describe, expect, it } from 'vitest'
import {
  extractCjDetail,
  extractCjThumb,
  extractGsDescHtml,
  extractGsDescUrl,
  extractGsDetail,
  extractGsThumb,
} from '../extract'

/** Nuxt 3 payload: 객체 값은 배열 인덱스 참조. */
function nuxtPayload(): string {
  const arr: unknown[] = [
    ['Reactive', 1],
    { docs: 2 },
    [3, 5, 7, 9],
    // 갤러리(01) — 제외
    { contUrl: 4, dispOdr: 11, docDispPtnCd: 12, useYn: 13 },
    '/product/377/thumb.jpg',
    // 상세(05) 2번째
    { contUrl: 6, dispOdr: 14, docDispPtnCd: 15, useYn: 13 },
    '/product/626/detail2.jpg',
    // 상세(05) 1번째 + 설명
    { contUrl: 8, contDesc: 16, dispOdr: 11, docDispPtnCd: 15, useYn: 13 },
    '/product/855/detail1.jpg',
    // 상세(05) 동영상 — 제외
    { contUrl: 10, dispOdr: 17, docDispPtnCd: 15, useYn: 13 },
    '/product/633/movie.mp4',
    1,
    '01',
    'Y',
    2,
    '05',
    '소개 — 담백한 육수',
    3,
  ]
  return `<script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(arr)}</script>`
}

describe('CJ', () => {
  const html = `<head><meta property="og:image" content="https://img.cjthemarket.com/images/file/product/377/thumb.jpg?SF=webp&amp;RS=550"></head>${nuxtPayload()}`

  it('썸네일은 리사이즈 쿼리를 뗀 원본', () => {
    expect(extractCjThumb(html)).toBe('https://img.cjthemarket.com/images/file/product/377/thumb.jpg')
  })

  it('상세는 05 문서만, dispOdr 순, 동영상 제외, 설명 포함', () => {
    expect(extractCjDetail(html)).toEqual([
      { url: 'https://img.cjthemarket.com/images/file/product/855/detail1.jpg', desc: '소개 — 담백한 육수' },
      { url: 'https://img.cjthemarket.com/images/file/product/626/detail2.jpg', desc: undefined },
    ])
  })

  it('__NUXT_DATA__ 가 없으면 에러 (구조 변경 신호)', () => {
    expect(() => extractCjDetail('<html></html>')).toThrow(/NUXT_DATA/)
  })
})

describe('GS', () => {
  // 2026-11-23 구조: 기술서 HTML 이 페이지 데이터(JSON) 문자열로 들어 있다. 첫 장만 src, 나머지는 data-src.
  const descd =
    '<p align="center"><img src="https://jjack333.cafe24.com/cj_none.jpg"></p>\n' +
    '<p align="center"><img data-src="https://jjack333.cafe24.com/CJ_cheiljedang/detail_page/210418.jpg"></p>'
  const html = `<meta property="og:image" content="https://asset.m-gs.kr/prod/1066284526/1/280">
    <script>var d = {"prdDescUrl":"/prd/prdDesc.gs?prdid=1066284526","prdImgDescd":${JSON.stringify(descd)},"topFlg":"N"};</script>`

  it('썸네일은 1000px 로 교체', () => {
    expect(extractGsThumb(html)).toBe('https://asset.m-gs.kr/prod/1066284526/1/1000')
  })

  it('기술서 HTML 은 JSON 문자열을 풀어서 반환', () => {
    expect(extractGsDescHtml(html)).toBe(descd)
    expect(extractGsDescHtml('<html>없음</html>')).toBeNull()
  })

  it('상세 페이지 절대 URL', () => {
    expect(extractGsDescUrl(html)).toBe('https://www.gsshop.com/prd/prdDesc.gs?prdid=1066284526')
  })

  it('지연 로딩 data-src 와 src 를 순서대로', () => {
    expect(extractGsDetail(extractGsDescHtml(html)!).map((d) => d.url)).toEqual([
      'https://jjack333.cafe24.com/cj_none.jpg',
      'https://jjack333.cafe24.com/CJ_cheiljedang/detail_page/210418.jpg',
    ])
  })

  it('상세 이미지는 순서대로, 주석·상대경로·중복 제외', () => {
    const desc = `<div>
      <img src='https://asset.m-gs.kr/product/api/orgdesc/1/a/dims/optimize'>
      <!-- <img src="https://asset.m-gs.kr/old.jpg"> -->
      <img class="x" src="https://asset.m-gs.kr/product/api/orgdesc/1/b/dims/crop/0x1200+0+0/optimize">
      <img src="/images/blank.gif">
      <img src='https://asset.m-gs.kr/product/api/orgdesc/1/a/dims/optimize'>
    </div>`
    expect(extractGsDetail(desc).map((d) => d.url)).toEqual([
      'https://asset.m-gs.kr/product/api/orgdesc/1/a/dims/optimize',
      'https://asset.m-gs.kr/product/api/orgdesc/1/b/dims/crop/0x1200+0+0/optimize',
    ])
  })
})

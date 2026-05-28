import { describe, expect, it } from 'vitest'
import { normalizeSalesType } from '../sales-type'

/**
 * 사용자 확정 매핑 표 (2026-05-28). 한 줄이라도 깨지면 회귀.
 * 입력 → 기대 라벨.
 */
const USER_FIXTURE: Array<[string, string]> = [
  ['[B2B]', 'B2B'],
  ['A-공통엑셀양식(쇼핑엔티(e272288))', '쇼핑엔티'],
  ['A-공통엑셀양식(알리나드)', '알리나드'],
  ['A-공통엑셀양식(토스)', '토스'],
  ['A-공통엑셀양식(W쇼핑)', 'W쇼핑'],
  ['A-롯데온(LD465202)', '롯데온'],
  ['A-테무(sypark@jkmincorp.com)', '테무'],
  ['A-CJ온스타일(jkman2)', 'CJ온스타일'],
  ['A-G마켓(jkman10)', 'G마켓'],
  ['A-G마켓(jkman7)', 'G마켓'],
  ['B-공통엑셀양식(뉴띵샵)', '뉴띵샵'],
  ['B-공통엑셀양식(신세계티비)', '신세계티비'],
  ['B-공통엑셀양식(제이슨딜)', '제이슨딜'],
  ['B-공통엑셀양식(코오롱(W스토어))', '코오롱(W스토어)'],
  ['B-롯데홈쇼핑(015573LT)', '롯데홈쇼핑'],
  ['B-에이블리(에이블리)', '에이블리'],
  ['B-와플샵(한미양행)', '한미양행'],
  ['B-이랜드몰(jkmincorp)', '이랜드몰'],
  ['B-쿠팡(jkman2)', '쿠팡'],
  ['B-패션플러스(jkman2)', '패션플러스'],
  ['B-GS SHOP(1026971)', 'GSshop'],
  ['C-공통엑셀양식(아이엠쇼핑)', '아이엠쇼핑'],
  ['C-공통엑셀양식(오늘의집)', '오늘의집'],
  ['C-공통엑셀양식(캐시딜)', '캐시딜'],
  ['C-공통엑셀양식(SK스토아)', 'SK스토아'],
  ['C-농수산eshop(109267)', '농수산eshop'],
  ['C-농협e쇼핑(jkman2)', '농협e쇼핑'],
  ['C-동원몰(jkman2)', '동원몰'],
  ['C-스마트스토어(jkman2)', '스마트스토어'],
  ['C-신세계몰(0009179186)', '신세계몰'],
  ['C-이지웰(jkman2)', '이지웰'],
  ['C-홈앤쇼핑(e103332)', '홈앤쇼핑'],
  ['C-Hmall(hsjkman2)', 'Hmall'],
  ['C-K쇼핑(E438037)', 'K쇼핑'],
  ['C-NS홈쇼핑(109267)', 'NS홈쇼핑'],
]

describe('normalizeSalesType — 사용자 매핑 표 전건', () => {
  for (const [raw, expected] of USER_FIXTURE) {
    it(`${raw} → ${expected}`, () => {
      expect(normalizeSalesType(raw)).toBe(expected)
    })
  }
})

describe('normalizeSalesType — 엣지 케이스', () => {
  it('null → null', () => {
    expect(normalizeSalesType(null)).toBeNull()
  })
  it('undefined → null', () => {
    expect(normalizeSalesType(undefined)).toBeNull()
  })
  it('빈 문자열 → null', () => {
    expect(normalizeSalesType('')).toBeNull()
  })
  it('공백만 → null', () => {
    expect(normalizeSalesType('   ')).toBeNull()
  })
  it('알 수 없는 패턴은 trim 후 원본', () => {
    expect(normalizeSalesType('완전새로운채널')).toBe('완전새로운채널')
  })
  it('prefix 없음 + 영숫자 식별자 괄호도 정리', () => {
    expect(normalizeSalesType('쿠팡(jkman2)')).toBe('쿠팡')
  })
  it('대괄호 안에 공백 — trim', () => {
    expect(normalizeSalesType('[ B2B ]')).toBe('B2B')
  })
})

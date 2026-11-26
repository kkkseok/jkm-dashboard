/**
 * parseMatchSourceBuffer — 헤더 이름 탐지 + 행 검증 회귀 테스트.
 *
 * 예시 파일(docs/matching/url_matching_example.xlsx)은 A열·1행이 비고 B2 에서 헤더가 시작한다.
 * 시작 위치·열 순서가 달라도 같은 결과가 나와야 한다.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseMatchSourceBuffer } from '../parse'
import { cjProductId, gsProductId, sameProductUrls } from '../mapping'

type Cell = string | number | null

const CJ = (n: number) =>
  `https://www.cjthemarket.com/the/product/product-main?prdCd=${n}&plnId=300004&areaNum=2`
const GS = (n: number) => `https://www.gsshop.com/prd/prd.gs?prdid=${n}`

/**
 * aoa 를 origin 위치에 깔아 평문 xlsx 버퍼로 만든다.
 * !ref 를 origin 부터 시작하게 고친다 — 실제 예시 파일(!ref = B2:F20)과 같은 조건.
 * (sheet_add_aoa 는 범위를 항상 A1 부터 잡아 열 오프셋 버그를 가린다.)
 */
function toBuffer(aoa: Cell[][], origin = 'A1'): ArrayBuffer {
  const ws: XLSX.WorkSheet = {}
  XLSX.utils.sheet_add_aoa(ws, aoa, { origin })
  ws['!ref'] = XLSX.utils.encode_range({
    s: XLSX.utils.decode_cell(origin),
    e: XLSX.utils.decode_range(ws['!ref'] ?? origin).e,
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

describe('parseMatchSourceBuffer', () => {
  it('예시 파일 레이아웃(B2 시작)을 헤더 이름으로 인식한다', () => {
    const buf = toBuffer(
      [
        ['자재코드', '자재명', 'GS', '본사'],
        [207969, '비비고/진국육수 소고기양지 500G/상온', GS(1066284526), CJ(40125936)],
        [195606, '스팸 클래식 200G/상온', GS(1066536500), CJ(40134660)],
      ],
      'B2',
    )
    const r = parseMatchSourceBuffer(buf)
    expect(r.layout).toEqual({
      sheet: 'Sheet1',
      headerRow: 2,
      cols: { matCode: 'B', productName: 'C', gsUrl: 'D', cjUrl: 'E' },
    })
    expect(r.rows).toEqual([
      {
        matCode: '207969',
        productName: '비비고/진국육수 소고기양지 500G/상온',
        gsUrl: GS(1066284526),
        cjUrl: CJ(40125936),
      },
      {
        matCode: '195606',
        productName: '스팸 클래식 200G/상온',
        gsUrl: GS(1066536500),
        cjUrl: CJ(40134660),
      },
    ])
    expect(r.stats).toEqual({ validCount: 2, dupCount: 0, invalidCount: 0 })
  })

  it('열 순서가 바뀌고 헤더 앞에 제목 행이 있어도 인식한다', () => {
    const buf = toBuffer([
      ['이미지 대조 대상', null, null, null],
      ['본사', ' 자재 코드 ', 'GS', '자재명'],
      [CJ(1), 'A1', GS(1), '상품1'],
    ])
    const r = parseMatchSourceBuffer(buf)
    expect(r.layout.headerRow).toBe(2)
    expect(r.rows).toEqual([
      { matCode: 'A1', productName: '상품1', cjUrl: CJ(1), gsUrl: GS(1) },
    ])
  })

  it('중복 자재코드·URL 오류·자재코드 누락은 제외하고 경고를 남긴다', () => {
    const buf = toBuffer([
      ['자재코드', '자재명', 'GS', '본사'],
      [1, '정상', GS(1), CJ(1)],
      [1, '중복', GS(2), CJ(2)],
      [2, 'GS 오류', 'https://example.com/x', CJ(3)],
      [3, '본사 오류', GS(4), 'https://www.cjthemarket.com/the/product/product-main'],
      [null, '코드 없음', GS(5), CJ(5)],
      [null, null, null, null],
    ])
    const r = parseMatchSourceBuffer(buf)
    expect(r.rows.map((x) => x.productName)).toEqual(['정상'])
    expect(r.stats).toEqual({ validCount: 1, dupCount: 1, invalidCount: 3 })
    expect(r.warnings).toHaveLength(4)
  })

  it('필수 헤더가 없으면 에러로 막는다', () => {
    const buf = toBuffer([
      ['자재코드', '자재명', 'GS'],
      [1, '상품', GS(1)],
    ])
    expect(() => parseMatchSourceBuffer(buf)).toThrow(/헤더를 찾지 못했습니다/)
  })

  it('운영 목록 표기(상품명·더마켓)도 인식한다', () => {
    const buf = toBuffer(
      [
        ['자재코드', '상품명', 'GS', '더마켓'],
        [207969, '비비고 소고기양지 육수 500g x3개', GS(1066284526), CJ(40161425)],
      ],
      'B2',
    )
    const r = parseMatchSourceBuffer(buf)
    expect(r.layout.cols).toEqual({ matCode: 'B', productName: 'C', gsUrl: 'D', cjUrl: 'E' })
    expect(r.rows).toEqual([
      {
        matCode: '207969',
        productName: '비비고 소고기양지 육수 500g x3개',
        gsUrl: GS(1066284526),
        cjUrl: CJ(40161425),
      },
    ])
  })

  it("'전체리스트' 시트가 있으면 첫 시트가 아니어도 그 시트를 읽는다", () => {
    const sheet = (aoa: Cell[][]) => XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ['자재코드', '상품명', 'GS', '더마켓'],
        [1, '완료분', GS(1), CJ(1)],
      ]),
      '완료',
    )
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ['자재코드', '상품명', 'GS', '더마켓'],
        [1, '전체1', GS(1), CJ(1)],
        [2, '전체2', GS(2), CJ(2)],
      ]),
      '전체리스트',
    )
    const r = parseMatchSourceBuffer(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(r.layout.sheet).toBe('전체리스트')
    expect(r.rows.map((x) => x.productName)).toEqual(['전체1', '전체2'])
  })
})

describe('sameProductUrls — 상품번호 기준 비교', () => {
  const pair = (cjUrl: string, gsUrl: string) => ({ cjUrl, gsUrl })
  const cjTail = (n: number, tail: string) =>
    `https://www.cjthemarket.com/the/product/product-main?prdCd=${n}${tail}`

  it('상품번호를 읽는다', () => {
    expect(cjProductId(CJ(40161425))).toBe('40161425')
    expect(gsProductId(GS(1066284526))).toBe('1066284526')
    expect(cjProductId('https://www.cjthemarket.com/the/product/product-main')).toBeNull()
  })

  it('CJ 주소 꼬리표만 다르면 같은 상품이다', () => {
    expect(
      sameProductUrls(
        pair(cjTail(40134660, ''), GS(1)),
        pair(cjTail(40134660, '&spclCtgrId=&ctgrId=&plnId=300004&areaNum=1'), GS(1)),
      ),
    ).toBe(true)
  })

  it('CJ 또는 GS 상품번호가 다르면 다른 상품이다', () => {
    expect(sameProductUrls(pair(CJ(40125936), GS(1)), pair(CJ(40161425), GS(1)))).toBe(false)
    expect(sameProductUrls(pair(CJ(1), GS(1083471042)), pair(CJ(1), GS(1121062262)))).toBe(false)
  })

  it('앞자리가 같은 상품번호를 같은 상품으로 보지 않는다', () => {
    expect(sameProductUrls(pair(CJ(4016142), GS(1)), pair(CJ(40161425), GS(1)))).toBe(false)
  })
})

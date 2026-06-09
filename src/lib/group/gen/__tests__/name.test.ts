import { describe, expect, it } from 'vitest'
import { buildGroupName, stripBrandPrefix } from '../name'

/**
 * 그룹상품명(B) 규칙 전건 검증.
 * 케이스는 docs/group/group_upload_0609.xlsx · sample_group_upload.xlsx 의 실제 출력에서 채취해
 * DB 매핑 결과(내품 erpName/수량)와 함께 문자 단위로 확정한 값이다.
 */

describe('stripBrandPrefix', () => {
  it('(채널표기)-[제조사]-[브랜드]- 접두를 제거한다', () => {
    expect(
      stripBrandPrefix('(Y)-[CJ제일제당]-[백설]-야채육수에는-1분링-80G-[상온]'),
    ).toBe('야채육수에는-1분링-80G-[상온]')
    expect(
      stripBrandPrefix('(Y)-[CJ제일제당]-[백설]-허브맛솔트-순한맛-50g-[상온]-[184119]'),
    ).toBe('허브맛솔트-순한맛-50g-[상온]-[184119]')
  })

  it('접두 형태가 아니면 원본을 유지한다', () => {
    expect(stripBrandPrefix('야채육수에는-1분링')).toBe('야채육수에는-1분링')
    expect(stripBrandPrefix('(Y)-[CJ제일제당]-그냥상품명')).toBe('(Y)-[CJ제일제당]-그냥상품명')
  })
})

describe('buildGroupName — 단품', () => {
  it('group_upload_0609 그룹2 (이랜드몰)', () => {
    expect(
      buildGroupName({
        marketName: 'B-이랜드몰(jkmincorp)',
        marketCode: '2501693578',
        items: [{ erpName: '(Y)-[CJ제일제당]-[비비고]-한식간장-김자반-20g-[상온]', quantity: 2 }],
      }),
    ).toBe('(Y)-[CJ제일제당]-[비비고]-한식간장-김자반-20g-[상온]x2-[이랜드몰]-[2501693578]-[그룹]')
  })
})

describe('buildGroupName — 묶음', () => {
  it('group_upload_0609 그룹6: 2번째 내품 접두 생략 (이랜드몰)', () => {
    expect(
      buildGroupName({
        marketName: 'B-이랜드몰(jkmincorp)',
        marketCode: '2509066267',
        items: [
          { erpName: '(Y)-[CJ제일제당]-[백설]-멸치디포리육수에는-1분링-80g-[상온]', quantity: 1 },
          { erpName: '(Y)-[CJ제일제당]-[백설]-야채육수에는-1분링-80G-[상온]', quantity: 1 },
        ],
      }),
    ).toBe(
      '(Y)-[CJ제일제당]-[백설]-멸치디포리육수에는-1분링-80g-[상온]x1+야채육수에는-1분링-80G-[상온]x1-[이랜드몰]-[2509066267]-[그룹]',
    )
  })

  it('sample_group_upload 그룹1: 브랜드 다른 내품도 자기 접두 제거 (GS-S)', () => {
    expect(
      buildGroupName({
        // sample 의 채널 라벨은 "GS-S". no_mapping 입력이 없어 마켓명 원문은 결과값으로 역지정.
        marketName: 'GS-S',
        marketCode: '1066686974',
        items: [
          { erpName: '(Y)-[CJ제일제당]-[비비고]-영양삼계탕-800g-[상온]', quantity: 6 },
          { erpName: '(Y)-[CJ제일제당]-[백설]-허브맛솔트-순한맛-50g-[상온]-[184119]', quantity: 1 },
        ],
      }),
    ).toBe(
      '(Y)-[CJ제일제당]-[비비고]-영양삼계탕-800g-[상온]x6+허브맛솔트-순한맛-50g-[상온]-[184119]x1-[GS-S]-[1066686974]-[그룹]',
    )
  })
})

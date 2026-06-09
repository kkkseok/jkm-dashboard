/**
 * 그룹상품명(B) 생성기 — 사용자 확정 규칙 (group_upload_0609 / sample_group_upload 문자 단위 검증).
 *
 *   단품: {ERPia상품명}x{수량}-[{채널}]-[{마켓코드}]-[그룹]
 *   묶음: {내품1 전체}x{q1}+{내품2…}x{q2}…-[{채널}]-[{마켓코드}]-[그룹]
 *         (2번째 내품부터 자기 접두 "(채널표기)-[제조사]-[브랜드]-" 제거)
 *
 * 채널은 매출구분과 동일한 normalizeSalesType 으로 정규화한다(예: "B-이랜드몰(jkmincorp)"→"이랜드몰").
 * 규칙은 사용자 확정값이라 임의 변경 금지.
 */

import { normalizeSalesType } from '@/lib/minus/sales-type'
import {
  BRAND_PREFIX_RE,
  GROUP_NAME_SUFFIX_TAG,
} from './mapping'

/** 묶음 2번째+ 내품에서 "(채널표기)-[제조사]-[브랜드]-" 접두 제거. 형태 불일치면 원본 유지. */
export function stripBrandPrefix(erpName: string): string {
  return erpName.replace(BRAND_PREFIX_RE, '')
}

/** B 생성 입력 — 단품은 items 1개, 묶음은 내품 순서대로 N개. */
export type GroupNameItem = { erpName: string; quantity: number }

/**
 * 그룹상품명(B) 한 줄 생성.
 * @param marketName 마켓명 원문(no_mapping C). 내부에서 채널 정규화.
 */
export function buildGroupName(params: {
  marketName: string
  marketCode: string
  items: GroupNameItem[]
}): string {
  const { marketName, marketCode, items } = params
  const channel = normalizeSalesType(marketName) ?? ''
  const body = items
    .map((it, i) => {
      const name = i === 0 ? it.erpName : stripBrandPrefix(it.erpName)
      return `${name}x${it.quantity}`
    })
    .join('+')
  return `${body}-[${channel}]-[${marketCode}]-[${GROUP_NAME_SUFFIX_TAG}]`
}

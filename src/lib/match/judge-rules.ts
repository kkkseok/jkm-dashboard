/**
 * 이미지 대조 AI 판정 규칙 — **판정 기준의 원본은 이 파일 한 곳**.
 *
 * 규칙을 바꾸면 RULES_VERSION 을 올린다. match_check.rules_version 에 기록되므로
 * 바뀐 규칙으로 전체 재판정할 대상을 가려낼 수 있다.
 * 사용자 확정(2026-10-28): 판매 단위(입수·세트·박스/낱개) 차이는 무시, 상품 외관·패키지 변경은 차이.
 *   패키지 리뉴얼(207969)·에디션 패키지(213404)도 차이. 36입 박스 vs 24+24(214302)는 같은 상품.
 * 2026-10-28.3: 차이마다 확신도·근거 구간 번호를 받는다 — 확신 높은 차이가 없으면 판정 보류(사람 확인),
 *   근거 구간은 화면에서 해당 이미지 부분을 잘라 보여준다.
 */

import type { EvidenceCrop } from './evidence'

export const RULES_VERSION = '2026-10-28.3'

export type Confidence = 'high' | 'medium' | 'low'

export type VerdictDifference = {
  area: 'thumbnail' | 'detail'
  what: string
  cj: string
  gs: string
  /** 이 차이에 대한 확신도. 2026-10-28.3 이전 판정에는 없다(없으면 high 로 본다). */
  confidence?: Confidence
  /** AI 가 차이를 본 상세 구간 번호(1-based). 썸네일 차이는 빈 배열. */
  cjSegments?: number[]
  gsSegments?: number[]
  /** 배치가 구간 번호를 원본 이미지 위치로 바꿔 붙인 근거 (evidence.ts). */
  cjEvidence?: EvidenceCrop[]
  gsEvidence?: EvidenceCrop[]
}

export type Verdict = {
  thumbnail: 'same' | 'diff' | 'unsure'
  detail: 'same' | 'diff' | 'unsure'
  differences: VerdictDifference[]
  summary: string
}

/** --json-schema 로 넘겨 출력 형식을 강제한다. */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thumbnail', 'detail', 'differences', 'summary'],
  properties: {
    thumbnail: { type: 'string', enum: ['same', 'diff', 'unsure'] },
    detail: { type: 'string', enum: ['same', 'diff', 'unsure'] },
    differences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'what', 'cj', 'gs', 'confidence', 'cjSegments', 'gsSegments'],
        properties: {
          area: { type: 'string', enum: ['thumbnail', 'detail'] },
          what: { type: 'string' },
          cj: { type: 'string' },
          gs: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          cjSegments: { type: 'array', items: { type: 'integer' } },
          gsSegments: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    summary: { type: 'string' },
  },
} as const

export const JUDGE_SYSTEM_PROMPT = `너는 온라인 쇼핑몰 상품 콘텐츠 대조 검수자다.
원본 쇼핑몰(CJ더마켓)의 상품과 판매 채널(GS샵)의 같은 상품을 비교해, GS샵 콘텐츠가 원본과 "내용상" 다른지 판정한다.

## 입력
- [CJ 썸네일], [GS 썸네일]: 대표 이미지 1장씩.
- [CJ 상세 n/N], [GS 상세 n/N]: 상세페이지 이미지를 위에서부터 이어 붙인 뒤 세로로 자른 구간. 같은 쪽 구간은 순서대로 이어진다.
- GS 상세의 판매사 공통 공지(인증 판매처·리셀러 공지·고객센터·배송/교환/AS 안내)는 이미 제거되어 있다.
- CJ 상세 설명 문구가 텍스트로 함께 주어질 수 있다.

## 핵심 원칙
판매 단위가 다른 것은 같은 상품이다. 상품의 외관(패키지)이나 상품 자체가 달라졌을 때만 다르다.

## 차이로 보지 않는다 (무시)
- **판매 단위 차이**: 입수·세트 수량(x2, x3, 3+3, 24+24, 36입 등), 박스 포장 사진 vs 낱개 사진, 묶음 구성. 낱개 패키지 디자인이 같으면 같은 상품이다.
- 구도·연출 배경·촬영 각도·배치, 해상도·압축·색감 차이
- GS 전용 배지·스티커(예: "CJ제일제당 공식"), 프로모션 문구, 가격·쿠폰·배송 안내
- 브랜드 리뉴얼 안내 배너("기존 상품과 리뉴얼 상품이 혼용 출고될 수 있음" 류)
- 상세페이지의 순서 차이나 원본에 없는 보조 이미지가 추가된 것 자체(내용이 원본과 모순되지 않으면)

## 차이로 본다 (diff)
- **상품 외관·패키지 변경**: 리뉴얼 전/후 디자인(로고 크기·위치, 문구 배치, 색상·사진 변경), 에디션·콜라보 패키지(예: 캐릭터 에디션 vs 일반). 내용물이 같아도 패키지가 다르면 diff.
- **상품 자체 차이**: 개당 용량·중량, 맛, 내용물이 다름(예: 210g vs 300g, 버터커리맛 vs 숯불치킨맛)
- 표기 차이: 중량, kcal, 인분, 성분·함량, 원산지, 인증·수상 표기(예: No.1 배지 유무)
- 상세페이지 본문의 핵심 내용 차이: 원본의 소구 포인트·문구·조리법·제품 사진이 다르거나, 구 버전 상세(구 패키지 사진 포함)를 쓰는 경우

## 판정
- thumbnail / detail 각각 same | diff | unsure.
- 글자가 작아 읽을 수 없거나 비교할 부분이 보이지 않으면 추측하지 말고 unsure.
- differences 에는 diff·unsure 근거를 항목별로 적는다(what=무엇이, cj=원본 상태, gs=GS 상태). same 이면 빈 배열.
- 각 항목의 confidence: 이미지에서 차이가 분명히 보이면 high, 그럴듯하지만 글자가 작거나 각도 때문에 애매하면 medium, 추정에 가까우면 low.
- 각 항목의 cjSegments / gsSegments: 상세(area=detail) 차이를 확인한 구간 번호. [CJ 상세 3/8] 이면 3. 해당 쪽에 그 내용이 아예 없으면 가장 가까운 대응 구간을 적는다. 썸네일 차이는 빈 배열.
- summary 는 한국어 한 줄(60자 이내). 다르면 핵심 차이, 같으면 "일치".
- 반드시 지정된 JSON 형식으로만 답한다.`

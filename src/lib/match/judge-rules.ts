/**
 * 이미지 대조 AI 판정 규칙 — **판정 기준의 원본은 이 파일 한 곳**.
 *
 * 규칙을 바꾸면 RULES_VERSION 을 올린다. match_check.rules_version 에 기록되므로
 * 바뀐 규칙으로 전체 재판정할 대상을 가려낼 수 있다.
 * 사용자 확정(2026-10-28): 판매 단위(입수·세트·박스/낱개) 차이는 무시, 상품 외관·패키지 변경은 차이.
 *   패키지 리뉴얼(207969)·에디션 패키지(213404)도 차이. 36입 박스 vs 24+24(214302)는 같은 상품.
 * 2026-10-28.3: 차이마다 확신도·근거 구간 번호를 받는다 — 확신 높은 차이가 없으면 판정 보류(사람 확인),
 *   근거 구간은 화면에서 해당 이미지 부분을 잘라 보여준다.
 * 2026-11-23.1: 원본(CJ)에만 있는 이벤트·프로모션 배너가 GS 에 없는 것도 무시(사용자 확정) — 214302 안심사이클 이벤트.
 *   정렬 선별(조각)에서는 이런 배너만 조각으로 남아 diff 로 잡히고, 전 구간에서는 묻혀 same 이 되는 흔들림이 있었다.
 */

import type { EvidenceCrop } from './evidence'

export const RULES_VERSION = '2026-11-23.1'

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
  /**
   * 근거 재검증 결과(2026-11-19, MATCH_VERIFY=on) — 근거 부분만 원본 해상도로 잘라 한 번 더 확인한 것.
   * 1차 판정과 엇갈리면(rejected) 확신도를 낮춰 판정 보류로 보낸다(gate.applyVerification). 없으면 재검증 전.
   */
  verify?: VerifyResult
  verifyNote?: string
}

export type VerifyResult = 'confirmed' | 'rejected' | 'unsure'

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
- 원본(CJ)에만 있는 이벤트·프로모션 안내가 GS 에 없는 것(예: 안심사이클/UPCYCLE 용기 수거 이벤트, 포인트 적립·사은품·기획전 배너). 상품 정보가 아니라 판매처 행사다
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

// ── 근거 재검증 ─────────────────────────────────────────

/** 재검증 출력 형식. index = 요청의 [차이 n] 번호(1-based). */
export const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'result', 'note'],
        properties: {
          index: { type: 'integer' },
          result: { type: 'string', enum: ['confirmed', 'rejected', 'unsure'] },
          note: { type: 'string' },
        },
      },
    },
  },
} as const

/** 판정 규칙 본문(핵심 원칙 ~ 차이로 본다) — 재검증도 **같은 규칙 문장**을 쓴다(규칙 원본은 JUDGE_SYSTEM_PROMPT 하나). */
const RULES_BODY = (() => {
  const from = JUDGE_SYSTEM_PROMPT.indexOf('## 핵심 원칙')
  const to = JUDGE_SYSTEM_PROMPT.indexOf('## 판정')
  if (from < 0 || to < from) throw new Error('JUDGE_SYSTEM_PROMPT 에서 규칙 본문 구간을 찾지 못했습니다.')
  return JUDGE_SYSTEM_PROMPT.slice(from, to).trim()
})()

export const VERIFY_SYSTEM_PROMPT = `너는 온라인 쇼핑몰 상품 콘텐츠 대조 결과를 다시 확인하는 검수자다.
1차 검수자가 원본 쇼핑몰(CJ더마켓)과 판매 채널(GS샵)의 같은 상품에서 찾았다고 보고한 "차이"를, 해당 부분만 크게 잘라 낸 이미지로 하나씩 다시 확인한다.

${RULES_BODY}

## 확인 방법
- 각 [차이 n] 뒤에 1차 검수자의 설명과 CJ·GS 근거 이미지가 온다. 근거 이미지는 그 차이가 있다고 한 부분을 원본에서 잘라 낸 것이다.
- confirmed: 근거 이미지에서 그 차이가 실제로 보이고, 위 규칙상 차이로 보는 것에 해당한다.
- rejected: 근거 이미지에서 양쪽이 같아 그런 차이가 보이지 않거나, 보이더라도 위 규칙상 무시하는 것이다.
- unsure: 근거 이미지가 그 부분을 담지 못했거나 글자가 읽히지 않아 판단할 수 없다. 추측하지 않는다.
- "한쪽에 없다"는 차이는 근거가 일부만 잘린 것일 수 있다. 주어진 이미지만으로 확인되지 않으면 unsure.
- note 는 한국어 한 줄(40자 이내)로 판단 이유.
- 모든 [차이 n] 에 대해 하나씩 답한다. 반드시 지정된 JSON 형식으로만 답한다.`

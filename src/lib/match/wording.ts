/**
 * 화면 표시용 문구 — 수집·판정 스크립트가 남긴 오류 원문을 운영자가 읽을 말로 바꾼다 (순수 함수).
 *
 * 원문에는 HTTP 상태·내부 필드 이름·실행 도구 이름이 섞여 있어 화면에 그대로 내보내지 않는다.
 * 원문 자체는 DB(match_check.fetch_error, match_run.error, match_status_log.note)에 그대로 남는다 — 화면에는 내보내지 않으므로
 * 원인을 찾을 때는 DB 나 실행 로그에서 본다(사용자 요청 2026-11-27).
 */

import { JUDGE_FAIL_NOTE } from './gate'

const RETRY = '다음 자동 확인 때 다시 시도합니다.'

/** 쌍 1건의 수집 실패 원문(scripts/match/run.ts collect) → 안내 문구. */
export function friendlyFetchError(raw: string): string {
  const side = /^\s*CJ/.test(raw) ? 'CJ' : /^\s*GS/.test(raw) ? 'GS' : null
  if (/썸네일/.test(raw)) return `${side ?? '쇼핑몰'} 상품 페이지에서 대표 이미지를 찾지 못했습니다. 판매가 끝났거나 페이지가 바뀌었을 수 있습니다.`
  if (/기술서|상세 이미지 0장|__NUXT_DATA__/.test(raw)) {
    return `${side ?? '쇼핑몰'} 상품 페이지에서 상세 이미지를 찾지 못했습니다. 판매가 끝났거나 페이지가 바뀌었을 수 있습니다.`
  }
  if (/HTTP 404/.test(raw)) return '상품 페이지를 찾을 수 없습니다. 판매가 끝났거나 주소가 바뀌었을 수 있습니다.'
  if (/HTTP \d{3}|중계|fetch failed|timeout|timed out|abort|ECONN|ENOTFOUND|network/i.test(raw)) {
    return `쇼핑몰 페이지를 불러오지 못했습니다. ${RETRY}`
  }
  return `이미지를 가져오지 못했습니다. ${RETRY}`
}

/** 실행 1회의 오류 원문(match_run.error) → 안내 문구. */
export function friendlyRunError(raw: string): string {
  const judge = /^판정 실패 (\d+)건/.exec(raw)
  if (judge) {
    return /중단/.test(raw)
      ? `${judge[1]}건을 판정하지 못하고 중간에 멈췄습니다. 남은 건은 다음 실행에서 판정하며, 반복되면 관리자에게 문의해 주세요.`
      : `${judge[1]}건을 판정하지 못했습니다. 다음 실행에서 다시 시도합니다.`
  }
  const fetch = /^수집 실패 (\d+)\/(\d+)/.exec(raw)
  if (fetch) {
    return `대상 ${fetch[2]}건 중 ${fetch[1]}건의 이미지를 가져오지 못했습니다. 쇼핑몰 접속이 막혔거나 페이지 구조가 바뀌었을 수 있습니다.`
  }
  return '실행 중 문제가 생겨 끝까지 마치지 못했습니다. 반복되면 관리자에게 문의해 주세요.'
}

/**
 * 상태 이력 메모 → 화면 문구.
 * 자동 확인이 남긴 오류 메모(수집 실패·판정 실패)만 바꾸고, 판정 요약·확인자 메모는 그대로 둔다.
 */
export function friendlyLogNote(note: string, actor: string, to: string): string {
  if (actor !== 'batch') return note
  if (note.startsWith(JUDGE_FAIL_NOTE)) return '판정하지 못했습니다. 다음 실행에서 다시 시도합니다.'
  if (to === 'error') return friendlyFetchError(note)
  return note
}

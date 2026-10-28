/**
 * GS샵 페이지 중계 (이미지 대조 배치 전용).
 *
 * GS샵은 해외 IP(GitHub Actions)에 상품 페이지 대신 오류 페이지를 돌려준다(2026-10-28 확인).
 * 배치는 GS 페이지 HTML 만 이 엔드포인트를 거쳐 서울 리전에서 받아 간다.
 * 리전은 vercel.json `regions: ["icn1"]` (프로젝트 함수 리전)로 지정한다.
 * edge + preferredRegion 'icn1' 은 실제로 sin1(싱가포르)에서 실행돼 쓰지 않는다(2026-10-28 x-vercel-id 로 확인).
 *
 * 보호: x-match-proxy-key 헤더 = MATCH_PROXY_KEY (Vercel 환경변수 / GitHub Secret 동일 값).
 *       허용 URL 은 GS 상품 페이지·상세 iframe 두 가지뿐 — 임의 URL 중계(오픈 프록시) 방지.
 */

const ALLOWED = /^https:\/\/www\.gsshop\.com\/(prd\/prd\.gs|mi15\/prd\/prdImgDesc\.gs)\?/
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** 실행 리전 — 중계가 실제로 서울(icn1)에서 도는지 진단용. 모든 응답에 붙인다. */
const regionHeader = () => ({ 'x-proxy-region': process.env.VERCEL_REGION ?? 'unknown' })

export async function GET(request: Request) {
  const key = process.env.MATCH_PROXY_KEY
  if (!key || request.headers.get('x-match-proxy-key') !== key) {
    return new Response('forbidden', { status: 403, headers: regionHeader() })
  }
  const target = new URL(request.url).searchParams.get('url') ?? ''
  if (!ALLOWED.test(target)) {
    return new Response('url not allowed', { status: 400, headers: regionHeader() })
  }

  const referer = new URL(request.url).searchParams.get('referer')
  const res = await fetch(target, {
    headers: {
      'User-Agent': UA,
      ...(referer && ALLOWED.test(referer) ? { Referer: referer } : {}),
    },
    cache: 'no-store',
  })
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...regionHeader(),
    },
  })
}

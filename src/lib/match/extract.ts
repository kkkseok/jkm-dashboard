/**
 * 상품 페이지 HTML → 썸네일·상세 이미지 URL 추출 (순수 함수, 배치 수집기 전용).
 *
 * 구조는 2026-10 PoC(18쌍)로 확인했다. 사이트 구조가 바뀌면 여기서 빈 값/에러가 나고,
 * 수집기는 그 쌍을 '수집 실패'로 표시한다 — 조용히 빈 비교로 넘어가지 않게.
 *
 *   CJ더마켓  썸네일: og:image
 *             상세:   __NUXT_DATA__ 문서 중 docDispPtnCd="05", useYn="Y", dispOdr 순 (contDesc = 설명 문구)
 *   GS샵      썸네일: og:image 끝 사이즈(/280)를 /1000 으로 교체
 *             상세:   iframe#prdDetailIfr src 를 별도 요청 → 그 HTML 의 <img src> 순서
 */

export type DetailImageRef = {
  url: string
  /** CJ 상세 이미지 설명 문구(contDesc). GS 는 없음. */
  desc?: string
}

const CJ_IMAGE_BASE = 'https://img.cjthemarket.com/images/file'
const GS_ORIGIN = 'https://www.gsshop.com'
/** 비교 대상 이미지 확장자 — CJ 상세에 섞인 mp4 등 동영상은 제외한다. */
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)(\?|$)/i
/** GS 썸네일 요청 사이즈. og:image 는 280px 이라 작은 글자 판독이 어렵다. */
export const GS_THUMB_SIZE = 1000

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/**
 * 수집 실패 진단용 페이지 요약 — 크기·<title>.
 * 차단·점검 페이지는 200 으로 와도 og:image 가 없어서, 실패 메시지에 무엇이 왔는지 남긴다.
 */
export function describePage(html: string): string {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 80) ?? '(title 없음)'
  return `${Math.round(html.length / 1024)}KB · title "${decodeEntities(title)}"`
}

export function extractOgImage(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
  return m ? decodeEntities(m[1]) : null
}

/** CJ 썸네일 — og:image 의 리사이즈 쿼리(?SF=webp&RS=550)를 떼고 원본을 쓴다. */
export function extractCjThumb(html: string): string | null {
  const og = extractOgImage(html)
  return og ? og.split('?')[0] : null
}

/**
 * Nuxt 3 payload(__NUXT_DATA__) 디코드.
 * 평탄화된 배열에서 객체/배열 값은 다른 원소의 인덱스를 가리킨다.
 * ["Reactive", i] 같은 래퍼는 i 를 그대로 푼다.
 */
function decodeNuxtPayload(arr: unknown[]): (i: number) => unknown {
  const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef'])
  const resolve = (i: unknown, depth = 0): unknown => {
    if (typeof i !== 'number' || depth > 50) return i
    const v = arr[i]
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAPPERS.has(v[0])) return resolve(v[1], depth + 1)
      return v.map((x) => resolve(x, depth + 1))
    }
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = resolve(x, depth + 1)
    return o
  }
  return (i) => resolve(i)
}

/** CJ 상세 이미지 목록. __NUXT_DATA__ 가 없으면 에러(구조 변경 신호). */
export function extractCjDetail(html: string): DetailImageRef[] {
  const m = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('CJ __NUXT_DATA__ 없음')
  const arr = JSON.parse(m[1]) as unknown[]
  const resolve = decodeNuxtPayload(arr)

  type Doc = { contUrl?: unknown; contDesc?: unknown; dispOdr?: unknown; docDispPtnCd?: unknown; useYn?: unknown }
  const docs: Doc[] = []
  arr.forEach((v, i) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'contUrl' in v) docs.push(resolve(i) as Doc)
  })

  const seen = new Set<string>()
  return docs
    .filter((d) => d.docDispPtnCd === '05' && d.useYn === 'Y' && typeof d.contUrl === 'string')
    .sort((a, b) => Number(a.dispOdr) - Number(b.dispOdr))
    .map((d) => ({
      url: CJ_IMAGE_BASE + String(d.contUrl),
      desc: typeof d.contDesc === 'string' ? d.contDesc : undefined,
    }))
    .filter((d) => IMAGE_EXT_RE.test(d.url))
    .filter((d) => (seen.has(d.url) ? false : (seen.add(d.url), true)))
}

/** GS 썸네일 — og:image 의 끝 사이즈를 GS_THUMB_SIZE 로 교체. */
export function extractGsThumb(html: string): string | null {
  const og = extractOgImage(html)
  if (!og) return null
  return /\/\d+$/.test(og) ? og.replace(/\/\d+$/, `/${GS_THUMB_SIZE}`) : og
}

/** GS 상세 iframe 절대 URL. */
export function extractGsDescUrl(html: string): string | null {
  const m =
    html.match(/<iframe[^>]+id=["']prdDetailIfr["'][^>]*src=["']([^"']+)["']/i) ??
    html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*id=["']prdDetailIfr["']/i)
  return m ? new URL(decodeEntities(m[1]), GS_ORIGIN).href : null
}

/** GS 상세 iframe HTML → 이미지 목록 (주석 안의 img 는 제외). */
export function extractGsDetail(descHtml: string): DetailImageRef[] {
  const body = descHtml.replace(/<!--[\s\S]*?-->/g, '')
  const seen = new Set<string>()
  const out: DetailImageRef[] = []
  for (const m of body.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const url = decodeEntities(m[1])
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ url })
  }
  return out
}

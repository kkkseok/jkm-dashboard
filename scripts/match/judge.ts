/**
 * AI 판정 — Claude Code 헤드리스(`claude -p`)를 구독 인증(OAuth)으로 실행한다. API 키·API 과금 없음.
 *
 * 호출당 고정 오버헤드를 줄이려고(실측 4.5만 → 약 750 토큰):
 *   - 저장소 밖 빈 작업 폴더에서 실행 (CLAUDE.md·스킬 미로딩)
 *   - --tools "" / --setting-sources "" / --strict-mcp-config / --disable-slash-commands
 *   - --system-prompt 로 판정 규칙만 지정
 * 정렬 선별(src/lib/match/align.ts): MATCH_ALIGN=on 이면 상세에서 양쪽에 픽셀 수준으로 같은 부분을 먼저 걸러내고
 *   안 맞는 부분만 "조각"으로 잘라 CJ(왼쪽)·GS(오른쪽) 같은 자리를 나란히 붙여 보낸다. **기본은 꺼짐(전 구간 전송)** — 판정 정확도를 AI 로 검증하기 전이다(2026-11-19).
 *   효과 미리 보기: scripts/match/align-report.ts
 * 근거 재검증: MATCH_VERIFY=on 이면 1차 판정이 '다름'으로 본 차이의 근거 부분만 원본 해상도로 잘라 한 번 더 묻는다.
 *   1차와 엇갈리면 확신도를 낮춰 판정 보류로 보낸다(gate.applyVerification). 차이가 없는 쌍은 추가 호출 없음.
 * 이미지는 도구(Read) 호출 없이 stream-json 입력의 image 블록으로 한 번에 넣는다(턴 1회).
 * 출력은 --json-schema 로 형식을 강제한다.
 *
 * 환경변수: CLAUDE_BIN (기본: Windows 는 npm 전역 설치 경로의 claude.exe, 그 외 'claude')
 *           GitHub Actions 에서는 CLAUDE_CODE_OAUTH_TOKEN 으로 인증한다.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { planPieces, splitPieces, type Gray, type Piece, type PxRange } from '../../src/lib/match/align'
import { rangesToCrops, segmentsToCrops, type EvidenceCrop, type StripPart } from '../../src/lib/match/evidence'
import { applyVerification, verifyTargets } from '../../src/lib/match/gate'
import {
  JUDGE_SYSTEM_PROMPT,
  VERDICT_SCHEMA,
  VERIFY_SCHEMA,
  VERIFY_SYSTEM_PROMPT,
  type Verdict,
  type VerifyResult,
} from '../../src/lib/match/judge-rules'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/**
 * 이미지 규격. Claude 는 긴 변 1568px·약 1.15MP 를 넘으면 축소하므로 그 안에 맞춘다.
 * 상세는 폭 700 으로 이어 붙여 1400px 구간으로 자른다(본문 글자가 읽히는 크기 — PoC 확인).
 */
const THUMB_MAX = 1000
const DETAIL_WIDTH = 700
const DETAIL_SEGMENT = 1400
/**
 * 정렬 선별 조각: 한 장 높이 상한(px) · 좌우 사이 띠(px).
 * 좌우로 붙이면 폭이 2배라, 높이 800 이어야 Claude 가 축소하지 않는 크기(약 1.15MP) 안에 든다.
 */
const PIECE_HEIGHT = 800
const PIECE_GAP = 16
/**
 * 양쪽 대응률이 모두 이보다 낮으면 자리 맞춤이 의미 없다 → 선별하지 않고 전 구간을 보낸다.
 * 2026-11-19 실측: 대응률 18~24% 인 쌍(221042·207969)도 조각으로 나란히 보냈을 때 판정이 맞았고,
 * 221042 는 전 구간 방식이 놓치던 차이를 잡았다. 8% 인 쌍(206681)은 전 구간으로만 확인했다.
 * 조정용 환경변수 MATCH_ALIGN_MIN_RATE.
 */
const MIN_MATCH_RATE = Number(process.env.MATCH_ALIGN_MIN_RATE ?? 0.15)
/** 요청당 이미지 상한 — 넘으면 판정하지 않고 보류로 돌린다(JudgeSkipError). */
const MAX_IMAGES = 90
const TIMEOUT_MS = 10 * 60_000

/**
 * 입력 자체가 판정 불가(다시 시도해도 같음) — AI 를 부르기 전에 던진다.
 * 호출 측은 판정 상한을 쓰지 않고 '판정 보류'로 기록한다.
 */
export class JudgeSkipError extends Error {}

export type JudgeInput = {
  cjThumbUrl: string
  gsThumbUrl: string
  gsPageUrl: string
  cjDetail: { url: string; desc?: string; hash: string | null }[]
  /** 공통 이미지(common)는 호출 측에서 이미 뺀 목록. */
  gsDetail: { url: string; hash: string | null }[]
}

export type JudgeUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  /** 구독 실행이라 청구액 아님 — API 정가 환산(효율 지표). */
  apiEquivUsd: number
  judgeMs: number
}

/** 정렬 선별 결과 — 조각 수, 상세 띠 중 AI 에 보낸 높이 / 전체(px), 각 쪽이 반대쪽에서 발견된 비율(0~1). */
export type AlignStats = {
  pieces: number
  cjSentPx: number
  cjTotalPx: number
  gsSentPx: number
  gsTotalPx: number
  cjMatchRate: number
  gsMatchRate: number
}

/** 근거 재검증 집계. failed = 재검증 호출 실패(1차 판정을 그대로 씀). */
export type VerifyStats = { confirmed: number; rejected: number; unsure: number; failed?: string }

export type JudgeResult = {
  verdict: Verdict
  usage: JudgeUsage
  images: number
  align: AlignStats | null
  /** null = 재검증 안 함(꺼짐 또는 차이 없음). */
  verify: VerifyStats | null
}

type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }
type TextBlock = { type: 'text'; text: string }

function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
  }
  return 'claude'
}

async function download(url: string, referer?: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`이미지 HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const toBlock = (buf: Buffer): ImageBlock => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
})

/** 썸네일 블록 + 원본 비율(높이/폭) — 썸네일 차이 근거를 화면에 그릴 때 쓴다. */
async function thumbBlock(url: string, referer?: string): Promise<{ block: ImageBlock; aspect: number }> {
  const img = sharp(await download(url, referer))
  const meta = await img.metadata()
  const buf = await img
    .flatten({ background: '#fff' })
    .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return { block: toBlock(buf), aspect: meta.width && meta.height ? meta.height / meta.width : 1 }
}

/**
 * 상세 이미지들을 폭 DETAIL_WIDTH 로 세로로 이어 붙이고 DETAIL_SEGMENT 높이로 자른다. 깨진 이미지는 건너뛴다.
 * parts = 각 원본 이미지가 띠의 어디에 놓였는지 — AI 가 지목한 구간 번호를 원본 위치로 되돌리는 데 쓴다.
 */
export async function detailBlocks(
  urls: string[],
  referer?: string,
): Promise<{ blocks: ImageBlock[]; parts: StripPart[]; gray: Gray; strip: Buffer | null }> {
  const loaded: { url: string; data: Buffer; h: number }[] = []
  for (const url of urls) {
    try {
      const { data, info } = await sharp(await download(url, referer))
        .flatten({ background: '#fff' })
        .resize({ width: DETAIL_WIDTH })
        .png()
        .toBuffer({ resolveWithObject: true })
      loaded.push({ url, data, h: info.height })
    } catch {
      // 다운로드·디코드 실패한 이미지는 비교에서 빠진다(해시에는 missing 으로 이미 반영됨).
    }
  }
  let y = 0
  const parts: StripPart[] = loaded.map((p) => ({ url: p.url, top: (y += p.h) - p.h, height: p.h }))
  const total = y
  if (total === 0) return { blocks: [], parts, gray: { data: new Uint8Array(0), width: DETAIL_WIDTH, rows: 0 }, strip: null }
  const strip = await sharp({ create: { width: DETAIL_WIDTH, height: total, channels: 3, background: '#fff' } })
    .composite(loaded.map((p, i) => ({ input: p.data, left: 0, top: parts[i].top })))
    .png()
    .toBuffer()
  const blocks: ImageBlock[] = []
  for (let top = 0; top < total; top += DETAIL_SEGMENT) {
    const height = Math.min(DETAIL_SEGMENT, total - top)
    blocks.push(
      toBlock(
        await sharp(strip).extract({ left: 0, top, width: DETAIL_WIDTH, height }).jpeg({ quality: 80 }).toBuffer(),
      ),
    )
  }
  // 정렬 선별용 흑백 띠(원본 해상도 그대로).
  const data = await sharp(strip).greyscale().raw().toBuffer()
  if (data.length !== DETAIL_WIDTH * total) throw new Error(`흑백 띠 크기 불일치: ${data.length} ≠ ${DETAIL_WIDTH}×${total}`)
  return { blocks, parts, gray: { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: DETAIL_WIDTH, rows: total }, strip }
}

type Layout = {
  cjThumbAspect: number
  gsThumbAspect: number
  cjParts: StripPart[]
  gsParts: StripPart[]
  /** 정렬 선별로 보낸 조각(번호 순). null 이면 선별 없이 구간 번호로 보냈다. */
  pieces: Piece[] | null
}

/** 조각 1개 → 이미지. 양쪽 다 있으면 CJ(왼쪽)·GS(오른쪽)를 나란히, 한쪽만 있으면 그쪽만. 짧은 쪽 아래는 회색으로 남는다. */
async function pieceBlock(p: Piece, cjStrip: Buffer | null, gsStrip: Buffer | null): Promise<ImageBlock> {
  const crop = (strip: Buffer | null, r: PxRange) => {
    if (!strip) throw new Error('조각을 자를 띠가 없음')
    return sharp(strip).extract({ left: 0, top: r.top, width: DETAIL_WIDTH, height: r.bottom - r.top })
  }
  if (!p.cj || !p.gs) {
    const only = p.cj ? crop(cjStrip, p.cj) : crop(gsStrip, p.gs!)
    return toBlock(await only.jpeg({ quality: 80 }).toBuffer())
  }
  const [left, right] = await Promise.all([crop(cjStrip, p.cj).png().toBuffer(), crop(gsStrip, p.gs).png().toBuffer()])
  const height = Math.max(p.cj.bottom - p.cj.top, p.gs.bottom - p.gs.top)
  const buf = await sharp({ create: { width: DETAIL_WIDTH * 2 + PIECE_GAP, height, channels: 3, background: '#777' } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: DETAIL_WIDTH + PIECE_GAP, top: 0 },
    ])
    .jpeg({ quality: 80 })
    .toBuffer()
  return toBlock(buf)
}

/** 판정 요청 본문 조립(다운로드·정렬 선별 포함, AI 호출 없음). align = null 이면 선별 없이 전 구간. */
export async function buildContent(
  input: JudgeInput,
): Promise<{ content: (ImageBlock | TextBlock)[]; images: number; layout: Layout; align: AlignStats | null }> {
  const [cjT, gsT, cjD, gsD] = await Promise.all([
    thumbBlock(input.cjThumbUrl),
    thumbBlock(input.gsThumbUrl, input.gsPageUrl),
    detailBlocks(input.cjDetail.map((d) => d.url)),
    detailBlocks(input.gsDetail.map((d) => d.url), input.gsPageUrl),
  ])
  const [cjThumb, gsThumb, cjDetail, gsDetail] = [cjT.block, gsT.block, cjD.blocks, gsD.blocks]
  // 정렬 선별(MATCH_ALIGN=on): 양쪽 다 상세가 있고, 서로 어느 정도 겹칠 때만.
  let pieces: Piece[] | null = null
  let align: AlignStats | null = null
  if (process.env.MATCH_ALIGN === 'on' && cjDetail.length > 0 && gsDetail.length > 0) {
    const plan = planPieces(cjD.gray, gsD.gray)
    if (Math.max(plan.cjMatchRate, plan.gsMatchRate) >= MIN_MATCH_RATE) {
      const split = splitPieces(plan.pieces, PIECE_HEIGHT)
      const sent = (side: 'cj' | 'gs') =>
        split.reduce((sum, p) => {
          const r = p[side]
          return sum + (r ? r.bottom - r.top : 0)
        }, 0)
      pieces = split
      align = {
        pieces: split.length,
        cjSentPx: sent('cj'),
        cjTotalPx: cjD.gray.rows,
        gsSentPx: sent('gs'),
        gsTotalPx: gsD.gray.rows,
        cjMatchRate: plan.cjMatchRate,
        gsMatchRate: plan.gsMatchRate,
      }
    }
  }
  const layout: Layout = {
    cjThumbAspect: cjT.aspect,
    gsThumbAspect: gsT.aspect,
    cjParts: cjD.parts,
    gsParts: gsD.parts,
    pieces,
  }

  const images = 2 + (pieces ? pieces.length : cjDetail.length + gsDetail.length)
  if (images > MAX_IMAGES) throw new JudgeSkipError(`이미지 ${images}장 — AI 판정 상한 ${MAX_IMAGES}장 초과, 직접 확인 필요`)

  const content: (ImageBlock | TextBlock)[] = [
    { type: 'text', text: '[CJ 썸네일]' },
    cjThumb,
    { type: 'text', text: '[GS 썸네일]' },
    gsThumb,
  ]
  let detailNote = ''
  if (pieces) {
    const sentPieces = pieces
    const blocks = await Promise.all(sentPieces.map((p) => pieceBlock(p, cjD.strip, gsD.strip)))
    sentPieces.forEach((p, i) => {
      const what = p.cj && p.gs ? '왼쪽 = CJ(원본), 오른쪽 = GS — 같은 자리' : p.cj ? 'CJ(원본)에만 있는 부분' : 'GS 에만 있는 부분'
      content.push({ type: 'text', text: `[상세 조각 ${i + 1}/${sentPieces.length}] ${what}` }, blocks[i])
    })
    detailNote =
      sentPieces.length === 0
        ? '상세는 양쪽 내용이 픽셀 수준으로 같다는 것을 미리 확인해 생략했다. detail 은 same 으로 답하라.'
        : [
            '상세는 [CJ 상세 n/N]·[GS 상세 n/N] 구간 대신 "조각"으로 준다. 양쪽에 픽셀 수준으로 똑같이 들어 있는 부분은 미리 걸러 생략했고, 서로 맞지 않는 부분만 잘라 낸 것이 조각이다.',
            '- 조각에 없는 부분은 양쪽이 같으니 차이로 적지 않는다.',
            '- 좌우가 함께 있는 조각은 같은 자리의 CJ(왼쪽)와 GS(오른쪽)다. 픽셀이 다르다는 것만 확인된 것이라(압축·크기 조정·재편집 차이일 수 있다) 내용이 실제로 다른지는 규칙대로 직접 비교해 판단하라. 한쪽 아래의 회색은 그쪽이 더 짧다는 뜻이다.',
            '- 한쪽만 있는 조각은 그 내용이 반대쪽 같은 자리에 같은 모습으로는 없다는 뜻이다. 다른 조각에 같은 내용이 있을 수 있으니 조각 전체를 보고 판단하라.',
            '- 상세 차이의 cjSegments·gsSegments 에는 구간 번호 대신 그 차이를 확인한 조각 번호를 양쪽 모두에 적어라.',
          ].join('\n')
  } else {
    cjDetail.forEach((b, i) => content.push({ type: 'text', text: `[CJ 상세 ${i + 1}/${cjDetail.length}]` }, b))
    gsDetail.forEach((b, i) => content.push({ type: 'text', text: `[GS 상세 ${i + 1}/${gsDetail.length}]` }, b))
  }
  const descs = input.cjDetail.map((d) => d.desc).filter(Boolean)
  content.push({
    type: 'text',
    text: [
      cjDetail.length === 0 ? 'CJ 상세 이미지는 없다.' : '',
      gsDetail.length === 0 ? 'GS 상세 이미지는 없다(공통 공지 제외 후).' : '',
      detailNote,
      descs.length ? `CJ 상세 설명 문구:\n${descs.map((d) => `- ${d}`).join('\n')}` : '',
      '위 CJ(원본)와 GS 를 규칙대로 비교해 JSON 으로 판정하라.',
    ]
      .filter(Boolean)
      .join('\n'),
  })
  return { content, images, layout, align }
}

/** claude -p 실행 → 마지막 result 메시지. */
function runClaude(
  model: string,
  content: (ImageBlock | TextBlock)[],
  systemPrompt: string = JUDGE_SYSTEM_PROMPT,
  schema: object = VERDICT_SCHEMA,
): Promise<Record<string, unknown>> {
  const cwd = path.join(tmpdir(), 'jkm-match-judge')
  mkdirSync(cwd, { recursive: true })
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--system-prompt', systemPrompt,
    '--json-schema', JSON.stringify(schema),
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: TIMEOUT_MS })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      const result = stdout
        .split('\n')
        .map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>
          } catch {
            return null
          }
        })
        .filter((j): j is Record<string, unknown> => j?.type === 'result')
        .pop()
      if (!result) {
        reject(new Error(`claude 결과 없음 (exit ${code}) ${stderr.slice(0, 300)}`))
        return
      }
      resolve(result)
    })
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
  })
}

function parseVerdict(result: Record<string, unknown>): Verdict {
  const structured = result.structured_output
  const v = (structured ?? JSON.parse(String(result.result ?? ''))) as Verdict
  const ok = (x: unknown) => x === 'same' || x === 'diff' || x === 'unsure'
  if (!ok(v?.thumbnail) || !ok(v?.detail) || !Array.isArray(v?.differences)) {
    throw new Error(`판정 형식 오류: ${String(result.result ?? '').slice(0, 200)}`)
  }
  return v
}

/** 조각 번호(1-based, AI 가 cjSegments·gsSegments 어느 쪽에 적었든 합쳐서) → 양쪽 원본 이미지 위치. */
function pieceEvidence(d: Verdict['differences'][number], layout: Layout, pieces: Piece[]) {
  const picked = [...new Set([...(d.cjSegments ?? []), ...(d.gsSegments ?? [])])]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pieces.length)
    .map((n) => pieces[n - 1])
  const ranges = (side: 'cj' | 'gs') => picked.map((p) => p[side]).filter((r): r is PxRange => r !== null)
  return {
    cjEvidence: rangesToCrops(layout.cjParts, ranges('cj'), DETAIL_WIDTH),
    gsEvidence: rangesToCrops(layout.gsParts, ranges('gs'), DETAIL_WIDTH),
  }
}

/**
 * 차이 항목마다 근거 이미지 위치를 붙인다.
 * 썸네일 차이 → 양쪽 썸네일 전체, 상세 차이 → AI 가 지목한 구간을 원본 이미지 조각으로 변환.
 */
function attachEvidence(v: Verdict, input: JudgeInput, layout: Layout): Verdict {
  const full = (url: string, aspect: number) => [{ url, top: 0, bottom: 1, aspect }]
  return {
    ...v,
    differences: v.differences.map((d) =>
      d.area === 'thumbnail'
        ? {
            ...d,
            cjEvidence: full(input.cjThumbUrl, layout.cjThumbAspect),
            gsEvidence: full(input.gsThumbUrl, layout.gsThumbAspect),
          }
        : layout.pieces
          ? { ...d, ...pieceEvidence(d, layout, layout.pieces) }
          : {
              ...d,
              cjEvidence: segmentsToCrops(layout.cjParts, d.cjSegments ?? [], DETAIL_SEGMENT, DETAIL_WIDTH),
              gsEvidence: segmentsToCrops(layout.gsParts, d.gsSegments ?? [], DETAIL_SEGMENT, DETAIL_WIDTH),
            },
    ),
  }
}

/** 재검증 근거 이미지 규격 — Claude 가 축소하지 않는 크기(약 1.15MP) 안. 차이당 한쪽 최대 장수. */
const VERIFY_MAX_W = 1000
const VERIFY_MAX_H = 1150
const VERIFY_CROPS_PER_SIDE = 2

function readUsage(result: Record<string, unknown>) {
  const usage = (result.usage ?? {}) as Record<string, number>
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    apiEquivUsd: Number(result.total_cost_usd ?? 0),
  }
}

/**
 * 근거 재검증 — diff 영역의 차이마다 근거 부분을 **원본 이미지에서**(띠처럼 폭 700 으로 줄이지 않고) 잘라 다시 묻는다.
 * 반환: 재검증을 반영한 판정 + 집계 + 사용량. 대상이 없으면 null.
 */
async function verifyDifferences(verdict: Verdict, gsPageUrl: string, model: string) {
  const targets = verifyTargets(verdict)
  if (targets.length === 0) return null

  const cache = new Map<string, Promise<Buffer>>()
  const get = (url: string, referer?: string) => {
    if (!cache.has(url)) cache.set(url, download(url, referer))
    return cache.get(url)!
  }
  const cropBlock = async (c: EvidenceCrop, referer?: string): Promise<ImageBlock> => {
    const img = sharp(await get(c.url, referer)).flatten({ background: '#fff' })
    const meta = await img.metadata()
    if (!meta.width || !meta.height) throw new Error('근거 이미지 크기를 알 수 없음')
    const top = Math.min(meta.height - 1, Math.max(0, Math.round(c.top * meta.height)))
    const height = Math.max(1, Math.min(meta.height - top, Math.round((c.bottom - c.top) * meta.height)))
    const buf = await img
      .extract({ left: 0, top, width: meta.width, height })
      .resize(VERIFY_MAX_W, VERIFY_MAX_H, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return toBlock(buf)
  }

  const content: (ImageBlock | TextBlock)[] = []
  for (const [n, pos] of targets.entries()) {
    const d = verdict.differences[pos]
    content.push({
      type: 'text',
      text: `[차이 ${n + 1}] (${d.area === 'thumbnail' ? '썸네일' : '상세'}) ${d.what}\n- 1차 검수자가 본 CJ: ${d.cj}\n- 1차 검수자가 본 GS: ${d.gs}`,
    })
    for (const [label, crops, referer] of [
      ['CJ(원본)', d.cjEvidence ?? [], undefined],
      ['GS', d.gsEvidence ?? [], gsPageUrl],
    ] as const) {
      const picked = crops.slice(0, VERIFY_CROPS_PER_SIDE)
      if (picked.length === 0) {
        content.push({ type: 'text', text: `[차이 ${n + 1} · ${label} 근거] 없음 — 1차 검수자가 이 쪽에서는 해당 부분을 지목하지 않았다.` })
        continue
      }
      for (const [k, c] of picked.entries()) {
        content.push({ type: 'text', text: `[차이 ${n + 1} · ${label} 근거 ${k + 1}/${picked.length}]` }, await cropBlock(c, referer))
      }
    }
  }
  content.push({ type: 'text', text: `위 차이 ${targets.length}건을 근거 이미지로 하나씩 다시 확인해 JSON 으로 답하라.` })

  const result = await runClaude(model, content, VERIFY_SYSTEM_PROMPT, VERIFY_SCHEMA)
  if (result.is_error) throw new Error(`claude 오류: ${String(result.result ?? result.subtype).slice(0, 300)}`)
  const parsed = (result.structured_output ?? JSON.parse(String(result.result ?? ''))) as {
    results?: { index: number; result: VerifyResult; note?: string }[]
  }
  const ok = (x: unknown): x is VerifyResult => x === 'confirmed' || x === 'rejected' || x === 'unsure'
  if (!Array.isArray(parsed?.results) || !parsed.results.every((r) => Number.isInteger(r?.index) && ok(r?.result))) {
    throw new Error(`재검증 형식 오류: ${String(result.result ?? '').slice(0, 200)}`)
  }
  const merged = applyVerification(verdict, targets, parsed.results)
  const count = (r: VerifyResult) => targets.filter((pos) => merged.differences[pos].verify === r).length
  return {
    verdict: merged,
    stats: { confirmed: count('confirmed'), rejected: count('rejected'), unsure: count('unsure') } satisfies VerifyStats,
    usage: readUsage(result),
  }
}

/** 쌍 1개 판정. 실패(한도 초과·형식 오류 등)는 예외 — 호출 측이 다음 실행으로 미룬다. */
export async function judgePair(input: JudgeInput, model: string): Promise<JudgeResult> {
  const started = Date.now()
  const { content, images, layout, align } = await buildContent(input)
  const result = await runClaude(model, content)
  if (result.is_error) throw new Error(`claude 오류: ${String(result.result ?? result.subtype).slice(0, 300)}`)

  const modelUsage = (result.modelUsage ?? {}) as Record<string, unknown>
  let verdict = parseVerdict(result)
  // 상세 조각이 하나도 없으면(양쪽이 같음을 코드로 확인) 상세 판정은 AI 답과 무관하게 same.
  if (align && align.pieces === 0) {
    verdict = { ...verdict, detail: 'same', differences: verdict.differences.filter((d) => d.area !== 'detail') }
  }
  verdict = attachEvidence(verdict, input, layout)
  const usage = readUsage(result)

  // 근거 재검증(MATCH_VERIFY=on). 재검증 호출이 실패해도 1차 판정은 버리지 않는다 — 실패는 집계(failed)와 로그에 남긴다.
  let verify: VerifyStats | null = null
  if (process.env.MATCH_VERIFY === 'on') {
    try {
      const v = await verifyDifferences(verdict, input.gsPageUrl, model)
      if (v) {
        verdict = v.verdict
        verify = v.stats
        for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += v.usage[k]
      }
    } catch (e) {
      verify = { confirmed: 0, rejected: 0, unsure: 0, failed: (e instanceof Error ? e.message : String(e)).slice(0, 160) }
    }
  }
  return {
    verdict,
    images,
    align,
    verify,
    usage: { model: Object.keys(modelUsage)[0] ?? model, ...usage, judgeMs: Date.now() - started },
  }
}

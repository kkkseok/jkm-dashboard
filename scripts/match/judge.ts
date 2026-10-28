/**
 * AI 판정 — Claude Code 헤드리스(`claude -p`)를 구독 인증(OAuth)으로 실행한다. API 키·API 과금 없음.
 *
 * 호출당 고정 오버헤드를 줄이려고(실측 4.5만 → 약 750 토큰):
 *   - 저장소 밖 빈 작업 폴더에서 실행 (CLAUDE.md·스킬 미로딩)
 *   - --tools "" / --setting-sources "" / --strict-mcp-config / --disable-slash-commands
 *   - --system-prompt 로 판정 규칙만 지정
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
import {
  JUDGE_SYSTEM_PROMPT,
  VERDICT_SCHEMA,
  type Verdict,
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
/** 요청당 이미지 상한 — 넘으면 판정하지 않고 보류로 돌린다. */
const MAX_IMAGES = 90
const TIMEOUT_MS = 10 * 60_000

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

export type JudgeResult = { verdict: Verdict; usage: JudgeUsage; images: number }

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

async function thumbBlock(url: string, referer?: string): Promise<ImageBlock> {
  const buf = await sharp(await download(url, referer))
    .flatten({ background: '#fff' })
    .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return toBlock(buf)
}

/** 상세 이미지들을 폭 DETAIL_WIDTH 로 세로로 이어 붙이고 DETAIL_SEGMENT 높이로 자른다. 깨진 이미지는 건너뛴다. */
async function detailBlocks(urls: string[], referer?: string): Promise<ImageBlock[]> {
  const parts: { data: Buffer; h: number }[] = []
  for (const url of urls) {
    try {
      const { data, info } = await sharp(await download(url, referer))
        .flatten({ background: '#fff' })
        .resize({ width: DETAIL_WIDTH })
        .png()
        .toBuffer({ resolveWithObject: true })
      parts.push({ data, h: info.height })
    } catch {
      // 다운로드·디코드 실패한 이미지는 비교에서 빠진다(해시에는 missing 으로 이미 반영됨).
    }
  }
  const total = parts.reduce((s, p) => s + p.h, 0)
  if (total === 0) return []
  let y = 0
  const strip = await sharp({ create: { width: DETAIL_WIDTH, height: total, channels: 3, background: '#fff' } })
    .composite(parts.map((p) => ({ input: p.data, left: 0, top: (y += p.h) - p.h })))
    .png()
    .toBuffer()
  const out: ImageBlock[] = []
  for (let top = 0; top < total; top += DETAIL_SEGMENT) {
    const height = Math.min(DETAIL_SEGMENT, total - top)
    out.push(
      toBlock(
        await sharp(strip).extract({ left: 0, top, width: DETAIL_WIDTH, height }).jpeg({ quality: 80 }).toBuffer(),
      ),
    )
  }
  return out
}

async function buildContent(input: JudgeInput): Promise<{ content: (ImageBlock | TextBlock)[]; images: number }> {
  const [cjThumb, gsThumb, cjDetail, gsDetail] = await Promise.all([
    thumbBlock(input.cjThumbUrl),
    thumbBlock(input.gsThumbUrl, input.gsPageUrl),
    detailBlocks(input.cjDetail.map((d) => d.url)),
    detailBlocks(input.gsDetail.map((d) => d.url), input.gsPageUrl),
  ])
  const images = 2 + cjDetail.length + gsDetail.length
  if (images > MAX_IMAGES) throw new Error(`이미지 ${images}장 — 요청 상한 ${MAX_IMAGES} 초과`)

  const content: (ImageBlock | TextBlock)[] = [
    { type: 'text', text: '[CJ 썸네일]' },
    cjThumb,
    { type: 'text', text: '[GS 썸네일]' },
    gsThumb,
  ]
  cjDetail.forEach((b, i) => content.push({ type: 'text', text: `[CJ 상세 ${i + 1}/${cjDetail.length}]` }, b))
  gsDetail.forEach((b, i) => content.push({ type: 'text', text: `[GS 상세 ${i + 1}/${gsDetail.length}]` }, b))
  const descs = input.cjDetail.map((d) => d.desc).filter(Boolean)
  content.push({
    type: 'text',
    text: [
      cjDetail.length === 0 ? 'CJ 상세 이미지는 없다.' : '',
      gsDetail.length === 0 ? 'GS 상세 이미지는 없다(공통 공지 제외 후).' : '',
      descs.length ? `CJ 상세 설명 문구:\n${descs.map((d) => `- ${d}`).join('\n')}` : '',
      '위 CJ(원본)와 GS 를 규칙대로 비교해 JSON 으로 판정하라.',
    ]
      .filter(Boolean)
      .join('\n'),
  })
  return { content, images }
}

/** claude -p 실행 → 마지막 result 메시지. */
function runClaude(model: string, content: (ImageBlock | TextBlock)[]): Promise<Record<string, unknown>> {
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
    '--system-prompt', JUDGE_SYSTEM_PROMPT,
    '--json-schema', JSON.stringify(VERDICT_SCHEMA),
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

/** 쌍 1개 판정. 실패(한도 초과·형식 오류 등)는 예외 — 호출 측이 다음 실행으로 미룬다. */
export async function judgePair(input: JudgeInput, model: string): Promise<JudgeResult> {
  const started = Date.now()
  const { content, images } = await buildContent(input)
  const result = await runClaude(model, content)
  if (result.is_error) throw new Error(`claude 오류: ${String(result.result ?? result.subtype).slice(0, 300)}`)

  const usage = (result.usage ?? {}) as Record<string, number>
  const modelUsage = (result.modelUsage ?? {}) as Record<string, unknown>
  return {
    verdict: parseVerdict(result),
    images,
    usage: {
      model: Object.keys(modelUsage)[0] ?? model,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      apiEquivUsd: Number(result.total_cost_usd ?? 0),
      judgeMs: Date.now() - started,
    },
  }
}

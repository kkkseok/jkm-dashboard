/**
 * 샘플 검증 리포트 — 대상 엑셀에서 직접 몇 쌍을 골라 수집 → 판정(조각 방식·근거 재검증)까지 돌려 본다.
 * **DB 는 읽기만 한다**(GS 공통 이미지 목록·등록된 쌍 조회). match_* 테이블에 아무것도 기록하지 않는다.
 *
 * 483쌍을 올리기 전에 새 목록이 수집·판정 경로를 문제없이 타는지 확인하는 용도.
 * 수집 로직은 run.ts 의 collect 와 같은 추출 함수(src/lib/match/extract)를 쓴다.
 *
 * 실행: pnpm tsx scripts/match/sample-report.ts <엑셀경로> --only 자재코드,… [--sheet 전체리스트] [--no-judge]
 *                                               [--judge-model sonnet] [--out 결과.json]
 *       MATCH_ALIGN·MATCH_VERIFY 는 기본 on (운영 워크플로와 같게).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.MATCH_ALIGN ??= 'on'
process.env.MATCH_VERIFY ??= 'on'
import fs from 'node:fs'
import postgres from 'postgres'
import * as XLSX from 'xlsx'
import {
  describePage,
  extractCjDetail,
  extractCjThumb,
  extractGsDescHtml,
  extractGsDescUrl,
  extractGsDetail,
  extractGsThumb,
} from '../../src/lib/match/extract'
import { sha256, statusAfterVerdict } from '../../src/lib/match/gate'
import { CJ_URL_RE, GS_URL_RE } from '../../src/lib/match/mapping'
import { judgePair, JudgeSkipError } from './judge'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

async function request(url: string, referer?: string): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) return res
      lastErr = new Error(`HTTP ${res.status}`)
      if (res.status === 404) break
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
const getText = async (url: string, referer?: string) => (await request(url, referer)).text()
const getHash = async (url: string, referer?: string) => {
  try {
    return sha256(new Uint8Array(await (await request(url, referer)).arrayBuffer()))
  } catch {
    return null
  }
}

type Row = { matCode: string; productName: string; gsUrl: string; cjUrl: string }

/** 헤더 행(자재코드 가 있는 행)을 찾아 자재코드·GS·CJ URL 을 읽는다. URL 열은 값의 도메인으로 판별한다. */
function readRows(file: string, sheet?: string): Row[] {
  const wb = XLSX.read(fs.readFileSync(file))
  const name = sheet ?? wb.SheetNames[0]
  const ws = wb.Sheets[name]
  if (!ws) throw new Error(`시트 "${name}" 없음 — 있는 시트: ${wb.SheetNames.join(', ')}`)
  const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e }),
  })
  const out: Row[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const cells = row.map((v) => (v == null ? '' : String(v).trim()))
    const gsUrl = cells.find((c) => GS_URL_RE.test(c))
    const cjUrl = cells.find((c) => CJ_URL_RE.test(c))
    if (!gsUrl || !cjUrl) continue
    const first = cells.findIndex((c) => c !== '')
    const matCode = cells[first]
    if (!matCode || seen.has(matCode)) continue
    seen.add(matCode)
    out.push({ matCode, productName: cells[first + 1] ?? '', gsUrl, cjUrl })
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const file = args[0]
  if (!file || file.startsWith('--')) throw new Error('엑셀 경로가 필요합니다.')
  const only = value('--only')?.split(',').map((s) => s.trim()).filter(Boolean)
  const judge = !args.includes('--no-judge')
  const model = value('--judge-model') ?? 'sonnet'
  const outPath = value('--out')

  const all = readRows(file, value('--sheet'))
  console.log(`엑셀: GS·CJ URL 이 쌍인 행 ${all.length}건`)
  if (!only) {
    console.log('--only 가 없어 건수만 출력하고 끝냅니다.')
    return
  }
  const targets = only.map((code) => {
    const row = all.find((r) => r.matCode === code)
    if (!row) throw new Error(`자재코드 ${code} 가 엑셀에 없습니다.`)
    return row
  })

  const dbUrl = process.env.DATABASE_URL_UNPOOLED
  if (!dbUrl) throw new Error('DATABASE_URL_UNPOOLED is not set.')
  const sql = postgres(dbUrl, { max: 1 })
  let common: Set<string>
  let registered: Map<string, { cj_url: string; gs_url: string; status: string }>
  try {
    common = new Set((await sql<{ hash: string }[]>`select hash from match_common_image`).map((r) => r.hash))
    registered = new Map(
      (
        await sql<{ mat_code: string; cj_url: string; gs_url: string; status: string }[]>`
          select mat_code, cj_url, gs_url, status from match_pair`
      ).map((r) => [r.mat_code, r]),
    )
  } finally {
    await sql.end()
  }
  console.log(`GS 공통 이미지 ${common.size}종(DB 목록, 읽기 전용) · 모델 ${model} · 정렬 ${process.env.MATCH_ALIGN} · 재검증 ${process.env.MATCH_VERIFY}\n`)

  const report: unknown[] = []
  let failed = 0
  for (const t of targets) {
    const reg = registered.get(t.matCode)
    const kind = !reg ? '신규' : reg.cj_url !== t.cjUrl || reg.gs_url !== t.gsUrl ? '링크 변경' : '기존 동일'
    const entry: Record<string, unknown> = { ...t, kind }
    report.push(entry)
    try {
      const [cjHtml, gsHtml] = await Promise.all([getText(t.cjUrl), getText(t.gsUrl)])
      const cjThumbUrl = extractCjThumb(cjHtml)
      if (!cjThumbUrl) throw new Error(`CJ 썸네일 없음 — ${describePage(cjHtml)}`)
      const gsThumbUrl = extractGsThumb(gsHtml)
      if (!gsThumbUrl) throw new Error(`GS 썸네일 없음 — ${describePage(gsHtml)}`)
      let gsDescHtml = extractGsDescHtml(gsHtml)
      if (gsDescHtml === null) {
        const gsDescUrl = extractGsDescUrl(gsHtml)
        if (!gsDescUrl) throw new Error(`GS 상세 기술서 없음 — ${describePage(gsHtml)}`)
        const descPage = await getText(gsDescUrl, t.gsUrl)
        gsDescHtml = extractGsDescHtml(descPage)
        if (gsDescHtml === null) throw new Error(`GS 상세 페이지에 기술서 없음 — ${describePage(descPage)}`)
      }
      const cjRefs = extractCjDetail(cjHtml)
      const gsRefs = extractGsDetail(gsDescHtml)
      if (gsRefs.length === 0) throw new Error('GS 상세 이미지 0장')
      const cjDetail = await Promise.all(cjRefs.map(async (r) => ({ ...r, hash: await getHash(r.url) })))
      const gsAll = await Promise.all(gsRefs.map(async (r) => ({ ...r, hash: await getHash(r.url, t.gsUrl) })))
      const gsDetail = gsAll.filter((d) => !(d.hash && common.has(d.hash)))
      const broken = [...cjDetail, ...gsAll].filter((d) => !d.hash).length
      Object.assign(entry, {
        collect: { cjDetail: cjDetail.length, gsDetail: gsAll.length, gsCommon: gsAll.length - gsDetail.length, broken },
      })
      let line = `${t.matCode.padEnd(8)} ${kind.padEnd(6)} 수집 OK — CJ 상세 ${cjDetail.length}장 · GS 상세 ${gsAll.length}장(공통 ${gsAll.length - gsDetail.length})${broken ? ` · 깨진 이미지 ${broken}` : ''}`
      if (judge) {
        const r = await judgePair({ cjThumbUrl, gsThumbUrl, gsPageUrl: t.gsUrl, cjDetail, gsDetail }, model)
        const status = statusAfterVerdict('new', r.verdict)
        const u = r.usage
        Object.assign(entry, { status, verdict: r.verdict, align: r.align, verify: r.verify, usage: u })
        line +=
          `\n         판정 ${r.verdict.thumbnail}/${r.verdict.detail} → 상태 ${status} (${Math.round(u.judgeMs / 1000)}s, 토큰 ${u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens}, API 환산 $${u.apiEquivUsd.toFixed(2)})` +
          (r.align ? ` · 조각 ${r.align.pieces}개, 전송 ${Math.round(((r.align.cjSentPx + r.align.gsSentPx) / (r.align.cjTotalPx + r.align.gsTotalPx)) * 100)}%` : ' · 선별 없음(전 구간)') +
          (r.verify ? (r.verify.failed ? ` · 재검증 실패: ${r.verify.failed}` : ` · 재검증 확인 ${r.verify.confirmed}/엇갈림 ${r.verify.rejected}/불가 ${r.verify.unsure}`) : '') +
          `\n         요약: ${r.verdict.summary}`
        for (const d of r.verdict.differences) {
          line += `\n           - [${d.confidence ?? '-'}${d.verify ? `·${d.verify}` : ''}] ${d.area} ${d.what}`
        }
      }
      console.log(line)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 실패는 숨기지 않는다 — 한 쌍의 실패로 나머지를 멈추지는 않되, 끝에 실패로 종료한다.
      entry.error = msg
      if (e instanceof JudgeSkipError) entry.skipped = true
      failed++
      console.log(`${t.matCode.padEnd(8)} ${kind.padEnd(6)} 실패: ${msg.slice(0, 200)}`)
    }
  }
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log(`\n결과 저장: ${outPath}`)
  }
  console.log(`\n완료 ${targets.length - failed}/${targets.length}쌍${failed ? ` · 실패 ${failed}쌍` : ''}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

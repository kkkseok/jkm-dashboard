/**
 * 초기/재import 스크립트 (append-only 모델).
 *
 * 입력: `docs/common/cal_amount.xlsx`
 *   - 첫 행: 헤더 (A: 상품코드, B: 후정산금)
 *   - 이후 행: 데이터 (5,000행+ 가능)
 *
 * 동작:
 *   - **엑셀 행을 역순으로 INSERT** — 사용자 멘탈 모델상 엑셀 row 1 이 "가장 최신".
 *     역순 INSERT → 엑셀 row 1 이 가장 큰 id 를 받음 → 화면 id DESC 정렬 시 최상단.
 *   - upsert/onConflict 없음. 동일 productCode 는 여러 row 로 보존 (이력).
 *   - 행 단위 에러는 스킵 + 로그.
 *
 * 주의: 이 스크립트는 **append** 한다. 재실행 시 데이터가 중복으로 쌓인다.
 *   완전 재import 가 목적이라면 먼저 Supabase SQL Editor 에서:
 *     TRUNCATE TABLE cal_amount RESTART IDENTITY;
 *   를 실행한 뒤 본 스크립트 실행.
 *
 * 실행: `pnpm tsx scripts/import-cal-amount.ts`
 * 환경변수: DATABASE_URL_UNPOOLED (Supabase Session Pooler 5432) 필요.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../src/db/schema'
import { calAmount } from '../src/db/schema'

const FILE = path.resolve(process.cwd(), 'docs/common/cal_amount.xlsx')

type Row = {
  '상품코드'?: string | number
  '후정산금'?: string | number
  [k: string]: unknown
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) {
    throw new Error(
      'DATABASE_URL_UNPOOLED is not set. .env.local 에 Supabase Session Pooler(5432) string 을 설정하세요.',
    )
  }

  if (!fs.existsSync(FILE)) {
    throw new Error(`엑셀 파일을 찾을 수 없습니다: ${FILE}`)
  }

  const buf = fs.readFileSync(FILE)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    throw new Error('엑셀에 시트가 없습니다')
  }
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null })

  console.log(`엑셀 파싱 완료: ${rows.length} 행 (시트: ${sheetName})`)

  const sqlClient = postgres(url, { prepare: false, max: 1 })
  const db = drizzle(sqlClient, { schema })

  let inserted = 0
  let skipped = 0

  // 역순 INSERT: 엑셀 row 1(=배열 index 0)이 가장 마지막에 INSERT → 가장 큰 id 부여.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    const rawCode = r['상품코드']
    const rawAmount = r['후정산금']

    const productCode = rawCode == null ? '' : String(rawCode).trim()
    if (!productCode) {
      console.warn(`[row ${i + 2}] 상품코드 비어있음 — 스킵`)
      skipped++
      continue
    }

    const parsedAmount = Number(rawAmount)
    if (!Number.isFinite(parsedAmount)) {
      console.warn(
        `[row ${i + 2}] 후정산금 파싱 실패 (${String(rawAmount)}) — 스킵`,
      )
      skipped++
      continue
    }
    const extraSettlement = Math.trunc(parsedAmount)

    try {
      await db.insert(calAmount).values({
        productCode,
        extraSettlement,
      })
      inserted++
    } catch (e) {
      console.error(`[row ${i + 2}] ${productCode}: ${(e as Error).message}`)
      skipped++
    }
  }

  await sqlClient.end()

  console.log(`imported ${inserted} rows (skipped ${skipped})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

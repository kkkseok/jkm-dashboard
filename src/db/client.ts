import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. .env.local 에 Supabase Transaction Pooler(6543) connection string 을 설정하세요.',
  )
}

// HMR(개발) 시 Next.js가 모듈을 재평가하면서 connection 이 누적되는 것을 방지.
const globalForDb = globalThis as unknown as {
  _sql?: ReturnType<typeof postgres>
}

// prepare:false — Supabase Transaction Pooler 는 prepared statement 미지원.
// 마이그레이션은 DATABASE_URL_UNPOOLED(direct 5432) 를 사용하므로 이 클라이언트는 런타임 전용.
const sql = globalForDb._sql ?? postgres(url, { prepare: false })
if (process.env.NODE_ENV !== 'production') {
  globalForDb._sql = sql
}

export const db = drizzle(sql, { schema })

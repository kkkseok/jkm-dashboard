import { config } from 'dotenv'
import type { Config } from 'drizzle-kit'

config({ path: '.env.local' })

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) {
  throw new Error(
    'DATABASE_URL_UNPOOLED is not set. drizzle-kit 은 Supabase Direct connection(5432) 을 사용합니다. .env.local 을 확인하세요.',
  )
}

export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
  verbose: true,
  strict: true,
} satisfies Config

---
name: neon-drizzle
description: Neon Postgres + Drizzle ORM 셋업/스키마/마이그레이션/CRUD 패턴. drizzle-kit, postgres-js, Server Action에서 DB 접근, .env.local 환경변수, Vercel 배포 시 Neon 연결. DB 테이블 추가/변경/seed 작업 시 반드시 참조.
---

# Neon + Drizzle 셋업·운용

## 0. 최초 셋업

```bash
pnpm add drizzle-orm postgres @neondatabase/serverless
pnpm add -D drizzle-kit dotenv
```

`.env.local`:
```
# 풀링(앱 런타임용)
DATABASE_URL="postgres://user:pass@ep-xxx-pooler.neon.tech/db?sslmode=require"
# 비풀링(마이그레이션용 - 풀링 connection은 prepared statement 일부 제약)
DATABASE_URL_UNPOOLED="postgres://user:pass@ep-xxx.neon.tech/db?sslmode=require"
```

`.gitignore`에 `.env*.local` 포함되어 있는지 확인.

## 1. 파일 구조

```
src/db/
├── client.ts            # 서버 런타임 DB 클라이언트 (싱글톤)
├── schema/
│   ├── cal-amount.ts
│   └── index.ts         # re-export
drizzle/                 # 마이그레이션 SQL (git 커밋)
├── meta/
└── 0000_xxx.sql
drizzle.config.ts
```

## 2. Drizzle 클라이언트

```ts
// src/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// HMR(개발) 중복 연결 방지
const globalForDb = globalThis as unknown as { _sql?: ReturnType<typeof postgres> }
const sql = globalForDb._sql ?? postgres(url, { prepare: false })
if (process.env.NODE_ENV !== 'production') globalForDb._sql = sql

export const db = drizzle(sql, { schema })
```

`prepare: false`는 Neon pooled URL에서 권장(트랜잭션 모드 풀링에서 prepared statement 미지원).

## 3. drizzle.config.ts

```ts
import 'dotenv/config'
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // 마이그레이션은 비풀링 URL 사용
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
  verbose: true,
  strict: true,
} satisfies Config
```

## 4. 스키마 정의 패턴

```ts
// src/db/schema/cal-amount.ts
import { pgTable, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const calAmount = pgTable(
  'cal_amount',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productCode: text('product_code').notNull(),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    uniqProductCode: uniqueIndex('cal_amount_product_code_uniq').on(t.productCode),
  }),
)

export type CalAmount = typeof calAmount.$inferSelect
export type NewCalAmount = typeof calAmount.$inferInsert
```

```ts
// src/db/schema/index.ts
export * from './cal-amount'
```

## 5. package.json 스크립트

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate":  "drizzle-kit migrate",
    "db:studio":   "drizzle-kit studio"
  }
}
```

워크플로우: 스키마 수정 → `pnpm db:generate` → SQL 검토 → `pnpm db:migrate`.

## 6. Server Action으로 CRUD 노출

```ts
// src/lib/cal-amount/actions.ts
'use server'
import { db } from '@/db/client'
import { calAmount } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'

const Upsert = z.object({
  productCode: z.string().min(1),
  amount: z.coerce.number().int(),
})

export async function upsertCalAmount(input: z.infer<typeof Upsert>) {
  const v = Upsert.parse(input)
  await db
    .insert(calAmount)
    .values({ productCode: v.productCode, amount: v.amount })
    .onConflictDoUpdate({
      target: calAmount.productCode,
      set: { amount: v.amount, updatedAt: new Date() },
    })
  revalidatePath('/cal-amount')
}

export async function deleteCalAmount(productCode: string) {
  await db.delete(calAmount).where(eq(calAmount.productCode, productCode))
  revalidatePath('/cal-amount')
}

export async function listCalAmount() {
  return db.select().from(calAmount).orderBy(calAmount.productCode)
}
```

## 7. 시드/임포트 스크립트

```ts
// scripts/import-cal-amount.ts
import 'dotenv/config'
import * as XLSX from 'xlsx'
import fs from 'fs'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@/db/schema'
import { calAmount } from '@/db/schema'

const sql = postgres(process.env.DATABASE_URL_UNPOOLED!, { prepare: false })
const db = drizzle(sql, { schema })

const buf = fs.readFileSync('docs/common/cal_amount.xlsx')
const wb = XLSX.read(buf)
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json<{ '상품코드': string | number; '후정산금': number }>(ws)

for (const r of rows) {
  await db.insert(calAmount).values({
    productCode: String(r['상품코드']),
    amount: Number(r['후정산금']),
  }).onConflictDoUpdate({
    target: calAmount.productCode,
    set: { amount: Number(r['후정산금']) },
  })
}
await sql.end()
console.log(`imported ${rows.length} rows`)
```

실행: `pnpm tsx scripts/import-cal-amount.ts`

## 8. Vercel 배포 시

1. Vercel 대시보드 → Storage → Neon 연결 (또는 직접 Neon 콘솔에서 만든 후 env 등록)
2. 환경변수 `DATABASE_URL`, `DATABASE_URL_UNPOOLED` 등록
3. 배포 시 `pnpm db:migrate` 가 build 단계에서 자동 실행되도록 `build` 스크립트 조정:
   ```json
   "build": "drizzle-kit migrate && next build"
   ```
   (또는 GitHub Actions/Vercel pre-deploy hook에서)

## 9. 흔한 함정

- **풀링 URL로 마이그레이션 돌리면 실패.** "prepared statement does not exist" 에러. → 비풀링 URL 사용.
- **`prepare: true`(기본) + pooler URL** → 같은 증상. `prepare: false`로 끄기.
- **`generated by default as identity` vs `always`.** 사용자 명시 INSERT 가능하려면 `byDefault`. cal_amount는 `always`라도 무방.
- **컬럼 drop 마이그레이션은 자동 적용 금지.** drizzle-kit가 위험한 마이그레이션을 만들면 사람 검토 필수.
- **Server Action 안에서 throw하면 클라이언트로 메시지 전파됨.** 민감 정보 노출 주의.
- **`onConflictDoUpdate`의 `target`은 unique index/constraint가 있어야 작동.** 스키마에 `uniqueIndex` 빼먹지 말 것.

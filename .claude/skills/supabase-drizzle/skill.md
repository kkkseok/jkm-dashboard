---
name: supabase-drizzle
description: Supabase Postgres + Drizzle ORM 셋업/스키마/마이그레이션/CRUD 패턴. drizzle-kit, postgres-js, Server Action에서 DB 접근, .env.local 환경변수(transaction pooler vs direct), Vercel 배포 시 Supabase 연결. DB 테이블 추가/변경/seed 작업 시 반드시 참조.
---

# Supabase + Drizzle 셋업·운용

## 0. 최초 셋업

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit dotenv tsx
```

Supabase JS client(`@supabase/supabase-js`)는 본 프로젝트에서 사용하지 않는다. DB 접근은 모두 Drizzle을 통한다(필요 시 Auth/Storage 도입 시점에 별도 합의).

`.env.local`:
```
# Transaction Pooler (런타임, port 6543) — prepared statement 미지원 → prepare:false
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"

# Session Pooler (마이그레이션·일회성 스크립트, port 5432) — IPv4 가능, prepared statement 지원
DATABASE_URL_UNPOOLED="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
```

값은 Supabase Dashboard → Project Settings → Database → Connection string 에서 가져온다.
**Direct connection(`db.[REF].supabase.co:5432`)은 IPv6 only이므로 일반적인 Windows/IPv4 환경에서 연결 실패** — Direct 대신 Session Pooler를 쓴다.
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

`prepare: false`는 Supabase Transaction Pooler에서 권장(트랜잭션 모드 풀링에서 prepared statement 미지원).

## 3. drizzle.config.ts

```ts
import 'dotenv/config'
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // 마이그레이션은 direct connection(5432) 사용
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
    extraSettlement: integer('extra_settlement').notNull(),
    productName: text('product_name'),
    memo: text('memo'),
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

> Supabase Dashboard의 SQL Editor / Table Editor도 사용 가능하지만, **스키마는 Drizzle을 단일 소스로 유지**한다. Studio에서 직접 만든 테이블은 Drizzle 스키마에 역으로 반영하지 않는 한 마이그레이션 충돌의 원인이 된다.

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
  extraSettlement: z.coerce.number().int(),
})

export async function upsertCalAmount(input: z.infer<typeof Upsert>) {
  const v = Upsert.parse(input)
  await db
    .insert(calAmount)
    .values({ productCode: v.productCode, extraSettlement: v.extraSettlement })
    .onConflictDoUpdate({
      target: calAmount.productCode,
      set: { extraSettlement: v.extraSettlement, updatedAt: new Date() },
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

> zod 스키마는 클라이언트(폼)와 공유하려면 `'use server'` 파일이 아닌 별도 파일(`src/lib/cal-amount/schema.ts`)에 두고 양쪽이 import한다.

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
    extraSettlement: Number(r['후정산금']),
  }).onConflictDoUpdate({
    target: calAmount.productCode,
    set: { extraSettlement: Number(r['후정산금']) },
  })
}
await sql.end()
console.log(`imported ${rows.length} rows`)
```

실행: `pnpm tsx scripts/import-cal-amount.ts`

## 8. Vercel 배포 시

1. Supabase Dashboard에서 Connection string 2종 복사
2. Vercel 프로젝트 → Settings → Environment Variables 에 등록:
   - `DATABASE_URL` (Transaction Pooler URL)
   - `DATABASE_URL_UNPOOLED` (Direct URL)
3. 마이그레이션 실행 흐름:
   - **권장**: 로컬에서 `pnpm db:migrate`로 적용한 뒤, 생성된 `drizzle/*.sql`은 git 커밋
   - 또는 Vercel build 단계에 `drizzle-kit migrate && next build` 로 자동화 (단, direct URL 환경변수가 빌드 환경에 있어야 함)

## 9. 흔한 함정

- **`dotenv`는 기본 `.env`만 읽음.** Next.js 컨벤션을 따라 `.env.local`을 쓰면 drizzle-kit / 스크립트는 환경변수를 못 읽고 `DATABASE_URL_UNPOOLED is not set` 등으로 실패한다. → `drizzle.config.ts`와 모든 `scripts/*.ts`에서 다음 패턴 사용:
  ```ts
  import { config } from 'dotenv'
  config({ path: '.env.local' })
  ```
- **Transaction Pooler URL로 마이그레이션 돌리면 실패.** "prepared statement does not exist" 등 에러. → Direct URL(5432) 사용.
- **`prepare: true`(기본) + pooler URL** → 같은 증상. `prepare: false`로 끄기.
- **Supabase Studio에서 직접 만든 테이블** → Drizzle 스키마와 어긋남. 항상 Drizzle 우선.
- **컬럼 drop 마이그레이션은 자동 적용 금지.** drizzle-kit가 위험한 마이그레이션을 만들면 사람 검토 필수.
- **Server Action 안에서 throw하면 클라이언트로 메시지 전파됨.** 민감 정보 노출 주의.
- **`onConflictDoUpdate`의 `target`은 unique index/constraint가 있어야 작동.** 스키마에 `uniqueIndex` 빼먹지 말 것.
- **연결 풀 누적**: Next.js HMR에서 매 핫리로드마다 postgres 클라이언트가 새로 생성되면 connection이 빠르게 소진된다. `globalThis` 캐싱 필수 (위 §2).
- **Supabase RLS**: Drizzle은 service role 키 없이 일반 connection으로 연결하므로 RLS가 활성화된 테이블은 접근이 차단될 수 있다. 본 프로젝트는 초기엔 RLS 미사용(사내 도구), Auth 도입 시 별도 합의.

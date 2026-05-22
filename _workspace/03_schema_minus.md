# 마이너스 매출이익률 — DB 스키마 / Server Action 명세

> 작성: 2026-05-22 / 작성자: `db-engineer` 에이전트
> 입력: `02_uiux_minus.md` §5, `memory/project_minus_logic.md`
> 스킬: `neon-drizzle`
> 대상 구현자: `next-builder` (다음 단계 UI 구현)

---

## 1. 생성/수정 파일 목록

### 신규 생성

| 경로 | 설명 |
|------|------|
| `src/db/client.ts` | Drizzle 클라이언트(싱글톤 + HMR 보호 + `prepare: false`) |
| `src/db/schema/cal-amount.ts` | `cal_amount` 테이블 정의 + `$inferSelect`/`$inferInsert` export |
| `src/db/schema/index.ts` | 스키마 모듈 re-export 진입점 |
| `src/lib/cal-amount/schema.ts` | 공용 zod 입력 스키마 (클라이언트 RHF resolver + Server Action 양쪽에서 import) |
| `src/lib/cal-amount/actions.ts` | Server Action 4개: `upsertCalAmount` / `deleteCalAmount` / `listCalAmount` / `getCalAmountMap` |
| `drizzle.config.ts` | drizzle-kit 설정 — `DATABASE_URL_UNPOOLED` 사용, output `./drizzle` |
| `scripts/import-cal-amount.ts` | `docs/common/cal_amount.xlsx` → DB upsert 스크립트 (tsx 실행) |
| `.env.local.example` | 환경변수 가이드 (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). `.env.local` 은 사용자가 작성 |

### 수정

| 경로 | 변경 내용 |
|------|----------|
| `package.json` | `db:generate` / `db:migrate` / `db:studio` 스크립트 추가, 의존성 `drizzle-orm`, `postgres`, `@neondatabase/serverless`, `drizzle-kit`(dev), `dotenv`(dev) 추가 |

`.gitignore` 는 기존에 이미 `.env*` 패턴으로 모든 env 파일 제외 중 — 수정 불필요.

---

## 2. `cal_amount` 스키마 요약

DB 컬럼은 snake_case, TS 식별자는 camelCase 로 매핑.

| TS 식별자 | DB 컬럼 | 타입 | null | 기본값 | 비고 |
|-----------|---------|------|------|--------|------|
| `id` | `id` | `integer` (identity, PK) | NOT NULL | `GENERATED ALWAYS AS IDENTITY` | 내부 PK. upsert 대상 아님 |
| `productCode` | `product_code` | `text` | NOT NULL | — | **UNIQUE** (`cal_amount_product_code_uniq`). upsert target |
| `productName` | `product_name` | `text` | nullable | — | 선택 입력. 검색/표시용 |
| `extraSettlement` | `extra_settlement` | `integer` | NOT NULL | — | 음수 / 0 허용. 0 = 의도적 등록(누락 아님) |
| `memo` | `memo` | `text` | nullable | — | 최대 500자(zod 측 검증) |
| `createdAt` | `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updatedAt` | `updated_at` | `timestamptz` | NOT NULL | `now()` | upsert/update 시 서버에서 `new Date()` 주입 |

### 인덱스

- `cal_amount_product_code_uniq` (UNIQUE on `product_code`) — `onConflictDoUpdate` 의 conflict target.

### 타입 export

```ts
export type CalAmount = typeof calAmount.$inferSelect
export type NewCalAmount = typeof calAmount.$inferInsert
```

### 명세 정렬

- 02_uiux_minus.md §5-3 폼 4필드(`productCode`, `productName`, `extraSettlement`, `memo`) ↔ DB 컬럼 1:1 일치.
- §4 인라인 입력 시 `productCode` 자동 주입 + readonly, `productName` 도 자동 주입 + readonly → 동일 폼 컴포넌트 재사용 가능.
- `project_minus_logic.md` "누락 정의" — 누락은 row 부재이며, `extraSettlement = 0` row 는 누락 아님. 스키마는 이 의미론을 직접 표현 가능(존재 여부 vs 값).

---

## 3. Server Action 시그니처

파일: `src/lib/cal-amount/actions.ts` (`'use server'`)
공용 입력 스키마: `src/lib/cal-amount/schema.ts`

### 3-1. `upsertCalAmount`

```ts
upsertCalAmount(input: CalAmountInput): Promise<CalAmount>
```

- 입력: `{ productCode: string, productName?: string, extraSettlement: number, memo?: string }`
- zod 검증 → 통과 시 `INSERT ... ON CONFLICT (product_code) DO UPDATE SET ...` 실행.
- 충돌 시 `productName`, `extraSettlement`, `memo`, `updatedAt` 갱신.
- `.returning()` 으로 upsert 결과 row 반환 (분석 페이지에서 KPI/테이블 즉시 재계산용).
- 성공 시 `revalidatePath('/cal-amount')`.
- 실패: zod 에러 → 메시지가 클라이언트로 전파 (form 단의 `Alert` 또는 toast).

### 3-2. `deleteCalAmount`

```ts
deleteCalAmount(productCode: string): Promise<void>
```

- 입력: `productCode` 단일 문자열.
- `DELETE FROM cal_amount WHERE product_code = $1`.
- 존재하지 않으면 no-op.
- `revalidatePath('/cal-amount')`.

### 3-3. `listCalAmount`

```ts
listCalAmount(params?: {
  search?: string
  page?: number       // 기본 1, 1-based
  pageSize?: number   // 기본 100, 최대 1000
}): Promise<{
  rows: CalAmount[]
  total: number
}>
```

- 검색: `search` 비어있지 않으면 `product_code ILIKE %s%` OR `product_name ILIKE %s%`.
- 정렬: `product_code ASC`.
- 페이지네이션: `LIMIT $pageSize OFFSET ($page - 1) * $pageSize`.
- 총 건수는 동일 WHERE 로 `count(*)::int` 별도 쿼리.
- 02_uiux_minus.md §5-1 "1,234건 중 1–100 [< 이전] [1][2]…[13] [다음 >]" 페이지네이션에 직결.

### 3-4. `getCalAmountMap`

```ts
getCalAmountMap(): Promise<Map<string, number>>
```

- 전체 `cal_amount` 를 `Map<productCode, extraSettlement>` 로 반환.
- 분석 페이지에서 productCode 룩업으로 사용.
- 매칭 실패 = `map.has(productCode) === false` → 누락 카운트의 기준 (`project_minus_logic.md` "누락 정의").
- TODO(scale): 행 수가 수만 이상으로 늘면 chunked / 서버 join / 캐시 전략 검토. 코드에 주석 명시.

---

## 4. 사용자 직접 수행 단계

코드는 모두 작성됐지만 환경변수가 없어 마이그레이션은 못 돌렸습니다. 다음 순서대로 사용자가 진행하면 됩니다.

1. **Neon 프로젝트 생성**
   - https://console.neon.tech → New Project → 리전 선택(ap-northeast-1 권장) → 프로젝트명 `jkm-dashboard` 등.
   - Connection details 화면에서 두 가지 connection string 확보:
     - **Pooled** (런타임용): hostname 에 `-pooler` 포함
     - **Direct** (마이그레이션용): pooler 미포함, hostname 끝이 `.neon.tech`

2. **`.env.local` 작성** (프로젝트 루트, git 제외됨)
   ```
   DATABASE_URL="postgres://USER:PASS@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"
   DATABASE_URL_UNPOOLED="postgres://USER:PASS@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
   ```
   `.env.local.example` 참조.

3. **마이그레이션 SQL 생성**
   ```bash
   pnpm db:generate
   ```
   → `drizzle/0000_xxx.sql` 생성. **SQL 검토 후 git 커밋.**

4. **마이그레이션 적용**
   ```bash
   pnpm db:migrate
   ```
   → Neon DB 에 `cal_amount` 테이블 + unique index 생성.

5. **초기 데이터 import**
   ```bash
   pnpm tsx scripts/import-cal-amount.ts
   ```
   → `docs/common/cal_amount.xlsx` 의 모든 행을 upsert. 로그: `imported NN rows (created M, updated K, skipped S)`.

6. **(선택) Drizzle Studio 로 데이터 확인**
   ```bash
   pnpm db:studio
   ```

7. **Vercel 배포 시** (향후)
   - Vercel 프로젝트 env 에 동일한 `DATABASE_URL`, `DATABASE_URL_UNPOOLED` 등록.
   - 또는 Neon 의 Vercel integration 으로 자동 주입.

---

## 5. 위험도 메모

이번 단계는 신규 테이블 추가뿐이라 데이터 손실 위험 없음.

- ⓘ `cal_amount` 신규 테이블 — 기존 데이터 없음, drop/alter 없음.
- ⓘ unique index — 신규 생성, 충돌 가능 데이터 없음.
- ⓘ migration SQL 은 사용자 검토 후 git 커밋 → 향후 prod 배포 시 동일 SQL 적용 (drizzle-kit 의 `migrate` 트래킹).
- ⚠️ 향후 컬럼 변경/삭제 시 `drizzle-kit generate` 결과를 반드시 사람 검토 (스킬 가이드 9번 함정).

---

## 6. 타입 체크 결과

```
$ pnpm exec tsc --noEmit
EXIT=0
```

- **PASS** — 전체 컴파일 오류 없음.
- 검사 범위: `tsconfig.json` 의 `include` 패턴(루트 ts/tsx + `.next/types`). `drizzle.config.ts`, `scripts/import-cal-amount.ts`, `src/db/**`, `src/lib/cal-amount/**` 포함.
- 주의 사항(컴파일과 무관):
  - `src/db/client.ts` 는 import 시점에 `DATABASE_URL` 미설정이면 throw. 환경변수 설정 전에는 **Server Component / Server Action 런타임에서만** 실패. 빌드 자체에는 영향 없음(top-level throw 가 module-eval 시점 발생).
  - `drizzle.config.ts` 도 동일하게 `DATABASE_URL_UNPOOLED` 미설정이면 throw. drizzle-kit CLI 실행 시점에만 영향.

---

## 7. 핵심 결정 사항 (요약)

- **schema 컬럼 = 02_uiux_minus.md §5-3 폼 4필드 + meta 3필드** (`id`, `createdAt`, `updatedAt`). 1:1 매핑.
- **upsert target = `product_code` unique index**. 같은 productCode 재입력 = update.
- **존재 vs 값**: 누락 정의(memory)에 따라 `extraSettlement=0` 도 유효 row 로 보존. `getCalAmountMap` 의 `Map.has()` 가 분석 페이지에서 "누락" 판정의 진실 기준.
- **zod 스키마는 별도 파일** (`src/lib/cal-amount/schema.ts`)로 분리 — Server Action 외에 클라이언트 `react-hook-form` resolver 가 동일 스키마 사용 가능. RHF zodResolver 가 `'use server'` 파일에서 import 못 하는 이슈 회피.
- **`.env.local` 은 git 제외**, `.env.local.example` 만 커밋 가능.
- **마이그레이션 SQL 생성/적용은 사용자 단계** — 환경변수 부재로 자동화 불가.
- **타입 체크 통과** (`tsc --noEmit` EXIT 0).

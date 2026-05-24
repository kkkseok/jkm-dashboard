# 후정산금 — DB 스키마 / Server Action 명세

> 작성: 2026-05-22 / 작성자: `db-engineer` 에이전트
> v1.1 (2026-05-24): **append-only 단순화** 반영 — `cal_amount` 가 (id, productCode, extraSettlement, createdAt, updatedAt) 5컬럼으로 축소, UNIQUE 제거, `upsertCalAmount` → `appendCalAmount`, `deleteCalAmount(productCode)` → `deleteCalAmount(id)`, `getCalAmountMap` 은 DISTINCT ON 으로 최신 id winner. 분석 페이지 §4 도 mode="create"/"edit" 분기를 폐기하고 동일 동작(append-only INSERT) 로 통일. 마이그레이션 0001(컬럼 drop) + 0002(UNIQUE drop) 적용.
> 입력: `02_uiux_minus.md` §5 (v1.1), `memory/project_minus_logic.md`
> 스킬: `supabase-drizzle`
> 대상 구현자: `next-builder` (분석/관리 UI 구현 완료)

---

## 1. 생성/수정 파일 목록 (현재 상태)

### 신규 생성

| 경로 | 설명 |
|------|------|
| `src/db/client.ts` | Drizzle 클라이언트(싱글톤 + HMR 보호 + `prepare: false` — Supabase Transaction Pooler 호환) |
| `src/db/schema/cal-amount.ts` | `cal_amount` 테이블 정의 (v1.1 단순화) + `$inferSelect`/`$inferInsert` export |
| `src/db/schema/index.ts` | 스키마 모듈 re-export 진입점 |
| `src/lib/cal-amount/schema.ts` | 공용 zod 입력 스키마 (클라이언트 RHF resolver + Server Action 양쪽에서 import) |
| `src/lib/cal-amount/actions.ts` | Server Action 4개: `appendCalAmount` / `deleteCalAmount(id)` / `listCalAmount` / `getCalAmountMap` |
| `drizzle.config.ts` | drizzle-kit 설정 — `DATABASE_URL_UNPOOLED` (Session Pooler) 사용, output `./drizzle` |
| `scripts/import-cal-amount.ts` | `docs/common/cal_amount.xlsx` → DB **역순 INSERT** 스크립트 (엑셀 row 1 = 가장 큰 id = 화면 최상단) |
| `.env.local.example` | 환경변수 가이드 (Supabase pooler 2종). `.env.local` 은 사용자가 작성, git 제외 |
| `drizzle/0000_outstanding_jazinda.sql` | 초기 마이그레이션 (productName/memo 포함된 v1.0 시점) |
| `drizzle/0001_amused_excalibur.sql` | **v1.1: productName / memo 컬럼 drop** |
| `drizzle/0002_icy_ma_gnuci.sql` | **v1.1: product_code UNIQUE 제약 drop** (append-only 모델) |

### 수정

| 경로 | 변경 내용 |
|------|----------|
| `package.json` | `db:generate` / `db:migrate` / `db:studio` 스크립트, 의존성 `drizzle-orm`, `postgres`, `drizzle-kit`(dev), `dotenv`(dev) |

`.gitignore` 는 기존에 이미 `.env*` 패턴으로 모든 env 파일 제외 중.

---

## 2. `cal_amount` 스키마 요약 (v1.1)

DB 컬럼은 snake_case, TS 식별자는 camelCase 로 매핑.

| TS 식별자 | DB 컬럼 | 타입 | null | 기본값 | 비고 |
|-----------|---------|------|------|--------|------|
| `id` | `id` | `integer` (identity, PK) | NOT NULL | `GENERATED ALWAYS AS IDENTITY` | 내부 PK. **분석 시 winner 판정 기준** (가장 큰 id) |
| `productCode` | `product_code` | `text` | NOT NULL | — | UNIQUE **없음** (append-only). 일반 index 만 유지 |
| `extraSettlement` | `extra_settlement` | `integer` | NOT NULL | — | 음수 / 0 허용. 0 = 의도적 등록 (누락 아님) |
| `createdAt` | `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updatedAt` | `updated_at` | `timestamptz` | NOT NULL | `now()` | append-only 라 실제로 INSERT 시점 이후 변동 없음 (스키마만 보유) |

### 인덱스

- `cal_amount_product_code_idx` (일반 index on `product_code`) — 검색·룩업 성능용. UNIQUE 아님.

### 타입 export

```ts
export type CalAmount = typeof calAmount.$inferSelect
export type NewCalAmount = typeof calAmount.$inferInsert
```

### 명세 정렬

- 02_uiux_minus.md §5-3 폼은 2필드(`productCode`, `extraSettlement`) — DB 도메인 컬럼과 1:1. productName/memo 입력 없음.
- §4 분석 페이지에서 셀 인터랙티브 시 productCode 자동 주입 + readonly (`lockProductCode=true`), `extraSettlement` 은 빈 칸으로 시작 (이력 있는 행도 동일 — 새 이력 추가 동작).
- `project_minus_logic.md` "누락 정의" — 누락 = **cal_amount 매칭 실패만**. 값 0 으로 등록된 row 는 누락 아님. `getCalAmountMap` 결과의 `Map.has()` 가 분석 페이지에서 "누락" 판정의 진실 기준.

---

## 3. Server Action 시그니처 (v1.1)

파일: `src/lib/cal-amount/actions.ts` (`'use server'`)
공용 입력 스키마: `src/lib/cal-amount/schema.ts`

### 3-1. `appendCalAmount`

```ts
appendCalAmount(input: CalAmountInput): Promise<CalAmount>
```

- 입력: `{ productCode: string, extraSettlement: number }`
- zod 검증 → 통과 시 단순 `INSERT INTO cal_amount (product_code, extra_settlement) VALUES (...) RETURNING *` 실행.
- 같은 productCode 가 이미 있어도 새 row 추가 (이력 보존). 가장 큰 id 가 분석 시 winner.
- `.returning()` 으로 신규 row 반환 — UI 클라이언트가 행 재계산 시 직접 사용.
- 성공 시 `revalidatePath('/cal-amount')`.
- 실패: zod 에러 → 메시지가 클라이언트로 전파 (form 단의 `Alert` + toast).

### 3-2. `deleteCalAmount`

```ts
deleteCalAmount(id: number): Promise<void>
```

- 입력: **이력 id** (productCode 아님). 같은 productCode 의 다른 이력 행은 영향 없음.
- `DELETE FROM cal_amount WHERE id = $1`.
- id 가 양의 정수가 아니면 throw.
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

- 검색: `search` 비어있지 않으면 `product_code ILIKE %s%` (상품명 컬럼 없음).
- 정렬: **`id DESC`** (최신 = 가장 큰 id 가 최상단).
- 페이지네이션: `LIMIT $pageSize OFFSET ($page - 1) * $pageSize`.
- 총 건수는 동일 WHERE 로 `count(*)::int` 별도 쿼리.
- 02_uiux_minus.md §5-1 "N건 중 a–b [< 이전] [...] [다음 >]" 페이지네이션에 직결.

### 3-4. `getCalAmountMap`

```ts
getCalAmountMap(): Promise<Map<string, number>>
```

- Postgres `DISTINCT ON (product_code) ... ORDER BY product_code, id DESC` 로 productCode 별 **최신 1건** 만 가져옴.
- 분석 페이지가 "분석 시작" 시점에 fresh 하게 호출 (다른 탭에서 cal_amount 변경 가능 대비).
- 매칭 실패 = `map.has(productCode) === false` → 누락 카운트의 기준.
- TODO(scale): 행 수가 수십만 이상으로 늘면 server-side join 또는 캐싱 검토. 코드에 주석 명시.

---

## 4. 사용자 직접 수행 단계 (현재 상태)

마이그레이션 0000+0001+0002 모두 사용자 환경에서 적용 완료, `import-cal-amount.ts` 로 5,282행 import 완료 (2026-05-22). 이후 신규 환경에서 새로 셋업하는 경우만 아래 순서.

1. **Supabase 프로젝트 생성**
   - https://supabase.com → New Project → 리전 선택(ap-northeast-1 / ap-northeast-2 권장).
   - Settings → Database → Connection string 에서 두 가지 확보:
     - **Transaction Pooler** (런타임용, port 6543) — prepared statement 미지원 → `prepare: false` 처리
     - **Session Pooler** (마이그레이션·tsx 스크립트용, port 5432) — prepared statement 지원
   - **Direct connection 은 IPv6 only 이므로 Windows/사무실 환경에서 사용하지 않음** (`.env.local.example` 가이드 참조).

2. **`.env.local` 작성** (프로젝트 루트, git 제외됨)
   ```
   DATABASE_URL="postgres://...@aws-0-REGION.pooler.supabase.com:6543/postgres"
   DATABASE_URL_UNPOOLED="postgres://...@aws-0-REGION.pooler.supabase.com:5432/postgres"
   ```

3. **마이그레이션 적용**
   ```bash
   pnpm db:migrate
   ```
   → 0000+0001+0002 순차 적용. 최종 상태 = v1.1 단순화 스키마.

4. **초기 데이터 import**
   ```bash
   pnpm tsx scripts/import-cal-amount.ts
   ```
   → 역순 INSERT (엑셀 row 1 이 가장 큰 id). 재실행 시 `TRUNCATE TABLE cal_amount RESTART IDENTITY;` 선행 필요 (스크립트 자체는 truncate 하지 않음).

5. **(선택) Drizzle Studio 로 데이터 확인**
   ```bash
   pnpm db:studio
   ```

6. **Vercel 배포 시** (P7)
   - Vercel 프로젝트 env 에 `DATABASE_URL`, `DATABASE_URL_UNPOOLED` 등록.
   - 빌드 단계에서 `pnpm db:migrate` 를 자동화할지, 수동 적용할지 결정 (현재 미정).

---

## 5. 위험도 메모

- ⓘ v1.1 마이그레이션 0001/0002 는 **컬럼/제약 drop** → 본 환경에서는 데이터 적재 전 시점에 적용해 손실 없음. 향후 prod 환경에서 컬럼 drop 마이그레이션은 신중하게(데이터 백업 후 적용).
- ⓘ append-only 라 같은 productCode 가 계속 누적될 수 있음. 수만~수십만 행 도달 시 `getCalAmountMap` 의 DISTINCT ON 성능 점검 필요 (B-tree on product_code, id DESC 인덱스 추가 고려).
- ⚠️ 향후 컬럼 변경/삭제 시 `drizzle-kit generate` 결과를 반드시 사람 검토 (supabase-drizzle 스킬 가이드 9번 함정).

---

## 6. 타입 체크 결과 (최종)

```
$ pnpm exec tsc --noEmit
EXIT=0

$ pnpm test
Test Files  2 passed (2)
Tests       24 passed (24)
```

- **PASS** — 전체 컴파일 오류 없음. 24/24 테스트 통과.
- 검사 범위: tsconfig include + `src/db/**`, `src/lib/cal-amount/**`, `scripts/import-cal-amount.ts`, `drizzle.config.ts`.

---

## 7. 핵심 결정 사항 (요약, v1.1+)

- **schema = (id, productCode, extraSettlement, createdAt, updatedAt)**. productName/memo 폐기 (cal_amount.xlsx 자체에 없는 메타였음).
- **UNIQUE 없음** — append-only. 같은 productCode 다행 정상, 가장 큰 id 가 winner.
- **존재 vs 값**: 누락 정의(memory)에 따라 `extraSettlement=0` 도 유효 row 로 보존. `getCalAmountMap` 의 `Map.has()` 가 분석 페이지에서 "누락" 판정의 진실 기준.
- **zod 스키마는 별도 파일** (`src/lib/cal-amount/schema.ts`)로 분리 — Server Action 외에 클라이언트 `react-hook-form` resolver 가 동일 스키마 사용. RHF zodResolver 가 `'use server'` 파일에서 import 못 하는 이슈 회피.
- **공용 입력 Dialog** (`src/components/cal-amount-form-dialog.tsx`) — 분석/관리 페이지 양쪽에서 import. props `lockProductCode` 로 분석 페이지 자동주입+readonly 처리. mode="create"/"edit" 분기 없음 — 저장은 항상 `appendCalAmount`.
- **`.env.local` 은 git 제외**, `.env.local.example` 만 커밋. Supabase Pooler 2종 가이드 포함.
- **마이그레이션 SQL 생성/적용은 사용자 단계** — 환경변수 부재로 자동화 불가.
- **타입 체크/테스트 통과** (`tsc --noEmit` EXIT 0, vitest 24/24).

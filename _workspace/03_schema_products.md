# 상품 마스터 — DB 스키마 / Server Action 명세 (P3)

> 작성: 2026-05-27 / 작성자: `db-engineer` 에이전트
> 입력: `_workspace/01_requirements_products.md` §4, `_workspace/02_uiux_products.md` §4-5 / §5-4 / §10
> 출력 코드: `src/db/schema/product_master.ts`, `src/lib/products/schema.ts`, `src/lib/products/actions.ts`
> 마이그레이션: `drizzle/0003_polite_talkback.sql`
> 다음 단계: P4(파이프라인) · P5(next-builder)

---

## 1. 테이블 정의

테이블: **`product_master`**

| 컬럼 (DB) | 컬럼 (TS) | 타입 | 제약 | 기본값 | 주석 |
|-----------|-----------|------|------|--------|------|
| `id` | `id` | `bigserial` | PRIMARY KEY | (sequence) | 내부 ID. bigserial = bigint + identity sequence. |
| `product_code` | `productCode` | `text` | **NOT NULL**, **UNIQUE** (via `product_master_product_code_uniq`) | — | sales 의 `productCode` 와 조인되는 키. 영문/숫자/-/_, ≤64자(앱 검증). |
| `channel_name` | `channelName` | `text` | NOT NULL | — | 채널 식별자. sales.A(salesType) 와 정합 권장하나 자유 문자열. ≤128자(앱 검증). |
| `brand_name` | `brandName` | `text` | NOT NULL | — | 브랜드명. ≤64자. |
| `product_name` | `productName` | `text` | NOT NULL | — | 상품명(사용자 관리용 라벨). ≤128자. |
| `is_composite` | `isComposite` | `boolean` | NOT NULL | — | 복합(true) / 단품(false). UI 폼에서 RadioGroup 기본값 없음 — 사용자 의식적 선택. |
| `created_at` | `createdAt` | `timestamptz` | NOT NULL | `now()` | INSERT 시점. |
| `updated_at` | `updatedAt` | `timestamptz` | NOT NULL | `now()` | **코드 측에서 명시 갱신** (DB 트리거 없음). 모든 mutation Server Action 이 `updatedAt: new Date()` 를 set. |

**확정**:
- append-only 미채택. 일반 upsert/CRUD (P1 §4).
- `product_code` UNIQUE 가 유일한 자연 키.

## 2. 인덱스 전략

| 인덱스 | 컬럼 | 유형 | 용도 |
|--------|------|------|------|
| `product_master_product_code_uniq` | `product_code` | **UNIQUE btree** | (a) UNIQUE 제약 강제. (b) `onConflictDoUpdate`/`onConflictDoNothing` target. (c) `getProductMasterMap` 의 lookup 가속(소수의 rows에서는 미차이지만 수만 행 이상에서 효과). (d) `checkProductCodeUnique` lookup. |
| `product_master_channel_name_idx` | `channel_name` | btree (비-unique) | (a) `getDistinctChannelNames` 의 DISTINCT scan. (b) 목록 페이지 채널 필터 `inArray` 조건. (c) 정렬 헤더 클릭 시 채널 정렬. |

> **추가 검토했으나 채택하지 않음**:
> - `brand_name`, `product_name` 단일 인덱스 — 검색은 ILIKE `%...%` (앞뒤 모두 wildcard) 라 btree 무용. 행 수가 수십만대로 늘면 `pg_trgm` GIN 인덱스 검토 권장.
> - 복합 인덱스 (`channel_name`, `is_composite`) — 단품/복합 분포가 균일하지 않으면 효과 미미. 운영 데이터로 EXPLAIN 본 뒤 결정.

## 3. Server Action 시그니처

위치: `src/lib/products/actions.ts` ('use server')
공용 zod 스키마: `src/lib/products/schema.ts` (클라이언트 폼 resolver 와 공유)

| 함수 | 시그니처 | 비고 |
|------|---------|------|
| `listProducts` | `(opts?: ListProductsParams) => Promise<{ rows: ProductRow[]; total: number }>` | 검색 4컬럼 ILIKE / 채널 inArray 다중 / isComposite 단일 / 5개 sort 키 / asc·desc / page·pageSize(default 100). 보조 정렬 `desc(id)` 로 결정성 확보. |
| `createProduct` | `(input: ProductInput) => Promise<ProductRow>` | unique 위반(Postgres 23505) 캐치 → `"이미 등록된 상품코드입니다: {code}"` Error throw. UI 가 catch 해 toast + inline error. |
| `updateProduct` | `(id: number, patch: Partial<ProductInput>) => Promise<ProductRow>` | `productInputSchema.partial()` 로 부분 검증. `productCode` 변경 시 자동 unique 재검증. `updatedAt` 명시 갱신. row 없으면 throw. |
| `deleteProduct` | `(id: number) => Promise<void>` | id 단일 삭제. |
| `checkProductCodeUnique` | `(productCode: string, excludeId?: number) => Promise<boolean>` | onBlur 검증. 사용 가능=true. `excludeId` 는 edit 모드에서 자기 자신 제외용. race 는 create/update 의 unique_violation 캐치로 최종 방어. |
| `importProducts` | `(rows: ProductInput[], opts?: { upsert: boolean }) => Promise<{ success: number; skipped: number; failed: { row: number; reason: string }[] }>` | **`upsert: false` 기본**(P2 §7 #9). false=onConflictDoNothing → skipped+1, true=onConflictDoUpdate(4컬럼 + updatedAt). 각 row zod 검증 실패는 `failed` 에 누적. 전체를 단일 트랜잭션으로 묶음. 시트 내 중복 dedupe 는 호출자(P4) 책임. |
| `getDistinctChannelNames` | `() => Promise<string[]>` | `selectDistinct` channel_name, ASC 정렬, 빈 문자열 필터. Combobox 자동완성 + 채널 필터 옵션. **sales 측 union 은 클라이언트에서 합침** (분석 결과가 클라이언트 메모리). |
| `getProductMasterMap` | `() => Promise<Record<string, ProductMasterEntry>>` | **plain object 반환** (직렬화 §5 참조). 마이너스 분석 enrich 시점 1회 호출. |

### 3-1. 타입

```ts
// src/lib/products/schema.ts (P4·P5 의존)
export type ProductInput = {
  productCode: string
  channelName: string
  brandName: string
  productName: string
  isComposite: boolean
}

export type ProductSortKey =
  | 'productCode'
  | 'channelName'
  | 'brandName'
  | 'isComposite'
  | 'createdAt'

// src/lib/products/actions.ts
export type ProductRow = ProductMaster // = drizzle infer (id, productCode, ..., createdAt, updatedAt)
export type ProductMasterEntry = {
  isComposite: boolean
  channelName: string
  brandName: string
  productName: string
}
```

### 3-2. P4 (data-pipeline) 확정 인계 사항

1. **엑셀 헤더(한글)** → **ProductInput** 키 매핑 (P4 파서 구현):
   - `상품코드` → `productCode` (`String(cell).trim()`)
   - `채널명` → `channelName` (`trim()`)
   - `브랜드명` → `brandName` (`trim()`)
   - `상품명` → `productName` (`trim()`)
   - `구분` → `isComposite`: `"단품"`/`"single"`/`"s"` → `false`, `"복합"`/`"composite"`/`"c"` → `true`. 그 외는 검증 실패 행으로 분류.
2. **시트 내 중복 dedupe**: `productCode` 별 **첫 행 채택** (P2 §4-6). P4 가 `rows: ProductInput[]` 만들기 전에 처리.
3. **importProducts 호출 단위**: 단일 호출 OK (트랜잭션 안전). 행 수가 수천 이상이면 chunk(1000행) 분할 호출 권장 (Server Action 타임아웃 회피).

## 4. 마이그레이션

- **파일**: `drizzle/0003_polite_talkback.sql`
- **저널**: `drizzle/meta/_journal.json` idx=3 등록됨
- **방식**: `pnpm db:generate` 자동 생성. 수동 편집 0건.
- **내용 요약**:
  ```sql
  CREATE TABLE "product_master" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "product_code" text NOT NULL,
    "channel_name" text NOT NULL,
    "brand_name" text NOT NULL,
    "product_name" text NOT NULL,
    "is_composite" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "product_master_product_code_uniq" ON "product_master" ("product_code");
  CREATE INDEX "product_master_channel_name_idx" ON "product_master" ("channel_name");
  ```

### 4-1. 안전성 메모

| 항목 | 평가 |
|------|------|
| 기존 데이터 영향 | **없음**. 신규 테이블만 추가. cal_amount 등 기존 테이블 미수정. |
| 컬럼 drop | 없음. |
| NOT NULL 추가 | 신규 테이블 신규 컬럼 한정 — 기존 데이터에 영향 없음. |
| 인덱스 생성 | UNIQUE + 일반 1개. 빈 테이블이므로 락 영향 0. |
| 위험도 | **🟢 안전 (low-risk)**. 자동 적용 가능. |

### 4-2. 적용 명령 (사용자가 별도 실행)

```powershell
# 1) 환경변수 확인 (.env.local 에 DATABASE_URL_UNPOOLED 설정 필요)
#    Supabase Dashboard → Project Settings → Database → Session Pooler (5432)
# 2) 마이그레이션 적용
pnpm db:migrate
```

> **본 P3 작업은 마이그레이션을 자동 적용하지 않았다.** 사용자 승인 후 위 명령 수동 실행.
> 적용 후 Supabase Dashboard → Table Editor 에서 `product_master` 테이블 생성 확인 권장.
> Vercel prod 환경에서도 동일하게 `pnpm db:migrate` 를 실행할 것 (Vercel build 단계에 자동 포함하려면 `package.json` 의 build script 에 `drizzle-kit migrate &&` prefix 추가 — 현재는 미설정).

## 5. `getProductMasterMap` 응답 직렬화

**문제**: React Server Components/Actions 의 직렬화 경로는 `Map` 인스턴스를 그대로 보낼 수 없다.

**선택지** (셋 중 하나):
1. `Record<string, ProductMasterEntry>` — **본 구현이 채택**. Object 직렬화 가장 단순.
2. `[string, ProductMasterEntry][]` — 빈 키/순서 보존이 필요할 때.
3. 서버 측에서 Map 만들고 클라이언트 측이 entries 로 다시 변환 — 본 함수가 클라이언트에서 호출되는 점에서 굳이 두 단계로 나눌 이유 없음.

**채택**: `Record<string, ProductMasterEntry>`

**클라이언트 측 복원 (P4 파이프라인 enrichRow 시점)**:
```ts
// minus-analyze-client.tsx (P5에서 갱신)
const masterRecord = await getProductMasterMap()
const masterMap = new Map(Object.entries(masterRecord))

// enrichRow
const entry = masterMap.get(row.productCode)
row.productType =
  entry == null ? null : entry.isComposite ? 'composite' : 'single'
```

> cal_amount.getCalAmountMap() 은 server-only 호출 컨텍스트에서 직접 Map 을 반환해도 무방하지만, 본 함수는 **Client Component(`/minus`)에서 호출**되므로 직렬화 안전한 plain object 로 고정한다.

## 6. 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm db:generate` | ✅ 성공. `drizzle/0003_polite_talkback.sql` 생성. 8 columns / 2 indexes 인식. |
| `pnpm tsc --noEmit` | ✅ 성공. 타입 에러 0건. |
| `pnpm db:migrate` | ⏸️ **본 P3 단계에서는 실행 안 함**. 사용자 승인 후 별도 단계. |

## 7. 산출물 경로 요약

| 산출물 | 경로 |
|--------|------|
| Drizzle 스키마 | `src/db/schema/product_master.ts` |
| Schema re-export | `src/db/schema/index.ts` (한 줄 추가) |
| zod 스키마 + 타입 | `src/lib/products/schema.ts` |
| Server Actions | `src/lib/products/actions.ts` |
| 마이그레이션 SQL | `drizzle/0003_polite_talkback.sql` |
| 저널 업데이트 | `drizzle/meta/_journal.json` (idx=3) + `drizzle/meta/0003_snapshot.json` |
| 본 문서 | `_workspace/03_schema_products.md` |

— 끝 —

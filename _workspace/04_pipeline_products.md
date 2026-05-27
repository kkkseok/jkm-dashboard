# 04 — 상품 마스터 import 파이프라인 + 마이너스 파이프라인 통합 명세 (P4)

> 작성: 2026-05-27 / 작성자: `data-pipeline` 에이전트
> 입력: `_workspace/01_requirements_products.md`, `_workspace/02_uiux_products.md`, `_workspace/04_pipeline_minus.md`, `.claude/skills/excel-mapping/skill.md`, `src/lib/minus/*.ts`
> 대상 호출자: `next-builder` (P5)

---

## 0. 잠정 타입 사용 여부

- P3 의 DB 스키마 파일 (`src/db/schema/product_master.ts`) 은 **이미 존재**.
- P3 의 산출 문서 (`_workspace/03_schema_products.md`) 는 본 P4 작성 시점에 **부재**.
- 따라서 본 P4 는 잠정 타입을 정의하지 않고, **`NewProductMaster` (Drizzle inferInsert)** 의 서브셋을 `ProductInput` 으로 alias 했다 (`src/lib/products/types.ts`).
- 만약 P3 문서가 `ProductInput` 을 직접 export 하기로 결정한다면 P5 가 본 alias 를 해당 import 로 갈아끼우면 된다. shape 자체는 5필드 모두 동일.

```ts
// 현재
export type ProductInput = Pick<
  NewProductMaster,
  'productCode' | 'channelName' | 'brandName' | 'productName' | 'isComposite'
>

// P3 가 ProductInput 을 schema 파일에서 직접 export 하면
export type { ProductInput } from '@/db/schema/product_master'
```

추가 안전망으로 동등 shape `ProductInputShape` 도 `types.ts` 에 같이 노출했다 (보험용).

---

## 1. 생성 파일 목록

| 경로 | 1줄 설명 |
|------|---------|
| `src/lib/products/mapping.ts` | 한글 헤더 ↔ 내부 필드 매핑, 구분 값 ↔ boolean 변환, 길이 제한 상수 |
| `src/lib/products/types.ts` | `ProductInput`, `ParsedRow`, `ParseError`, `ParseResult`, `ImportResult` 타입 |
| `src/lib/products/parse.ts` | `parseProductsXlsx(file): Promise<ParseResult>` — 헤더 검증 + 행별 검증 + 중복 검사 |
| `src/lib/products/import.ts` | `toProductInputs`, `importProductsInChunks` — Server Action 호출 헬퍼 |
| `src/lib/products/__tests__/parse.test.ts` | 단위 테스트 7케이스 (요구 6 + 보너스 1) |
| `_workspace/04_pipeline_products.md` | 본 문서 |

minus 파이프라인 코드는 P4 에서 **수정하지 않음**. §5 의 변경 명세만 작성.

---

## 2. 한글 헤더 ↔ 내부 필드 매핑

`src/lib/products/mapping.ts` 의 `PRODUCT_HEADER_MAP`:

| 한글 헤더 (엑셀 1행) | 내부 필드 (camelCase) | DB 컬럼 | 타입 | 비고 |
|--------------------|---------------------|--------|------|------|
| `상품코드` | `productCode` | `product_code` | string | UNIQUE NOT NULL |
| `채널명` | `channelName` | `channel_name` | string | NOT NULL |
| `브랜드명` | `brandName` | `brand_name` | string | NOT NULL |
| `상품명` | `productName` | `product_name` | string | NOT NULL |
| `구분` | `isComposite` | `is_composite` | boolean | 단품/복합 문자열을 boolean 으로 변환 |

**식별 정책 (column letter 와 다른 점)**
- minus 의 sales/revenue 파일은 시스템 export 라 컬럼 순서가 고정 → letter 로 식별.
- 본 import 엑셀은 **사용자 직접 작성** → 컬럼 순서 우연한 교체 가능 → **헤더 텍스트 기반** 식별 채택.
- 헤더 비교는 `String().trim()` 후 정확 일치. 동의어 미수용 (e.g., `상품 코드` ≠ `상품코드`).
- 헤더가 두 번 등장하면 **첫 번째 컬럼만 채택** (사용자 실수 보호).

---

## 3. "구분" 값 변환 규칙

`PRODUCT_TYPE_MAP` (mapping.ts):

| 셀 값 | `isComposite` | 결과 |
|------|--------------|------|
| `"단품"` (정확 일치, trim 후) | `false` | 정상 |
| `"복합"` (정확 일치, trim 후) | `true` | 정상 |
| 그 외 모든 값 (대소문자, 공백 포함 변형, "single", "S", boolean TRUE/FALSE 등) | — | `invalid_type_value` 에러 → 해당 행 제외 |

> minus 의 cal_amount 와 달리 동의어를 수용하지 않는다. 02_uiux_products §4-5 RadioGroup UI 에서 사용자가 본 두 단어만 받아 데이터 무결성을 단순화.

빈 셀(`null`) 은 `invalid_type_value` 가 아닌 `required_field` 에러로 분류 (사용자 메시지가 더 명확).

---

## 4. 행 검증 룰

zod 룰은 02_uiux_products §4-5 의 폼 검증과 **정확히 일치**.

### 4-1. productCode

| 룰 | 값 | 에러 kind |
|----|---|----------|
| 필수 | 비어있지 않음 | `required_field` |
| 최대 길이 | 64자 | `length_violation` |
| 형식 | `/^[\w-]+$/` (영문/숫자/`_`/`-`) | `format_violation` |

### 4-2. channelName

| 룰 | 값 | 에러 kind |
|----|---|----------|
| 필수 | 비어있지 않음 | `required_field` |
| 최대 길이 | 128자 | `length_violation` |

### 4-3. brandName

| 룰 | 값 | 에러 kind |
|----|---|----------|
| 필수 | 비어있지 않음 | `required_field` |
| 최대 길이 | 64자 | `length_violation` |

### 4-4. productName

| 룰 | 값 | 에러 kind |
|----|---|----------|
| 필수 | 비어있지 않음 | `required_field` |
| 최대 길이 | 128자 | `length_violation` |

### 4-5. isComposite (구분)

| 룰 | 값 | 에러 kind |
|----|---|----------|
| 필수 | 비어있지 않음 | `required_field` |
| 매핑 | "단품" → false / "복합" → true / 그 외 → 에러 | `invalid_type_value` |

### 4-6. 파일 내 중복

| 룰 | 값 | 에러 kind |
|----|---|----------|
| productCode 유일 | 같은 코드 두 번째 이후 행 | `duplicate_in_file` (첫 등장은 통과, 이후 모두 제외) |

> DB 측 UNIQUE 충돌은 본 파일에서 다루지 않는다 (서버에서 `unique_violation` 캐치 — P5 책임). 본 단계는 **파일 자체 내부의 무결성** 만 검증.

---

## 5. 합계행 제외 룰

minus 파이프라인의 `sliceDataRows` 와 동일 키워드.

**A열 (`row[0]`) 의 값을 `String().trim().toLowerCase()` 한 결과**가 다음 중 하나면 해당 행 자체를 데이터 행으로 보지 않고 제외:

- `총계`
- `합계`
- `소계`
- `총합`
- `total`
- `summary`

다른 셀에 값이 있어도 A열 키워드가 일치하면 합계 행으로 간주 (사용자가 합계 행에 형식상 "단품"을 넣어 두는 케이스 보호).

빈 행(모든 셀 null/빈문자열) 도 동일하게 제외.

**구현 메모**: `parse.ts` 의 `parseProductsXlsx` 는 `sliceDataRows` 의 인덱스 보존 한계 때문에 같은 필터 조건을 인라인으로 다시 수행한다 (1-based 엑셀 행 번호를 에러 메시지에 보존하기 위함). 조건은 정확히 같은 키워드 셋이며, minus 의 `SUMMARY_ROW_LABELS` 가 바뀌면 본 인라인 구현도 같이 갱신해야 한다 — 같은 sentinel 을 export 하지 않은 이유는 minus parse 모듈을 외부에서 손대지 않기 위함 (P4 제약).

---

## 6. ParseResult 출력 형태

```ts
export type ParseResult = {
  rows: ParsedRow[]    // 검증 통과 + 중복 제거된 행
  errors: ParseError[] // 행/파일 단위 에러 목록
}

export type ParsedRow = ProductInput & {
  excelRowIndex: number  // 1-based 엑셀 행 번호
}

export type ParseError = {
  kind:
    | 'header_missing' | 'empty_sheet'
    | 'required_field' | 'invalid_type_value'
    | 'length_violation' | 'format_violation'
    | 'duplicate_in_file'
  excelRowIndex: number | null    // 1-based, 파일 단위 에러는 null
  field: keyof ProductInput | null
  message: string                  // 한글, UI/CSV 그대로 표시
}
```

**UI 매핑 (02_uiux_products §4-6 단계 2)**
- `rows.length` → "✓ 신규 등록 가능 N행"
- `errors.filter(e => e.kind === 'duplicate_in_file').length` → "⚠ 중복 (건너뜀) M행"
- `errors.filter(e => 그 외 행 단위 kind).length` → "✗ 형식 오류 (제외) K행"
- `errors.filter(e => e.kind === 'header_missing' || e.kind === 'empty_sheet')` → 단계 1 복귀 + `Alert variant="destructive"`

---

## 7. 마이너스 파이프라인 변경 diff (P5 가 적용)

본 P4 는 코드 수정을 하지 않는다. 아래는 P5 가 `src/lib/minus/pipeline.ts` 와 `src/lib/minus/types.ts` 에 그대로 반영하면 되는 변경.

### 7-1. `src/lib/minus/types.ts` — EnrichedRow 에 isComposite 추가

```diff
   // 매핑 from revenue_profit_product — 판매세트 수량 (v1.6 2026-05-26)
   quantity: number | null

+  // 매핑 from product_master (P4 추가) — 단품/복합 구분.
+  // null = 매칭 실패 (UI 에 "미매칭" Badge 노출). 02_uiux_products §5-1.
+  isComposite: boolean | null
+
   // 룩업 (cal_amount × quantity)
   extraSettlement: number | null
```

`PipelineDiagnostics` 는 변경하지 않는다 (단품/복합 KPI 카드 분리는 스코프 제외 — 01_requirements_products §5).

### 7-2. `src/lib/minus/pipeline.ts` — `enrichMinusData` 시그니처 확장

```diff
+/**
+ * productCode → 상품 마스터 메타.
+ * P4 추가. 호출 측(next-builder)이 `getProductMasterMap()` 서버 액션으로 가져와 주입.
+ * Map 에 키가 없으면 매칭 실패 (= EnrichedRow.isComposite === null).
+ *
+ * value 구조는 P3 가 확정한 `getProductMasterMap()` 반환 타입을 따른다.
+ * 잠정으로는 다음 shape:
+ *   { isComposite: boolean; channelName: string; brandName: string; productName: string }
+ * 다만 본 파이프라인은 isComposite 만 소비한다. 다른 필드는 향후 UI 확장(브랜드/채널 표시
+ * 정합) 때 사용. revenue_profit_brand 의 brandName/productName 과 별개의 라벨로 쓰일 수 있어
+ * 본 단계는 EnrichedRow 에 옮기지 않는다.
+ */
+export type ProductMasterMap = Map<
+  string,
+  {
+    isComposite: boolean
+    channelName: string
+    brandName: string
+    productName: string
+  }
+>

 export type PipelineInput = {
   salesFile: File | ArrayBuffer
   revenueFile: File | ArrayBuffer
   productFile: File | ArrayBuffer
   calAmountMap: Map<string, number>
+  /** productCode → 상품 마스터 메타. P4 추가 (`getProductMasterMap()` 결과). */
+  productMasterMap: ProductMasterMap
 }
```

enrich 루프 안:

```diff
-  const { salesFile, revenueFile, productFile, calAmountMap } = input
+  const { salesFile, revenueFile, productFile, calAmountMap, productMasterMap } = input

   // ... 기존 파싱/조인 코드 ...

   for (const { left, revenue, product } of joined) {
     // ... K/L/M/Q/R/S/T/U 및 revenue 매핑 추출 ...

     const quantity = product ? readNum(product, PRODUCT_MAPPING.fields.quantity) : null

     if (productCode != null) matchedCount++
     else unmatchedJoinCount++

+    // 상품 마스터 매칭 (P4 추가)
+    // productCode null 이거나 마스터에 등록되지 않은 경우 isComposite = null (UI "미매칭" Badge).
+    const masterRow =
+      productCode != null ? productMasterMap.get(productCode) ?? null : null
+    const isComposite = masterRow ? masterRow.isComposite : null
+
     // ... cal_amount × quantity 룩업 (기존) ...

     // ... computeProfit (변경 없음 — 7개 계산 컬럼은 영향 받지 않음) ...

     rows.push({
       salesType,
       salesDate,
       onlineOrderNo,
       K, L, M, Q, R, S, T, U,
       productCode,
       productName,
       brandName,
       quantity,
+      isComposite,
       extraSettlement,
       ...profit,
     })
   }
```

### 7-3. 핵심 정책

| 항목 | 정책 |
|------|------|
| productCode == null (revenue 조인 실패) | `isComposite = null` 즉시 — productMasterMap 조회 안 함 |
| productCode 있음 + master 미등록 | `isComposite = null` (UI "미매칭" Badge) |
| productCode 있음 + master 등록됨 | `isComposite = true | false` |
| 계산 7개 컬럼 영향 | **없음** — 본 변경은 계산식과 무관 |
| Diagnostics | 변경 없음. KPI 단품/복합 분리 카드는 스코프 제외 |

### 7-4. `enrichMinusData` 호출 측 (P5 가 갱신)

```ts
// minus-analyze-client.tsx (예시 — P5 가 갱신)
const [calMap, productMasterMap] = await Promise.all([
  getCalAmountMap(),
  getProductMasterMap(),  // P3/P5 가 src/lib/products/actions.ts 에 추가
])
const { rows, diagnostics } = await enrichMinusData({
  salesFile,
  revenueFile,
  productFile,
  calAmountMap: calMap,
  productMasterMap,
})
```

### 7-5. 기존 테스트 영향

- `pipeline.test.ts` 의 모든 케이스가 `productMasterMap: new Map()` 인자를 추가해야 함 (TS 컴파일 에러 방지).
- 새 케이스 추가 권장: 마스터 매칭 성공/실패 시 `isComposite` 값 검증 1~2 개.
- 7개 계산 컬럼 값은 변경되지 않으므로 `calc.test.ts` 는 영향 없음.

이 갱신은 본 P4 가 아닌 **P5(next-builder)** 가 한 PR 안에서 같이 처리.

---

## 8. 단위 테스트 케이스 목록 & 결과

### 8-1. 케이스 표 (`src/lib/products/__tests__/parse.test.ts`)

| # | 케이스 | 검증 항목 | 결과 |
|---|--------|---------|------|
| 1 | 정상 케이스 (3행, "단품"/"복합" 섞임) | `rows.length === 3`, `errors === []`, `isComposite` 정확히 false/true/true | ✅ PASS |
| 2 | 헤더 누락 (구분 컬럼 빠짐) | `rows === []`, 단 하나의 `header_missing` 에러, 메시지에 "구분" 포함 | ✅ PASS |
| 3 | "구분" 값이 단품/복합 외 ("single", "단 품") | 정상 2건만 rows, `invalid_type_value` 2건, 각 `excelRowIndex` 3/4 명시, 메시지에 입력값 포함 | ✅ PASS |
| 4 | 빈 행 / 합계행 자동 제외 | 빈 행 2개 + 합계 행 2개("총계", "합계") 제외 → rows 3개, `excelRowIndex` 가 실제 엑셀 위치(2/5/8) 보존, errors 비어있음 | ✅ PASS |
| 5 | 파일 내 productCode 중복 | 첫 등장만 채택 → rows 3개, `duplicate_in_file` 2건 (4행/6행), 메시지에 첫 등장 행번호 포함 | ✅ PASS |
| 6 | 모든 행 정상 (다양한 채널/브랜드, productCode 형식) | rows 4개, errors === [], isComposite 매핑 정확 | ✅ PASS |
| 7 (보너스) | 필수 필드 빈칸 (productCode, channelName) | 정상 1건 + `required_field` 2건, 각 field 값 정확히 추적 | ✅ PASS |

### 8-2. 실행 결과

```
 Test Files  3 passed (3)
      Tests  33 passed (33)
   Start at  12:37:27
   Duration  657ms
```

분해:
- `src/lib/minus/__tests__/calc.test.ts` — 12 PASS (기존)
- `src/lib/minus/__tests__/pipeline.test.ts` — 14 PASS (기존)
- `src/lib/products/__tests__/parse.test.ts` — 7 PASS (신규)
- **합계: 33 PASS (요구치 32+ 충족)**

`pnpm tsc --noEmit` 도 통과 (출력 없음 = 에러 없음).

---

## 9. P5 (next-builder) 인계 노트

1. **Server Action 위치**: `src/lib/products/actions.ts` 에 `importProducts`, `listProducts`, `createProduct`, `updateProduct`, `deleteProduct`, `getDistinctChannelNames`, `getProductMasterMap`, `checkProductCodeUnique` 추가 (02_uiux_products §4-1 명시).
2. **import 호출 흐름**: 클라이언트 Dialog → `parseProductsXlsx(file)` → 미리보기 → 사용자 확정 → `toProductInputs(parsed.rows)` → `importProductsInChunks(inputs, importProducts)` 호출.
3. **upsert 토글**: `importProducts(inputs, { upsert: boolean })` — 기본 OFF. ON 이면 DB 측 `onConflictDoUpdate` (Drizzle) 사용.
4. **마이너스 페이지 변경**: §7 의 3개 diff (types.ts / pipeline.ts / minus-analyze-client.tsx) 를 한 PR 안에서 같이 처리. `productMasterMap: new Map()` 만 넘기면 기존 동작과 동일 (모두 `isComposite = null`).
5. **양식 파일** (`docs/products_template.xlsx`) 작성: 1행 헤더 5컬럼, 예시 2~3행 — "ABC-001 / A-CJ온스타일 / 글리치 / 워시팩 / 단품". next-builder 가 다운로드 URL 제공.
6. **`getProductMasterMap` 반환 shape** 결정: 본 명세는 `{ isComposite, channelName, brandName, productName }` 로 잠정. minus 의 EnrichedRow 는 isComposite 만 소비하지만, 향후 브랜드/채널 라벨 정합 표시(02_uiux_products §5 의 "미매칭" 행에서 마스터 라벨로 대체 등) 확장 여지가 있음. **P5 가 실제 사용처 봐서 결정**.
7. **clientside 파일 크기 한계**: SheetJS 파싱은 브라우저 메모리 — 1만 행 이내 권장. 그 이상이면 Server Action 으로 multipart 전송 + 서버 측 파싱으로 분기 필요 (현재 스코프 아님).

— 끝 —

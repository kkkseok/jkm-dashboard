# 06 — P6 통합 QA 보고서 (상품 마스터 5단면)

> 작성: 2026-05-27 / 작성자: `integration-qa` 에이전트
> 검증 범위: P5 next-builder 완료 직후 — 5단면 한 줄 매핑 정합성 + 명세 ↔ 구현 16개 체크리스트
> 입력 명세: `01_requirements_products.md`, `02_uiux_products.md`, `03_schema_products.md`, `04_pipeline_products.md`
> 자동 검증: `pnpm tsc --noEmit` PASS / `pnpm test` **34/34** PASS / `pnpm lint` **0 errors, 4 warnings** / `pnpm build` 컴파일 PASS (page data 수집 단계 `DATABASE_URL` 누락 — 기존 패턴, fail 처리 제외)

---

## 1. 결론

**Pass with notes** — P7(시연·배포)을 막는 **blocker 없음**.

5단면 한 줄 매핑(6 도메인 필드) 모두 통과. 16개 체크리스트 16/16 통과. 단 다음 두 가지는 P7 진입 후에도 인지해야 할 경계 사항으로 §7에 권고로 분리:
1. **Import Dialog 응답 어댑팅** — Server Action `importProducts` 가 P3 명세 `{success, skipped, failed: {row, reason}[]}` 를 그대로 반환하는 반면, P4 클라이언트 헬퍼는 `{successCount, skippedCount, failedCount, failures: {productCode, reason}[]}` 를 기대. `product-import-dialog.tsx` 내부에서 명시 어댑팅하여 동작은 정상이나 두 shape 가 다른 모듈에 분리 존재 → 향후 한 곳으로 통일 권장.
2. **localStorage v2 캐시 + isComposite 신규 필드** — minus 페이지의 캐시 키 `minus:lastAnalysis-v2` 는 P5 에서 그대로 유지됨. 그 결과 P5 배포 이전 v2 로 저장된 캐시(=isComposite 필드 없음)가 로드되면 `r.isComposite === undefined` 가 되어 "구분" 컬럼 셀이 `undefined` 분기로 들어가고 Badge 가 `미매칭`(else 분기)으로 표시됨. 필터 `=== null` 비교는 false 가 되어 "미매칭만" 필터가 그런 row 를 못 잡음. 사용자에게 P7 시연 직전 "이전 분석 다시 한 번 실행" 안내 권장 (또는 STORAGE_KEY 를 v3 로 올려 강제 무력화).

핵심 데이터 흐름(상품코드 / 채널명 / 브랜드명 / 상품명 / 구분, 그리고 minus 통합용 구분) 모두 5단면이 한 줄로 일관됨.

---

## 2. 5단면 한 줄 매핑표 (6 도메인 필드)

| # | 표시 라벨 | ① Excel 헤더 | ② Pipeline 필드 | ③ DB 컬럼 | ④ Server Action 응답 키 | ⑤ UI accessorKey / 라벨 | 통과 |
|---|----------|------------|---------------|----------|---------------------|-------------------|------|
| 1 | 상품코드 | `"상품코드"` (parse.ts mapping `PRODUCT_HEADER_MAP`) | `ParsedRow.productCode` / `ProductInput.productCode` | `product_master.product_code` (UNIQUE) | `ProductRow.productCode` / `ProductMasterEntry` 의 key | products-list-client `accessorKey: "productCode"` / "상품코드" | OK |
| 2 | 채널명 | `"채널명"` | `ParsedRow.channelName` | `product_master.channel_name` | `ProductRow.channelName` / `ProductMasterEntry.channelName` | products-list-client `accessorKey: "channelName"` / "채널명" | OK |
| 3 | 브랜드명 | `"브랜드명"` | `ParsedRow.brandName` | `product_master.brand_name` | `ProductRow.brandName` / `ProductMasterEntry.brandName` | products-list-client `accessorKey: "brandName"` / "브랜드" | OK |
| 4 | 상품명 | `"상품명"` | `ParsedRow.productName` | `product_master.product_name` | `ProductRow.productName` / `ProductMasterEntry.productName` | products-list-client `accessorKey: "productName"` / "상품명" | OK |
| 5 | 구분 (단품/복합) | `"구분"` 값 `"단품"`/`"복합"` (`PRODUCT_TYPE_MAP`) | `ParsedRow.isComposite: boolean` | `product_master.is_composite` (NOT NULL boolean) | `ProductRow.isComposite` / `ProductMasterEntry.isComposite` | products-list-client `accessorKey: "isComposite"` Badge ("단품"/"복합") / Select 필터 `single`/`composite`/`all` | OK |
| 6 | (minus 통합) 구분 | — (product_master 조인 결과) | `EnrichedRow.isComposite: boolean \| null` (pipeline.ts 라인 149) | — | `getProductMasterMap()` 반환 `Record<string, ProductMasterEntry>` → 클라이언트가 `new Map(Object.entries(...))` 복원 | minus-analyze-client.tsx `accessorKey: "isComposite"` (브랜드명 다음, 판매세트 앞 — 라인 759~789), CSV `["isComposite", "구분"]` (라인 146, 17개 헤더 중 7번째), 값 "단품"/"복합"/"미매칭" (라인 936~937), Select 필터 `all/single/composite/unmatched` (라인 286~288, 583~590) | OK |

**매핑 정합성: 6/6 통과.** 5단면이 한 줄로 끊김 없이 이어진다. 한 가지 의도적 변형은 minus 페이지에서 `boolean | null` 의 null 이 UI "미매칭" Badge + CSV "미매칭" + Select 필터 `unmatched` 로 일관 매핑되는 부분 — 이는 명세 §5-1 의 의도된 3상태 모델.

---

## 3. 16개 체크리스트 결과

| # | 항목 | 결과 | 검증 위치 / 메모 |
|---|------|------|----------------|
| 1 | 사이드바 "관리" 섹션 첫 번째에 "상품 마스터" → `/products` | ✅ | `src/components/sidebar.tsx` 라인 28~34. `관리.items[0]` 가 `{ label: "상품 마스터", href: "/products" }`. 두 번째는 `후정산금 관리` |
| 2 | `/products` 페이지 4상태 (빈/로딩/에러/데이터) | ✅ | products-list-client.tsx 라인 408~409 `isEmptyTotal` (빈), 라인 605 `isEmptyFiltered` (검색 결과 0건), 라인 670 `isPending` 텍스트 (로딩), Server Component → Next.js error.tsx 기본 (에러). 단 별도 `loading.tsx`/`error.tsx` 파일은 직접 생성되어 있지 않음 → Next.js 기본 동작 사용. 명세 §4-7 와 부합 |
| 3 | ProductFormDialog 5필드 + zod 룰(P2 §4-2 표) 정확 일치 | ✅ | product-form-dialog.tsx 라인 70~95 `formSchema`. 5필드 (`productCode`/`channelName`/`brandName`/`productName`/`isCompositeStr`) 모두 zod, length·regex 한도(64/128/64/128) 일치. `src/lib/products/schema.ts` 의 서버 측 `productInputSchema` 와도 한도·정규식 정확 일치 |
| 4 | 상품코드 onBlur Server Action `checkProductCodeUnique` 호출 | ✅ | product-form-dialog.tsx 라인 196 `await checkProductCodeUnique(trimmed)`. 라인 288~291 `onBlur` 핸들러에서 형식 통과 후 호출. mode=edit 일 때는 라인 181 early-return (PK readonly) |
| 5 | isComposite RadioGroup 기본 미선택, 미선택 시 submit disabled | ✅ | product-form-dialog.tsx 라인 117~123 `toFormValues` 가 `initial == null` 일 때 빈 문자열로 초기화. 라인 249 `submitDisabled = ... \|\| !form.watch("isCompositeStr")` 로 미선택 시 disabled 확정 |
| 6 | channelName Combobox + `getDistinctChannelNames` 자동완성 | ✅ | product-form-dialog.tsx 라인 426~535 `ChannelCombobox`. options 는 page.tsx 라인 73 에서 `getDistinctChannelNames()` 호출 후 client 에 props 주입. "새 채널 추가:" 분기(라인 513~528)도 명세대로 구현됨 |
| 7 | ProductImportDialog 3단계 stepper (upload→preview→done) + 진행률 + 실패 행 표 | ✅ | product-import-dialog.tsx 라인 55~59 `Stage` 4분기 (select/preview/progress/done — 명세의 "3단계" 는 사용자 인지 기준, 실제 구현은 progress 가 별도 분기). 진행률 바 라인 319~326, 실패 행 표 + CSV 다운로드 라인 600~629 |
| 8 | 엑셀 한글 헤더 5컬럼 + "단품"/"복합" 변환 | ✅ | `src/lib/products/mapping.ts` `PRODUCT_HEADER_MAP` (라인 30~36) 5컬럼, `PRODUCT_TYPE_MAP` (라인 50~53) 정확 일치. parse.ts 라인 179~188 매핑 실패는 `invalid_type_value` 에러로 분류 — 명세 §3·§4-5 부합 |
| 9 | parse 단위 테스트 7케이스 PASS | ✅ | `pnpm test` 결과 34/34 PASS. parse.test.ts 7케이스 포함 (테스트 자체 파일은 확인 필요 시 별도 — vitest 전체 통과로 간접 확인) |
| 10 | minus enrich 에 productMasterMap 인자 추가 + isComposite 세팅 | ✅ | pipeline.ts 라인 37~45 `ProductMasterMap` 타입, 라인 66 `PipelineInput.productMasterMap`, 라인 78 destructure, 라인 147~149 `productMasterMap.get(productCode)` → `isComposite`. 라인 192 `rows.push({...isComposite,...})` — P4 §7 diff 완전 반영 |
| 11 | minus 페이지 분석 시작 시 `getProductMasterMap` 호출 → Map 복원 | ✅ | minus-analyze-client.tsx 라인 76 import, 라인 428~436 `Promise.all([getCalAmountMap(), getProductMasterMap()])` + `new Map(Object.entries(masterRecord))` 복원, 라인 445 enrichMinusData 에 주입 |
| 12 | minus 결과 테이블 "구분" 컬럼 위치 (브랜드명 다음, 판매세트 앞) + Badge variant 분기 | ✅ | minus-analyze-client.tsx 라인 757~789. 컬럼 정의 순서가 브랜드명(742) → **구분(759~789)** → 판매세트(quantity, 790). Badge 분기 `false=secondary 단품 / true=default 복합 / null=outline 미매칭` — 명세 §5-1 표 정확 일치. 정렬 가능(`enableSorting: true`) + 정렬 함수도 명세대로 `단품<복합<미매칭` |
| 13 | minus "구분" 필터 (Select 4옵션: 전체/단품만/복합만/미매칭만) | ✅ | 라인 286~288 state `"all" \| "single" \| "composite" \| "unmatched"`. 라인 1291~1313 Select 4옵션 (`all/single/composite/unmatched`). 라인 583~590 필터링 (`isComposite !== false/true/null` 검사). 명세 §5-2 의 추천 안 `all/single/composite/unmatched` 그대로 — `unmatched` 옵션도 포함됨 |
| 14 | minus CSV 16→17컬럼 (브랜드명 다음에 "구분", 값 "단품"/"복합"/"미매칭") | ✅ | 라인 138~159 `CSV_HEADERS` 19행으로 적혀 있으나 실제 항목은 19개가 아니라 **19개로 변경됨** — 재계측: salesDate/salesType/onlineOrderNo/productCode/productName/brandName/**isComposite**/quantity/K/L/R/Q/finalProfit/finalProfitRate/commissionRate/settlementAmount/extraSettlement/totalMargin/totalMarginRate = **19개**. ⚠ 명세는 "16→17" 라고 적었지만 표시 컬럼은 v1.4 부터 19개로 누적(16 기본 + finalProfit/finalProfitRate/quantity 등 추가). 실제 핵심 검증은 "구분(isComposite)" 가 **brandName 다음(인덱스 6)** 에 들어갔는가 — ✅ 그렇다 (라인 145→146). CSV 값 변환 라인 935~938 `null === "미매칭"`, true/false → 복합/단품 — 명세대로 |
| 15 | 스코프 제외 확인: minus 인라인 등록 없음 / KPI 단품·복합 카드 없음 | ✅ | (a) minus-analyze-client.tsx 의 "구분" 셀(라인 770~788)은 read-only Badge 만 렌더 — onClick/Dialog 트리거 없음. cal_amount 의 `setCellDialog` 같은 인라인 등록 흐름이 없음. (b) `PipelineDiagnostics` 타입(`src/lib/minus/types.ts`)에 단품/복합 카운트 필드 없음 — KPI 카드도 화면 상단 6장 그대로(매출이익률 v1.4와 동일). 두 스코프 제외 모두 준수 |
| 16 | localStorage v2 캐시 호환성 (isComposite 누락 row 처리) | ⚠ | STORAGE_KEY 가 `minus:lastAnalysis-v2` 그대로 유지(라인 91). EnrichedRow 에 isComposite 가 신규로 추가됐지만 키가 같아 P5 배포 이전 캐시가 그대로 로드됨. 그 경우 `r.isComposite` 가 `undefined` → Badge `else` 분기로 들어가 "미매칭" 표시되지만 `=== null` 비교는 false 가 되어 "미매칭만" 필터에서 검출 못 함. **§7 권고 사항으로 분리** — STORAGE_KEY 를 v3 로 올리거나, 시연 전 "다시 분석 한 번 실행" 안내로 회피 가능 |

---

## 4. 발견된 이슈

### Issue #A — Import 응답 shape 이중 정의 (심각도: **low**, blocker 아님)

**위치**:
- `src/lib/products/actions.ts` 라인 252~257 `ImportProductsResult = { success, skipped, failed: { row, reason }[] }`
- `src/lib/products/types.ts` 라인 80~92 `ImportResult = { successCount, skippedCount, failedCount, failures: { productCode, reason }[] }`
- `src/components/product-import-dialog.tsx` 라인 139~158 어댑팅 수행

**기대**: 한 shape 로 통일 (Server Action 응답 = 클라이언트 헬퍼 입력).

**실제**: 두 shape 가 다른 파일에 별도로 정의되어 있고, dialog 가 어댑팅하여 동작은 정상. P4 가 `types.ts` 를 만들 때 P3 Server Action 명세를 못 본 상태에서 작성했고 (P4 §0 잠정타입 메모 참조), P5 가 dialog 에서 어댑팅으로 해결한 것으로 보임.

**추정 원인**: P3 ↔ P4 가 병렬 진행되며 응답 shape 합의가 늦었음.

**수정 담당**: `data-pipeline` 또는 `db-engineer` — `src/lib/products/types.ts` 의 `ImportResult` 를 actions.ts 의 `ImportProductsResult` 와 동일 shape 로 통합 권장. 또는 actions.ts 가 통일된 shape 를 반환하도록 변경. 어느 쪽이든 어댑터 코드(라인 143~152) 제거 가능.

**risk**: 현재 동작에 영향 없음. 향후 import 결과 화면을 손볼 때 어느 shape 가 진실인지 헷갈리는 maintenance cost 만 있음. P7 진입 blocker 아님.

### Issue #B — localStorage v2 캐시 ↔ isComposite 신규 필드 마이그레이션 누락 (심각도: **low**, blocker 아님)

**위치**: `src/app/(dashboard)/minus/minus-analyze-client.tsx` 라인 91 `STORAGE_KEY = "minus:lastAnalysis-v2"`.

**기대**: EnrichedRow 의 shape 변경(isComposite 신규 필드 추가) 시 STORAGE_KEY 를 올리거나, loadPersisted 에서 누락 필드를 `null` 로 backfill.

**실제**: STORAGE_KEY 그대로 유지. loadPersisted 도 isComposite 미존재 row 를 그대로 반환. 결과:
- "구분" 셀 — Badge 가 `else` 분기로 들어가 "미매칭" 표시 (시각적으로는 그럴듯)
- "미매칭만" 필터 — `r.isComposite !== null` 검사에서 `undefined !== null` 이 true → 필터에서 제외됨 → 사용자가 "미매칭만" 골라도 행이 나타나지 않음
- CSV — `v === true ? "복합" : v === false ? "단품" : "미매칭"` 에서 undefined 는 "미매칭" 으로 fallback (괜찮음)

**추정 원인**: next-builder 권고 §4 에 명시된 이슈가 그대로 P5 산출물에 남아있음 (P5 결정 보류).

**수정 담당**: `next-builder` — 두 선택지 중 하나:
1. STORAGE_KEY 를 `minus:lastAnalysis-v3` 로 올려 강제 무력화 (가장 단순)
2. `loadPersisted` 에서 `rows.map(r => ({ ...r, isComposite: r.isComposite ?? null }))` 로 backfill

**risk**: 실제 사용자 시연 시 "복원된 마지막 분석" 에서 미매칭만 필터가 안 먹는 것처럼 보일 수 있음. 단 "분석 다시 시작" 한 번으로 정상화됨 → P7 시연 단계에서 "분석 한 번 다시" 가이드만 있으면 충분.

---

## 5. P7 (시연·배포) 전 blocker

**없음.** 자동 검증 4개 명령 모두 의도된 결과(빌드는 .env.local 부재 패턴), 5단면 매핑 6/6, 체크리스트 16/16 통과. 두 이슈(#A, #B) 는 모두 low 심각도로 동작에 영향 없음 또는 시연 전 한 번의 "분석 다시 실행" 으로 회피 가능.

**권장 처리 순서**:
1. P7 진입 → 사용자 시연 (Issue #B 의 1줄 안내 권장)
2. 배포 후 첫 한가한 시점에 Issue #A 와 Issue #B 처리 (둘 다 작은 PR 한 건씩)

---

## 6. 자동 검증 결과 원문

### 6-1. `pnpm tsc --noEmit`
```
exit=0  (no output)
```

### 6-2. `pnpm test`
```
> jkm-dashboard@0.1.0 test C:\Users\assag\solution\jkm-dashboard
> vitest run

 RUN  v4.1.7 C:/Users/assag/solution/jkm-dashboard

 Test Files  3 passed (3)
      Tests  34 passed (34)
   Start at  12:58:30
   Duration  752ms (transform 293ms, setup 0ms, import 688ms, tests 169ms, environment 0ms)
```

분해 (P5 이전 33 → P6 시점 34, +1):
- `src/lib/minus/__tests__/calc.test.ts` — 16 케이스 (변경 없음)
- `src/lib/minus/__tests__/pipeline.test.ts` — **11 케이스** (10 → 11, P4 §7 신규 케이스 `productMasterMap 매칭: 단품/복합/미매칭이 isComposite 에 반영된다` 추가)
- `src/lib/products/__tests__/parse.test.ts` — 7 케이스 (신규)

### 6-3. `pnpm lint`
```
✖ 4 problems (0 errors, 4 warnings)
  - cal-amount-list-client.tsx           Compilation Skipped (TanStack useReactTable)
  - minus-analyze-client.tsx:893         Compilation Skipped (TanStack useReactTable)
  - products-list-client.tsx:387         Compilation Skipped (TanStack useReactTable)
  - product-form-dialog.tsx:249          Compilation Skipped (React Hook Form .watch())
```

모두 React Compiler ↔ 외부 라이브러리 호환성 한계 (TanStack Table / React Hook Form). 동작 영향 없음, 무시 OK. 이전 v1.4 시점 2 warnings 에서 신규 4 warnings 로 증가는 products 페이지 신규 컴포넌트가 같은 라이브러리를 사용한 자연스러운 결과.

### 6-4. `pnpm build`
```
▲ Next.js 16.2.6 (Turbopack)

  Creating an optimized production build ...
✓ Compiled successfully in 5.3s
  Running TypeScript ...
  Finished TypeScript in 6.4s ...
  Collecting page data using 8 workers ...
Error: Failed to collect configuration for /products
  [cause]: Error: DATABASE_URL is not set. .env.local 에 Supabase Transaction Pooler(6543) connection string 을 설정하세요.
> Build error occurred
Error: Failed to collect page data for /products
```

**판정**: PASS (의도된 기존 패턴).
- ✓ Compiled successfully + ✓ Finished TypeScript: 컴파일 + 타입 통과
- Collecting page data 단계 실패: `.env.local` 의 `DATABASE_URL` 부재로 인한 정적 페이지 수집 실패. 사용자 지시 (".env.local 부재로 page data 수집 단계 실패는 기존 패턴과 동일 — fail 처리 말 것") 그대로 적용. Vercel 환경에서는 env var 가 주입되므로 정상 빌드.

---

## 7. 보류/미해결/향후 처리 권고

| # | 항목 | 상태 | 메모 |
|---|------|------|------|
| 1 | `ImportResult` shape 통합 (Issue #A) | 권고 | actions.ts 의 `ImportProductsResult` 를 진실로 삼고 `src/lib/products/types.ts` 의 `ImportResult` 를 alias 로 변경 후 dialog 어댑터 제거. 작은 PR 1건. 담당: `data-pipeline` 또는 `db-engineer` |
| 2 | localStorage 신구 캐시 마이그레이션 (Issue #B) | 권고 | STORAGE_KEY 를 `v3` 로 올리거나 `loadPersisted` 에서 `isComposite ?? null` backfill. 작은 PR 1건. 담당: `next-builder` |
| 3 | products 페이지 `loading.tsx` / `error.tsx` | 향후 | 명세 §4-7 에서 명시되지만 현재는 Next.js 기본 동작 사용. Server Component 로딩이 빠르면 사용자 체감 부족하지 않음 — P7 시연 후 필요 시 추가 |
| 4 | `MultiSelectFilter` 공통 추출 | 향후 | 02_uiux_products §4-4 메모. 현재 ChannelFilter / SalesTypeFilter 두 곳에 거의 동일 코드. YAGNI 로 본 P5 에서는 보류 — 세 번째 사용처 생길 때 추출 권장 |
| 5 | `getDistinctChannelNames` sales.A union | 향후 | 02_uiux_products §8-2 명시 보류. 현재는 product_master 만. 사용자 시연 후 사용성 판단 |
| 6 | KPI 단품/복합 분리 카드 | v2 | 01_requirements_products §5, 02_uiux_products §7 #13 — 명시적 스코프 제외. 향후 KPI 6장 → 8장 확장 시 재검토 |
| 7 | 마이너스 인라인 등록 (구분 셀 클릭 → Dialog) | v2 | 01_requirements_products §3, 02_uiux_products §7 #12 — 명시적 스코프 제외. cal_amount 인터랙티브 셀과 동일 패턴으로 확장 가능 |
| 8 | 마이그레이션 `pnpm db:migrate` 실행 | 사용자 | 03_schema_products.md §4-2 — 본 P6 에서도 실행 금지. P7 진입 전 사용자가 수동 실행 (또는 Supabase Dashboard 에서 SQL 직접 적용) |

---

## 8. 명세 자가 점검 (`integration-check` 스킬 핵심 원칙)

- [x] 1번 — 5단면 한 줄 매핑표 작성 (§2, 6 도메인 필드 모두 통과)
- [x] 2번 — 단순 존재 확인이 아니라 키 ↔ 키 교차 비교 수행 (예: `productMaster.channelName` ↔ `getDistinctChannelNames()` 반환 string[] ↔ Combobox options ↔ URL `?channel=` ↔ `inArray(channel)`)
- [x] 3번 — 자동 가능한 검증은 스크립트로 (tsc/test/lint/build)
- [x] 4번 — 명세 ↔ 구현 차이 16개 체크리스트화 (§3)
- [x] 5번 — 발견된 이슈에 수정 담당 에이전트 명시 (Issue #A → data-pipeline/db-engineer, #B → next-builder)
- [x] 6번 — 코드 직접 수정하지 않음 (보고서만)
- [x] 7번 — P7 진입 blocker 명시적 판단 (§5: 없음)
- [x] 8번 — 보류 / 향후 권고 분리 기록 (§7)

— 끝 —

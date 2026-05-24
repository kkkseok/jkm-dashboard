# 06 — P6 통합 QA 보고서 (마이너스 매출이익률 5단면)

> 작성: 2026-05-24 / 작성자: `integration-qa` 에이전트
> 검증 범위: P5-3 완료 직후 — Excel letter ↔ pipeline 필드 ↔ DB 컬럼 ↔ Server Action 응답 키 ↔ UI 표시 컬럼
> 자동 검증 결과: `pnpm tsc --noEmit` PASS (exit 0) / `pnpm test` 16/16 PASS / `pnpm lint` 0 errors, 3 warnings

---

## 1. 결론

**조건부 통과 (Pass with notes)** — P7(Vercel 배포)을 막는 blocker 는 없음.

핵심 데이터 흐름(5단면)은 한 줄로 일관됨. 자동 검증(typecheck/test/lint) 모두 errors 없음. 발견된 항목은 (a) 명세 문서(`03_schema_minus.md`) 잔여 upsert 표현 1건 (minor — 문서만), (b) lint warning 으로 드러난 미사용 `calAmountMap` getter 1건 (nit), (c) base-ui Button `render` 패턴 점검 결과 위반 없음 — 입니다.

---

## 2. 5단면 한 줄 매핑표

| # | 표시 라벨 / 사용자 식별자 | ① Excel letter | ② Pipeline 필드 (`EnrichedRow`) | ③ DB 컬럼 (`cal_amount`) | ④ Server Action 응답 키 | ⑤ UI accessorKey / 라벨 | 통과 |
|---|------|----|----|----|----|----|----|
| 1 | 매출일 | `sales.C` | `salesDate: string\|null` | — | — | `salesDate` / "매출일" | OK |
| 2 | 온라인주문번호 | `sales.AE` (join key) | `onlineOrderNo` | — | — | `onlineOrderNo` / "온라인주문번호" | OK |
| 3 | 상품코드 | `revenue.Y` (after join, key `revenue.E ↔ sales.AE`) | `productCode` | `cal_amount.product_code` (`productCode`) | `CalAmount.productCode`, `getCalAmountMap` Map key | `productCode` / "상품코드" | OK |
| 4 | 상품명 | `revenue.AG` | `productName` | — | — | `productName` / "상품명" (truncate) | OK |
| 5 | 매출액 | `sales.K` | `K: number\|null` | — | — | id `K` / "매출액" (`numericColumn`) | OK |
| 6 | 공급가 | `sales.L` | `L` | — | — | id `L` / "공급가" | OK |
| 7 | (숨김) 원가 | `sales.M` | `M` | — | — | 컬럼 정의 없음 (v2 토글 예정) | OK (의도) |
| 8 | 이익액(공급가) | `sales.R` | `R` | — | — | id `R` / "이익액" | OK |
| 9 | (숨김) 이익률(공급가) | `sales.S` | `S` | — | — | 컬럼 정의 없음 | OK (의도) |
| 10 | (숨김) 이익액(판매가) | `sales.T` | `T` | — | — | 컬럼 정의 없음 | OK (의도) |
| 11 | (숨김) 이익률(판매가) | `sales.U` | `U` | — | — | 컬럼 정의 없음 | OK (의도) |
| 12 | 수수료 | (계산) `1 - L/K` | `commissionRate` | — | — | id `commissionRate` / "수수료" (`percentColumn`) | OK |
| 13 | 후정산금 | (계산) `K × (commissionRate/2)` | `settlementAmount` | — | — | id `settlementAmount` / "후정산금" | OK |
| 14 | 추가후정산금 | `cal_amount.B` 룩업 (← `productCode`) | `extraSettlement: number\|null` | `extra_settlement integer NOT NULL` | `CalAmount.extraSettlement`, `getCalAmountMap` Map value | `accessorKey: "extraSettlement"` / "추가후정산금" (인터랙티브 셀) | OK |
| 15 | 총마진액 | (계산) `R + settlementAmount + (extraSettlement ?? 0)` | `totalMargin` | — | — | id `totalMargin` / "총마진액" | OK |
| 16 | 총마진율 | (계산) `totalMargin / L` | `totalMarginRate` | — | — | id `totalMarginRate` / "총마진율" | OK |

매핑 정합성: 16개 모두 통과. CSV 출력(`CSV_HEADERS`) 12개 = 표시 컬럼 12개와 동일 키·동일 순서.

---

## 3. 이번 마일스톤 핵심 항목 점검 (사용자 지정 1~10)

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | append-only 일관성 (5단면 모두 4필드 + UNIQUE 제거 + id DESC + DISTINCT ON) | OK | `schema.ts`, `0001/0002 SQL`, `actions.ts`(`appendCalAmount`/`deleteCalAmount(id)`/`listCalAmount` `id DESC`/`getCalAmountMap` DISTINCT ON), UI(`cal-amount-list-client` 컬럼 3개+삭제, `cal-amount-form-dialog` 2필드) — 명세 §5(v1.1) 와 1:1 |
| 2 | 공용 Dialog props 정합성 | OK | 양쪽 호출 비교:<br>· 분석: `<CalAmountFormDialog open onOpenChange defaultValues={{productCode}} lockProductCode onSaved={({productCode,extraSettlement})=>applyCalAmountUpdate(...)} />`<br>· 관리: `<CalAmountFormDialog open onOpenChange onSaved={handleSaved} />`<br>props 시그니처와 정확히 일치 |
| 3 | EnrichedRow ↔ §4-3 표 ↔ UI accessorKey ↔ CSV 컬럼 | OK | 위 §2 표 참조. 표시 12개·숨김 4개(`M/T/S/U`) `EnrichedRow`에는 존재, UI 컬럼 정의에는 의도적으로 누락(v2 토글) |
| 4 | 추가후정산금 셀 동작 통일 (mode 분기 없음) | OK | `cellDialog` state 가 `{open, productCode}` 만 보유 (mode 없음). `appendCalAmount` 한 종류만 호출. 시각 분기는 `isMissing` boolean 으로 ➕/✏️ 아이콘 + `aria-label` 만 분기 |
| 5 | 클라이언트 자동 재계산 (calAmountMap+행+KPI) | OK | `applyCalAmountUpdate` (minus-analyze-client:314~370): ① `setCalAmountMap` 갱신 ② 같은 productCode 행 전체 `computeProfit` 재호출 ③ `diagnostics.missingExtraCount` 갱신 ④ 1초 하이라이트 ⑤ 토스트 |
| 6 | null vs 0 의미 보존 | OK | pipeline `extraSettlement === null` 매칭 실패 유지 (`pipeline.ts:96~100`), `missingExtraCount` 는 null 만 카운트, UI 셀은 `isMissing = r.extraSettlement == null` 로 분기, CSV 도 `v == null ? "" : ...` — KPI/필터/셀 모두 일관 |
| 7 | CSV 컬럼 순서/포맷 | OK | `CSV_HEADERS` 12개 키·순서 = 표시 컬럼. UTF-8 BOM `﻿` (`UTF8_BOM`), 정수는 `String(Math.round(v))` raw (천단위 없음), 비율은 `xx.x%`, 파일명 `minus_${todayYMD()}.csv` |
| 8 | 5번째 KPI 카드 모바일 grid 패턴 | OK | `<section className="grid grid-cols-2 gap-3 md:grid-cols-5">` (761행) + `MissingKpiCard` 의 `className="col-span-2 ... md:col-span-1 ..."` (1241행) — 명세 §4-7 와 일치 |
| 9 | 마이너스 필터/KPI disabled | OK | KPI "마이너스 건수" 카드는 `value="—"` + `sub="판정 기준 미확정"` + `muted` (771~776행). `<Select disabled value="all">` + `<SelectItem value="negative" disabled>` (832~845행) |
| 10 | base-ui Button + `render` 비-button 패턴 점검 | OK (위반 0건) | `render={...}` 호출 8건 중 비-button 요소를 넘기는 것은 `minus-analyze-client.tsx:1153` 1건뿐이며 이미 `nativeButton={false}` 처리됨. 나머지(`layout.tsx:29` SheetTrigger, `dialog.tsx:65/112`, `select.tsx:51/129`, `sheet.tsx:65`)는 모두 `<Button .../>` 를 render 함 — primitive 가 button 으로 폴리모픽이라 안전 |

---

## 4. 발견된 이슈

### Issue #1 — `_workspace/03_schema_minus.md` 가 upsert 시절 그대로 (minor, 문서만)

- 위치: `_workspace/03_schema_minus.md:36-58, 70-95, 156-206`
- 기대: append-only v1.1 모델 — `cal_amount` 4컬럼(`id`/`productCode`/`extraSettlement`/`createdAt`/`updatedAt`), UNIQUE 제거, Server Action 은 `appendCalAmount`/`deleteCalAmount(id)` (id 인자)
- 실제: 여전히 7컬럼(productName/memo 포함), `cal_amount_product_code_uniq` UNIQUE, `upsertCalAmount`, `deleteCalAmount(productCode: string)` 로 기술. import 스크립트 로그 문구(`created M, updated K`)도 upsert 시절 잔재
- 추정 원인: `project_progress.md` "다음 할 일 1번 — 명세 §5 갱신" 이 `02_uiux_minus.md` 만 v1.1 갱신되고 `03_schema_minus.md` 는 누락됨
- 영향: 실 코드와 명세 불일치 → 차후 onboarding 시 혼선. 빌드/런타임 영향 없음
- 수정 담당: `db-engineer` (혹은 사용자 직접 한 줄 추기)
- 권장 패치: §2 표 4필드로 축소, §3 `upsertCalAmount` 절을 `appendCalAmount` 로 교체 + `deleteCalAmount(id: number)`, §3-4 `getCalAmountMap` 에 "DISTINCT ON productCode + id DESC" 명시, §7 "upsert target unique" 표현 제거

### Issue #2 — `calAmountMap` state 가 read 사용처 없음 (nit, lint warning)

- 위치: `src/app/(dashboard)/minus/minus-analyze-client.tsx:144`
- 기대: 분석 후 셀 저장 시 갱신된 calAmountMap 이 어떤 read 측에서도 활용되거나, 활용되지 않는다면 setter-only 로 줄이거나 의도 주석 추가
- 실제: `[calAmountMap, setCalAmountMap]` 선언 후 `setCalAmountMap` 만 사용. read 사용처 0 → ESLint `@typescript-eslint/no-unused-vars` warning
- 추정 원인: 셀 저장 시 갱신은 했지만, 재분석(=`runAnalyze`) 시 어차피 `getCalAmountMap()` 으로 fresh fetch 함. 즉 클라이언트 상태로 유지할 필요가 없거나, 향후 "재분석 없이 같은 파일 다른 cal_amount 셋으로 재계산" 용도로 남겨둔 슬롯
- 영향: 기능 없음 (메모리 점유 미미). 런타임 미영향
- 수정 담당: `next-builder`
- 권장 패치 한 줄: 둘 중 택1 — (A) `const setCalAmountMap = React.useState<Map<string, number>>(new Map())[1]` 로 setter-only 축소 + 주석 "셀 저장 winner 캐시(현 v1 미사용)", 또는 (B) 변수 자체 제거하고 `applyCalAmountUpdate` 도 Map 갱신부 삭제

### Issue #3 — 이력 셀(✏️) 클릭 시 `defaultValues.extraSettlement` 자동 채움 여부 (확인용, 통과)

- 위치: `src/app/(dashboard)/minus/minus-analyze-client.tsx:1027-1030`
- 명세 §4-5 시나리오 5-12: "이력 있는 행을 클릭해도 `extraSettlement` 는 빈 칸으로 시작 (새 이력을 추가하는 동작)"
- 코드: `defaultValues={ cellDialog.productCode != null ? { productCode: cellDialog.productCode } : undefined }` — `extraSettlement` 미주입 → Dialog의 `toFormValues` 에서 `""` (빈 칸) 으로 시작
- 결과: **OK** (명세대로 빈 칸 진입)

### 그 외 (참고)

- `useReactTable` lint warning 2건(`cal-amount-list-client.tsx:223`, `minus-analyze-client.tsx:556`): TanStack Table API 가 React Compiler 와 호환되지 않아 컴파일러 메모이제이션 skip — TanStack 측 알려진 한계, 동작 영향 없음. 무시 가능
- `revenue_profit_product` 의 `headerRows = 2` 는 추정값(`mapping.ts:35` 주석). 실 파일로 첫 분석 돌릴 때 anomaly 보이면 한 곳만 수정. 본 검증 단계 미해결 — 사용자가 실데이터로 한 번 확인 필요

---

## 5. P7 (Vercel 배포) 전 blocker

**없음.** Issue #1 은 문서 정정이고, #2 는 lint warning. P7 진행 가능.

권장 처리 순서: #1(문서 정합) → #2(lint clean) → P7 배포.

---

## 6. 자동 검증 결과 원문

```
$ pnpm tsc --noEmit
exit=0  (no output)

$ pnpm test
 Test Files  2 passed (2)
      Tests  16 passed (16)
   Duration  525ms

$ pnpm lint
✖ 3 problems (0 errors, 3 warnings)
  - cal-amount-list-client.tsx:223  Compilation Skipped (TanStack useReactTable)
  - minus-analyze-client.tsx:144    'calAmountMap' assigned but never used   ← Issue #2
  - minus-analyze-client.tsx:556    Compilation Skipped (TanStack useReactTable)
```

# 04 — 마이너스 매출이익률 데이터 파이프라인 (P4)

> 작성: 2026-05-22 / 작성자: `data-pipeline` 에이전트
> 입력: `data-pipeline.md`, `excel-mapping/skill.md`, `profit-calc/skill.md`, `memory/project_minus_logic.md`, `02_uiux_minus.md`
> 대상 호출자: `next-builder` (P5)

---

## 1. 생성 파일 목록

| 경로 | 1줄 설명 |
|------|---------|
| `src/lib/minus/types.ts` | `EnrichedRow`, `PipelineDiagnostics`, `RawSalesRow`, `RawRevenueRow` 타입 정의 |
| `src/lib/minus/mapping.ts` | Excel column letter 매핑 상수 (`SALES_MAPPING`, `REVENUE_MAPPING`) — letter 는 이 파일에만 |
| `src/lib/minus/parse.ts` | SheetJS 파싱 유틸 — `colToIdx`/`idxToCol`/`readNum`/`readStr`/`parseWorkbookToRows`/`sliceDataRows`/`leftJoin` |
| `src/lib/minus/calc.ts` | `computeProfit({K,L,R,extraSettlement})` — 5개 계산 컬럼 (profit-calc 스킬 수식 그대로) |
| `src/lib/minus/pipeline.ts` | `enrichMinusData()` — 두 파일 + cal_amount Map → `EnrichedRow[]` + 진단 |
| `src/lib/minus/__tests__/calc.test.ts` | computeProfit 단위 테스트 (9 케이스) |
| `src/lib/minus/__tests__/pipeline.test.ts` | parse 유틸 + enrichMinusData 통합 테스트 (7 케이스) |
| `vitest.config.ts` | vitest 설정 (Node env, `@` alias, `src/**/__tests__/**/*.test.ts`) |
| `package.json` | `test`/`test:watch` 스크립트 + `vitest` devDependency 추가 |

---

## 2. `EnrichedRow` 타입 시그니처

```ts
export type EnrichedRow = {
  // 원본 (sales_status_basic)
  salesDate: string | null         // C
  onlineOrderNo: string | null     // AE (매핑 key)
  K: number | null                 // 매출액
  L: number | null                 // 공급가
  M: number | null                 // 원가
  R: number | null                 // 이익액(공급가)
  S: number | null                 // 이익률(공급가)
  T: number | null                 // 이익액(판매가)
  U: number | null                 // 이익률(판매가)
  // 매핑 (revenue_profit_product)
  productCode: string | null       // Y
  productName: string | null       // AG
  // 룩업 (cal_amount)
  extraSettlement: number | null   // null = 매칭 실패, number(0 포함) = 등록됨
  // 계산 5개
  commissionRate: number | null    // 1 - L/K
  settlementAmount: number | null  // K * (commissionRate / 2)
  totalMargin: number | null       // R + settlementAmount + (extraSettlement ?? 0)
  totalMarginRate: number | null   // totalMargin / L
}

export type PipelineDiagnostics = {
  totalRows: number
  matchedCount: number          // sales ↔ revenue 조인 성공
  unmatchedJoinCount: number    // 조인 실패 (productCode === null)
  missingExtraCount: number     // cal_amount 매칭 실패 (= "추가후정산금 누락" KPI)
  computeNullCount: number      // 5개 계산 컬럼 중 하나 이상 null 인 행 수
}
```

핵심 결정:
- `extraSettlement === null`: cal_amount 매칭 실패 → UI 셀 "-" + ➕ 아이콘 + "누락" KPI 집계 대상.
- `extraSettlement === 0`: cal_amount 에 의도적으로 0 등록 → 누락 아님.
- 계산식 안에서는 `(extraSettlement ?? 0)` 처리. UI 표시는 null 보존.
- `productCode === null` (조인 실패) 시에도 K/L/R 가 있으면 계산은 진행 (사용자가 cal_amount 등록 전이라도 행 자체는 유의미한 마진 정보 제공).

---

## 3. `enrichMinusData` 시그니처 + 호출 예

```ts
import { enrichMinusData } from '@/lib/minus/pipeline'
import { getCalAmountMap } from '@/lib/cal-amount/actions'

export type PipelineInput = {
  salesFile: File | ArrayBuffer
  revenueFile: File | ArrayBuffer
  calAmountMap: Map<string, number>  // productCode → extraSettlement
}

export type PipelineResult = {
  rows: EnrichedRow[]
  diagnostics: PipelineDiagnostics
}

export async function enrichMinusData(input: PipelineInput): Promise<PipelineResult>
```

호출 예 (Next.js 클라이언트 컴포넌트 안):

```ts
'use client'
// 분석 시작 핸들러
async function onAnalyze(salesFile: File, revenueFile: File) {
  // 서버 액션으로 cal_amount Map 가져오기 (DB 의존은 호출 측이 책임)
  const calMap = await getCalAmountMap()
  const { rows, diagnostics } = await enrichMinusData({
    salesFile,
    revenueFile,
    calAmountMap: calMap,
  })
  // rows → TanStack Table 에 전달
  // diagnostics.missingExtraCount → KPI 카드 "추가후정산금 누락" 표시
}
```

DB 호출은 `enrichMinusData` 안에 없다. 파이프라인은 순수 함수(파일 입력 + Map 입력 → 결과 출력). 테스트 가능성과 클라이언트사이드 동작을 모두 만족.

---

## 4. 테스트 결과

`pnpm test` 실행 결과:

```
 Test Files  2 passed (2)
      Tests  16 passed (16)
   Duration  520ms
```

### 4-1. `calc.test.ts` (9 PASS / 0 FAIL)

- 정상 계산 (K=1000, L=900, R=100, extra=50) → 0.1 / 50 / 200 / 0.222… 검증
- K=0 → 모든 계산 null
- L=0 → commissionRate=1, totalMargin=650, totalMarginRate=null
- extraSettlement=null → totalMargin = R + settlementAmount + 0
- extraSettlement=0 vs null → totalMargin 동일 (의미만 다름)
- 음수 케이스 (K=500, L=550, R=-100) → 수수료/마진 음수
- R=null → totalMargin/totalMarginRate null
- K/L 모두 null → 전부 null
- L=null only → 수수료 이하 모두 null

### 4-2. `pipeline.test.ts` (7 PASS / 0 FAIL)

- `colToIdx`/`idxToCol` (A=0, AE=30, AG=32)
- `readNum` (숫자/문자열 숫자/공백/NaN 방어)
- `readStr` (공백/null/숫자→문자)
- `leftJoin` (매칭/미매칭/중복 키 첫 행 보존)
- 통합 enrich: 3 행 (정상/K=0/조인실패) + 빈 행 필터 → diagnostics 정확히 집계
- 빈 파일 → rows=[], diagnostics 전부 0
- cal_amount 에 0 등록된 상품 → extraSettlement=0, 누락 아님

---

## 5. 가정·주의사항

1. **`revenue_profit_product` 의 헤더 행 수** — 정확한 값 미확인. 우선 `2` 로 두고 진행 (`REVENUE_MAPPING.headerRows = 2`). 실제 파일에서 anomaly 발견 시 `mapping.ts` 한 곳만 수정. 자동 추론 금지(사용자 확인 필요).

2. **매출일(C)의 셀 타입** — `sales_status_basic.xlsx` 의 C 컬럼이 Date 타입으로 직렬화되어 있을 수 있어 `readStr` 이 Date 를 `YYYY-MM-DD` 로 변환. 문자열로 직접 들어오는 경우도 trim 후 그대로 반환. UI 측은 추가 포맷팅 없이 사용 가능.

3. **`productCode` null 인 행의 계산** — revenue 조인 실패 시에도 `K/L/R` 만 있으면 commissionRate/settlementAmount/totalMargin 모두 계산 진행. 이 정책은 "행 자체는 보존" (data-pipeline.md §에러 핸들링) 원칙에 부합. 단, `extraSettlement` 는 null (lookup 키가 없음) → `(extraSettlement ?? 0)` 으로 처리.

4. **중복 키 처리** — `leftJoin` 은 첫 행 보존 (덮어쓰기 방지). revenue 파일에 동일 주문번호가 중복으로 등장하면 가장 위 행이 이긴다. 사용자가 다른 정책을 원하면 `parse.ts` 의 `leftJoin` 수정.

5. **클라이언트사이드 동작 확인** — `parse.ts` 와 `pipeline.ts` 는 Node 전용 import (fs/path 등) 가 없음. SheetJS 만 사용. `vitest` 환경은 `node` 로 두었지만 `xlsx` 자체가 isomorphic 이라 브라우저에서도 동일하게 동작.

6. **`computeNullCount` 의미** — 5개 계산 컬럼 중 **하나라도** null 이면 카운트 +1. UI 에서 "계산 불가 NN 행 제외" 보조 텍스트(02_uiux_minus §4-4 시나리오 4)에 사용 권장.

7. **`missingExtraCount` 의 정의** — `extraSettlement === null` 인 행 수. 즉 `productCode === null` (조인 실패) 행 + `productCode` 는 있지만 cal_amount 에 없는 행 둘 다 포함. UI KPI "추가후정산금 누락"의 정의(2026-05-22 사용자 확정)에 부합.

8. **숫자 정밀도** — `Number.isFinite` 체크 + `toBeCloseTo(_, 10)` 자릿수로 테스트. 실수 누적 오차 미존재 확인.

9. **vitest 의존성 추가** — `pnpm add -D vitest` (v4.1.7) 1개만 설치. `@vitest/ui`, `jsdom` 등은 추후 React 컴포넌트 테스트 시점에 추가.

---

## 6. 다음 단계 (`next-builder` 인계)

- `/minus` 페이지에서 `enrichMinusData` 호출 시점/위치 결정 (클라이언트 vs 서버 액션). 권장: **클라이언트** (파일 업로드는 브라우저 메모리에서 즉시 파싱, 서버 전송 없이 분석. cal_amount Map 만 서버 액션으로 1회 fetch).
- `EnrichedRow` 를 그대로 TanStack Table 의 row 모델로 사용.
- `extraSettlement === null` 셀에 ➕ 아이콘 노출 (02_uiux_minus §4-2).
- KPI 카드 "추가후정산금 누락" = `diagnostics.missingExtraCount`.
- cal_amount 수정 후 자동 재계산: 클라이언트가 `calAmountMap` 만 갱신하고 `computeProfit` 만 다시 돌리면 됨 (파일 재파싱 불필요). `computeProfit` 가 순수 함수라 재계산 비용 O(n).

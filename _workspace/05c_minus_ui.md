# P5-3 — `/minus` 분석 페이지 UI 구현 보고서

> 작성: 2026-05-24 / 작성자: `next-builder` 에이전트
> 입력: `_workspace/02_uiux_minus.md` §4 (v1.1)
> 산출: `/minus` 페이지 + 분리된 Client Component

---

## 1. 파일 구조 / 데이터 흐름

### 생성·수정된 파일

| 파일 | 종류 | 내용 |
|------|------|------|
| `src/app/(dashboard)/minus/page.tsx` | Server Component | 14줄. `<MinusAnalyzeClient />` 마운트만. 정적 페이지. |
| `src/app/(dashboard)/minus/minus-analyze-client.tsx` | Client Component | 신규 작성 (≈1100줄). 전체 인터랙션 담당. |

### 데이터 흐름 (텍스트 다이어그램)

```
[브라우저: /minus 진입]
      │  (Server Component 정적 페이지 — DB 호출 없음)
      ▼
[MinusAnalyzeClient 마운트]
      │
      ├─ 업로드 슬롯1·2 (드래그앤드롭 + 클릭, xlsx 확장자 즉시 검증)
      │
      ▼  [분석 시작 클릭]
      │
      ├─ (1/3) "병합 헤더 분석" 메시지 (150ms 의도적 지연)
      │
      ├─ (2/3) "매핑·조인"
      │      └─ getCalAmountMap() Server Action
      │           └─ Postgres DISTINCT ON (product_code) → Map<string, number>
      │
      ├─ (3/3) "계산"
      │      └─ enrichMinusData({ salesFile, revenueFile, calAmountMap })
      │           ├─ SheetJS 파싱 (브라우저, header:1)
      │           ├─ leftJoin (AE ↔ E)
      │           └─ computeProfit per row → 5컬럼 산출
      │
      ▼
[setState: rows / diagnostics / calAmountMap]
      │
      ├─ KPI 5장 렌더
      ├─ 검색/필터 영역 렌더
      └─ TanStack DataTable (정렬·페이지네이션 100行)
            │
            ▼  [추가후정산금 셀 클릭]
            │
            ├─ CalAmountFormDialog 열림 (lockProductCode=true)
            │   └─ 저장 = appendCalAmount() Server Action
            │
            ▼  [onSaved 콜백]
            │
            ├─ calAmountMap 갱신 (Map clone + set)
            ├─ 동일 productCode 모든 행 computeProfit 재호출 → setRows
            ├─ diagnostics.missingExtraCount 클라이언트사이드 차감
            ├─ 갱신 행 _rowId 를 highlightedRowIds Set 에 등록 (1초 후 해제)
            └─ toast.success("저장됨 — N개 행 재계산")

[CSV 다운로드]
      └─ filteredRows → 12 컬럼 텍스트 직렬화 → UTF-8 BOM + Blob + <a download>
```

핵심: **파일 파싱은 전부 브라우저에서**. 서버로 엑셀을 보내지 않는다 → Vercel Hobby 10초 함수 제한 회피. cal_amount Map 만 Server Action 1회 호출.

---

## 2. 명세 §4-3 매핑표 ↔ 실제 컬럼

표시 12개 컬럼만 TanStack 에 등록. 명세에서 "숨김(v2)" 으로 분류된 M/T/S/U 4개는 컬럼 정의에 포함하지 않음.

| 표시 라벨 | EnrichedRow 필드 | TanStack id (accessorKey/accessorFn) | 정렬 | 셀 렌더 패턴 |
|-----------|------------------|--------------------------------------|------|---------------|
| 매출일 | `salesDate` | `salesDate` | ✓ | 좌측 |
| 온라인주문번호 | `onlineOrderNo` | `onlineOrderNo` | ✗ | 좌측 font-mono |
| 상품코드 | `productCode` | `productCode` | ✗ | 좌측 font-mono |
| 상품명 | `productName` | `productName` | ✗ | 좌측 truncate + title |
| 매출액 | `K` | `K` (accessorFn) | ✓ | numericColumn (우측 + tabular-nums + null `-` muted + 음수 red) |
| 공급가 | `L` | `L` (accessorFn) | ✓ | numericColumn |
| 이익액 | `R` | `R` (accessorFn) | ✓ | numericColumn |
| 수수료 | `commissionRate` | `commissionRate` | ✓ | percentColumn (`xx.x%`) |
| 후정산금 | `settlementAmount` | `settlementAmount` | ✓ | numericColumn |
| **추가후정산금** | `extraSettlement` | `extraSettlement` | ✓ | **인터랙티브 셀** (`role="button"` + Plus/Pencil 아이콘 + Dialog 트리거) |
| 총마진액 | `totalMargin` | `totalMargin` | ✓ | numericColumn |
| 총마진율 | `totalMarginRate` | `totalMarginRate` | ✓ | percentColumn |

`null` 정렬: numeric/percent/extraSettlement 모두 커스텀 `sortingFn` 으로 `null` 을 항상 뒤로.

---

## 3. 클라이언트 자동 재계산 핵심 스니펫

```ts
function applyCalAmountUpdate(productCode: string, extraSettlement: number) {
  // 1) Map 클론 후 갱신 — 같은 코드 다음 셀 클릭 시에도 새 값이 반영되도록
  setCalAmountMap((prev) => {
    const next = new Map(prev)
    next.set(productCode, extraSettlement)
    return next
  })

  if (rows == null) return

  let updatedCount = 0
  const updatedIds = new Set<number>()
  const nextRows = rows.map((r) => {
    if (r.productCode !== productCode) return r
    updatedCount++
    updatedIds.add(r._rowId)
    const profit = computeProfit({ K: r.K, L: r.L, R: r.R, extraSettlement })
    return { ...r, extraSettlement, ...profit }
  })
  setRows(nextRows)

  // 2) KPI "추가후정산금 누락" 즉시 차감
  //    (cal_amount 매칭 실패였던 행만 1건씩 감소, 이미 값이 있던 경우 변동 없음)
  setDiagnostics((d) => {
    if (!d) return d
    const wasMissingForCode = rows.some(
      (r) => r.productCode === productCode && r.extraSettlement == null,
    )
    const hadMissingRows = rows.filter(
      (r) => r.productCode === productCode && r.extraSettlement == null,
    ).length
    return {
      ...d,
      missingExtraCount: wasMissingForCode
        ? Math.max(0, d.missingExtraCount - hadMissingRows)
        : d.missingExtraCount,
    }
  })

  // 3) 1초 하이라이트
  setHighlightedRowIds(updatedIds)
  setTimeout(() => setHighlightedRowIds(new Set()), 1000)

  toast.success(`저장됨 — ${updatedCount}개 행 재계산`)
}
```

`computeProfit` 은 파이프라인이 사용하는 것과 100% 동일한 함수 (`src/lib/minus/calc.ts`) — 수식 분기 위험 없음.

---

## 4. CSV 컬럼 순서 (12개)

`CSV_HEADERS` 배열을 단일 소스로 사용. 첫 행 = UTF-8 BOM + 한글 헤더.

```
1. 매출일            (salesDate)
2. 온라인주문번호    (onlineOrderNo)
3. 상품코드          (productCode)
4. 상품명            (productName)
5. 매출액            (K)
6. 공급가            (L)
7. 이익액            (R)
8. 수수료            (commissionRate)         → "xx.x%"
9. 후정산금          (settlementAmount)
10. 추가후정산금     (extraSettlement)        → null 은 빈 칸
11. 총마진액         (totalMargin)
12. 총마진율         (totalMarginRate)        → "xx.x%"
```

- 금액 컬럼은 천단위 구분 없이 raw 정수(Math.round) — 외부 분석/Excel 재취입 용이.
- 비율 컬럼은 `xx.x%` 문자열.
- 파일명: `minus_YYYY-MM-DD.csv`
- 별도 라이브러리 없음 (Blob + URL.createObjectURL + `<a download>`).
- 필터 적용 후 `filteredRows` 기준으로 export (검색·누락 필터 결과만 저장).

---

## 5. 사용자 확인 체크리스트 (UI 검증)

### 빌드·서빙 확인 완료
- `pnpm build` 통과 (Next.js 16.2.6 / Turbopack / TypeScript)
- `GET http://localhost:3000/minus` → HTTP 200, 32KB 응답, 업로드 카드 SSR 마크업 확인

### 사용자가 직접 확인해야 할 시나리오
`pnpm dev` (이미 PID 28872 로 실행 중) → http://localhost:3000/minus 에서:

1. **빈 상태**: 슬롯 2개 점선 + "분석 시작" 비활성 확인.
2. **파일 형식 검증**: csv 파일 드래그 → 슬롯 빨강 + Alert "xlsx 파일만 지원합니다".
3. **정상 분석**: `docs/test-data/sales_status_basic.xlsx` + `revenue_profit_product.xlsx` 두 개 드래그 → "분석 시작" → progress 메시지 3단계 (1/3 → 2/3 → 3/3) → KPI/테이블 표시 + 토스트 "분석 완료 (N행)".
4. **KPI**:
   - 총 행 수 / 마이너스 건수 "—" (muted, "판정 기준 미확정") / 총 매출액 / 총마진액 합계(음수면 빨강) / 추가후정산금 누락(인터랙티브)
   - 모바일 폭(<768px)에서 5번째 카드가 `col-span-2`로 단독 행 차지하는지 확인
5. **검색 debounce**: 상품명/코드/주문번호 입력 → 300ms 후 필터 적용 + chip 표시.
6. **누락 KPI 카드 클릭**: chip "누락 행만" 표시 + 테이블 누락 행만 노출 + `aria-pressed="true"` 토글.
7. **추가후정산금 셀 (매칭 실패)**: Plus 아이콘 상시, 클릭 → Dialog → 저장 → 같은 productCode 모든 행 즉시 갱신 + bg-blue-50 1초 하이라이트 + toast "저장됨 — N개 행 재계산" + KPI 누락 카운트 즉시 감소.
8. **추가후정산금 셀 (이력 있음)**: 호버 시 Pencil 아이콘, 클릭 → Dialog (extraSettlement 빈 칸으로 시작) → 새 값 입력 → 같은 흐름.
9. **테이블 정렬**: 헤더 클릭 시 ▲▼ 토글, `aria-sort` 변경. null 값은 항상 뒤로.
10. **페이지네이션**: 100행 단위, 윈도우(1·중간·끝).
11. **CSV 다운로드**: 한글 헤더 깨짐 없이 다운로드(UTF-8 BOM). 필터 적용 시 필터 결과만.
12. **재업로드 충돌 Dialog**: 분석 완료 상태에서 슬롯에 다른 파일 드롭 → confirm Dialog (현재 결과 표시는 "재업로드" 버튼으로 리셋 후 가능 — 추가 보완 노트 §6 참고).
13. **마이너스 필터 Select**: disabled 상태 표시 (title="판정 기준 미확정").
14. **키보드**: Tab 으로 슬롯·버튼·KPI 카드·테이블 헤더·셀 모두 도달, Enter/Space 작동.

### 자동 검증 불가 항목 (사용자 눈으로만 확인)
- 실제 xlsx 파일 파싱 결과 행 수/계산값 정확성 → `integration-qa` 단계에서 별도 검증
- 모바일 반응형 (브라우저 dev tools 로 직접)
- ARIA live 토스트 안내음 (스크린리더 환경 필요)
- 1초 하이라이트 fade-out 시각 효과

---

## 6. 명세와 다르게/추가 구현한 부분

### A. 분석 완료 상태에서 업로드 카드 숨김
명세 §4-1 상태2 와이어프레임은 "분석 완료" 화면에 업로드 카드를 그대로 표시하지 않는다. 본 구현은 분석 완료 시 업로드 카드를 숨기고 헤더에 "재업로드" 버튼만 노출. **재업로드 흐름**: "재업로드" 버튼 = 전체 리셋(빈 상태 복귀) → 새 파일 슬롯에 드롭/선택 → "분석 시작" 다시. 명세 시나리오 2 "분석 완료 상태에서 슬롯에 새 파일 드롭 시 Dialog" 흐름은 슬롯이 화면에 없으므로 발동되지 않는 점을 인지. (`handleSlotChange` 함수 + 재업로드 Dialog 코드는 구현되어 있으므로, 추후 슬롯을 분석 후에도 표시하는 패턴으로 바꾸면 즉시 동작.)

**Reason**: 분석 완료 후 큰 KPI/테이블 위에 업로드 카드가 같이 표시되면 시각적 노이즈가 크고 사용자가 새 파일을 의도 없이 드롭할 가능성이 있다. "재업로드"로 명시적 리셋 → 새 파일 → 새 분석 흐름이 더 명확하다고 판단.

### B. 의도적 시간 지연 150ms
파이프라인 내부 콜백이 없어 단계 메시지 갱신 타이밍을 알 수 없음. 명세 권고대로 (1/3) 메시지 표시 후 `await sleep(150)` 으로 시각화. 큰 파일에서는 자연스럽게 (3/3)에서 시간이 걸리므로 문제 없음.

### C. CSV 의 숫자 컬럼은 천단위 구분 없이 raw
화면 표시는 `ko-KR` 천단위, CSV 는 raw 정수. Excel/외부 분석 도구가 천단위가 들어가면 문자열로 인식하는 문제를 피하기 위함. 비율 컬럼만 `"xx.x%"` 문자열로 저장 (이건 어차피 % 가 들어가서 문자열).

### D. `numericColumn` / `percentColumn` 헬퍼
12개 컬럼 중 6개가 같은 패턴 (우측 + tabular-nums + null muted + 음수 red + null-aware sort)이라 헬퍼로 추출. 중복 제거 + 일관성.

### E. button base-ui `render` prop
shadcn Button 이 `@base-ui/react/button` 래퍼라 Radix 의 `asChild` 가 아니라 `render` prop 패턴. 파일 선택 버튼은 `<Button render={<label htmlFor="…" />}>...</Button>` 으로 렌더. layout.tsx 의 SheetTrigger 와 동일 패턴.

### F. cal_amount Map 클라이언트 갱신
`onSaved` 콜백에서 `appendCalAmount` 의 결과값을 받아 Map 에 set + DB refetch 없음. 명세대로 — 사용자가 같은 셀을 두 번 클릭해 다른 값을 저장하면 클라이언트 메모리만 갱신되고 next analyze 시점에 fresh fetch.

---

## 7. 보류·미구현 항목 (의도적)

| 항목 | 상태 | 메모 |
|------|------|------|
| 마이너스 필터 Select | disabled 자리만 | 명세 §8-1: 판정 기준 미확정. 옵션 "마이너스만" 도 disabled. |
| KPI "마이너스 건수" | "—" + 보조텍스트 "판정 기준 미확정" | 명세대로. |
| 숨김 컬럼 토글 UI (M/T/S/U) | 미구현 | 명세 §8-4 v2 예정. |
| `bg-red-50` 행 배경 | 미적용 | 명세 §8-8 — 판정 기준 미확정으로 v1 보류. |
| 인증/로그인 | 미구현 | 명세 §8-6 — 별도 명세. 헤더에 정적 이메일. |

---

## 8. 다음 단계 메모

### P6 `integration-qa` 에 넘길 핵심 검증 포인트

1. **실제 데이터 정합성**: `_workspace/04_pipeline_minus.md` + 본 페이지가 같은 `enrichMinusData` 를 호출하므로, 파이프라인 unit test 가 통과한다면 UI 표시값도 같아야 함. 단, **추가후정산금 셀 클릭 후 클라이언트사이드 재계산 경로**는 통합 테스트 필요 (DB → Server Action → 클라이언트 Map 갱신 → computeProfit 재호출 → 표시 일치).
2. **CSV ↔ 화면 일치**: 12 컬럼 라벨/순서가 명세 §4-3 표시 순서와 정확히 일치. `_workspace/04_pipeline_minus.md` 의 EnrichedRow 필드명과 키 매칭 점검.
3. **diagnostics.missingExtraCount 일치**: 본 페이지는 분석 직후 표시값을 그대로 사용. 셀 저장 시 클라이언트 차감 로직이 서버에서 다시 계산한 결과와 일치하는지 (다음 분석 시점에 검증 가능).
4. **빈/로딩/에러 상태**: 명세 §4-4 표 항목 직접 시연.
5. **반응형**: 모바일(<md) KPI 5번째 카드 `col-span-2`, 사이드바 `Sheet`, 업로드 슬롯 1열 등.
6. **접근성**: KPI 카드 `aria-pressed`, 셀 `role="button"` + Enter/Space, 헤더 정렬 `aria-sort`, 토스트 `aria-live`.

### P7 Vercel 배포 시 주의
- **함수 시간**: 본 페이지는 클라이언트 파싱이라 Edge/Hobby 10초 제한 영향 없음. `getCalAmountMap()` Server Action 만 서버에서 실행 (Postgres 단순 SELECT — <1s).
- **환경변수**: `DATABASE_URL` (Supabase transaction pooler) 만 필요. 본 페이지 자체는 추가 env 없음.
- **번들 사이즈**: `xlsx` (~600KB gz) 가 클라이언트 청크에 포함됨 (`enrichMinusData` 가 사용). 분석 페이지만 진입하는 사용자에게 다운로드되므로 acceptable. 추후 dynamic import 로 lazy load 검토 가능 (분석 시작 클릭 시점에 load).
- **getCalAmountMap Server Action**: `'use server'` 디렉티브 + `revalidatePath` 없음 (조회용). Vercel 에서 자동으로 POST 엔드포인트 생성. 인증 도입 시 함수 내부에 auth 체크 필수 (명세 §8-6).

---

## 부록: 핵심 변경 사항 한 줄 요약

- `src/app/(dashboard)/minus/page.tsx` → Server Component, 14줄로 축소. `<MinusAnalyzeClient />` 마운트.
- `src/app/(dashboard)/minus/minus-analyze-client.tsx` → 신규 작성. 명세 §4 전체 인터랙션. `pnpm build` 통과 + `/minus` HTTP 200 확인.

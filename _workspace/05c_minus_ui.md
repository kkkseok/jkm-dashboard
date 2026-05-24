# P5-3 — `/minus` 분석 페이지 UI 구현 보고서

> 작성: 2026-05-24 / 작성자: `next-builder` 에이전트
> v1.4 (2026-05-24) 동기화: v1.2 최종이익액/최종이익률, v1.3 brand 통합·상품명 AH, v1.4 마이너스 판정·범위 필터·KPI 6장·합계행 제외, P6 minor(03 문서·`calAmountMap` 정리) 모두 반영
> 입력: `_workspace/02_uiux_minus.md` §4 (v1.4)
> 산출: `/minus` 페이지 + 분리된 Client Component

---

## 1. 파일 구조 / 데이터 흐름

### 생성·수정된 파일

| 파일 | 종류 | 내용 |
|------|------|------|
| `src/app/(dashboard)/minus/page.tsx` | Server Component | 14줄. `<MinusAnalyzeClient />` 마운트만. 정적 페이지. |
| `src/app/(dashboard)/minus/minus-analyze-client.tsx` | Client Component | ≈1300줄 (v1.4 까지 확장). 전체 인터랙션 담당. |

### 데이터 흐름 (텍스트 다이어그램)

```
[브라우저: /minus 진입]
      │  (Server Component 정적 페이지 — DB 호출 없음)
      ▼
[MinusAnalyzeClient 마운트]
      │
      ├─ 업로드 슬롯1·2 (드래그앤드롭 + 클릭, xlsx 확장자 즉시 검증)
      │      슬롯 라벨: sales_status_basic / revenue_profit_brand (v1.3)
      │
      ▼  [분석 시작 클릭]
      │
      ├─ (1/3) "병합 헤더 분석" (150ms 의도적 지연)
      │
      ├─ (2/3) "매핑·조인"
      │      └─ getCalAmountMap() Server Action
      │           └─ Postgres DISTINCT ON (product_code) → Map<string, number>
      │
      ├─ (3/3) "계산"
      │      └─ enrichMinusData({ salesFile, revenueFile, calAmountMap })
      │           ├─ SheetJS 파싱 (브라우저, header:1)
      │           ├─ sliceDataRows: 헤더 N행 제거 + 빈행 제거
      │           │  + A열="총계/합계/소계/총합/total/summary" 행 제외 (v1.4)
      │           ├─ leftJoin (sales.AE ↔ brand.E)
      │           └─ computeProfit per row → 7컬럼 산출 (수수료/후정산/추가후정산
      │              /총마진액/총마진율/최종이익액(v1.2)/최종이익률(v1.2))
      │
      ▼
[setState: rows / diagnostics]   * calAmountMap state 폐기 (P6, setter-only 였음)
      │
      ├─ KPI 6장 렌더 (v1.4):
      │   총행수 / 마이너스건수(활성) / 계산불가(인터랙티브)
      │   / 총매출(합계행 제외) / 총마진합계 / 추가후정산금 누락(인터랙티브)
      │
      ├─ 검색/필터 영역 (v1.4):
      │   검색 input + 총마진율 범위(min,max %) + 모드(inside/outside) + 초기화
      │
      └─ TanStack DataTable (정렬·100行 페이지네이션, 16컬럼)
            │
            ▼  [추가후정산금 셀 클릭]
            │
            ├─ CalAmountFormDialog 열림 (lockProductCode=true)
            │   └─ 저장 = appendCalAmount() Server Action
            │
            ▼  [onSaved 콜백]
            │
            ├─ 동일 productCode 모든 행 computeProfit 재호출 → setRows
            │  (인자: K, L, Q(v1.2), R, extraSettlement)
            ├─ diagnostics.missingExtraCount 클라이언트사이드 차감
            ├─ 갱신 행 _rowId 를 highlightedRowIds Set 에 등록 (1초 후 해제)
            └─ toast.success("저장됨 — N개 행 재계산")

[CSV 다운로드]
      └─ filteredRows → 16 컬럼 텍스트 직렬화 → UTF-8 BOM + Blob + <a download>
```

핵심: **파일 파싱은 전부 브라우저에서**. 서버로 엑셀을 보내지 않는다 → Vercel Hobby 10초 함수 제한 회피. cal_amount Map 만 Server Action 1회 호출.

---

## 2. 명세 §4-3 매핑표 ↔ 실제 컬럼 (v1.4 — 16컬럼)

표시 16개 컬럼만 TanStack 에 등록. 명세에서 "숨김(v2)" 으로 분류된 M/T/S/U 4개는 컬럼 정의에 포함하지 않음.

| 표시 라벨 | EnrichedRow 필드 | TanStack id | 정렬 | 셀 렌더 패턴 |
|-----------|------------------|-------------|------|---------------|
| 매출일 | `salesDate` | `salesDate` | ✓ | 좌측 |
| 온라인주문번호 | `onlineOrderNo` | `onlineOrderNo` | ✗ | 좌측 font-mono |
| 상품코드 | `productCode` | `productCode` | ✗ | 좌측 font-mono |
| 상품명 | `productName` (brand.AH, v1.3) | `productName` | ✗ | 좌측 truncate + title |
| **브랜드명** (v1.3) | `brandName` (brand.BF) | `brandName` | ✓ | 좌측 truncate + title |
| 매출액 | `K` | `K` | ✓ | numericColumn (우측 + tabular-nums + null `-` muted + 음수 red) |
| 공급가 | `L` | `L` | ✓ | numericColumn |
| 이익액 | `R` | `R` | ✓ | numericColumn |
| **물류비** (v1.2) | `Q` (sales.Q) | `Q` | ✓ | numericColumn |
| **최종이익액** (v1.2) | `finalProfit` (계산 `R - Q`) | `finalProfit` | ✓ | numericColumn |
| **최종이익률** (v1.2) | `finalProfitRate` (계산 `(R-Q)/L`) | `finalProfitRate` | ✓ | percentColumn |
| 수수료 | `commissionRate` | `commissionRate` | ✓ | percentColumn |
| 후정산금 | `settlementAmount` | `settlementAmount` | ✓ | numericColumn |
| **추가후정산금** | `extraSettlement` | `extraSettlement` | ✓ | **인터랙티브 셀** (`role="button"` + Plus/Pencil + Dialog 트리거) |
| 총마진액 | `totalMargin` | `totalMargin` | ✓ | numericColumn |
| 총마진율 | `totalMarginRate` | `totalMarginRate` | ✓ | percentColumn |

`null` 정렬: numeric/percent/extraSettlement 모두 커스텀 `sortingFn` 으로 `null` 을 항상 뒤로.

---

## 3. 클라이언트 자동 재계산 핵심 스니펫 (P6 정리 반영)

```ts
function applyCalAmountUpdate(productCode: string, extraSettlement: number) {
  if (rows == null) return

  let updatedCount = 0
  const updatedIds = new Set<number>()
  const nextRows = rows.map((r) => {
    if (r.productCode !== productCode) return r
    updatedCount++
    updatedIds.add(r._rowId)
    // v1.2: Q 도 인자에 포함 — finalProfit/finalProfitRate 도 같이 재계산됨
    const profit = computeProfit({
      K: r.K, L: r.L, Q: r.Q, R: r.R, extraSettlement,
    })
    return { ...r, extraSettlement, ...profit }
  })
  setRows(nextRows)

  // KPI "추가후정산금 누락" 즉시 차감 (cal_amount 매칭 실패 행만 1건씩 감소)
  setDiagnostics((d) => {
    if (!d) return d
    const hadMissing = rows.filter(
      (r) => r.productCode === productCode && r.extraSettlement == null,
    ).length
    return hadMissing > 0
      ? { ...d, missingExtraCount: Math.max(0, d.missingExtraCount - hadMissing) }
      : d
  })

  // 1초 하이라이트
  setHighlightedRowIds(updatedIds)
  setTimeout(() => setHighlightedRowIds(new Set()), 1000)

  toast.success(`저장됨 — ${updatedCount}개 행 재계산`)
}
```

`computeProfit` 은 파이프라인이 사용하는 것과 100% 동일한 함수 (`src/lib/minus/calc.ts`) — 수식 분기 위험 없음. **P6 정리로 `calAmountMap` state 폐기** — 어차피 분석 시작 시 fresh fetch 하고 행 상태가 winner 를 들고 있어 별도 Map 불필요.

---

## 4. CSV 컬럼 순서 (16개, v1.4)

`CSV_HEADERS` 배열을 단일 소스로 사용. 첫 행 = UTF-8 BOM + 한글 헤더.

```
1.  매출일            (salesDate)
2.  온라인주문번호    (onlineOrderNo)
3.  상품코드          (productCode)
4.  상품명            (productName)
5.  브랜드명          (brandName)          ← v1.3
6.  매출액            (K)
7.  공급가            (L)
8.  이익액            (R)
9.  물류비            (Q)                   ← v1.2
10. 최종이익액        (finalProfit)        ← v1.2
11. 최종이익률        (finalProfitRate)    → "xx.x%"   ← v1.2
12. 수수료            (commissionRate)     → "xx.x%"
13. 후정산금          (settlementAmount)
14. 추가후정산금      (extraSettlement)    → null 은 빈 칸
15. 총마진액          (totalMargin)
16. 총마진율          (totalMarginRate)    → "xx.x%"
```

- 금액 컬럼은 천단위 구분 없이 raw 정수(Math.round) — 외부 분석/Excel 재취입 용이.
- 비율 컬럼은 `xx.x%` 문자열.
- 파일명: `minus_YYYY-MM-DD.csv`
- 별도 라이브러리 없음 (Blob + URL.createObjectURL + `<a download>`).
- 필터 적용 후 `filteredRows` 기준으로 export (검색·범위·누락·계산불가 필터 결과만 저장).

---

## 5. 사용자 확인 체크리스트 (UI 검증)

### 자동 검증 통과
- `pnpm tsc --noEmit` exit 0
- `pnpm test` 26/26 (calc.test 16 + pipeline.test 10 — 합계행 제외 2건, brand 매핑 + Q 컬럼 케이스 신규)
- `pnpm lint` 0 errors, 2 warnings (TanStack `useReactTable` 호환성 한계, 무시 OK)

### 사용자가 직접 확인해야 할 시나리오
`pnpm dev` → http://localhost:3000/minus 에서:

1. **빈 상태**: 슬롯 2개 점선 + "분석 시작" 비활성.
2. **파일 형식 검증**: csv 파일 드래그 → 슬롯 빨강 + Alert "xlsx 파일만 지원합니다".
3. **정상 분석**: `sales_status_basic.xlsx` + `revenue_profit_brand.xlsx` 두 개 드래그 → "분석 시작" → progress 3단계 → KPI/테이블 표시 + 토스트 "분석 완료 (N행)".
4. **KPI 6장 (v1.4)**:
   - 총 행 수 / **마이너스 건수**(활성, 빨강, 비율 sub) / **계산 불가**(인터랙티브, 0건이면 muted) / 총 매출액(합계행 제외돼 정상화) / 총마진액 합계 / 추가후정산금 누락(인터랙티브)
   - 모바일 폭(<768px): `grid-cols-2 md:grid-cols-6` → 3행 × 2열 배치
5. **범위 필터 (v1.4)**: 기본 `min=-3, max=3, 모드=구간 안만(이상치)` → 마진율이 ±3% 사이 행만 표시. min/max 직접 수정·초기화·모드 전환 모두 즉시 반영.
6. **검색 debounce**: 상품명/코드/주문번호/브랜드 입력 → 300ms 후 필터 + chip.
7. **chip 영역**: 검색/범위/누락만/계산불가만 — 각 ×로 해제.
8. **추가후정산금 셀 (매칭 실패)**: Plus 아이콘 상시, 클릭 → Dialog → 저장 → 같은 productCode 모든 행 즉시 갱신 + bg-blue-50 1초 하이라이트 + 토스트 + KPI 누락 카운트 감소.
9. **추가후정산금 셀 (이력 있음)**: 호버 시 Pencil 아이콘, 클릭 → Dialog (`extraSettlement` 빈 칸으로 시작) → 새 이력 추가.
10. **테이블 정렬**: 헤더 클릭 ▲▼ 토글, `aria-sort` 변경. null 항상 뒤로.
11. **CSV 다운로드**: 한글 헤더 깨짐 없음(UTF-8 BOM), 16컬럼, 필터 결과만.
12. **키보드**: Tab/Enter/Space 로 슬롯·KPI 카드·셀·헤더 모두 도달·활성.

---

## 6. 명세와 다르게/추가 구현한 부분

### A. 분석 완료 상태에서 업로드 카드 숨김
명세 §4-1 상태2 와이어프레임은 분석 완료 화면에 업로드 카드를 같이 표시하지 않는다. 본 구현은 분석 완료 시 업로드 카드를 숨기고 헤더에 "재업로드" 버튼만 노출. **재업로드 흐름**: 버튼 = 전체 리셋(빈 상태 복귀) → 새 파일 슬롯에 드롭/선택 → "분석 시작" 다시. 명세 시나리오 2 "분석 완료 상태에서 슬롯에 새 파일 드롭 시 Dialog" 흐름은 슬롯이 화면에 없으므로 발동되지 않음.

**Reason**: 분석 완료 후 큰 KPI/테이블 위에 업로드 카드가 같이 표시되면 시각적 노이즈가 크고 의도 없이 드롭할 가능성 — "재업로드"로 명시적 리셋 흐름이 더 명확.

### B. 의도적 시간 지연 150ms
파이프라인 내부 콜백이 없어 단계 메시지 갱신 타이밍을 알 수 없음. (1/3) 메시지 표시 후 `await sleep(150)`. 큰 파일에서는 (3/3)에서 자연스럽게 시간 걸려 문제 없음.

### C. CSV 의 숫자 컬럼은 천단위 구분 없이 raw
화면 표시는 `ko-KR` 천단위, CSV 는 raw 정수. Excel/외부 분석 도구의 문자열 인식 회피.

### D. `numericColumn` / `percentColumn` 헬퍼
16개 컬럼 중 9개가 같은 패턴(우측+tabular-nums+null muted+음수 red+null-aware sort)이라 헬퍼로 추출. 중복 제거 + 일관성.

### E. button base-ui `render` prop + `nativeButton={false}` (시연 중 발견·수정)
파일 선택 버튼은 `<Button nativeButton={false} render={<label htmlFor="…" />}>...</Button>`. base-ui 가 native `<button>` 강제하기에 `nativeButton={false}` 필요.

### F. v1.2 totalMargin 정의 유지 (Q 무관)
"최종이익액 = R-Q" 추가했지만 totalMargin 정의는 그대로 (`R + settlementAmount + extraSettlement`). 사용자 확정: Q는 totalMargin 에 포함하지 않고 독립 보조 지표.

### G. v1.3 product → brand 통합
두 파일이 같은 주문집합·같은 60컬럼 구조였고 product 측 BF/AH 채움률이 거의 0% 라 brand 한 파일로 통합. 매칭률 동일 (1378/1467). 상품명 letter AG → AH 정정 (AG는 "기본상품 규격" 이었음).

### H. v1.4 합계행 제외
sales_status_basic 마지막 행 A="총계" 합계 행이 KPI 합산에 들어가 총 매출이 2배가 되던 문제 해결. `parse.ts` `sliceDataRows` 에 키워드 매칭(`총계/합계/소계/총합/total/summary`) 필터.

### I. v1.4 마이너스 판정 = 총마진율 < 0% + 범위 필터
사용자 확정. KPI "마이너스 건수" 활성화(정보 표시, 클릭 X). 필터는 임계값 직접 입력 + 구간 안/밖 토글 (기본 -3 ~ +3, 구간 안 = 이상치 검토). KPI "계산 불가" 카드 신규(인터랙티브, totalMarginRate=null 행 토글).

---

## 7. 보류·미구현 항목

| 항목 | 상태 | 메모 |
|------|------|------|
| 단품/복합 구분(product_master.BD) | **보류** | 메모리 `project_pending_product_master.md` — 채널별 상품코드 마스터보드 마련 후 재개 |
| 숨김 컬럼 토글 UI (M/T/S/U) | 미구현 | 명세 §8-4 v2 예정. |
| `bg-red-50` 행 배경 | 미적용 | 명세 §8-8 — 색상은 셀 값 음수에만 적용. |
| 인증/로그인 | 미구현 | 명세 §8-6 — 별도 명세. 헤더에 정적 이메일. |
| 84건 brand 미매칭 (5.8%) | 운영 사이드 | export 시점/조건 정렬 필요. 코드 변경 없음. |

---

## 8. 다음 단계 메모

### P6 통합 QA — **완료**
`_workspace/06_integration_qa.md` 참조. minor 2건(03 문서, lint warning) 모두 해결.

### P7 Vercel 배포 시 주의
- **함수 시간**: 본 페이지는 클라이언트 파싱이라 Edge/Hobby 10초 제한 영향 없음. `getCalAmountMap()` Server Action 만 서버에서 실행 (Postgres 단순 SELECT — <1s).
- **환경변수**: `DATABASE_URL` (Supabase transaction pooler) + `DATABASE_URL_UNPOOLED` (Session Pooler, 마이그레이션용). 본 페이지 자체는 추가 env 없음.
- **번들 사이즈**: `xlsx` (~600KB gz) 가 클라이언트 청크에 포함됨. 추후 dynamic import 로 lazy load 검토 가능 (분석 시작 클릭 시점에 load).
- **빌드 마이그레이션**: Vercel build hook 에서 `pnpm db:migrate` 자동화할지 수동 적용할지 결정 필요.
- **getCalAmountMap Server Action**: `'use server'` + 인증 없음 (현재). 인증 도입 시 함수 내부 auth 체크 필수.

---

## 부록: 핵심 변경 사항 한 줄 요약 (v1.1 → v1.4)

- v1.1 (P5-3): 분석 페이지 전체 인터랙션 + KPI 5장 + 12컬럼 + cal_amount Dialog + CSV
- v1.2: 최종이익액(R-Q)/최종이익률 추가 (15컬럼, 7계산컬럼)
- v1.3: revenue product → brand 통합, 상품명 AG → AH 정정, 브랜드명 BF 신규 (16컬럼)
- v1.4: 마이너스 판정 = 총마진율 < 0%, 범위 필터(min,max %) + 모드(inside/outside), KPI 6장 (마이너스 활성 + 계산불가 신규), 합계행 제외
- P6 minor: 03 스키마 문서 v1.1 동기화, `calAmountMap` state 제거 (lint clean)

# 06 — P6 통합 QA 보고서 (마이너스 매출이익률 5단면)

> 작성: 2026-05-24 / 작성자: `integration-qa` 에이전트
> v1.4 (2026-05-24) 동기화: v1.2 최종이익액·v1.3 brand 통합·v1.4 범위 필터/KPI 6장/합계행 + P6 minor 처리 결과까지 반영
> 검증 범위: P5-3 완료 직후 ~ v1.4 — Excel letter ↔ pipeline 필드 ↔ DB 컬럼 ↔ Server Action 응답 키 ↔ UI 표시 컬럼
> 자동 검증 결과: `pnpm tsc --noEmit` PASS (exit 0) / `pnpm test` **26/26** PASS / `pnpm lint` **0 errors, 2 warnings** (TanStack 호환성 한계만)

---

## 1. 결론

**통과 (Pass)** — P7(Vercel 배포)을 막는 blocker 없음.

v1.4 시점에 P6 발견 이슈 2건(03 문서, lint warning)은 모두 해결 완료. 핵심 데이터 흐름(5단면)은 한 줄로 일관됨. v1.2 최종이익액·v1.3 brand 통합·v1.4 범위 필터까지 매핑 정합성 유지.

---

## 2. 5단면 한 줄 매핑표 (v1.4 — 17 도메인 필드)

| # | 표시 라벨 / 사용자 식별자 | ① Excel letter | ② Pipeline 필드 (`EnrichedRow`) | ③ DB 컬럼 (`cal_amount`) | ④ Server Action 응답 키 | ⑤ UI accessorKey / 라벨 | 통과 |
|---|------|----|----|----|----|----|----|
| 1 | 매출일 | `sales.C` | `salesDate: string\|null` | — | — | `salesDate` / "매출일" | OK |
| 2 | 온라인주문번호 | `sales.AE` (join key) | `onlineOrderNo` | — | — | `onlineOrderNo` / "온라인주문번호" | OK |
| 3 | 상품코드 | `brand.Y` (after join, key `brand.E ↔ sales.AE`) | `productCode` | `cal_amount.product_code` | `CalAmount.productCode`, `getCalAmountMap` Map key | `productCode` / "상품코드" | OK |
| 4 | 상품명 (v1.3 AG→AH) | `brand.AH` | `productName` | — | — | `productName` / "상품명" (truncate) | OK |
| 5 | **브랜드명** (v1.3) | `brand.BF` | `brandName` | — | — | `brandName` / "브랜드명" (truncate) | OK |
| 6 | 매출액 | `sales.K` | `K: number\|null` | — | — | `K` / "매출액" (`numericColumn`) | OK |
| 7 | 공급가 | `sales.L` | `L` | — | — | `L` / "공급가" | OK |
| 8 | (숨김) 원가 | `sales.M` | `M` | — | — | 컬럼 정의 없음 (v2 토글) | OK (의도) |
| 9 | **물류비** (v1.2) | `sales.Q` | `Q` | — | — | `Q` / "물류비" | OK |
| 10 | 이익액(공급가) | `sales.R` | `R` | — | — | `R` / "이익액" | OK |
| 11 | (숨김) 이익률(공급가) | `sales.S` | `S` | — | — | 컬럼 정의 없음 | OK (의도) |
| 12 | (숨김) 이익액(판매가) | `sales.T` | `T` | — | — | 컬럼 정의 없음 | OK (의도) |
| 13 | (숨김) 이익률(판매가) | `sales.U` | `U` | — | — | 컬럼 정의 없음 | OK (의도) |
| 14 | 수수료 | (계산) `1 - L/K` | `commissionRate` | — | — | `commissionRate` / "수수료" (`percentColumn`) | OK |
| 15 | 후정산금 | (계산) `K × (commissionRate/2)` | `settlementAmount` | — | — | `settlementAmount` / "후정산금" | OK |
| 16 | 추가후정산금 | `cal_amount.B` 룩업 | `extraSettlement: number\|null` | `extra_settlement integer NOT NULL` | `CalAmount.extraSettlement`, `getCalAmountMap` Map value | `extraSettlement` / "추가후정산금" (인터랙티브 셀) | OK |
| 17 | 총마진액 | (계산) `R + settlementAmount + (extraSettlement ?? 0)` | `totalMargin` | — | — | `totalMargin` / "총마진액" | OK |
| 18 | 총마진율 | (계산) `totalMargin / L` | `totalMarginRate` | — | — | `totalMarginRate` / "총마진율" | OK |
| 19 | **최종이익액** (v1.2) | (계산) `R - Q` | `finalProfit` | — | — | `finalProfit` / "최종이익액" | OK |
| 20 | **최종이익률** (v1.2) | (계산) `(R-Q) / L` | `finalProfitRate` | — | — | `finalProfitRate` / "최종이익률" (`percentColumn`) | OK |

매핑 정합성: 20개 모두 통과. UI 표시 16개 + 숨김 4개. CSV 출력(`CSV_HEADERS`) 16개 = 표시 컬럼과 동일 키·동일 순서.

---

## 3. 마일스톤 항목 점검 (v1.1 → v1.4 누적)

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | append-only 일관성 (v1.1) | OK | schema 4컬럼 + UNIQUE 제거 + id DESC + DISTINCT ON. 5단면 일치 |
| 2 | 공용 Dialog props 정합성 | OK | 분석/관리 양쪽 호출 시그니처 일치 |
| 3 | EnrichedRow ↔ 명세 §4-3 ↔ UI ↔ CSV | OK | 표시 16개 + 숨김 4개 = 20개. CSV 16개 일치 |
| 4 | 추가후정산금 셀 동작 통일 (mode 분기 없음) | OK | `cellDialog = {open, productCode}` 만 보유, `appendCalAmount` 한 종류, 시각 분기는 `isMissing` boolean |
| 5 | 클라이언트 자동 재계산 (v1.2 Q 인자 포함) | OK | `applyCalAmountUpdate` 가 `computeProfit({K, L, Q, R, extraSettlement})` 호출 → 총마진/최종이익액 모두 재계산. P6 정리로 `calAmountMap` state 폐기 |
| 6 | null vs 0 의미 보존 | OK | pipeline `extraSettlement === null` 유지, `missingExtraCount` 는 null 만 카운트, UI `isMissing = r.extraSettlement == null`, CSV `v == null ? "" : ...` |
| 7 | CSV 컬럼 순서/포맷 (v1.4 — 16개) | OK | `CSV_HEADERS` 16개 키·순서 = 표시 컬럼. UTF-8 BOM, 정수 raw, 비율 `xx.x%`, 파일명 `minus_${todayYMD()}.csv` |
| 8 | KPI 모바일 grid (v1.4 — 6장) | OK | `grid-cols-2 md:grid-cols-6` — 모바일 3행×2열 배치 |
| 9 | **마이너스 판정 기준 확정** (v1.4) | OK | KPI "마이너스 건수" 활성 (`총마진율 < 0%` 고정 정의, 빨강). 범위 필터(min/max + inside/outside) 별도 |
| 10 | base-ui Button + `render` 비-button 패턴 | OK | `nativeButton={false}` 처리됨 (`minus-analyze-client.tsx` 파일 선택 버튼) |
| 11 | **v1.2 최종이익액/최종이익률** | OK | mapping(Q) ↔ types(Q/finalProfit/finalProfitRate) ↔ calc ↔ pipeline ↔ UI 컬럼 3개 ↔ CSV 3개 일관. totalMargin 정의는 Q 무관 유지 |
| 12 | **v1.3 brand 통합 + 상품명 AH** | OK | `revenue_profit_brand` + `productName: AH` + `brandName: BF`. 매칭률 product 와 동일 (1378/1467). 검색 매칭에 brandName 포함 |
| 13 | **v1.4 합계행 제외** | OK | `parse.ts` `sliceDataRows` 가 A열 `총계/합계/소계/총합/total/summary` 행 자동 제외. 테스트 2건 신규 |
| 14 | **v1.4 범위 필터** | OK | `parsePercent` % → 비율 변환, min/max + inside/outside 모드, null 자동 제외, min>max invalid 처리, chip 표시·해제, 기본 `-3 ~ 3 inside` |
| 15 | **v1.4 "계산 불가" KPI 카드 신규** | OK | `ToggleKpiCard` 로 일반화 (누락/계산불가 양쪽 사용). `totalMarginRate=null` 카운트 + 클릭 토글 + chip |

---

## 4. 발견된 이슈 — 모두 처리 완료

### Issue #1 — `_workspace/03_schema_minus.md` 가 upsert 시절 그대로 ✅ 해결

- 처리 일자: 2026-05-24 (P6 minor 정리)
- 처리 내용: 통째 재작성. append-only v1.1 모델 반영 (4컬럼 + UNIQUE 제거 + `appendCalAmount`/`deleteCalAmount(id)`/`getCalAmountMap` DISTINCT ON + Supabase Pooler 2종 가이드 + 마이그레이션 0000/0001/0002 현황)

### Issue #2 — `calAmountMap` state 가 read 사용처 없음 ✅ 해결

- 처리 일자: 2026-05-24 (P6 minor 정리)
- 처리 내용: state 통째 제거. `freshMap → calAmountMap` 으로 인라인. 분석 시작 시점의 fresh fetch + 행 재계산은 `rows` state 의 각 행 `extraSettlement` 로 처리됨 — Map 보관 불필요
- 결과: lint warnings 3 → 2 (남은 2건은 TanStack `useReactTable` 호환성 한계, 무시 OK)

### Issue #3 — 이력 셀(✏️) 클릭 시 `defaultValues.extraSettlement` 미주입 (확인용) ✅ 통과

- 명세 §4-5 시나리오 5-12: "이력 있는 행을 클릭해도 `extraSettlement` 는 빈 칸으로 시작"
- 코드: `defaultValues={ cellDialog.productCode != null ? { productCode: cellDialog.productCode } : undefined }` — `extraSettlement` 미주입 → 빈 칸으로 시작
- 결과: OK (명세대로)

### Issue #4 — sales 의 합계 행이 KPI 합산에 포함 ✅ 해결 (v1.4)

- 발견: 사용자가 시연 중 "총 매출이 두 배로 보임" 보고
- 원인: `sales_status_basic.xlsx` 마지막 행 A="총계" 가 `sliceDataRows` 의 빈 행 필터에만 의존해 통과
- 처리: `parse.ts` `sliceDataRows` 에 A열 키워드 매칭(`총계/합계/소계/총합/total/summary`) 추가
- 검증: 신규 테스트 2건(정상 합계행 + 라벨 변형) 추가, 모두 통과

### Issue #5 — 마이너스 범위 필터 inside/outside 의미 거꾸로 ✅ 해결 (v1.4)

- 발견: 사용자가 시연 중 "필터가 적용 안 되는 것처럼 보임" 보고
- 원인: 기본 `outside` (구간 밖만 보기) 였는데, 사용자 운영 관행상 ±3% 안이 "마진 낮은 이상치" — `inside` 가 자연스러움. 기본값이 거꾸로
- 처리: 기본 모드 `inside` 로 변경, Select 라벨도 의미 정정 ("구간 안만 (이상치)" / "구간 밖만 (정상치)")

### 그 외 (참고)

- `useReactTable` lint warning 2건(`cal-amount-list-client.tsx:223`, `minus-analyze-client.tsx:585`): TanStack Table API 가 React Compiler 와 호환되지 않아 컴파일러 메모이제이션 skip — TanStack 알려진 한계, 동작 영향 없음. 무시 가능
- `revenue_profit_brand` 의 `headerRows = 2` 는 v1.3 시점 실데이터로 확인 완료 (`mapping.ts:33` 주석 갱신됨)
- sales/brand 매칭 실패 84건 (5.7%): brand export 시점/조건 차이로 코드 변경 불가능한 데이터 누락. 운영팀 사이드 처리

---

## 5. P7 (Vercel 배포) 전 blocker

**없음.** P6 발견 이슈 모두 해결. v1.4 까지 P7 진입 가능.

권장 처리 순서: 이미 정리 완료 → P7 배포 진입.

---

## 6. 자동 검증 결과 원문 (v1.4 시점)

```
$ pnpm tsc --noEmit
exit=0  (no output)

$ pnpm test
 Test Files  2 passed (2)
      Tests  26 passed (26)
   Duration  ≈430ms

 - calc.test.ts: 16 케이스 (기존 9 + v1.2 finalProfit/finalProfitRate 7건)
 - pipeline.test.ts: 10 케이스 (기존 8 + v1.4 합계행 제외 2건)

$ pnpm lint
✖ 2 problems (0 errors, 2 warnings)
  - cal-amount-list-client.tsx:223  Compilation Skipped (TanStack useReactTable)
  - minus-analyze-client.tsx:585    Compilation Skipped (TanStack useReactTable)
```

---

## 7. 보류 항목 (마이너스 외, 또는 v2 권장)

| 항목 | 상태 | 메모 |
|------|------|------|
| 단품/복합 구분(product_master.BD) | **보류** | 메모리 `project_pending_product_master.md` — 채널별 상품코드 마스터보드 마련 후 재개 |
| 숨김 컬럼 토글 (M/T/S/U) | v2 | 명세 §8-4 |
| 대용량 파일 Web Worker | v2 | 현재는 메인 스레드 |
| 인증/로그인 | v2 | 헤더 정적 이메일 |
| 운영팀: brand 매칭 84건 (5.7%) | 외부 | export 정합성 정렬 |

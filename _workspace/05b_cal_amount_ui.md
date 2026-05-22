# P5-2: 추가후정산금 관리 페이지 (`/cal-amount`) — 구현 보고

> 출처 명세: `_workspace/02_uiux_minus.md` §5
> 구현자: `next-builder` 에이전트
> 일자: 2026-05-22

---

## 1. 생성·수정 파일 목록

| 경로 | 종류 | 설명 |
|------|------|------|
| `src/components/ui/form.tsx` | **신규** | shadcn `form` 컴포넌트 표준 코드 직접 작성 (registry add 가 `base-nova` 스타일 미지원으로 무반응). `Form` / `FormField` / `FormItem` / `FormLabel` / `FormControl` / `FormDescription` / `FormMessage` + 자체 `Slot` 구현 포함. `@radix-ui/react-slot` 의존성 추가 없음 |
| `src/components/cal-amount-form-dialog.tsx` | **신규** | **공용** 추가/수정 Dialog. 분석 페이지(§4)와 관리 페이지(§5) 양쪽에서 import. props: `open / onOpenChange / mode("create"\|"edit") / defaultValues / lockProductCode / onSaved`. react-hook-form + zod(폼 전용 string 스키마) + `upsertCalAmount` Server Action 직접 호출. 실패 시 unique 위반 catch → `productCode` 필드 에러 매핑 + 폼 상단 `Alert` + `toast.error` |
| `src/app/(dashboard)/cal-amount/page.tsx` | **수정** | placeholder → Server Component. `searchParams` (`q`, `page`) 를 await, `listCalAmount({search, page, pageSize:100})` fetch → client 위임 |
| `src/app/(dashboard)/cal-amount/cal-amount-list-client.tsx` | **신규** | 메인 클라이언트 컴포넌트. 헤더 / import 안내 Alert / 검색(300ms debounce, URL 동기화) / TanStack 테이블(정렬: 상품코드·금액·수정일) / 행 클릭 = 수정 Dialog / 액션 컬럼(데스크탑 ✏️🗑, 모바일 `DropdownMenu`) / 페이지네이션(자체 Button 묶음) / 삭제 확인 Dialog / 빈·검색결과없음·일반 4상태 분기 |

빌드 / 린트 / 타입체크 결과:
- `pnpm tsc --noEmit` ✅ 통과 (에러 0)
- `pnpm lint` ✅ 통과 (에러 0). 경고 1건은 React Compiler ↔ TanStack `useReactTable` 비호환 안내(memo 스킵)로 동작에는 영향 없음.
- `pnpm build` ✅ 성공. `/cal-amount` 는 `searchParams` 의존으로 dynamic (`ƒ`) 로 분류됨.

---

## 2. dev 서버에서 확인할 시나리오 5개

> 실행: `pnpm dev` → 브라우저 `http://localhost:3000/cal-amount`

1. **시나리오 1 — 추가 (명세 §5-5 시나리오 1)**
   - 우측 상단 **[+ 추가]** 클릭 → Dialog 열리고 `productCode` 자동 포커스.
   - `productCode = TEST-001`, `productName = 테스트 상품`, `extraSettlement = 1500`, `memo = (빈칸)` → **저장**.
   - 토스트 "추가됨" + Dialog 닫힘 + 테이블 상단에 `TEST-001` 행 표시.
   - 같은 코드로 다시 추가 시도 → upsert 동작이므로 값이 갱신됨(중복 에러는 자세히 보려면 다른 productCode 시도).

2. **시나리오 2 — 수정 (명세 §5-5 시나리오 2)**
   - 임의 행 클릭(또는 ✏️ 아이콘) → Dialog 열림. `productCode` 는 자유 편집 가능(`lockProductCode=false`), 기존 값 채워짐.
   - `extraSettlement` 값을 변경 → **저장** → 토스트 "저장됨" + 테이블의 해당 행 갱신(수정일 갱신).

3. **시나리오 3 — 삭제 후 영향 안내 (명세 §5-5 시나리오 3)**
   - 행의 🗑 클릭 → 삭제 확인 Dialog 열림.
   - 본문 문구: "분석 시 해당 상품은 추가후정산금 누락으로 분류됩니다." (명세 원문 "0으로 처리됩니다" 를 우리 정의에 맞게 변경)
   - **삭제** 클릭 → 토스트 "삭제됨: …" + 행이 사라짐.

4. **시나리오 검색·페이지네이션·URL 동기화**
   - 검색 입력란에 `TEST` 타이핑 → 300ms 후 URL이 `/cal-amount?q=TEST` 로 바뀌고 결과 갱신.
   - X 버튼 또는 검색어를 비움 → URL `q` 제거.
   - 1페이지 초과 데이터 환경에서 페이지네이션 ‹/› 또는 숫자 버튼 클릭 → `/cal-amount?page=2` 로 URL 변경, 동일 페이지로 새로고침 시 그대로 유지.
   - 페이지 이동 중에는 "불러오는 중…" 인디케이터 표시(`useTransition`).

5. **시나리오 4상태 일부 (빈·검색결과없음·에러)**
   - **빈 상태**: 임시로 DB 가 비어있다고 가정하면, 안내 Alert가 "아직 등록된 추가후정산금이 없습니다" + 점선 박스 "등록된 추가후정산금이 없습니다" + [추가] CTA 노출.
   - **검색결과 0건**: 검색에 매칭 없는 단어(예: `ZZZNOMATCH`) 입력 → "조건에 맞는 항목이 없습니다." + **[검색 초기화]** 버튼.
   - **에러**: Dialog 에서 잘못된 형식(예: 상품코드에 한글)으로 저장 시도 → 필드 인라인 에러 "영문/숫자/하이픈/언더바만 입력 가능합니다" 표시 + 저장 차단.
   - **삭제 실패** 등 서버 오류는 `toast.error("삭제 실패: …")` 로 알림 (Dialog 유지).

---

## 3. shadcn `form` 컴포넌트 설치 결과

- 명령: `pnpm dlx shadcn@latest add form --yes --overwrite`
- 결과: **실패(무반응)**. `components.json` 의 `style: "base-nova"` 에는 `form` 컴포넌트가 등록돼 있지 않은 것으로 보임. 두 차례 실행 모두 `✔ Checking registry.` 만 출력하고 파일이 생성되지 않음.
- 대응: 명세 §5-2 의 지시에 따라 **표준 shadcn `form` 코드를 `src/components/ui/form.tsx` 로 직접 작성**. `react-hook-form` / `zod` / `@hookform/resolvers` / `label` 은 이미 설치돼 있어 추가 의존성 없음. `@radix-ui/react-slot` 도 도입하지 않기 위해 5줄짜리 자체 `Slot` 헬퍼로 대체.

---

## 4. 본 단계에서 보류한 항목

1. **웹 UI 기반 추가 import** (§5-5 시나리오 4) — 명세 §8 가정 7 에 따라 보류. 안내 Alert 본문에 "별도 스크립트(`pnpm tsx scripts/import-cal-amount.ts`)" 라고 명시.
2. **다중 정렬 / 정렬에 따른 서버 재조회** — 현재 서버는 `productCode asc` 고정 정렬, TanStack 정렬은 현재 페이지 행 한정. 행 수가 100을 초과해 페이지를 넘기는 경우, 정렬은 페이지 단위로만 적용됨. 향후 `sort/dir` URL 파라미터 + Server Action 옵션으로 확장 여지.
3. **삭제 후 UI 즉시 제거 + 토스트의 영향 행 수 안내** — 본 단계는 `router.refresh()` 로 단순 재페치. 분석 페이지 연동(영향 행 수) 은 §4 단계에서 추가.
4. **컬럼별 검색** — 현재는 `productCode | productName` 통합 검색만. 별도 컬럼 필터는 v2.

---

## 5. 다음 단계(`/minus` 분석 페이지)에서 재사용 가능한 컴포넌트·패턴

- ✅ **`CalAmountFormDialog` (공용)** — 분석 페이지의 결과 테이블 "추가후정산금" 셀 클릭 시 그대로 import. `lockProductCode={true}` + `defaultValues={{ productCode, productName }}` 로 호출하면 productCode/productName 자동 주입 + 첫 포커스가 `extraSettlement` 로 이동(이미 구현됨). `onSaved` 콜백으로 `calAmountMap` 즉시 갱신 + 일괄 재계산 트리거 가능.
- ✅ **`Form` 헬퍼들** (`src/components/ui/form.tsx`) — 다른 폼(예: 향후 그룹 업로드 / 검색 옵션 폼)에서 재사용.
- ✅ **`upsertCalAmount` Server Action** — 분석 페이지에서 동일하게 호출. 폼 다이얼로그가 이미 호출하므로 별도 wrapping 불필요.
- ✅ **`pageWindow` (페이지네이션 헬퍼)** + **`PageNav` 컴포넌트** — `cal-amount-list-client.tsx` 내부 로컬이지만, 분석 페이지에서도 동일한 ‹ 1 … 124 › 형태가 필요. 본격 재사용 시 `src/components/pagination.tsx` 로 추출 권장.
- ✅ **숫자/날짜 포맷터** (`formatKRW`, `formatDateTime`) — 분석 페이지 다수 셀에서 재사용. `src/lib/format.ts` 로 추출 권장.
- ✅ **URL ↔ 클라이언트 상태 동기화 패턴** (`useSearchParams` + `useRouter().replace` + 300ms debounce + `useTransition`) — 분석 페이지의 검색 + 누락 필터 chip 토글에 동일 적용 가능.
- ✅ **shadcn `Dialog` + Server Action 호출 + 에러 분기** — 동일 패턴(unique 위반 → 필드 에러 매핑, 일반 에러 → 폼 상단 Alert, `toast.error`) 을 다른 mutation 폼에 그대로 적용.
- ✅ **TanStack `manualPagination` + 서버 ORDER BY 고정** — 분석 페이지에서도 100건 단위 페이지네이션 그대로 사용 가능.
- ⚠️ **React Compiler ↔ TanStack 호환 경고** — `useReactTable` 사용 컴포넌트는 React Compiler memo 스킵됨. 분석 페이지에서 큰 데이터를 다룰 때 `useMemo` 로 컬럼 정의 / 데이터 변환을 명시적으로 캐시할 것.

---

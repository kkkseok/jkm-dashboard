# 상품 마스터 — UI/UX 명세 (v1.0)

> 작성: 2026-05-27 / 작성자: `uiux-designer` 에이전트
> 입력: `_workspace/01_requirements_products.md`, `_workspace/02_uiux_minus.md` (v1.4), `ux-patterns/skill.md`, `shadcn-patterns/skill.md`
> 기존 코드 참조: `src/app/(dashboard)/cal-amount/` (Server Component → Client 패턴), `src/components/cal-amount-form-dialog.tsx` (공용 Dialog), `src/app/(dashboard)/minus/minus-analyze-client.tsx` (SalesTypeFilter Popover, chip 영역, 다중 필터 룰)
> 대상 구현자: `next-builder` (P5)

---

## 1. 목적 / 사용자 시나리오

판매채널 운영 담당자가 **브랜드 × 채널별로 다른 상품코드**와 **단품/복합 구분**을 한 곳에서 관리한다. 매일 운영 빈도는 낮으며(주 1~3회), 초기에는 엑셀로 수백~수천 건을 일괄 등록하고 이후 일상 운영은 웹 CRUD 로 한다.

핵심 사용 흐름:
1. (최초) `/products` 진입 → "엑셀 import" → 양식 다운로드 → 수천 건 등록.
2. (일상) 검색·필터로 행을 찾아 ✏️ 수정, 신규 상품은 "+ 추가" Dialog.
3. (분석 시) `/minus` 결과 테이블에서 **"구분"** 컬럼·필터로 단품/복합/미매칭 행 분리. CSV 다운로드는 17컬럼.

---

## 2. 정보 아키텍처 (사이드바)

`src/components/sidebar.tsx` 의 `NAV_SECTIONS` 에 항목 추가. **`"관리"` 섹션 첫 번째 위치** (후정산금 관리보다 위 — 자주 진입하는 마스터 데이터이므로 상위 노출).

```
┌────────────────────────────┐
│  JKM Dashboard             │
├────────────────────────────┤
│  분석                       │
│   ▸ 마이너스 매출이익률  ★ │
│   ▸ 품절 관리 (예정)        │
│   ▸ 그룹 업로드 (예정)      │
├────────────────────────────┤
│  관리                       │
│   ▸ 상품 마스터           ◀ │ ← NEW (/products)
│   ▸ 후정산금 관리           │ ← /cal-amount
├────────────────────────────┤
│  v0.1.0 · seokcess@…       │
└────────────────────────────┘
```

| URL | 라벨 | 비고 |
|-----|------|------|
| `/products` | 상품 마스터 | 본 명세 화면 A |

스타일/활성 표시 규칙은 `cal-amount` 와 완전히 동일 (`border-l-2 border-primary bg-accent text-accent-foreground`).

---

## 3. 디자인 토큰 (재확인)

`02_uiux_minus.md` §3 의 토큰을 그대로 채택. 본 화면 특수 토큰은 다음 3개만:

| 토큰 | 값 | 용도 |
|------|----|------|
| 단품 Badge | `variant="secondary"` (기본 slate) | "구분" 셀의 단품 표시 |
| 복합 Badge | `variant="default"` (primary blue) | "구분" 셀의 복합 표시 — 시각적으로 단품과 분리 |
| 미매칭 Badge | `variant="outline"` + `text-muted-foreground` | `/minus` 의 "구분" 셀에서만 사용 (상품 마스터 페이지에는 미매칭이 없음) |

> 단품/복합 색 분기는 인쇄/색맹 대비를 위해 텍스트 라벨("단품"/"복합")을 항상 함께 노출. 색만으로 구분하지 않는다.

---

## 4. 화면 A — 상품 마스터 (`/products`)

### 4-1. 페이지 골격 (Server Component → Client)

`cal-amount/page.tsx` 와 동일 패턴.

- `src/app/(dashboard)/products/page.tsx` (Server Component) — `searchParams` 받아 `listProducts({ search, channel, type, page, sort, dir })` 호출, 초기 데이터/total 을 client 에 props 로 주입.
- `src/app/(dashboard)/products/products-list-client.tsx` ("use client") — 검색 input 로컬 상태 + 300ms debounce + URL `router.replace`, TanStack table, Add/Edit/Delete Dialog 트리거.
- `src/app/(dashboard)/products/product-form-dialog.tsx` — **신규/수정 공용** Dialog (cal-amount-form-dialog 패턴 답습, mode prop 으로 분기).
- `src/app/(dashboard)/products/product-import-dialog.tsx` — 엑셀 일괄 import 전용 Dialog.

> Server Action 정의 위치 예상: `src/lib/products/actions.ts` — `listProducts`, `createProduct`, `updateProduct`, `deleteProduct`, `importProducts(file)`, `getDistinctChannelNames()`. P3/P4 에서 확정.

### 4-2. ASCII 와이어프레임 — 메인 (데이터 있음)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] JKM Dashboard                                                            │
├─────────────┬────────────────────────────────────────────────────────────────┤
│ 사이드바     │  상품 마스터              [↓ 양식 다운로드] [엑셀 import] [+추가]│
│             │  채널별 상품코드과 단품/복합 구분을 관리합니다.                  │
│             │                                                                │
│             │  ┌─ 안내 ───────────────────────────────────────────────────┐  │
│             │  │ ⓘ 등록된 상품 3,421건  ·  채널 12개  ·  복합 482건 (14%) │  │
│             │  │  같은 논리 상품이 채널마다 다른 상품코드를 갖는 경우 각각 │  │
│             │  │  별도 행으로 등록하세요. 상품코드는 시스템 전체에서 고유  │  │
│             │  │  (UNIQUE) 입니다.                                         │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │                                                                │
│             │  ┌─ 검색 / 필터 ────────────────────────────────────────────┐  │
│             │  │ [상품코드/상품명/브랜드/채널 검색…  🔍]   [채널 ▾] [구분▾]│  │
│             │  │ 적용된 필터: [채널: A-CJ온스타일 ×] [구분: 복합 ×]        │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │                                                                │
│             │  ┌─ 목록 테이블 ────────────────────────────────────────────┐  │
│             │  │ 상품코드 ▼│ 채널명 ▼  │ 브랜드 ▼│ 상품명  │ 구분 │등록일│액션│
│             │  │ ABC-001   │ A-CJ온스…│ 글리치  │ 워시팩  │단품 │5/24 │✏️🗑│
│             │  │ ABC-001b  │ A-쿠팡   │ 글리치  │ 워시팩  │단품 │5/24 │✏️🗑│
│             │  │ ABC-002   │ A-CJ온스…│ 글리치  │ 세트A   │복합 │5/24 │✏️🗑│
│             │  │ XYZ-555   │ [B2B]    │ 모브   │ 콤보2   │복합 │5/23 │✏️🗑│
│             │  │ …                                                         │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │  3,421건 중 1–100  [< 이전] [1][2]…[35] [다음 >]                │
└─────────────┴────────────────────────────────────────────────────────────────┘
```

**컬럼 폭/정렬 가이드**
- 상품코드: `font-mono text-xs`, 좌측, `min-w-[8rem]`, 정렬 가능 (asc 기본).
- 채널명: 좌측, `max-w-[14rem] truncate` + `title` 툴팁, 정렬 가능.
- 브랜드명: 좌측, `max-w-[10rem] truncate`, 정렬 가능.
- 상품명: 좌측, `truncate` + `title`, 정렬 불가 (검색으로 대체).
- 구분: 가운데, Badge — 단품 secondary / 복합 primary. 정렬 가능 (단품→복합 또는 역순).
- 등록일: 우측, `tabular-nums text-muted-foreground`, 정렬 가능 (기본 desc — 최신 위).
- 액션: 우측, ✏️ + 🗑 두 ghost icon-sm 버튼.

**기본 정렬**: 등록일 DESC. URL `?sort=createdAt&dir=desc`.

### 4-3. ASCII 와이어프레임 — 4상태

**(a) 빈 상태 — 0건 등록**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  상품 마스터              [↓ 양식 다운로드] [엑셀 import] [+ 추가]            │
│                                                                              │
│   ┌──────────────────────── 점선 박스 ────────────────────────────────────┐ │
│   │                                                                       │ │
│   │   📦  아직 등록된 상품이 없습니다                                       │ │
│   │                                                                       │ │
│   │   초기 등록은 엑셀 import 가 빠릅니다.                                  │ │
│   │   양식을 다운받아 작성한 뒤 업로드하세요.                                │ │
│   │                                                                       │ │
│   │      [↓ 양식 다운로드]   [엑셀 import]   [한 건만 추가하기]              │ │
│   │                                                                       │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**(b) 로딩 상태**
- 페이지네이션 이동 / 검색 결과 갱신 중: TanStack 표는 그대로 두고 페이지네이션 옆 `<span className="ml-2 text-xs">불러오는 중…</span>` (cal-amount 와 동일).
- 최초 page.tsx Server Component 진입은 Next.js `loading.tsx` 로 `Skeleton` 10행 출력.

**(c) 에러 상태**
- Server Action 에러 → Next.js `error.tsx` (페이지 단위). 명세: `<Alert variant="destructive"><AlertTitle>목록을 불러오지 못했습니다</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>` + "다시 시도" 버튼 (`reset()`).
- 행별 저장/삭제 실패는 Dialog 내부에서 inline `Alert` + `toast.error`.

**(d) 검색 결과 0건**
```
   ┌─ 점선 박스 ──────────────────────────────────────────┐
   │  조건에 맞는 상품이 없습니다.                          │
   │  [검색 초기화]  [필터 초기화]                          │
   └─────────────────────────────────────────────────────┘
```
- 검색 input 만 있을 땐 "검색 초기화", 필터 chip 도 있을 땐 두 버튼 모두 노출.

### 4-4. 컴포넌트 명세표

| 영역 | shadcn 컴포넌트 | 역할 / 주요 인터랙션 |
|------|-----------------|-----|
| 페이지 헤더 | `h1` + `Button` × 3 | "양식 다운로드" outline / "엑셀 import" outline / "+ 추가" default. 빈 상태에서도 헤더 버튼은 그대로 노출 |
| 안내 카드 | `Alert` (default) | 등록 건수 + 채널 unique 수 + 복합 비율 요약 (1줄). 운영 컨텍스트 즉시 파악 |
| 검색 입력 | `Input` + `SearchIcon` + 클리어 X | 300ms debounce. `상품코드 OR 상품명 OR 브랜드 OR 채널` 부분일치. URL `q=` |
| 채널 필터 | `Popover` + `Command` (cal-amount/minus 의 `SalesTypeFilter` 컴포넌트 패턴 재사용) | unique `channel_name` 값 + 행 수 노출. 다중 선택. URL `channel=...,...` |
| 구분 필터 | `Select` (단순 3옵션이라 Popover/Command 불필요) | "전체" / "단품만" / "복합만". URL `type=single\|composite` |
| 적용된 필터 chip | `Badge variant="secondary"` + X 버튼 | minus 페이지 chip 영역과 동일한 코드 패턴. 채널·구분 각각 X 로 해제 |
| 목록 테이블 | `Table`/`TableHeader`/… + TanStack | `manualPagination: true`, 정렬 가능 헤더 위 `aria-sort`, 행 hover `bg-muted/40` |
| 구분 셀 | `Badge` (variant 분기) | `is_composite ? "복합" : "단품"` — 색·텍스트 둘 다 |
| 액션 컬럼 | `Button variant="ghost" size="icon-sm"` × 2 | ✏️ → 수정 Dialog (현재 행 데이터 prefill) / 🗑 → 삭제 확인 Dialog |
| 신규/수정 Dialog | `Dialog` + `Form` + `react-hook-form` + `zod` | §4-5. 같은 컴포넌트, `mode: "create" \| "edit"` prop |
| 엑셀 import Dialog | `Dialog` (큰 — `sm:max-w-2xl`) | §4-6. 파일 선택 → 미리보기 → 결과 요약. cal_amount script 와 달리 UI 로 제공 (초기 대량 등록 필요) |
| 삭제 확인 Dialog | `Dialog` (cal-amount 와 동일) | 대상 productCode + 채널 + 상품명 노출. "이 상품은 마이너스 분석의 단품/복합 매칭에서 제외됩니다" 안내 |
| 페이지네이션 | `PageNav` (cal-amount 의 `PageNav` 컴포넌트 재사용) | 100건/페이지, window 표시 |
| 토스트 | `sonner` `toast.success` / `toast.error` | "추가됨: ABC-001" / "수정됨" / "삭제됨" / "import 완료 (성공 N · 실패 M · 건너뜀 K)" |

> 새 컴포넌트로 만들 가치가 있는 것: **`ProductChannelFilter`** (Popover+Command, 다중 선택). `SalesTypeFilter` 와 거의 동일하므로 P5 에서 **공통 `MultiSelectFilter` 추출 가능** — 단 본 단계에서는 그대로 복제해도 무방 (YAGNI 우선). 결정은 next-builder 에 위임.

### 4-5. 신규/수정 Dialog 명세

**ASCII**

```
              ┌─────────────────────────────────────────────────┐
              │ 상품 추가 / 상품 수정                        ✕   │
              ├─────────────────────────────────────────────────┤
              │ 상품코드 *                                       │
              │ [ABC-001                                       ] │
              │ (시스템 전체에서 고유. 영문/숫자/하이픈/언더바)   │
              │ ⚠ "ABC-001" 은 이미 등록되어 있습니다           │ ← 중복 인라인 에러
              │                                                  │
              │ 채널명 *                                         │
              │ [A-CJ온스타일(jkman2)                ▾]          │ ← Combobox: 자유 입력 + 자동완성
              │ (sales.A 의 값을 참고로 노출. 자유 입력 가능)     │
              │                                                  │
              │ 브랜드명 *                                       │
              │ [글리치                                        ] │
              │                                                  │
              │ 상품명 *                                         │
              │ [워시팩                                        ] │
              │                                                  │
              │ 구분 *                                           │
              │  ( ) 단품      (●) 복합                          │ ← RadioGroup
              │                                                  │
              ├─────────────────────────────────────────────────┤
              │                            [취소]  [저장]        │
              └─────────────────────────────────────────────────┘
```

**필드 명세**

| 필드 | 라벨 | 컴포넌트 | 필수 | zod 검증 | 에러 메시지 |
|------|------|----------|-----|----------|------------|
| `productCode` | 상품코드 | `Input` (mode=edit 시 `readOnly` + `aria-readonly` — PK 변경 금지) | ✓ | `z.string().trim().min(1).max(64).regex(/^[\w-]+$/)` | 비어있음 / 64자 초과 / 형식 위반 메시지는 cal-amount 폼 동일 |
| 〃 (중복 검증) | — | — | — | Server Action 호출 시점 (debounce 500ms 후 onBlur) `checkProductCodeUnique(code)` | "이미 등록된 상품코드입니다" + 인라인 `text-destructive` + 저장 버튼 disabled |
| `channelName` | 채널명 | **Combobox** (`Popover` + `Command` + free input) | ✓ | `z.string().trim().min(1).max(128)` | 비어있음 / 길이 위반 |
| `brandName` | 브랜드명 | `Input` | ✓ | `z.string().trim().min(1).max(64)` | 동일 |
| `productName` | 상품명 | `Input` | ✓ | `z.string().trim().min(1).max(128)` | 동일 |
| `isComposite` | 구분 | `RadioGroup` (2옵션) — base-ui `RadioGroup` 또는 라벨된 두 radio | ✓ | `z.boolean()` | 비어있음(폼 기본값 false=단품 으로 둘지 사용자 결정 필요 — §7 표 참조) |

**상품코드 중복 검증 UX 결정 — 사용자 선택 (§7)**

> 추천 안: **onBlur + Server Action 호출** (cal-amount append-only 와 달리 UNIQUE 제약 → 사용자가 저장 직전에 확신할 수 있도록 인라인 검증). submit 시에도 한 번 더 서버에서 확인 (race 대비).

처리:
1. 사용자 타이핑 → 인라인 zod 검증(형식)만 즉시 통과/실패.
2. focus blur 시 `checkProductCodeUnique(code)` 호출 → 500ms 이내 응답.
3. 중복이면 `<FormMessage>` 위치에 "이미 등록된 상품코드입니다" + `text-destructive`, **저장 버튼 disabled**.
4. submit 시 race 발생(다른 사용자가 동시 등록) → Server Action 의 `unique_violation` (Postgres 23505) 캐치 → 폼 상단 Alert + toast + 인라인 에러 갱신.
5. **수정 모드**에서는 productCode 가 readonly 이므로 unique 검증 호출하지 않음.

**채널명 input 결정 — 사용자 선택 (§7)**

> 추천 안: **Combobox (자유 입력 + 자동완성)**.

이유:
- sales.A 의 값은 분석 페이지 매출구분 필터에서 12개 unique 만 노출되었음(`02_uiux_minus.md` v1.3 SalesTypeFilter). 채널은 새로 추가될 수 있으므로 자유 입력은 필수.
- 그러나 오타·표기 불일치(`A-CJ` vs `A‑CJ`, 전각 차이)가 매칭 실패의 잠재 원인이므로 **이미 등록된 채널을 자동완성으로 제시**해 정합을 유도.
- Server Action `getDistinctChannelNames(): Promise<string[]>` 가 product_master + (옵션) 최근 분석 결과의 unique salesType 을 union 해 반환.
- 사용자가 자동완성에 없는 새 채널을 입력하면 → Combobox 하단에 "<span className="text-muted-foreground">새 채널 추가: <b>{입력값}</b></span>" 항목 표시, Enter 로 확정.

**검증/동작 요약**
- submit 중: 모든 입력/취소 버튼 `disabled`, 저장 버튼 텍스트 "저장 중…".
- 성공: Dialog 닫힘, `router.refresh()` (Server Component re-fetch), `toast.success("추가됨: {productCode}")` 또는 `"수정됨: {productCode}"`.
- 실패: Dialog 유지, 폼 상단 `Alert variant="destructive"` + `toast.error`.

### 4-6. 엑셀 일괄 Import Dialog 와이어

**ASCII (3단계 화면 전이)**

**(단계 1) 파일 선택**
```
       ┌──────────────────────────────────────────────────────────┐
       │ 엑셀로 상품 일괄 등록                                  ✕  │
       ├──────────────────────────────────────────────────────────┤
       │                                                          │
       │   ┌──── 점선 드롭존 ────────────────────────────────┐   │
       │   │ 📄  여기에 xlsx 파일을 끌어놓거나 클릭하세요      │   │
       │   │     [파일 선택]                                    │   │
       │   └──────────────────────────────────────────────────┘   │
       │                                                          │
       │   ⓘ 양식이 필요하면 [양식 다운로드] 를 먼저 누르세요.    │
       │                                                          │
       │   포맷:  • 첫 행 = 헤더                                  │
       │          • 필수 5컬럼 모두 채워져야 함                    │
       │          • 상품코드 중복 시 해당 행만 건너뜀              │
       ├──────────────────────────────────────────────────────────┤
       │                                          [취소]          │
       └──────────────────────────────────────────────────────────┘
```

**(단계 2) 미리보기 + 검증 결과 (파싱 후)**
```
       ┌──────────────────────────────────────────────────────────┐
       │ 엑셀로 상품 일괄 등록 — 미리보기                       ✕  │
       ├──────────────────────────────────────────────────────────┤
       │  📄 products_template_2026-05-27.xlsx (24 KB)            │
       │                                                          │
       │  검증 결과:                                              │
       │    ✓ 신규 등록 가능       1,284행                         │
       │    ⚠ 중복 (건너뜀)         87행  [↓ 자세히]              │
       │    ✗ 형식 오류 (제외)      12행  [↓ 자세히]              │
       │   ─────────────────────                                  │
       │     총 입력                1,383행                        │
       │                                                          │
       │  ┌─ 미리보기 (상위 5건) ───────────────────────────────┐ │
       │  │ 상품코드 │ 채널명 │ 브랜드 │ 상품명 │ 구분 │ 상태  │ │
       │  │ ABC-001  │ A-CJ…  │ 글리치 │ 워시팩 │ 단품 │ ✓     │ │
       │  │ ABC-002  │ A-쿠팡 │ 글리치 │ 세트A  │ 복합 │ ✓     │ │
       │  │ ABC-003  │ (빈)   │ 글리치 │ 콤보   │ 단품 │ ✗ 채널│ │
       │  │ ABC-001  │ A-쿠팡 │ 글리치 │ 워시팩 │ 단품 │ ⚠ 중복│ │
       │  │ XYZ-555  │ [B2B]  │ 모브   │ 콤보2  │ 복합 │ ✓     │ │
       │  └──────────────────────────────────────────────────────┘ │
       ├──────────────────────────────────────────────────────────┤
       │  ☐ 중복 코드는 기존 데이터로 덮어쓰기 (upsert)             │ ← 토글 (기본 off)
       │                                                          │
       │                    [다시 선택]  [취소]  [N건 등록]        │
       └──────────────────────────────────────────────────────────┘
```

**(단계 3) 등록 진행 / 완료**
```
       ┌──────────────────────────────────────────────────────────┐
       │ 엑셀로 상품 일괄 등록 — 완료                          ✕   │
       ├──────────────────────────────────────────────────────────┤
       │   ✅ 등록이 완료되었습니다.                                │
       │                                                          │
       │     성공     1,284건                                     │
       │     건너뜀     87건  (중복)                              │
       │     실패       12건  [실패 행 CSV 다운로드]              │
       │                                                          │
       ├──────────────────────────────────────────────────────────┤
       │                                              [확인]      │
       └──────────────────────────────────────────────────────────┘
```

**4상태 & 인터랙션**
- 빈 (단계 1) → 파일 선택 → 즉시 클라이언트 파싱 (SheetJS) → 단계 2 전환 (서버 호출 없음).
- 로딩 (단계 2 → 3): 등록 진행 중 큰 진행 표시 `Progress` 컴포넌트 또는 텍스트 "등록 중… 423 / 1,284" — Server Action `importProducts(rows)` 호출. 1,000행 단위로 chunk 호출 권장 (P4 결정).
- 에러 (단계 2 파싱 실패): `Alert variant="destructive"` "엑셀을 읽을 수 없습니다 (헤더 누락 등)" + "다시 선택" CTA.
- 에러 (단계 3 저장 실패): 부분 성공이 발생 가능 → 진행 텍스트 멈춘 위치까지 성공으로 표시 + 실패 사유 행 노출 + `toast.error`.
- 성공 (단계 3): `toast.success("import 완료 (성공 1,284 · 건너뜀 87 · 실패 12)")` + 목록 페이지 `router.refresh()` + Dialog 닫기 버튼 활성화.

**엑셀 컬럼 포맷 제안 (사용자 P3 확정 필요)**

> **사용자에게 두 가지 안을 제시하고 P3 에서 한쪽을 확정해야 한다.** UI 구현에는 영향이 없으나 양식 파일 (`docs/products_template.xlsx`) 과 import 파서가 의존.

| 컬럼 | 안 A (한글 헤더 — 추천) | 안 B (영어 키) | 필수 | 검증 |
|------|----------------------|---------------|------|------|
| 1 | `상품코드` | `productCode` | ✓ | 영문/숫자/-/_ , 64자 이하, **시트 내 중복 자체 건너뜀** |
| 2 | `채널명` | `channelName` | ✓ | 128자 이하, 공백 trim |
| 3 | `브랜드명` | `brandName` | ✓ | 64자 이하 |
| 4 | `상품명` | `productName` | ✓ | 128자 이하 |
| 5 | `구분` | `type` | ✓ | 안 A: `"단품"` / `"복합"` 문자열. 안 B: `"single"` / `"composite"` 또는 boolean `TRUE`/`FALSE` |

**안 A (한글 헤더) 권장 이유**
- 사용자가 운영팀과 엑셀을 직접 주고받는 환경. 한글 헤더가 의사소통/검수에 자연스러움.
- `excel-mapping/skill.md` 의 다른 입력 엑셀(`cal_amount.xlsx`)도 한글 헤더 기반.
- "구분" 값에 `단품`/`복합` 한글을 그대로 적는 게 RadioGroup UI 와 일관 (사용자가 같은 단어를 본다).
- 단점: 파서가 한글 비교에 의존 → 사용자가 오타("단푸ㅁ", "단 품")를 낼 위험. → import 파싱 시 `trim()` + `Map<string,boolean>` 으로 5개 동의어(`단품`/`single`/`s`/`복합`/`composite`/`c`) 까지 수용 권장.

**안 B (영어 키) 장점**
- 파서/스키마/DB 컬럼명과 1:1 매핑이라 디버깅 단순.
- 단점: 운영자가 익숙하지 않아 실수 가능성 높음.

**공통 규칙 (안 무관)**
- 첫 행은 헤더, 둘째 행부터 데이터.
- 빈 행(모든 셀 공백)은 건너뜀.
- 시트 이름은 첫 시트 고정 (`workbook.SheetNames[0]`).
- 같은 import 파일 내 상품코드 중복은 **첫 번째만 채택, 나머지 건너뜀** (단계 2 "건너뜀" 카운트에 포함).
- DB 와의 중복은 기본 건너뜀, 토글 ON 시 upsert (`isComposite`/`channelName`/`brandName`/`productName` 갱신).

### 4-7. 4상태 명세표 (페이지 + Dialog)

| 영역 | 빈 | 로딩 | 에러 | 성공 |
|------|----|------|------|------|
| 페이지 (목록) | 점선 박스 + "엑셀 import / 한 건 추가" CTA (§4-3 a) | 페이지 전환 시 페이지네이션 옆 "불러오는 중…" / 최초 로드는 `loading.tsx` Skeleton 10행 | `error.tsx` 페이지 단위 Alert + 재시도 버튼 | 테이블 + 페이지네이션 |
| 검색 결과 | 점선 박스 "조건에 맞는 상품이 없습니다" + 두 초기화 버튼 | 동일 | 동일 | 동일 |
| 신규/수정 Dialog | 신규: 빈 폼, productCode 자동 포커스. 수정: 행 데이터 prefill, productCode readonly, channelName 포커스 | submit 중 모든 input/취소 disabled, 저장 버튼 "저장 중…" | 폼 상단 `Alert variant="destructive"` + 인라인 FormMessage + `toast.error` | Dialog 닫힘 + `toast.success` + `router.refresh()` |
| 중복 검증 (productCode) | (빈 상태 없음) | onBlur 후 500ms 이내 응답 — 인라인 표시 없음(즉시 응답 가정) | 네트워크 실패: silent, submit 시점에 서버 재검증으로 대체 | 인라인 메시지 사라짐, 저장 버튼 활성화 |
| Import 단계 1 | dashed 드롭존 + 안내 | (해당 없음) | 파일 형식 오류: 슬롯 red + Alert "xlsx 파일만 지원" | 단계 2 전환 |
| Import 단계 2 | (해당 없음) | 파싱 1초 이내 자동 처리 | 헤더 누락 / 시트 비어있음: `Alert` "엑셀 형식 오류: {원인}" + 단계 1 복귀 CTA | 검증 결과 카운트 + 미리보기 5행 |
| Import 단계 3 | (해당 없음) | "등록 중… 423 / 1,284" 진행 텍스트 | 부분 성공/실패: 실패 행 목록 + "실패 행 CSV 다운로드" 버튼 | 성공 카운트 + 닫기 |
| 삭제 확인 Dialog | 대상 행 정보 노출 | "삭제 중…" 버튼 비활성 | `toast.error` Dialog 유지 | Dialog 닫힘 + `toast.success` + `router.refresh()` |

### 4-8. 검색·필터·정렬 인터랙션 상세

- **검색**: cal-amount 와 동일하게 `searchInput` 로컬 state + 300ms debounce → `router.replace('/products?q=...')`. clear X 버튼.
- **채널 필터**: minus 페이지의 `SalesTypeFilter` 와 동일한 Popover+Command. unique 채널 목록은 Server Component 가 별도 `getDistinctChannelNames()` 로 가져와 props 로 주입 (페이지 진입 시 1회). URL `channel=A-CJ온스타일(jkman2),A-쿠팡` (콤마 join).
- **구분 필터**: `Select` 한 개로 충분 (3옵션). URL `type=single|composite`. "전체" 선택 시 URL 제거.
- **정렬**: 헤더 클릭 → URL `sort=productCode&dir=asc`. 같은 컬럼 재클릭 = dir 토글. 다른 컬럼 클릭 = 새 컬럼 + asc.
- **chip 영역**: 검색어/채널/구분 chip 각각 X 로 해제. 검색·필터 둘 다 있을 때만 chip row 표시.
- **모두 초기화**: 검색·필터·chip 모두 비어있게 → URL 의 q/channel/type/sort/dir/page 전부 제거.

### 4-9. 키보드 / 접근성 메모

- **Tab 순서**: 사이드바 → 헤더 액션 3개(양식·import·추가) → 검색 input → (클리어 X 있을 때) → 채널 필터 버튼 → 구분 Select → chip X 버튼들 → 테이블 헤더 (정렬 가능 4개) → 행별 ✏️·🗑 → 페이지네이션.
- **Dialog 공통**: 열림 시 첫 필드 자동 포커스, `Esc` 닫기, `Enter` submit (단 textarea 가 없으므로 모든 input 에서 enter=submit). focus trap 은 base-ui Dialog 기본 동작.
- **신규 Dialog 최초 포커스**: `productCode`. **수정 Dialog 최초 포커스**: `channelName` (productCode 가 readonly 이므로).
- **RadioGroup (구분)**: Tab 으로 그룹 진입 후 ←/→ 또는 ↑/↓ 키로 옵션 이동. `aria-required="true"` + `role="radiogroup"`.
- **Combobox (채널명)**: Tab 으로 input 진입 → 타이핑 → ↓ 키로 자동완성 리스트 진입 → ↑↓ 이동, Enter 선택, Esc 닫기. base-ui Combobox 또는 `Command` + `Popover` 조합.
- **상품코드 중복 인라인 에러**: `<FormMessage>` 가 자동으로 `aria-describedby` 연결. 추가로 input 에 `aria-invalid="true"`.
- **Import Dialog 단계 2 미리보기 표**: 상태 컬럼의 ✓/⚠/✗ 아이콘은 `aria-hidden`, 인접 텍스트 ("중복" 등)가 스크린리더로 읽힘.
- **삭제 확인 버튼**: `variant="destructive"` + `aria-label="삭제 확정"`.
- **컬러 콘트라스트**: 단품 Badge (slate-100 bg + slate-900 text) ≒ 17:1, 복합 Badge (blue-600 bg + white text) ≒ 4.7:1 (AA 통과). 미매칭 Badge 의 muted-foreground 텍스트 on white ≒ 4.6:1 (경계, polish 단계에서 재확인).

### 4-10. 반응형

- `≥ lg`: 사이드바 240px + 본문. 테이블 7컬럼 한 줄 표시. 필터 영역은 검색·채널·구분·chip 이 모두 한 줄.
- `md (768~1023)`: 필터 영역 wrap 허용 (검색 첫 줄, 필터·chip 두 번째 줄).
- `< md`: 사이드바 `Sheet`. 헤더 액션 3개는 너비가 좁으면 `Dropdown` 으로 묶을 수 있으나 본 단계에선 그냥 wrap 허용. 테이블 가로 스크롤 `overflow-x-auto`. Dialog 는 `sm:max-w-md` 유지, import Dialog 는 `sm:max-w-2xl` → 모바일은 자동 100% 폭.

---

## 5. 화면 B — `/minus` 페이지 통합 변경 명세

`02_uiux_minus.md` v1.4 의 화면 위에 다음 4개 변경을 얹는다.

### 5-1. "구분" 컬럼 추가

**위치**: 결과 테이블의 **상품명 컬럼 바로 우측** (브랜드명 옆). 이유:
- 사용자가 "이 상품이 단품인가 복합인가" 를 판단하는 순간은 상품명/브랜드를 확인한 직후. 시선 이동 최소화.
- 현재 컬럼 순서: `매출일 · 매출구분 · 온라인주문번호 · 상품코드 · 상품명 · 브랜드명 · 판매세트 · 매출액 …` → **`… · 브랜드명 · 구분 · 판매세트 · 매출액 …`** 로 삽입.

**셀 표시 규칙**
- product_master 에 productCode 매칭 성공 + `isComposite = true` → `<Badge variant="default">복합</Badge>`
- 매칭 성공 + `isComposite = false` → `<Badge variant="secondary">단품</Badge>`
- 매칭 실패 → `<Badge variant="outline" className="text-muted-foreground">미매칭</Badge>` 또는 그냥 `"-"` (사용자 선호 따라 — 추천: Badge "미매칭" — 검색·필터에서도 일관)
- 정렬 가능: 단품 < 복합 < 미매칭 (또는 그 역).

**필드명**: 클라이언트 enriched row 에 `productType: "single" | "composite" | null` 추가. CSV/UI 표시는 한글.

### 5-2. 필터 UI

**위치**: 기존 필터 영역의 매출구분 필터 **바로 옆**(우측). minus-analyze-client.tsx 1217~1223 라인 `<SalesTypeFilter>` 다음 줄에 `<ProductTypeFilter>` 삽입.

**컴포넌트**: `Select` (단순 3옵션 다중 선택 필요 없음 — 단품/복합/미매칭 셋 중 하나만 보면 충분한 분석 단위이고, "단품 + 복합 둘 다" 는 곧 "전체" 와 동일하므로 Select 가 가장 단순).

```
필터 영역:
  [총마진율 min %][총마진율 max %][구간 안만 ▾][초기화]   [매출구분 ▾]   [구분 ▾]
                                                            (popover)        (select)
```

**Select 옵션**
- `"전체"` (기본, URL 미설정)
- `"단품만"` (`?productType=single`)
- `"복합만"` (`?productType=composite`)
- `"미매칭만"` (`?productType=null` — 마스터 등록 누락 행만 점검)

**기본값**: "전체". URL · localStorage 양쪽 영속화 (현재 다른 필터들과 동일 패턴).

**chip 영역**
- 선택 시 `<Badge>구분: 복합만 ×</Badge>` 추가. X 클릭 = "전체" 복귀.

### 5-3. CSV 17컬럼 갱신 순서

`02_uiux_minus.md` §3 (라인 138~157) 의 `CSV_HEADERS` 배열에서 **`["brandName", "브랜드명"]` 다음에 `["productType", "구분"]` 삽입**. 16 → 17 컬럼.

**갱신된 순서** (사람이 읽기 좋게 컬럼명만 나열):
```
1.  매출일
2.  매출구분
3.  온라인주문번호
4.  상품코드
5.  상품명
6.  브랜드명
7.  구분              ← NEW
8.  판매세트
9.  매출액
10. 공급가
11. 이익액
12. 물류비
13. 최종이익액
14. 최종이익률
15. 수수료
16. 후정산금
17. 추가후정산금
18. 총마진액
19. 총마진율
```
(주: 현재 16 컬럼 → 17 컬럼 추가 후 총 17개. 위 표는 17번째 = 추가후정산금까지로 정정 — `02_uiux_minus.md` v1.4 의 16개 컬럼 + 구분 1개. **실제 결정값은 P5 구현 시점에 minus 코드 라인 138~157 에서 카운트 재확인**.)

**CSV 값 매핑** (`productType`):
- `"single"` → `"단품"`
- `"composite"` → `"복합"`
- `null` → `""` (빈 셀, 엑셀에서 정렬·필터하기 쉬움) — 또는 `"-"`. 사용자 선호 확인 필요 (§7).

### 5-4. 분석 파이프라인 변경

UI 명세는 아니지만 명세 일관성 확보 차원:
- 분석 시작 직후 `getProductMasterMap(): Promise<Map<productCode, { isComposite: boolean }>>` Server Action 호출 (cal_amount map 과 같은 패턴).
- enrichRow 함수에서 각 row 의 productCode 로 룩업 → `productType` 채움.
- KPI 카드는 변경 없음 (요구사항 §3에서 단품/복합 KPI 분리 카드 스코프 제외).

---

## 6. 컴포넌트 목록 (재사용 vs 신규)

| 컴포넌트 | 상태 | 위치 / 비고 |
|----------|------|-----------|
| `Sidebar` 항목 추가 | **수정** | `src/components/sidebar.tsx` `NAV_SECTIONS[1].items` 에 `{ label: "상품 마스터", href: "/products" }` 첫 번째로 |
| `CalAmountFormDialog` | 재사용 (참조) | 그대로 두고, **같은 컨벤션으로** `ProductFormDialog` 신규 작성 |
| `PageNav` | **추출 권장** | 현재 `cal-amount-list-client.tsx` 내부에 함수로 존재. `src/components/page-nav.tsx` 로 추출해 products 와 cal-amount 양쪽에서 import |
| `SalesTypeFilter` | 재사용 (참조) | minus 페이지 내부 sub-component. `ProductChannelFilter` 신규 작성 (거의 동일). 향후 `MultiSelectFilter` 추출 가능 — 본 단계는 복제 OK |
| `ProductsListClient` | **신규** | `src/app/(dashboard)/products/products-list-client.tsx` |
| `ProductFormDialog` | **신규** | `src/app/(dashboard)/products/product-form-dialog.tsx`. Combobox 채널명 포함 |
| `ProductImportDialog` | **신규** | `src/app/(dashboard)/products/product-import-dialog.tsx`. 3단계 stepper |
| `ProductChannelFilter` | **신규** (또는 SalesTypeFilter 복제) | `src/app/(dashboard)/products/_components/channel-filter.tsx` |
| `Combobox` (채널명 autocomplete) | **신규 컴포지트** | shadcn 에 단일 Combobox 컴포넌트는 없음. `Popover` + `Command` + `Input` 조합으로 구성 — `vercel:shadcn` 가이드 참조 |
| `ProductTypeFilter` (minus 페이지용) | **신규** | 단순 `Select` 하나 — 별 컴포넌트로 분리하지 않고 client 파일 내부에 inline 도 OK |
| `Progress` (import 진행) | 미설치 | shadcn `progress` 추가 (`npx shadcn@latest add progress`) 또는 텍스트로 대체 |

---

## 7. 사용성 결정 표 (보류 / 확정)

| # | 항목 | 상태 | 결정 / 보류 사유 |
|---|------|------|----------------|
| 1 | 메뉴 위치 | **확정** | 사이드바 "관리" 섹션 첫 번째 |
| 2 | 페이지 패턴 | **확정** | cal-amount Server→Client 패턴 답습 |
| 3 | 검색 범위 | **확정** | 상품코드 OR 상품명 OR 브랜드 OR 채널 부분일치 |
| 4 | 채널 필터 컴포넌트 | **확정** | minus 의 SalesTypeFilter 와 동일 Popover+Command 다중선택 |
| 5 | 구분 필터 컴포넌트 | **확정** | `Select` (3옵션, 단일선택) |
| 6 | 상품코드 중복 검증 | **추천 확정** | onBlur Server Action `checkProductCodeUnique` + submit 시 unique_violation 캐치 |
| 7 | 채널명 input | **추천 확정** | Combobox (자유 입력 + 자동완성, sales.A + 기등록 채널 union) |
| 8 | 엑셀 컬럼 포맷 | **사용자 확정 필요 (P3)** | 안 A(한글 헤더) 추천. 안 B(영어 키)도 가능. 양식 파일 + 파서가 의존 |
| 9 | upsert 토글 기본값 | **추천 확정** | OFF (안전 우선). 사용자가 의식적으로 켜야 덮어쓰기 |
| 10 | 미매칭 셀 표시 | **사용자 확정 필요** | "미매칭" Badge 추천 / 또는 `"-"` 만. CSV 도 같은 정책으로 통일 |
| 11 | `isComposite` 기본값 | **사용자 확정 필요** | 신규 Dialog 의 RadioGroup 기본값을 단품(false) 로 둘지, 선택 없음으로 둘지. 추천: **선택 없음** (사용자가 의식적으로 선택 — 실수 방지) |
| 12 | 마이너스 페이지 인라인 등록 | **스코프 제외** (§7 보류) | P1 §3 결정. 추후 cal_amount 인터랙티브 셀과 동일 패턴으로 확장 가능 |
| 13 | KPI 단품/복합 분리 카드 | **스코프 제외** (§7 보류) | P1 §5 결정. 필요 시 v2 에서 KPI 6장 → 8장 확장 |

> 8·10·11 세 항목은 **P3 / P5 시작 전 사용자 확인 필수**. next-builder 는 이 결정 없이 구현을 시작하지 말 것.

---

## 8. 가정 / 사용자 결정 보류

1. **`product_master` 테이블 스키마**는 P1 §4 에서 확정. P3 에서 Drizzle 스키마 작성 시 `product_code UNIQUE NOT NULL`, `is_composite NOT NULL` 만 재확인.
2. **`getDistinctChannelNames()` Server Action** 의 데이터 소스 — product_master `channel_name` unique 만 vs (+ 최근 분석 결과의 sales.A union). 후자가 사용성 좋지만 분석 결과는 클라이언트 메모리이므로 sync 가 어려움. 추천: **product_master 만**, 사용자가 신규 채널을 처음 등록할 때는 자유 입력으로 작성하도록 안내.
3. **양식 파일 (`docs/products_template.xlsx`)** — 안 A 한글 헤더로 작성, P3 에서 함께 커밋. 파일 위치/이름 next-builder 확인.
4. **import 시 채널명 정규화** — 전각/반각, trim, 양쪽 공백 자동 제거 정책. 기본값은 `trim()` 만 적용. 안내 카피에 "공백은 자동 제거됩니다" 명시.
5. **마이너스 페이지 분석 도중 product_master 가 갱신되면?** — 분석은 클라이언트 메모리 기반. 갱신은 다음 "분석 시작" 시점에 반영. UI 에 강제 알림은 두지 않음 (이미 진행 중인 분석을 방해하지 않음).
6. **/minus CSV 컬럼명** — "구분" 으로 통일. 영문 CSV 헤더는 사용하지 않음 (현재 minus 명세도 한글 헤더).

---

## 9. 검증 체크리스트 (요청된 11개)

| # | 항목 | 상태 | 위치 |
|---|------|------|------|
| 1 | 정보 아키텍처 (사이드바 위치) | ✅ | §2 |
| 2 | ASCII 와이어 (메인 페이지) | ✅ | §4-2 (데이터 있음), §4-3 (빈/로딩/에러/0건) |
| 3 | ASCII 와이어 (Dialog) | ✅ | §4-5 (신규/수정 통합 와이어) |
| 4 | ASCII 와이어 (엑셀 import 흐름) | ✅ | §4-6 (3단계 와이어) |
| 5 | 4상태 (빈/로딩/에러/데이터) | ✅ | §4-3, §4-7 |
| 6 | 검색·필터·정렬 인터랙션 | ✅ | §4-8 |
| 7 | 폼 입력 검증 (중복 코드) | ✅ | §4-5 "상품코드 중복 검증 UX" |
| 8 | 엑셀 컬럼 포맷 제안 | ✅ | §4-6 "엑셀 컬럼 포맷 제안" 표 (안 A vs 안 B) |
| 9 | 마이너스 페이지 통합 명세 | ✅ | §5 (구분 컬럼 위치 / 필터 / CSV 17컬럼) |
| 10 | 접근성 / 키보드 (탭 / esc / enter) | ✅ | §4-9 |
| 11 | 모바일 / 반응형 | ✅ | §4-10 |

---

## 10. 명세 자가 점검 (`ux-patterns` 1~10번)

- [x] 1번 IA: 사이드바 + URL 분리 (`/products` + `/minus` 통합)
- [x] 2번 레이아웃 골격: cal-amount 표준 CRUD 레이아웃 답습
- [x] 3번 데이터 밀도: 우측 정렬·천단위·`tabular-nums`·truncate + title 툴팁 명시
- [x] 4번 4상태: 페이지/Dialog/Import 모두 빈/로딩/에러/성공 명시
- [x] 5번 업로드 UX: 3단계 stepper, 미리보기, 진행 표시, 결과 요약, 실패 행 CSV 다운로드
- [x] 6번 필터/검색: chip + debounce 300ms + URL 동기화
- [x] 7번 폼: Dialog + Form + react-hook-form + zod, 필수(*), 인라인 validation, submit 중 disabled, 성공 토스트
- [x] 8번 접근성: tab 순서·Combobox 키보드·RadioGroup·aria-required·중복 인라인 에러
- [x] 9번 반응형: 데스크탑 우선, 테이블 가로 스크롤, 사이드바 → Sheet
- [x] 10번 디자인 토큰: 기본값 + 단품/복합 Badge variant 분기

---

## 11. P5 (next-builder) 인계 노트

- **재사용 우선**: cal-amount-list-client 의 검색 debounce / PageNav / TableHeader 정렬 구현을 거의 그대로 복사. 라우트 이름만 `/products` 로 변경.
- **공통화 권장 (선택)**: `PageNav` 를 `src/components/page-nav.tsx` 로 추출. minus 페이지에서는 안 쓰므로 cal-amount 도 같이 import 갈아끼우면 됨 (한 PR 안에서 처리).
- **Dialog 통일**: ProductFormDialog 의 `mode: "create" | "edit"` 분기는 CalAmountFormDialog 의 `lockProductCode` prop 과 의도가 같음. 같은 패턴(prop 으로 모드 분기)을 유지.
- **Server Action 명명 컨벤션**: cal-amount 와 동일. `listProducts` / `createProduct` / `updateProduct` / `deleteProduct` / `appendProducts` (X) → `importProducts` (UI 가 단발 호출 한 번). `getDistinctChannelNames` 는 별도.
- **minus 페이지 통합 작업**: §5 의 3개 변경(컬럼·필터·CSV) 는 같은 PR 에서 처리. enrichRow 시그니처에 `productMasterMap` 인자 추가. 기존 매출구분 필터 코드를 참조해 구분 필터를 inline 추가하면 충분.
- **P3 의존 항목**: §7 표의 8·10·11 항목은 P3 진입 전 사용자 확정 필요.

— 끝 —

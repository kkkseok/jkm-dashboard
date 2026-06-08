# 마이너스 매출이익률 — UI/UX 명세

> 작성: 2026-05-22 / 작성자: `uiux-designer` 에이전트
> v1.1 (2026-05-24): §5(관리 페이지)를 append-only 단순화에 맞춰 정정. `cal_amount` 스키마가 (id, productCode, extraSettlement, createdAt) 4필드로 축소, 수정 액션 폐기, 정렬은 id DESC.
> v1.2 (2026-05-24): 표시 컬럼 12 → 15. **물류비(Q)**, **최종이익액(R−Q)**, **최종이익률((R−Q)/L)** 3개 추가. totalMargin 정의는 그대로(Q 무관). 사용자 확정 — `profit-calc/skill.md` 동시 갱신.
> v1.3 (2026-05-24): revenue 파일 `revenue_profit_product.xlsx` → `revenue_profit_brand.xlsx` 로 통합. 두 파일이 같은 주문집합·같은 컬럼 구조였고 product 쪽은 BF(브랜드)·AH(상품명) 채움률이 거의 0% 였음. brand 한 파일로 모두 커버. **상품명 letter AG → AH 정정** (이전 AG는 "기본상품 규격"이었음, 사용자 확정). **브랜드명(BF) 컬럼 신규** — 표시 컬럼 15 → 16, 검색에도 포함.
> v1.4 (2026-05-24): **마이너스 판정 기준 = 총마진율 < 0% 확정** (사용자 결정, §8-1 보류 해결). KPI 5장 → **6장** — "마이너스 건수" 활성화 + **"계산 불가" 카드 신규** (인터랙티브 토글). disabled 마이너스 필터 Select 폐기, **사용자 입력 양쪽 임계값(min, max %) + 구간 안/밖 토글 필터** 로 교체 (기본 `-3% ~ +3%`, 구간 안 = 이상치 검토). chip 영역에 범위/계산불가 chip 추가. parse.ts `sliceDataRows` 에 합계/총계 행 제외 로직 (sales_status_basic 마지막 행 A="총계" 등) → KPI 합산 정상화.
> 입력: `01_requirements_minus.md`, `profit-calc/skill.md`, `excel-mapping/skill.md`, `ux-patterns/skill.md`, `shadcn-patterns/skill.md`
> 대상 구현자: `next-builder`

---

## 1. 목적 / 사용자 시나리오

판매채널 운영 담당자가 매일 매출 마감 후, 두 개의 엑셀(`sales_status_basic.xlsx`, `revenue_profit_brand.xlsx`)을 업로드해 **상품코드 단위로 손실(마이너스) 품목을 확인**한다. 상품코드별 **추가후정산금**은 별도 페이지에서 CRUD로 관리하며, 분석 시 자동 룩업된다. 사용 빈도는 하루 1~2회, 한 번에 수만 행을 다룬다.

핵심 사용 흐름:
1. 좌측 사이드바에서 "마이너스 매출이익률" 진입 → 두 파일 업로드 → "분석 시작" → 결과 테이블 확인 → CSV 다운로드
2. 필요 시 "추가후정산금 관리" 페이지에서 상품코드별 추가후정산금 추가/수정/삭제

---

## 2. 전체 IA (Information Architecture)

### 사이드바 구조 (향후 확장 포함)

```
┌────────────────────────────┐
│  JKM Dashboard             │  ← 로고 / 제품명
├────────────────────────────┤
│  분석                       │  (Section label, muted)
│   ▸ 마이너스 매출이익률  ★ │  ← /minus      (본 기능)
│   ▸ 품절 관리 (예정)        │  ← /soldout   (placeholder, disabled)
│   ▸ 그룹 업로드 (예정)      │  ← /group     (placeholder, disabled)
├────────────────────────────┤
│  관리                       │  (Section label)
│   ▸ 추가후정산금 관리       │  ← /cal-amount (본 기능)
├────────────────────────────┤
│  (하단 spacer)              │
│  v0.1.0 · seokcess@…       │  ← 사용자 이메일/버전 표시
└────────────────────────────┘
```

- "예정" 항목은 `disabled` 스타일(muted, 클릭 불가), `Badge`로 "예정" 표시.
- 활성 항목은 `bg-accent text-accent-foreground` + 좌측 2px accent 보더.
- 섹션 라벨(`분석`, `관리`)은 `text-xs uppercase text-muted-foreground tracking-wider`.
- 모바일(`< md`)에서는 `Sheet`(슬라이드 패널)로 전환. 헤더 좌측에 햄버거 버튼.

### URL 구조

| URL | 화면 | 비고 |
|-----|------|------|
| `/` | 홈 (현 단계는 `/minus`로 리다이렉트) | 추후 대시보드 홈 |
| `/minus` | 마이너스 매출이익률 분석 | 본 명세 화면 A |
| `/cal-amount` | 추가후정산금 관리 | 본 명세 화면 B |
| `/soldout` | (향후) | 사이드바만 자리, 페이지는 미구현 |
| `/group` | (향후) | 동일 |

---

## 3. 디자인 토큰

`ux-patterns/skill.md` 10번 기본값을 그대로 채택. 본 기능 특수 토큰만 추가 명시.

### 채택 (재확인)

- **컬러:** shadcn 기본(slate) 팔레트. accent = `blue-600`. 라이트 모드만 활성화(다크 보류).
- **타이포:** `font-sans` (시스템 폰트 → 향후 Pretendard 교체). **숫자 셀은 `tabular-nums` 필수**.
- **간격:** Tailwind 4의 배수만 사용 (`gap-2`, `gap-4`, `gap-6`, `p-4`, `p-6`). 임의값(`gap-[13px]`) 금지.
- **행 높이:** 데이터 테이블 `h-10` (보통). 본 단계에서는 컴팩트 토글 미제공.

### 본 기능 특수 토큰

| 토큰 | 값 | 용도 |
|------|----|------|
| 마이너스 강조 | `text-red-600` (라이트) | 음수 금액·음수 비율 셀 텍스트 |
| 마이너스 행 배경(약함) | `bg-red-50` | (선택) 총마진율 < 0 행 전체 배경. 단, 판정 기준 미확정이므로 본 단계 미적용 |
| KPI 카드 강조 | `text-red-600` (마이너스 건수) / `text-foreground` (총 건수) | 요약 카드 숫자 색 분기 |
| 빈 셀(`null`) | `text-muted-foreground` + 표기 `"-"` | K=0 등으로 계산 불가 시 |
| 업로드 슬롯 비어있음 | `border-dashed border-muted-foreground/30` | dashed border |
| 업로드 슬롯 채워짐 | `border-solid border-blue-600 bg-blue-50/50` | 선택 완료 시각화 |
| 업로드 슬롯 에러 | `border-solid border-red-600 bg-red-50/50` | 검증 실패 |

### 숫자 포맷 규칙 (재확인)

| 종류 | 포맷 | 예 |
|------|------|----|
| 금액(원) | `Intl.NumberFormat('ko-KR')` + 우측 정렬 + `tabular-nums` | `1,234,567` |
| 비율(0~1) | `(v*100).toFixed(1) + '%'` | `11.5%` |
| null/계산불가 | `"-"` + `text-muted-foreground` | `-` |
| 음수 | 위 포맷 + `text-red-600` | `-1,234,567` |

---

## 4. 화면 A — 분석 페이지 (`/minus`)

### 4-1. ASCII 와이어프레임

**상태 1: 업로드 전 (빈 상태)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] JKM Dashboard                                                            │ ← 헤더(고정)
├─────────────┬────────────────────────────────────────────────────────────────┤
│ 사이드바     │  마이너스 매출이익률                                            │
│ ─────────   │  두 파일을 업로드해 손실 품목을 확인합니다.                      │
│ 분석         │                                                                │
│ ▸ 마이너스…★│  ┌─ 1단계: 파일 업로드 ─────────────────────────────────────┐  │
│ ▸ 품절(예정)│  │                                                          │  │
│ ▸ 그룹(예정)│  │  ┌──── 슬롯 1 ────┐    ┌──── 슬롯 2 ────┐                │  │
│ ─────────   │  │  │   📄 (점선)     │    │   📄 (점선)     │                │  │
│ 관리         │  │  │ sales_status_   │    │ revenue_profit_ │                │  │
│ ▸ 추가후…   │  │  │ basic.xlsx      │    │ brand.xlsx      │                │  │
│             │  │  │ [파일 선택]      │    │ [파일 선택]      │                │  │
│             │  │  │ 또는 끌어놓기    │    │ 또는 끌어놓기    │                │  │
│             │  │  └────────────────┘    └────────────────┘                │  │
│             │  │                                                          │  │
│             │  │  진행도: ☐ 파일1   ☐ 파일2                              │  │
│             │  │                                       [분석 시작 (비활성)]│  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │                                                                │
│             │  (요약/필터/테이블 영역은 분석 후 표시)                         │
└─────────────┴────────────────────────────────────────────────────────────────┘
```

**상태 2: 분석 완료 (성공)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] JKM Dashboard                                                            │
├─────────────┬────────────────────────────────────────────────────────────────┤
│ 사이드바     │  마이너스 매출이익률                  [재업로드]  [CSV 다운로드] │
│             │  분석 완료: sales_status_basic.xlsx + revenue_profit_brand.xlsx │
│             │  (2026-05-22 14:32)                                            │
│             │                                                                │
│             │  ┌─ 요약 KPI (5개, 카드 자체 클릭 가능 항목 존재) ────────────┐  │
│             │  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐│  │
│             │  │ │총 행 수 │ │마이너스 │ │총 매출액│ │총마진합계 │ │추가후정산││  │
│             │  │ │12,345  │ │432(3.5%)│ │1,234,567│ │-12,345,67│ │금 누락   ││  │
│             │  │ │        │ │(text-red│ │K        │ │8(t-red)  │ │ 87건 ▶  ││  │
│             │  │ │        │ │)        │ │         │ │          │ │(클릭)    ││  │
│             │  │ └────────┘ └────────┘ └────────┘ └──────────┘ └──────────┘│  │
│             │  │  ※ "추가후정산금 누락" 카드 클릭 = 누락 행만 필터          │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │                                                                │
│             │  ┌─ 필터/검색 ──────────────────────────────────────────────┐  │
│             │  │  검색: [상품명/코드/주문번호 입력……] 🔍                   │  │
│             │  │  마이너스 필터: [전체 표시 ▾] (비활성 - 판정 기준 미확정) │  │
│             │  │  적용된 필터: (없음)                                      │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │                                                                │
│             │  ┌─ 결과 테이블 (가로 스크롤) ──────────────────────────────┐  │
│             │  │ 매출일 ▲│주문번호│상품코드│상품명│브랜드│매출액│공급가│이익액│물류비│최종이익액│최종이익률│수수료│후정산│추가⚡│총마진│총마진율│  │
│             │  │ 5/22   │ A001   │ P-123  │…    │1,000│  900│  100│10.0%│   50│    0 │  150│ 16.7%│  │ (이력 있음, 호버 시 ✏️)
│             │  │ 5/22   │ A002   │ P-124  │…    │  500│  550│  -50│-10.0│  -25│   30 │  -45│ -8.2%│  │ (이력 있음/음수=red)
│             │  │ 5/22   │ A003   │ P-125  │…    │  800│  720│   80│10.0%│   40│ - ➕ │   - │   -  │  │ (매칭 실패=➕ 상시)
│             │  │ …                                                          │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │  ※ "추가" 컬럼 셀: cal_amount 매칭 실패("-") → ➕ 상시. 이력  │
│             │     있음(값 0 포함) → 호버 시 ✏️. **두 경우 모두 같은 동작**: │
│             │     클릭 = 공용 Dialog 열림 → 저장 = append-only INSERT (새  │
│             │     이력 row) → 동일 productCode 모든 행 자동 재계산.          │
│             │  표시 12,345행 중 1–100  [< 이전] [1][2]…[124] [다음 >]        │
└─────────────┴────────────────────────────────────────────────────────────────┘
```

### 4-2. 컴포넌트 명세표

| 영역 | shadcn 컴포넌트 | 역할 / 주요 인터랙션 |
|------|-----------------|-----|
| 페이지 헤더 (제목 + 액션) | `h1` (native) + `Button` × 2 | "재업로드" outline / "CSV 다운로드" default. 분석 전에는 액션 버튼 숨김 |
| 업로드 카드 컨테이너 | `Card`, `CardHeader`, `CardContent` | 1단계 묶음 |
| 업로드 슬롯 (×2) | custom `<div>` (드롭존) + `Input type="file"` + `Button` | 클릭 / 드래그앤드롭. 선택된 파일명·크기 표시. 변경 시 confirm |
| 진행도 체크리스트 | `Badge` + 텍스트 | "☐ 파일1 / ☑ 파일2" — 단계 시각화 (`ux-patterns` 5번) |
| 분석 시작 버튼 | `Button` | 두 파일 모두 채워질 때만 enabled. 클릭 시 파싱 진행 |
| 파싱 진행 표시 | `Skeleton` + 진행 텍스트 (예: "병합 헤더 분석 중… 1/3") | `ux-patterns` 5번 "업로드 중 progress" |
| 파싱 에러 | `Alert variant="destructive"` | 어느 행/시트/컬럼에서 실패했는지 inline 표시 + "재업로드" CTA |
| KPI 카드 (×6, v1.4) | `Card`, `CardHeader`, `CardContent` + `ToggleKpiCard` | (1) 총 행 수 / (2) **마이너스 건수** (`총마진율 < 0%` 인 행 수, 음수면 빨강, 정보 표시만) / (3) **계산 불가** (`totalMarginRate === null` 인 행 수, **클릭 가능 — "계산 불가만" 필터 토글**) / (4) 총 매출액 / (5) 총마진액 합계 / (6) **추가후정산금 누락** (클릭 가능 — "누락 행만" 필터 토글). 클릭 가능 카드는 `role="button" tabIndex={0}` + `aria-pressed` + hover `bg-accent/30`. "누락" 정의 = cal_amount 매칭 실패만 (값 0 등록은 누락 아님). 0건 카드 클릭 시 토스트 안내. 그리드: `grid-cols-2 md:grid-cols-6` |
| 검색 입력 | `Input` | 300ms debounce. 상품명/코드/주문번호/브랜드 다중 매칭 (v1.3) |
| **총마진율 범위 필터** (v1.4) | `Input type="number"` × 2 (min, max %) + `Select` (모드) + `Button` (초기화) | 사용자가 직접 % 단위 임계값 입력. 기본 `min=-3`, `max=3`, 모드 `inside` (이상치). 모드 옵션: **"구간 안만 (이상치, 기본)"** — 정상 마진(5%↑) 환경에서 ±3% 사이는 마진 낮은 이상치 / "구간 밖만 (정상치)" — 임계값 밖의 안정 행만. 빈 칸 = 해당 방향 무한. `min > max` 면 입력 테두리 빨강 + 안내 `Alert text-destructive` + 필터 비활성. null(총마진율 계산 불가) 행은 양쪽 모드에서 자동 제외 (계산 불가만 보기는 별도 KPI 카드 클릭으로) |
| 적용 필터 chip | `Badge` (제거 가능) | 검색어 chip + 범위 chip (예: "총마진율 < -3% 또는 > 3%") + 누락 행만 chip + 계산 불가만 chip — 각각 X 로 해제 |
| 결과 테이블 | `Table`, `TableHeader`, `TableHead`, `TableBody`, `TableRow`, `TableCell` + TanStack | 정렬 가능 헤더(▲▼). 가로 스크롤 wrapper `overflow-x-auto`. **"추가후정산금" 셀(`extraSettlement`)은 `role="button" tabIndex={0}` 으로 만들고 클릭/Enter/Space 시 Dialog 열림** (셀 자체가 인터랙티브) |
| 추가후정산금 셀 (인터랙티브) | custom `<TableCell>` + `Button variant="ghost"` 형태 | **매칭 실패 행 (cal_amount 이력 없음)** → 셀 표기 "-" + `cursor-pointer hover:bg-accent`, 우상단에 작은 `Plus` 아이콘(`lucide-react`) **상시 노출** (mode 의미 아님, 시각적 affordance 일 뿐). **이력 있는 행 (값 0 포함)** → 호버 시에만 `Pencil` 아이콘 슬쩍. **두 경우 모두 동작은 동일**: 클릭 = 공용 Dialog 열림 → 저장 = `appendCalAmount()` 호출 (append-only INSERT, 새 이력 row). `aria-label`은 시각 분기를 따름 — 매칭 실패: "후정산금 추가 (상품 {productCode})", 이력 있음: "후정산금 새 이력 추가 (상품 {productCode}, 현재 winner {value}원)" |
| **공용 cal_amount 입력 Dialog** | `Dialog` + `Form` (§5와 동일 컴포넌트 재사용) | `src/components/cal-amount-form-dialog.tsx` 에 구현 완료. §5(관리 페이지)와 §4(분석 페이지) 양쪽에서 import. **append-only 단일 동작 — mode 구분 없음.** 제목은 항상 "후정산금 추가" (분석 페이지에서도 동일 — 컬럼 컨텍스트로 사용자가 인지). Props: `open`, `onOpenChange`, `defaultValues?: { productCode?, extraSettlement? }`, `lockProductCode?: boolean` (분석 페이지에서 `true` — productCode 자동주입 + readonly), `onSaved?: ({ productCode, extraSettlement }) => void` |
| 페이지네이션 | `Button` × N (TanStack pagination) | 100행 단위. 표시 영역 텍스트 포함 |
| 토스트 (성공/실패) | `sonner` `Toaster` + `toast()` | "분석 완료 (12,345행)" / "CSV 저장됨" / "파싱 실패" / "저장됨 — N개 행 재계산" |
| 재업로드 확인 | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` | "이전 결과를 덮어쓰시겠습니까?" (`ux-patterns` 5번) |
| (구분선) | `Separator` | KPI / 필터 / 테이블 사이 시각적 분리 |

> 주: 분석 페이지가 공용 cal_amount 입력 Dialog를 import하므로, `next-builder`는 `shadcn add form` 및 `react-hook-form`/`zod` 등의 의존성을 §5 구현 시점이 아니라 §4 구현 시점에 함께 설치해야 함.
> 별도의 "재계산" 버튼은 두지 않는다. 입력 저장 = 즉시 자동 재계산.

### 4-3. 필드 → UI 컬럼 매핑 표

**기존(원본 데이터에서 추출) + 신규(계산) 컬럼.** Excel column letter는 `sales_status_basic` 기준 (`excel-mapping/skill.md` 참조).

| 표시 라벨 | 내부 필드명 | 출처 | 정렬 (UI 정렬 방향) | 포맷 | 음수 처리 | 기본 가시성 |
|-----------|-------------|------|--------|------|-----------|------|
| 매출일 | `salesDate` | `sales_status_basic` (날짜 컬럼, 향후 letter 확정) | 좌측 | `YYYY-MM-DD` | - | 표시 |
| 온라인주문번호 | `onlineOrderNo` | `sales_status_basic.AE` | 좌측 | 문자열 | - | 표시 |
| 상품코드 | `productCode` | `revenue_profit_brand.Y` (조인) | 좌측 | 문자열 | - | 표시 |
| 상품명 | `productName` | `revenue_profit_brand.AH` (조인, v1.3 정정 AG→AH) | 좌측 | 문자열 (긴 경우 `truncate` + `title` 툴팁) | - | 표시 |
| 브랜드명 | `brandName` | `revenue_profit_brand.BF` (조인, v1.3 신규) | 좌측 | 문자열 (긴 경우 `truncate` + `title` 툴팁) | - | 표시. 검색에도 포함 |
| 매출액 | `K` | `sales_status_basic.K` | 우측 | `ko-KR` 천단위 | red | 표시 |
| 공급가 | `L` | `sales_status_basic.L` | 우측 | `ko-KR` 천단위 | red | 표시 |
| 이익액 | `R` | `sales_status_basic.R` | 우측 | `ko-KR` 천단위 | red | 표시 |
| 물류비 | `Q` | `sales_status_basic.Q` | 우측 | `ko-KR` 천단위 | red | 표시 (v1.2) |
| 최종이익액 | `finalProfit` | **계산** `R - Q` | 우측 | `ko-KR` 천단위 | red | 표시 (v1.2). totalMargin 과 독립 보조 지표 |
| 최종이익률 | `finalProfitRate` | **계산** `(R - Q) / L` | 우측 | `xx.x%` | red | 표시 (v1.2). 공급가 기준(분모 L) |
| 수수료 | `commissionRate` | **계산** `1 - L/K` | 우측 | `xx.x%` | red | 표시 |
| 후정산금 | `settlementAmount` | **계산** `K × (commissionRate/2)` | 우측 | `ko-KR` 천단위 | red | 표시 |
| 추가후정산금 | `extraSettlement` | `cal_amount` 룩업 (매칭 실패 시 0으로 계산하되 UI엔 "-" 표기) | 우측 | `ko-KR` 천단위 | red | 표시. **셀 자체가 클릭 가능 (cal_amount 입력 진입점). 매칭 실패 → ➕ 상시 노출, 이력 있음 → 호버 시 ✏️ (시각 분기만, 동작은 동일). 클릭 = Dialog → 저장 시 append-only INSERT (새 이력) → 동일 productCode 모든 행 자동 재계산** |
| 총마진액 | `totalMargin` | **계산** `R + 후정산금 + 추가후정산금` | 우측 | `ko-KR` 천단위 | red | 표시 |
| 총마진율 | `totalMarginRate` | **계산** `totalMargin / L` | 우측 | `xx.x%` | red | 표시 |
| 원가 | `M` | `sales_status_basic.M` | 우측 | `ko-KR` 천단위 | red | **숨김(토글로 표시 가능 — v2)** |
| 이익액(판매가) | `T` | `sales_status_basic.T` | 우측 | `ko-KR` 천단위 | red | **숨김(v2)** |
| 이익률(공급가) | `S` | `sales_status_basic.S` (원본) | 우측 | `xx.x%` | red | **숨김(v2)** |
| 이익률(판매가) | `U` | `sales_status_basic.U` (원본) | 우측 | `xx.x%` | red | **숨김(v2)** |

- `null` 셀(K=0, L=0 등으로 계산 불가)은 모두 `"-"` + `text-muted-foreground`로 표시. `profit-calc/skill.md` 5번 룰 준수.
- 모든 숫자 셀: `className="text-right tabular-nums"` 필수.
- 음수 색 적용 규칙: 셀 값 `< 0`이면 `text-red-600`. 비율은 `< 0` 동일 적용.

### 4-4. 4상태 명세

| 영역 | 빈 | 로딩 | 에러 | 성공 |
|------|----|------|------|------|
| **업로드 영역** | 두 슬롯 모두 점선 dashed border + "파일을 끌어 놓거나 클릭" 안내 + 아이콘. "분석 시작" 비활성 | (해당 없음 — 파일 선택은 즉시) | 파일 형식 오류 시 슬롯 테두리 red + `Alert variant="destructive"` 인라인 ("xlsx 파일만 지원합니다") | 슬롯 solid blue 보더 + 파일명·크기 + ✓ 아이콘 + 진행 체크리스트 갱신 |
| **분석 처리** | (해당 없음) | `Skeleton` 3행 + 상단 텍스트 "파일 파싱 중… (1/3) 병합 헤더 분석" / "(2/3) 매핑·조인" / "(3/3) 계산". 큰 파일 대비 progress 메시지 갱신 | `Alert variant="destructive"`: 제목 "분석 중 오류" + 본문 "어느 단계에서 무엇이 실패했는지" + "재업로드" 버튼 | (즉시 KPI + 테이블로 전환) |
| **요약 KPI** | (분석 전 영역 자체 숨김) | `Skeleton` 5개 카드 골격(`h-24`) | 본문에 `Alert` 표시. 카드 영역은 비움 | 5개 카드 값 표시. 마이너스 건수와 총마진액 음수는 빨강. "추가후정산금 누락"은 일반 `text-foreground` (0일 때 `text-muted-foreground`) |
| **KPI "추가후정산금 누락" 카드 (인터랙티브)** | 0건: 카드 표시되지만 숫자 `0` + `text-muted-foreground`, 클릭 시 토스트 안내 "누락 행이 없습니다" 또는 비활성. 1건↑: 정상 클릭 가능 | (KPI와 동일 Skeleton) | (KPI와 동일 Alert) | NN건 표시, hover `bg-accent/30`. 클릭 시 chip 토글 + 테이블 필터 즉시 반영 |
| **결과 테이블** | 분석 전: 영역 숨김. 분석 후 결과 0행: `<div>` 점선 박스 "조건에 맞는 행이 없습니다. 검색어를 지워보세요." + "검색 초기화" 버튼. 누락 필터 ON 상태에서 0행: "추가후정산금 누락 행이 없습니다." + "필터 해제" 버튼 | `Skeleton` 10행(`h-10`). 재계산 직후 갱신 행은 `bg-blue-50` 1초 하이라이트 후 정상 | 테이블 자리에 `Alert` 표시 | 페이지네이션 포함된 테이블 |
| **추가후정산금 셀 인터랙션 (셀 단위)** | 셀 값 0/null: ➕ 아이콘 + 강조 hover, "클릭하여 입력" `aria-label` | Dialog submit 중: 셀은 그대로(테이블 단의 변경은 저장 완료 후). 동일 productCode를 가진 모든 행에 임시 로딩 인디케이터(`opacity-50`) 0.3초 후 갱신 | Server Action 실패 시 Dialog는 닫히지 않고 폼 상단 `Alert` + `toast.error("저장 실패: …")`. 테이블 값은 변동 없음 | Dialog 닫힘 + `toast.success("저장됨 — N개 행 재계산")` + 갱신 행 `bg-blue-50` 1초 + KPI 카드 즉시 갱신 |
| **CSV 다운로드** | (분석 전 버튼 숨김) | 버튼 `disabled` + 텍스트 "생성 중…" | `toast.error('CSV 생성 실패')` | `toast.success('CSV 저장됨')` + 브라우저 다운로드 |

### 4-5. 인터랙션 시나리오

**시나리오 1 (정상): 첫 분석 → CSV 저장**
1. 사용자가 `/minus` 진입 → 사이드바에서 "마이너스 매출이익률" 활성 표시.
2. 슬롯1에 `sales_status_basic.xlsx`를 드래그앤드롭. 슬롯 테두리 solid blue + 파일명 표시. 체크리스트 "☑ 파일1 / ☐ 파일2".
3. 슬롯2 클릭 → 파일 선택 다이얼로그 → `revenue_profit_brand.xlsx` 선택. 체크리스트 "☑ ☑". "분석 시작" 버튼 활성화.
4. "분석 시작" 클릭 → 업로드 카드 하단에 `Skeleton` + "(1/3) 병합 헤더 분석" 메시지. 진행 단계 갱신.
5. 완료 → KPI 4장 + 필터 영역 + 테이블 fade-in. `toast.success("분석 완료 (12,345행)")`.
6. 검색창에 "P-12" 입력 → 300ms 후 테이블 필터링, 적용 필터 chip "검색: P-12 ×" 표시.
7. "CSV 다운로드" 클릭 → `toast.success("CSV 저장됨: minus_2026-05-22.csv")`. 파일 다운로드.

**시나리오 2 (재업로드 충돌): 이전 결과 보존 확인**
1. 분석 완료 상태에서 사용자가 슬롯1 영역에 새 파일을 드롭.
2. `Dialog` 열림: 제목 "이전 분석 결과를 덮어쓰시겠습니까?" / 본문 "현재 표시 중인 12,345행 결과가 사라집니다." / 액션 `[취소]` `[새로 분석]`.
3. "취소" → Dialog 닫힘, 슬롯 상태 변동 없음.
4. "새로 분석" → 기존 KPI/테이블 영역이 `Skeleton`으로 전환되며 처리 시작.

**시나리오 3 (엣지 — 파싱 오류): 잘못된 파일**
1. 사용자가 슬롯1에 `.csv` 파일을 드롭.
2. 즉시(파싱 전 MIME/확장자 체크) 슬롯 테두리 red + 인라인 `Alert`: "xlsx 파일만 지원합니다. 현재 파일: report.csv". 슬롯 내용 비워짐.
3. 사용자가 올바른 xlsx로 재시도 → 정상 동작.

**시나리오 4 (엣지 — 계산 불가 행): K=0 처리**
1. 분석 결과 중 매출액 K=0인 행이 일부 존재.
2. 해당 행의 수수료/후정산금/총마진/총마진율 셀이 모두 `"-"` (muted-foreground)로 표시.
3. KPI "마이너스 건수"는 계산 가능한 행 기준으로만 집계. KPI 하단에 보조 텍스트 "계산 불가 NN행 제외".

**시나리오 5 (인라인 cal_amount 입력 — 테이블 셀 클릭으로 직접 추가/수정)**

전제: 분석 완료 상태. 결과 테이블에 12,345행, 그 중 **cal_amount 매칭 실패** 행 87건 (값 0으로 등록된 상품은 누락에서 제외).

1. 사용자가 KPI 영역의 **"추가후정산금 누락 87건"** 카드를 클릭(또는 Tab 후 Enter). "누락" = 매칭 실패만.
2. 누락 필터 ON → 결과 테이블이 87행(매칭 실패 행만) 표시. 필터 chip "누락 행만 ×"가 검색 chip 라인에 추가됨.
3. 사용자가 첫 행의 **"추가후정산금" 셀(값 "-", ➕ 아이콘 표시)** 을 클릭(또는 셀에 Tab 후 Enter/Space).
4. **공용 cal_amount 입력 Dialog** 열림 (제목 항상 "후정산금 추가" — 셀 컨텍스트로 사용자가 인지):
   - `productCode` 자동 입력 (`P-125`), readonly (`lockProductCode=true`)
   - `extraSettlement`: 빈 칸, 자동 포커스
5. 사용자가 `extraSettlement = 1500` 입력 → "저장" 클릭.
6. 버튼이 "저장 중…" + `disabled`. Server Action `appendCalAmount({ productCode: "P-125", extraSettlement: 1500 })` 호출 → DB INSERT (append-only).
7. `onSaved` 콜백으로 받은 `{ productCode, extraSettlement }` 를 클라이언트 메모리 `calAmountMap` 에 set (같은 productCode 가 이미 있으면 새 값으로 덮어씀 — append-only DB 의 "최신 winner" 정책과 동일).
8. **클라이언트가 자동으로 일괄 재계산**: 결과 테이블에서 `productCode === "P-125"`인 모든 행(예: 3행)의 `extraSettlement = 1500` 갱신 + `totalMargin = R + 후정산금 + 1500` + `totalMarginRate = totalMargin / L` 재계산 (`profit-calc/skill.md` 수식 적용).
9. 갱신된 3개 행은 `bg-blue-50` 1초 하이라이트 후 정상 색으로 fade-out.
10. `toast.success("저장됨 — 3개 행 재계산")` 표시.
11. Dialog 자동 닫힘. KPI "추가후정산금 누락" 카드 숫자가 `87 → 84` 즉시 갱신.
12. 사용자가 이력 있는 행(`P-002`, 현재 winner 추가후정산금 = 30)의 셀에 호버 → ✏️ 아이콘 슬쩍 노출. 클릭하면 동일한 Dialog 가 열린다 (제목 "후정산금 추가"). **기존 값은 자동 채우지 않는다** — 새 이력을 추가하는 동작이므로 `extraSettlement` 입력은 빈 칸으로 시작. 사용자가 새 값(예: 50)을 입력 → 저장 → 같은 흐름으로 `P-002` 행 재계산되며 winner 가 30 → 50 으로 바뀜. 관리 페이지에서는 두 이력 모두 보존됨.
13. 별도의 "재계산" 버튼은 화면 어디에도 없다.

**예외 흐름 (시나리오 5-실패): Server Action 에러**
- Server Action이 네트워크/DB 오류로 실패 → Dialog는 닫히지 않고 폼 상단에 `Alert variant="destructive"` ("저장에 실패했습니다. 잠시 후 다시 시도하세요.") + `toast.error("저장 실패")`.
- 테이블 값은 변동 없음. `calAmountMap`도 변경되지 않음. 사용자는 "취소" 또는 재시도 가능.

**예외 흐름 (시나리오 5-동일 코드 다행 갱신): 결과 행 0개**
- 사용자가 누락 필터 ON 상태에서 셀 클릭 후 저장 → 해당 행의 productCode가 결과 테이블에서 누락 필터를 거쳐 1행만 남았을 수 있으나, 클라이언트는 **필터 적용 전 전체 데이터(`rows`)** 기준으로 재계산. 갱신은 전체 결과에 반영되며 필터 후 가시 행만 화면에 노출. 누락 필터 ON 상태이므로 0이 아닌 값으로 갱신된 행은 즉시 필터에서 빠짐(자연 사라짐). 토스트는 여전히 "N개 행 재계산"으로 전체 갱신 건수를 안내.

### 4-6. 키보드 / 접근성 메모

- **Tab 순서**: 사이드바 → 헤더 액션 → 업로드 슬롯1 → 슬롯2 → 분석 시작 버튼 → **KPI 카드 5개(클릭 가능한 "추가후정산금 누락" 포함, Tab 도달)** → 검색 입력 → 마이너스 필터(비활성, skip) → 누락 필터 chip(있을 때) → 테이블 헤더(정렬) → 테이블 본문의 **"추가후정산금" 셀(셀마다 Tab 도달, Enter/Space로 Dialog 열림)** → 페이지네이션 → CSV 다운로드.
- **드래그앤드롭 대안**: 슬롯 내부 `Button("파일 선택")`이 항상 존재해 키보드 사용자 접근 가능. `Input type="file"`은 시각적으로 숨기되 `sr-only`로 유지하고 `Button`이 label로 감싸 활성.
- **테이블 정렬**: `TableHead`에 `role="button"` + `tabIndex={0}` + `Enter`/`Space`로 정렬 토글. 정렬 방향은 `aria-sort="ascending|descending|none"`.
- **추가후정산금 셀**: `role="button"` + `tabIndex={0}` + `Enter`/`Space`로 Dialog 열림. `aria-label` 은 시각 분기를 따름 — 매칭 실패: "후정산금 추가 (상품 {productCode})", 이력 있음: "후정산금 새 이력 추가 (상품 {productCode}, 현재 winner {value}원)". 두 경우 모두 클릭 = append-only INSERT. 셀에 포커스 시 시각적 outline(`focus-visible:ring-2 ring-ring`) 명시.
- **"추가후정산금 누락" KPI 카드**: `role="button"` + `tabIndex={0}` + `Enter`로 활성. `aria-label="추가후정산금 누락 행만 보기 (현재 {N}건)"`. 필터 ON일 때 `aria-pressed="true"`.
- **필터 chip "누락 행만"**: chip 내 X 버튼 `aria-label="누락 행만 필터 해제"`.
- **공용 cal_amount Dialog**: 분석 페이지에서 열릴 때(`lockProductCode=true`)는 `extraSettlement` 입력에 자동 포커스, `productCode` 는 readonly (`aria-readonly="true"`). 관리 페이지에서 열릴 때는 `productCode` 입력에 자동 포커스, readonly 아님. `Esc`로 닫힘, `Enter`로 submit. productName/memo 필드는 없음.
- **검색 입력**: `label htmlFor`로 연결. 클리어 X 버튼은 `aria-label="검색어 지우기"`.
- **아이콘 전용 버튼**: "재업로드"의 아이콘 모드 등은 `aria-label` 필수. 셀 내부 ➕/✏️ 아이콘은 셀 자체가 button role을 가지므로 `aria-hidden="true"` 처리(중복 음성 출력 방지).
- **`Esc`**: Dialog 닫힘. Dropdown(마이너스 필터)도 닫힘.
- **에러 인라인 메시지**: 입력/슬롯과 `aria-describedby` 연결.
- **자동 재계산 알림**: 갱신 직후 `toast.success("저장됨 — N개 행 재계산")` 는 `sonner` 기본 `role="status" aria-live="polite"`를 사용해 스크린리더에 안내.
- **컬러 콘트라스트**: 마이너스 `text-red-600` on `white` ≒ 5.94:1 (AA 통과). `bg-red-50` 위 `text-red-600` ≒ 5.6:1 (AA 통과). 셀 hover 시 `bg-accent`는 shadcn 기본값으로 텍스트 대비 4.5:1 이상 유지.

### 4-7. 반응형 동작 (분석 페이지)

- `≥ lg (1024px)`: 사이드바 고정(240px) + 본문. 테이블 가로 스크롤 거의 없음(컬럼 13개 가시 시 가로 스크롤 발생 가능). KPI는 `grid-cols-5` (5개 카드 한 줄).
- `md (768~1023px)`: 사이드바 축소(64px, 아이콘 only) + 본문. 테이블 가로 스크롤 허용. KPI는 `grid-cols-5` 유지하되 본문 폭에 따라 카드 폭이 자동 축소. 카드 내부 라벨 줄바꿈 허용.
- `< md`: 사이드바 `Sheet`(슬라이드)로 전환, 헤더에 햄버거. 업로드 슬롯 2개는 세로로 쌓임(`grid-cols-1 md:grid-cols-2`). **KPI 카드는 `grid-cols-2 md:grid-cols-5`**. 카드 5개일 때 모바일은 2열로 4개가 2x2로 배치되고 5번째 "추가후정산금 누락" 카드는 마지막 줄에 단독으로 가로 폭 100%(`col-span-2`) 차지. 테이블은 가로 스크롤(`overflow-x-auto`). **추가후정산금 셀의 ➕/✏️ 아이콘은 모바일에서도 항상 노출(호버 없이 0/누락 셀은 ➕ 표시 유지)**. Dialog는 모바일에서도 `max-w-md`로 동일.

---

## 5. 화면 B — 후정산금 관리 페이지 (`/cal-amount`)

> **append-only 모델 (v1.1)**: `cal_amount` 테이블은 (id, productCode, extraSettlement, createdAt) 4필드. UNIQUE 없음. 동일 productCode 가 여러 번 추가될 수 있고, 분석 시 **최신(가장 큰 id) 행이 winner**. 따라서 본 페이지에는 "수정" 액션이 없다 — 값을 바꾸려면 같은 productCode 로 새 행을 추가하면 된다(이전 이력은 보존). 대량 import 도 UI 가 아니라 `scripts/import-cal-amount.ts` 로 처리한다.

### 5-1. ASCII 와이어프레임

**상태 1: 데이터 있음 (성공)**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] JKM Dashboard                                                            │
├─────────────┬────────────────────────────────────────────────────────────────┤
│ 사이드바     │  후정산금 관리                              [+ 추가]            │
│             │  상품코드별 후정산금 이력입니다. 같은 상품코드가 다시 추가되면    │
│             │  최상단(최신)의 값이 분석 시 계산에 사용됩니다.                  │
│             │                                                                │
│             │  ┌─ 안내 ───────────────────────────────────────────────────┐  │
│             │  │  ⓘ 등록된 이력 5,282건                                    │  │
│             │  │  최신 데이터가 최상단에 표시됩니다. 대량 import 는 별도   │  │
│             │  │  스크립트로 진행하세요: `pnpm tsx scripts/import-cal-amo │  │
│             │  │  unt.ts`                                                  │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │                                                                │
│             │  검색: [상품코드…… 🔍]                                         │
│             │                                                                │
│             │  ┌─ 목록 테이블 (id DESC = 최신 최상단) ───────────────────┐  │
│             │  │ 상품코드      │ 후정산금 ▼  │ 추가일 ▼            │ 액션 │  │
│             │  │ P-001         │      1,500 │ 2026-05-24 14:32   │  🗑  │  │
│             │  │ P-002         │          0 │ 2026-05-24 14:31   │  🗑  │  │
│             │  │ P-003         │     -2,000 │ 2026-05-24 14:30   │  🗑  │  │
│             │  │ P-001         │      1,200 │ 2026-05-23 09:10   │  🗑  │  │ ← 같은 코드 이전 이력
│             │  │ …                                                         │  │
│             │  └──────────────────────────────────────────────────────────┘  │
│             │  5,282건 중 1–100 [< 이전] [1][2]…[53] [다음 >]                │
└─────────────┴────────────────────────────────────────────────────────────────┘
```

**상태 2: 추가 Dialog**

```
                   ┌───────────────────────────────────────┐
                   │ 후정산금 추가                       ✕  │
                   ├───────────────────────────────────────┤
                   │ 상품코드 *                            │
                   │ [P-004                              ] │
                   │ (필수, 중복 허용 — 새 이력으로 추가됨)  │
                   │                                       │
                   │ 후정산금 (원) *                        │
                   │ [               1500]                 │
                   │ (정수, 음수 허용)                      │
                   │                                       │
                   ├───────────────────────────────────────┤
                   │                       [취소]  [저장]   │
                   └───────────────────────────────────────┘
```

**상태 3: 삭제 확인 Dialog**

```
                   ┌───────────────────────────────────────┐
                   │ 삭제 확인                          ✕  │
                   ├───────────────────────────────────────┤
                   │ "P-003" (이력 id 4521, -2,000원)을     │
                   │ 삭제하시겠습니까?                      │
                   │                                       │
                   │ 같은 상품코드의 다른 이력 행은 영향이   │
                   │ 없습니다. 이 행이 최신 값이었다면 그   │
                   │ 다음(이전) 이력 행이 분석 시 계산에    │
                   │ 사용됩니다.                            │
                   ├───────────────────────────────────────┤
                   │                       [취소]  [삭제]   │
                   └───────────────────────────────────────┘
```

### 5-2. 컴포넌트 명세표

| 영역 | shadcn 컴포넌트 | 역할 / 주요 인터랙션 |
|------|-----------------|-----|
| 페이지 헤더 | `h1` + `Button` | "+ 추가" → 공용 추가 Dialog 열림 |
| 안내 카드 | `Alert` (variant default) | 등록 이력 카운트(0건이면 "아직 등록된 후정산금이 없습니다") + 대량 import 스크립트 안내. **UI 업로드 없음** (스크립트로만 처리) |
| 검색 입력 | `Input` + `SearchIcon` + 클리어 X | 300ms debounce. **상품코드 부분일치만** (상품명 컬럼 없음). `aria-label="상품코드 검색"` |
| 목록 테이블 | `Table` 일가 + TanStack | **정렬 가능 헤더는 후정산금/추가일만** (상품코드는 정렬 불가 — id DESC 가 기본 순서). `manualPagination: true` 로 서버 페이지네이션 |
| 액션 컬럼 | `Button variant="ghost" size="icon-sm"` × 1 | **🗑 단일 아이콘** (수정 액션 없음). `aria-label="{productCode} (id {id}) 삭제"` |
| 공용 추가 Dialog | `src/components/cal-amount-form-dialog.tsx` (§4 와 동일 컴포넌트) | `<CalAmountFormDialog open … onSaved={…} />` 형태로 import. 관리 페이지에서는 `lockProductCode` 없이 호출(자유 입력) |
| 폼 본체 | `Form` (shadcn) + `react-hook-form` + `zod` | **이미 설치됨**: `react-hook-form`, `zod`, `@hookform/resolvers`, shadcn `form` 컴포넌트 |
| 삭제 확인 Dialog | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` | 대상 행의 productCode + id + 금액 노출. "취소" outline / "삭제" destructive |
| 토스트 | `sonner` `toast.success` / `toast.error` | "추가됨" / "삭제됨: {productCode}" / "저장 실패" / "삭제 실패: …" |
| 페이지네이션 | `Button` 묶음 (자체 `PageNav` 컴포넌트) | 100건 단위. 좌측에 "N건 중 a–b" 표시. 이전/다음 + 윈도우(현재 페이지 ±1, 처음/끝 고정) |
| 빈 상태 박스 | `div.border-dashed` | 전체 0건: "등록된 후정산금이 없습니다." + "+ 추가" CTA. 검색 결과 0건: "조건에 맞는 항목이 없습니다." + "검색 초기화" |

### 5-3. 폼 필드 명세 (공용 Dialog 와 동일)

`src/components/cal-amount-form-dialog.tsx` 가 분석/관리 페이지 양쪽에서 공유되므로 필드 정의는 한 곳에서 관리.

| 필드 | 라벨 | 컴포넌트 | 필수 | validation (zod) | 에러 메시지 (인라인, blur 시) |
|------|------|----------|-----|------------------|---------------------------|
| `productCode` | 상품코드 | `Input` (관리 페이지는 자유 입력 / 분석 페이지는 `readOnly` + `aria-readonly`) | ✓ | `z.string().trim().min(1).max(64).regex(/^[\w-]+$/)` (**unique 체크 없음 — append-only**) | 비어있음: "상품코드를 입력하세요" / 길이: "상품코드는 64자 이내로 입력하세요" / 형식: "영문/숫자/하이픈/언더바만 입력 가능합니다" |
| `extraSettlement` | 후정산금 (원) | `Input type="number" inputMode="numeric"` | ✓ | 폼 단계는 `z.string().refine(/^-?\d+$/)`, submit 시 `Number()` 변환 → Server Action 단계는 `z.coerce.number().int()` (음수/0 허용) | 비어있음: "금액을 입력하세요" / 정수 아님: "정수만 입력 가능합니다" |

- 폼 submit 중에는 `[저장]` 버튼 `disabled` + 텍스트 "저장 중…", `[취소]` 버튼 `disabled`.
- 성공 시 Dialog 자동 닫힘 + `toast.success("추가됨")` + 관리 페이지는 `router.refresh()`, 분석 페이지는 클라이언트 `calAmountMap` 갱신 + 동일 productCode 행 자동 재계산.
- 실패 시 Dialog 유지, 폼 상단에 `Alert variant="destructive"` 인라인 + `toast.error("저장 실패")`.

### 5-4. 4상태 명세

| 영역 | 빈 | 로딩 | 에러 | 성공 |
|------|----|------|------|------|
| **안내 카드** | "아직 등록된 후정산금이 없습니다" + 스크립트 코드 블록 (`pnpm tsx scripts/import-cal-amount.ts`) | (해당 없음 — 정적 카드) | (해당 없음) | "등록된 이력 N건" + 스크립트 안내 |
| **목록 테이블** | 전체 0건: 점선 박스 "등록된 후정산금이 없습니다." + "+ 추가" CTA. 검색 결과 0건: "조건에 맞는 항목이 없습니다." + "검색 초기화" 버튼 | (서버 렌더링이므로 페이지 전환 중 `useTransition` 의 `isPending` 표시: 페이지네이션 영역에 "불러오는 중…" 작은 텍스트) | (server action 에러는 Next.js error.tsx 로 위임. 본 페이지 inline 에러 표시 없음) | 페이지네이션 포함된 테이블 (id DESC 정렬) |
| **추가 Dialog** | 열림 시 모든 필드 빈 값. `productCode` 자동 포커스 | submit 중 폼 전체 `disabled` + 버튼 "저장 중…" | 폼 상단 `Alert variant="destructive"` (서버 에러) + 필드별 인라인 메시지 (zod) + `toast.error("저장 실패")` | Dialog 자동 닫힘 + `toast.success("추가됨")` + 테이블 자동 갱신 |
| **삭제 Dialog** | 열림 시 대상 productCode + id + 금액 표시 | "삭제" 버튼 `disabled` + "삭제 중…" + "취소" 버튼 `disabled` | `toast.error("삭제 실패: …")` Dialog 유지 | Dialog 닫힘 + `toast.success("삭제됨: {productCode}")` + 테이블 자동 갱신 |

### 5-5. 인터랙션 시나리오

**시나리오 1 (정상): 새 상품 추가**
1. `/cal-amount` 진입 → "+ 추가" 클릭 → Dialog 열림, `productCode` 입력에 자동 포커스.
2. 상품코드 `P-004` 입력 (중복 체크 호출 없음 — append-only 라 중복 자체가 정상).
3. 후정산금 `1500` 입력 → "저장" 클릭 → 버튼 "저장 중…" → Dialog 닫힘 + `toast.success("추가됨")`.
4. 테이블 자동 갱신, 새 행이 최상단(가장 큰 id)에 표시됨.

**시나리오 2 (정상): 같은 상품코드 값 변경 — 새 이력 추가**
1. 기존에 `P-001 = 1,200` 이력이 있는 상태에서 값을 `1,500` 으로 바꾸고 싶음.
2. "+ 추가" 클릭 → Dialog 에서 `productCode = P-001`, `extraSettlement = 1500` 입력 → "저장".
3. 테이블 최상단에 `P-001 = 1,500` 새 행 추가. 이전 `P-001 = 1,200` 행은 그대로 남아 이력으로 보존.
4. 분석 페이지에서 다음번 분석 시 `P-001` 의 후정산금은 **최신(가장 큰 id) 행인 1,500** 으로 계산.

**시나리오 3 (엣지 — 삭제 후 영향)**
1. 행의 🗑(삭제) 클릭 → 삭제 확인 Dialog. 본문에 "같은 상품코드의 다른 이력 행은 영향 없음. 이 행이 최신이었다면 그 다음 이력 행이 분석 시 계산에 사용됨" 명시.
2. "삭제" 클릭 → `toast.success("삭제됨: P-003")` + 테이블에서 해당 행 사라짐.
3. 해당 productCode 의 다른 이력이 남아 있으면 그 중 가장 큰 id 행이 자동으로 winner. 이력이 하나도 없으면 분석 시 "매칭 실패"(누락) 으로 처리.

**시나리오 4 (엣지 — 대량 import)**
1. UI 에는 import 버튼이 없다. 대량 import 는 터미널에서 `pnpm tsx scripts/import-cal-amount.ts` 실행.
2. 스크립트는 `docs/common/cal_amount.xlsx` 를 읽어 **역순 INSERT** (엑셀 row 1 = 가장 큰 id = 최신).
3. 이미 데이터가 있는 환경에서 재실행하려면 사용자가 Supabase SQL Editor 에서 `TRUNCATE TABLE cal_amount RESTART IDENTITY;` 후 실행 (스크립트 자체는 truncate 하지 않음).

### 5-6. 키보드 / 접근성 메모

- **Tab 순서**: 사이드바 → "+ 추가" → 검색 입력 → (검색어 있을 때) 검색 지우기 X → 테이블 헤더 정렬(후정산금/추가일) → 행 액션(🗑) → 페이지네이션.
- **Dialog (공용 추가)**: 열리면 `productCode` 자동 포커스 (분석 페이지에서 `lockProductCode=true` 일 때는 `extraSettlement` 자동 포커스). `Esc` 닫기, `Enter` submit.
- **필수 표시**: 라벨 옆 `*` + input 에 `aria-required="true"`.
- **에러 메시지**: shadcn `FormMessage` 가 자동으로 `aria-describedby` 연결.
- **삭제 버튼**: `aria-label="{productCode} (id {id}) 삭제"` — 같은 코드 다행이 있어도 어느 이력 행인지 명확히 알 수 있도록 id 포함.
- **확인 Dialog의 destructive 버튼**: `variant="destructive"` (red bg) + `aria-label="삭제 확정"`.
- **정렬 헤더**: shadcn `TableHead` + `aria-sort="ascending|descending|none"`, 클릭으로 정렬 토글.
- **테이블 행 자체에는 키보드 동작 없음** (수정 액션이 없으므로 행 `tabIndex` 부여 안 함).

### 5-7. 반응형 동작 (관리 페이지)

- `≥ md`: 표 정상 표시. 액션 컬럼은 🗑 단일 아이콘.
- `< md`: 표 가로 스크롤. 액션 컬럼도 단일 아이콘이므로 DropdownMenu 통합 불필요 — 모바일에서도 🗑 그대로 표시. Dialog 는 `max-w-md` 로 유지.

---

## 6. 공용 레이아웃 (헤더 + 사이드바)

### 6-1. ASCII

```
┌──────────────────────────────────────────────────────────────────────────────┐ ← 헤더(고정, h-14)
│ [≡md미만]  JKM Dashboard                                                     │
├─────────────┬────────────────────────────────────────────────────────────────┤
│ 사이드바      │                                                                │
│ (md이상 고정)│   본문 영역                                                     │
│ w-60         │   p-6  space-y-6                                              │
│              │                                                                │
│ 분석          │                                                                │
│ ▸ 마이너스★ │                                                                │
│ ▸ 품절(예정) │                                                                │
│ ▸ 그룹(예정) │                                                                │
│              │                                                                │
│ 관리          │                                                                │
│ ▸ 추가후정산금│                                                                │
│              │                                                                │
│ ─────────    │                                                                │
│ v0.1.0       │                                                                │
│ seokcess@…   │                                                                │
└─────────────┴────────────────────────────────────────────────────────────────┘
```

### 6-2. 명세

- **헤더**(`<header>`):
  - 위치: `sticky top-0 z-30 h-14 border-b bg-background`
  - 좌측: `md:hidden` 햄버거 `Button variant="ghost" size="icon"` → `Sheet` 트리거 (`aria-label="메뉴 열기"`)
  - 중앙(또는 좌측 그룹 옆): 제품명 "JKM Dashboard" (`font-semibold`)
  - 우측: 사용자 이메일 표시 (현 단계는 정적 텍스트, 향후 `DropdownMenu`로 로그아웃 메뉴 확장)
- **사이드바**(`<aside>`):
  - 데스크탑: `hidden md:flex flex-col w-60 border-r h-[calc(100vh-3.5rem)] sticky top-14`
  - 모바일: `Sheet`로 전환 (좌측 슬라이드, 같은 내용)
  - 섹션 라벨(`분석`, `관리`): `<div className="text-xs uppercase tracking-wider text-muted-foreground px-3 py-2">`
  - 항목: `<Link>`로 감싼 `<div>`, 활성 시 `bg-accent text-accent-foreground` + 좌측 `border-l-2 border-primary`
  - "예정" 항목: `text-muted-foreground cursor-not-allowed` + `Badge variant="secondary"` "예정"
  - 하단: `mt-auto` 영역에 버전·이메일 표시 (`text-xs text-muted-foreground`)
- **본문**(`<main>`):
  - `flex-1 p-6 space-y-6`
  - 페이지 컴포넌트는 자체적으로 `<header>`(제목/설명/액션)을 가짐
- **토스터**: `<Toaster richColors position="top-center" />` — `src/app/layout.tsx` body 끝에 위치

### 6-3. 공용 4상태

- 인증/유저 정보가 미정인 단계라 헤더 우측은 현재 정적 표시. 향후 빈/로딩/에러 상태는 인증 도입 시 별도 명세.

---

## 7. 명세 작성 체크리스트 (`ux-patterns` 11번)

본 문서가 다음을 모두 포함하는지 자체 점검.

- [x] 페이지 목적 (1~2줄) — §1
- [x] IA 위치 (사이드바 어느 항목) — §2
- [x] ASCII 와이어프레임 — §4-1, §5-1, §6-1
- [x] 컴포넌트 목록 (shadcn 명) + 역할 — §4-2, §5-2 (공용 cal_amount Dialog 명시)
- [x] 필드 → UI 컬럼 매핑 표 — §4-3 (extraSettlement 셀 인터랙티브 표기)
- [x] 빈/로딩/에러/성공 4개 상태 명세 — §4-4 (KPI 5번째 카드/셀 인터랙션 추가), §5-4
- [x] 인터랙션 시나리오 1~3개 (사용자 클릭 흐름) — §4-5 (5개, 인라인 cal_amount 입력 시나리오 포함), §5-5 (4개)
- [x] 키보드/접근성 메모 — §4-6 (KPI 카드/셀 키보드 활성, aria-pressed 명시), §5-6
- [x] 반응형 동작 (모바일/태블릿) — §4-7 (KPI grid-cols-2 md:grid-cols-5), §5-7

추가 자가 점검 (`ux-patterns` 1~10번):

- [x] 1번 IA: 사이드바 + 페이지 분리 (분석/관리)
- [x] 2번 레이아웃 골격: 표준 분석/CRUD 레이아웃 채택
- [x] 3번 데이터 밀도: 우측 정렬·천단위·% 1자리·`tabular-nums`·`h-10` 명시
- [x] 4번 4상태: 모든 영역에 빈/로딩/에러/성공 명시
- [x] 5번 업로드 UX: 드래그+클릭, progress 메시지, 검증 에러 inline, 재업로드 확인, 2개 파일 진행 체크리스트
- [x] 6번 필터/검색: filter chip + 검색 debounce 300ms
- [x] 7번 폼: Dialog + Form + react-hook-form + zod, 필수(*), 인라인 validation, submit 중 disabled, 성공 토스트
- [x] 8번 접근성 체크리스트 반영
- [x] 9번 반응형: 데스크탑 우선, 테이블 가로 스크롤, 사이드바 → `Sheet` 전환
- [x] 10번 디자인 토큰: 기본값 채택 + 특수 토큰(마이너스 red) 정의

---

## 8. 가정 / 사용자 결정 보류 사항 정리

`next-builder`가 구현 전에 확인하면 좋은 항목.

1. ~~"마이너스" 판정 기준~~ — **v1.4 해결 (2026-05-24)**: 사용자 확정 = **총마진율 < 0%**. KPI "마이너스 건수" 카드 활성화 (음수면 빨강). disabled 필터 폐기, 사용자 임계값 입력(min/max %) + 구간 밖/안 토글 필터로 교체 — 단순 "< 0" 보다 유연한 이상치 검토 도구.
2. **매출일 컬럼의 Excel letter** — `01_requirements_minus.md` "표시 필수 컬럼"에 매출일은 있으나 `excel-mapping/skill.md`·`profit-calc/skill.md`의 K~U·AE에 매출일 letter가 누락. 본 명세는 "향후 letter 확정" 메모로 두고 표시 라벨/포맷만 정의.
3. **CSV 파일명 규칙** — `minus_YYYY-MM-DD.csv` 가정. 사용자 확인 필요 시 변경.
4. **숨김 컬럼(M/T/S/U) 토글 UI** — 본 단계(v1)는 4컬럼 숨김. 향후 `DropdownMenu` 기반 컬럼 토글(`TanStack column visibility`)을 v2에 추가 권장.
5. ~~shadcn `form` 컴포넌트 미설치~~ — **v1.1 해결**: 설치 완료 (`shadcn add form` + `react-hook-form`, `zod`, `@hookform/resolvers`).
6. **인증/로그인** — 사내 도구라는 비기능 요건만 있고 인증 명세는 없음. 본 명세는 헤더 우측에 사용자 이메일을 정적 표시. 인증 도입 시 별도 명세 추가.
7. ~~초기 import 트리거~~ — **v1.1 결정**: UI 업로드는 v1 미제공. 대량 import 는 `pnpm tsx scripts/import-cal-amount.ts` 로 처리 (역순 INSERT 로 엑셀 row 1 이 최신 id 가 되도록). 재실행 시 사용자가 Supabase 에서 `TRUNCATE` 후 실행.
8. **"음수 행 전체 배경" 시각화** — 디자인 토큰에 `bg-red-50`을 정의해두었으나 판정 기준 미확정이라 v1에서는 미적용. 셀 값 음수에만 `text-red-600` 적용.
9. ~~§4(분석) 의 추가후정산금 셀 인터랙션 표기~~ — **v1.1 정리 완료**: §4-1 와이어프레임 주석, §4-2 컴포넌트 명세, §4-3 매핑표, §4-5 시나리오 5, §4-6 키보드 메모 모두 append-only 단일 동작(`appendCalAmount`)으로 통일. ➕/✏️ 는 시각적 affordance 분기만 유지(매칭 실패 vs 이력 있음). 공용 Dialog 는 항상 같은 컴포넌트(`src/components/cal-amount-form-dialog.tsx`)·같은 제목("후정산금 추가"), 분석 페이지에서는 `lockProductCode=true` props 로 productCode readonly 처리. 이력 있는 행을 클릭해도 `extraSettlement` 는 빈 칸으로 시작 (새 이력을 추가하는 동작).

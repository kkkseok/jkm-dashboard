# P5-1 공용 레이아웃 구현 보고서

> 작성: 2026-05-22 / 작성자: `next-builder`
> 입력: `02_uiux_minus.md` §2 (사이드바 IA) + §6 (공용 레이아웃)
> 다음 단계: P5-2 분석/관리 페이지 본문 구현 (`integration-qa`로 검증 후 진입)

---

## 1. 생성/수정 파일

| 경로 | 변경 | 설명 |
|------|------|------|
| `src/app/layout.tsx` | 수정 | `html lang="ko"`, 한글 메타데이터(`title: "JKM Dashboard"`), `font-sans` 시스템 폰트, body 끝에 `<Toaster richColors position="top-center" />` 배치. Geist 폰트 import 제거 |
| `src/app/page.tsx` | 수정 | `redirect('/minus')` 단일 줄. 기존 Next.js 시작 화면 제거 |
| `src/app/(dashboard)/layout.tsx` | 신규 | 라우트 그룹 레이아웃. `sticky h-14` 헤더 + 데스크탑 `w-60` 사이드바 + 모바일 `Sheet` 트리거 햄버거. `useState`로 Sheet 개폐 제어 (Client Component) |
| `src/app/(dashboard)/minus/page.tsx` | 신규 | Server Component. 제목 "마이너스 매출이익률" + 안내 + dashed 박스 placeholder |
| `src/app/(dashboard)/cal-amount/page.tsx` | 신규 | Server Component. 제목 "추가후정산금 관리" + 안내 + dashed 박스 placeholder |
| `src/components/sidebar.tsx` | 신규 | `usePathname()` 기반 활성 매칭. 섹션 라벨(분석/관리) + 활성/비활성/예정 Badge. 하단에 v0.1.0 · 이메일 spacer. `onNavigate` prop으로 모바일 Sheet 자동 닫기 지원 |
| `src/components/ui/sheet.tsx` | 신규(자동) | `pnpm dlx shadcn@latest add sheet` 결과물. 그대로 사용 |

추가 패키지 설치: **없음** (요청한 sheet만 설치)

---

## 2. 사용자가 dev 서버 띄워서 확인할 항목

```bash
pnpm dev
```

브라우저 체크리스트:

- [ ] `/` 접속 → 즉시 `/minus`로 리다이렉트
- [ ] `/minus` 진입 시 사이드바의 "마이너스 매출이익률" 항목에 `bg-accent` 배경 + 좌측 2px primary 보더가 보임
- [ ] `/cal-amount` 진입 시 사이드바의 "추가후정산금 관리" 항목 활성, "마이너스 매출이익률"은 비활성으로 전환
- [ ] "품절 관리", "그룹 업로드" 항목은 회색(muted-foreground) + 우측 "예정" 배지 + 클릭 불가(cursor-not-allowed)
- [ ] 헤더 우측에 `seokcess@glitzy.kr` 정적 표시
- [ ] 헤더 좌측 제품명 "JKM Dashboard" 표시
- [ ] 데스크탑 폭(≥768px)에서 좌측 `w-60` 사이드바 sticky 표시, 본문 `p-6 space-y-6`
- [ ] 모바일 폭(<768px)으로 줄이면 사이드바가 사라지고 헤더 좌측에 햄버거(MenuIcon) 노출
- [ ] 햄버거 클릭 → 좌측에서 Sheet 슬라이드 인, 사이드바 내용 동일
- [ ] Sheet 내부에서 메뉴 항목 클릭 시 자동으로 Sheet 닫힘 (`onNavigate` 콜백)
- [ ] 사이드바 하단에 `v0.1.0` + 이메일 (text-xs muted)
- [ ] 페이지 본문은 dashed 박스 placeholder만 표시 ("분석/관리 화면은 다음 단계에서 구현됩니다.")

빌드 확인 완료:

- `pnpm tsc --noEmit` → 통과 (에러 없음)
- `pnpm lint` → 통과 (경고 없음)
- `pnpm build` → 성공. `/`, `/minus`, `/cal-amount`, `/_not-found` 모두 정적 페이지로 prerender

---

## 3. 다음 단계에서 사용할 디자인 토큰/패턴 메모

### 3-1. 사이드바 활성 표시 패턴

```tsx
// Link 활성 클래스
"flex items-center gap-2 border-l-2 px-3 py-2 transition-colors",
isActive
  ? "border-primary bg-accent text-accent-foreground font-medium"
  : "border-transparent text-foreground hover:bg-muted",
```

- shadcn 기본 팔레트의 `--accent`/`--primary` 토큰만 사용. blue-600 등 임의 컬러는 분석 페이지 KPI/업로드 슬롯 등 §3 특수 토큰에서만 사용 권장 (사이드바는 중립)
- `aria-current="page"`로 스크린리더 접근성 보강

### 3-2. Sheet (모바일 사이드바) 호출 패턴

- shadcn(base-ui) Sheet는 `SheetTrigger`/`SheetContent`에 `render={<Button ... />}` 슬롯 패턴 사용 (Radix와 살짝 다름)
- 헤더에서 `useState<boolean>`로 open 제어 + `onOpenChange`로 동기화, Sidebar에 `onNavigate={() => setMobileOpen(false)}` 전달해 메뉴 클릭 시 자동 close
- `SheetContent`는 `side="left" className="w-64 p-0"` (기본 padding 제거 후 Sidebar 내부 padding 사용)

### 3-3. 페이지 헤더 표준

분석/관리 페이지 모두 동일한 헤더 형식 권장:

```tsx
<header className="space-y-1">
  <h1 className="text-2xl font-semibold">제목</h1>
  <p className="text-sm text-muted-foreground">설명</p>
</header>
```

페이지 액션(예: 분석 페이지의 "재업로드", "CSV 다운로드", 관리 페이지의 "+ 추가")은 `<header>`를 `flex items-start justify-between` 으로 감싸 우측에 배치.

### 3-4. 본문 spacing

- `(dashboard)/layout.tsx`의 `<main>`이 이미 `p-6 space-y-6` 보유
- 페이지 컴포넌트는 자신의 루트를 `<div className="space-y-6">` 만 두면 됨 (p-6 중복 금지)

### 3-5. 폰트

- 시스템 폰트(`font-sans`)만 사용. `globals.css`의 `@layer base { html { @apply font-sans } }` 그대로 유지
- Pretendard 등 향후 한글 폰트 교체는 별도 단계 (현재 단계에서 손대지 않음)

### 3-6. 다크 모드

- `next-themes` provider **추가하지 않았음** (명세대로). `Toaster`는 `next-themes`의 `useTheme`을 사용하지만 provider 없이도 기본 `system` fallback으로 동작
- 향후 다크 모드 활성화 시 `next-themes`의 `ThemeProvider`를 `src/app/layout.tsx`의 body 최상위에 감싸기만 하면 됨

### 3-7. 추가 컴포넌트 설치 필요 시점

- `form`은 §5 (관리 페이지) 구현 시점에 설치 필요: `pnpm dlx shadcn@latest add form`
- `react-hook-form`/`zod`/`@hookform/resolvers`는 이미 설치되어 있음 (package.json 확인 완료)
- `tooltip` (사이드바 disabled 항목 호버 시 안내 등 향후): 현재 미설치

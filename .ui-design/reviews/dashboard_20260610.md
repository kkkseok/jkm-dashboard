# Design Review: jkm-dashboard 전체 대시보드

**Review ID:** dashboard_20260610
**Reviewed:** 2026-06-10
**Target:** 전 페이지(/minus · /products · /cal-amount · /group-sources · /group-upload) + 공용 layout/sidebar/header/ui
**Focus:** 종합(일관성 · 시각 위계 · 접근성 · 간격/타이포), 데이터 대시보드 / 반응형
**기준선:** 인디고 잉크 색 시스템 + Pretendard + 다크모드 + 테이블 compact 통일(이번 세션 적용분)

## Summary

토큰 시스템(OKLCH 인디고·중립·의미색·차트)·Pretendard·테이블 density variant 등 **토대는 견고**합니다. 남은 문제는 거의 전부 **"토큰을 우회한 하드코딩 색"** 한 가지로 수렴합니다 — 일부 화면이 `bg-blue-50`/`amber-*` 같은 고정 Tailwind 색을 써서 (1) 다크모드를 깨뜨리고 (2) 인디고 브랜드와 어긋나며 (3) "경고색" 토큰 부재로 5개 파일이 제각각입니다.

**Issues Found:** 7

- Critical: 0
- Major: 2
- Minor: 2
- Suggestions: 3

---

## Major Issues

### Issue 1: `bg-blue-50` 행 하이라이트 — 다크모드 깨짐

**Severity:** Major · **Category:** Visual / Dark mode
**Location:** `src/app/(dashboard)/minus/minus-analyze-client.tsx:1775`

**Problem:** 후정산금 입력 후 영향받은 행을 강조할 때 `isHighlighted && "bg-blue-50"` 를 쓴다. `bg-blue-50` 은 고정 라이트 블루라 **다크모드 변형이 없다** → 다크 배경에서 밝은 파란 행이 번쩍 튄다. 또한 인디고 브랜드와도 무관한 색.

**Recommendation:** 테마 인지 강조로 교체.
```tsx
// Before
isHighlighted && "bg-blue-50",
// After (브랜드/테마 인지 — 라이트·다크 모두 자연스러움)
isHighlighted && "bg-primary/10",
```

### Issue 2: 업로드 드롭존/선택 상태가 브랜드(인디고) 대신 generic 블루

**Severity:** Major · **Category:** Visual / Brand consistency / Dark mode
**Location:** `minus-analyze-client.tsx:2049-2053` (UploadSlot `stateClass`), `components/product-import-dialog.tsx:232`

**Problem:** 파일 선택/드래그 상태가 `border-blue-600 bg-blue-50/50` 처럼 **고정 블루**다. 방금 primary 를 인디고로 잡았는데 업로드 상태만 블루 → 브랜드 불일치. `bg-blue-50/50` 은 다크모드 변형도 없어 다크에서 어색하다. (에러 상태의 `bg-red-50` 도 동일 — `destructive` 토큰 미사용)

**Recommendation:** 브랜드/시맨틱 토큰으로.
```tsx
// Before
error ? "border-red-600 bg-red-50/50"
      : file ? "border-blue-600 bg-blue-50/50"
             : dragOver ? "border-blue-600 bg-blue-50/30" : "border-dashed ..."
// After
error ? "border-solid border-destructive bg-destructive/5"
      : file ? "border-solid border-primary bg-primary/5"
             : dragOver ? "border-solid border-primary bg-primary/10" : "border-dashed border-muted-foreground/30"
```
참고: `/group-upload`·`/group-sources` 의 드롭존은 이미 `border-primary bg-primary/5` 를 쓴다 → **그쪽이 정답 패턴**. minus 만 안 맞음.

---

## Minor Issues

### Issue 3: "경고색" 시맨틱 토큰 부재 → amber 하드코딩 산재(다크 처리 제각각)

**Severity:** Minor · **Category:** Design system / Consistency
**Location:** `text-amber-*` 5개 파일 — minus:1026, group-upload:247/254/271, group-sources:189, product-import-dialog:453/753

**Problem:** 경고(부분 누락·미매핑 경고 등)에 amber 를 쓰는데 **토큰이 없어 전부 하드코딩**. 더구나 일관성이 없다 — product-import-dialog 만 `dark:` 변형이 있고(`dark:text-amber-200`) 나머지는 라이트 고정값이라 다크모드에서 대비가 약해진다. `positive`/`negative` 는 토큰화했으면서 `warning` 만 빠진 상태.

**Recommendation:** `globals.css` 에 `--warning` / `--color-warning` 토큰 추가(라이트·다크) 후 `text-warning`·`bg-warning/10` 로 통일.

### Issue 4: 페이지 제목 중복 (헤더 바 + 페이지 h1)

**Severity:** Minor · **Category:** Visual hierarchy
**Location:** `app/(dashboard)/layout.tsx`(헤더 PAGE_TITLES) + 각 페이지 `<h1>`

**Problem:** 헤더 바와 페이지 본문 h1 이 같은 제목(예: "마이너스")을 두 번 보여준다. 화면 상단 공간이 중복으로 소비된다.

**Recommendation(택1):**
- (A) 페이지 h1 제거, 헤더 바가 제목 담당(설명문은 본문에 유지) — 수직 공간 절약, 헤더가 위치 표시.
- (B) 헤더 바는 섹션/브레드크럼("분석 / 마이너스")으로 차별화, h1 은 본문 제목 유지.
- 데이터 밀도 우선이면 (A) 추천.

---

## Suggestions

### Suggestion 1: 데이터 테이블 12px(text-xs) — 접근성 하한 인지
compact 통일로 표가 `text-xs`(12px)다. 데이터 밀도엔 적합하나 12px 는 가독성 하한선. 컬럼 적은 표(cal-amount 등)는 `density="default"`(14px) 허용을 고려하거나, 최소 행 높이/대비를 넉넉히. (현 상태 유지도 무방 — 인지만)

### Suggestion 2: 시맨틱 레드(`text-negative`) 소형 텍스트 대비 확인
라이트 `--negative: oklch(0.52 0.20 27)` 는 흰 배경 소형 텍스트에서 WCAG AA(4.5:1) 경계선. 표의 음수 셀이 12px 라 **L 0.52→0.48 정도로 약간 어둡게** 하면 AA 안전. (다크 변형 0.70 은 충분)

### Suggestion 3: 매직 넘버 `h-[480px]`(group-upload 미리보기) 토큰화 여지
미리보기 최대 높이가 매직 넘버. 표 미리보기가 여러 곳 생기면 공통 상수/토큰으로. (현재 1곳이라 우선순위 낮음)

---

## Positive Observations

- **토큰 시스템이 탄탄**: OKLCH 인디고 브랜드 + 쿨 틴트 중립 + `positive`/`negative` 의미색 + 차트 5색, 라이트·다크 양쪽 정의. 무채색 스캐폴드에서 "의도된 시스템"으로.
- **타이포 정합**: Pretendard(한글 가독성) + 숫자 `tabular-nums` 일관 적용.
- **테이블 일관성을 컴포넌트로 강제**: `<Table density="compact">` variant 단일 소스 → 복붙 드리프트 방지.
- **넓은 표 UX**: ScrollSyncContainer 상단 동기화 가로 스크롤바(실제 스크롤 요소에 1:1).
- **드롭존 정답 패턴 존재**: group 페이지들이 `border-primary bg-primary/5` 로 이미 브랜드 정합(이걸 minus 에 확산하면 됨).
- **포커스/접근성 기본기**: `focus-visible:ring-ring`, `aria-sort`/`aria-label`/`role` 적용.

## Next Steps (우선순위)

1. ✅ **Issue 1·2 (다크모드 깨짐 + 브랜드 정합)** — `bg-blue-50`→`bg-primary/10`, 드롭존 blue/red→`primary`/`destructive` 적용 완료(2026-06-10).
2. ✅ **Issue 3 (warning 토큰)** — `--warning`/`--warning-foreground` 토큰 추가(라이트·다크) + amber 하드코딩 전부 `text-warning`/`border-warning bg-warning/15` 로 교체 완료.
3. ✅ **Issue 4 (제목 중복)** — A안 적용(2026-06-10): 본문 h1 전부 제거 + 헤더 페이지 제목을 `<h1>`(font-semibold text-foreground)으로 승격 → 페이지당 h1 1개 유지, 중복 제거.
4. ✅ Suggestion 2 (음수 색 대비) — **실측 검증 완료**: `--negative`(0.52) 흰 배경 대비 **6.11:1**, `--positive`(0.52) **5.07:1** → 12px 소형 텍스트도 WCAG AA(4.5:1) 통과. 변경 불필요(원래 값 유지) + 검증 주석만 추가.
5. ✅ Suggestion 1 (text-xs 밀도) — 사용자 확정 compact 디자인이라 density 유지. 음수/양수 대비는 위에서 AA 검증됨.
6. ⬜ Suggestion 3 (`h-[480px]` 토큰화) — 단일 사용처라 보류(여러 곳 생기면 공통화).

---

_Generated by UI Design Review._

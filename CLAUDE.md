# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 언어 / Language

코드 주석·UI 라벨·커밋 메시지·문서 모두 **한국어**다. 기존 톤을 유지할 것.

## 명령어

패키지 매니저는 **pnpm**.

```bash
pnpm dev                 # next dev (Turbopack). 3000 점유 시 자동으로 3001 등 사용
pnpm build               # next build
pnpm lint                # eslint
pnpm test                # vitest run (전체)
pnpm test <파일경로>      # 단일 파일
pnpm exec vitest run -t "테스트명"   # 이름으로 단일 테스트
pnpm db:generate         # drizzle-kit generate (마이그레이션 SQL 생성)
pnpm db:migrate          # drizzle-kit migrate (적용)
pnpm db:studio           # drizzle-kit studio
```

- **Windows 테스트 주의:** vitest 기본 워커 풀이 `VirtualAlloc failed` 로 죽는 경우가 있다. 그럴 땐 `pnpm exec vitest run --pool=forks <파일>` 로 실행.
- 테스트는 순수 단위 테스트(node env, DB/UI 의존 없음) — `src/**/__tests__/**/*.test.ts`. `@` alias = `src/`.

## 환경변수 (DB)

Supabase Postgres + Drizzle ORM. `.env.local` 에 **연결 문자열 2개**가 필요하다 (`.env.local.example` 참고):

- `DATABASE_URL` — Transaction Pooler(**6543**). 런타임 전용. prepared statement 미지원이라 `src/db/client.ts` 가 `prepare:false`.
- `DATABASE_URL_UNPOOLED` — Session Pooler(**5432**). drizzle-kit 마이그레이션/스크립트 전용.
- IPv4 환경에서는 Direct(`db.xxx.supabase.co`)에 닿지 못하므로 **둘 다 Pooler 호스트**(`aws-0-...pooler.supabase.com`)를 쓴다.

## 아키텍처 — 큰 그림

온라인 판매채널 효율 관리 대시보드. Next.js 16 App Router + TS + Tailwind 4 + shadcn/ui, Supabase Postgres + Drizzle, Vercel 배포.

### 클라이언트 사이드 처리 모델 (핵심 결정)
`/minus` 분석은 **엑셀 파일을 서버로 보내지 않는다.** 3개 xlsx 를 브라우저에서 SheetJS(`xlsx`)로 파싱 → `src/lib/minus/pipeline.ts` `enrichMinusData()` 가 조인·계산 → `EnrichedRow[]`. 수천 행 파일을 서버로 올리면 Vercel 함수 타임아웃(10s)에 걸리므로 클라이언트에서 처리한다. DB 데이터(cal_amount, product_master)는 분석 시점에 **Server Action**(`getCalAmountMap`, `getProductMasterMap`)으로 가져와 파이프라인에 주입한다. 비밀번호 보호 xlsx 는 고정 비번 `"1111"` 로 자동 복호화(`officecrypto-tool`).

### Excel 매핑은 한 곳에 집중
모든 Excel column letter(A, Y, AE, BF …)는 **`src/lib/minus/mapping.ts`** 의 `SALES_MAPPING` / `REVENUE_MAPPING` / `PRODUCT_MAPPING` 에만 둔다. 코드 어디서도 letter 를 하드코딩하지 말 것. 헤더는 2행 병합 구조. 조인 키 = 주문번호(`sales.AE ↔ revenue.E`). 입력 3파일:
- `sales_status_basic` — 기본 데이터(K 매출액, L 공급가, R 이익액, Q 물류비 등)
- `revenue_profit_brand` — 상품코드(Y), 브랜드명(BF)
- `revenue_profit_product` — 상품명(AH), 판매세트 수량(AQ)

### 매출이익 계산은 사용자 정의 비즈니스 룰 (임의 변경 금지)
`src/lib/minus/calc.ts`:
- `computeProfit` — 7개 계산 컬럼(수수료/후정산금/추가후정산금/총마진액/총마진율/최종이익액/최종이익률). 수식은 일반 회계 상식과 달라 보여도 **사용자가 직접 정의한 값**이라 임의로 바꾸지 말 것. **`.claude/skills/profit-calc` 가 수식의 원본 문서**다. 핵심: 총마진액 = `R + 후정산금 + 추가후정산금`(물류비 Q 제외), 총마진율 분모 = 공급가 L, 추가후정산금 = `cal_amount 단가 × product.AQ`.
- `applyCommissionClearing` — 채널/브랜드별 수수료·후정산금 제거 규칙(브랜드명 `CJ-씨제이제일제당(주)` + 매출구분 토스 / 쇼핑엔티·W쇼핑 단품 등). `computeProfit` 직후 후처리로 적용하며 수식 자체는 건드리지 않는다.

### DB / 서버 액션
- `src/db/schema/` — `cal_amount`(append-only, productCode UNIQUE 없음 → productCode 별 최신 1건이 winner), `product_master` + `product_channels`.
- `src/db/client.ts` — HMR 시 connection 누적 방지 싱글톤.
- Server Action 은 `src/lib/{cal-amount,products}/actions.ts`.

### 분석 결과 영속화
`src/app/(dashboard)/minus/analysis-store.ts` — **메모리(모듈 스코프, SPA 메뉴 이동 복귀용)** + **IndexedDB(전체 새로고침/다음 방문용)** 2계층. localStorage 는 수천 행에 용량 초과라 쓰지 않는다.

### 페이지 / 레이아웃
`src/app/(dashboard)/` route group + 공용 `layout.tsx`(사이드바·헤더). 페이지: `/minus`(분석), `/products`(상품 마스터), `/cal-amount`(후정산금 관리). 테이블은 TanStack Table, 컬럼 표시/숨김·헤더 엑셀식 필터(매출구분/브랜드명/구분)·CSV 내보내기 포함.

## shadcn/ui 는 base-ui 기반

UI 컴포넌트는 내부적으로 `@base-ui/react` 를 쓴다(Radix 아님). 주의:
- 트리거는 **`render` prop** 패턴: `<PopoverTrigger render={<Button … />} />`, `<DropdownMenuTrigger render={<Button … />} />`.
- `DropdownMenuLabel`(GroupLabel)은 반드시 `<DropdownMenuGroup>` 안에 있어야 한다(아니면 런타임 에러).
- 새 패턴은 `.claude/skills/shadcn-patterns` 참조.

## .claude 하네스 & 설계 문서

- `.claude/skills/` 에 프로젝트 컨벤션이 인코딩돼 있다: `excel-mapping`(파싱/JOIN/letter), `profit-calc`(수식 원본), `supabase-drizzle`(DB), `shadcn-patterns`(UI), `ux-patterns`, `integration-check`, 오케스트레이터 `feature-build`. 해당 작업 시 먼저 참조.
- `_workspace/*.md` = 모듈별 설계 문서(요구사항/UIUX/스키마/파이프라인/QA). 구현이 앞서가 문서가 뒤처질 수 있으니 **코드를 우선 신뢰**하고 문서는 의도 파악용으로 본다.

## 알아둘 점

- `src/app/(dashboard)/minus/minus-analyze-client.tsx` 는 파일 내 BOM 문자 때문에 **git 이 바이너리로 감지**한다 → 커밋 시 line diff(insertions/deletions)가 0 으로 표시되지만 변경은 정상 반영된다. ripgrep 도 이 파일을 바이너리로 보므로 검색은 텍스트 모드(`grep -a`)를 쓴다.

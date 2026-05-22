---
name: feature-build
description: jkm-dashboard에 새 기능(분석 화면, CRUD 화면 등)을 추가하는 오케스트레이션 — UX 설계 → DB 스키마 → 데이터 파이프라인 → UI 구현 → 통합 QA의 5단계를 에이전트에게 나눠 실행. 새 화면/페이지/기능 추가, minus/soldout/group 같은 모듈 빌드, 큰 마일스톤 작업 시 호출.
---

# 기능 빌드 오케스트레이터

`jkm-dashboard`에 새 기능(예: 마이너스 분석, 품절 관리, 그룹 업로드)을 추가할 때 메인 Claude가 따르는 워크플로우. 에이전트들을 순차/병렬로 호출하여 한 기능을 완성한다.

## 0. 실행 모드 결정

| 작업 규모 | 모드 | 운영 |
|----------|------|------|
| 단순 수정 (1~2명 에이전트, 5작업 이하) | **서브 에이전트 풀** | 메인 Claude가 필요한 에이전트만 골라 1회씩 호출 |
| 기능 전체 빌드 (4명+ 에이전트, 10작업+) | **에이전트 팀** | `TeamCreate`로 팀 구성, `TaskCreate`로 의존 관계 작업 분배 |

새 기능 추가는 보통 후자. 첫 기능(`minus`)은 팀 모드 권장.

## 1. 단계 (Phase) 흐름

```
[P1 요구사항 확정] (메인 Claude + 사용자)
       ↓
[P2 UX 설계]     uiux-designer
       ↓
[P3 DB 스키마]   db-engineer       ← P2에서 데이터 모델 합의 후
       ↓
[P4 데이터 파이프라인] data-pipeline  ← 매핑/계산 정의 후
       ↓
[P5 UI 구현]     next-builder       ← P2 명세 + P3/P4 출력 입력
       ↓
[P6 통합 QA]    integration-qa     ← P3~P5 완성 직후 incremental
       ↓
[P7 사용자 시연/배포] (메인 Claude)
```

**병렬 가능 구간:** P3(DB) ↔ P4(파이프라인) — 둘이 서로 의존 없으면 동시 진행.

## 2. 단계별 산출물 (파일 기반 전달)

`_workspace/` 디렉토리에 중간 산출물 저장. 컨벤션: `{phase}_{agent}_{feature}.{ext}`

| Phase | 파일 | 작성자 | 사용자 |
|-------|------|--------|--------|
| P1 | `_workspace/01_requirements_<feature>.md` | 메인 Claude | 모두 |
| P2 | `_workspace/02_uiux_<feature>.md` | uiux-designer | next-builder, integration-qa |
| P3 | `_workspace/03_schema_<feature>.md` (스키마 요약) + `src/db/schema/*.ts` | db-engineer | next-builder, data-pipeline |
| P4 | `_workspace/04_pipeline_<feature>.md` + `src/lib/<feature>/*.ts` | data-pipeline | next-builder |
| P5 | `src/app/.../page.tsx`, `*-client.tsx`, `src/lib/<feature>/actions.ts` | next-builder | integration-qa |
| P6 | `_workspace/06_qa_<feature>.md` (검증 보고서) | integration-qa | 메인 Claude |

`_workspace/`는 git에 커밋(감사 추적). `src/`는 코드 본체.

## 3. 데이터 전달 프로토콜

- **태스크 기반 (팀 모드):** `TaskCreate`로 각 Phase를 작업으로 등록, 의존 관계는 `depends_on`으로
- **파일 기반:** 각 Phase 산출물은 위 컨벤션의 파일로 저장. 다음 Phase는 경로로 참조
- **메시지 기반 (팀 모드):** 팀원 간 즉각적 질의(예: data-pipeline이 db-engineer에게 컬럼명 확정 요청)

## 4. 단계별 실행 가이드

### P1: 요구사항 확정
- 사용자가 무엇을 원하는지 한글 한 문단으로 정리
- 입력 데이터(파일/스키마)와 기대 출력(화면/CRUD/내보내기) 명시
- 보류 항목은 명시적으로 적어 빠뜨리지 않게

### P2: UX 설계 (`uiux-designer` 호출)
프롬프트 예:
> `_workspace/01_requirements_minus.md`를 읽고 `ux-patterns` 스킬을 적용해 와이어프레임 + 명세 작성. 산출물은 `_workspace/02_uiux_minus.md`에 저장. 체크리스트 11개 항목 모두 충족할 것.

검증: ASCII 와이어 존재, 4상태 명세, 컴포넌트 목록.

### P3: DB 스키마 (`db-engineer` 호출, P4와 병렬 가능)
프롬프트 예:
> `02_uiux_minus.md`에서 영속 데이터 항목 식별. `cal_amount` 테이블 정의 + 마이그레이션 생성. `neon-drizzle` 스킬 참조. `cal_amount.xlsx` import 스크립트도 함께 작성.

검증: 마이그레이션 SQL이 안전(파괴적 변경 없음), import 스크립트 실행 가능.

### P4: 데이터 파이프라인 (`data-pipeline` 호출)
프롬프트 예:
> `memory/project_minus_logic.md`와 `excel-mapping`/`profit-calc` 스킬을 적용해 두 엑셀 파일을 받는 순수 함수 작성: `enrich(salesRows, revenueRows, lookupMap): EnrichedRow[]`. 단위 테스트 1개 이상 포함.

검증: 함수 시그니처 명확, 엣지 케이스(K=0, 룩업 실패) 처리, 테스트 통과.

### P5: UI 구현 (`next-builder` 호출)
프롬프트 예:
> P2 명세(`02_uiux_minus.md`)와 P3/P4 산출물을 import하여 페이지/Server Action/클라이언트 컴포넌트 구현. `shadcn-patterns` 스킬 참조. 모든 4상태(빈/로딩/에러/성공) 구현.

검증: `pnpm tsc --noEmit` + `pnpm build` 통과, dev 서버에서 페이지 접속 가능.

### P6: 통합 QA (`integration-qa` 호출)
프롬프트 예:
> P5 완성 후, `integration-check` 스킬의 5단면(A~E)을 모두 검증. 보고서 `_workspace/06_qa_minus.md` 저장.

검증: 통과/실패 항목 명시, 실패는 수정 담당 에이전트 지정.

### P7: 시연/배포
- 메인 Claude가 사용자에게 dev 서버 실행 방법 안내
- 사용자 OK 후 `git commit` (사용자 명시 요청 시) → Vercel 배포

## 5. 에러 핸들링

| 에러 유형 | 전략 |
|----------|------|
| 에이전트 1회 실패 | 동일 프롬프트로 1회 재시도. 재실패 시 결과 누락 명시하고 다음 Phase로 (단, P3/P4 같은 핵심 의존은 중단) |
| QA 검출 이슈 | 해당 에이전트로 환송하여 수정. 다른 모듈은 진행 가능 |
| 명세-구현 충돌 | 사용자에게 결정 요청. 임의 변경 금지 |
| 사용자 정의 수식 vs 일반 공식 충돌 | **사용자 정의 우선.** `profit-calc` 스킬에 명시된 룰 변경 금지 |
| 마이그레이션 데이터 손실 위험 | db-engineer가 자동 적용 금지하고 사용자 승인 요청 |

## 6. 팀 크기 (팀 모드 시)

기능 1개 빌드는 보통 **에이전트 4~5명, 작업 10~20개** → 팀원 4~5명 권장. 메인 Claude는 리더.

## 7. 테스트 시나리오

### 정상 흐름 (`minus` 기능)
1. 사용자: "마이너스 매출이익률 기능 구현해줘"
2. `feature-build` 호출 → P1: 요구사항을 `memory/project_minus_logic.md`에서 가져옴
3. P2: `uiux-designer` → 분석 페이지 + 추가후정산금 관리 페이지 2개 명세
4. P3 ‖ P4: `db-engineer`(cal_amount 테이블) ‖ `data-pipeline`(매핑+5컬럼 계산)
5. P5: `next-builder` → 2개 페이지 + Server Action + 업로드 클라이언트
6. P6: `integration-qa` → 5단면 검증, 통과
7. P7: 메인 Claude가 `pnpm dev` 안내 + 시연 결과를 사용자에게 확인

### 에러 흐름 (예: QA에서 키 불일치 발견)
1. P6에서 `commissionRate` ↔ `commission_rate` 불일치 검출
2. `integration-qa` 보고서에 "수정 담당: next-builder" 명시
3. 메인 Claude가 `next-builder` 재호출 → 수정
4. `integration-qa` 재검증 → 통과
5. P7 진행

## 8. 새 기능 추가 시 추가로 작성할 스킬

`minus` 이후 다음 기능들이 예정됨. 각 기능 고유 룰은 `.claude/skills/<feature>-rules/` 같은 스킬로 추가:
- `soldout-rules` — 품절 식별/관리 룰
- `group-rules` — 그룹 업로드 룰

본 오케스트레이터는 변경 없음. 새 룰 스킬은 `data-pipeline`이 참조하도록만 안내.

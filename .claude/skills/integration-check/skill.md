---
name: integration-check
description: jkm-dashboard 모듈 간 경계면 검증 체크리스트 — Excel column letter ↔ pipeline 필드 ↔ DB 컬럼 ↔ API 응답 키 ↔ UI 표시 컬럼이 한 줄로 일치하는지 교차 비교. 디자인 명세 ↔ 실제 구현 차이 검출. integration-qa 에이전트가 모듈 완성 직후 실행.
---

# 경계면 통합 검증 체크리스트

`integration-qa`가 사용. **존재 확인이 아니라 교차 비교**가 핵심이라는 점을 잊지 말 것.

## 1. 데이터 흐름 추적 (수직 단면)

한 컬럼이 사용자에게 도달하기까지의 모든 경유점을 추적한다.

예: "총마진율" 추적
```
[정의]     profit-calc skill: totalMarginRate = totalMargin / L
[메모리]   memory/project_minus_logic.md: 총마진율 = 총마진액 / L
[코드]     src/lib/minus/calc.ts → totalMarginRate
[API]      Server Action 반환 타입에 totalMarginRate: number | null
[UI 컬럼]  DataTable column id: 'totalMarginRate'
[UI 라벨]  "총마진율"
[포맷]     비율 (%) 표기
```

**모든 경유점에서 한 식별자(`totalMarginRate`)가 동일해야 한다.** 한 군데라도 다르면 (예: `totalMarginRatio`) 경계면 버그.

## 2. 검증 우선순위 (단면별)

### A. Excel letter ↔ pipeline 필드
- [ ] `MINUS_MAPPING` 등 매핑 설정 객체와 `memory/project_minus_logic.md`의 letter가 일치
- [ ] 파일별 헤더 행 수(`headerRows`) 정확
- [ ] key 컬럼 letter가 LEFT/RIGHT 양쪽 다 명시되어 있음

### B. pipeline 출력 ↔ DB 스키마 (해당되는 경우만)
- [ ] 영속화되는 필드의 타입 일치 (number vs integer, string vs text)
- [ ] NOT NULL 제약과 pipeline의 null 가능성 일관
- [ ] 인덱스(특히 unique)가 사용자 의도와 맞는지

### C. DB ↔ Server Action 응답
- [ ] zod schema의 필드 = Drizzle 스키마의 컬럼 (camelCase 변환 일관)
- [ ] 누락된 필드 없음
- [ ] 응답 타입(`infer`)이 클라이언트에서 import되어 사용

### D. Server Action ↔ Client hook/component
- [ ] 호출 측의 인자가 zod schema와 일치
- [ ] 응답 사용 측에서 `.totalMarginRate` 등 키가 실제 응답 키와 일치 (오타·camelCase 누락 가장 흔함)
- [ ] null 가능 필드에 옵셔널 체이닝 또는 가드 있음

### E. uiux 명세 ↔ 구현
- [ ] 명세에 명시된 컴포넌트(shadcn 명칭)가 코드에 실제 사용
- [ ] 명세에 명시된 4개 상태(빈/로딩/에러/성공) 모두 구현
- [ ] 필드 → UI 컬럼 매핑 표와 실제 DataTable column 정의 일치
- [ ] 필수(*) 표시된 폼 필드에 zod required 적용
- [ ] 키보드/접근성 메모 사항 반영 (`aria-label`, `htmlFor`)

## 3. 자동 검증 명령

다음을 1회 이상 통과시킬 것:
```bash
pnpm tsc --noEmit              # 타입 에러 0
pnpm lint                      # eslint 통과
pnpm build                     # 프로덕션 빌드 성공
```

타입 에러는 보통 경계면 불일치의 가장 빠른 신호다. 빌드까지 통과하지 않은 모듈은 QA 대상에서 제외하고 해당 에이전트에 환송.

## 4. 자주 발견되는 버그 패턴

| 패턴 | 예시 | 진단 방법 |
|------|------|----------|
| **키 이름 불일치** | API: `commissionRate`, UI: `commission_rate` | grep으로 양쪽 다 검색 |
| **null 처리 누락** | 0으로 나누기로 NaN 반환, UI에서 "NaN%" 표시 | 계산 함수의 분기 + UI 가드 동시 확인 |
| **숫자 포맷 누락** | 1234567 그대로 표시 (천 단위 구분자 없음) | UI 셀 렌더러 검토 |
| **음수 강조 누락** | 마이너스 값에 빨간색 미적용 | 디자인 명세 ↔ 구현 비교 |
| **빈 상태 누락** | data가 [] 일 때 빈 테이블만 표시 | UI 컴포넌트의 분기 확인 |
| **헤더 행 잘못 셈** | 데이터 첫 줄이 헤더와 섞여 NaN 다수 | pipeline 출력 첫 행 샘플링 |
| **JOIN key 타입 불일치** | 한쪽 `"1234"`, 한쪽 `1234` | LEFT JOIN 결과 unmatched_count 확인 |
| **server/client 경계 오류** | "use client" 누락된 hook 사용 | 빌드 에러로 즉시 잡힘 |

## 5. 보고서 양식

```markdown
## 검증 범위
- 기능: <feature>
- 단면: <A/B/C/D/E 중 어느 것>
- 검증 시점: <yyyy-mm-dd>

## 통과
- [x] …

## 실패/주의
1. **<이슈 한 줄 요약>** (심각도: high/med/low)
   - 위치: `src/...:LL`
   - 기대: …
   - 실제: …
   - 단면: <A/B/C/D/E>
   - 수정 담당: <agent-name>
   - 재현/검증 방법: …
```

## 6. 점진적 QA 운영 (Incremental QA)

- 기능 단위 전체 완성 후 1회 검증이 아니라, **각 모듈 완성 직후 즉시 검증**
- 발견된 이슈는 다음 모듈로 넘어가기 전에 해결
- 모듈 의존 순서: 스키마 → 파이프라인 → API → UI. 각 단계에서 직전 단계와의 경계만 본다(부담 분산).

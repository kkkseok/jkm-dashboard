# 상품 마스터(`product_master`) — 요구사항

> 작성: 2026-05-27 / 출처: 사용자 대화 (다음 진행 작업 확정 세션)
> 보류였던 "단품/복합 구분(product_master.BD)" 재개 + 채널별 상품코드 통합 관리로 스코프 확장.

## 1. 배경

- 마이너스 매출이익률 화면(v1.6)까지 운영 중. 다음 마일스톤으로 "단품/복합 구분" 보류 항목 재개.
- 단순 플래그가 아니라 **브랜드 × 채널별 상품코드 + 단품/복합** 를 한 곳에서 관리하는 마스터 메뉴 신설.
- 한 논리 상품이 채널마다 다른 `productCode` 를 가질 수 있음 (예: A브랜드 A-1채널 `1234` / A-2채널 `4321`). 같은 논리 상품이면 단품/복합 값은 동일.

## 2. 사용자 시나리오

판매채널 운영 담당자가:
1. `/products` 메뉴에서 상품 마스터를 관리한다 (등록·수정·삭제).
2. 마이너스 분석 화면에서 결과 테이블에 표시되는 **"구분(단품/복합)"** 컬럼·필터로 분석 범위를 좁힌다.

## 3. 입력 데이터

| 종류 | 방식 | 비고 |
|------|------|------|
| 초기/대량 등록 | 엑셀 일괄 import | 포맷(컬럼 순서)은 P2에서 사용자와 합의. P3 import 스크립트로 처리 |
| 일상 운영 | 웹 수동 CRUD | `cal_amount` 관리 페이지와 동일한 폼 패턴 (Dialog 기반) |

> ※ 마이너스 분석 화면 인라인 등록(셀 클릭 → Dialog)은 **이번 스코프에 포함하지 않음**.
> ※ 향후 필요시 추가 (cal_amount 인터랙티브 셀과 동일 패턴으로 확장 가능).

## 4. 데이터 모델 (확정)

테이블: `product_master`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | bigserial | PK | 내부 ID |
| `product_code` | text | **UNIQUE NOT NULL** | sales 의 `productCode` (= brand.Y) 와 조인되는 키 |
| `channel_name` | text | NOT NULL | 채널 식별자 (예: "A-CJ온스타일(jkman2)", "[B2B]" 등). sales.A(salesType) 값과 정합 권장하나 자유 문자열 |
| `brand_name` | text | NOT NULL | 브랜드명 |
| `product_name` | text | NOT NULL | 상품명 (사용자 관리용. brand 엑셀의 상품명과 별개 라벨로 사용 가능) |
| `is_composite` | boolean | NOT NULL | 복합 상품 여부 (true=복합, false=단품) |
| `created_at` | timestamptz | default now() | |
| `updated_at` | timestamptz | default now() | 수정 시 자동 갱신 |

**키 운영 원칙**
- `product_code` UNIQUE → 한 코드 = 한 행. cal_amount 의 append-only 와 달리 **일반 upsert/CRUD**.
- 같은 논리 상품이 채널마다 다른 코드를 가지면 → 각 코드별로 행이 생긴다 (별 정규화 없음).
- 같은 논리 상품의 단품/복합 값은 동일하게 입력될 것을 사용자 운영이 보장 (검증 로직은 두지 않음 — 입력 자유).

## 5. 활용 (마이너스 분석 페이지)

조인 키: **`productCode` 단독** (sales→brand 조인 결과의 productCode).

추가 출력:
- 결과 테이블 신규 컬럼 **"구분"**: `is_composite` true → "복합" / false → "단품" / 매칭 실패 → "-"
- 필터: "구분" 다중 선택 (단품 / 복합 / 미매칭). 기본은 전체.
- CSV 출력에도 "구분" 컬럼 포함 (현재 16 → 17 컬럼).
- KPI 카드 단품/복합 분리 표시는 **이번 스코프에서 제외** (사용자가 선택하지 않음).

## 6. 출력 (관리 페이지 — `/products`)

`cal_amount` 관리 페이지와 동일 패턴.

- 검색(상품코드 / 상품명 / 브랜드명 / 채널명 부분일치)
- 정렬 (상품코드 / 채널 / 브랜드 / 등록일)
- 페이지네이션 100건/페이지
- 작업: 신규 등록 버튼 + 행별 수정/삭제 액션
- 폼 필드: 상품코드(중복 검증) / 채널명 / 브랜드명 / 상품명 / 단품·복합 토글

## 7. 보류 / 확정 정리

| 항목 | 상태 |
|------|------|
| 메뉴명 / 경로 | **확정**: 상품 마스터 / `/products` |
| 테이블 키 구조 | **확정**: `product_code` UNIQUE 직접 저장 |
| 마이너스 조인 키 | **확정**: `productCode` 단독 |
| 초기 데이터 입력 방식 | **확정**: 엑셀 일괄 import + 웹 수동 CRUD |
| 마이너스 인라인 등록 | **이번 스코프 제외** (cal_amount 와 다른 점) |
| KPI 단품/복합 분리 카드 | **이번 스코프 제외** |
| 엑셀 import 컬럼 포맷 | P2 에서 사용자와 합의 |
| sales.A 와 `channel_name` 정합 (자동 매핑) | P2/P5 에서 사용성 판단 — 일단 자유 문자열 |

## 8. 비기능 요건

- 사내 사용, 매일 1회 정도. `cal_amount` 와 동일 운영 빈도.
- 엑셀 import 1회당 수백~수천 행. SheetJS 파싱 후 Server Action 으로 bulk insert.
- 데이터 민감도는 보통 (제품 마스터 — 가격/마진 정보 없음).

## 9. 작업 흐름 (feature-build 5단계 매핑)

| Phase | 산출물 | 담당 |
|-------|--------|------|
| P1 | 본 문서 | 메인 Claude |
| P2 | `_workspace/02_uiux_products.md` (관리 페이지 + 마이너스 컬럼·필터 명세) | `uiux-designer` |
| P3 | `_workspace/03_schema_products.md` + `src/db/schema/product_master.ts` + 마이그레이션 | `db-engineer` |
| P4 | 엑셀 import 파이프라인 + 마이너스 조인 로직 갱신 명세 | `data-pipeline` |
| P5 | `/products` 페이지 + 마이너스 페이지 컬럼/필터 통합 | `next-builder` |
| P6 | `_workspace/06_qa_products.md` | `integration-qa` |
| P7 | 시연 + Vercel 배포 | 메인 Claude |

병렬 가능: **P3 ‖ P4** (테이블 스키마 ↔ 엑셀 import 사양은 컬럼 합의 후 동시 진행 가능).

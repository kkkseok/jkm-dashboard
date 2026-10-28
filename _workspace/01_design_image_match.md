# 이미지 대조 (image-match) — 설계 초안

> 작성: 2026-10-28 / 상태: **초안 — 사용자 합의 전**
> 근거: 18쌍 PoC (`docs/matching/url_matching_example.xlsx`), Codex 브레인스토밍 의견 반영
> 다음 단계: 합의 → P1(스키마·업로드)부터 단계별 구현

---

## 1. 목표 / 범위

원본 **CJ더마켓** 상품과 판매 채널 **GS샵** 상품을 쌍으로 등록하고, 정기 배치로 **썸네일·상세페이지 내용이 서로 다른 쌍**을 찾아 대시보드에 표시한다. 사용자가 GS를 수정하고 "처리 완료"를 누르면 다음 배치가 다시 확인해 상태를 바꾼다.

- 원본은 항상 CJ더마켓, 비교 대상은 GS샵만.
- 대상 규모 ≤ 500쌍, 주기 1일 1회(부하 크면 주 1회).
- **비교는 교차 비교(CJ vs GS)**. 해시는 "다름" 판정이 아니라 AI 재판정 여부를 정하는 게이트로만 쓴다.

비범위: 알림 발송(메일/슬랙), CJ 외 원본, GS 외 채널, 가격·재고 비교.

## 2. 전체 흐름

```
[사용자] 엑셀 업로드 (/image-match 의 [대상 엑셀 업로드] 대화창)
     └─▶ match_pair upsert (자재코드 기준)

[GitHub Actions cron, 매일 KST 새벽]  scripts/match/run.ts
  1. 등록된 전체 쌍 로드
  2. 수집: CJ 페이지·GS 페이지·GS 상세 iframe → 썸네일/상세 이미지 URL
  3. 이미지 다운로드 → 콘텐츠 해시 (GS 공통 영역 제외)
  4. 게이트: 양쪽 해시가 지난번과 같고 상태가 확정이면 → 이전 판정 유지 (AI 호출 없음)
  5. 판정 필요 쌍 → Claude 비전 판정 (Batch API)
  6. match_check 기록, match_pair 상태 전이, match_run 로그

[사용자] 대시보드 (/image-match) — 불일치 목록 · 좌우 비교 · 처리 완료
```

배치는 Vercel 이 아닌 **GitHub Actions** 에서 돈다. Vercel Hobby 의 함수 실행 시간·cron 제한으로 500쌍 × 이미지 수십 장을 처리할 수 없기 때문. 대시보드(Vercel)는 DB 를 읽고 상태만 바꾼다.

## 3. 수집 규칙 (PoC 로 확인된 구조)

| | 썸네일 | 상세 |
|---|---|---|
| **CJ** | `og:image` (1080px 원본) | `__NUXT_DATA__` 의 문서 중 `docDispPtnCd="05"`, `useYn="Y"`, `dispOdr` 순. `contDesc`(이미지 설명 문구) 함께 저장. **mp4 는 제외** |
| **GS** | `og:image` 의 끝 사이즈를 `/1000` 으로 교체 (`asset.m-gs.kr/prod/{prdid}/1/1000`) | iframe `#prdDetailIfr` src(`/mi15/prd/prdImgDesc.gs?...`) 를 별도 요청 → 주석 제거 후 `<img src>` 순서대로 |

- **GS 공통 영역 자동 제외:** 모든 GS 상세 앞에 판매사 공통 이미지(공식 인증 판매처 / 리셀러 공지 / 고객센터 제이케이엠 / 파손 교환 안내)가 붙는다. 이미지 해시가 **활성 GS 상품의 N% 이상(예: 30%)에 등장하면 공통 이미지로 간주**해 비교에서 뺀다. 수동 목록 관리 불필요. 브랜드 리뉴얼 안내처럼 일부 상품군 공통인 것도 같이 걸러진다.
- **해시는 URL 이 아니라 이미지 바이트 기준.** GS 상세 URL 은 토큰형이라 바뀔 수 있다.
- **상세 이미지 URL 캐시 (P2 구현):** 직전 정상 수집과 URL 이 같으면 해시를 재사용하고 다운로드를 생략한다(CJ 는 업로드마다 새 파일명, GS 는 리소스별 토큰 URL). 썸네일은 URL 이 고정이라 매번 받는다. `--full` 로 전부 재다운로드. 실측(18쌍): 캐시 7초 / 전체 13~26초, 전체 재다운로드해도 해시 변경 0.
- **게이트 기준 = 마지막 AI 판정 check**(직전 수집 아님) — 판정이 밀린 사이의 변경을 놓치지 않기 위해.
- 실측 공통 이미지: 상품당 9장(앞 5: 인증 판매처·리셀러 공지·고객센터·교환 주의 / 뒤 4: 주문·배송·교환·AS 안내), 해시 6종.
- 요청 예절: 동시 2~3, 요청 간 지연, 재시도 2회, 브라우저 UA. 200 이어도 og:image/iframe 이 없으면 **수집 실패**로 처리(차단 페이지 대비).
- 이미지 원본은 **저장하지 않는다**(Storage 비용). URL·해시·크기만 저장하고 대시보드는 원본 URL 을 바로 띄운다.

## 4. DB 스키마 (신규 5테이블, 기존 기능과 분리)

### `match_pair` — 대조 대상 + 현재 상태
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | bigserial PK | |
| mat_code | text NOT NULL **UNIQUE** | 자재코드 (업로드 upsert 키). **자재코드 1개 = 상품 쌍 1개** (사용자 확정) |
| product_name | text NOT NULL | 엑셀 자재명 |
| cj_url / gs_url | text NOT NULL | |
| status | text NOT NULL default 'new' | §5 상태값 |
| status_changed_at | timestamptz | |
| diff_summary | text | 최근 판정의 차이 요약(목록 표시용) |
| last_checked_at | timestamptz | 마지막 **시도** |
| last_success_at | timestamptz | 마지막 **정상 수집** |
| last_judged_at | timestamptz | 마지막 **AI 판정** |
| resolved_note | text | 처리 완료 메모 |
| created_at / updated_at | timestamptz | |

### `match_check` — 배치 1회 × 쌍 1개 결과 (append)
pair_id, run_id, fetch_ok, fetch_error, cj_thumb_hash, gs_thumb_hash, cj_detail_hash(상세 이미지 해시 목록의 합성 해시), gs_detail_hash, cj_detail(jsonb: url·hash·desc 목록), gs_detail(jsonb), judged(boolean — AI 호출 여부), verdict(jsonb — §6 출력), model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, api_equiv_usd, judge_ms, created_at. (사용량 필드는 §6-1)
→ 게이트는 "직전 정상 check 의 4개 해시와 비교"로 판단. 보관 기간은 90일(이후 정리).

### `match_run` — 배치 실행 로그
id, started_at, finished_at, total, fetched, judged, failed, deferred(상한 초과로 미룬 쌍), input/output/cache 토큰 합계, api_equiv_usd 합계, error. 대시보드에서 "마지막 성공 배치가 36시간 넘었으면 경고".

### `match_status_log` — 상태 전이 이력
pair_id, from_status, to_status, actor('batch' | 'user'), note, created_at.

### `match_common_image` — GS 공통 이미지 해시 (배치가 자동 갱신)
hash PK, occurrences, updated_at.

## 5. 상태값

| status | 라벨 | 의미 |
|---|---|---|
| `new` | 미확인 | 등록 후 아직 판정 전 |
| `match` | 일치 | |
| `diff` | **불일치** | 차이 있음 — 사용자 조치 필요 |
| `done` | 처리 완료(확인 대기) | 사용자가 GS 수정 후 표시 |
| `unfixed` | **미반영** | 처리 완료했는데 다음 배치에서도 다름 |
| `unsure` | 판정 보류 | AI 가 확신 못함 → 사람 확인 |
| `error` | 수집 실패 | 페이지 구조 변경·차단·URL 오류 |

전이:
```
new ──판정──▶ match / diff / unsure
match ──해시 변경 + 판정 다름──▶ diff
diff ──사용자 "처리 완료"──▶ done
done ──다음 배치: GS 해시 변경 없음──▶ unfixed   (AI 호출 없음)
done ──다음 배치: GS 해시 변경 → 판정 같음──▶ match
done ──다음 배치: GS 해시 변경 → 판정 다름──▶ unfixed
unfixed ──사용자 "처리 완료"──▶ done
unsure ──사용자 "일치로 확정" / "불일치로 확정"──▶ match / diff
(어떤 상태든) 수집 실패 ──▶ error, 다음 정상 수집 시 직전 판정 상태로 복귀
```

## 6. AI 판정

- **실행 수단 (사용자 확정 2026-10-28): GitHub Actions 안에서 Claude Code 헤드리스(`claude -p`)를 Max 구독 OAuth 토큰으로 실행.** API 키·API 과금 없음, PC 불필요. 구독 사용량을 평소 대화형 사용과 공유하므로 새벽에 실행하고 **1회 판정 수 상한**(초기값 30쌍, 측정 후 조정)을 둔다. 상한을 넘는 쌍은 상태 그대로 두고 다음 실행에서 이어서 처리(첫 500쌍 기준 판정은 며칠에 나눠 진행).
- **판정부는 인터페이스로 분리**(`judge(pair) → verdict + usage`) — 나중에 Claude API(+Batch 할인)로 바꿔도 수집·상태 로직은 그대로.
- **호출당 고정 오버헤드 주의 (실측):** 저장소 안에서 `claude -p` 를 그냥 실행하면 "1+1" 질문에도 시스템 프롬프트·CLAUDE.md·도구 정의로 **약 45k 토큰**(cache 생성 28.7k + cache 읽기 16.4k)이 들었다(기본 모델 Opus). 줄이는 방법:
  - 저장소 밖 빈 작업 폴더에서 실행해 CLAUDE.md·스킬 로딩을 피한다. 도구는 이미지 읽기(Read)만 허용.
  - 판정용 시스템 프롬프트를 짧게 직접 지정한다.
  - **모델을 명시**(`--model`) — 썸네일·상세 대조는 Opus 가 아니어도 될 가능성이 커서 P3 에서 Sonnet/Haiku 정확도를 비교한다.
  - 여러 쌍을 한 호출에 묶을지는 P3 에서 측정한 뒤 정한다(오버헤드 분산 vs 판정 정확도·실패 영향 범위).
- **입력:** CJ 썸네일 + GS 썸네일, CJ 상세 이미지(+contDesc) + GS 상세 이미지(공통 영역 제외). 긴 상세 이미지는 글자가 읽히는 폭(약 800px)으로 줄이고 세로로 분할.
- **출력(JSON):**
  ```json
  { "thumbnail": "same|diff|unsure", "detail": "same|diff|unsure",
    "differences": [{ "area": "thumbnail|detail", "what": "패키지 디자인", "cj": "...", "gs": "..." }],
    "summary": "한 줄 요약" }
  ```
- **판정 규칙(임시 — 사용자 확정 대기):**
  - 무시: 구도·연출 배경, 세트 수량 표현(x3, 24+24), GS 전용 배지("CJ제일제당 공식"), 공통 공지·배송 안내, 리뉴얼 안내 배너, 해상도·압축 차이.
  - 차이로 판정: 패키지 디자인(리뉴얼 전/후), 에디션(콜라보 패키지 등), 상품 구성(입수·용량), 표기(중량·kcal·인분·성분·원산지), 상세 본문의 구성·문구·사진 차이.
- 규칙은 코드 상수 1곳(`src/lib/match/judge-rules.ts`)에 두고 버전을 기록 → 규칙이 바뀌면 전체 재판정 가능.

### 6-0. P3 측정 결과 (2026-10-28, 18쌍)
- 실행 옵션 최적화로 호출당 고정 오버헤드 약 4.5만 → **약 750 토큰**. `--bare` 는 API 키 전용이라 구독(OAuth)에선 못 씀.
- 이미지: 썸네일 최대 1000px, 상세는 폭 700 으로 이어 붙여 1400px 구간(쌍당 10~38장).

| 모델 | 쌍당 입력(캐시 포함) | 쌍당 출력 | 쌍당 시간 | API 환산/쌍 |
|---|---|---|---|---|
| haiku | 약 2.7만 | 약 1,900 | 17.5초 | $0.006 |
| **sonnet (채택)** | 약 4.0만 | 약 500 | 12.7초 | $0.11 |

- 정확도: 두 모델 대부분 일치. 221042 상세(CJ 육각형 도표에 수치 있음, GS 는 항목명만 — 구 버전)를 haiku 가 놓치고 sonnet 은 잡음 → **sonnet 기본**.
- 같은 이미지로 1시간 내 재판정하면 캐시 읽기로 처리돼 환산액이 크게 준다(실측 18쌍 $2.02 → $0.18).
- 결과(18쌍): 불일치 6(207969·208015·213404 썸네일+상세, 206681·210418·221042 상세), 일치 12. 214302(CJ 업사이클 36입 박스 vs GS 24+24)는 두 모델 모두 일치 — 사용자 판정 대기.

- **재판정 병합 (2026-10-28):** 같은 이미지에도 AI 판정이 흔들린다(199909: 썸네일 그대로인데 재판정 시 same→diff). 재판정 결과는 **해시가 바뀐 영역만** 받고, 안 바뀐 영역은 직전 판정을 유지한다(`gate.ts` `mergeVerdict`).

- **근거 이미지·확신도·확인자 판정 (규칙 2026-10-28.3):** AI 가 차이마다 확신도와 상세 구간 번호를 답하고, 배치가 원본 이미지 위치로 변환해 verdict 에 붙인다(`evidence.ts`, 이미지 저장 없음). 확신 높은 차이가 없으면 판정 보류. 확인자 확정·정정은 `human_decided_at` 에 기록 — 규칙 변경으로는 재판정하지 않고 이미지가 바뀌면 재판정.
- **알려진 한계 — 판정 흔들림:** 같은 이미지에도 실행마다 판정이 달라진다(2026-10-28 재판정에서 221042 상세 차이 누락, 208015 썸네일 다름→같음). 대책 후보 "2회 판정 후 불일치 시 판정 보류"(판정 토큰 2배)는 사용자 결정으로 **보류**, 현재는 확인자 정정으로 대응.

### 6-1. 토큰 사용량 모니터링 (사용자 요청)
`claude -p --output-format json` 결과에 호출별 사용량이 들어온다(실측 필드): `usage.input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`, `modelUsage.<모델>`, `total_cost_usd`, `duration_ms`, `is_error`.
- **호출 단위 저장:** `match_check` 에 model, input/output/cache_creation/cache_read 토큰, `api_equiv_usd`, duration_ms.
- **배치 단위 집계:** `match_run` 에 합계 토큰, 판정 쌍 수, 쌍당 평균, 상한 도달 여부.
- **`total_cost_usd` 는 구독이라 실제 청구액이 아니다** — "API 로 했다면 드는 금액(정가 기준)"으로 표시해 효율 지표로 쓴다.
- **Max 구독 잔여 한도(%)는 이 출력에 없다** [확인필요] → 화면에는 "일별 사용 토큰 추이 + 판정 상한 도달 여부"를 보여주고, 한도 초과로 호출이 실패하면 `is_error` 로 잡아 남은 쌍을 다음 실행으로 미룬 뒤 `match_run.error` 에 기록한다.
- 대시보드 `/image-match` 하단에 **사용량 패널**: 최근 30일 일별 토큰(입력/출력/캐시) 막대, 판정 쌍 수, 쌍당 평균 토큰, API 환산 금액 누계.

## 7. 화면

사이드바: 분석 › **이미지 대조**(`/image-match`) 하나. 업로드는 대시보드의 **[대상 엑셀 업로드]** 대화창(2026-10-28 사용자 요청으로 별도 관리 메뉴 제거, 예전 주소 `/image-match-sources` 는 `/image-match` 로 이동만 한다).

### 업로드 대화창 (`image-match/match-upload-dialog.tsx`)
- 엑셀 클라이언트 파싱(기존 방식). **헤더 이름 탐지**: `자재코드` / `자재명` / `GS` / `본사` (헤더 행·시작 열 위치 무관 — 예시 파일은 B2 시작).
- **누적 upsert (사용자 확정):** 한 번 등록된 쌍은 이후 업로드 파일에 없어도 그대로 남고 **매 배치마다 계속 확인**한다. 비활성 개념 없음. 제거는 대상 목록에서 명시적으로 삭제할 때만.
- 미리보기: 신규 / 변경(URL·상품명 바뀜) / 동일 건수와 URL 형식 오류 행.
- URL 이 바뀐 쌍은 상태를 `new` 로 초기화.

### `/image-match` — 대시보드
- 상단 카드: 불일치 · 미반영 · 처리 완료 대기 · 판정 보류 · 수집 실패 건수 + **마지막 배치 시각**(36h 초과 시 경고).
- 테이블(TanStack, 기존 패턴): 자재코드, 상품명, 상태, 차이 요약, 마지막 확인일시, CJ/GS 링크. 상태 필터 기본값 = 조치 필요(불일치·미반영·보류·실패).
- 행 클릭 → 상세 패널: 썸네일 좌우 비교, AI 차이 목록, 상세 이미지 좌우 스크롤, **[처리 완료]**(메모), 보류 건은 [일치로 확정]/[불일치로 확정], 상태 이력.

## 8. 실행 환경 / 비밀값

- 저장소가 **public** → GitHub Actions 표준 러너 무료 [확인필요: 현재 GitHub 정책]. 단 **Actions 로그가 공개**되므로 로그에 비밀값·DB 내용을 찍지 않는다(건수·자재코드 정도만).
- GitHub Actions Secrets: `DATABASE_URL_UNPOOLED`, `CLAUDE_CODE_OAUTH_TOKEN`(로컬에서 `claude setup-token` 으로 발급, Max 구독). Vercel 쪽 추가 변수 없음. **public 저장소라 fork PR 워크플로에는 비밀값이 전달되지 않게** 트리거는 `schedule` / `workflow_dispatch` 만 쓴다.
- **GS샵 해외 IP 차단 (2026-10-28 확인):** Actions 러너(미국)에 GS 는 1KB 오류 페이지("GS SHOP GS이숍의 새이름")를 준다. CJ·GS 이미지 서버(asset.m-gs.kr)·Supabase 는 정상.
  → GS **페이지 HTML 만** Vercel 서울 함수 `/api/match/gs-page` 로 중계(`MATCH_GS_PROXY_URL`, 키 `MATCH_PROXY_KEY` = Vercel 환경변수·GitHub Secret 동일 값). 허용 URL 은 GS 상품 페이지·상세 iframe 뿐.
  → 리전은 `vercel.json` `regions: ["icn1"]`(프로젝트 전체 함수). edge + `preferredRegion: 'icn1'` 은 실제 sin1(싱가포르)에서 실행돼 실패. 앱 전체가 DB(ap-northeast-2)와 같은 서울 리전이 됨.
- 수동 실행: Actions 의 `workflow_dispatch`. (대시보드의 "지금 확인" 버튼은 GitHub 토큰이 필요해 후순위)
- 참고: Vercel Hobby 는 약관상 비상업 용도 제한 — 이번 기능과 별개로 플랜 확인 필요.

## 9. 구현 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| P1 | 스키마 5테이블 + 마이그레이션, 업로드 화면 | 예시 엑셀 18쌍이 `match_pair` 에 적재 |
| P2 | 수집기 + 공통 이미지 제외 + 해시 게이트 (로컬 실행) | 18쌍 수집 성공, 2회차 실행 시 판정 대상 0건 |
| P3 | AI 판정 (`claude -p` 구독, 18쌍 측정 — 모델별 비교) | 쌍당 토큰·소요시간 수치 확보, 사용자 판정과 대조, 모델·하루 상한 결정 |
| P4 | GitHub Actions 예약 실행 | 예약 실행 1회 성공 기록이 `match_run` 에 남음 |
| P5 | 대시보드 + 처리 완료 흐름 + 사용량 패널 | 처리 완료 → 다음 배치에서 상태 전이 확인, 일별 토큰이 화면에 표시 |

## 10. 결정 필요

1. ~~자재코드 1개 = GS 상품 1개인가?~~ → 예 (2026-10-28 확정)
2. ~~업로드 방식~~ → 누적 upsert, 비활성 없음, 등록된 쌍은 매번 확인 (2026-10-28 확정)
3. **판정 규칙** (§6, 썸네일 판정 피드백 후 확정).
4. ~~AI 판정 실행 수단~~ → GitHub Actions + Claude Code Max 구독 OAuth 토큰 (2026-10-28 확정)

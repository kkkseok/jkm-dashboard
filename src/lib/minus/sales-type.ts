/**
 * 매출구분 정규화 (sales.A 자유 텍스트 → 채널 라벨).
 *
 * 입력 패턴 (사용자 확정 2026-05-28 매핑 표):
 *   [B2B]                              → B2B          (대괄호 케이스)
 *   A-CJ온스타일(jkman2)               → CJ온스타일   (영문 prefix + 영숫자 식별자)
 *   A-공통엑셀양식(쇼핑엔티(e272288))  → 쇼핑엔티     (공통엑셀양식 래퍼 + 중첩 식별자)
 *   B-공통엑셀양식(코오롱(W스토어))    → 코오롱(W스토어) (공통엑셀양식 래퍼 + 본문에 한글 포함된 서브)
 *   B-에이블리(에이블리)               → 에이블리     (본문 == 괄호 안)
 *   B-와플샵(한미양행)                 → 한미양행     (룰 외 — EXPLICIT_OVERRIDES)
 *   B-GS SHOP(1026971)                 → GSshop       (룰 후 POST_NORMALIZE_ALIAS 로 표기 통일)
 *
 * 정책:
 *   - 매핑은 우선순위: EXPLICIT_OVERRIDES → 룰(대괄호 / prefix / 공통엑셀양식 / 일반 괄호) → POST_NORMALIZE_ALIAS
 *   - 룰로 못 잡는 새 패턴은 원본 그대로 반환 (사용자가 화면에서 발견하면 오버라이드 추가)
 *   - 빈 문자열/공백만/null → null
 *
 * 단위 테스트는 `__tests__/sales-type.test.ts` 의 사용자 매핑 표 fixture 로 전건 검증.
 */

/**
 * 원본 풀 키 → 정규화 라벨.
 * 룰만으로는 잡히지 않는 예외 케이스만 등재. 새 예외가 발견되면 여기에 추가.
 *
 * 우선순위 1순위 — 룰을 우회하므로 가장 강력. 잘못 등재하면 룰 개선이 가려질 수 있으니
 * "이 raw 텍스트는 어떻게 봐도 다른 룰로 잡을 수 없다" 가 분명한 케이스만.
 */
const EXPLICIT_OVERRIDES: Record<string, string> = {
  // 본문은 "와플샵" 인데 사용자가 채택한 라벨은 괄호 안의 "한미양행".
  // 일반 룰(영숫자 식별자만 식별자로 본다)로는 한미양행을 식별자로 분류 못 함.
  'B-와플샵(한미양행)': '한미양행',
}

/**
 * 정규화 결과에 한 번 더 적용할 표기 통일.
 * 공백/대소문자/약식 표기 통일이 목적. 룰을 통과한 본문에 대해 적용된다.
 */
const POST_NORMALIZE_ALIAS: Record<string, string> = {
  'GS SHOP': 'GSshop',
}

const HANGUL_OR_CJK = /[ㄱ-ㆎ가-힣一-鿿]/

/**
 * 자유 텍스트 매출구분을 채널 라벨로 정규화한다. 매칭 실패 시 원본 trim 결과 반환.
 *
 * 알고리즘:
 *   1. trim. 빈 문자열이면 null.
 *   2. EXPLICIT_OVERRIDES 적용.
 *   3. 대괄호로 감싸진 경우(`[X]`) → 내부 X 채택 + POST_NORMALIZE_ALIAS.
 *   4. 앞 prefix [A-Z]- (예: A-, B-, C-) 제거.
 *   5. "공통엑셀양식(...)" 형태면 괄호 안을 본문으로 교체.
 *   6. 본문 끝이 "본문(괄호내용)" 인 경우:
 *        - 본문 == 괄호 안 → 본문만 채택
 *        - 괄호 안에 한글/한자 없음 → 본문만 채택 (식별자 제거)
 *        - 그 외 → "본문(괄호내용)" 그대로 유지 (의미 있는 서브 채널명)
 *   7. POST_NORMALIZE_ALIAS 적용.
 */
export function normalizeSalesType(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (trimmed.length === 0) return null

  // 1) 명시 오버라이드 (룰 우회)
  if (trimmed in EXPLICIT_OVERRIDES) {
    return EXPLICIT_OVERRIDES[trimmed]
  }

  // 2) 대괄호: [B2B] → B2B
  const bracket = trimmed.match(/^\[([^\]]+)\]$/)
  if (bracket) {
    return applyPostAlias(bracket[1].trim())
  }

  // 3) prefix 제거 ([A-Z]-)
  let s = trimmed.replace(/^[A-Z]-/, '')

  // 4) 공통엑셀양식 래퍼: 공통엑셀양식(<inner>) → <inner> 로 교체 후 일반 룰 계속
  const common = s.match(/^공통엑셀양식\((.+)\)$/)
  if (common) {
    s = common[1].trim()
  }

  // 5) 일반 괄호 케이스: "본문(괄호 안 내용)"
  //    바깥 괄호 한 쌍만 떼서 본문/내부 분리. 내부에 또 괄호가 있을 수 있다.
  const last = s.match(/^(.+?)\((.+)\)$/)
  if (last) {
    const body = last[1].trim()
    const inside = last[2].trim()

    if (body === inside) {
      return applyPostAlias(body)
    }
    if (!HANGUL_OR_CJK.test(inside)) {
      // 영숫자/이메일/공백 등 한글이 없으면 식별자로 보고 제거
      return applyPostAlias(body)
    }
    // 한글 포함 서브 → 의미 있는 추가 라벨로 보고 그대로 유지
    return applyPostAlias(s)
  }

  return applyPostAlias(s)
}

function applyPostAlias(label: string): string {
  return POST_NORMALIZE_ALIAS[label] ?? label
}

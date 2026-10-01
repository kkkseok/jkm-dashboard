/**
 * 그룹 매핑 소스(상품 마스터 raw / product_info) 의 컬럼 정의.
 *
 * excel-mapping 스킬 원칙: 컬럼 식별 정보(letter / 헤더 텍스트)는 이 파일에만 둔다. 파서에서 하드코딩 금지.
 * 상품 마스터는 레이아웃이 자주 바뀌어 헤더 텍스트로, product_info 는 고정 letter 로 정의한다.
 */

/**
 * 상품 마스터 raw (product_master.xlsx) — **헤더 이름 기반 자동 탐지** (2026-10).
 *
 * 마스터는 채널 신설(2607 트러스테이, 261001 홈앤쇼핑·서브원)·월 매입가 컬럼 추가·
 * 헤더 행 이동(261001 에서 4행→5행)이 계속 일어나 letter 고정 매핑이 매번 깨졌다.
 * 그래서 letter 대신 **헤더 텍스트**만 여기 두고, 파서가 업로드 시점에 위치를 찾는다
 * (`parse.ts` `detectMasterLayout`). 비교는 공백 제거 후 일치.
 *
 *   - 헤더 행   = 상단 headerScanRows 행 중 `사방넷 코드` 가 있는 행. 데이터는 그 아래부터
 *                (사방넷코드 형식이 아닌 잡행은 SABANGNET_CODE_RE 로 걸러진다).
 *   - 채널 범위 = `사방넷 코드` 다음 컬럼 ~ `상품명` 직전 컬럼. 채널이 늘어도 자동 포함.
 *                ※ 이 구간에 채널이 아닌 컬럼을 끼우면 영숫자 값이 마켓코드로 적재된다.
 *   - 묶음 수식 = `NN월 매입가` 헤더 중 **가장 오른쪽**(최신 월) 컬럼.
 *
 * 필수 헤더를 못 찾으면 조용히 빈 결과를 내지 않고 명확한 에러로 업로드를 막는다.
 */
export const PRODUCT_MASTER_RAW = {
  /** 헤더 행을 찾을 상단 행 수. */
  headerScanRows: 20,
  /** 헤더를 찾을 최대 컬럼 수 — 시트 !ref 가 잡서식으로 XEJ 까지 잡혀 있어 상한을 둔다. */
  headerScanCols: 400,
  /** 필수 헤더 텍스트 (공백 무시 비교). sabangnetCode 는 헤더 행 탐지 앵커 겸용. */
  headers: {
    sabangnetCode: '사방넷 코드',
    productName: '상품명',
    /** 자재코드(자체코드). 복합이면 "★A_B_…" 형식. */
    selfCode: '자재코드',
    /** 단품/복합 구분. */
    type: '상품구분',
    /** 구성 수량. */
    quantity: '구성',
  },
  /**
   * 묶음 구성 수식이 든 매입가 컬럼 헤더 패턴(공백 제거 후). 여러 개면 가장 오른쪽.
   * 복합 행의 이 셀은 `({자기컬럼}{내품행}*{수량}) + …` 수식 — 내품 자체코드·수량의 원천.
   */
  bundleFormulaHeader: /^\d{1,2}월매입가/,
} as const

export type ProductMasterHeaderKey = keyof typeof PRODUCT_MASTER_RAW.headers

/**
 * product_info.xlsx — 자체코드 → ERPia 상품코드/상품명.
 * 1행 헤더(상품코드 / 상품명 / 자체코드), 2행부터 데이터.
 */
export const PRODUCT_INFO = {
  dataStart: 1,
  cols: {
    erpCode: 'A',
    erpName: 'B',
    selfCode: 'C',
  },
} as const

/** 구분 셀 값이 이 값이면 복합(묶음). 그 외는 단품. */
export const COMPOSITE_LABEL = '복합'

/** 자체코드가 이 문자로 시작하면 묶음(★A_B_…). */
export const BUNDLE_PREFIX = '★'

/** 사방넷코드로 인정하는 형식 — 4자리 이상 숫자. (헤더/잡행 제외용) */
export const SABANGNET_CODE_RE = /^\d{4,}$/

/**
 * 채널 셀 값이 유효 마켓코드인지 — 영숫자(및 . _ -)로만 구성.
 * 채널 셀에는 마켓코드 대신 "등록안함"/"등록예정" 같은 한글 상태 텍스트가 들어가기도 한다.
 * 그런 값은 마켓코드가 아니므로 적재에서 제외한다. (마켓코드 예: 2501693578, LO2512160591)
 */
export const MARKET_CODE_RE = /^[A-Za-z0-9._-]+$/

/**
 * 묶음 매입가 수식에서 `{수식컬럼}{내품행}` (+ 선택적 `*{수량}`) 추출용 정규식 생성.
 * 수식은 자기 컬럼의 내품 행들을 참조하므로 letter 는 탐지된 묶음 수식 컬럼에서 파생한다
 * (컬럼이 밀리면 Excel 이 수식 참조도 함께 갱신 — 예: 0630 `BG1450` → 2607 `BH1450`).
 * `*수량` 이 없으면 수량 1 — 마스터가 ×1 묶음엔 `*1` 을 생략하고 행을 그냥 더하기 때문
 * (예: x1 변형 `(BL1450+BL1453)` vs x2 변형 `(BL1450*2)+(BL1453*2)`).
 * 예: "(BL1385*1)+(BL1394)" → [{row:1385, qty:1}, {row:1394, qty:1}]
 * letter 앞에 영문자가 오지 않게 막아, 수식 컬럼이 `L` 일 때 `BL90` 의 `L90` 이 걸리지 않도록 한다.
 */
export function bundleFormulaRe(col: string): RegExp {
  return new RegExp(`(?<![A-Z])${col}(\\d+)(?:\\s*\\*\\s*(\\d+))?`, 'g')
}

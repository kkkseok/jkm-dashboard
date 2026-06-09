/**
 * 그룹 매핑 소스(상품 마스터 raw / product_info) 의 Excel column letter 정의.
 *
 * excel-mapping 스킬 원칙: 모든 letter 는 이 파일에만 둔다. 파서에서 하드코딩 금지.
 * 컬럼 위치는 docs/common/product_master.xlsx, product_info.xlsx (사방넷 export) 기준.
 */

/**
 * 상품 마스터 raw (product_master.xlsx).
 *
 * 헤더가 여러 행에 걸쳐 있고(등급/지원여부/비고/채널명), 채널명 행은 4번째(0-based idx 3),
 * 실제 상품 데이터는 7번째 행(0-based idx 6)부터 시작한다.
 *
 * 채널별 마켓코드는 E~AR 에 흩어져 있다(한 채널이 단가정책별 컬럼 2~3개를 가짐).
 * 그룹 매핑엔 채널 구분이 불필요하므로 E~AR 전 범위의 마켓코드를 모두 키로 펼친다.
 */
export const PRODUCT_MASTER_RAW = {
  /** 채널명 헤더 행 (0-based). 현재 파서는 채널명을 쓰지 않지만 위치 기록용. */
  headerRow: 3,
  /** 데이터 시작 행 (0-based). */
  dataStart: 6,
  cols: {
    sabangnetCode: 'D',
    productName: 'AS',
    /** 자체코드. 복합이면 "★A_B_…" 형식. */
    selfCode: 'BA',
    /** 단품/복합 구분. */
    type: 'BD',
    /** 구성 수량 (단품 수량). */
    quantity: 'BH',
    /** 묶음 구성 수식 — `(BG{내품행}*{수량}) + …`. 내품 자체코드·수량의 원천. */
    bundleFormula: 'BG',
  },
  /** 채널 마켓코드 컬럼 범위 (포함). */
  channelRange: { first: 'E', last: 'AR' },
} as const

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
 * 묶음 BG 수식에서 `(BG{내품행}*{수량})` 추출용.
 * 예: "(BG1385*1)+(BG1394*1)" → [{row:1385, qty:1}, {row:1394, qty:1}]
 */
export const BUNDLE_FORMULA_RE = /BG(\d+)\s*\*\s*(\d+)/g

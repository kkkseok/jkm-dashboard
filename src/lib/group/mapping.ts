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
 * 채널별 마켓코드는 E~AS 에 흩어져 있다(한 채널이 단가정책별 컬럼 2~3개를 가짐).
 * 그룹 매핑엔 채널 구분이 불필요하므로 E~AS 전 범위의 마켓코드를 모두 키로 펼친다.
 *
 * 2026-07 (product_master_2607): AS 에 트러스테이(공급가) 채널이 추가되며
 * AS 이후 모든 컬럼이 +1 밀림 (상품명 AS→AT, 자재코드 BA→BB, 상품구분 BD→BE,
 * 매입가 수식 BG→BH, 구성 BI). 채널이 또 늘거나 매입가 월 컬럼이 추가되면
 * 여기 letter 만 갱신하면 된다 — 구버전 파일은 PRODUCT_MASTER_HEADER_GUARD 가 잡는다.
 */
export const PRODUCT_MASTER_RAW = {
  /** 채널명 헤더 행 (0-based). 레이아웃 가드(HEADER_GUARD) 검증에도 쓴다. */
  headerRow: 3,
  /** 데이터 시작 행 (0-based). */
  dataStart: 6,
  cols: {
    sabangnetCode: 'D',
    productName: 'AT',
    /** 자재코드(자체코드). 복합이면 "★A_B_…" 형식. */
    selfCode: 'BB',
    /** 단품/복합 구분 (헤더 "상품구분"). */
    type: 'BE',
    /** 구성 수량 (헤더 "구성"). */
    quantity: 'BI',
    /**
     * 묶음 구성 수식이 든 매입가 컬럼(최신 월, 현재 "07월 매입가").
     * 복합 행의 이 셀은 `({자기컬럼}{내품행}*{수량}) + …` 수식 — 내품 자체코드·수량의 원천.
     */
    bundleFormula: 'BH',
  },
  /** 채널 마켓코드 컬럼 범위 (포함). last = 트러스테이(공급가). */
  channelRange: { first: 'E', last: 'AS' },
} as const

/**
 * 레이아웃 가드 — headerRow(채널명 행)의 해당 컬럼 헤더가 기대 텍스트와 일치해야 한다.
 * 채널 추가/월 컬럼 추가로 컬럼이 밀린 다른 버전 파일을 업로드하면
 * 조용히 빈 결과·엉뚱한 값이 적재되므로, 파싱 초입에서 명확한 에러로 막는다.
 */
export const PRODUCT_MASTER_HEADER_GUARD: ReadonlyArray<{
  col: string
  expect: string
}> = [
  { col: PRODUCT_MASTER_RAW.cols.productName, expect: '상품명' },
  { col: PRODUCT_MASTER_RAW.cols.type, expect: '상품구분' },
  { col: PRODUCT_MASTER_RAW.cols.quantity, expect: '구성' },
]

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
 * 묶음 매입가 수식에서 `{수식컬럼}{내품행}` (+ 선택적 `*{수량}`) 추출용.
 * 수식은 자기 컬럼의 내품 행들을 참조하므로 letter 는 cols.bundleFormula 에서 파생한다
 * (컬럼이 밀리면 Excel 이 수식 참조도 함께 갱신 — 예전 `BG1450` 이 지금은 `BH1450`).
 * `*수량` 이 없으면 수량 1 — 마스터가 ×1 묶음엔 `*1` 을 생략하고 행을 그냥 더하기 때문
 * (예: x1 변형 `(BH1450+BH1453)` vs x2 변형 `(BH1450*2)+(BH1453*2)`).
 * 예: "(BH1385*1)+(BH1394)" → [{row:1385, qty:1}, {row:1394, qty:1}]
 */
export const BUNDLE_FORMULA_RE = new RegExp(
  `${PRODUCT_MASTER_RAW.cols.bundleFormula}(\\d+)(?:\\s*\\*\\s*(\\d+))?`,
  'g',
)

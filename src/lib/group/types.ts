/**
 * 그룹 매핑 소스 파싱 결과 타입.
 *
 * 파싱은 클라이언트(브라우저)에서 수행하고, 이 POJO 들을 Server Action 으로 청크 전송한다
 * (minus / products import 와 동일 — Vercel 함수 타임아웃 회피).
 * DB 컬럼명(snake_case)은 Server Action / Drizzle 에서 매핑하므로 여기선 camelCase.
 */

/** group_market_map 한 행 (마켓코드 단위로 펼친 것). */
export type MarketMapInput = {
  marketCode: string
  sabangnetCode: string
  /** 자체코드. 등록예정/특수 행은 비어있을 수 있어 null 허용. 복합이면 "★…". */
  selfCode: string | null
  productName: string
  isComposite: boolean
  /** 구성 수량(BH). 빈 값이면 null. */
  quantity: number | null
}

/** group_bundle_item 한 행 (묶음 내품). 키는 SKU 유일한 사방넷코드(D). */
export type BundleItemInput = {
  bundleSabangnetCode: string
  seq: number
  componentSelfCode: string
  quantity: number
}

/** group_erp_code 한 행. */
export type ErpCodeInput = {
  selfCode: string
  erpCode: string
  erpName: string
}

export type ProductMasterParseResult = {
  marketRows: MarketMapInput[]
  bundleRows: BundleItemInput[]
  stats: {
    /** 적재 대상 마켓코드 행 수. */
    marketCount: number
    /** 마켓코드 중복으로 스킵된 수(첫 등장 채택). */
    dupMarketCount: number
    /** 분해된 묶음 수. */
    bundleCount: number
    /** 묶음 내품 행 총수. */
    bundleItemCount: number
    /** BG 수식이 표준 형태가 아니라 분해 못한 묶음 수. */
    bundleFormulaFailCount: number
  }
  /** 사용자에게 보여줄 경고(중복/실패 샘플 등). */
  warnings: string[]
}

export type ProductInfoParseResult = {
  erpRows: ErpCodeInput[]
  stats: {
    erpCount: number
    /** 자체코드 중복으로 스킵된 수(첫 등장 채택). */
    dupSelfCount: number
  }
  warnings: string[]
}

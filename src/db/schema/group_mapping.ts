import {
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * 그룹 업로드 전용 매핑 테이블 (2026-06, group 모듈).
 *
 * 기존 product_master / minus / products 기능과 **완전히 분리**된 테이블이다.
 * 상품 마스터 원본(product_master.xlsx) + ERP 코드표(product_info.xlsx)를 업로드할 때마다
 * 이 3개 테이블을 통째로 갱신한다.
 *
 * 매핑 체인 (no_mapping → group_upload):
 *   마켓코드(H)
 *     → group_market_map (marketCode) → selfCode / 수량 / 단품·복합
 *         · 단품: selfCode → group_erp_code → ERPia 상품코드/상품명
 *         · 복합: selfCode(★…) → group_bundle_item → 내품 selfCode·수량 → 각 group_erp_code
 *
 * 소스 컬럼 출처는 docs/common/product_master.xlsx, product_info.xlsx 기준.
 */

/**
 * group_market_map — 마켓코드 → 상품 식별 정보.
 *
 * product_master.xlsx 한 행(사방넷코드)에 채널별 마켓코드(E~AR)가 흩어져 있다.
 * 채널 구분은 그룹 업로드에 불필요하므로, **모든 채널의 마켓코드를 각각 한 행**으로 펼쳐 저장한다.
 * (한 채널이 단가정책별로 마켓코드 여러 개를 가질 수 있어 채널 단위 UNIQUE 는 두지 않는다.)
 *
 *   marketCode  ← E~AR (no_mapping 의 H 와 매칭되는 키)
 *   sabangnetCode ← D
 *   selfCode    ← BA (자체코드. 복합이면 "★A_B_…" 형식)
 *   productName ← AS (한글 원본 상품명)
 *   isComposite ← BD ("단품"=false / "복합"=true)
 *   quantity    ← BH (구성 수량. 복합은 1 고정 — 내품별 수량은 group_bundle_item)
 */
export const groupMarketMap = pgTable(
  'group_market_map',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    marketCode: text('market_code').notNull(),
    sabangnetCode: text('sabangnet_code').notNull(),
    selfCode: text('self_code'),
    productName: text('product_name').notNull(),
    isComposite: boolean('is_composite').notNull(),
    quantity: integer('quantity'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 마켓코드는 상품 식별의 키 — 전역 유일.
    uniqueIndex('group_market_map_market_code_uniq').on(t.marketCode),
    // selfCode 로 묶음/ERP 역조회 가속.
    index('group_market_map_self_code_idx').on(t.selfCode),
  ],
)

/**
 * group_bundle_item — 복합(묶음) 상품의 내품 구성.
 *
 * 묶음 행의 BG 수식 `(BG{내품행}*{수량}) + …` 에서 추출. ★self_code 분해보다 정확
 * (행 참조라 순서·표기 흔들림 없음, 수량까지 포함).
 *
 *   bundleSelfCode    ← 묶음 자체코드 "★A_B_…"
 *   seq               ← 내품 순번(1-based) = group_upload 의 순번
 *   componentSelfCode ← 내품 자체코드 (BG 수식 참조행의 BA)
 *   quantity          ← 내품 수량 (BG 수식의 ×N)
 */
export const groupBundleItem = pgTable(
  'group_bundle_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    bundleSelfCode: text('bundle_self_code').notNull(),
    seq: integer('seq').notNull(),
    componentSelfCode: text('component_self_code').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('group_bundle_item_bundle_seq_uniq').on(
      t.bundleSelfCode,
      t.seq,
    ),
    index('group_bundle_item_bundle_idx').on(t.bundleSelfCode),
  ],
)

/**
 * group_erp_code — 자체코드 → ERPia 상품코드/상품명.
 *
 * product_info.xlsx (A 상품코드 / B 상품명 / C 자체코드) 에서 적재.
 * 그룹 업로드 출력의 F(상품코드)·G(상품명)·B(그룹상품명) 원천.
 */
export const groupErpCode = pgTable(
  'group_erp_code',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    selfCode: text('self_code').notNull(),
    erpCode: text('erp_code').notNull(),
    erpName: text('erp_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('group_erp_code_self_code_uniq').on(t.selfCode)],
)

export type GroupMarketMap = typeof groupMarketMap.$inferSelect
export type NewGroupMarketMap = typeof groupMarketMap.$inferInsert
export type GroupBundleItem = typeof groupBundleItem.$inferSelect
export type NewGroupBundleItem = typeof groupBundleItem.$inferInsert
export type GroupErpCode = typeof groupErpCode.$inferSelect
export type NewGroupErpCode = typeof groupErpCode.$inferInsert

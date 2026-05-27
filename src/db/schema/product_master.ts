import {
  bigserial,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * product_master — 채널별 상품코드 + 단품/복합 구분 마스터.
 *
 * P1 요구사항 §4 확정:
 *   - `product_code` UNIQUE NOT NULL (한 코드 = 한 행)
 *   - 같은 논리 상품이 채널마다 다른 코드를 가지면 각 코드별로 행이 생긴다 (정규화 없음)
 *   - cal_amount 의 append-only 와 달리 **일반 upsert/CRUD**
 *
 * 마이너스 분석 페이지에서 productCode 단독 조인 → isComposite 로 "구분" 컬럼/필터.
 *
 * **updatedAt 갱신 정책**: DB 트리거 없음. **코드 측에서 `set.updatedAt = new Date()`** 로 명시 갱신.
 *   - Drizzle 의 `.defaultNow()` 는 INSERT 시점에만 적용된다. UPDATE 시 자동 갱신 아님.
 *   - 일관성 보장을 위해 모든 mutation Server Action 에서 명시적으로 `updatedAt: new Date()` 를 set.
 */
export const productMaster = pgTable(
  'product_master',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productCode: text('product_code').notNull(),
    channelName: text('channel_name').notNull(),
    brandName: text('brand_name').notNull(),
    productName: text('product_name').notNull(),
    isComposite: boolean('is_composite').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('product_master_product_code_uniq').on(t.productCode),
    // 채널별 필터·DISTINCT 조회 가속 (목록 페이지 채널 필터 + getDistinctChannelNames)
    index('product_master_channel_name_idx').on(t.channelName),
  ],
)

export type ProductMaster = typeof productMaster.$inferSelect
export type NewProductMaster = typeof productMaster.$inferInsert

import {
  bigserial,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * product_channels — 판매 채널 마스터.
 *
 * v1.2 (2026-05-27, Wide format) 신규:
 *   - 운영 채널 목록을 시스템이 관리하여 양식 다운로드/UI 자동완성에 사용.
 *   - 채널명 수정 시 product_master.channel_name 도 cascade rename (Server Action 트랜잭션).
 *   - display_order 로 양식·드롭다운에서 표시 순서 제어.
 *
 * 시드는 0006 마이그레이션 SQL 에서 24개 INSERT.
 */
export const productChannels = pgTable(
  'product_channels',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('product_channels_name_uniq').on(t.name)],
)

export type ProductChannel = typeof productChannels.$inferSelect
export type NewProductChannel = typeof productChannels.$inferInsert

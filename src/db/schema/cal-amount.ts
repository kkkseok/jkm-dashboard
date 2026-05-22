import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/**
 * cal_amount — 후정산금 append-only 로그.
 *
 * 원본 파일 `docs/common/cal_amount.xlsx` 그대로의 단순 구조:
 *   A: 상품코드 / B: 후정산금
 *
 * **append-only**:
 *   - 동일 productCode 가 여러 번 추가될 수 있다 (이력 보존).
 *   - 계산식에서는 **가장 큰 id 의 행(=가장 최근에 추가된 값)** 이 winner.
 *   - 화면 정렬도 id DESC (최신이 최상단).
 *   - 즉 import 시에는 엑셀 row 1(사용자 멘탈 모델상 "최신")이 가장 큰 id 를 받도록 **역순 INSERT**.
 *
 * UNIQUE constraint 는 두지 않는다 (중복 productCode 가 정상 입력).
 * productCode 검색·룩업 최적화를 위한 일반 index 만 유지.
 */
export const calAmount = pgTable(
  'cal_amount',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productCode: text('product_code').notNull(),
    extraSettlement: integer('extra_settlement').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('cal_amount_product_code_idx').on(t.productCode),
  ],
)

export type CalAmount = typeof calAmount.$inferSelect
export type NewCalAmount = typeof calAmount.$inferInsert

'use server'

import { db } from '@/db/client'
import { calAmount, type CalAmount } from '@/db/schema'
import { desc, eq, ilike, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  calAmountInputSchema,
  listCalAmountParamsSchema,
  type CalAmountInput,
  type ListCalAmountParams,
} from './schema'

const PATH = '/cal-amount'

/**
 * append-only INSERT. 동일 productCode 가 이미 있어도 새 row 추가.
 * 가장 최근(=가장 큰 id) row 가 계산식 winner.
 */
export async function appendCalAmount(input: CalAmountInput): Promise<CalAmount> {
  const v = calAmountInputSchema.parse(input)

  const [row] = await db
    .insert(calAmount)
    .values({
      productCode: v.productCode,
      extraSettlement: v.extraSettlement,
    })
    .returning()

  revalidatePath(PATH)
  return row
}

/**
 * 행 단위 삭제 (id 기준). productCode 가 같은 다른 이력 행은 영향 없음.
 */
export async function deleteCalAmount(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('id 가 필요합니다')
  }
  await db.delete(calAmount).where(eq(calAmount.id, id))
  revalidatePath(PATH)
}

export type ListCalAmountResult = {
  rows: CalAmount[]
  total: number
}

/**
 * 페이지네이션 + 검색 목록. productCode 대소문자 무시 부분일치.
 * 정렬: id DESC (최신 = 가장 큰 id 가 최상단).
 * 기본 pageSize = 100.
 */
export async function listCalAmount(
  params: ListCalAmountParams = {},
): Promise<ListCalAmountResult> {
  const { search, page, pageSize } = listCalAmountParamsSchema.parse(params)

  const where = search && search.trim().length > 0
    ? ilike(calAmount.productCode, `%${search}%`)
    : undefined

  const offset = (page - 1) * pageSize

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(calAmount)
      .where(where)
      .orderBy(desc(calAmount.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(calAmount)
      .where(where),
  ])

  return {
    rows,
    total: totalRow[0]?.count ?? 0,
  }
}

/**
 * 분석 페이지 룩업용.
 * append-only 구조에서 같은 productCode 가 여러 행이면 **가장 큰 id** 의 값이 winner.
 * Postgres DISTINCT ON 으로 productCode 별 최신 1건만 가져옴.
 *
 * TODO(scale): 행 수가 수십만 이상으로 늘면 server-side join 또는 캐싱 검토.
 */
export async function getCalAmountMap(): Promise<Map<string, number>> {
  const rows = await db.execute<{
    product_code: string
    extra_settlement: number
  }>(sql`
    SELECT DISTINCT ON (product_code)
      product_code, extra_settlement
    FROM cal_amount
    ORDER BY product_code, id DESC
  `)

  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.product_code, r.extra_settlement)
  }
  return map
}

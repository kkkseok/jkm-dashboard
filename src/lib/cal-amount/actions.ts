'use server'

import { db } from '@/db/client'
import { calAmount, type CalAmount } from '@/db/schema'
import { desc, eq, ilike, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  calAmountBatchSchema,
  calAmountInputSchema,
  listCalAmountParamsSchema,
  type CalAmountBatchItem,
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
 * 대량 업로드용 **청크 단위** 다중행 INSERT.
 *
 * 클라이언트가 엑셀을 파싱·역순 정렬한 뒤 청크(기본 500행)로 나눠 호출한다.
 * 한 번의 다중행 INSERT 로 처리하며 삽입된 행을 **INSERT 순서(= id 오름차순)** 로 반환.
 *
 * - 검증은 관대한 `calAmountBatchSchema` (폼의 엄격 정규식 미적용).
 * - `revalidatePath` 는 호출하지 않는다. 청크마다 revalidate 하면 과도하므로
 *   업로드 완료 후 호출자가 `router.refresh()` 로 한 번에 동기화한다.
 * - "엑셀 1행 = 최신(가장 큰 id)" 은 호출자의 **역순 삽입 순서**로 보장된다
 *   (이 함수는 받은 배열 순서대로 INSERT 할 뿐).
 */
export async function appendCalAmountBatch(
  items: CalAmountBatchItem[],
): Promise<CalAmount[]> {
  const parsed = calAmountBatchSchema.parse(items)
  if (parsed.length === 0) return []

  const rows = await db
    .insert(calAmount)
    .values(
      parsed.map((it) => ({
        productCode: it.productCode,
        extraSettlement: it.extraSettlement,
      })),
    )
    .returning()

  return rows
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

'use server'

import { db } from '@/db/client'
import { productMaster, type ProductMaster } from '@/db/schema'
import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  importProductsOptsSchema,
  listProductsParamsSchema,
  productInputSchema,
  type ImportProductsOpts,
  type ListProductsParams,
  type ProductInput,
} from './schema'

const PATH = '/products'

// Postgres unique_violation
const PG_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === PG_UNIQUE_VIOLATION
}

/* ----------------------------------------------------------------------------
 *  list / read
 * -------------------------------------------------------------------------- */

export type ProductRow = ProductMaster

export type ListProductsResult = {
  rows: ProductRow[]
  total: number
}

/**
 * 페이지네이션 + 검색 + 필터 + 정렬 목록.
 * - search: 상품코드/상품명/브랜드/채널 4컬럼 ILIKE 부분일치 (대소문자 무시).
 * - channel: 다중 선택 inArray.
 * - isComposite: 단품/복합 단일 선택.
 * - sort: productCode | channelName | brandName | isComposite | createdAt.
 */
export async function listProducts(
  params: ListProductsParams = {},
): Promise<ListProductsResult> {
  const { search, channel, isComposite, sort, dir, page, pageSize } =
    listProductsParamsSchema.parse(params)

  const conditions: SQL[] = []

  if (search && search.trim().length > 0) {
    const q = `%${search.trim()}%`
    const searchClause = or(
      sql`${productMaster.productCode} ILIKE ${q}`,
      sql`${productMaster.productName} ILIKE ${q}`,
      sql`${productMaster.brandName} ILIKE ${q}`,
      sql`${productMaster.channelName} ILIKE ${q}`,
    )
    if (searchClause) conditions.push(searchClause)
  }

  if (channel && channel.length > 0) {
    conditions.push(inArray(productMaster.channelName, channel))
  }

  if (typeof isComposite === 'boolean') {
    conditions.push(eq(productMaster.isComposite, isComposite))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const orderColumn = (() => {
    switch (sort) {
      case 'productCode':
        return productMaster.productCode
      case 'channelName':
        return productMaster.channelName
      case 'brandName':
        return productMaster.brandName
      case 'isComposite':
        return productMaster.isComposite
      case 'createdAt':
      default:
        return productMaster.createdAt
    }
  })()

  const orderBy = dir === 'asc' ? asc(orderColumn) : desc(orderColumn)
  const offset = (page - 1) * pageSize

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(productMaster)
      .where(where)
      .orderBy(orderBy, desc(productMaster.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(productMaster)
      .where(where),
  ])

  return {
    rows,
    total: totalRow[0]?.count ?? 0,
  }
}

/* ----------------------------------------------------------------------------
 *  create / update / delete
 * -------------------------------------------------------------------------- */

/**
 * 단건 등록. product_code UNIQUE 위반 시 사용자 친화 메시지로 Error throw.
 * UI 측에서 try/catch 후 폼 상단 Alert + 인라인 FormMessage 갱신.
 */
export async function createProduct(input: ProductInput): Promise<ProductRow> {
  const v = productInputSchema.parse(input)

  try {
    const [row] = await db
      .insert(productMaster)
      .values({
        productCode: v.productCode,
        channelName: v.channelName,
        brandName: v.brandName,
        productName: v.productName,
        isComposite: v.isComposite,
      })
      .returning()
    revalidatePath(PATH)
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(`이미 등록된 상품코드입니다: ${v.productCode}`)
    }
    throw err
  }
}

/**
 * 부분 수정. productCode 가 patch 에 포함되면 unique 재검증(다른 행과 충돌 시 throw).
 * updatedAt 은 항상 갱신.
 */
export async function updateProduct(
  id: number,
  patch: Partial<ProductInput>,
): Promise<ProductRow> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('id 가 필요합니다')
  }

  const parsed = productInputSchema.partial().parse(patch)
  if (Object.keys(parsed).length === 0) {
    throw new Error('수정할 필드가 없습니다')
  }

  try {
    const [row] = await db
      .update(productMaster)
      .set({
        ...parsed,
        updatedAt: new Date(),
      })
      .where(eq(productMaster.id, id))
      .returning()

    if (!row) {
      throw new Error(`상품을 찾을 수 없습니다 (id=${id})`)
    }

    revalidatePath(PATH)
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(
        `이미 등록된 상품코드입니다: ${parsed.productCode ?? ''}`.trim(),
      )
    }
    throw err
  }
}

/**
 * 단일 삭제 (id 기준).
 */
export async function deleteProduct(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('id 가 필요합니다')
  }
  await db.delete(productMaster).where(eq(productMaster.id, id))
  revalidatePath(PATH)
}

/* ----------------------------------------------------------------------------
 *  validation / lookup
 * -------------------------------------------------------------------------- */

/**
 * onBlur 중복 검증용. 사용 가능하면 true, 이미 존재하면 false.
 * - excludeId: edit 모드에서 자기 자신은 충돌로 보지 않기 위한 제외 id.
 *
 * NOTE: race 가능성은 작지만 존재 — 최종 검증은 createProduct/updateProduct 의
 *       unique_violation 캐치로 한 번 더 보장.
 */
export async function checkProductCodeUnique(
  productCode: string,
  excludeId?: number,
): Promise<boolean> {
  const code = productCode.trim()
  if (code.length === 0) return false

  const conditions: SQL[] = [eq(productMaster.productCode, code)]
  if (typeof excludeId === 'number' && Number.isInteger(excludeId) && excludeId > 0) {
    conditions.push(ne(productMaster.id, excludeId))
  }

  const rows = await db
    .select({ id: productMaster.id })
    .from(productMaster)
    .where(and(...conditions))
    .limit(1)

  return rows.length === 0
}

/**
 * Combobox 자동완성 + 채널 필터용. product_master.channel_name DISTINCT.
 * 가나다순. 빈 행/공백 채널은 제외(NOT NULL 이므로 빈 문자열만 거름).
 *
 * sales 측 union 은 분석 결과가 클라이언트 메모리에 있으므로 클라이언트에서 합친다.
 */
export async function getDistinctChannelNames(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ channelName: productMaster.channelName })
    .from(productMaster)
    .orderBy(asc(productMaster.channelName))

  return rows
    .map((r) => r.channelName)
    .filter((v) => v && v.length > 0)
}

/* ----------------------------------------------------------------------------
 *  bulk import
 * -------------------------------------------------------------------------- */

export type ImportProductsResult = {
  success: number
  /** DB 와의 중복으로 건너뜬 행 수 (upsert=false 일 때만 발생). */
  skipped: number
  failed: { row: number; reason: string }[]
}

/**
 * 엑셀 일괄 import.
 * - opts.upsert = false (기본): product_code 중복 시 해당 행 skip.
 * - opts.upsert = true: 중복 시 channelName/brandName/productName/isComposite 덮어쓰기.
 *
 * 각 row 는 productInputSchema 로 검증. 실패 시 failed 배열에 누적.
 * 시트 내 자체 중복 제거는 호출자(파이프라인) 책임 (P4 명세).
 *
 * 트랜잭션으로 묶어 일관성 확보. 단 행별 검증 실패는 트랜잭션 롤백 없이
 * skip + 결과 반환 (사용자가 부분 성공을 보고 재시도할 수 있도록).
 */
export async function importProducts(
  rows: ProductInput[],
  opts: ImportProductsOpts = { upsert: false },
): Promise<ImportProductsResult> {
  const { upsert } = importProductsOptsSchema.parse(opts)

  const result: ImportProductsResult = {
    success: 0,
    skipped: 0,
    failed: [],
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]
      const parsed = productInputSchema.safeParse(raw)
      if (!parsed.success) {
        result.failed.push({
          row: i,
          reason: parsed.error.issues.map((iss) => iss.message).join('; '),
        })
        continue
      }
      const v = parsed.data

      try {
        if (upsert) {
          await tx
            .insert(productMaster)
            .values({
              productCode: v.productCode,
              channelName: v.channelName,
              brandName: v.brandName,
              productName: v.productName,
              isComposite: v.isComposite,
            })
            .onConflictDoUpdate({
              target: productMaster.productCode,
              set: {
                channelName: v.channelName,
                brandName: v.brandName,
                productName: v.productName,
                isComposite: v.isComposite,
                updatedAt: new Date(),
              },
            })
          result.success += 1
        } else {
          const inserted = await tx
            .insert(productMaster)
            .values({
              productCode: v.productCode,
              channelName: v.channelName,
              brandName: v.brandName,
              productName: v.productName,
              isComposite: v.isComposite,
            })
            .onConflictDoNothing({ target: productMaster.productCode })
            .returning({ id: productMaster.id })

          if (inserted.length > 0) {
            result.success += 1
          } else {
            result.skipped += 1
          }
        }
      } catch (err) {
        result.failed.push({
          row: i,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  })

  revalidatePath(PATH)
  return result
}

/* ----------------------------------------------------------------------------
 *  minus pipeline lookup
 * -------------------------------------------------------------------------- */

/**
 * product_master 룩업 한 줄짜리.
 *
 * **직렬화 주의**: Server Action 의 return 값은 React Server Functions 직렬화 경로를
 *   타기 때문에 `Map` 인스턴스를 그대로 반환할 수 없다. 반드시 plain `Record<string, ...>`
 *   또는 `[string, ...][]` 로 반환하고, 클라이언트에서 `new Map(Object.entries(record))`
 *   또는 `new Map(entries)` 로 복원한다.
 *
 * 본 함수는 `Record<string, ProductMasterEntry>` 를 반환.
 *
 * cal_amount.getCalAmountMap 은 server-only context(현재 분석 페이지의 분석 시작 시점)에서
 * 호출되어 Map 으로 받지만, 본 함수는 클라이언트 enrichRow 시점에서 호출되므로
 * 직렬화 안전한 형태를 유지한다.
 */
export type ProductMasterEntry = {
  isComposite: boolean
  channelName: string
  brandName: string
  productName: string
}

export async function getProductMasterMap(): Promise<
  Record<string, ProductMasterEntry>
> {
  const rows = await db
    .select({
      productCode: productMaster.productCode,
      isComposite: productMaster.isComposite,
      channelName: productMaster.channelName,
      brandName: productMaster.brandName,
      productName: productMaster.productName,
    })
    .from(productMaster)

  const record: Record<string, ProductMasterEntry> = {}
  for (const r of rows) {
    record[r.productCode] = {
      isComposite: r.isComposite,
      channelName: r.channelName,
      brandName: r.brandName,
      productName: r.productName,
    }
  }
  return record
}

'use server'

import { db } from '@/db/client'
import {
  productMaster,
  productChannels,
  type ProductMaster,
  type ProductChannel,
} from '@/db/schema'
import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  importProductsOptsSchema,
  listProductsParamsSchema,
  listProductsWideParamsSchema,
  productInputSchema,
  type ImportProductsOpts,
  type ListProductsParams,
  type ListProductsWideParams,
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
      sql`${productMaster.sabangnetCode} ILIKE ${q}`,
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
      case 'sabangnetCode':
        return productMaster.sabangnetCode
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
 *  list (wide view) — 한 행 = 한 사방넷코드, 채널은 가로 컬럼
 * -------------------------------------------------------------------------- */

/**
 * Wide view 의 한 행 — 같은 사방넷코드의 모든 채널 행을 하나로 그룹.
 *
 * - `channels`: channelName → { id, productCode }
 *   엑셀 입력 양식과 동일한 가로 펼침 표현. 비어있는 채널은 키가 없음.
 * - `createdAt` / `updatedAt`: 그룹 내 max — 가장 최근에 만진 시점.
 * - 그룹의 brand/product/composite 는 saveProductGroup 가 동일하게 적용하므로
 *   첫 행의 값을 그대로 사용해도 일관.
 */
export type ProductWideRow = {
  sabangnetCode: string
  brandName: string
  productName: string
  isComposite: boolean
  createdAt: Date
  updatedAt: Date
  channels: Record<string, { id: number; productCode: string }>
}

export type ListProductsWideResult = {
  rows: ProductWideRow[]
  /** 사방넷코드 distinct 단위 총 건수 (페이지네이션 분모). */
  total: number
}

/**
 * 페이지네이션 + 검색 + 구분 필터 + 정렬, 사방넷 단위.
 *
 * 흐름:
 *   1) 조건에 매칭되는 사방넷코드 DISTINCT 를 정렬·페이지로 추림
 *   2) 그 사방넷들의 모든 (채널, 상품코드) 행을 inArray 로 한 번에 fetch
 *   3) JS 에서 사방넷별로 그룹핑 + 1)의 정렬 순서 보존
 *
 * 검색: sabangnet/productCode/productName/brand/channel ILIKE 어느 한 행이라도
 *       매칭되면 그 사방넷 전체가 결과에 포함된다 (= 사용자가 "쿠팡" 검색 시
 *       쿠팡에 등록된 사방넷의 GSshop 컬럼도 같이 보임).
 *
 * 정렬: sabangnetCode(자체) / brandName,productName(max) / isComposite(bool_or)
 *       / createdAt(max).
 */
export async function listProductsWide(
  params: ListProductsWideParams = {},
): Promise<ListProductsWideResult> {
  const { search, isComposite, sort, dir, page, pageSize } =
    listProductsWideParamsSchema.parse(params)

  const conditions: SQL[] = []

  if (search && search.trim().length > 0) {
    const q = `%${search.trim()}%`
    const searchClause = or(
      sql`${productMaster.sabangnetCode} ILIKE ${q}`,
      sql`${productMaster.productCode} ILIKE ${q}`,
      sql`${productMaster.productName} ILIKE ${q}`,
      sql`${productMaster.brandName} ILIKE ${q}`,
      sql`${productMaster.channelName} ILIKE ${q}`,
    )
    if (searchClause) conditions.push(searchClause)
  }

  if (typeof isComposite === 'boolean') {
    conditions.push(eq(productMaster.isComposite, isComposite))
  }

  // 검색·구분 필터가 행 단위로 매칭되면 그 사방넷 전체를 노출하기 위해,
  // 매칭된 행에서 사방넷코드를 distinct 로 뽑은 뒤 그 코드들의 모든 행을 다시 가져온다.
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const orderExpr = (() => {
    const directionSql = dir === 'asc' ? sql`asc` : sql`desc`
    switch (sort) {
      case 'brandName':
        return sql`max(${productMaster.brandName}) ${directionSql}`
      case 'productName':
        return sql`max(${productMaster.productName}) ${directionSql}`
      case 'isComposite':
        return sql`bool_or(${productMaster.isComposite}) ${directionSql}`
      case 'createdAt':
        return sql`max(${productMaster.createdAt}) ${directionSql}`
      case 'sabangnetCode':
      default:
        return sql`${productMaster.sabangnetCode} ${directionSql}`
    }
  })()

  const offset = (page - 1) * pageSize

  // 1) 사방넷코드 페이지
  const snPageRows = await db
    .select({ sabangnetCode: productMaster.sabangnetCode })
    .from(productMaster)
    .where(where)
    .groupBy(productMaster.sabangnetCode)
    .orderBy(orderExpr, asc(productMaster.sabangnetCode))
    .limit(pageSize)
    .offset(offset)

  // 2) 총 사방넷 수
  const totalRow = await db
    .select({
      count: sql<number>`count(distinct ${productMaster.sabangnetCode})::int`,
    })
    .from(productMaster)
    .where(where)

  const total = totalRow[0]?.count ?? 0
  const sabangnetCodes = snPageRows.map((r) => r.sabangnetCode)

  if (sabangnetCodes.length === 0) {
    return { rows: [], total }
  }

  // 3) 그 사방넷들의 모든 행 fetch (검색에 매칭 안 된 채널 행까지 포함)
  const detailRows = await db
    .select()
    .from(productMaster)
    .where(inArray(productMaster.sabangnetCode, sabangnetCodes))

  // 그룹핑
  const groupMap = new Map<string, ProductWideRow>()
  for (const r of detailRows) {
    let group = groupMap.get(r.sabangnetCode)
    if (!group) {
      group = {
        sabangnetCode: r.sabangnetCode,
        brandName: r.brandName,
        productName: r.productName,
        isComposite: r.isComposite,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        channels: {},
      }
      groupMap.set(r.sabangnetCode, group)
    }
    group.channels[r.channelName] = { id: r.id, productCode: r.productCode }
    if (r.createdAt > group.createdAt) group.createdAt = r.createdAt
    if (r.updatedAt > group.updatedAt) group.updatedAt = r.updatedAt
  }

  // 1) 의 정렬 순서 보존
  const rows: ProductWideRow[] = []
  for (const sn of sabangnetCodes) {
    const g = groupMap.get(sn)
    if (g) rows.push(g)
  }

  return { rows, total }
}

/* ----------------------------------------------------------------------------
 *  create / update / delete
 * -------------------------------------------------------------------------- */

/**
 * 사방넷 그룹 단위 일괄 저장 (v1.2 Wide format).
 * 한 사방넷코드의 (채널, productCode) 페어들을 트랜잭션으로 동시 처리한다.
 *
 * 흐름:
 *   - 기존 행: 같은 sabangnetCode 의 모든 product_master 행을 로드
 *   - 새 행과 비교 (channelName 기준):
 *       추가됨 → INSERT
 *       사라짐 → DELETE
 *       양쪽 존재 → UPDATE (productCode/brandName/productName/isComposite/updatedAt)
 *   - 사용자 입력 productCode/(sabangnet,channel) UNIQUE 충돌은 unique_violation 으로 throw.
 */
export type SaveProductGroupInput = {
  sabangnetCode: string
  brandName: string
  productName: string
  isComposite: boolean
  rows: Array<{ channelName: string; productCode: string }>
}

export type SaveProductGroupResult = {
  inserted: number
  updated: number
  deleted: number
}

export async function saveProductGroup(
  input: SaveProductGroupInput,
): Promise<SaveProductGroupResult> {
  const sabangnetCode = input.sabangnetCode.trim()
  const brandName = input.brandName.trim()
  const productName = input.productName.trim()
  const { isComposite } = input

  if (sabangnetCode.length === 0) throw new Error('사방넷코드를 입력하세요')
  if (brandName.length === 0) throw new Error('브랜드명을 입력하세요')
  if (productName.length === 0) throw new Error('상품명을 입력하세요')
  if (input.rows.length === 0)
    throw new Error('최소 한 개 채널의 상품코드를 입력하세요')

  // 페어 별 trim + 형식 검증 (상품코드만)
  const cleaned = input.rows.map((r, i) => {
    const ch = r.channelName.trim()
    const pc = r.productCode.trim()
    if (ch.length === 0) throw new Error(`${i + 1}번째 행: 채널명을 선택하세요`)
    if (pc.length === 0)
      throw new Error(`${i + 1}번째 행 (${ch}): 상품코드를 입력하세요`)
    if (pc.length > 64)
      throw new Error(`${i + 1}번째 행 (${ch}): 상품코드는 64자 이내`)
    if (!/^[\w-]+$/.test(pc))
      throw new Error(
        `${i + 1}번째 행 (${ch}): 상품코드 형식 오류 (영문/숫자/-/_)`,
      )
    return { channelName: ch, productCode: pc }
  })

  // 동일 채널이 두 번 등장하면 거부
  const seenCh = new Set<string>()
  for (const r of cleaned) {
    if (seenCh.has(r.channelName)) {
      throw new Error(`같은 채널이 두 번 입력되었습니다: ${r.channelName}`)
    }
    seenCh.add(r.channelName)
  }

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(productMaster)
        .where(eq(productMaster.sabangnetCode, sabangnetCode))

      const existingByCh = new Map<string, (typeof existing)[number]>()
      for (const e of existing) existingByCh.set(e.channelName, e)

      const nextByCh = new Map(cleaned.map((r) => [r.channelName, r]))

      let inserted = 0
      let updated = 0
      let deleted = 0

      // INSERT 또는 UPDATE
      for (const r of cleaned) {
        const existRow = existingByCh.get(r.channelName)
        if (existRow) {
          // 변경 사항 비교 — 모두 같으면 skip
          if (
            existRow.productCode === r.productCode &&
            existRow.brandName === brandName &&
            existRow.productName === productName &&
            existRow.isComposite === isComposite
          ) {
            continue
          }
          await tx
            .update(productMaster)
            .set({
              productCode: r.productCode,
              brandName,
              productName,
              isComposite,
              updatedAt: new Date(),
            })
            .where(eq(productMaster.id, existRow.id))
          updated += 1
        } else {
          await tx.insert(productMaster).values({
            sabangnetCode,
            brandName,
            channelName: r.channelName,
            productCode: r.productCode,
            productName,
            isComposite,
          })
          inserted += 1
        }
      }

      // DELETE — 기존에 있었으나 새 입력에 없는 채널 행
      for (const e of existing) {
        if (!nextByCh.has(e.channelName)) {
          await tx.delete(productMaster).where(eq(productMaster.id, e.id))
          deleted += 1
        }
      }

      return { inserted, updated, deleted }
    })

    revalidatePath(PATH)
    return result
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(
        '저장 실패 — 사방넷×채널 페어 또는 상품코드 중복입니다',
      )
    }
    throw err
  }
}

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
        sabangnetCode: v.sabangnetCode,
        brandName: v.brandName,
        channelName: v.channelName,
        productCode: v.productCode,
        productName: v.productName,
        isComposite: v.isComposite,
      })
      .returning()
    revalidatePath(PATH)
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(
        `이미 등록된 페어입니다: (사방넷 "${v.sabangnetCode}", 채널 "${v.channelName}") 또는 상품코드 "${v.productCode}" 중복`,
      )
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
      const dup =
        parsed.sabangnetCode ?? parsed.productCode ?? ''
      throw new Error(`이미 등록된 코드입니다: ${dup}`.trim())
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
 * 같은 사방넷코드의 모든 (채널, 상품코드) 행을 반환.
 * 수정 Dialog 진입 시 그룹 전체를 로드하기 위한 함수.
 * 결과는 channelName ASC 정렬.
 */
export async function getProductsBySabangnet(
  sabangnetCode: string,
): Promise<ProductRow[]> {
  const sn = sabangnetCode.trim()
  if (sn.length === 0) return []
  return db
    .select()
    .from(productMaster)
    .where(eq(productMaster.sabangnetCode, sn))
    .orderBy(asc(productMaster.channelName))
}

/**
 * (사방넷, 채널) 조합 중복 검증 (v1.2 wide format).
 * 같은 사방넷코드는 여러 채널에 등록 가능하므로 사방넷 단독 UNIQUE 가 아니라
 * 채널과 페어로 검증한다.
 */
export async function checkSabangnetChannelUnique(
  sabangnetCode: string,
  channelName: string,
  excludeId?: number,
): Promise<boolean> {
  const sn = sabangnetCode.trim()
  const ch = channelName.trim()
  if (sn.length === 0 || ch.length === 0) return false

  const conditions: SQL[] = [
    eq(productMaster.sabangnetCode, sn),
    eq(productMaster.channelName, ch),
  ]
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
          // v1.2: (sabangnet, channel) 복합 UNIQUE 가 새 키.
          //   - upsert: 같은 페어 발견 시 productCode/brandName/productName/isComposite 덮어쓰기.
          //   - productCode UNIQUE 충돌은 unique_violation 으로 떨어져 failed 로 누적.
          await tx
            .insert(productMaster)
            .values({
              sabangnetCode: v.sabangnetCode,
              brandName: v.brandName,
              channelName: v.channelName,
              productCode: v.productCode,
              productName: v.productName,
              isComposite: v.isComposite,
            })
            .onConflictDoUpdate({
              target: [productMaster.sabangnetCode, productMaster.channelName],
              set: {
                brandName: v.brandName,
                productCode: v.productCode,
                productName: v.productName,
                isComposite: v.isComposite,
                updatedAt: new Date(),
              },
            })
          result.success += 1
        } else {
          // v1.2: (sabangnet, channel) 페어 또는 productCode 충돌 시 skip.
          try {
            const inserted = await tx
              .insert(productMaster)
              .values({
                sabangnetCode: v.sabangnetCode,
                brandName: v.brandName,
                channelName: v.channelName,
                productCode: v.productCode,
                productName: v.productName,
                isComposite: v.isComposite,
              })
              .onConflictDoNothing({
                target: [
                  productMaster.sabangnetCode,
                  productMaster.channelName,
                ],
              })
              .returning({ id: productMaster.id })

            if (inserted.length > 0) {
              result.success += 1
            } else {
              result.skipped += 1
            }
          } catch (err) {
            if (isUniqueViolation(err)) {
              // productCode UNIQUE 충돌 → skip
              result.skipped += 1
            } else {
              throw err
            }
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
  sabangnetCode: string
}

export async function getProductMasterMap(): Promise<
  Record<string, ProductMasterEntry>
> {
  const rows = await db
    .select({
      productCode: productMaster.productCode,
      sabangnetCode: productMaster.sabangnetCode,
      isComposite: productMaster.isComposite,
      channelName: productMaster.channelName,
      brandName: productMaster.brandName,
      productName: productMaster.productName,
    })
    .from(productMaster)

  const record: Record<string, ProductMasterEntry> = {}
  for (const r of rows) {
    // productCode 가 UNIQUE 이므로 중복 키 충돌 없음.
    record[r.productCode] = {
      isComposite: r.isComposite,
      channelName: r.channelName,
      brandName: r.brandName,
      productName: r.productName,
      sabangnetCode: r.sabangnetCode,
    }
  }
  return record
}

/* ----------------------------------------------------------------------------
 *  product_channels (v1.2 Wide format 채널 마스터)
 * -------------------------------------------------------------------------- */

export type ChannelRow = ProductChannel

/** 채널 목록 — display_order ASC, name ASC. */
export async function listChannels(): Promise<ChannelRow[]> {
  return db
    .select()
    .from(productChannels)
    .orderBy(asc(productChannels.displayOrder), asc(productChannels.name))
}

/** 채널명 배열만 (Wide 양식 다운로드용 헤더 + Combobox 옵션). */
export async function listChannelNames(): Promise<string[]> {
  const rows = await listChannels()
  return rows.map((r) => r.name)
}

/** 채널 신규 추가. UNIQUE 위반 시 친화적 메시지. */
export async function createChannel(
  name: string,
  displayOrder?: number,
): Promise<ChannelRow> {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('채널명을 입력하세요')
  if (trimmed.length > 128) throw new Error('채널명은 128자 이내여야 합니다')

  // displayOrder 가 없으면 마지막에 추가 (max + 1)
  const order =
    typeof displayOrder === 'number' && Number.isFinite(displayOrder)
      ? Math.floor(displayOrder)
      : await (async () => {
          const max = await db
            .select({ max: sql<number | null>`max(${productChannels.displayOrder})::int` })
            .from(productChannels)
          return (max[0]?.max ?? 0) + 1
        })()

  try {
    const [row] = await db
      .insert(productChannels)
      .values({ name: trimmed, displayOrder: order })
      .returning()
    revalidatePath(PATH)
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error(`이미 등록된 채널명입니다: ${trimmed}`)
    }
    throw err
  }
}

/**
 * 채널명 변경 — cascade rename.
 * product_master.channel_name 의 oldName 행을 모두 newName 으로 업데이트한다.
 * 트랜잭션으로 묶음.
 *
 * 충돌 검사:
 *   - newName 으로 product_master 에 이미 (sabangnet, newName) 페어가 있는데
 *     동시에 (sabangnet, oldName) 페어도 있으면 cascade update 시 UNIQUE 위반.
 *   - 위와 같은 충돌이 1건이라도 있으면 거부 + 사유 반환.
 */
export async function renameChannel(
  id: number,
  newName: string,
): Promise<ChannelRow> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('id 가 필요합니다')
  }
  const next = newName.trim()
  if (next.length === 0) throw new Error('새 채널명을 입력하세요')
  if (next.length > 128) throw new Error('채널명은 128자 이내여야 합니다')

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(productChannels)
      .where(eq(productChannels.id, id))
      .limit(1)
    if (!existing) throw new Error(`채널을 찾을 수 없습니다 (id=${id})`)

    if (existing.name === next) {
      return existing
    }

    // 다른 채널이 next 이름을 이미 사용 중인지
    const [conflict] = await tx
      .select({ id: productChannels.id })
      .from(productChannels)
      .where(and(eq(productChannels.name, next), ne(productChannels.id, id)))
      .limit(1)
    if (conflict) {
      throw new Error(`이미 다른 채널이 사용 중인 이름입니다: ${next}`)
    }

    // product_master cascade 충돌 검사:
    //   같은 사방넷코드에 (oldName) 행과 (newName) 행이 모두 있으면 안 됨.
    const dupRows = await tx
      .select({ sabangnetCode: productMaster.sabangnetCode })
      .from(productMaster)
      .where(
        and(
          eq(productMaster.channelName, existing.name),
          inArray(
            productMaster.sabangnetCode,
            tx
              .select({ sn: productMaster.sabangnetCode })
              .from(productMaster)
              .where(eq(productMaster.channelName, next)),
          ),
        ),
      )

    if (dupRows.length > 0) {
      const sample = dupRows.slice(0, 5).map((r) => r.sabangnetCode).join(', ')
      throw new Error(
        `대상 채널 "${next}" 로 변경 시 ${dupRows.length}건의 사방넷코드가 충돌합니다 (예: ${sample}). product_master 에서 먼저 정리하세요.`,
      )
    }

    // cascade update: product_master.channel_name = old → new
    await tx
      .update(productMaster)
      .set({ channelName: next, updatedAt: new Date() })
      .where(eq(productMaster.channelName, existing.name))

    const [updated] = await tx
      .update(productChannels)
      .set({ name: next, updatedAt: new Date() })
      .where(eq(productChannels.id, id))
      .returning()

    return updated
  }).then((row) => {
    revalidatePath(PATH)
    return row
  })
}

/**
 * 채널 삭제. product_master 에서 사용 중이면 차단.
 */
export async function deleteChannel(
  id: number,
): Promise<{ ok: true } | { ok: false; reason: string; usageCount: number }> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('id 가 필요합니다')
  }

  const [existing] = await db
    .select()
    .from(productChannels)
    .where(eq(productChannels.id, id))
    .limit(1)
  if (!existing) throw new Error(`채널을 찾을 수 없습니다 (id=${id})`)

  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productMaster)
    .where(eq(productMaster.channelName, existing.name))
  const usageCount = usage?.count ?? 0

  if (usageCount > 0) {
    return {
      ok: false,
      reason: `채널 "${existing.name}" 은 ${usageCount}건의 상품에서 사용 중입니다. 먼저 상품을 정리하거나 다른 채널로 옮긴 후 삭제하세요.`,
      usageCount,
    }
  }

  await db.delete(productChannels).where(eq(productChannels.id, id))
  revalidatePath(PATH)
  return { ok: true }
}

/** 채널 사용 현황 (display_order 순으로 정렬 + 각 채널별 상품 수). */
export async function listChannelsWithUsage(): Promise<
  Array<ChannelRow & { usageCount: number }>
> {
  const rows = await db
    .select({
      id: productChannels.id,
      name: productChannels.name,
      displayOrder: productChannels.displayOrder,
      createdAt: productChannels.createdAt,
      updatedAt: productChannels.updatedAt,
      usageCount: sql<number>`(
        SELECT count(*)::int FROM ${productMaster}
        WHERE ${productMaster.channelName} = ${productChannels.name}
      )`,
    })
    .from(productChannels)
    .orderBy(asc(productChannels.displayOrder), asc(productChannels.name))
  return rows
}

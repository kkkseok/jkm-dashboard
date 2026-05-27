import {
  getDistinctChannelNames,
  listProducts,
} from "@/lib/products/actions"
import type { ProductSortKey } from "@/lib/products/schema"
import { productSortKeys } from "@/lib/products/schema"
import { ProductsListClient } from "./products-list-client"

const PAGE_SIZE = 100

type SearchParams = {
  q?: string
  channel?: string
  type?: string
  page?: string
  sort?: string
  dir?: string
}

/**
 * 상품 마스터 관리 페이지 (`/products`).
 *
 * Server Component 에서 `searchParams` 를 받아 `listProducts` 로 데이터를 미리 fetch,
 * URL 동기화 + 새로고침/공유 가능하도록 한다. (02_uiux_products §4-1, §4-8)
 *
 * URL 예: `/products?q=ABC&channel=A-CJ,A-쿠팡&type=composite&page=2&sort=createdAt&dir=desc`
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const q = (params.q ?? "").trim()

  const channel = (() => {
    const raw = params.channel
    if (!raw) return [] as string[]
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  })()

  const isComposite: boolean | undefined =
    params.type === "composite"
      ? true
      : params.type === "single"
        ? false
        : undefined

  const pageRaw = Number(params.page ?? "1")
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  const sort: ProductSortKey = (productSortKeys as readonly string[]).includes(
    params.sort ?? "",
  )
    ? (params.sort as ProductSortKey)
    : "createdAt"
  const dir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc"

  const [{ rows, total }, channelOptions] = await Promise.all([
    listProducts({
      search: q || undefined,
      channel: channel.length > 0 ? channel : undefined,
      isComposite,
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    getDistinctChannelNames(),
  ])

  return (
    <ProductsListClient
      initialRows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      search={q}
      channels={channel}
      typeFilter={
        params.type === "composite"
          ? "composite"
          : params.type === "single"
            ? "single"
            : "all"
      }
      sort={sort}
      dir={dir}
      channelOptions={channelOptions}
    />
  )
}

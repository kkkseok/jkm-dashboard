import {
  getDistinctChannelNames,
  listChannelNames,
  listChannelsWithUsage,
  listProducts,
  listProductsWide,
} from "@/lib/products/actions"
import type {
  ProductSortKey,
  ProductWideSortKey,
} from "@/lib/products/schema"
import {
  productSortKeys,
  productWideSortKeys,
} from "@/lib/products/schema"
import { ProductsListClient } from "./products-list-client"
import { ProductsWideClient } from "./products-wide-client"
import { ProductsPageTabs } from "./products-tabs"

const PAGE_SIZE = 100

type SearchParams = {
  tab?: string
  view?: string
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
 * v1.2 Wide format:
 *   - 탭 1 "상품": 기존 products-list-client
 *   - 탭 2 "채널": channels-list-client (product_channels 마스터 CRUD)
 *
 * Server Component 에서 검색 파라미터 + 채널 옵션 (등록 채널 마스터)을 fetch.
 *
 * 정렬 기본값: v1.2 부터 sabangnetCode ASC — 사방넷별 그룹핑이 자연스럽게 보이도록.
 *
 * URL 예:
 *   - 상품 탭:   `/products?q=ABC&channel=GSshop,쿠팡&type=composite&page=2&sort=sabangnetCode&dir=asc`
 *   - 채널 탭:   `/products?tab=channels`
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const tab: "products" | "channels" = params.tab === "channels" ? "channels" : "products"
  // Wide 가 기본값. ?view=detail 일 때만 long(상세) 뷰.
  const view: "detail" | "wide" = params.view === "detail" ? "detail" : "wide"

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

  // 정렬 키 셋이 view 마다 다르므로 view 별로 파싱
  const sortDetail: ProductSortKey = (
    productSortKeys as readonly string[]
  ).includes(params.sort ?? "")
    ? (params.sort as ProductSortKey)
    : "sabangnetCode"
  const sortWide: ProductWideSortKey = (
    productWideSortKeys as readonly string[]
  ).includes(params.sort ?? "")
    ? (params.sort as ProductWideSortKey)
    : "sabangnetCode"

  // 기본 정렬 방향: sabangnetCode 는 ASC 가 자연스러움 (그룹핑)
  const sortKeyInUse = view === "wide" ? sortWide : sortDetail
  const dir: "asc" | "desc" =
    params.dir === "asc"
      ? "asc"
      : params.dir === "desc"
        ? "desc"
        : sortKeyInUse === "sabangnetCode"
          ? "asc"
          : "desc"

  // tab/view 에 따라 필요한 데이터만 fetch.
  // - 상품 탭 + detail view: listProducts (long, 채널 필터는 행 필터)
  // - 상품 탭 + wide view:   listProductsWide (사방넷 그룹, 채널은 컬럼 visibility 라 서버 무시)
  // - 채널 탭:               listChannelsWithUsage
  const [
    detailResult,
    wideResult,
    channelOptions,
    productMasterChannels,
    channelsUsage,
  ] = await Promise.all([
    tab === "products" && view === "detail"
      ? listProducts({
          search: q || undefined,
          channel: channel.length > 0 ? channel : undefined,
          isComposite,
          sort: sortDetail,
          dir,
          page,
          pageSize: PAGE_SIZE,
        })
      : Promise.resolve({ rows: [], total: 0 }),
    tab === "products" && view === "wide"
      ? listProductsWide({
          search: q || undefined,
          isComposite,
          sort: sortWide,
          dir,
          page,
          pageSize: PAGE_SIZE,
        })
      : Promise.resolve({ rows: [], total: 0 }),
    listChannelNames(),
    getDistinctChannelNames(),
    tab === "channels" ? listChannelsWithUsage() : Promise.resolve([]),
  ])

  // 필터 옵션은 product_master DISTINCT + 마스터 union — 양쪽 모두 노출
  const filterChannelOptions = (() => {
    const set = new Set<string>(channelOptions)
    for (const c of productMasterChannels) set.add(c)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"))
  })()

  const typeFilter =
    params.type === "composite"
      ? "composite"
      : params.type === "single"
        ? "single"
        : "all"

  return (
    <ProductsPageTabs tab={tab}>
      {tab === "products" ? (
        view === "wide" ? (
          <ProductsWideClient
            initialRows={wideResult.rows}
            total={wideResult.total}
            page={page}
            pageSize={PAGE_SIZE}
            search={q}
            visibleChannels={channel}
            typeFilter={typeFilter}
            sort={sortWide}
            dir={dir}
            channelOptions={channelOptions}
            filterChannelOptions={filterChannelOptions}
          />
        ) : (
          <ProductsListClient
            initialRows={detailResult.rows}
            total={detailResult.total}
            page={page}
            pageSize={PAGE_SIZE}
            search={q}
            channels={channel}
            typeFilter={typeFilter}
            sort={sortDetail}
            dir={dir}
            channelOptions={channelOptions}
            filterChannelOptions={filterChannelOptions}
          />
        )
      ) : (
        <ChannelsTab initial={channelsUsage} />
      )}
    </ProductsPageTabs>
  )
}

import { ChannelsListClient } from "@/components/channels-list-client"
import type { ChannelWithUsage } from "@/components/channels-list-client"

function ChannelsTab({ initial }: { initial: ChannelWithUsage[] }) {
  return <ChannelsListClient initial={initial} />
}

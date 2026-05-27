import {
  getDistinctChannelNames,
  listChannelNames,
  listChannelsWithUsage,
  listProducts,
} from "@/lib/products/actions"
import type { ProductSortKey } from "@/lib/products/schema"
import { productSortKeys } from "@/lib/products/schema"
import { ProductsListClient } from "./products-list-client"
import { ProductsPageTabs } from "./products-tabs"

const PAGE_SIZE = 100

type SearchParams = {
  tab?: string
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
    : "sabangnetCode"
  // v1.2: 기본 sabangnetCode ASC 가 사방넷별 그룹핑이 자연스러움
  const dir: "asc" | "desc" =
    params.dir === "asc"
      ? "asc"
      : params.dir === "desc"
        ? "desc"
        : sort === "sabangnetCode"
          ? "asc"
          : "desc"

  // 항상 채널 마스터(등록된 옵션 전체)와 product_master DISTINCT(필터용)를 모두 가져온다.
  // (filter UI 는 실제로 존재하는 채널만 보여도 OK 지만, 폼/양식 옵션은 마스터를 따라야 함)
  const [productsResult, channelOptions, productMasterChannels, channelsUsage] =
    await Promise.all([
      tab === "products"
        ? listProducts({
            search: q || undefined,
            channel: channel.length > 0 ? channel : undefined,
            isComposite,
            sort,
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

  return (
    <ProductsPageTabs tab={tab}>
      {tab === "products" ? (
        <ProductsListClient
          initialRows={productsResult.rows}
          total={productsResult.total}
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
          filterChannelOptions={filterChannelOptions}
        />
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

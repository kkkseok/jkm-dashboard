import { listCalAmount } from "@/lib/cal-amount/actions"
import { CalAmountListClient } from "./cal-amount-list-client"

const PAGE_SIZE = 100

type SearchParams = {
  q?: string
  page?: string
  sort?: string
  dir?: string
}

/**
 * 후정산금 관리 페이지.
 *
 * Server Component 에서 searchParams 를 받아 `listCalAmount` 로 데이터를 미리 fetch,
 * URL 동기화 + 새로고침/공유 가능하도록 한다. (next-builder 명세 §5-1 ~ §5-5)
 *
 * URL: `/cal-amount?q=…&page=2`
 */
export default async function CalAmountPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const q = (params.q ?? "").trim()
  const pageRaw = Number(params.page ?? "1")
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  const { rows, total } = await listCalAmount({
    search: q || undefined,
    page,
    pageSize: PAGE_SIZE,
  })

  return (
    <CalAmountListClient
      initialRows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      search={q}
    />
  )
}

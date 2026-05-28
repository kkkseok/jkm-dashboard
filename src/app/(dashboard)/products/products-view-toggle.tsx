"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LayoutGridIcon, TableIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export type ProductsView = "detail" | "wide"

/**
 * `/products` 상품 탭 안에서 detail ↔ wide view 를 전환.
 *
 * URL: Wide 가 기본값이라 URL 에 표기 생략. detail 일 때만 `?view=detail` 명시.
 * view 전환 시 페이지/정렬은 초기화 (정렬 키 셋이 view 마다 다름).
 * 검색(q) · 채널(channel) · 구분(type) 필터는 유지 — 두 view 모두에서 의미 있음.
 *   - detail: channel = 행 필터
 *   - wide:   channel = 컬럼 visibility
 */
export function ProductsViewToggle({ current }: { current: ProductsView }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = React.useTransition()

  function setView(next: ProductsView) {
    if (next === current) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === "detail") {
      params.set("view", "detail")
    } else {
      params.delete("view")
    }
    // 정렬 키 셋이 다르므로 초기화
    params.delete("sort")
    params.delete("dir")
    params.delete("page")
    const qs = params.toString()
    const url = qs.length > 0 ? `/products?${qs}` : "/products"
    startTransition(() => {
      router.replace(url)
    })
  }

  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 p-0.5"
      role="group"
      aria-label="보기 전환"
      aria-busy={isPending ? "true" : undefined}
    >
      <Button
        type="button"
        variant={current === "detail" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={current === "detail"}
        onClick={() => setView("detail")}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        <TableIcon className="size-3.5" />
        상세
      </Button>
      <Button
        type="button"
        variant={current === "wide" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={current === "wide"}
        onClick={() => setView("wide")}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        <LayoutGridIcon className="size-3.5" />
        Wide
      </Button>
    </div>
  )
}

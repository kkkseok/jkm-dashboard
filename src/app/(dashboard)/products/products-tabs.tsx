"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type ProductsTab = "products" | "channels"

export type ProductsPageTabsProps = {
  tab: ProductsTab
  children: React.ReactNode
}

/**
 * `/products` 페이지 탭 wrapper.
 *
 * 두 탭("상품"/"채널") 사이에서 URL 쿼리 (?tab=...) 를 동기화한다.
 * - tab=products 가 기본값. URL 에는 표기 생략.
 * - tab=channels 일 때만 `?tab=channels` 명시.
 *
 * Server Component 에서 받은 tab 값을 그대로 sourceOfTruth 로 사용.
 * 사용자가 탭 클릭 → `router.replace` 로 URL 갱신 → Server Component 가 다시 데이터 fetch.
 */
export function ProductsPageTabs({ tab, children }: ProductsPageTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = React.useTransition()

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "channels") {
      params.set("tab", "channels")
      // 상품 탭의 필터/페이지/정렬 파라미터는 채널 탭에서 의미 없으므로 정리
      params.delete("q")
      params.delete("channel")
      params.delete("type")
      params.delete("page")
      params.delete("sort")
      params.delete("dir")
    } else {
      params.delete("tab")
    }
    const qs = params.toString()
    const url = qs.length > 0 ? `/products?${qs}` : "/products"
    startTransition(() => {
      router.replace(url)
    })
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          채널별 상품코드와 단품/복합 구분 + 판매 채널 마스터를 관리합니다.
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(String(v))}
        aria-busy={isPending ? "true" : undefined}
      >
        <TabsList>
          <TabsTrigger value="products">상품</TabsTrigger>
          <TabsTrigger value="channels">채널</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="pt-4">
          {tab === "products" && children}
        </TabsContent>
        <TabsContent value="channels" className="pt-4">
          {tab === "channels" && children}
        </TabsContent>
      </Tabs>
    </div>
  )
}

"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 넓은 테이블용 가로 스크롤 동기화 컨테이너.
 *
 * 본문 위에 **동기화된 가로 스크롤바**를 띄워, 표를 아래로 스크롤하지 않아도 가로 이동이 가능하다.
 *
 * 구현: shadcn <Table> 이 자체적으로 만드는 스크롤 요소(data-slot=table-container)를 그대로 두고,
 * 그 실제 스크롤 요소를 직접 측정·동기화한다. 상단 바 스페이서 폭 = 그 요소의 scrollWidth 이고
 * 양쪽 clientWidth 가 같으므로 끝까지 1:1로 스크롤된다.
 * 폭은 ResizeObserver + window resize + fonts.ready + rAF 로 재측정한다.
 */
export function ScrollSyncContainer({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const topRef = React.useRef<HTMLDivElement>(null)
  const scrollerRef = React.useRef<HTMLElement | null>(null)
  const [scrollWidth, setScrollWidth] = React.useState(0)
  const [clientWidth, setClientWidth] = React.useState(0)
  const [overflowing, setOverflowing] = React.useState(false)

  React.useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const scroller = wrap.querySelector<HTMLElement>(
      '[data-slot="table-container"]',
    )
    scrollerRef.current = scroller
    if (!scroller) return

    let raf = 0
    const measure = () => {
      // 상단 바의 폭/스페이서를 실제 스크롤 요소에서 읽은 값으로 고정 → 스크롤 범위 동일 보장
      setScrollWidth(scroller.scrollWidth)
      setClientWidth(scroller.clientWidth)
      setOverflowing(scroller.scrollWidth - scroller.clientWidth > 1)
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    // 실제 스크롤 요소(하단) → 상단 바 동기화
    const onScrollerScroll = () => {
      if (topRef.current) topRef.current.scrollLeft = scroller.scrollLeft
    }
    scroller.addEventListener("scroll", onScrollerScroll, { passive: true })

    const ro = new ResizeObserver(schedule)
    ro.observe(scroller)
    const table = scroller.querySelector("table")
    if (table) ro.observe(table)
    window.addEventListener("resize", schedule)
    document.fonts?.ready.then(schedule).catch(() => {})
    schedule()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scroller.removeEventListener("scroll", onScrollerScroll)
      window.removeEventListener("resize", schedule)
    }
  }, [])

  return (
    <div className={className}>
      {/* 상단 동기화 가로 스크롤바 (오버플로 시에만 표시) */}
      <div
        ref={topRef}
        aria-hidden="true"
        onScroll={() => {
          const s = scrollerRef.current
          if (s && topRef.current) s.scrollLeft = topRef.current.scrollLeft
        }}
        style={{ width: clientWidth || undefined }}
        className={cn("overflow-x-auto", overflowing ? "block" : "hidden")}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      {/* 본문 — shadcn <Table> 의 자체 스크롤 요소를 그대로 사용 */}
      <div ref={wrapRef}>{children}</div>
    </div>
  )
}

"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, SearchIcon } from "lucide-react"
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  deleteMatchPair,
  getMatchPairDetail,
  markMatchDone,
  decideMatchByHuman,
} from "@/lib/match/dashboard-actions"
import {
  ACTION_STATUSES,
  MATCH_STATUSES,
  MATCH_STATUS_LABEL,
  type MatchDashboard,
  type MatchDashboardRow,
  type MatchPairDetail,
  type MatchStatus,
} from "@/lib/match/types"
import { MatchRunPanel } from "./match-run-panel"
import { MatchUploadDialog } from "./match-upload-dialog"
import type { EvidenceCrop } from "@/lib/match/evidence"
import type { Confidence, Verdict, VerdictDifference } from "@/lib/match/judge-rules"

const koInt = new Intl.NumberFormat("ko-KR")
/** 서버(UTC)·브라우저 어디서 렌더해도 같은 문자열이 나오게 KST 고정. */
const kstFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const fmt = (iso: string | null) => (iso ? kstFmt.format(new Date(iso)) : "-")
/** 목록용 짧은 표기(연도 생략) — `11-26 11:54`. */
function fmtShort(iso: string | null): string {
  if (!iso) return "-"
  const p = Object.fromEntries(kstFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/** 한 페이지에 보여줄 행 수 선택지. */
const PAGE_SIZES = [25, 50, 100] as const

/** 상태 배지 색 — 조치 필요(불일치·미반영·실패)는 빨강, 보류는 주황. */
const STATUS_CLASS: Record<MatchStatus, string> = {
  new: "bg-muted text-muted-foreground",
  match: "border-border text-muted-foreground",
  diff: "bg-destructive/10 text-destructive",
  done: "bg-primary/10 text-primary",
  unfixed: "bg-destructive text-white",
  unsure: "bg-warning/15 text-warning",
  error: "border-destructive/40 text-destructive",
}

/** 목록 정렬 우선순위 — 조치가 급한 상태가 위로. */
const STATUS_ORDER: Record<MatchStatus, number> = {
  unfixed: 0,
  diff: 1,
  error: 2,
  unsure: 3,
  done: 4,
  new: 5,
  match: 6,
}

function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[status])}>
      {MATCH_STATUS_LABEL[status]}
    </Badge>
  )
}

type Filter = "action" | "all" | MatchStatus

type Props = {
  data: MatchDashboard
  stale: boolean
}

export function MatchDashboardClient({ data, stale }: Props) {
  const [filter, setFilter] = React.useState<Filter>("action")
  const [search, setSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [openId, setOpenId] = React.useState<number | null>(null)
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZES[0] })
  const toFirstPage = () => setPagination((p) => ({ ...p, pageIndex: 0 }))

  const actionCount = ACTION_STATUSES.reduce((s, k) => s + data.byStatus[k], 0)

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.rows
      .filter((r) =>
        filter === "all" ? true : filter === "action" ? ACTION_STATUSES.includes(r.status) : r.status === filter,
      )
      .filter((r) => !q || r.matCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.matCode.localeCompare(b.matCode))
  }, [data.rows, filter, search])

  const columns = React.useMemo<ColumnDef<MatchDashboardRow>[]>(
    () => [
      { accessorKey: "matCode", header: "자재코드", cell: ({ getValue }) => <span className="tabular-nums">{getValue<string>()}</span> },
      {
        accessorKey: "productName",
        header: "상품명",
        cell: ({ getValue }) => (
          <span className="block max-w-[22rem] truncate" title={getValue<string>()}>
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "상태",
        sortingFn: (a, b) => STATUS_ORDER[a.original.status] - STATUS_ORDER[b.original.status],
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <StatusBadge status={row.original.status} />
            {row.original.humanDecidedAt && (
              <span className="text-xs text-muted-foreground" title="확인자가 직접 정한 판정">
                (확인자)
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "diffSummary",
        header: "차이 요약",
        enableSorting: false,
        cell: ({ row }) => {
          const text = row.original.status === "match" ? "" : (row.original.diffSummary ?? "")
          // 한 줄로 자르고 전체 문장은 마우스를 올리면 보인다(상세 창에도 있다).
          return (
            <span className="block max-w-[28rem] truncate text-xs text-muted-foreground" title={text || undefined}>
              {text}
            </span>
          )
        },
      },
      {
        accessorKey: "statusChangedAt",
        header: "상태 변경 · 확인",
        cell: ({ row }) => (
          <span
            className="text-xs tabular-nums"
            title={`상태 변경 ${fmt(row.original.statusChangedAt)} · 마지막 확인 ${fmt(row.original.lastCheckedAt)}`}
          >
            {fmtShort(row.original.statusChangedAt)}
            <span className="ml-2 text-muted-foreground">확인 {fmtShort(row.original.lastCheckedAt)}</span>
          </span>
        ),
      },
      {
        id: "links",
        header: "링크",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
            <a className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline" href={row.original.cjUrl} target="_blank" rel="noreferrer">
              CJ<ExternalLinkIcon className="size-3" />
            </a>
            <a className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline" href={row.original.gsUrl} target="_blank" rel="noreferrer">
              GS<ExternalLinkIcon className="size-3" />
            </a>
          </div>
        ),
      },
    ],
    [],
  )

  // 처리 뒤 목록이 줄어 현재 페이지가 범위를 벗어나면 마지막 페이지로 맞춘다.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pagination.pageSize))
  const pageIndex = Math.min(pagination.pageIndex, pageCount - 1)

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, pagination: { pageIndex, pageSize: pagination.pageSize } },
    onSortingChange: (u) => {
      setSorting(u)
      toFirstPage()
    },
    onPaginationChange: setPagination,
    // 새로고침(router.refresh)으로 데이터가 바뀌어도 보던 페이지를 유지한다 — 1페이지 이동은 필터·검색·정렬에서 직접 한다.
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  /** 지금 필터·정렬 순서의 전체 id — 상세 창의 이전·다음 이동 순서. */
  const orderedIds = table.getPrePaginationRowModel().rows.map((r) => r.original.id)
  /** 상세 창에서 다른 쌍으로 이동 — 목록도 그 쌍이 있는 페이지로 따라간다. */
  function openPair(id: number) {
    setOpenId(id)
    const i = orderedIds.indexOf(id)
    if (i >= 0) setPagination((p) => ({ ...p, pageIndex: Math.floor(i / p.pageSize) }))
  }
  const firstRow = filtered.length === 0 ? 0 : pageIndex * pagination.pageSize + 1
  const lastRow = Math.min(filtered.length, (pageIndex + 1) * pagination.pageSize)

  const filterCards: { key: Filter; label: string; count: number; tone?: string }[] = [
    { key: "action", label: "조치 필요", count: actionCount, tone: actionCount > 0 ? "text-destructive" : undefined },
    { key: "unfixed", label: MATCH_STATUS_LABEL.unfixed, count: data.byStatus.unfixed, tone: data.byStatus.unfixed > 0 ? "text-destructive" : undefined },
    { key: "diff", label: MATCH_STATUS_LABEL.diff, count: data.byStatus.diff, tone: data.byStatus.diff > 0 ? "text-destructive" : undefined },
    { key: "done", label: "처리 완료 대기", count: data.byStatus.done },
    { key: "unsure", label: MATCH_STATUS_LABEL.unsure, count: data.byStatus.unsure, tone: data.byStatus.unsure > 0 ? "text-warning" : undefined },
    { key: "error", label: MATCH_STATUS_LABEL.error, count: data.byStatus.error, tone: data.byStatus.error > 0 ? "text-destructive" : undefined },
    { key: "all", label: "전체", count: data.rows.length },
  ]

  return (
    <div className="space-y-6">
      <MatchRunPanel run={data.lastRun} pendingCount={data.byStatus.new} />
      <BatchStatus data={data} stale={stale} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {filterCards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setFilter(c.key)
              toFirstPage()
            }}
            aria-pressed={filter === c.key}
            className={cn(
              "rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50",
              filter === c.key && "border-primary ring-2 ring-primary/20",
            )}
          >
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className={cn("mt-1 text-xl font-semibold tabular-nums", c.tone)}>{koInt.format(c.count)}</div>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                toFirstPage()
              }}
              placeholder="자재코드·상품명 검색"
              className="pl-8"
            />
          </div>
          <span className="text-sm text-muted-foreground">
            {koInt.format(filtered.length)}건 · 그 외 {MATCH_STATUSES.filter((s) => data.byStatus[s] > 0 && s !== "match")
              .map((s) => `${MATCH_STATUS_LABEL[s]} ${data.byStatus[s]}`)
              .join(" · ") || "조치 필요 없음"}
            {" · "}일치 {koInt.format(data.byStatus.match)}
          </span>
          <div className="ml-auto">
            <MatchUploadDialog total={data.rows.length} lastRegisteredAt={data.lastRegisteredAt} />
          </div>
        </div>

        {/* 표 안에서만 스크롤 — 열 제목은 고정하고 필터 카드·검색이 화면에 남게 한다. */}
        <div className="overflow-hidden rounded-lg border [&>[data-slot=table-container]]:max-h-[max(20rem,calc(100dvh-25rem))] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                      className={cn(h.column.getCanSort() && "cursor-pointer select-none")}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                    {data.rows.length === 0
                      ? "등록된 대조 대상이 없습니다. 위의 [대상 엑셀 업로드]로 엑셀을 올려 주세요."
                      : "조건에 맞는 항목이 없습니다."}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    data-state={openId === row.original.id ? "selected" : undefined}
                    onClick={() => setOpenId(row.original.id)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <label className="flex items-center gap-2">
            페이지당
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}행
                </option>
              ))}
            </select>
          </label>
          <span className="tabular-nums">
            {koInt.format(firstRow)}–{koInt.format(lastRow)} / {koInt.format(filtered.length)}건
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={pageIndex === 0} onClick={() => setPagination((p) => ({ ...p, pageIndex: pageIndex - 1 }))}>
              <ChevronLeftIcon />
              이전
            </Button>
            <span className="px-2 tabular-nums">
              {pageIndex + 1} / {pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={pageIndex >= pageCount - 1} onClick={() => setPagination((p) => ({ ...p, pageIndex: pageIndex + 1 }))}>
              다음
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>

      <PairSheet pairId={openId} ids={orderedIds} onNavigate={openPair} onClose={() => setOpenId(null)} />
    </div>
  )
}

// ── 배치 현황 ─────────────────────────────────────────

function BatchStatus({ data, stale }: Props) {
  const run = data.lastRun
  const hoursSinceSuccess = data.hoursSinceSuccess
  if (!run?.error && !stale) return null
  return (
    <div className="space-y-2">
      {run?.error && (
        <Alert variant="destructive">
          <AlertTitle>마지막 배치에 오류가 있습니다</AlertTitle>
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      )}
      {stale && (
        <Alert variant="destructive">
          <AlertTitle>배치가 오래 돌지 않았습니다</AlertTitle>
          <AlertDescription>
            {hoursSinceSuccess == null
              ? "정상 완료된 배치가 아직 없습니다."
              : `마지막 정상 배치가 ${Math.floor(hoursSinceSuccess)}시간 전입니다.`}{" "}
            GitHub Actions 의 image-match 실행 기록을 확인해 주세요.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ── 상세 시트 ─────────────────────────────────────────

const AREA_LABEL = { thumbnail: "썸네일", detail: "상세" } as const
const VERDICT_LABEL = { same: "일치", diff: "다름", unsure: "판단 보류" } as const
/** 머리글 판정 요약 칩 색 — 목록의 상태 배지와 같은 규칙(다름=빨강, 보류=주황). */
const VERDICT_CLASS: Record<keyof typeof VERDICT_LABEL, string> = {
  same: "border-border text-muted-foreground",
  diff: "border-transparent bg-destructive/10 text-destructive",
  unsure: "border-transparent bg-warning/15 text-warning",
}
const CONFIDENCE_LABEL: Record<Confidence, { label: string; className: string }> = {
  high: { label: "확신 높음", className: "bg-destructive/10 text-destructive" },
  medium: { label: "확신 보통", className: "bg-warning/15 text-warning" },
  low: { label: "확신 낮음", className: "bg-muted text-muted-foreground" },
}

/**
 * CJ·GS 구분 색 — 상세 창 어디서든 같은 쪽은 같은 색(CJ 보라 / GS 청록)으로 보이게 한 곳에서 정한다.
 * 상태 색(빨강·주황)·변경 표시(amber)와 겹치지 않는 색을 쓴다.
 */
const SIDE = {
  cj: {
    label: "CJ 원본",
    tag: "bg-violet-600 text-white",
    band: "bg-violet-50 dark:bg-violet-950",
    border: "border-violet-400/70",
    link: "border-violet-400/70 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950",
  },
  gs: {
    label: "GS",
    tag: "bg-teal-600 text-white",
    band: "bg-teal-50 dark:bg-teal-950",
    border: "border-teal-400/70",
    link: "border-teal-400/70 text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950",
  },
} as const
type Side = keyof typeof SIDE

function SideTag({ side }: { side: Side }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold", SIDE[side].tag)}>
      {SIDE[side].label}
    </span>
  )
}

/** 상품 페이지 새 창 링크 — 쪽 색 테두리. */
function SideLink({ side, href }: { side: Side; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors", SIDE[side].link)}
    >
      {SIDE[side].label} 페이지
      <ExternalLinkIcon className="size-3" />
    </a>
  )
}

/**
 * 한쪽(CJ 또는 GS) 내용을 담는 칸 — 위에 쪽 색 띠와 이름표를 붙인다.
 * 이름표는 스크롤 영역 안에서 위에 붙어 있어, 긴 이미지를 내려 보는 중에도 어느 쪽인지 보인다.
 */
function SidePanel({ side, meta, children }: { side: Side; meta?: React.ReactNode; children: React.ReactNode }) {
  const s = SIDE[side]
  return (
    <div className={cn("min-w-0 rounded-lg border border-t-4", s.border)}>
      <div className={cn("sticky top-0 z-1 flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground", s.band)}>
        <SideTag side={side} />
        {meta}
      </div>
      <div className="space-y-1 p-2">{children}</div>
    </div>
  )
}

/** 머리글의 판정 요약 — 썸네일·상세 결과 칩 + 한 줄 요약. */
function VerdictSummary({ verdict }: { verdict: Verdict }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {(["thumbnail", "detail"] as const).map((area) => {
        const v = verdict[area]
        const count = verdict.differences.filter((d) => d.area === area).length
        return (
          <Badge key={area} variant="outline" className={VERDICT_CLASS[v]}>
            {AREA_LABEL[area]} {VERDICT_LABEL[v]}
            {count > 0 && ` · ${count}건`}
          </Badge>
        )
      })}
      <span className="line-clamp-2 min-w-0 flex-1 basis-64 text-foreground" title={verdict.summary}>
        {verdict.summary}
      </span>
    </div>
  )
}

/** 근거 재검증 결과 라벨 (근거 부분만 다시 본 2차 확인). */
const VERIFY_LABEL = { confirmed: "차이 확인됨", rejected: "1차 판정과 엇갈림", unsure: "근거로 확인 불가" } as const

/** 차이 1건 — 설명 + CJ·GS 의 해당 부분 이미지(근거)를 쪽별 칸에 나란히. */
function DifferenceCard({ d }: { d: VerdictDifference }) {
  const conf = CONFIDENCE_LABEL[d.confidence ?? "high"]
  const hasEvidence = (d.cjEvidence?.length ?? 0) + (d.gsEvidence?.length ?? 0) > 0
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{AREA_LABEL[d.area]}</Badge>
        <span className="font-medium">{d.what}</span>
        {d.confidence && (
          <Badge variant="outline" className={cn("border-transparent", conf.className)}>
            {conf.label}
          </Badge>
        )}
        {d.verify && (
          <span className="text-xs text-muted-foreground" title={d.verifyNote}>
            재확인: {VERIFY_LABEL[d.verify]}
            {d.verifyNote ? ` — ${d.verifyNote}` : ""}
          </span>
        )}
      </div>
      <div className={cn("grid grid-cols-2 gap-3", hasEvidence && "max-h-[560px] overflow-y-auto")}>
        <SidePanel side="cj">
          <p className="text-xs">{d.cj}</p>
          {d.cjEvidence?.map((c, i) => <EvidenceImage key={i} crop={c} />)}
        </SidePanel>
        <SidePanel side="gs">
          <p className="text-xs">{d.gs}</p>
          {d.gsEvidence?.map((c, i) => <EvidenceImage key={i} crop={c} />)}
        </SidePanel>
      </div>
      {!hasEvidence && (
        <p className="text-xs text-muted-foreground">근거 이미지 위치가 없습니다(이전 형식 판정). 아래 전체 이미지에서 확인해 주세요.</p>
      )}
    </li>
  )
}

/**
 * 원본 이미지의 top~bottom 구간만 잘라 보여준다(이미지는 저장하지 않음 — 설계 §3).
 * 높이·위치는 폭 대비 비율이라 padding/margin 의 % (폭 기준)로 맞춘다.
 */
function EvidenceImage({ crop }: { crop: EvidenceCrop }) {
  const heightPct = (crop.bottom - crop.top) * crop.aspect * 100
  return (
    <div className="relative w-full overflow-hidden border bg-white" style={{ paddingBottom: `${heightPct}%` }}>
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- 외부 쇼핑몰 원본 이미지 일부를 그대로 보여준다 */}
        <img src={crop.url} alt="" loading="lazy" className="block w-full" style={{ marginTop: `-${crop.top * crop.aspect * 100}%` }} />
      </div>
    </div>
  )
}

type PairNav = {
  /** 목록(필터·정렬 적용) 순서의 전체 id. */
  ids: number[]
  onNavigate: (id: number) => void
  onClose: () => void
}

function PairSheet({ pairId, ...nav }: { pairId: number | null } & PairNav) {
  const { onClose } = nav
  return (
    <Sheet open={pairId != null} onOpenChange={(o) => !o && onClose()}>
      {/* 창 자체는 스크롤하지 않는다 — 머리글·아래 조치 바는 고정하고 가운데 본문만 스크롤한다. */}
      <SheetContent className="w-full gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
        {/* key: 다른 쌍을 열면 본문 상태(상세·메모·스크롤 위치)를 새로 시작한다 */}
        {pairId != null && <PairSheetBody key={pairId} pairId={pairId} {...nav} />}
      </SheetContent>
    </Sheet>
  )
}

/** 아래 조치 바에 놓을 버튼 1개. */
type PairAction = {
  label: string
  variant: "default" | "outline" | "destructive"
  title?: string
  run: () => Promise<void>
  ok: string
}

function PairSheetBody({ pairId, ids, onNavigate, onClose }: { pairId: number } & PairNav) {
  const router = useRouter()
  // 처리한 쌍은 새로고침 뒤 목록에서 빠질 수 있다 — 그때는 위치를 알 수 없어 이동 버튼을 끈다.
  const pos = ids.indexOf(pairId)
  const prevId = pos > 0 ? ids[pos - 1] : null
  const nextId = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
  const [detail, setDetail] = React.useState<MatchPairDetail | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
  const [memoOpen, setMemoOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    getMatchPairDetail(pairId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : "불러오기 실패"))
    return () => {
      cancelled = true
    }
  }, [pairId])

  // ← → 로 이전·다음 건 이동. 메모 등 입력 중이거나 처리·삭제 확인 중에는 끼어들지 않는다.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (pending || confirmDelete) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      const to = e.key === "ArrowLeft" ? prevId : e.key === "ArrowRight" ? nextId : null
      if (to == null) return
      e.preventDefault()
      onNavigate(to)
    }
    // 캡처 단계 — 대화창(base-ui)이 안쪽 키 입력의 전파를 막아 버블 단계에서는 받지 못한다.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [prevId, nextId, onNavigate, pending, confirmDelete])

  function run(action: () => Promise<void>, ok: string) {
    startTransition(async () => {
      try {
        await action()
        toast.success(ok)
        // 처리하면 바로 다음 건으로 — 마지막 건이면 닫는다.
        if (nextId != null) onNavigate(nextId)
        else onClose()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "처리하지 못했습니다")
      }
    })
  }

  const p = detail?.pair

  // 상태별 조치 — 아래 고정 바 한 곳에 모은다(처리 완료·보류 확정·AI 판정 정정).
  let hint = ""
  const actions: PairAction[] = []
  if (detail && p) {
    const fixToMatch = (label: string, ok: string): PairAction => ({
      label,
      variant: "outline",
      run: () => decideMatchByHuman(p.id, "match", note),
      ok,
    })
    if (p.status === "diff" || p.status === "unfixed") {
      hint =
        p.status === "unfixed"
          ? "처리 완료로 표시했지만 다음 확인에서도 다릅니다."
          : "GS 를 원본에 맞게 고친 뒤 처리 완료로 표시하세요."
      if (detail.judged) actions.push(fixToMatch("같은 상품으로 정정", "같은 상품으로 정정했습니다"))
      actions.push({
        label: "처리 완료",
        variant: "default",
        title: "다음 배치가 GS 를 다시 확인해 일치면 ‘일치’, 여전히 다르면 ‘미반영’으로 바꿉니다.",
        run: () => markMatchDone(p.id, note),
        ok: "처리 완료로 표시했습니다",
      })
    } else if (p.status === "unsure") {
      hint = "AI 가 확신하지 못한 판정입니다. 근거 이미지를 보고 직접 정해 주세요."
      actions.push(fixToMatch("같은 상품으로 확정", "같은 상품으로 확정했습니다"))
      actions.push({
        label: "다름으로 확정",
        variant: "destructive",
        run: () => decideMatchByHuman(p.id, "diff", note),
        ok: "다름으로 확정했습니다",
      })
    } else if (p.status === "match" && detail.judged) {
      hint = "판정이 틀렸다면 정정하세요."
      actions.push({
        label: "다름으로 정정",
        variant: "outline",
        run: () => decideMatchByHuman(p.id, "diff", note),
        ok: "다름으로 정정했습니다",
      })
    }
  }

  return (
    <>
      {/* 머리글(고정) — 무엇을 보고 있는지 · AI 판정 요약 · 이동 · 양쪽 상품 페이지 */}
      <SheetHeader className="shrink-0 gap-2 border-b bg-background pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {p ? (
            <>
              <span className="tabular-nums">{p.matCode}</span>
              <span>{p.productName}</span>
              <StatusBadge status={p.status} />
              {p.humanDecidedAt && <Badge variant="outline">확인자 판정</Badge>}
            </>
          ) : (
            "불러오는 중…"
          )}
        </SheetTitle>
        <SheetDescription>
          {p
            ? `마지막 확인 ${fmt(p.lastCheckedAt)} · 마지막 판정 ${fmt(p.lastJudgedAt)}${detail?.judged?.model ? ` (${detail.judged.model})` : ""}`
            : " "}
        </SheetDescription>
        {detail?.judged && <VerdictSummary verdict={detail.judged.verdict} />}
        <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Button variant="outline" size="sm" disabled={prevId == null} onClick={() => prevId != null && onNavigate(prevId)} title="이전 건 (←)">
            <ChevronLeftIcon />
            이전 건
          </Button>
          <Button variant="outline" size="sm" disabled={nextId == null} onClick={() => nextId != null && onNavigate(nextId)} title="다음 건 (→)">
            다음 건
            <ChevronRightIcon />
          </Button>
          {pos >= 0 && (
            <span className="px-2 tabular-nums">
              {koInt.format(pos + 1)} / {koInt.format(ids.length)}
            </span>
          )}
          <span className="hidden text-xs sm:inline">키보드 ← → 로도 이동</span>
          {p && (
            <div className="ml-auto flex items-center gap-2">
              <SideLink side="cj" href={p.cjUrl} />
              <SideLink side="gs" href={p.gsUrl} />
            </div>
          )}
        </div>
      </SheetHeader>

      {/* 본문 — 여기만 스크롤 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadError && (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertTitle>불러오지 못했습니다</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {detail && p && (
          <div className="space-y-6 p-4">
            {p.status === "done" && (
              <Alert>
                <AlertTitle>처리 완료 — 다음 배치에서 확인합니다</AlertTitle>
                {p.resolvedNote && <AlertDescription>메모: {p.resolvedNote}</AlertDescription>}
              </Alert>
            )}
            {detail.lastError && (
              <Alert variant="destructive">
                <AlertTitle>마지막 수집 실패</AlertTitle>
                <AlertDescription className="break-all">{detail.lastError}</AlertDescription>
              </Alert>
            )}

            {/* AI 판정 — 요약은 머리글에, 여기는 차이별 근거 */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">
                AI 판정 — 차이 {detail.judged?.verdict.differences.length ?? 0}건
                {detail.judged && <span className="ml-2 text-xs font-normal text-muted-foreground">{fmt(detail.judged.judgedAt)}</span>}
              </h3>
              {detail.judged ? (
                detail.judged.verdict.differences.length > 0 && (
                  <ul className="space-y-3">
                    {detail.judged.verdict.differences.map((d, i) => (
                      <DifferenceCard key={i} d={d} />
                    ))}
                  </ul>
                )
              ) : (
                <p className="text-sm text-muted-foreground">아직 판정 전입니다.</p>
              )}
              {p.humanDecidedAt && (
                <p className="text-xs text-muted-foreground">
                  확인자가 {fmt(p.humanDecidedAt)}에 <b>{MATCH_STATUS_LABEL[p.status]}</b>(으)로 정했습니다. 판정 규칙이 바뀌어도 유지되고, 이미지가 바뀌면 AI 가 다시 판정합니다.
                </p>
              )}
            </section>

            {/* 이미지 비교 */}
            {detail.latest ? (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">썸네일</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ImageColumn side="cj" urls={detail.latest.cjThumbUrl ? [detail.latest.cjThumbUrl] : []} changed={[!!detail.latest.changes?.cjThumb]} />
                    <ImageColumn side="gs" urls={detail.latest.gsThumbUrl ? [detail.latest.gsThumbUrl] : []} changed={[!!detail.latest.changes?.gsThumb]} />
                  </div>
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">
                    상세 <span className="text-xs font-normal text-muted-foreground">(GS 공통 공지 {detail.latest.gsCommonCount}장 제외 · 수집 {fmt(detail.latest.checkedAt)})</span>
                  </h3>
                  {detail.latest.changes && (
                    <p className="text-xs text-muted-foreground">
                      {fmt(detail.latest.changes.since)} 판정 이후 —{" "}
                      {(["cj", "gs"] as const)
                        .map((side) => {
                          const added = detail.latest![`${side}Detail`].filter((d) => d.changed).length
                          const removed = detail.latest!.changes![`${side}Removed`]
                          const thumb = detail.latest!.changes![`${side}Thumb`]
                          const parts = [thumb && "썸네일 변경", added > 0 && `상세 새 이미지 ${added}장`, removed > 0 && `빠진 이미지 ${removed}장`].filter(Boolean)
                          return `${side === "cj" ? "CJ" : "GS"}: ${parts.length ? parts.join(" · ") : "변경 없음"}`
                        })
                        .join(" / ")}
                    </p>
                  )}
                  <div className="grid max-h-[80vh] grid-cols-2 gap-3 overflow-y-auto">
                    <ImageColumn side="cj" meta={`${detail.latest.cjDetail.length}장`} urls={detail.latest.cjDetail.map((d) => d.url)} changed={detail.latest.cjDetail.map((d) => !!d.changed)} />
                    <ImageColumn side="gs" meta={`${detail.latest.gsDetail.length}장`} urls={detail.latest.gsDetail.map((d) => d.url)} changed={detail.latest.gsDetail.map((d) => !!d.changed)} />
                  </div>
                </section>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">아직 정상 수집된 기록이 없습니다.</p>
            )}

            {/* 이력 */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">상태 이력</h3>
              <ul className="space-y-1 text-xs">
                {detail.logs.map((l, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
                    <span className="tabular-nums">{fmt(l.at)}</span>
                    <span className="text-foreground">
                      {/* 상태가 그대로인 기록(판정 실패 등)은 화살표 없이 현재 상태만 */}
                      {l.from && l.from !== l.to ? `${MATCH_STATUS_LABEL[l.from]} → ` : ""}
                      {MATCH_STATUS_LABEL[l.to]}
                    </span>
                    <span>({{ batch: "배치", user: "사용자", upload: "업로드" }[l.actor] ?? l.actor})</span>
                    {l.note && (
                      <span className="line-clamp-2 break-all" title={l.note}>
                        {l.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <div className="border-t pt-4">
              <Button variant="ghost" className="text-destructive" disabled={pending} onClick={() => setConfirmDelete(true)}>
                대조 대상에서 삭제
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 조치 바(고정) — 근거를 어디까지 내려 보고 있든 바로 판단할 수 있게 */}
      {actions.length > 0 && (
        <div className="shrink-0 space-y-2 border-t bg-background p-3">
          {memoOpen && (
            <Textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="메모 (선택) — 예: 썸네일·상세 교체 요청 완료"
              rows={2}
            />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto min-w-0 text-xs text-muted-foreground">{hint}</p>
            <Button variant="ghost" size="sm" onClick={() => setMemoOpen((o) => !o)}>
              {memoOpen ? "메모 닫기" : note.trim() ? "메모 있음 · 수정" : "메모 추가"}
            </Button>
            {actions.map((a) => (
              <Button key={a.label} variant={a.variant} disabled={pending} title={a.title} onClick={() => run(a.run, a.ok)}>
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>대조 대상에서 삭제할까요?</DialogTitle>
            <DialogDescription>
              {p?.matCode} {p?.productName} — 수집·판정·상태 이력도 함께 지워지고 되돌릴 수 없습니다. 다시 확인하려면 엑셀로 다시 등록해야 합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !p}
              onClick={() => {
                setConfirmDelete(false)
                if (p) run(() => deleteMatchPair(p.id), "삭제했습니다")
              }}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 원본 URL 그대로 표시 — 이미지는 저장하지 않는다(설계 §3). */
/** changed[i] = urls[i] 가 기준 판정 이후 새로 들어온(교체된) 이미지 — 테두리와 "변경" 표시를 붙인다. */
function ImageColumn({ side, meta, urls, changed }: { side: Side; meta?: string; urls: string[]; changed?: boolean[] }) {
  return (
    <SidePanel side={side} meta={meta}>
      {urls.length === 0 ? (
        <p className="text-xs text-muted-foreground">이미지 없음</p>
      ) : (
        urls.map((u, i) => (
          <div key={u} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- 외부 쇼핑몰 원본 이미지를 그대로 보여준다(최적화·저장 불필요) */}
            <img src={u} alt="" loading="lazy" className={cn("w-full border bg-white", changed?.[i] && "border-2 border-amber-500")} />
            {changed?.[i] && <Badge className="absolute top-1 left-1 bg-amber-500 text-white">변경</Badge>}
          </div>
        ))
      )}
    </SidePanel>
  )
}

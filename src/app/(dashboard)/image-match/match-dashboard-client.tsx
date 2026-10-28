"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ExternalLinkIcon, SearchIcon } from "lucide-react"
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  resolveMatchUnsure,
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

const koInt = new Intl.NumberFormat("ko-KR")
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
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
      { accessorKey: "productName", header: "상품명", cell: ({ getValue }) => <span className="line-clamp-1">{getValue<string>()}</span> },
      {
        accessorKey: "status",
        header: "상태",
        sortingFn: (a, b) => STATUS_ORDER[a.original.status] - STATUS_ORDER[b.original.status],
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "diffSummary",
        header: "차이 요약",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {row.original.status === "match" ? "" : (row.original.diffSummary ?? "")}
          </span>
        ),
      },
      { accessorKey: "statusChangedAt", header: "상태 변경", cell: ({ getValue }) => <span className="text-xs tabular-nums">{fmt(getValue<string>())}</span> },
      { accessorKey: "lastCheckedAt", header: "마지막 확인", cell: ({ getValue }) => <span className="text-xs tabular-nums">{fmt(getValue<string | null>())}</span> },
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

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

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
      <BatchStatus data={data} stale={stale} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {filterCards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
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
              onChange={(e) => setSearch(e.target.value)}
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
        </div>

        <div className="rounded-lg border">
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
                      ? "등록된 대조 대상이 없습니다. 관리 › 이미지 대조 대상에서 엑셀을 올려 주세요."
                      : "조건에 맞는 항목이 없습니다."}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setOpenId(row.original.id)}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <UsagePanel usage={data.usage} />

      <PairSheet pairId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

// ── 배치 현황 ─────────────────────────────────────────

function BatchStatus({ data, stale }: Props) {
  const run = data.lastRun
  const hoursSinceSuccess = data.hoursSinceSuccess
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        마지막 배치 {run ? fmt(run.finishedAt ?? run.startedAt) : "없음"}
        {run &&
          ` · 수집 ${run.fetched}/${run.total}${run.failed ? ` · 실패 ${run.failed}` : ""} · 판정 ${run.judged}${run.deferred ? ` · 다음으로 미룸 ${run.deferred}` : ""}`}
        {" · "}매일 03:00 자동 실행
      </p>
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

// ── 사용량 ───────────────────────────────────────────

function UsagePanel({ usage }: { usage: MatchDashboard["usage"] }) {
  const judged = usage.reduce((s, u) => s + u.judged, 0)
  const input = usage.reduce((s, u) => s + u.inputTokens, 0)
  const output = usage.reduce((s, u) => s + u.outputTokens, 0)
  const api = usage.reduce((s, u) => s + u.apiEquivUsd, 0)
  const maxTokens = Math.max(1, ...usage.map((u) => u.inputTokens + u.outputTokens))

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 판정 사용량 (최근 30일)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="판정 쌍" value={koInt.format(judged)} />
          <Stat label="토큰 (입력+출력)" value={koInt.format(input + output)} sub={`입력 ${koInt.format(input)} · 출력 ${koInt.format(output)}`} />
          <Stat label="쌍당 평균 토큰" value={judged ? koInt.format(Math.round((input + output) / judged)) : "-"} />
          <Stat label="API 환산 금액" value={usd.format(api)} sub="구독 실행 — 실제 청구액 아님" />
        </div>
        {usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">기록이 없습니다.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead>
                <TableHead className="text-right">배치</TableHead>
                <TableHead className="text-right">판정</TableHead>
                <TableHead className="w-1/3">토큰</TableHead>
                <TableHead className="text-right">API 환산</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.map((u) => {
                const tokens = u.inputTokens + u.outputTokens
                return (
                  <TableRow key={u.date}>
                    <TableCell className="tabular-nums">{u.date}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.judged}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${(tokens / maxTokens) * 100}%` }} />
                        </div>
                        <span className="w-24 text-right text-xs tabular-nums">{koInt.format(tokens)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd.format(u.apiEquivUsd)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          판정은 Claude Code 구독으로 실행돼 API 요금은 나가지 않습니다. 토큰은 구독 사용량을 가늠하는 지표이고, 남은 구독 한도(%)는 여기서 알 수 없습니다.
        </p>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ── 상세 시트 ─────────────────────────────────────────

const AREA_LABEL = { thumbnail: "썸네일", detail: "상세" } as const
const VERDICT_LABEL = { same: "일치", diff: "다름", unsure: "판단 보류" } as const

function PairSheet({ pairId, onClose }: { pairId: number | null; onClose: () => void }) {
  return (
    <Sheet open={pairId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
        {/* key: 다른 쌍을 열면 본문 상태(상세·메모)를 새로 시작한다 */}
        {pairId != null && <PairSheetBody key={pairId} pairId={pairId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function PairSheetBody({ pairId, onClose }: { pairId: number; onClose: () => void }) {
  const router = useRouter()
  const [detail, setDetail] = React.useState<MatchPairDetail | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
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

  function run(action: () => Promise<void>, ok: string) {
    startTransition(async () => {
      try {
        await action()
        toast.success(ok)
        onClose()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "처리하지 못했습니다")
      }
    })
  }

  const p = detail?.pair

  return (
    <>
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {p ? (
              <>
                <span className="tabular-nums">{p.matCode}</span>
                <span>{p.productName}</span>
                <StatusBadge status={p.status} />
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
        </SheetHeader>

        {loadError && (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertTitle>불러오지 못했습니다</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {detail && p && (
          <div className="space-y-6 p-4">
            {/* 조치 */}
            {(p.status === "diff" || p.status === "unfixed") && (
              <section className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">
                  {p.status === "unfixed" ? "처리 완료로 표시했지만 다음 확인에서도 다릅니다." : "GS 를 원본에 맞게 고친 뒤 처리 완료로 표시하세요."}
                </h3>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (선택) — 예: 썸네일·상세 교체 요청 완료" rows={2} />
                <p className="text-xs text-muted-foreground">다음 배치가 GS 를 다시 확인해 일치면 &lsquo;일치&rsquo;, 여전히 다르면 &lsquo;미반영&rsquo;으로 바꿉니다.</p>
                <Button disabled={pending} onClick={() => run(() => markMatchDone(p.id, note), "처리 완료로 표시했습니다")}>
                  처리 완료
                </Button>
              </section>
            )}
            {p.status === "done" && (
              <Alert>
                <AlertTitle>처리 완료 — 다음 배치에서 확인합니다</AlertTitle>
                {p.resolvedNote && <AlertDescription>메모: {p.resolvedNote}</AlertDescription>}
              </Alert>
            )}
            {p.status === "unsure" && (
              <section className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">AI 가 판단을 보류했습니다. 직접 보고 정해 주세요.</h3>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (선택)" rows={2} />
                <div className="flex gap-2">
                  <Button variant="outline" disabled={pending} onClick={() => run(() => resolveMatchUnsure(p.id, "match", note), "일치로 확정했습니다")}>
                    일치로 확정
                  </Button>
                  <Button variant="destructive" disabled={pending} onClick={() => run(() => resolveMatchUnsure(p.id, "diff", note), "불일치로 확정했습니다")}>
                    불일치로 확정
                  </Button>
                </div>
              </section>
            )}
            {detail.lastError && (
              <Alert variant="destructive">
                <AlertTitle>마지막 수집 실패</AlertTitle>
                <AlertDescription className="break-all">{detail.lastError}</AlertDescription>
              </Alert>
            )}

            {/* AI 판정 */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">AI 판정</h3>
              {detail.judged ? (
                <>
                  <p className="text-sm">
                    썸네일 <b>{VERDICT_LABEL[detail.judged.verdict.thumbnail]}</b> · 상세{" "}
                    <b>{VERDICT_LABEL[detail.judged.verdict.detail]}</b> — {detail.judged.verdict.summary}
                    <span className="ml-2 text-xs text-muted-foreground">{fmt(detail.judged.judgedAt)}</span>
                  </p>
                  {detail.judged.verdict.differences.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">영역</TableHead>
                          <TableHead className="w-40">항목</TableHead>
                          <TableHead>CJ (원본)</TableHead>
                          <TableHead>GS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.judged.verdict.differences.map((d, i) => (
                          <TableRow key={i}>
                            <TableCell>{AREA_LABEL[d.area]}</TableCell>
                            <TableCell className="whitespace-normal">{d.what}</TableCell>
                            <TableCell className="whitespace-normal text-xs">{d.cj}</TableCell>
                            <TableCell className="whitespace-normal text-xs">{d.gs}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">아직 판정 전입니다.</p>
              )}
            </section>

            {/* 이미지 비교 */}
            {detail.latest ? (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">썸네일</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ImageColumn title="CJ (원본)" href={p.cjUrl} urls={detail.latest.cjThumbUrl ? [detail.latest.cjThumbUrl] : []} />
                    <ImageColumn title="GS" href={p.gsUrl} urls={detail.latest.gsThumbUrl ? [detail.latest.gsThumbUrl] : []} />
                  </div>
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">
                    상세 <span className="text-xs font-normal text-muted-foreground">(GS 공통 공지 {detail.latest.gsCommonCount}장 제외 · 수집 {fmt(detail.latest.checkedAt)})</span>
                  </h3>
                  <div className="grid max-h-[80vh] grid-cols-2 gap-3 overflow-y-auto rounded-lg border p-2">
                    <ImageColumn title={`CJ ${detail.latest.cjDetail.length}장`} urls={detail.latest.cjDetail.map((d) => d.url)} />
                    <ImageColumn title={`GS ${detail.latest.gsDetail.length}장`} urls={detail.latest.gsDetail.map((d) => d.url)} />
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
                      {l.from ? `${MATCH_STATUS_LABEL[l.from]} → ` : ""}
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
function ImageColumn({ title, urls, href }: { title: string; urls: string[]; href?: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {title}
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center hover:text-foreground" aria-label={`${title} 상품 페이지 열기`}>
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
      {urls.length === 0 ? (
        <p className="text-xs text-muted-foreground">이미지 없음</p>
      ) : (
        urls.map((u) => (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 쇼핑몰 원본 이미지를 그대로 보여준다(최적화·저장 불필요)
          <img key={u} src={u} alt="" loading="lazy" className="w-full border bg-white" />
        ))
      )}
    </div>
  )
}

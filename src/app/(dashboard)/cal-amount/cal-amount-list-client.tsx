"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { toast } from "sonner"

import type { CalAmount } from "@/db/schema/cal-amount"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CalAmountFormDialog } from "@/components/cal-amount-form-dialog"
import { CalAmountUploadDialog } from "@/components/cal-amount-upload-dialog"
import {
  deleteCalAmount,
  deleteCalAmountMany,
} from "@/lib/cal-amount/actions"

/** 업로드 중 화면 상단에 라이브로 유지할 최대 행 수 (DOM 폭증 방지). 나머지는 refresh 후 페이지네이션이 담당. */
const LIVE_PREPEND_CAP = 200

type Props = {
  initialRows: CalAmount[]
  total: number
  page: number
  pageSize: number
  search: string
}

const koInt = new Intl.NumberFormat("ko-KR")

function formatKRW(value: number): string {
  return koInt.format(value)
}

function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return "-"
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mi = String(date.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export function CalAmountListClient({
  initialRows,
  total,
  page,
  pageSize,
  search,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 검색 input 로컬 상태 (debounce 적용)
  const [searchInput, setSearchInput] = React.useState(search)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setSearchInput(search)
  }, [search])

  // 검색 debounce 300ms
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (searchInput === search) return
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString())
      if (searchInput.trim().length > 0) {
        next.set("q", searchInput.trim())
      } else {
        next.delete("q")
      }
      next.delete("page")
      startTransition(() => {
        router.replace(`/cal-amount?${next.toString()}`)
      })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search, router])

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(searchParams.toString())
    if (nextPage <= 1) {
      next.delete("page")
    } else {
      next.set("page", String(nextPage))
    }
    startTransition(() => {
      router.replace(`/cal-amount?${next.toString()}`)
    })
  }

  function clearSearch() {
    setSearchInput("")
  }

  // Add Dialog 상태 (append-only이라 edit 없음)
  const [addOpen, setAddOpen] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<CalAmount | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  // 체크박스 일괄 선택/삭제 상태. key = String(row.id).
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = React.useState(false)

  // 업로드 실시간 점진 반영용 오버레이 행 (id 내림차순, 최신이 위).
  // 청크가 INSERT 될 때마다 상단에 prepend 한다.
  const [uploadedRows, setUploadedRows] = React.useState<CalAmount[]>([])

  // router.refresh() 로 서버가 새 initialRows 를 내려주면(=업로드분 포함) 오버레이를 비운다.
  // initialRows 참조가 바뀔 때만 발동 → 갱신 직후 seamless 핸드오프.
  React.useEffect(() => {
    setUploadedRows([])
    setRowSelection({})
  }, [initialRows])

  // 선택된 행 id 목록 (선택 = value true).
  const selectedIds = React.useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, v]) => v)
        .map(([k]) => Number(k))
        .filter((n) => Number.isInteger(n) && n > 0),
    [rowSelection],
  )

  function handleRowsInserted(rows: CalAmount[]) {
    // rows 는 해당 청크의 id 내림차순. 뒤 청크일수록 id 가 크므로 항상 상단에 prepend.
    setUploadedRows((prev) => [...rows, ...prev].slice(0, LIVE_PREPEND_CAP))
  }

  function handleUploadDone() {
    startTransition(() => {
      router.refresh()
    })
  }

  // 화면 표시 행 = 업로드 오버레이(상단) + 서버 행. 업로드분은 새 id 라 중복 없음.
  const displayRows = React.useMemo(
    () =>
      uploadedRows.length > 0
        ? [...uploadedRows, ...initialRows]
        : initialRows,
    [uploadedRows, initialRows],
  )

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteCalAmount(deleteTarget.id)
      toast.success(`삭제됨: ${deleteTarget.productCode}`)
      setDeleteTarget(null)
      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(`삭제 실패: ${message}`)
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.length === 0) return
    setIsBulkDeleting(true)
    try {
      const count = await deleteCalAmountMany(selectedIds)
      toast.success(`${koInt.format(count)}건 삭제됨`)
      setBulkDeleteOpen(false)
      setRowSelection({})
      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(`일괄 삭제 실패: ${message}`)
    } finally {
      setIsBulkDeleting(false)
    }
  }

  function handleSaved() {
    startTransition(() => {
      router.refresh()
    })
  }

  // TanStack 컬럼 정의 — 선택 + 상품코드 + 후정산금 + 추가일 + 삭제
  const columns = React.useMemo<ColumnDef<CalAmount>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => (
          <div className="flex items-center justify-start">
            <Checkbox
              checked={table.getIsAllPageRowsSelected()}
              indeterminate={
                table.getIsSomePageRowsSelected() &&
                !table.getIsAllPageRowsSelected()
              }
              onCheckedChange={(checked) =>
                table.toggleAllPageRowsSelected(!!checked)
              }
              aria-label="이 페이지 전체 선택"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex items-center justify-start">
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(!!checked)}
              aria-label={`${row.original.productCode} 선택`}
            />
          </div>
        ),
      },
      {
        accessorKey: "productCode",
        header: "상품코드",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block truncate font-mono text-xs">
            {row.original.productCode}
          </span>
        ),
      },
      {
        accessorKey: "extraSettlement",
        header: "후정산금",
        enableSorting: true,
        sortingFn: "basic",
        cell: ({ row }) => {
          const v = row.original.extraSettlement
          return (
            <span
              className={`block text-left tabular-nums ${
                v < 0 ? "text-negative" : ""
              }`}
            >
              {formatKRW(v)}
            </span>
          )
        },
      },
      {
        accessorKey: "createdAt",
        header: "추가일",
        enableSorting: true,
        sortingFn: "datetime",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">삭제</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex items-center justify-end">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${r.productCode} (id ${r.id}) 삭제`}
                onClick={() => setDeleteTarget(r)}
              >
                <Trash2Icon />
              </Button>
            </div>
          )
        },
      },
    ],
    [],
  )

  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data: displayRows,
    columns,
    state: { sorting, rowSelection },
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">후정산금 관리</h1>
          <p className="text-sm text-muted-foreground">
            상품코드별 후정산금 이력입니다. 같은 상품코드가 다시 추가되면
            최상단(최신)의 값이 분석 시 계산에 사용됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <UploadIcon />
            엑셀 업로드
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon />
            추가
          </Button>
        </div>
      </header>

      <Alert>
        <AlertTitle>
          {total > 0
            ? `등록된 이력 ${koInt.format(total)}건`
            : "아직 등록된 후정산금이 없습니다"}
        </AlertTitle>
        <AlertDescription>
          최신 데이터가 최상단에 표시됩니다. 같은 상품코드가 다시 추가되면
          최상단(최신)의 값이 분석 시 계산에 사용됩니다. 엑셀로 대량
          추가하려면 「엑셀 업로드」를 사용하세요.
        </AlertDescription>
      </Alert>

      {/* 검색 */}
      <div className="relative max-w-md">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="상품코드 검색"
          className="pl-8 pr-8"
          aria-label="상품코드 검색"
        />
        {searchInput.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={clearSearch}
            aria-label="검색어 지우기"
          >
            <XIcon />
          </Button>
        )}
      </div>

      {/* 선택 일괄 삭제 툴바 */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">
            {koInt.format(selectedIds.length)}건 선택됨
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRowSelection({})}
            >
              선택 해제
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2Icon />
              선택 삭제 ({koInt.format(selectedIds.length)})
            </Button>
          </div>
        </div>
      )}

      {/* 테이블 + 빈상태 분기 */}
      <div className="rounded-md border">
        {displayRows.length === 0 ? (
          <div className="border-dashed p-12 text-center text-sm text-muted-foreground">
            {search ? (
              <>
                <p>조건에 맞는 항목이 없습니다.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={clearSearch}
                >
                  검색 초기화
                </Button>
              </>
            ) : (
              <>
                <p>등록된 후정산금이 없습니다.</p>
                <Button
                  variant="default"
                  size="sm"
                  className="mt-3"
                  onClick={() => setAddOpen(true)}
                >
                  <PlusIcon /> 추가
                </Button>
              </>
            )}
          </div>
        ) : (
          <Table className="table-fixed">
            <colgroup>
              <col style={{ width: "48px" }} />
              <col style={{ width: "260px" }} />
              <col style={{ width: "160px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "auto" }} />
            </colgroup>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort()
                    const sorted = h.column.getIsSorted()
                    const ariaSort: "ascending" | "descending" | "none" =
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                    return (
                      <TableHead
                        key={h.id}
                        aria-sort={canSort ? ariaSort : undefined}
                        className={
                          canSort
                            ? "cursor-pointer select-none hover:text-foreground"
                            : undefined
                        }
                        onClick={
                          canSort
                            ? h.column.getToggleSortingHandler()
                            : undefined
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext(),
                          )}
                          {canSort &&
                            (sorted === "asc"
                              ? " ▲"
                              : sorted === "desc"
                                ? " ▼"
                                : "")}
                        </span>
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
          <div className="text-sm text-muted-foreground">
            {koInt.format(total)}건 중 {start}–{end}
            {isPending && <span className="ml-2 text-xs">불러오는 중…</span>}
          </div>
          <PageNav
            page={page}
            totalPages={totalPages}
            onGo={goToPage}
            disabled={isPending}
          />
        </div>
      )}

      {/* 추가 Dialog */}
      <CalAmountFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={handleSaved}
      />

      {/* 엑셀 대량 업로드 Dialog */}
      <CalAmountUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onRowsInserted={handleRowsInserted}
        onDone={handleUploadDone}
      />

      {/* 삭제 확인 Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>삭제 확인</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  &quot;{deleteTarget.productCode}&quot; (이력 id{" "}
                  {deleteTarget.id}, {formatKRW(deleteTarget.extraSettlement)}원)
                  을(를) 삭제하시겠습니까?
                  <br />
                  같은 상품코드의 다른 이력 행은 영향 없습니다. 이 행이 최신
                  값이었다면 그 다음 행이 분석 시 계산에 사용됩니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              aria-label="삭제 확정"
            >
              {isDeleting ? "삭제 중…" : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 일괄 삭제 확인 Dialog */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (isBulkDeleting) return
          setBulkDeleteOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>선택 삭제 확인</DialogTitle>
            <DialogDescription>
              선택한 {koInt.format(selectedIds.length)}건의 이력을
              삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다. 삭제된 행이 어떤 상품코드의 최신
              값이었다면 그 다음 행이 분석 시 계산에 사용됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={isBulkDeleting}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              aria-label="선택 삭제 확정"
            >
              {isBulkDeleting
                ? "삭제 중…"
                : `${koInt.format(selectedIds.length)}건 삭제`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PageNav({
  page,
  totalPages,
  onGo,
  disabled,
}: {
  page: number
  totalPages: number
  onGo: (p: number) => void
  disabled: boolean
}) {
  const window = pageWindow(page, totalPages)

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onGo(page - 1)}
        disabled={disabled || page <= 1}
        aria-label="이전 페이지"
      >
        <ChevronLeftIcon />
      </Button>

      {window.map((it, i) =>
        it === "…" ? (
          <span
            key={`ellipsis-${i}`}
            aria-hidden="true"
            className="px-1 text-sm text-muted-foreground"
          >
            …
          </span>
        ) : (
          <Button
            key={it}
            variant={it === page ? "default" : "outline"}
            size="sm"
            onClick={() => onGo(it)}
            disabled={disabled}
            aria-current={it === page ? "page" : undefined}
            aria-label={`${it} 페이지로 이동`}
          >
            {it}
          </Button>
        ),
      )}

      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onGo(page + 1)}
        disabled={disabled || page >= totalPages}
        aria-label="다음 페이지"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

function pageWindow(page: number, totalPages: number): (number | "…")[] {
  const out: (number | "…")[] = []
  const around = 1
  const pages = new Set<number>()
  pages.add(1)
  pages.add(totalPages)
  for (let p = page - around; p <= page + around; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p)
  }
  const sorted = Array.from(pages).sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    if (i > 0 && cur - sorted[i - 1] > 1) out.push("…")
    out.push(cur)
  }
  return out
}

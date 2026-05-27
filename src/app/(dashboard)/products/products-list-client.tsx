"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import * as XLSX from "xlsx"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  ProductFormDialog,
  type ProductFormGroup,
} from "@/components/product-form-dialog"
import { ProductImportDialog } from "@/components/product-import-dialog"
import {
  deleteProduct,
  getProductsBySabangnet,
  type ProductRow,
} from "@/lib/products/actions"
import type { ProductSortKey } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

type TypeFilter = "all" | "single" | "composite"

type Props = {
  initialRows: ProductRow[]
  total: number
  page: number
  pageSize: number
  search: string
  channels: string[]
  typeFilter: TypeFilter
  sort: ProductSortKey
  dir: "asc" | "desc"
  /** product_channels 마스터 (양식/폼 옵션) */
  channelOptions: string[]
  /** 필터용 채널 옵션 (마스터 + 실제 product_master DISTINCT 의 union) */
  filterChannelOptions: string[]
}

const koInt = new Intl.NumberFormat("ko-KR")

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

export function ProductsListClient({
  initialRows,
  total,
  page,
  pageSize,
  search,
  channels,
  typeFilter,
  sort,
  dir,
  channelOptions,
  filterChannelOptions,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 검색 input 로컬 상태 (debounce 적용)
  const [searchInput, setSearchInput] = React.useState(search)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setSearchInput(search)
  }, [search])

  function buildUrl(mutate: (params: URLSearchParams) => void): string {
    const next = new URLSearchParams(searchParams.toString())
    mutate(next)
    const qs = next.toString()
    return qs.length > 0 ? `/products?${qs}` : "/products"
  }

  // 검색 debounce 300ms
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (searchInput === search) return
    debounceRef.current = setTimeout(() => {
      const url = buildUrl((next) => {
        if (searchInput.trim().length > 0) {
          next.set("q", searchInput.trim())
        } else {
          next.delete("q")
        }
        next.delete("page")
      })
      startTransition(() => {
        router.replace(url)
      })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search, router])

  function goToPage(nextPage: number) {
    const url = buildUrl((next) => {
      if (nextPage <= 1) next.delete("page")
      else next.set("page", String(nextPage))
    })
    startTransition(() => {
      router.replace(url)
    })
  }

  function setChannels(nextChannels: string[]) {
    const url = buildUrl((next) => {
      if (nextChannels.length === 0) next.delete("channel")
      else next.set("channel", nextChannels.join(","))
      next.delete("page")
    })
    startTransition(() => {
      router.replace(url)
    })
  }

  function setTypeFilterUrl(t: TypeFilter) {
    const url = buildUrl((next) => {
      if (t === "all") next.delete("type")
      else next.set("type", t)
      next.delete("page")
    })
    startTransition(() => {
      router.replace(url)
    })
  }

  function setSortUrl(nextSort: ProductSortKey) {
    const url = buildUrl((next) => {
      const sameCol = nextSort === sort
      const nextDir: "asc" | "desc" = sameCol
        ? dir === "asc"
          ? "desc"
          : "asc"
        : "asc"
      next.set("sort", nextSort)
      next.set("dir", nextDir)
      next.delete("page")
    })
    startTransition(() => {
      router.replace(url)
    })
  }

  function clearSearch() {
    setSearchInput("")
  }

  function clearAllFilters() {
    setSearchInput("")
    const url = buildUrl((next) => {
      next.delete("q")
      next.delete("channel")
      next.delete("type")
      next.delete("page")
      next.delete("sort")
      next.delete("dir")
    })
    startTransition(() => {
      router.replace(url)
    })
  }

  // Add / Edit / Delete / Import Dialog 상태
  const [addOpen, setAddOpen] = React.useState(false)
  const [editGroup, setEditGroup] = React.useState<ProductFormGroup | null>(null)
  const [editLoading, setEditLoading] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProductRow | null>(
    null,
  )
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  async function openEditForRow(r: ProductRow) {
    setEditLoading(true)
    try {
      const rows = await getProductsBySabangnet(r.sabangnetCode)
      if (rows.length === 0) {
        toast.error("이 사방넷의 데이터가 사라졌습니다 (다른 사용자가 삭제?). 새로고침 후 다시 시도하세요.")
        return
      }
      // 그룹의 메타는 첫 행 기준 (saveProductGroup 가 전체 행에 동일 메타 적용)
      const head = rows[0]
      setEditGroup({
        sabangnetCode: head.sabangnetCode,
        brandName: head.brandName,
        productName: head.productName,
        isComposite: head.isComposite,
        rows: rows.map((row) => ({
          id: row.id,
          channelName: row.channelName,
          productCode: row.productCode,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(`로드 실패: ${message}`)
    } finally {
      setEditLoading(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteProduct(deleteTarget.id)
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

  function handleSaved() {
    startTransition(() => {
      router.refresh()
    })
  }

  function downloadTemplate() {
    // v1.2 Wide format: 4 고정 + 등록 채널 헤더들
    const data = buildWideTemplateRows(channelOptions)
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    XLSX.writeFile(wb, `products_template_${todayYMD()}.xlsx`)
  }

  // TanStack 컬럼 정의 — v1.1: 사방넷·브랜드·채널·상품코드·상품명·구분·등록일·actions
  const columns = React.useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: "sabangnetCode",
        header: "사방넷코드",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block min-w-[8rem] font-mono text-xs">
            {row.original.sabangnetCode}
          </span>
        ),
      },
      {
        accessorKey: "brandName",
        header: "브랜드",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block max-w-[10rem] truncate"
            title={row.original.brandName}
          >
            {row.original.brandName}
          </span>
        ),
      },
      {
        accessorKey: "channelName",
        header: "채널명",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block max-w-[14rem] truncate"
            title={row.original.channelName}
          >
            {row.original.channelName}
          </span>
        ),
      },
      {
        accessorKey: "productCode",
        header: "상품코드",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block min-w-[8rem] font-mono text-xs">
            {row.original.productCode}
          </span>
        ),
      },
      {
        accessorKey: "productName",
        header: "상품명",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block max-w-[16rem] truncate"
            title={row.original.productName}
          >
            {row.original.productName}
          </span>
        ),
      },
      {
        accessorKey: "isComposite",
        header: () => <span className="block text-center">구분</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex justify-center">
            {row.original.isComposite ? (
              <Badge variant="default">복합</Badge>
            ) : (
              <Badge variant="secondary">단품</Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: () => <span className="block text-right">등록일</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-muted-foreground">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">액션</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${r.productCode} 수정`}
                onClick={() => void openEditForRow(r)}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${r.productCode} 삭제`}
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

  // 정렬 헤더 라벨 매핑 — 표 외부에서 정렬 가능 컬럼만 표시
  const sortableHeaders: { key: ProductSortKey; label: string }[] = [
    { key: "sabangnetCode", label: "사방넷코드" },
    { key: "brandName", label: "브랜드" },
    { key: "channelName", label: "채널명" },
    { key: "productCode", label: "상품코드" },
    { key: "isComposite", label: "구분" },
    { key: "createdAt", label: "등록일" },
  ]

  const [sorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data: initialRows,
    columns,
    state: { sorting },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  // 필터 active 여부 (페이지/정렬은 제외)
  const hasFilters =
    search.length > 0 ||
    channels.length > 0 ||
    typeFilter !== "all"

  // 검색 결과 0건 분기 (initialRows 비었지만 필터/검색 적용 중일 때)
  const isEmptyFiltered = initialRows.length === 0 && hasFilters
  const isEmptyTotal = initialRows.length === 0 && !hasFilters && page === 1

  return (
    <div className="space-y-6">
      {/* 액션 바 (헤더는 page-level 탭 wrapper 에서 표시) */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={downloadTemplate}>
          <DownloadIcon />
          양식 다운로드
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <UploadIcon />
          엑셀 import
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon />
          추가
        </Button>
      </div>

      {/* 안내 카드 */}
      <Alert>
        <AlertTitle>
          {total > 0
            ? `등록된 상품 ${koInt.format(total)}건 · 채널 ${channelOptions.length}개`
            : "아직 등록된 상품이 없습니다"}
        </AlertTitle>
        <AlertDescription>
          한 사방넷코드가 여러 채널에 등록될 수 있습니다 (Wide 양식). 행 클릭
          시 그 사방넷의 모든 채널 행을 한 번에 편집합니다. 상품코드는 시스템
          전체에서 고유(UNIQUE)입니다.
        </AlertDescription>
      </Alert>

      {/* 검색 / 필터 */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative max-w-md flex-1">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="사방넷코드 / 상품코드 / 상품명 / 브랜드 / 채널 검색"
              className="pl-8 pr-8"
              aria-label="상품 검색"
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

          <div className="flex flex-wrap items-center gap-2">
            <ChannelFilter
              options={filterChannelOptions}
              selected={new Set(channels)}
              onChange={(set) => setChannels(Array.from(set))}
            />
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilterUrl(v as TypeFilter)}
            >
              <SelectTrigger aria-label="구분 필터" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="single">단품만</SelectItem>
                <SelectItem value="composite">복합만</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* chip 영역 */}
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">적용된 필터:</span>
            {search.length > 0 && (
              <Badge variant="secondary" className="gap-1 pr-1">
                검색: {search}
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="검색어 필터 해제"
                  className="ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            )}
            {channels.map((ch) => (
              <Badge key={ch} variant="secondary" className="gap-1 pr-1">
                채널: {ch}
                <button
                  type="button"
                  onClick={() =>
                    setChannels(channels.filter((c) => c !== ch))
                  }
                  aria-label={`채널 필터 ${ch} 해제`}
                  className="ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            {typeFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 pr-1">
                구분: {typeFilter === "single" ? "단품만" : "복합만"}
                <button
                  type="button"
                  onClick={() => setTypeFilterUrl("all")}
                  aria-label="구분 필터 해제"
                  className="ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="text-xs"
            >
              모두 초기화
            </Button>
          </div>
        )}

        {/* 정렬 헤더 (간단 toolbar) */}
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>정렬:</span>
          {sortableHeaders.map((h) => {
            const active = h.key === sort
            return (
              <Button
                key={h.key}
                type="button"
                variant={active ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSortUrl(h.key)}
                aria-pressed={active}
                aria-label={`${h.label} 기준 정렬`}
                className="h-7 text-xs"
              >
                {h.label}
                {active && (dir === "asc" ? " ▲" : " ▼")}
              </Button>
            )
          })}
        </div>
      </section>

      {/* 테이블 + 빈상태 */}
      <div className="rounded-md border">
        {isEmptyTotal ? (
          <div className="space-y-3 border-dashed p-12 text-center text-sm text-muted-foreground">
            <p className="text-base">아직 등록된 상품이 없습니다</p>
            <p>
              초기 등록은 엑셀 import 가 빠릅니다. 양식을 다운받아 작성한 뒤
              업로드하세요.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <DownloadIcon />
                양식 다운로드
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <UploadIcon />
                엑셀 import
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <PlusIcon />
                한 건만 추가하기
              </Button>
            </div>
          </div>
        ) : isEmptyFiltered ? (
          <div className="space-y-3 border-dashed p-12 text-center text-sm text-muted-foreground">
            <p>조건에 맞는 상품이 없습니다.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {search && (
                <Button variant="outline" size="sm" onClick={clearSearch}>
                  검색 초기화
                </Button>
              )}
              {(channels.length > 0 || typeFilter !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setChannels([])
                    setTypeFilterUrl("all")
                  }}
                >
                  필터 초기화
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} className="whitespace-nowrap">
                        {flexRender(
                          h.column.columnDef.header,
                          h.getContext(),
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(
                      "transition-colors hover:bg-muted/40",
                    )}
                  >
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
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && initialRows.length > 0 && (
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
      <ProductFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
        channelOptions={channelOptions}
        onSaved={handleSaved}
      />

      {/* 수정 Dialog (사방넷 그룹 전체 로드) */}
      <ProductFormDialog
        open={editGroup != null}
        onOpenChange={(o) => {
          if (!o) setEditGroup(null)
        }}
        mode="edit"
        initialGroup={editGroup}
        channelOptions={channelOptions}
        onSaved={() => {
          setEditGroup(null)
          handleSaved()
        }}
      />

      {/* Import Dialog */}
      <ProductImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        channelOptions={channelOptions}
        onSaved={handleSaved}
      />

      {/* 그룹 로드 중 토스트 */}
      {editLoading && (
        <span aria-live="polite" className="sr-only">
          상품 그룹 로드 중…
        </span>
      )}

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
                  사방넷 {deleteTarget.sabangnetCode} · 채널 &quot;
                  {deleteTarget.channelName}&quot; · 상품코드 &quot;
                  {deleteTarget.productCode}&quot; 한 행만 삭제됩니다.
                  <br />
                  같은 사방넷의 다른 채널 행은 유지됩니다. 이 상품은 해당 채널의
                  마이너스 분석 단품/복합 매칭에서 제외됩니다.
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
    </div>
  )
}

/* ============================================================
 * ChannelFilter — Popover + Command (다중 선택)
 * ============================================================ */

function ChannelFilter({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = React.useState(false)
  const total = options.length
  const selectedCount = selected.size

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  function clearAll() {
    onChange(new Set())
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`채널 필터 — 현재 ${selectedCount === 0 ? "전체" : `${selectedCount}개 선택`}`}
          >
            채널
            {selectedCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {selectedCount}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder={`${total}개 채널 검색...`}
            aria-label="채널 검색"
          />
          <div className="flex items-center justify-between border-b px-2 py-1 text-xs">
            <span className="text-muted-foreground">
              {selectedCount === 0
                ? `전체 (${total})`
                : `${selectedCount}/${total} 선택`}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="rounded px-1.5 py-0.5 hover:bg-accent"
            >
              해제
            </button>
          </div>
          <CommandList>
            <CommandEmpty>일치하는 채널이 없습니다.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isChecked = selected.has(opt)
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => toggle(opt)}
                    className="flex items-center gap-2"
                  >
                    <Checkbox
                      checked={isChecked}
                      aria-label={`${opt} 선택`}
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
                    <span className="flex-1 truncate" title={opt}>
                      {opt}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/* ============================================================
 * Pagination
 * ============================================================ */

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
  const w = pageWindow(page, totalPages)
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
      {w.map((it, i) =>
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

function todayYMD(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/**
 * Wide format 양식: 4 고정 헤더 + 채널 헤더 + 예시 1~2행.
 * 채널 옵션이 비어있어도 4 고정 + 빈 채널열 1개를 보장.
 */
export function buildWideTemplateRows(channelOptions: string[]): unknown[][] {
  const channels = channelOptions.length > 0 ? channelOptions : ["GSshop"]
  const header = ["사방넷코드", "브랜드명", "상품명", "구분", ...channels]
  // 예시 1행: 첫 두 채널만 채워 wide 사용 패턴 시연
  const example1: unknown[] = ["SBG-1001", "글리치", "워시팩", "단품"]
  for (let i = 0; i < channels.length; i++) {
    example1.push(i === 0 ? "ABC-001" : i === 1 ? "ABC-001-CP" : "")
  }
  const example2: unknown[] = ["SBG-1002", "글리치", "세트A", "복합"]
  for (let i = 0; i < channels.length; i++) {
    example2.push(i === 1 ? "ABC-002-CP" : i === 2 ? "ABC-002-OH" : "")
  }
  return [header, example1, example2]
}

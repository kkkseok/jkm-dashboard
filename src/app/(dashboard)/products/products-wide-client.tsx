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
import * as XLSX from "xlsx"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollSyncContainer } from "@/components/scroll-sync"
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
  type ProductWideRow,
} from "@/lib/products/actions"
import type { ProductWideSortKey } from "@/lib/products/schema"
import { ProductsViewToggle } from "./products-view-toggle"
import { buildWideTemplateRows } from "./products-list-client"

type TypeFilter = "all" | "single" | "composite"

type Props = {
  initialRows: ProductWideRow[]
  total: number
  page: number
  pageSize: number
  search: string
  /** 컬럼 visibility (Wide) — 표시할 채널명만. 빈 배열 = 전체 표시 */
  visibleChannels: string[]
  typeFilter: TypeFilter
  sort: ProductWideSortKey
  dir: "asc" | "desc"
  /** product_channels 마스터 — 표 컬럼 헤더 + 양식 옵션 */
  channelOptions: string[]
  /** 필터 UI 에서 보여줄 채널 옵션 (마스터 + product_master DISTINCT union) */
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

export function ProductsWideClient({
  initialRows,
  total,
  page,
  pageSize,
  search,
  visibleChannels,
  typeFilter,
  sort,
  dir,
  channelOptions,
  filterChannelOptions,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

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

  function setVisibleChannels(nextChannels: string[]) {
    const url = buildUrl((next) => {
      if (nextChannels.length === 0) next.delete("channel")
      else next.set("channel", nextChannels.join(","))
      // 컬럼 visibility 만 바꾸므로 페이지는 유지
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

  function setSortUrl(nextSort: ProductWideSortKey) {
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

  // Dialog 상태
  const [addOpen, setAddOpen] = React.useState(false)
  const [editGroup, setEditGroup] = React.useState<ProductFormGroup | null>(null)
  const [editLoading, setEditLoading] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<{
    sabangnetCode: string
    productName: string
    rowCount: number
  } | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  async function openEditForSabangnet(sabangnetCode: string) {
    setEditLoading(true)
    try {
      const rows = await getProductsBySabangnet(sabangnetCode)
      if (rows.length === 0) {
        toast.error(
          "이 사방넷의 데이터가 사라졌습니다 (다른 사용자가 삭제?). 새로고침 후 다시 시도하세요.",
        )
        return
      }
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

  // Wide 의 삭제는 그룹 전체 (사방넷의 모든 채널 행) 삭제로 정의.
  // 채널별 단건 삭제가 필요하면 상세(detail) view 또는 그룹 편집 Dialog 에서.
  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const rows = await getProductsBySabangnet(deleteTarget.sabangnetCode)
      let deleted = 0
      for (const r of rows) {
        try {
          await deleteProduct(r.id)
          deleted += 1
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          toast.error(`삭제 실패 (${r.channelName}): ${message}`)
        }
      }
      if (deleted > 0) {
        toast.success(
          `삭제됨: ${deleteTarget.sabangnetCode} (${deleted}건 채널 행)`,
        )
      }
      setDeleteTarget(null)
      startTransition(() => {
        router.refresh()
      })
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
    const data = buildWideTemplateRows(channelOptions)
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    XLSX.writeFile(wb, `products_template_${todayYMD()}.xlsx`)
  }

  // 컬럼 visibility 적용된 채널 리스트.
  // visibleChannels 비어있으면 마스터 전체 노출.
  const shownChannels =
    visibleChannels.length === 0
      ? channelOptions
      : channelOptions.filter((ch) => visibleChannels.includes(ch))

  const sortableHeaders: { key: ProductWideSortKey; label: string }[] = [
    { key: "sabangnetCode", label: "사방넷코드" },
    { key: "brandName", label: "브랜드" },
    { key: "productName", label: "상품명" },
    { key: "isComposite", label: "구분" },
    { key: "createdAt", label: "등록일" },
  ]

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const hasFilters =
    search.length > 0 ||
    visibleChannels.length > 0 ||
    typeFilter !== "all"

  const isEmptyFiltered = initialRows.length === 0 && hasFilters
  const isEmptyTotal = initialRows.length === 0 && !hasFilters && page === 1

  return (
    <div className="space-y-6">
      {/* 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ProductsViewToggle current="wide" />
        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {/* 안내 카드 */}
      <Alert>
        <AlertTitle>
          {total > 0
            ? `등록된 사방넷 ${koInt.format(total)}건 · 채널 ${channelOptions.length}개`
            : "아직 등록된 상품이 없습니다"}
        </AlertTitle>
        <AlertDescription>
          엑셀 입력 양식과 동일한 가로 펼침 view 입니다. 한 행 = 한 사방넷코드,
          각 채널 컬럼에 그 채널의 상품코드가 표시됩니다. 빈 셀(—)은 해당 채널에
          미등록. 행 또는 셀 클릭 시 그 사방넷의 모든 채널을 한 번에 편집합니다.
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
            <ChannelVisibilityFilter
              options={filterChannelOptions}
              selected={new Set(visibleChannels)}
              onChange={(set) => setVisibleChannels(Array.from(set))}
            />
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilterUrl(v as TypeFilter)}
            >
              <SelectTrigger aria-label="구분 필터" className="w-32">
                {/* raw value(all/single/composite) 노출 방지 — 한글 라벨로 매핑 */}
                <SelectValue>
                  {(v) =>
                    v === "single" ? "단품만" : v === "composite" ? "복합만" : "전체"
                  }
                </SelectValue>
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
            {visibleChannels.map((ch) => (
              <Badge key={ch} variant="secondary" className="gap-1 pr-1">
                표시 채널: {ch}
                <button
                  type="button"
                  onClick={() =>
                    setVisibleChannels(visibleChannels.filter((c) => c !== ch))
                  }
                  aria-label={`표시 채널 ${ch} 해제`}
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

        {/* 정렬 헤더 */}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
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
              {(visibleChannels.length > 0 || typeFilter !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setVisibleChannels([])
                    setTypeFilterUrl("all")
                  }}
                >
                  필터 초기화
                </Button>
              )}
            </div>
          </div>
        ) : (
          <ScrollSyncContainer>
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 whitespace-nowrap bg-background">
                    사방넷코드
                  </TableHead>
                  <TableHead className="whitespace-nowrap">브랜드</TableHead>
                  <TableHead className="whitespace-nowrap">상품명</TableHead>
                  <TableHead className="whitespace-nowrap text-center">
                    구분
                  </TableHead>
                  {shownChannels.map((ch) => (
                    <TableHead
                      key={ch}
                      className="whitespace-nowrap text-xs"
                      title={ch}
                    >
                      {ch}
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap text-right">
                    등록일
                  </TableHead>
                  <TableHead className="whitespace-nowrap">
                    <span className="sr-only">액션</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialRows.map((r) => (
                  <TableRow
                    key={r.sabangnetCode}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                    onClick={() => void openEditForSabangnet(r.sabangnetCode)}
                  >
                    <TableCell className="sticky left-0 z-10 bg-background font-mono text-xs">
                      {r.sabangnetCode}
                    </TableCell>
                    <TableCell
                      className="max-w-[10rem] truncate"
                      title={r.brandName}
                    >
                      {r.brandName}
                    </TableCell>
                    <TableCell
                      className="max-w-[16rem] truncate"
                      title={r.productName}
                    >
                      {r.productName}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.isComposite ? (
                        <Badge variant="default">복합</Badge>
                      ) : (
                        <Badge variant="secondary">단품</Badge>
                      )}
                    </TableCell>
                    {shownChannels.map((ch) => {
                      const cell = r.channels[ch]
                      return (
                        <TableCell
                          key={ch}
                          className="font-mono text-xs"
                          title={cell ? cell.productCode : `${ch} 미등록`}
                        >
                          {cell ? (
                            cell.productCode
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )
                    })}
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${r.sabangnetCode} 수정`}
                          onClick={() =>
                            void openEditForSabangnet(r.sabangnetCode)
                          }
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${r.sabangnetCode} 삭제`}
                          onClick={() =>
                            setDeleteTarget({
                              sabangnetCode: r.sabangnetCode,
                              productName: r.productName,
                              rowCount: Object.keys(r.channels).length,
                            })
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollSyncContainer>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && initialRows.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
          <div className="text-sm text-muted-foreground">
            사방넷 {koInt.format(total)}건 중 {start}–{end}
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

      {/* 수정 Dialog */}
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

      {editLoading && (
        <span aria-live="polite" className="sr-only">
          상품 그룹 로드 중…
        </span>
      )}

      {/* 삭제 확인 Dialog (그룹 전체 삭제) */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>그룹 삭제 확인</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  사방넷 <strong>{deleteTarget.sabangnetCode}</strong> (
                  {deleteTarget.productName}) 의 <strong>모든 채널 행 {deleteTarget.rowCount}건</strong>
                  이 삭제됩니다.
                  <br />
                  이 상품은 모든 채널의 마이너스 분석 단품/복합 매칭에서
                  제외됩니다. 한 채널만 지우려면 상세(detail) view 또는 편집
                  Dialog 에서 해당 채널을 삭제하세요.
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
              aria-label="그룹 삭제 확정"
            >
              {isDeleting ? "삭제 중…" : "그룹 삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ============================================================
 * ChannelVisibilityFilter — Wide view 의 채널 컬럼 표시/숨김
 * ============================================================ */

function ChannelVisibilityFilter({
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
            aria-label={`표시 채널 — 현재 ${selectedCount === 0 ? "전체" : `${selectedCount}개`}`}
          >
            표시 채널
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
                ? `전체 표시 (${total})`
                : `${selectedCount}/${total} 표시`}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="rounded px-1.5 py-0.5 hover:bg-accent"
            >
              전체로
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
                      aria-label={`${opt} 표시 전환`}
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
 * Pagination (detail view 와 동일 로직 — 사방넷 단위로 계산만 다름)
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

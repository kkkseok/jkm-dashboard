"use client"

import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
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
import { CalAmountFormDialog } from "@/components/cal-amount-form-dialog"
import { computeProfit } from "@/lib/minus/calc"
import { enrichMinusData } from "@/lib/minus/pipeline"
import type { EnrichedRow, PipelineDiagnostics } from "@/lib/minus/types"
import { getCalAmountMap } from "@/lib/cal-amount/actions"
import { cn } from "@/lib/utils"

/* ============================================================
 * 상수/유틸
 * ============================================================ */

const PAGE_SIZE = 100
const koInt = new Intl.NumberFormat("ko-KR")

/** 한글 깨짐 방지 — UTF-8 BOM */
const UTF8_BOM = "﻿"

/** 명세 §4-3 "기본 가시성: 표시" 16개 컬럼 (v1.3 — 브랜드명 추가) — CSV 도 이 순서/라벨을 따른다. */
const CSV_HEADERS: ReadonlyArray<readonly [keyof EnrichedRow, string]> = [
  ["salesDate", "매출일"],
  ["onlineOrderNo", "온라인주문번호"],
  ["productCode", "상품코드"],
  ["productName", "상품명"],
  ["brandName", "브랜드명"],
  ["K", "매출액"],
  ["L", "공급가"],
  ["R", "이익액"],
  ["Q", "물류비"],
  ["finalProfit", "최종이익액"],
  ["finalProfitRate", "최종이익률"],
  ["commissionRate", "수수료"],
  ["settlementAmount", "후정산금"],
  ["extraSettlement", "추가후정산금"],
  ["totalMargin", "총마진액"],
  ["totalMarginRate", "총마진율"],
]

function formatInt(v: number | null): string {
  if (v == null) return "-"
  return koInt.format(Math.round(v))
}

function formatPercent(v: number | null): string {
  if (v == null) return "-"
  return `${(v * 100).toFixed(1)}%`
}

function todayYMD(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/* ============================================================
 * 메인 컴포넌트
 * ============================================================ */

type AnalyzeStep =
  | { kind: "idle" }
  | { kind: "running"; message: string }
  | { kind: "done" }
  | { kind: "error"; message: string }

type RowWithId = EnrichedRow & { _rowId: number }

export function MinusAnalyzeClient() {
  // 업로드 슬롯
  const [salesFile, setSalesFile] = React.useState<File | null>(null)
  const [revenueFile, setRevenueFile] = React.useState<File | null>(null)
  const [salesError, setSalesError] = React.useState<string | null>(null)
  const [revenueError, setRevenueError] = React.useState<string | null>(null)

  // 재업로드 충돌 Dialog
  type PendingFile = { slot: "sales" | "revenue"; file: File } | null
  const [reuploadPending, setReuploadPending] =
    React.useState<PendingFile>(null)

  // 분석 상태
  const [step, setStep] = React.useState<AnalyzeStep>({ kind: "idle" })
  const [rows, setRows] = React.useState<RowWithId[] | null>(null)
  const [diagnostics, setDiagnostics] =
    React.useState<PipelineDiagnostics | null>(null)
  const [analyzedFileNames, setAnalyzedFileNames] = React.useState<{
    sales: string
    revenue: string
  } | null>(null)
  const [analyzedAt, setAnalyzedAt] = React.useState<Date | null>(null)

  // cal_amount Map 은 분석 시작 시점에 한 번만 fresh fetch 해서 enrichMinusData 에 주입.
  // 그 이후의 셀 저장은 rows state 의 각 행 extraSettlement 를 직접 갱신하므로 별도 Map 보관 불필요.

  // 필터/검색
  const [searchInput, setSearchInput] = React.useState("")
  const [searchTerm, setSearchTerm] = React.useState("")
  const [onlyMissing, setOnlyMissing] = React.useState(false)

  // 검색 debounce 300ms
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchTerm(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(t)
  }, [searchInput])

  // 셀 클릭으로 열리는 cal_amount 입력 Dialog 상태
  const [cellDialog, setCellDialog] = React.useState<{
    open: boolean
    productCode: string | null
  }>({ open: false, productCode: null })

  // 최근 갱신 행 하이라이트 (1초 후 해제)
  const [highlightedRowIds, setHighlightedRowIds] = React.useState<Set<number>>(
    new Set(),
  )
  const highlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  /* --------------------------------------------------------
   * 파일 슬롯 핸들러
   * -------------------------------------------------------- */

  function validateXlsx(file: File): string | null {
    const name = file.name.toLowerCase()
    if (!name.endsWith(".xlsx")) {
      return `xlsx 파일만 지원합니다. 현재 파일: ${file.name}`
    }
    return null
  }

  function setSlotFile(slot: "sales" | "revenue", file: File | null) {
    if (file == null) {
      if (slot === "sales") {
        setSalesFile(null)
        setSalesError(null)
      } else {
        setRevenueFile(null)
        setRevenueError(null)
      }
      return
    }
    const err = validateXlsx(file)
    if (err) {
      if (slot === "sales") {
        setSalesError(err)
        setSalesFile(null)
      } else {
        setRevenueError(err)
        setRevenueFile(null)
      }
      return
    }
    if (slot === "sales") {
      setSalesFile(file)
      setSalesError(null)
    } else {
      setRevenueFile(file)
      setRevenueError(null)
    }
  }

  /** 재업로드 충돌 시 — 분석 완료 상태에서 새 파일을 슬롯에 넣으려 하면 Dialog 로 confirm */
  function handleSlotChange(slot: "sales" | "revenue", file: File | null) {
    if (file == null) {
      setSlotFile(slot, null)
      return
    }
    if (step.kind === "done") {
      // 분석 완료 상태에서 새 파일 들어오면 confirm
      setReuploadPending({ slot, file })
      return
    }
    setSlotFile(slot, file)
  }

  function confirmReupload() {
    if (!reuploadPending) return
    // 이전 결과 초기화 + 새 파일 세팅
    setRows(null)
    setDiagnostics(null)
    setAnalyzedFileNames(null)
    setAnalyzedAt(null)
    setStep({ kind: "idle" })
    setSearchInput("")
    setSearchTerm("")
    setOnlyMissing(false)
    setSlotFile(reuploadPending.slot, reuploadPending.file)
    setReuploadPending(null)
  }

  /* --------------------------------------------------------
   * 분석 실행
   * -------------------------------------------------------- */

  async function runAnalyze() {
    if (!salesFile || !revenueFile) return
    setStep({ kind: "running", message: "(1/3) 병합 헤더 분석" })

    try {
      // (1/3) 메시지를 잠깐 보여주고 단계 진행 — 작은 파일에서는 너무 빨라서 단계가 보이지 않으므로 의도적 지연.
      await sleep(150)

      // (2/3) cal_amount 조회 + 매핑/조인
      setStep({ kind: "running", message: "(2/3) 매핑·조인" })
      const calAmountMap = await getCalAmountMap()

      // (3/3) 실제 enrich (파싱+조인+계산)
      setStep({ kind: "running", message: "(3/3) 계산" })
      const result = await enrichMinusData({
        salesFile,
        revenueFile,
        calAmountMap,
      })

      // 행에 안정적인 _rowId 부여 (재계산/하이라이트 추적용)
      const withIds: RowWithId[] = result.rows.map((r, i) => ({
        ...r,
        _rowId: i,
      }))

      setRows(withIds)
      setDiagnostics(result.diagnostics)
      setAnalyzedFileNames({
        sales: salesFile.name,
        revenue: revenueFile.name,
      })
      setAnalyzedAt(new Date())
      setStep({ kind: "done" })
      toast.success(`분석 완료 (${koInt.format(withIds.length)}행)`)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다"
      setStep({ kind: "error", message })
      toast.error("분석 실패")
    }
  }

  function resetAll() {
    setSalesFile(null)
    setRevenueFile(null)
    setSalesError(null)
    setRevenueError(null)
    setRows(null)
    setDiagnostics(null)
    setAnalyzedFileNames(null)
    setAnalyzedAt(null)
    setStep({ kind: "idle" })
    setSearchInput("")
    setSearchTerm("")
    setOnlyMissing(false)
  }

  /* --------------------------------------------------------
   * 셀 저장 시 클라이언트 자동 재계산
   * -------------------------------------------------------- */

  function applyCalAmountUpdate(productCode: string, extraSettlement: number) {
    if (rows == null) return

    let updatedCount = 0
    const updatedIds = new Set<number>()
    const nextRows = rows.map((r) => {
      if (r.productCode !== productCode) return r
      updatedCount++
      updatedIds.add(r._rowId)
      const profit = computeProfit({
        K: r.K,
        L: r.L,
        Q: r.Q,
        R: r.R,
        extraSettlement,
      })
      return {
        ...r,
        extraSettlement,
        ...profit,
      }
    })
    setRows(nextRows)

    // diagnostics.missingExtraCount 도 클라이언트에서 갱신
    setDiagnostics((d) => {
      if (!d) return d
      // 매칭 실패였던 행이 이제 값이 있으므로 누락 count 가 감소
      // (단, 같은 productCode 가 이전에 값을 가지고 있었으면 변화 없음)
      const wasMissingForCode = rows.some(
        (r) => r.productCode === productCode && r.extraSettlement == null,
      )
      const hadMissingRows = rows.filter(
        (r) => r.productCode === productCode && r.extraSettlement == null,
      ).length
      return {
        ...d,
        missingExtraCount: wasMissingForCode
          ? Math.max(0, d.missingExtraCount - hadMissingRows)
          : d.missingExtraCount,
      }
    })

    // 하이라이트 1초
    setHighlightedRowIds(updatedIds)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedRowIds(new Set())
    }, 1000)

    toast.success(`저장됨 — ${updatedCount}개 행 재계산`)
  }

  /* --------------------------------------------------------
   * 필터링된 행
   * -------------------------------------------------------- */

  const filteredRows = React.useMemo(() => {
    if (rows == null) return []
    const term = searchTerm.toLowerCase()
    return rows.filter((r) => {
      if (onlyMissing && r.extraSettlement != null) return false
      if (term.length === 0) return true
      const hay = [
        r.productName?.toLowerCase() ?? "",
        r.productCode?.toLowerCase() ?? "",
        r.onlineOrderNo?.toLowerCase() ?? "",
        r.brandName?.toLowerCase() ?? "",
      ].join("")
      return hay.includes(term)
    })
  }, [rows, searchTerm, onlyMissing])

  /* --------------------------------------------------------
   * KPI
   * -------------------------------------------------------- */

  const totalSales = React.useMemo(() => {
    if (!rows) return 0
    let s = 0
    for (const r of rows) if (r.K != null) s += r.K
    return s
  }, [rows])

  const totalMarginSum = React.useMemo(() => {
    if (!rows) return 0
    let s = 0
    for (const r of rows) if (r.totalMargin != null) s += r.totalMargin
    return s
  }, [rows])

  /* --------------------------------------------------------
   * TanStack 컬럼 정의
   * -------------------------------------------------------- */

  const columns = React.useMemo<ColumnDef<RowWithId>[]>(
    () => [
      {
        accessorKey: "salesDate",
        header: "매출일",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.salesDate ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "onlineOrderNo",
        header: "온라인주문번호",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs">
            {row.original.onlineOrderNo ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "productCode",
        header: "상품코드",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs">
            {row.original.productCode ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "productName",
        header: "상품명",
        enableSorting: false,
        cell: ({ row }) => {
          const v = row.original.productName
          return (
            <span
              className="block max-w-xs truncate"
              title={v ?? undefined}
            >
              {v ?? "-"}
            </span>
          )
        },
      },
      {
        accessorKey: "brandName",
        header: "브랜드명",
        enableSorting: true,
        cell: ({ row }) => {
          const v = row.original.brandName
          return (
            <span
              className="block max-w-[12rem] truncate"
              title={v ?? undefined}
            >
              {v ?? "-"}
            </span>
          )
        },
      },
      numericColumn<RowWithId>("K", "매출액", (r) => r.K),
      numericColumn<RowWithId>("L", "공급가", (r) => r.L),
      numericColumn<RowWithId>("R", "이익액", (r) => r.R),
      numericColumn<RowWithId>("Q", "물류비", (r) => r.Q),
      numericColumn<RowWithId>("finalProfit", "최종이익액", (r) => r.finalProfit),
      percentColumn<RowWithId>(
        "finalProfitRate",
        "최종이익률",
        (r) => r.finalProfitRate,
      ),
      percentColumn<RowWithId>("commissionRate", "수수료", (r) => r.commissionRate),
      numericColumn<RowWithId>(
        "settlementAmount",
        "후정산금",
        (r) => r.settlementAmount,
      ),
      // 추가후정산금 — 인터랙티브 셀
      {
        accessorKey: "extraSettlement",
        header: () => <span className="block text-right">추가후정산금</span>,
        enableSorting: true,
        sortingFn: (a, b) => {
          const av = a.original.extraSettlement
          const bv = b.original.extraSettlement
          // null 은 항상 뒤로
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return av - bv
        },
        cell: ({ row }) => {
          const r = row.original
          const isMissing = r.extraSettlement == null
          const productCode = r.productCode
          const ariaLabel = isMissing
            ? `후정산금 추가 (상품 ${productCode ?? "(없음)"})`
            : `후정산금 새 이력 추가 (상품 ${productCode ?? "(없음)"}, 현재 winner ${koInt.format(r.extraSettlement ?? 0)}원)`

          const handleOpen = () => {
            if (productCode == null) {
              toast.error("상품코드가 없어 후정산금을 등록할 수 없습니다")
              return
            }
            setCellDialog({ open: true, productCode })
          }

          return (
            <div
              role="button"
              tabIndex={0}
              aria-label={ariaLabel}
              onClick={handleOpen}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  handleOpen()
                }
              }}
              className={cn(
                "group/cell -mx-2 -my-2 flex items-center justify-end gap-1 rounded-md px-2 py-2 text-right tabular-nums",
                "cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                productCode == null && "cursor-not-allowed opacity-50",
              )}
            >
              <span
                className={cn(
                  isMissing
                    ? "text-muted-foreground"
                    : r.extraSettlement! < 0
                      ? "text-red-600"
                      : "",
                )}
              >
                {isMissing ? "-" : koInt.format(r.extraSettlement!)}
              </span>
              {isMissing ? (
                <PlusIcon
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
              ) : (
                <PencilIcon
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground opacity-0 group-hover/cell:opacity-100"
                />
              )}
            </div>
          )
        },
      },
      numericColumn<RowWithId>("totalMargin", "총마진액", (r) => r.totalMargin),
      percentColumn<RowWithId>(
        "totalMarginRate",
        "총마진율",
        (r) => r.totalMarginRate,
      ),
    ],
    [],
  )

  const [sorting, setSorting] = React.useState<SortingState>([])

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: PAGE_SIZE },
    },
  })

  // 필터 변경 시 페이지 1로
  React.useEffect(() => {
    table.setPageIndex(0)
  }, [searchTerm, onlyMissing, table])

  /* --------------------------------------------------------
   * CSV 다운로드
   * -------------------------------------------------------- */

  function downloadCSV() {
    if (!rows) return

    try {
      const lines: string[] = []
      lines.push(CSV_HEADERS.map(([, label]) => csvEscape(label)).join(","))
      for (const r of filteredRows) {
        const cells = CSV_HEADERS.map(([key]) => {
          const v = r[key]
          if (v == null) return ""
          if (key === "commissionRate" || key === "totalMarginRate") {
            // 비율 — 0~1 → "xx.x%"
            return csvEscape(
              typeof v === "number" ? `${(v * 100).toFixed(1)}%` : String(v),
            )
          }
          if (
            key === "K" ||
            key === "L" ||
            key === "R" ||
            key === "settlementAmount" ||
            key === "extraSettlement" ||
            key === "totalMargin"
          ) {
            // 정수 (반올림 후 천단위 없는 raw 숫자 — 외부 분석에 유리)
            if (typeof v === "number") return String(Math.round(v))
            return csvEscape(String(v))
          }
          return csvEscape(String(v))
        })
        lines.push(cells.join(","))
      }

      const content = UTF8_BOM + lines.join("\r\n")
      const blob = new Blob([content], {
        type: "text/csv;charset=utf-8",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `minus_${todayYMD()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`CSV 저장됨: minus_${todayYMD()}.csv`)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(`CSV 생성 실패: ${message}`)
    }
  }

  /* --------------------------------------------------------
   * 렌더링
   * -------------------------------------------------------- */

  const canAnalyze =
    salesFile != null &&
    revenueFile != null &&
    salesError == null &&
    revenueError == null &&
    step.kind !== "running"

  const showResults = step.kind === "done" && rows != null && diagnostics != null

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">마이너스 매출이익률</h1>
          <p className="text-sm text-muted-foreground">
            두 파일을 업로드해 손실 품목을 확인합니다.
          </p>
          {showResults && analyzedFileNames && analyzedAt && (
            <p className="text-xs text-muted-foreground">
              분석 완료: {analyzedFileNames.sales} +{" "}
              {analyzedFileNames.revenue} (
              {formatDateTime(analyzedAt)})
            </p>
          )}
        </div>
        {showResults && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetAll}>
              <RefreshCwIcon />
              재업로드
            </Button>
            <Button onClick={downloadCSV}>
              <DownloadIcon />
              CSV 다운로드
            </Button>
          </div>
        )}
      </header>

      {/* 업로드 카드 — 분석 완료 후에는 숨김 (재업로드 버튼으로 리셋) */}
      {!showResults && (
        <Card>
          <CardHeader>
            <CardTitle>1단계: 파일 업로드</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UploadSlot
                label="sales_status_basic.xlsx"
                file={salesFile}
                error={salesError}
                onFileChange={(f) => handleSlotChange("sales", f)}
                slotKey="sales"
              />
              <UploadSlot
                label="revenue_profit_brand.xlsx"
                file={revenueFile}
                error={revenueError}
                onFileChange={(f) => handleSlotChange("revenue", f)}
                slotKey="revenue"
              />
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant={salesFile ? "default" : "outline"}>
                  {salesFile ? "✓" : "☐"} 파일1
                </Badge>
                <Badge variant={revenueFile ? "default" : "outline"}>
                  {revenueFile ? "✓" : "☐"} 파일2
                </Badge>
              </div>
              <Button
                size="lg"
                onClick={runAnalyze}
                disabled={!canAnalyze}
              >
                {step.kind === "running" ? "분석 중…" : "분석 시작"}
              </Button>
            </div>

            {step.kind === "running" && (
              <div className="space-y-2">
                <p
                  role="status"
                  aria-live="polite"
                  className="text-sm text-muted-foreground"
                >
                  파일 파싱 중… {step.message}
                </p>
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            )}

            {step.kind === "error" && (
              <Alert variant="destructive">
                <AlertTitle>분석 중 오류</AlertTitle>
                <AlertDescription>
                  {step.message}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStep({ kind: "idle" })}
                    >
                      재시도
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* 결과 — KPI / 필터 / 테이블 */}
      {showResults && diagnostics && rows && (
        <>
          <Separator />

          {/* KPI */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard
              label="총 행 수"
              value={koInt.format(diagnostics.totalRows)}
              sub={
                diagnostics.computeNullCount > 0
                  ? `계산 불가 ${koInt.format(diagnostics.computeNullCount)}행 제외`
                  : undefined
              }
            />
            <KpiCard
              label="마이너스 건수"
              value="—"
              sub="판정 기준 미확정"
              muted
            />
            <KpiCard
              label="총 매출액"
              value={koInt.format(Math.round(totalSales))}
            />
            <KpiCard
              label="총마진액 합계"
              value={koInt.format(Math.round(totalMarginSum))}
              valueClass={totalMarginSum < 0 ? "text-red-600" : ""}
            />
            <MissingKpiCard
              count={diagnostics.missingExtraCount}
              pressed={onlyMissing}
              onToggle={() => {
                if (diagnostics.missingExtraCount === 0) {
                  toast.info("누락 행이 없습니다")
                  return
                }
                setOnlyMissing((v) => !v)
              }}
            />
          </section>

          {/* 검색/필터 */}
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
                  placeholder="상품명/코드/주문번호/브랜드 검색"
                  className="pl-8 pr-8"
                  aria-label="결과 테이블 검색"
                />
                {searchInput.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setSearchInput("")}
                    aria-label="검색어 지우기"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  마이너스 필터:
                </span>
                <Select disabled value="all">
                  <SelectTrigger
                    aria-label="마이너스 필터 (기준 미확정으로 비활성)"
                    title="판정 기준 미확정"
                  >
                    <SelectValue placeholder="전체 표시" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 표시</SelectItem>
                    <SelectItem value="negative" disabled>
                      마이너스만 (기준 미확정)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(searchTerm.length > 0 || onlyMissing) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  적용된 필터:
                </span>
                {searchTerm.length > 0 && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    검색: {searchTerm}
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("")
                        setSearchTerm("")
                      }}
                      aria-label="검색어 필터 해제"
                      className="ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                )}
                {onlyMissing && (
                  <Badge variant="secondary" className="gap-1 pr-1">
                    누락 행만
                    <button
                      type="button"
                      onClick={() => setOnlyMissing(false)}
                      aria-label="누락 행만 필터 해제"
                      className="ml-1 inline-flex size-4 items-center justify-center rounded hover:bg-foreground/10"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}
          </section>

          {/* 결과 테이블 */}
          <section>
            <div className="rounded-md border">
              {filteredRows.length === 0 ? (
                <div className="border-dashed p-12 text-center text-sm text-muted-foreground">
                  {onlyMissing ? (
                    <>
                      <p>추가후정산금 누락 행이 없습니다.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => setOnlyMissing(false)}
                      >
                        필터 해제
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        조건에 맞는 행이 없습니다. 검색어를 지워보세요.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => {
                          setSearchInput("")
                          setSearchTerm("")
                        }}
                      >
                        검색 초기화
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      {table.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id}>
                          {hg.headers.map((h) => {
                            const canSort = h.column.getCanSort()
                            const sorted = h.column.getIsSorted()
                            const ariaSort:
                              | "ascending"
                              | "descending"
                              | "none" =
                              sorted === "asc"
                                ? "ascending"
                                : sorted === "desc"
                                  ? "descending"
                                  : "none"
                            return (
                              <TableHead
                                key={h.id}
                                aria-sort={canSort ? ariaSort : undefined}
                                role={canSort ? "button" : undefined}
                                tabIndex={canSort ? 0 : undefined}
                                onKeyDown={(e) => {
                                  if (
                                    canSort &&
                                    (e.key === "Enter" || e.key === " ")
                                  ) {
                                    e.preventDefault()
                                    h.column.toggleSorting()
                                  }
                                }}
                                className={cn(
                                  "whitespace-nowrap",
                                  canSort &&
                                    "cursor-pointer select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                )}
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
                      {table.getRowModel().rows.map((row) => {
                        const isHighlighted = highlightedRowIds.has(
                          row.original._rowId,
                        )
                        return (
                          <TableRow
                            key={row.id}
                            className={cn(
                              "transition-colors",
                              isHighlighted && "bg-blue-50",
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
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* 페이지네이션 */}
            {filteredRows.length > 0 && (
              <ResultsPagination table={table} totalRows={filteredRows.length} />
            )}
          </section>
        </>
      )}

      {/* cal_amount 입력 Dialog (셀 클릭) */}
      <CalAmountFormDialog
        open={cellDialog.open}
        onOpenChange={(open) => setCellDialog((s) => ({ ...s, open }))}
        defaultValues={
          cellDialog.productCode != null
            ? { productCode: cellDialog.productCode }
            : undefined
        }
        lockProductCode
        onSaved={({ productCode, extraSettlement }) => {
          applyCalAmountUpdate(productCode, extraSettlement)
        }}
      />

      {/* 재업로드 확인 Dialog */}
      <Dialog
        open={reuploadPending != null}
        onOpenChange={(open) => {
          if (!open) setReuploadPending(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>이전 분석 결과를 덮어쓰시겠습니까?</DialogTitle>
            <DialogDescription>
              현재 표시 중인{" "}
              {rows ? `${koInt.format(rows.length)}행` : "분석 결과"}가
              사라집니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReuploadPending(null)}
            >
              취소
            </Button>
            <Button onClick={confirmReupload}>새로 분석</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ============================================================
 * 서브 컴포넌트
 * ============================================================ */

function UploadSlot({
  label,
  file,
  error,
  onFileChange,
  slotKey,
}: {
  label: string
  file: File | null
  error: string | null
  onFileChange: (file: File | null) => void
  slotKey: "sales" | "revenue"
}) {
  const inputId = `upload-${slotKey}`
  const [dragOver, setDragOver] = React.useState(false)

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const f = fileList[0]
    if (f) onFileChange(f)
  }

  const stateClass = error
    ? "border-solid border-red-600 bg-red-50/50"
    : file
      ? "border-solid border-blue-600 bg-blue-50/50"
      : dragOver
        ? "border-solid border-blue-600 bg-blue-50/30"
        : "border-dashed border-muted-foreground/30"

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-6 text-center transition-colors",
        stateClass,
      )}
    >
      <FileSpreadsheetIcon
        aria-hidden="true"
        className="size-8 text-muted-foreground"
      />
      <p className="font-medium">{label}</p>

      {file ? (
        <div className="space-y-1 text-xs">
          <p className="text-foreground">
            <span aria-hidden="true">✓</span> {file.name}
          </p>
          <p className="text-muted-foreground">
            {formatFileSize(file.size)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onFileChange(null)}
          >
            <XIcon />
            제거
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            파일을 끌어 놓거나 클릭하세요
          </p>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<label htmlFor={inputId} className="cursor-pointer" />}
          >
            <UploadIcon />
            파일 선택
          </Button>
        </>
      )}

      <input
        id={inputId}
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <Alert variant="destructive" className="mt-2 text-left">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  muted,
  valueClass,
}: {
  label: string
  value: string
  sub?: string
  muted?: boolean
  valueClass?: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums",
            muted && "text-muted-foreground",
            valueClass,
          )}
        >
          {value}
        </div>
        {sub && (
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        )}
      </CardContent>
    </Card>
  )
}

function MissingKpiCard({
  count,
  pressed,
  onToggle,
}: {
  count: number
  pressed: boolean
  onToggle: () => void
}) {
  const isZero = count === 0
  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      aria-pressed={pressed}
      aria-label={`추가후정산금 누락 행만 보기 (현재 ${koInt.format(count)}건)`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onToggle()
        }
      }}
      className={cn(
        "col-span-2 cursor-pointer transition-colors md:col-span-1",
        "hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed && "ring-2 ring-primary",
      )}
    >
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
          추가후정산금 누락
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums",
            isZero && "text-muted-foreground",
          )}
        >
          {koInt.format(count)}건
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {isZero ? "누락 행이 없습니다" : "클릭하여 누락 행만 보기"}
        </p>
      </CardContent>
    </Card>
  )
}

function ResultsPagination<T>({
  table,
  totalRows,
}: {
  table: ReturnType<typeof useReactTable<T>>
  totalRows: number
}) {
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const pageCount = table.getPageCount()
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1
  const end = Math.min((pageIndex + 1) * pageSize, totalRows)
  const window = pageWindow(pageIndex + 1, Math.max(1, pageCount))

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-2 sm:flex-row">
      <div className="text-sm text-muted-foreground">
        {koInt.format(totalRows)}행 중 {start}–{end}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="이전 페이지"
        >
          <ChevronLeftIcon />
        </Button>
        {window.map((it, i) =>
          it === "…" ? (
            <span
              key={`e-${i}`}
              aria-hidden="true"
              className="px-1 text-sm text-muted-foreground"
            >
              …
            </span>
          ) : (
            <Button
              key={it}
              variant={it === pageIndex + 1 ? "default" : "outline"}
              size="sm"
              onClick={() => table.setPageIndex(it - 1)}
              aria-current={it === pageIndex + 1 ? "page" : undefined}
              aria-label={`${it} 페이지로 이동`}
            >
              {it}
            </Button>
          ),
        )}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="다음 페이지"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}

/* ============================================================
 * 헬퍼
 * ============================================================ */

function numericColumn<T extends EnrichedRow>(
  key: keyof EnrichedRow,
  label: string,
  pick: (r: T) => number | null,
): ColumnDef<T> {
  return {
    id: String(key),
    accessorFn: (r) => pick(r),
    header: () => <span className="block text-right">{label}</span>,
    enableSorting: true,
    sortingFn: (a, b) => {
      const av = pick(a.original)
      const bv = pick(b.original)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return av - bv
    },
    cell: ({ row }) => {
      const v = pick(row.original as T)
      return (
        <span
          className={cn(
            "block text-right tabular-nums",
            v == null
              ? "text-muted-foreground"
              : v < 0
                ? "text-red-600"
                : "",
          )}
        >
          {formatInt(v)}
        </span>
      )
    },
  }
}

function percentColumn<T extends EnrichedRow>(
  key: keyof EnrichedRow,
  label: string,
  pick: (r: T) => number | null,
): ColumnDef<T> {
  return {
    id: String(key),
    accessorFn: (r) => pick(r),
    header: () => <span className="block text-right">{label}</span>,
    enableSorting: true,
    sortingFn: (a, b) => {
      const av = pick(a.original)
      const bv = pick(b.original)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return av - bv
    },
    cell: ({ row }) => {
      const v = pick(row.original as T)
      return (
        <span
          className={cn(
            "block text-right tabular-nums",
            v == null
              ? "text-muted-foreground"
              : v < 0
                ? "text-red-600"
                : "",
          )}
        >
          {formatPercent(v)}
        </span>
      )
    },
  }
}

function csvEscape(s: string): string {
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${dd} ${hh}:${mi}`
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

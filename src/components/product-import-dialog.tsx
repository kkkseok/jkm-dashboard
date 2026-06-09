"use client"

import * as React from "react"
import * as XLSX from "xlsx"
import { toast } from "sonner"
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  UploadIcon,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  importProductsInChunks,
  toProductInputs,
} from "@/lib/products/import"
import { parseProductsXlsx } from "@/lib/products/parse"
import type {
  ImportResult,
  ParseError,
  ParseResult,
  ProductInput,
} from "@/lib/products/types"
import { importProducts } from "@/lib/products/actions"

/**
 * 엑셀 일괄 import Dialog.
 *
 * 02_uiux_products §4-6 의 3단계 stepper:
 *   1. 파일 선택 (드롭존 + 양식 다운로드)
 *   2. 미리보기 + 검증 결과 (upsert 토글)
 *   3. 진행 / 결과 요약 (실패 행 CSV)
 */

type Stage =
  | { kind: "select" }
  | { kind: "preview"; file: File; parsed: ParseResult }
  | { kind: "progress"; done: number; total: number; partial: ImportResult }
  | { kind: "done"; result: ImportResult; total: number }

export type ProductImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** product_channels 등록 채널 마스터 (헤더 후보 + 신규 채널 감지용) */
  channelOptions: string[]
  onSaved?: () => void
}

export function ProductImportDialog({
  open,
  onOpenChange,
  channelOptions,
  onSaved,
}: ProductImportDialogProps) {
  const [stage, setStage] = React.useState<Stage>({ kind: "select" })
  const [parseError, setParseError] = React.useState<string | null>(null)
  const [upsert, setUpsert] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)
  const fileInputId = React.useId()

  // open 토글 시 초기화
  const prevOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      setStage({ kind: "select" })
      setParseError(null)
      setUpsert(false)
      prevOpenRef.current = true
    }
    if (!open) prevOpenRef.current = false
  }, [open])

  async function handleFile(file: File) {
    setParseError(null)
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setParseError(`xlsx 파일만 지원합니다. 현재 파일: ${file.name}`)
      return
    }
    try {
      const parsed = await parseProductsXlsx(file)
      // header_missing 또는 empty_sheet 이면 1단계 유지 + Alert
      const fatal = parsed.errors.find(
        (e) => e.kind === "header_missing" || e.kind === "empty_sheet",
      )
      if (fatal) {
        setParseError(fatal.message)
        return
      }
      setStage({ kind: "preview", file, parsed })
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      setParseError(`엑셀 파일을 읽을 수 없습니다: ${message}`)
    }
  }

  async function handleStartImport() {
    if (stage.kind !== "preview") return
    const inputs = toProductInputs(stage.parsed.rows)
    const total = inputs.length

    if (total === 0) {
      toast.error("등록할 행이 없습니다")
      return
    }

    setStage({
      kind: "progress",
      done: 0,
      total,
      partial: {
        successCount: 0,
        skippedCount: 0,
        failedCount: 0,
        failures: [],
      },
    })

    try {
      // actions.importProducts 시그니처 어댑팅 — {success, skipped, failed} → ImportResult
      const result = await importProductsInChunks(
        inputs,
        async (chunk, options) => {
          const res = await importProducts(chunk, {
            upsert: options?.upsert ?? false,
          })
          return {
            successCount: res.success,
            skippedCount: res.skipped,
            failedCount: res.failed.length,
            failures: res.failed.map((f) => ({
              sabangnetCode:
                chunk[f.row]?.sabangnetCode ?? `(row ${f.row})`,
              productCode: chunk[f.row]?.productCode ?? `(row ${f.row})`,
              reason: f.reason,
            })),
          }
        },
        {
          upsert,
          onProgress: (done, total, partial) => {
            setStage({ kind: "progress", done, total, partial })
          },
        },
      )

      setStage({ kind: "done", result, total })
      toast.success(
        `import 완료 (성공 ${result.successCount} · 건너뜀 ${result.skippedCount} · 실패 ${result.failedCount})`,
      )
      onSaved?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(`import 실패: ${message}`)
      // preview 로 복귀
      setStage({ kind: "preview", file: stage.file, parsed: stage.parsed })
      setParseError(message)
    }
  }

  function handleClose() {
    onOpenChange(false)
  }

  function downloadTemplate() {
    // v1.2 Wide format — 4 고정 헤더 + 등록 채널 헤더들 + 예시 2행
    const channels = channelOptions.length > 0 ? channelOptions : ["GSshop"]
    const header = ["사방넷코드", "브랜드명", "상품명", "구분", ...channels]
    const example1: unknown[] = ["SBG-1001", "글리치", "워시팩", "단품"]
    for (let i = 0; i < channels.length; i++) {
      example1.push(i === 0 ? "ABC-001" : i === 1 ? "ABC-001-CP" : "")
    }
    const example2: unknown[] = ["SBG-1002", "글리치", "세트A", "복합"]
    for (let i = 0; i < channels.length; i++) {
      example2.push(i === 1 ? "ABC-002-CP" : i === 2 ? "ABC-002-OH" : "")
    }
    const ws = XLSX.utils.aoa_to_sheet([header, example1, example2])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    XLSX.writeFile(wb, `products_template_${todayYMD()}.xlsx`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {stage.kind === "select" && "엑셀로 상품 일괄 등록"}
            {stage.kind === "preview" && "엑셀로 상품 일괄 등록 — 미리보기"}
            {stage.kind === "progress" && "엑셀로 상품 일괄 등록 — 진행 중"}
            {stage.kind === "done" && "엑셀로 상품 일괄 등록 — 완료"}
          </DialogTitle>
        </DialogHeader>

        {/* 1단계: 파일 선택 */}
        {stage.kind === "select" && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void handleFile(f)
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border-2 p-8 text-center transition-colors",
                dragOver
                  ? "border-solid border-primary bg-primary/10"
                  : "border-dashed border-muted-foreground/30",
              )}
            >
              <FileSpreadsheetIcon
                aria-hidden="true"
                className="size-10 text-muted-foreground"
              />
              <p className="text-sm">
                여기에 xlsx 파일을 끌어놓거나 클릭하세요
              </p>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <label htmlFor={fileInputId} className="cursor-pointer" />
                }
              >
                <UploadIcon />
                파일 선택
              </Button>
              <input
                id={fileInputId}
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                  // reset 시켜서 동일 파일 재선택 가능
                  e.currentTarget.value = ""
                }}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              <p>
                양식이 필요하면{" "}
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  양식 다운로드
                </button>{" "}
                를 먼저 누르세요.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  Wide 양식: 첫 행 = 고정 4헤더 (사방넷코드 / 브랜드명 / 상품명
                  / 구분) + 채널 컬럼들
                </li>
                <li>
                  채널 컬럼은 가변 — 헤더 텍스트가 곧 채널명. 비어있는 채널
                  칸은 자동 스킵
                </li>
                <li>&quot;구분&quot; 값은 &quot;단품&quot; 또는 &quot;복합&quot;</li>
                <li>(사방넷, 채널) 페어와 상품코드는 시스템 전체 UNIQUE</li>
                <li>같은 파일 안 페어 또는 상품코드 중복 시 첫 행만 채택</li>
                <li>DB 와의 중복은 기본 건너뜀 (다음 단계에서 upsert 토글 가능)</li>
              </ul>
            </div>

            {parseError && (
              <Alert variant="destructive">
                <AlertTitle>파일을 읽을 수 없습니다</AlertTitle>
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                취소
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* 2단계: 미리보기 */}
        {stage.kind === "preview" && (
          <PreviewStage
            file={stage.file}
            parsed={stage.parsed}
            upsert={upsert}
            onUpsertChange={setUpsert}
            onBack={() => setStage({ kind: "select" })}
            onCancel={handleClose}
            onStart={handleStartImport}
            onDownloadTemplate={downloadTemplate}
            channelOptions={channelOptions}
          />
        )}

        {/* 3단계 (진행) */}
        {stage.kind === "progress" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                등록 중… {stage.done.toLocaleString()} / {stage.total.toLocaleString()}
              </p>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${stage.total === 0 ? 0 : (stage.done / stage.total) * 100}%`,
                  }}
                />
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>성공 {stage.partial.successCount.toLocaleString()}</span>
                <span>건너뜀 {stage.partial.skippedCount.toLocaleString()}</span>
                <span>실패 {stage.partial.failedCount.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {/* 3단계 (완료) */}
        {stage.kind === "done" && (
          <DoneStage
            result={stage.result}
            total={stage.total}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ============================================================
 * 2단계: 미리보기 + 검증 결과
 * ============================================================ */

function PreviewStage({
  file,
  parsed,
  upsert,
  onUpsertChange,
  onBack,
  onCancel,
  onStart,
  onDownloadTemplate,
  channelOptions,
}: {
  file: File
  parsed: ParseResult
  upsert: boolean
  onUpsertChange: (v: boolean) => void
  onBack: () => void
  onCancel: () => void
  onStart: () => void
  onDownloadTemplate: () => void
  channelOptions: string[]
}) {
  // 시스템 등록 채널 set (Wide 양식 채널 분류용)
  const registeredChannelSet = React.useMemo(
    () => new Set(channelOptions),
    [channelOptions],
  )
  const detectedExisting = parsed.detectedChannels.filter((c) =>
    registeredChannelSet.has(c),
  )
  const detectedNew = parsed.detectedChannels.filter(
    (c) => !registeredChannelSet.has(c),
  )
  const duplicateCount = parsed.errors.filter(
    (e) => e.kind === "duplicate_in_file",
  ).length
  const otherErrorCount =
    parsed.errors.length - duplicateCount // 파일 단위 에러는 이 단계 도달 시점에 없음

  const totalInput = parsed.rows.length + parsed.errors.length

  // 미리보기 5건 — 정상 행 우선, 부족하면 에러 행으로 채움
  type PreviewItem =
    | { kind: "ok"; row: (typeof parsed.rows)[number] }
    | { kind: "err"; err: ParseError }
  const previewItems: PreviewItem[] = React.useMemo(() => {
    const okItems: PreviewItem[] = parsed.rows
      .slice(0, 5)
      .map((r) => ({ kind: "ok" as const, row: r }))
    if (okItems.length >= 5) return okItems
    const more: PreviewItem[] = parsed.errors
      .slice(0, 5 - okItems.length)
      .map((e) => ({ kind: "err" as const, err: e }))
    return [...okItems, ...more]
  }, [parsed])

  const [showErrors, setShowErrors] = React.useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <FileSpreadsheetIcon className="size-4 text-muted-foreground" />
        <span className="truncate">{file.name}</span>
        <span className="text-muted-foreground">
          ({formatFileSize(file.size)})
        </span>
      </div>

      {/* 감지된 채널 패널 (Wide 양식) */}
      {parsed.detectedChannels.length > 0 && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            감지된 채널 ({parsed.detectedChannels.length}개)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {parsed.detectedChannels.map((ch) => {
              const isNew = !registeredChannelSet.has(ch)
              return (
                <Badge
                  key={ch}
                  variant={isNew ? "default" : "secondary"}
                  className={cn(
                    isNew && "border-warning bg-warning/15 text-warning",
                  )}
                  aria-label={isNew ? `${ch} (신규 채널)` : `${ch} (기존 채널)`}
                >
                  {isNew ? "🆕 " : ""}
                  {ch}
                </Badge>
              )
            })}
          </div>
          {detectedNew.length > 0 && (
            <Alert variant="default" className="mt-1">
              <AlertTitle>신규 채널 {detectedNew.length}개 감지</AlertTitle>
              <AlertDescription>
                이 채널들은 시스템에 등록되지 않은 채널입니다. 오타가 아닌지
                확인하세요. 진행 시 product_master 에 그대로 저장되지만, 채널
                마스터에는 자동 추가되지 않으므로 채널 탭에서 별도 등록이
                필요합니다.{" "}
                <span className="font-mono text-xs">
                  ({detectedNew.join(", ")})
                </span>
              </AlertDescription>
            </Alert>
          )}
          {detectedExisting.length > 0 && detectedNew.length === 0 && (
            <p className="text-xs text-muted-foreground">
              모두 등록된 채널입니다.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1 rounded-md border p-3 text-sm">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          검증 결과
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="신규 등록 가능"
            value={parsed.rows.length}
            tone="ok"
          />
          <Metric
            label="중복 (건너뜀)"
            value={duplicateCount}
            tone="warn"
          />
          <Metric
            label="형식 오류 (제외)"
            value={otherErrorCount - duplicateCount < 0 ? 0 : parsed.errors.length - duplicateCount}
            tone="err"
          />
          <Metric label="총 입력" value={totalInput} tone="neutral" />
        </div>
        {parsed.errors.length > 0 && (
          <button
            type="button"
            onClick={() => setShowErrors((v) => !v)}
            className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showErrors ? "에러 상세 닫기" : "에러 상세 보기"}
          </button>
        )}
        {showErrors && parsed.errors.length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-muted/30 p-2 text-xs">
            <ul className="space-y-1">
              {parsed.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-muted-foreground">
                    [{e.kind}
                    {e.excelRowIndex != null ? ` · ${e.excelRowIndex}행` : ""}]
                  </span>{" "}
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
          미리보기 (상위 5건)
        </p>
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[60rem] table-fixed" density="compact">
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">사방넷코드</TableHead>
                <TableHead className="w-28">브랜드</TableHead>
                <TableHead className="w-44">채널명</TableHead>
                <TableHead className="w-32">상품코드</TableHead>
                <TableHead className="w-56">상품명</TableHead>
                <TableHead className="w-20 text-center">구분</TableHead>
                <TableHead className="w-20 text-center">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewItems.map((it, i) =>
                it.kind === "ok" ? (
                  <TableRow key={`ok-${i}`}>
                    <TableCell className="truncate font-mono text-xs" title={it.row.sabangnetCode}>
                      {it.row.sabangnetCode}
                    </TableCell>
                    <TableCell className="truncate" title={it.row.brandName}>
                      {it.row.brandName}
                    </TableCell>
                    <TableCell className="truncate" title={it.row.channelName}>
                      {it.row.channelName}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs" title={it.row.productCode}>
                      {it.row.productCode}
                    </TableCell>
                    <TableCell className="truncate" title={it.row.productName}>
                      {it.row.productName}
                    </TableCell>
                    <TableCell className="text-center">
                      {it.row.isComposite ? "복합" : "단품"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">정상</Badge>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={`err-${i}`} className="text-muted-foreground">
                    <TableCell
                      colSpan={6}
                      className="truncate text-xs"
                      title={it.err.message}
                    >
                      {it.err.excelRowIndex != null
                        ? `${it.err.excelRowIndex}행: `
                        : ""}
                      {it.err.message}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">
                        {it.err.kind === "duplicate_in_file" ? "중복" : "오류"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ),
              )}
              {previewItems.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-xs text-muted-foreground"
                  >
                    표시할 행이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={upsert}
          onCheckedChange={(checked) => onUpsertChange(checked === true)}
        />
        중복 코드는 기존 데이터로 덮어쓰기 (upsert)
      </Label>

      <DialogFooter>
        <Button variant="outline" onClick={onDownloadTemplate}>
          <DownloadIcon />
          양식 다운로드
        </Button>
        <Button variant="outline" onClick={onBack}>
          다시 선택
        </Button>
        <Button variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button onClick={onStart} disabled={parsed.rows.length === 0}>
          {parsed.rows.length.toLocaleString()}건 등록
        </Button>
      </DialogFooter>
    </div>
  )
}

/* ============================================================
 * 3단계: 결과 요약
 * ============================================================ */

function DoneStage({
  result,
  total,
  onClose,
}: {
  result: ImportResult
  total: number
  onClose: () => void
}) {
  function downloadFailureCsv() {
    const headers = ["사방넷코드", "상품코드", "사유"]
    const lines = [
      headers.join(","),
      ...result.failures.map((f) =>
        [
          csvEscape(f.sabangnetCode),
          csvEscape(f.productCode),
          csvEscape(f.reason),
        ].join(","),
      ),
    ]
    const content = "﻿" + lines.join("\r\n")
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `products_import_failures_${todayYMD()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>등록이 완료되었습니다.</AlertTitle>
        <AlertDescription>
          총 {total.toLocaleString()}건 처리.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="성공" value={result.successCount} tone="ok" />
        <Metric label="건너뜀" value={result.skippedCount} tone="warn" />
        <Metric label="실패" value={result.failedCount} tone="err" />
      </div>

      {result.failures.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">실패 행 ({result.failures.length})</p>
            <Button variant="outline" size="sm" onClick={downloadFailureCsv}>
              <DownloadIcon />
              실패 행 CSV
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>사방넷코드</TableHead>
                  <TableHead>상품코드</TableHead>
                  <TableHead>사유</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.failures.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {f.sabangnetCode}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {f.productCode}
                    </TableCell>
                    <TableCell className="text-xs">{f.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button onClick={onClose}>확인</Button>
      </DialogFooter>
    </div>
  )
}

/* ============================================================
 * 헬퍼
 * ============================================================ */

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "ok" | "warn" | "err" | "neutral"
}) {
  return (
    <div className="space-y-0.5 rounded border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "ok" && "text-foreground",
          tone === "warn" && "text-warning",
          tone === "err" && value > 0 && "text-destructive",
          tone === "neutral" && "text-muted-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function csvEscape(s: string): string {
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function todayYMD(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 사용하지 않는 type import 회피용 (TS 가 `ProductInput` 을 unused 로 잡을 수 있어 명시)
export type _ProductInputUnused = ProductInput

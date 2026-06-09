"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FileSpreadsheetIcon, UploadCloudIcon } from "lucide-react"
import { toast } from "sonner"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { parseProductInfo, parseProductMasterRaw } from "@/lib/group/parse"
import {
  uploadProductInfoData,
  uploadProductMasterData,
} from "@/lib/group/upload"
import type { GroupSourceStatus } from "@/lib/group/actions"
import type {
  ProductInfoParseResult,
  ProductMasterParseResult,
} from "@/lib/group/types"

const koInt = new Intl.NumberFormat("ko-KR")

function fmtDate(s: string | null): string {
  return s ? s.slice(0, 10) : "없음"
}

type Phase = "idle" | "parsing" | "preview" | "uploading" | "done" | "error"

type UploadCardProps<T> = {
  title: string
  description: string
  lastCount: number
  lastUpdatedAt: string | null
  parse: (file: File) => Promise<T>
  upload: (parsed: T, onProgress: (done: number, total: number) => void) => Promise<void>
  renderPreview: (parsed: T) => React.ReactNode
  warnings: (parsed: T) => string[]
  doneToast: (parsed: T) => string
  onDone: () => void
}

function UploadCard<T>({
  title,
  description,
  lastCount,
  lastUpdatedAt,
  parse,
  upload,
  renderPreview,
  warnings,
  doneToast,
  onDone,
}: UploadCardProps<T>) {
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [fileName, setFileName] = React.useState("")
  const [parsed, setParsed] = React.useState<T | null>(null)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState({ done: 0, total: 0 })
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const busy = phase === "parsing" || phase === "uploading"
  const showDropzone =
    phase === "idle" || phase === "preview" || phase === "done" || phase === "error"

  async function handleFile(file: File) {
    setFileName(file.name)
    setErrorMsg(null)
    setParsed(null)
    setPhase("parsing")
    try {
      const result = await parse(file)
      setParsed(result)
      setPhase("preview")
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "엑셀 파싱에 실패했습니다")
      setPhase("error")
    }
  }

  async function handleUpload() {
    if (!parsed) return
    setProgress({ done: 0, total: 0 })
    setPhase("uploading")
    try {
      await upload(parsed, (done, total) => setProgress({ done, total }))
      setPhase("done")
      toast.success(doneToast(parsed))
      onDone()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "DB 적재 중 오류가 발생했습니다")
      setPhase("error")
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // 같은 파일 재선택 허용
    if (file) void handleFile(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0
  const warns = parsed ? warnings(parsed) : []

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="min-h-10">{description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        <p className="text-xs text-muted-foreground">
          마지막 갱신:{" "}
          {lastCount > 0
            ? `${koInt.format(lastCount)}건 · ${fmtDate(lastUpdatedAt)}`
            : "없음"}
        </p>

        {showDropzone && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <UploadCloudIcon className="size-7 text-muted-foreground" />
            <span className="text-sm font-medium">
              클릭하거나 파일을 끌어다 놓으세요
            </span>
            <span className="text-xs text-muted-foreground">
              .xlsx (비밀번호 1111 보호 파일 자동 처리)
            </span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={onInputChange}
        />

        {fileName && (
          <div className="flex items-center gap-2 text-sm">
            <FileSpreadsheetIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{fileName}</span>
          </div>
        )}

        {phase === "parsing" && (
          <p className="text-sm text-muted-foreground">파싱 중…</p>
        )}

        {phase === "preview" && parsed && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            {renderPreview(parsed)}
            {warns.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-amber-600">
                  경고 {koInt.format(warns.length)}건
                </summary>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                  {warns.slice(0, 10).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {warns.length > 10 && (
                    <li>… 외 {koInt.format(warns.length - 10)}건</li>
                  )}
                </ul>
              </details>
            )}
          </div>
        )}

        {phase === "uploading" && (
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              />
            </div>
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {koInt.format(progress.done)} / {koInt.format(progress.total)}건 적재 중…
            </p>
          </div>
        )}

        {phase === "done" && (
          <Alert>
            <AlertTitle>완료</AlertTitle>
            <AlertDescription>DB에 적재되었습니다.</AlertDescription>
          </Alert>
        )}

        {phase === "error" && errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>실패</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter>
        <Button
          type="button"
          onClick={handleUpload}
          disabled={phase !== "preview"}
        >
          {phase === "uploading" ? "적재 중…" : "DB에 적재"}
        </Button>
      </CardFooter>
    </Card>
  )
}

export function GroupSourcesClient({ status }: { status: GroupSourceStatus }) {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">그룹 매핑 소스</h1>
        <p className="text-sm text-muted-foreground">
          현황 · 마켓 {koInt.format(status.marketCount)} · 묶음{" "}
          {koInt.format(status.bundleCount)} · ERP {koInt.format(status.erpCount)}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard<ProductMasterParseResult>
          title="상품 마스터 원본"
          description="product_master.xlsx 원본. 마켓코드 → 자체코드·상품명·구성수량과 묶음 구성을 갱신합니다."
          lastCount={status.marketCount}
          lastUpdatedAt={status.marketUpdatedAt}
          parse={parseProductMasterRaw}
          upload={uploadProductMasterData}
          warnings={(p) => p.warnings}
          doneToast={(p) =>
            `상품 마스터 ${koInt.format(p.stats.marketCount)}건 적재 완료`
          }
          onDone={() => router.refresh()}
          renderPreview={(p) => (
            <div className="space-y-1">
              <p>
                마켓코드{" "}
                <span className="font-medium tabular-nums">
                  {koInt.format(p.stats.marketCount)}
                </span>
                건 · 묶음{" "}
                <span className="font-medium tabular-nums">
                  {koInt.format(p.stats.bundleCount)}
                </span>
                개(내품 {koInt.format(p.stats.bundleItemCount)})
              </p>
              <p className="text-xs text-muted-foreground">
                마켓코드 중복 {koInt.format(p.stats.dupMarketCount)} · 묶음수식 실패{" "}
                {koInt.format(p.stats.bundleFormulaFailCount)} (첫 등장/표준수식만 반영)
              </p>
            </div>
          )}
        />

        <UploadCard<ProductInfoParseResult>
          title="ERP 코드"
          description="product_info.xlsx. 자체코드 → ERPia 상품코드·상품명 매핑을 갱신합니다."
          lastCount={status.erpCount}
          lastUpdatedAt={status.erpUpdatedAt}
          parse={parseProductInfo}
          upload={uploadProductInfoData}
          warnings={(p) => p.warnings}
          doneToast={(p) => `ERP 코드 ${koInt.format(p.stats.erpCount)}건 적재 완료`}
          onDone={() => router.refresh()}
          renderPreview={(p) => (
            <div className="space-y-1">
              <p>
                ERP 코드{" "}
                <span className="font-medium tabular-nums">
                  {koInt.format(p.stats.erpCount)}
                </span>
                건
              </p>
              <p className="text-xs text-muted-foreground">
                자체코드 중복 {koInt.format(p.stats.dupSelfCount)} (첫 등장만 반영)
              </p>
            </div>
          )}
        />
      </div>
    </div>
  )
}

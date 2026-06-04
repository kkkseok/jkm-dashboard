"use client"

import * as React from "react"
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  UploadCloudIcon,
} from "lucide-react"
import * as XLSX from "xlsx"
import { toast } from "sonner"

import type { CalAmount } from "@/db/schema/cal-amount"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { appendCalAmountBatch } from "@/lib/cal-amount/actions"
import {
  parseCalAmountUpload,
  type SkippedRow,
} from "@/lib/cal-amount/parse-upload"

/** 다중행 INSERT 청크 크기. */
const CHUNK_SIZE = 500

const koInt = new Intl.NumberFormat("ko-KR")

/** 빈 업로드 양식(헤더만) xlsx 를 생성해 브라우저 다운로드. */
function downloadTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["상품코드", "후정산금"]])
  // 열 폭 힌트
  ws["!cols"] = [{ wch: 24 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws, "후정산금")
  XLSX.writeFile(wb, "후정산금_양식.xlsx")
}

type Phase = "idle" | "parsing" | "uploading" | "done" | "error"

export type CalAmountUploadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * 청크가 INSERT 될 때마다 호출. `rows` 는 **id 내림차순**(해당 청크 내 최신이 먼저).
   * 부모는 이를 테이블 상단에 prepend 해 실시간 점진 반영한다.
   */
  onRowsInserted: (rows: CalAmount[]) => void
  /** 업로드 완료 시 1회 호출 (요약). 부모는 router.refresh() 로 서버와 동기화. */
  onDone: (summary: { inserted: number; skipped: number }) => void
}

export function CalAmountUploadDialog({
  open,
  onOpenChange,
  onRowsInserted,
  onDone,
}: CalAmountUploadDialogProps) {
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [fileName, setFileName] = React.useState<string>("")
  const [total, setTotal] = React.useState(0)
  const [processed, setProcessed] = React.useState(0)
  const [skipped, setSkipped] = React.useState<SkippedRow[]>([])
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const busy = phase === "parsing" || phase === "uploading"

  // Dialog 열릴 때 상태 초기화.
  const prevOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      setPhase("idle")
      setFileName("")
      setTotal(0)
      setProcessed(0)
      setSkipped([])
      setErrorMsg(null)
      setDragOver(false)
    }
    prevOpenRef.current = open
  }, [open])

  function handleRequestClose(next: boolean) {
    // 업로드 중에는 닫기 차단 (데이터 정합성).
    if (busy && !next) return
    onOpenChange(next)
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setErrorMsg(null)
    setProcessed(0)
    setSkipped([])
    setPhase("parsing")

    let parsed
    try {
      parsed = await parseCalAmountUpload(file)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "엑셀 파싱에 실패했습니다"
      setErrorMsg(message)
      setPhase("error")
      return
    }

    setSkipped(parsed.skipped)
    setTotal(parsed.valid.length)

    if (parsed.valid.length === 0) {
      // 유효 행이 없어도 스킵 내역은 보여준다.
      setPhase("done")
      onDone({ inserted: 0, skipped: parsed.skipped.length })
      if (parsed.skipped.length > 0) {
        toast.warning("추가할 유효한 행이 없습니다")
      } else {
        toast.warning("데이터 행이 없습니다")
      }
      return
    }

    setPhase("uploading")

    // "엑셀 1행 = 최신(가장 큰 id)" → 역순으로 INSERT 해야 1행이 마지막에 삽입돼 최상단이 됨.
    // 청크를 오래된 것부터(역순 배열의 앞쪽) 순차 처리하므로, 뒤 청크일수록 id 가 커진다.
    const reversed = parsed.valid.slice().reverse()

    let insertedCount = 0
    try {
      for (let i = 0; i < reversed.length; i += CHUNK_SIZE) {
        const chunk = reversed.slice(i, i + CHUNK_SIZE)
        const rows = await appendCalAmountBatch(chunk)
        // rows 는 INSERT 순서(id 오름차순). 상단 표시는 최신이 위 → 뒤집어 prepend.
        onRowsInserted(rows.slice().reverse())
        insertedCount += rows.length
        setProcessed(insertedCount)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "저장 중 오류가 발생했습니다"
      setErrorMsg(
        `${koInt.format(insertedCount)}건 저장 후 중단되었습니다: ${message}`,
      )
      setPhase("error")
      onDone({ inserted: insertedCount, skipped: parsed.skipped.length })
      return
    }

    setPhase("done")
    onDone({ inserted: insertedCount, skipped: parsed.skipped.length })
    toast.success(
      `${koInt.format(insertedCount)}건 추가됨` +
        (parsed.skipped.length > 0
          ? ` (${koInt.format(parsed.skipped.length)}건 스킵)`
          : ""),
    )
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 같은 파일 재선택 허용 위해 value 초기화.
    e.target.value = ""
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
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return (
    <Dialog open={open} onOpenChange={handleRequestClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>엑셀 대량 업로드</DialogTitle>
          <DialogDescription>
            기존 형식의 엑셀(1행 헤더 = A:상품코드, B:후정산금)을 업로드하세요.
            추가되는 데이터는 최신으로 테이블 최상단에 표시됩니다. 비밀번호(1111)
            보호 파일도 자동 처리됩니다.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
          >
            <DownloadIcon />
            양식 다운로드
          </Button>
        </div>

        {/* 드롭존 (idle / error 일 때 활성) */}
        {(phase === "idle" || phase === "error") && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <UploadCloudIcon className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">
              클릭하거나 파일을 끌어다 놓으세요
            </span>
            <span className="text-xs text-muted-foreground">
              .xlsx / .xls
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

        {/* 파일명 + 진행 상태 */}
        {phase !== "idle" && (
          <div className="space-y-3">
            {fileName && (
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheetIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{fileName}</span>
              </div>
            )}

            {phase === "parsing" && (
              <p className="text-sm text-muted-foreground">파싱 중…</p>
            )}

            {(phase === "uploading" || phase === "done") && total > 0 && (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200"
                    style={{ width: `${percent}%` }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={processed}
                  />
                </div>
                <p className="text-right text-xs tabular-nums text-muted-foreground">
                  {koInt.format(processed)} / {koInt.format(total)}건
                  {phase === "uploading" && " 처리 중…"}
                </p>
              </div>
            )}

            {phase === "done" && (
              <Alert>
                <AlertTitle>완료</AlertTitle>
                <AlertDescription>
                  {koInt.format(processed)}건이 추가되었습니다.
                  {skipped.length > 0 &&
                    ` ${koInt.format(skipped.length)}건은 스킵되었습니다.`}
                </AlertDescription>
              </Alert>
            )}

            {phase === "error" && errorMsg && (
              <Alert variant="destructive">
                <AlertTitle>업로드 실패</AlertTitle>
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {/* 스킵 내역 (최대 10건 미리보기) */}
            {(phase === "done" || phase === "error") && skipped.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-2">
                <p className="mb-1 text-xs font-medium">
                  스킵된 행 {koInt.format(skipped.length)}건
                </p>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                  {skipped.slice(0, 10).map((s) => (
                    <li key={s.row} className="tabular-nums">
                      {s.row}행: {s.reason}
                    </li>
                  ))}
                  {skipped.length > 10 && (
                    <li>… 외 {koInt.format(skipped.length - 10)}건</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "done" || phase === "error" ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              취소
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

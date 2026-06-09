"use client"

import * as React from "react"
import { DownloadIcon, FileSpreadsheetIcon, UploadCloudIcon } from "lucide-react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { parseNoMapping } from "@/lib/group/gen/parse"
import { resolveGroupUpload } from "@/lib/group/gen/actions"
import { downloadGroupUpload, toOutputAoa } from "@/lib/group/gen/build"
import type { OutputRow, ResolveResult } from "@/lib/group/gen/types"
import type { GroupSourceStatus } from "@/lib/group/actions"

const koInt = new Intl.NumberFormat("ko-KR")

type Phase = "idle" | "parsing" | "resolving" | "ready" | "error"

/** 미리보기 최대 표시 행(대량 파일 렌더 보호). 초과분은 다운로드에 그대로 포함. */
/**
 * 미리보기에 표시할 컬럼 인덱스 (group_upload 13컬럼 중 값이 있는 8개만).
 * 항상 공란인 C 그룹규격·D 그룹단가·H 규격·K 단가구분·L 공인바코드 는 가로폭 절약 위해 숨김.
 * (다운로드 파일은 build.toOutputAoa 가 13컬럼 전체를 그대로 출력)
 */
const VISIBLE_COLS = [0, 1, 4, 5, 6, 8, 9, 12]
/** 우측 정렬 숫자 컬럼 인덱스: A 그룹일련번호 / E 순번 / I 수량 / J 단가. */
const NUM_COLS = new Set([0, 4, 8, 9])

/** 결과를 group_upload(다운로드와 동일 AOA) 형식으로 테이블 노출. 글자 작게·공란 컬럼 숨겨 가로 스크롤 최소화. */
function OutputPreview({ rows }: { rows: OutputRow[] }) {
  const aoa = React.useMemo(() => toOutputAoa(rows), [rows])
  const headers = aoa[0] as string[]
  const body = aoa.slice(1)

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        결과 미리보기 — group_upload 형식 ({koInt.format(body.length)}행)
      </p>
      <div className="max-h-[480px] overflow-auto rounded-md border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {VISIBLE_COLS.map((ci) => (
                <TableHead
                  key={ci}
                  className={NUM_COLS.has(ci) ? "h-8 px-2 text-right" : "h-8 px-2"}
                >
                  {headers[ci]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {body.map((r, ri) => {
              const groupStart = ri > 0 && r[0] !== body[ri - 1][0]
              return (
                <TableRow
                  key={ri}
                  className={groupStart ? "border-t-2 border-t-foreground/15" : undefined}
                >
                  {VISIBLE_COLS.map((ci) => {
                    const cell = r[ci]
                    const text = cell === "" ? "" : String(cell)
                    return (
                      <TableCell
                        key={ci}
                        className={NUM_COLS.has(ci) ? "px-2 py-1 text-right tabular-nums" : "px-2 py-1"}
                      >
                        {text}
                      </TableCell>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** no_mapping_0609.xlsx → group_upload_0609.xlsx 처럼 이름 이어받기. */
function outputFileName(inputName: string): string {
  const base = inputName.replace(/\.[^.]+$/, "")
  if (/no[_-]?mapping/i.test(base)) {
    return `${base.replace(/no[_-]?mapping/i, "group_upload")}.xlsx`
  }
  return `group_upload_${base}.xlsx`
}

export function GroupUploadClient({
  sourceReady,
  status,
}: {
  sourceReady: boolean
  status: GroupSourceStatus
}) {
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [fileName, setFileName] = React.useState("")
  const [result, setResult] = React.useState<ResolveResult | null>(null)
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const busy = phase === "parsing" || phase === "resolving"

  async function handleFile(file: File) {
    setFileName(file.name)
    setErrorMsg(null)
    setResult(null)
    setPhase("parsing")
    try {
      const lines = await parseNoMapping(file)
      if (lines.length === 0) {
        throw new Error("마켓코드가 있는 주문 행을 찾지 못했습니다 (no_mapping 형식 확인)")
      }
      setPhase("resolving")
      const res = await resolveGroupUpload(lines)
      setResult(res)
      setPhase("ready")
      toast.success(
        `매핑 완료 — 그룹 ${koInt.format(res.stats.groupCount)} · 출력 ${koInt.format(res.stats.rowCount)}행` +
          (res.stats.unmappedCount > 0 ? ` · 미매핑 ${koInt.format(res.stats.unmappedCount)}` : ""),
      )
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "처리 중 오류가 발생했습니다")
      setPhase("error")
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
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

  function handleDownload() {
    if (!result || result.rows.length === 0) return
    downloadGroupUpload(result.rows, outputFileName(fileName || "group_upload"))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">그룹 업로드 생성</h1>
        <p className="text-sm text-muted-foreground">
          매핑 안 된 주문(no_mapping.xlsx)을 올리면 그룹 상품 등록 파일(group_upload.xlsx)로 변환합니다.
        </p>
      </div>

      {!sourceReady && (
        <Alert variant="destructive">
          <AlertTitle>소스 데이터가 비어 있습니다</AlertTitle>
          <AlertDescription>
            먼저 <span className="font-medium">그룹 매핑 소스</span> 메뉴에서 상품 마스터·ERP 코드를 적재하세요.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>no_mapping 업로드 → group_upload 생성</CardTitle>
          <CardDescription>
            마켓코드(H열) 기준으로 매핑합니다. 소스 현황 · 마켓 {koInt.format(status.marketCount)} · 묶음{" "}
            {koInt.format(status.bundleCount)} · ERP {koInt.format(status.erpCount)}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            disabled={busy}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors disabled:opacity-60 ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <UploadCloudIcon className="size-7 text-muted-foreground" />
            <span className="text-sm font-medium">클릭하거나 파일을 끌어다 놓으세요</span>
            <span className="text-xs text-muted-foreground">
              .xlsx (비밀번호 1111 보호 파일 자동 처리)
            </span>
          </button>

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

          {phase === "parsing" && <p className="text-sm text-muted-foreground">파싱 중…</p>}
          {phase === "resolving" && <p className="text-sm text-muted-foreground">매핑 중…</p>}

          {phase === "ready" && result && (
            <div className="space-y-3">
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <p>
                그룹{" "}
                <span className="font-medium tabular-nums">{koInt.format(result.stats.groupCount)}</span>개 · 출력{" "}
                <span className="font-medium tabular-nums">{koInt.format(result.stats.rowCount)}</span>행
              </p>
              <p className="text-xs text-muted-foreground">
                입력 {koInt.format(result.stats.inputCount)} · 중복 마켓코드 {koInt.format(result.stats.dupCount)}(첫 등장만) · 미매핑{" "}
                <span className={result.stats.unmappedCount > 0 ? "font-medium text-amber-600" : ""}>
                  {koInt.format(result.stats.unmappedCount)}
                </span>
              </p>

              {result.unmapped.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-amber-600">
                    미매핑 {koInt.format(result.unmapped.length)}건 (출력 제외 — 마스터 갱신 후 재시도)
                  </summary>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                    {result.unmapped.slice(0, 30).map((u, i) => (
                      <li key={i}>
                        <span className="font-mono">{u.marketCode}</span> · {u.marketProductName || "(상품명 없음)"} — {u.reason}
                      </li>
                    ))}
                    {result.unmapped.length > 30 && (
                      <li>… 외 {koInt.format(result.unmapped.length - 30)}건</li>
                    )}
                  </ul>
                </details>
              )}

              {result.rows.length === 0 && (
                <p className="text-amber-600">매핑된 그룹이 없어 출력할 행이 없습니다.</p>
              )}
            </div>

              {result.rows.length > 0 && <OutputPreview rows={result.rows} />}
            </div>
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
            onClick={handleDownload}
            disabled={phase !== "ready" || !result || result.rows.length === 0}
          >
            <DownloadIcon className="size-4" />
            group_upload.xlsx 다운로드
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

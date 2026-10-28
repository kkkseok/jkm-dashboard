"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { UploadIcon } from "lucide-react"

import { UploadCard } from "@/components/excel-upload-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { previewMatchUpload, upsertMatchPairs } from "@/lib/match/actions"
import { parseMatchSource } from "@/lib/match/parse"
import type { MatchSourcePreview } from "@/lib/match/types"

const koInt = new Intl.NumberFormat("ko-KR")

/** 파싱 직후 DB 와 비교한 결과까지 묶어 미리보기에 넘긴다. */
async function parseWithDiff(file: File): Promise<MatchSourcePreview> {
  const parsed = await parseMatchSource(file)
  if (parsed.rows.length === 0) {
    throw new Error("적재할 행이 없습니다. 자재코드와 두 URL 이 모두 있는 행이 필요합니다.")
  }
  const diff = await previewMatchUpload(parsed.rows)
  return { ...parsed, diff }
}

/**
 * 대조 대상 엑셀 업로드 (자재코드 · 자재명 · GS · 본사).
 * 별도 관리 메뉴 없이 대시보드에서 바로 올린다(사용자 요청 2026-10-28). 등록은 누적 upsert.
 */
export function MatchUploadDialog({
  total,
  lastRegisteredAt,
}: {
  total: number
  lastRegisteredAt: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UploadIcon />
        대상 엑셀 업로드
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>대조 대상 업로드</DialogTitle>
            <DialogDescription>
              기존 등록분에 추가·갱신됩니다. 파일에 없는 쌍도 지우지 않고 계속 확인합니다. 새로 등록한 쌍은 다음 배치(매일 03:00)에 판정됩니다.
            </DialogDescription>
          </DialogHeader>
          {/* 닫으면 언마운트 → 다시 열 때 업로드 카드 상태를 새로 시작 */}
          {open && (
            <UploadCard<MatchSourcePreview>
              title="대조 대상 URL"
              description="자재코드 · 자재명 · GS · 본사 헤더가 있는 엑셀(헤더 위치는 자동 인식)."
              lastCount={total}
              lastUpdatedAt={lastRegisteredAt}
              parse={parseWithDiff}
              upload={async (p, onProgress) => {
                onProgress(0, p.rows.length)
                await upsertMatchPairs(p.rows)
                onProgress(p.rows.length, p.rows.length)
              }}
              warnings={(p) => p.warnings}
              doneToast={(p) =>
                `대조 대상 ${koInt.format(p.rows.length)}건 반영 (신규 ${koInt.format(p.diff.newCount)})`
              }
              onDone={() => router.refresh()}
              renderPreview={(p) => (
                <div className="space-y-1">
                  <p>
                    <span className="font-medium tabular-nums">{koInt.format(p.stats.validCount)}</span>건 · 신규{" "}
                    <span className="font-medium tabular-nums">{koInt.format(p.diff.newCount)}</span> · URL 변경{" "}
                    <span className="font-medium tabular-nums">{koInt.format(p.diff.urlChangedCount)}</span> · 상품명 변경{" "}
                    {koInt.format(p.diff.nameChangedCount)} · 동일 {koInt.format(p.diff.sameCount)}
                  </p>
                  {p.diff.urlChangedCount > 0 && (
                    <p className="text-xs text-warning">URL 이 바뀐 쌍은 상태가 &lsquo;미확인&rsquo;으로 초기화됩니다.</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    제외 · 자재코드 중복 {koInt.format(p.stats.dupCount)} · 형식 오류 {koInt.format(p.stats.invalidCount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    인식 · 헤더 {p.layout.headerRow}행 · 자재코드 {p.layout.cols.matCode}열 · 자재명{" "}
                    {p.layout.cols.productName}열 · GS {p.layout.cols.gsUrl}열 · 본사 {p.layout.cols.cjUrl}열
                  </p>
                </div>
              )}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

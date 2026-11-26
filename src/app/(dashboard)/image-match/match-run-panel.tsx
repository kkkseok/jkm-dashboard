"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PlayIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getMatchRunProgress } from "@/lib/match/dashboard-actions"
import { startMatchRun } from "@/lib/match/run-actions"
import type { MatchRunSummary } from "@/lib/match/types"
import { friendlyRunError } from "@/lib/match/wording"

const koInt = new Intl.NumberFormat("ko-KR")
const kstFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** 진행 상황을 다시 읽는 간격. */
const POLL_MS = 5000
/** 실행 요청 뒤 배치가 시작 기록을 남길 때까지 기다리는 최대 시간 — Actions 준비(설치)에 1~2분 걸린다. */
const START_WAIT_MS = 6 * 60 * 1000

function duration(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 1) return `${Math.max(0, Math.round(sec))}초`
  if (m < 60) return `${m}분`
  return `${Math.floor(m / 60)}시간 ${m % 60}분`
}

type Props = {
  run: MatchRunSummary | null
  /** 아직 한 번도 판정하지 않은 쌍(미확인) 수. */
  pendingCount: number
}

/**
 * 배치 현황 + [지금 판정 실행] + 진행 표시.
 *
 * 실행은 GitHub Actions 에서 돌고, 배치가 쌍마다 판정을 끝낼 때 match_run 을 갱신한다.
 * 이 패널은 실행 중일 때만 몇 초마다 그 기록을 다시 읽어 보여준다.
 */
export function MatchRunPanel({ run: initialRun, pendingCount }: Props) {
  const router = useRouter()
  const [run, setRun] = React.useState(initialRun)
  const [confirm, setConfirm] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  /** 실행을 요청하고 배치의 시작 기록을 기다리는 중 — 요청 당시 마지막 실행 id 와 요청 시각. */
  const [waiting, setWaiting] = React.useState<{ afterId: number; since: number } | null>(null)
  /** 판정 속도 추정용 — 판정이 처음 관측된 시점. */
  const rateBase = React.useRef<{ runId: number; at: number; judged: number } | null>(null)
  const [etaSec, setEtaSec] = React.useState<number | null>(null)

  // 서버가 새 데이터를 내려주면(router.refresh) 그 값을 따른다 — 렌더 중 상태 조정(effect 로 하지 않는다).
  const [seenInitial, setSeenInitial] = React.useState(initialRun)
  if (seenInitial !== initialRun) {
    setSeenInitial(initialRun)
    setRun(initialRun)
  }

  const running = !!run?.running
  const polling = running || waiting != null

  React.useEffect(() => {
    if (!polling) return
    let cancelled = false
    const tick = async () => {
      let next: MatchRunSummary | null
      try {
        next = await getMatchRunProgress()
      } catch {
        return // 일시적인 조회 실패는 다음 주기에 다시 시도한다(표시는 마지막 값 유지).
      }
      if (cancelled) return
      setRun((prev) => {
        if (prev?.running && next && !next.running && next.id === prev.id) {
          // 실행이 끝났다 — 목록·집계를 새로 읽는다.
          if (next.error) toast.error(`실행이 정상적으로 끝나지 않았습니다. ${friendlyRunError(next.error)}`)
          else toast.success(`확인 완료 — 판정 ${koInt.format(next.judged)}건`)
          router.refresh()
        }
        return next
      })
      if (next?.running && next.toJudge > 0 && next.judged > 0) {
        const base = rateBase.current
        if (!base || base.runId !== next.id) {
          rateBase.current = { runId: next.id, at: Date.now(), judged: next.judged }
          setEtaSec(null)
        } else if (next.judged > base.judged) {
          const perPair = (Date.now() - base.at) / 1000 / (next.judged - base.judged)
          setEtaSec(Math.round(perPair * Math.max(0, next.toJudge - next.judged)))
        }
      }
      setWaiting((w) => {
        if (!w) return w
        if (next && next.id > w.afterId) return null
        if (Date.now() - w.since > START_WAIT_MS) {
          toast.error("실행을 요청했지만 시작되지 않았습니다. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 문의해 주세요.")
          return null
        }
        return w
      })
    }
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [polling, router])

  async function start() {
    setSubmitting(true)
    try {
      const r = await startMatchRun()
      if (r.ok) {
        toast.success(r.message)
        // 요청 시각은 이벤트 처리 중에 읽는다(렌더 중 Date.now() 금지).
        setWaiting({ afterId: run?.id ?? 0, since: Date.now() })
      } else {
        toast.error(r.message)
      }
    } catch {
      toast.error("실행을 요청하지 못했습니다. 잠시 뒤 다시 시도해 주세요.")
    } finally {
      setSubmitting(false)
      setConfirm(false)
    }
  }

  const collecting = running && run.toJudge === 0
  const pct = running && run.toJudge > 0 ? Math.min(100, Math.round((run.judged / run.toJudge) * 100)) : 0

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
          {running ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              확인 실행 중
            </span>
          ) : waiting ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              실행 준비 중 — 1~2분 뒤 시작합니다
            </span>
          ) : (
            <>
              마지막 실행 {run ? kstFmt.format(new Date(run.finishedAt ?? run.startedAt)) : "없음"}
              {run &&
                ` · 이미지 수집 ${koInt.format(run.fetched)}/${koInt.format(run.total)}건${run.failed ? ` · 수집 실패 ${koInt.format(run.failed)}건` : ""} · 판정 ${koInt.format(run.judged)}건${run.deferred ? ` · 다음 실행으로 넘김 ${koInt.format(run.deferred)}건` : ""}${run.judged ? ` · ${duration(run.elapsedSec)} 소요` : ""}`}
              {run?.stalled && " · 중간에 중단됨(끝난 판정은 저장됨)"}
            </>
          )}
          <span className="ml-2 text-xs">매일 03:00 자동 실행</span>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">판정 전 {koInt.format(pendingCount)}건</span>
        <Button onClick={() => setConfirm(true)} disabled={polling || submitting}>
          <PlayIcon />
          지금 판정 실행
        </Button>
      </div>

      {running && (
        <div className="space-y-1.5" aria-live="polite">
          <div
            className="h-2.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="판정 진행"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={collecting ? undefined : pct}
          >
            <div
              className={collecting ? "h-full w-1/3 animate-pulse rounded-full bg-primary/50" : "h-full rounded-full bg-primary transition-[width] duration-500"}
              style={collecting ? undefined : { width: `${pct}%` }}
            />
          </div>
          <p className="flex flex-wrap gap-x-3 text-sm tabular-nums">
            {collecting ? (
              <span>이미지 수집 중 — 대상 {koInt.format(run.total)}건</span>
            ) : (
              <>
                <span className="font-medium">
                  판정 {koInt.format(run.judged)} / {koInt.format(run.toJudge)}건 ({pct}%)
                </span>
                {run.failed > 0 && <span className="text-destructive">수집 실패 {koInt.format(run.failed)}건</span>}
              </>
            )}
            <span className="text-muted-foreground">경과 {duration(run.elapsedSec)}</span>
            {!collecting && etaSec != null && run.judged < run.toJudge && (
              <span className="text-muted-foreground">남은 시간 약 {duration(etaSec)}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            판정이 끝난 건은 바로 저장됩니다. 이 화면을 닫아도 실행은 계속되며, 새로고침하면 목록에 반영됩니다.
          </p>
        </div>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>지금 판정을 실행할까요?</DialogTitle>
            <DialogDescription>
              전체 대상의 이미지를 다시 가져오고, 아직 판정하지 않았거나 이미지가 바뀐 건을 한 번에 판정합니다(판정 전 {koInt.format(pendingCount)}건).
              한 번에 다 판정하지 못하면 남은 건은 다음 실행으로 넘어갑니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={start} disabled={submitting}>
              {submitting && <Loader2Icon className="animate-spin" />}
              실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

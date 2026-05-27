"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  type ChannelRow,
  createChannel,
  deleteChannel,
  renameChannel,
} from "@/lib/products/actions"
import { cn } from "@/lib/utils"

/**
 * 채널 마스터 관리 (Wide format v1.2).
 *
 * 기능:
 *   - 표시 순서 / 채널명(inline edit) / 사용 상품 수 / 작업
 *   - "+ 채널 추가" Dialog
 *   - PencilIcon 클릭 → Input + 저장/취소 (rename cascade)
 *   - 사용 상품 수 > 0 인 채널은 삭제 비활성 (툴팁: "N건 상품에서 사용 중")
 */

export type ChannelWithUsage = ChannelRow & { usageCount: number }

export type ChannelsListClientProps = {
  initial: ChannelWithUsage[]
}

export function ChannelsListClient({ initial }: ChannelsListClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const [addOpen, setAddOpen] = React.useState(false)
  const [addName, setAddName] = React.useState("")
  const [addOrder, setAddOrder] = React.useState("")
  const [addError, setAddError] = React.useState<string | null>(null)
  const [adding, setAdding] = React.useState(false)

  const [deleteTarget, setDeleteTarget] = React.useState<ChannelWithUsage | null>(
    null,
  )
  const [deleting, setDeleting] = React.useState(false)

  function refresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  async function handleAdd() {
    setAddError(null)
    const name = addName.trim()
    if (name.length === 0) {
      setAddError("채널명을 입력하세요")
      return
    }
    const orderRaw = addOrder.trim()
    let order: number | undefined
    if (orderRaw.length > 0) {
      const n = Number(orderRaw)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        setAddError("표시 순서는 정수여야 합니다")
        return
      }
      order = n
    }
    setAdding(true)
    try {
      await createChannel(name, order)
      toast.success(`채널 추가: ${name}`)
      setAddName("")
      setAddOrder("")
      setAddOpen(false)
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      setAddError(message)
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await deleteChannel(deleteTarget.id)
      if (!res.ok) {
        toast.error(res.reason)
      } else {
        toast.success(`채널 삭제: ${deleteTarget.name}`)
        setDeleteTarget(null)
        refresh()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(`삭제 실패: ${message}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">채널 마스터</h2>
          <p className="text-sm text-muted-foreground">
            상품 양식·드롭다운에 노출되는 판매 채널 목록입니다. 이름 변경 시
            product_master 의 채널명도 함께 일괄 변경됩니다.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon />
          채널 추가
        </Button>
      </header>

      <Alert>
        <AlertTitle>등록된 채널 {initial.length}개</AlertTitle>
        <AlertDescription>
          채널명 변경은 트랜잭션으로 product_master 의 모든 행에 cascade
          적용됩니다. 사용 중인 채널은 삭제할 수 없습니다.
        </AlertDescription>
      </Alert>

      <div className="rounded-md border">
        {initial.length === 0 ? (
          <div className="space-y-3 p-12 text-center text-sm text-muted-foreground">
            <p>등록된 채널이 없습니다.</p>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <PlusIcon />첫 채널 추가
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24 text-right">순서</TableHead>
                  <TableHead>채널명</TableHead>
                  <TableHead className="w-32 text-right">사용 상품 수</TableHead>
                  <TableHead className="w-32 text-right">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initial.map((row) => (
                  <ChannelRowItem
                    key={row.id}
                    row={row}
                    onChanged={refresh}
                    onAskDelete={() => setDeleteTarget(row)}
                    disabled={isPending}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* 채널 추가 Dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o)
          if (!o) {
            setAddName("")
            setAddOrder("")
            setAddError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>채널 추가</DialogTitle>
            <DialogDescription>
              새 판매 채널을 추가합니다. 채널명은 시스템 전체에서 유일해야
              합니다.
            </DialogDescription>
          </DialogHeader>

          {addError && (
            <Alert variant="destructive">
              <AlertTitle>추가에 실패했습니다</AlertTitle>
              <AlertDescription>{addError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-channel-name">
                채널명 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-channel-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="예: 카카오선물하기"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-channel-order">표시 순서 (선택)</Label>
              <Input
                id="new-channel-order"
                value={addOrder}
                onChange={(e) => setAddOrder(e.target.value)}
                placeholder="비우면 마지막에 추가"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={adding}
            >
              취소
            </Button>
            <Button type="button" onClick={handleAdd} disabled={adding}>
              {adding ? "추가 중…" : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>채널 삭제 확인</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  &quot;{deleteTarget.name}&quot; 채널을 삭제하시겠습니까?
                  <br />이 채널은 양식 다운로드 / 폼 옵션에서 제외됩니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "삭제 중…" : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ============================================================
 * 한 행 — inline rename 가능
 * ============================================================ */

function ChannelRowItem({
  row,
  onChanged,
  onAskDelete,
  disabled,
}: {
  row: ChannelWithUsage
  onChanged: () => void
  onAskDelete: () => void
  disabled: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(row.name)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 30)
      return () => window.clearTimeout(id)
    }
  }, [editing])

  function startEdit() {
    setDraft(row.name)
    setEditing(true)
  }

  function cancelEdit() {
    setDraft(row.name)
    setEditing(false)
  }

  async function commitEdit() {
    const next = draft.trim()
    if (next.length === 0) {
      toast.error("채널명을 입력하세요")
      return
    }
    if (next === row.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await renameChannel(row.id, next)
      toast.success(`채널명 변경: ${row.name} → ${next}`)
      setEditing(false)
      onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류"
      toast.error(message)
      setDraft(row.name)
    } finally {
      setBusy(false)
    }
  }

  const deleteDisabled = row.usageCount > 0

  return (
    <TableRow>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.displayOrder}
      </TableCell>
      <TableCell>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void commitEdit()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              className="h-8 max-w-xs"
              aria-label={`${row.name} 채널명 수정`}
              disabled={busy}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={commitEdit}
              disabled={busy}
              aria-label="채널명 저장"
            >
              <CheckIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={cancelEdit}
              disabled={busy}
              aria-label="채널명 수정 취소"
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <span className="font-medium">{row.name}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {row.usageCount > 0 ? (
          <Badge variant="secondary">{row.usageCount.toLocaleString()}건</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={startEdit}
              aria-label={`${row.name} 채널명 수정 시작`}
              disabled={disabled}
            >
              <PencilIcon />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onAskDelete}
            disabled={deleteDisabled || disabled}
            aria-label={
              deleteDisabled
                ? `${row.name} — ${row.usageCount}건 상품에서 사용 중 (삭제 불가)`
                : `${row.name} 채널 삭제`
            }
            title={
              deleteDisabled
                ? `${row.usageCount}건 상품에서 사용 중`
                : "채널 삭제"
            }
            className={cn(deleteDisabled && "cursor-not-allowed opacity-40")}
          >
            <Trash2Icon />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

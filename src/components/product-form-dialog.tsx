"use client"

import * as React from "react"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import { saveProductGroup } from "@/lib/products/actions"

/**
 * 사방넷 그룹 단위 신규/수정 공용 Dialog (v1.2 Wide format).
 *
 * 사용자 입력:
 *   - 사방넷코드 (edit 모드에서는 readOnly)
 *   - 브랜드명 / 상품명 (자유 입력)
 *   - 구분 RadioGroup (단품/복합)
 *   - 채널별 상품코드 dynamic rows
 *       · "채널" Select — 등록된 채널 마스터(`channelOptions`)에서만 선택
 *       · "상품코드" Input — 영문/숫자/-/_ regex 검증
 *       · 행 삭제 버튼
 *       · "+ 채널 추가" 버튼
 *
 * 검증:
 *   - 같은 채널이 두 번 추가되면 인라인 에러
 *   - 상품코드 형식 위반 인라인 에러 (regex /^[\w-]+$/, max 64)
 *   - 비어있는 칸 인라인 에러
 *
 * 저장: `saveProductGroup(input)` — mode 무관 (sabangnetCode 가 같으면 자동 merge).
 */

export type ProductFormChannelRow = {
  /** 기존 행이면 product_master.id, 새 행이면 undefined */
  id?: number
  channelName: string
  productCode: string
}

export type ProductFormGroup = {
  sabangnetCode: string
  brandName: string
  productName: string
  isComposite: boolean
  rows: ProductFormChannelRow[]
}

export type ProductFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  /** edit 모드 시 그룹 전체. create 모드면 undefined. */
  initialGroup?: ProductFormGroup | null
  /** product_channels 등록 채널 마스터 (전체 옵션). 24개 시드. */
  channelOptions: string[]
  /** 성공 시 호출 — 보통 router.refresh() */
  onSaved?: () => void
}

type RowState = ProductFormChannelRow & {
  /** 클라이언트 측 안정 key (id 가 없는 새 행 구분용) */
  uid: string
}

type FieldErrors = {
  sabangnetCode?: string
  brandName?: string
  productName?: string
  isComposite?: string
  rows?: Array<{ channelName?: string; productCode?: string }>
  rowsTop?: string
}

const PRODUCT_CODE_PATTERN = /^[\w-]+$/

function emptyRow(): RowState {
  return {
    uid: cryptoRandomId(),
    id: undefined,
    channelName: "",
    productCode: "",
  }
}

function cryptoRandomId(): string {
  // crypto.randomUUID 가능한 환경(브라우저/Next 클라이언트). fallback for safety.
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID()
  }
  return `r-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

function rowsFromInitial(initial?: ProductFormGroup | null): RowState[] {
  if (!initial || initial.rows.length === 0) return [emptyRow()]
  return initial.rows.map((r) => ({
    uid: cryptoRandomId(),
    id: r.id,
    channelName: r.channelName,
    productCode: r.productCode,
  }))
}

export function ProductFormDialog({
  open,
  onOpenChange,
  mode,
  initialGroup,
  channelOptions,
  onSaved,
}: ProductFormDialogProps) {
  const [sabangnetCode, setSabangnetCode] = React.useState(
    initialGroup?.sabangnetCode ?? "",
  )
  const [brandName, setBrandName] = React.useState(
    initialGroup?.brandName ?? "",
  )
  const [productName, setProductName] = React.useState(
    initialGroup?.productName ?? "",
  )
  const [isCompositeStr, setIsCompositeStr] = React.useState<
    "true" | "false" | ""
  >(
    initialGroup == null
      ? ""
      : initialGroup.isComposite
        ? "true"
        : "false",
  )
  const [rows, setRows] = React.useState<RowState[]>(rowsFromInitial(initialGroup))
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const sabangnetInputRef = React.useRef<HTMLInputElement>(null)
  const brandInputRef = React.useRef<HTMLInputElement>(null)

  // open 토글 시 reset
  const prevOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      setSabangnetCode(initialGroup?.sabangnetCode ?? "")
      setBrandName(initialGroup?.brandName ?? "")
      setProductName(initialGroup?.productName ?? "")
      setIsCompositeStr(
        initialGroup == null
          ? ""
          : initialGroup.isComposite
            ? "true"
            : "false",
      )
      setRows(rowsFromInitial(initialGroup))
      setErrors({})
      setServerError(null)
      prevOpenRef.current = true
    }
    if (!open) prevOpenRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(initialGroup)])

  // 첫 포커스
  React.useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      if (mode === "edit") {
        brandInputRef.current?.focus()
      } else {
        sabangnetInputRef.current?.focus()
      }
    }, 50)
    return () => window.clearTimeout(id)
  }, [open, mode])

  function updateRow(uid: string, patch: Partial<ProductFormChannelRow>) {
    setRows((prev) =>
      prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    )
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(uid: string) {
    setRows((prev) => {
      if (prev.length <= 1) {
        // 마지막 한 행은 비우기만
        return [emptyRow()]
      }
      return prev.filter((r) => r.uid !== uid)
    })
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {}

    if (sabangnetCode.trim().length === 0) {
      next.sabangnetCode = "사방넷코드를 입력하세요"
    }
    if (brandName.trim().length === 0) {
      next.brandName = "브랜드명을 입력하세요"
    }
    if (productName.trim().length === 0) {
      next.productName = "상품명을 입력하세요"
    }
    if (isCompositeStr !== "true" && isCompositeStr !== "false") {
      next.isComposite = "구분(단품/복합)을 선택하세요"
    }

    const rowErrors: NonNullable<FieldErrors["rows"]> = rows.map(() => ({}))
    const channelSeen = new Map<string, number>()

    rows.forEach((r, idx) => {
      const ch = r.channelName.trim()
      const pc = r.productCode.trim()
      if (ch.length === 0) {
        rowErrors[idx].channelName = "채널을 선택하세요"
      } else {
        const prev = channelSeen.get(ch)
        if (prev !== undefined) {
          rowErrors[idx].channelName = `같은 채널이 ${prev + 1}번째 행에서 이미 선택되었습니다`
        } else {
          channelSeen.set(ch, idx)
        }
      }
      if (pc.length === 0) {
        rowErrors[idx].productCode = "상품코드를 입력하세요"
      } else if (pc.length > 64) {
        rowErrors[idx].productCode = "상품코드는 64자 이내"
      } else if (!PRODUCT_CODE_PATTERN.test(pc)) {
        rowErrors[idx].productCode = "영문/숫자/-/_ 만 입력 가능합니다"
      }
    })

    const hasRowError = rowErrors.some(
      (e) => e.channelName != null || e.productCode != null,
    )
    if (hasRowError) {
      next.rows = rowErrors
    }

    return next
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setServerError(null)
    const v = validate()
    setErrors(v)
    const hasErr =
      v.sabangnetCode != null ||
      v.brandName != null ||
      v.productName != null ||
      v.isComposite != null ||
      v.rowsTop != null ||
      (v.rows?.some((r) => r.channelName != null || r.productCode != null) ??
        false)
    if (hasErr) {
      toast.error("입력값을 확인해주세요")
      return
    }

    setSubmitting(true)
    try {
      const result = await saveProductGroup({
        sabangnetCode: sabangnetCode.trim(),
        brandName: brandName.trim(),
        productName: productName.trim(),
        isComposite: isCompositeStr === "true",
        rows: rows.map((r) => ({
          channelName: r.channelName.trim(),
          productCode: r.productCode.trim(),
        })),
      })
      const parts: string[] = []
      if (result.inserted > 0) parts.push(`추가 ${result.inserted}건`)
      if (result.updated > 0) parts.push(`수정 ${result.updated}건`)
      if (result.deleted > 0) parts.push(`삭제 ${result.deleted}건`)
      const summary = parts.length === 0 ? "변경 사항 없음" : parts.join(" · ")
      toast.success(`${sabangnetCode.trim()} 저장 — ${summary}`)
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다"
      setServerError(message)
      toast.error("저장 실패")
    } finally {
      setSubmitting(false)
    }
  }

  const title = mode === "edit" ? "상품 그룹 수정" : "상품 그룹 추가"

  // 이미 선택된 채널은 다른 행 Select 옵션에서 disable
  const selectedChannels = new Set(
    rows.map((r) => r.channelName.trim()).filter((s) => s.length > 0),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertTitle>저장에 실패했습니다</AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          noValidate
        >
          {/* 사방넷코드 */}
          <div className="space-y-1.5">
            <Label htmlFor="sabangnet-code">
              사방넷코드 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sabangnet-code"
              ref={sabangnetInputRef}
              value={sabangnetCode}
              onChange={(e) => setSabangnetCode(e.target.value)}
              readOnly={mode === "edit"}
              aria-readonly={mode === "edit" ? "true" : undefined}
              aria-required="true"
              aria-invalid={errors.sabangnetCode ? "true" : undefined}
              placeholder="예: SBG-1001"
              autoComplete="off"
            />
            {errors.sabangnetCode && (
              <p className="text-sm text-destructive">{errors.sabangnetCode}</p>
            )}
            {mode === "create" && !errors.sabangnetCode && (
              <p className="text-xs text-muted-foreground">
                같은 사방넷코드가 이미 있으면 채널이 합쳐집니다 (그룹 단위
                저장).
              </p>
            )}
          </div>

          {/* 브랜드명 */}
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">
              브랜드명 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="brand-name"
              ref={brandInputRef}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              aria-required="true"
              aria-invalid={errors.brandName ? "true" : undefined}
              placeholder="예: 글리치"
              autoComplete="off"
            />
            {errors.brandName && (
              <p className="text-sm text-destructive">{errors.brandName}</p>
            )}
          </div>

          {/* 상품명 */}
          <div className="space-y-1.5">
            <Label htmlFor="product-name">
              상품명 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="product-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              aria-required="true"
              aria-invalid={errors.productName ? "true" : undefined}
              placeholder="예: 워시팩"
              autoComplete="off"
            />
            {errors.productName && (
              <p className="text-sm text-destructive">{errors.productName}</p>
            )}
          </div>

          {/* 구분 */}
          <div className="space-y-1.5">
            <Label>
              구분 <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={isCompositeStr || undefined}
              onValueChange={(v: unknown) =>
                setIsCompositeStr(v as "true" | "false")
              }
              aria-required="true"
              aria-invalid={errors.isComposite ? "true" : undefined}
              className="flex gap-6"
            >
              <RadioGroupItem id="isComposite-single" value="false">
                단품
              </RadioGroupItem>
              <RadioGroupItem id="isComposite-composite" value="true">
                복합
              </RadioGroupItem>
            </RadioGroup>
            {errors.isComposite && (
              <p className="text-sm text-destructive">{errors.isComposite}</p>
            )}
          </div>

          {/* 채널별 상품코드 dynamic rows */}
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <Label>
                채널별 상품코드 <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground">
                {rows.length}개 채널 / 등록 가능 {channelOptions.length}개
              </span>
            </div>

            <div className="space-y-2">
              {rows.map((r, idx) => {
                const rowErr = errors.rows?.[idx]
                return (
                  <ChannelRowItem
                    key={r.uid}
                    index={idx}
                    row={r}
                    onChange={(patch) => updateRow(r.uid, patch)}
                    onRemove={() => removeRow(r.uid)}
                    canRemove={rows.length > 1}
                    channelOptions={channelOptions}
                    disabledChannels={selectedChannels}
                    errors={rowErr}
                  />
                )
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={selectedChannels.size >= channelOptions.length}
              aria-label="채널 행 추가"
            >
              <PlusIcon />
              채널 추가
            </Button>
            {selectedChannels.size >= channelOptions.length && (
              <p className="text-xs text-muted-foreground">
                등록 가능한 채널을 모두 추가했습니다.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ============================================================
 * ChannelRowItem — 채널 Select + 상품코드 Input + 행 삭제 버튼
 * ============================================================ */

function ChannelRowItem({
  index,
  row,
  onChange,
  onRemove,
  canRemove,
  channelOptions,
  disabledChannels,
  errors,
}: {
  index: number
  row: ProductFormChannelRow
  onChange: (patch: Partial<ProductFormChannelRow>) => void
  onRemove: () => void
  canRemove: boolean
  channelOptions: string[]
  disabledChannels: Set<string>
  errors: { channelName?: string; productCode?: string } | undefined
}) {
  const currentValue = row.channelName.trim()
  // 현재 행이 이미 선택한 채널은 본인 행에서는 항상 활성화돼야 함.
  const isOptionDisabled = (opt: string) =>
    opt !== currentValue && disabledChannels.has(opt)

  return (
    <div
      className={cn(
        "grid grid-cols-[14rem_1fr_auto] items-start gap-2 rounded-md border p-2",
      )}
    >
      <div className="space-y-1">
        <Select
          value={currentValue || undefined}
          onValueChange={(v: unknown) =>
            onChange({ channelName: String(v) })
          }
        >
          <SelectTrigger
            aria-label={`${index + 1}번째 행 채널 선택`}
            aria-invalid={errors?.channelName ? "true" : undefined}
            className="w-full"
          >
            <SelectValue placeholder="채널 선택" />
          </SelectTrigger>
          <SelectContent>
            {channelOptions.length === 0 && (
              <SelectItem value="__empty__" disabled>
                등록된 채널이 없습니다
              </SelectItem>
            )}
            {channelOptions.map((opt) => (
              <SelectItem
                key={opt}
                value={opt}
                disabled={isOptionDisabled(opt)}
              >
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors?.channelName && (
          <p className="text-xs text-destructive">{errors.channelName}</p>
        )}
      </div>

      <div className="space-y-1">
        <Input
          value={row.productCode}
          onChange={(e) => onChange({ productCode: e.target.value })}
          placeholder="상품코드 (예: ABC-001)"
          aria-label={`${index + 1}번째 행 상품코드`}
          aria-invalid={errors?.productCode ? "true" : undefined}
          autoComplete="off"
        />
        {errors?.productCode && (
          <p className="text-xs text-destructive">{errors.productCode}</p>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`${index + 1}번째 행 삭제`}
        disabled={!canRemove}
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

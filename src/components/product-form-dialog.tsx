"use client"

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { z } from "zod"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import type { ProductInput } from "@/lib/products/schema"
import {
  checkProductCodeUnique,
  createProduct,
  updateProduct,
  type ProductRow,
} from "@/lib/products/actions"

/**
 * 신규/수정 공용 Dialog.
 *
 * 02_uiux_products §4-5 와 1:1 매핑:
 *   - 상품코드: onBlur 시 `checkProductCodeUnique` 호출 + 인라인 에러
 *   - 채널명: Combobox (자유 입력 + 자동완성)
 *   - 브랜드명/상품명: 일반 Input
 *   - 구분: RadioGroup (단품/복합) — 기본값 미선택 (필수, 미선택 시 submit 비활성)
 *
 * submit:
 *   - mode="create" → createProduct
 *   - mode="edit"   → updateProduct (productCode readOnly)
 *   - unique_violation 캐치 → 폼 상단 Alert + toast.error
 */

/**
 * Form 전용 zod 스키마. `isComposite` 는 RadioGroup 의 "선택 안 함" 상태를
 * 표현하기 위해 string("true"/"false") 으로 받고, submit 시 boolean 으로 변환.
 */
const formSchema = z.object({
  productCode: z
    .string()
    .trim()
    .min(1, "상품코드를 입력하세요")
    .max(64, "상품코드는 64자 이내로 입력하세요")
    .regex(/^[\w-]+$/, "영문/숫자/하이픈/언더바만 입력 가능합니다"),
  channelName: z
    .string()
    .trim()
    .min(1, "채널명을 입력하세요")
    .max(128, "채널명은 128자 이내로 입력하세요"),
  brandName: z
    .string()
    .trim()
    .min(1, "브랜드명을 입력하세요")
    .max(64, "브랜드명은 64자 이내로 입력하세요"),
  productName: z
    .string()
    .trim()
    .min(1, "상품명을 입력하세요")
    .max(128, "상품명은 128자 이내로 입력하세요"),
  isCompositeStr: z.enum(["true", "false"], {
    message: "구분(단품/복합)을 선택하세요",
  }),
})

type FormShape = z.input<typeof formSchema>

export type ProductFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  /** edit 모드 시 대상 행 (id + 기존 값). create 모드면 undefined. */
  initial?: ProductRow | null
  /** 채널명 Combobox 자동완성 옵션 (기등록 채널 union). */
  channelOptions: string[]
  /** 성공 시 호출 — 보통 router.refresh() */
  onSaved?: () => void
}

function toFormValues(initial?: ProductRow | null): FormShape {
  return {
    productCode: initial?.productCode ?? "",
    channelName: initial?.channelName ?? "",
    brandName: initial?.brandName ?? "",
    productName: initial?.productName ?? "",
    isCompositeStr:
      initial == null
        ? ("" as unknown as "true" | "false")
        : initial.isComposite
          ? "true"
          : "false",
  }
}

export function ProductFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  channelOptions,
  onSaved,
}: ProductFormDialogProps) {
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [codeUniqueError, setCodeUniqueError] = React.useState<string | null>(
    null,
  )
  const [codeCheckPending, setCodeCheckPending] = React.useState(false)
  const [channelPopoverOpen, setChannelPopoverOpen] = React.useState(false)

  const form = useForm<FormShape>({
    // zod v4 → resolver overload 우회 (cal-amount-form-dialog 와 동일 패턴).
    resolver: zodResolver(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formSchema as unknown as any,
    ) as unknown as Resolver<FormShape>,
    defaultValues: toFormValues(initial),
    mode: "onBlur",
  })

  // open/initial 변경 시 reset
  const prevOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      form.reset(toFormValues(initial))
      const id = window.setTimeout(() => {
        setServerError(null)
        setCodeUniqueError(null)
      }, 0)
      prevOpenRef.current = true
      return () => window.clearTimeout(id)
    }
    if (!open) {
      prevOpenRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(initial)])

  // 첫 필드 포커스
  React.useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      const target = mode === "edit" ? "channelName" : "productCode"
      form.setFocus(target as keyof FormShape)
    }, 50)
    return () => window.clearTimeout(id)
  }, [open, mode, form])

  /** 상품코드 중복 검증 — onBlur 시점에 한 번 */
  async function handleCheckUnique(code: string) {
    if (mode === "edit") return // PK readonly
    const trimmed = code.trim()
    if (trimmed.length === 0) {
      setCodeUniqueError(null)
      return
    }
    // 형식 위반은 zod 가 처리 — 통과한 값만 서버 호출
    if (!/^[\w-]+$/.test(trimmed) || trimmed.length > 64) {
      setCodeUniqueError(null)
      return
    }
    setCodeCheckPending(true)
    try {
      // 본 함수는 mode === "edit" 인 경우 위에서 early-return 했으므로
      // 여기 도달 시 mode === "create" — excludeId 불필요.
      const ok = await checkProductCodeUnique(trimmed)
      setCodeUniqueError(ok ? null : "이미 등록된 상품코드입니다")
    } catch {
      // network 실패 등은 silent — submit 시 unique_violation 캐치로 최종 방어
      setCodeUniqueError(null)
    } finally {
      setCodeCheckPending(false)
    }
  }

  async function onSubmit(values: FormShape) {
    setServerError(null)

    const isComposite = values.isCompositeStr === "true"
    const input: ProductInput = {
      productCode: values.productCode.trim(),
      channelName: values.channelName.trim(),
      brandName: values.brandName.trim(),
      productName: values.productName.trim(),
      isComposite,
    }

    try {
      if (mode === "edit") {
        if (!initial) throw new Error("수정 대상이 없습니다")
        // productCode 는 readonly 이므로 patch 에서 제외
        const { productCode: _pc, ...patch } = input
        void _pc
        await updateProduct(initial.id, patch)
        toast.success(`수정됨: ${initial.productCode}`)
      } else {
        const row = await createProduct(input)
        toast.success(`추가됨: ${row.productCode}`)
      }
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다"
      setServerError(message)
      // race condition (다른 사용자가 동시 등록) → 인라인 에러도 갱신
      if (message.includes("이미 등록된 상품코드")) {
        setCodeUniqueError("이미 등록된 상품코드입니다")
      }
      toast.error("저장 실패")
    }
  }

  const title = mode === "edit" ? "상품 수정" : "상품 추가"
  const submitDisabled =
    form.formState.isSubmitting ||
    codeCheckPending ||
    codeUniqueError !== null ||
    !form.watch("isCompositeStr")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertTitle>저장에 실패했습니다</AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="productCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    상품코드 <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      readOnly={mode === "edit"}
                      aria-readonly={mode === "edit" ? "true" : undefined}
                      aria-required="true"
                      aria-invalid={codeUniqueError ? "true" : undefined}
                      placeholder="예: ABC-001"
                      autoComplete="off"
                      onBlur={(e) => {
                        field.onBlur()
                        void handleCheckUnique(e.currentTarget.value)
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                  {codeUniqueError && (
                    <p className="text-sm text-destructive">
                      {codeUniqueError}
                    </p>
                  )}
                  {!codeUniqueError && mode === "create" && (
                    <p className="text-xs text-muted-foreground">
                      시스템 전체에서 고유. 영문/숫자/하이픈/언더바.
                    </p>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="channelName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    채널명 <span className="text-destructive">*</span>
                  </FormLabel>
                  <ChannelCombobox
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    options={channelOptions}
                    open={channelPopoverOpen}
                    onOpenChange={setChannelPopoverOpen}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="brandName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    브랜드명 <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      aria-required="true"
                      placeholder="예: 글리치"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="productName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    상품명 <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      aria-required="true"
                      placeholder="예: 워시팩"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isCompositeStr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    구분 <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value || undefined}
                      onValueChange={(v: unknown) =>
                        field.onChange(v as string)
                      }
                      aria-required="true"
                      className="flex gap-6"
                    >
                      <RadioGroupItem id="isComposite-single" value="false">
                        단품
                      </RadioGroupItem>
                      <RadioGroupItem id="isComposite-composite" value="true">
                        복합
                      </RadioGroupItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                취소
              </Button>
              <Button type="submit" disabled={submitDisabled}>
                {form.formState.isSubmitting ? "저장 중…" : "저장"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/* ============================================================
 * ChannelCombobox — Popover + Command + 자유 입력
 * ============================================================ */

function ChannelCombobox({
  value,
  onChange,
  onBlur,
  options,
  open,
  onOpenChange,
}: {
  value: string
  onChange: (next: string) => void
  onBlur: () => void
  options: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = React.useState("")

  const trimmedSearch = search.trim()
  const lower = trimmedSearch.toLowerCase()
  const filtered = React.useMemo(() => {
    if (trimmedSearch.length === 0) return options
    return options.filter((o) => o.toLowerCase().includes(lower))
  }, [options, trimmedSearch, lower])

  const isNew =
    trimmedSearch.length > 0 &&
    !options.some((o) => o.toLowerCase() === lower)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-haspopup="listbox"
            onBlur={onBlur}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="truncate">{value || "채널을 선택하거나 입력하세요"}</span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="채널 검색 또는 새 채널 입력…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {trimmedSearch.length === 0
                ? "등록된 채널이 없습니다."
                : "일치하는 채널이 없습니다."}
            </CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup heading="기존 채널">
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onChange(opt)
                      setSearch("")
                      onOpenChange(false)
                    }}
                    data-checked={value === opt ? true : undefined}
                  >
                    <span className="flex-1 truncate" title={opt}>
                      {opt}
                    </span>
                    {value === opt && (
                      <CheckIcon
                        aria-hidden="true"
                        className="ml-2 size-4 opacity-100"
                      />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isNew && (
              <CommandGroup heading="새로 추가">
                <CommandItem
                  value={`__new__:${trimmedSearch}`}
                  onSelect={() => {
                    onChange(trimmedSearch)
                    setSearch("")
                    onOpenChange(false)
                  }}
                >
                  <span className="text-muted-foreground">
                    새 채널 추가:{" "}
                    <b className="text-foreground">{trimmedSearch}</b>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

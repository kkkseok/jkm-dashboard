"use client"

import * as React from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { z } from "zod"

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
import type { CalAmountInput } from "@/lib/cal-amount/schema"
import { appendCalAmount } from "@/lib/cal-amount/actions"

/**
 * 폼 전용 zod 스키마 (모든 필드 string).
 * cal_amount.xlsx 그대로의 2필드만 — productCode + extraSettlement(후정산금).
 * extraSettlement 는 string → number 변환을 submit 시 직접 수행.
 */
const formSchema = z.object({
  productCode: z
    .string()
    .trim()
    .min(1, "상품코드를 입력하세요")
    .max(64, "상품코드는 64자 이내로 입력하세요")
    .regex(/^[\w-]+$/, "영문/숫자/하이픈/언더바만 입력 가능합니다"),
  extraSettlement: z
    .string()
    .min(1, "금액을 입력하세요")
    .refine((v) => /^-?\d+$/.test(v.trim()), {
      message: "정수만 입력 가능합니다",
    }),
})

type FormShape = z.input<typeof formSchema>

/**
 * 분석/관리 페이지 양쪽에서 import 하는 **공용** 후정산금 입력 Dialog.
 *
 * append-only 모델: 저장 시 항상 새 row 추가. 같은 productCode 가 이미 있어도
 * 이력 보존되며 가장 최신(가장 큰 id) row 가 계산식 winner.
 *
 * - lockProductCode: 분석 페이지에서 행 클릭 시 productCode 자동주입 + readonly
 */
export type CalAmountFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultValues?: Partial<{
    productCode: string
    extraSettlement: number
  }>
  /** true 일 경우 productCode input 을 readonly 처리 (분석 페이지 진입 시) */
  lockProductCode?: boolean
  onSaved?: (result: { productCode: string; extraSettlement: number }) => void
}

function toFormValues(
  defaults?: CalAmountFormDialogProps["defaultValues"],
): FormShape {
  return {
    productCode: defaults?.productCode ?? "",
    extraSettlement:
      defaults?.extraSettlement !== undefined &&
      defaults?.extraSettlement !== null
        ? String(defaults.extraSettlement)
        : "",
  }
}

export function CalAmountFormDialog({
  open,
  onOpenChange,
  defaultValues,
  lockProductCode = false,
  onSaved,
}: CalAmountFormDialogProps) {
  const [serverError, setServerError] = React.useState<string | null>(null)

  const form = useForm<FormShape>({
    // zod v4 → resolver 타입 사이에 internal `_zod.version.minor` 미스매치(zod 4.4 vs resolver 가 가정하는 4.0)가 있어
    // 런타임은 정상이나 TS 추론에서 overload 가 매칭되지 않음. 스키마 인자를 캐스트해 우회.
    resolver: zodResolver(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formSchema as unknown as any,
    ) as unknown as Resolver<FormShape>,
    defaultValues: toFormValues(defaultValues),
    mode: "onBlur",
  })

  // Dialog open/defaultValues 변경 시 폼 reset.
  // open 전이를 직접 감지해 reset/서버에러 클리어. setState 는 setTimeout 으로 effect 동기 호출 회피.
  const prevOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      form.reset(toFormValues(defaultValues))
      const id = window.setTimeout(() => setServerError(null), 0)
      prevOpenRef.current = true
      return () => window.clearTimeout(id)
    }
    if (!open) {
      prevOpenRef.current = false
    }
    // defaultValues 는 stringify 비교가 더 안정적 (객체 ref 매번 바뀌므로)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(defaultValues)])

  // 첫 필드 자동 포커스 (lockProductCode 면 extraSettlement)
  React.useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      const target = lockProductCode ? "extraSettlement" : "productCode"
      form.setFocus(target as keyof FormShape)
    }, 50)
    return () => window.clearTimeout(id)
  }, [open, lockProductCode, form])

  async function onSubmit(values: FormShape) {
    setServerError(null)

    const input: CalAmountInput = {
      productCode: values.productCode.trim(),
      extraSettlement: Number(values.extraSettlement),
    }

    try {
      const row = await appendCalAmount(input)
      toast.success("추가됨")
      onSaved?.({
        productCode: row.productCode,
        extraSettlement: row.extraSettlement,
      })
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다"
      setServerError(message)
      toast.error("저장 실패")
    }
  }

  const title = "후정산금 추가"

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
                      readOnly={lockProductCode}
                      aria-readonly={lockProductCode ? "true" : undefined}
                      aria-required="true"
                      placeholder="예: P-001"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="extraSettlement"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    후정산금 (원) <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step={1}
                      inputMode="numeric"
                      aria-required="true"
                      placeholder="예: 1500 (음수 허용)"
                    />
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
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "저장 중…" : "저장"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

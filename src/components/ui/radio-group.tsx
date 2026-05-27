"use client"

import * as React from "react"
import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"

/**
 * 단순한 base-ui RadioGroup wrapper.
 *
 * 02_uiux_products §4-5 의 "구분" (단품/복합) RadioGroup 용도.
 * shadcn registry 에 `base-nova` radio-group 컴포넌트가 없어 직접 작성.
 */
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  children,
  value,
  id,
  ...rest
}: Omit<React.ComponentProps<typeof RadioPrimitive.Root>, "children"> & {
  /** 표시 라벨 텍스트 (children 으로 받아 옆에 노출) */
  children?: React.ReactNode
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 select-none",
        className,
      )}
    >
      <RadioPrimitive.Root
        id={id}
        value={value}
        className={cn(
          "relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background outline-none transition-colors",
          "data-checked:border-primary",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...rest}
      >
        <RadioPrimitive.Indicator
          className={cn("size-2 rounded-full bg-primary")}
        />
      </RadioPrimitive.Root>
      <span className="text-sm">{children}</span>
    </label>
  )
}

export { RadioGroup, RadioGroupItem }

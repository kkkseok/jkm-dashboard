---
name: shadcn-patterns
description: shadcn/ui + Tailwind + Next.js 15 App Router 코드 구현 패턴 — DataTable(TanStack), Form(react-hook-form + zod), Dialog/Sheet/Tabs, Toast(sonner), Skeleton, 페이지 레이아웃, Server Component vs Client Component 분리. Next.js 페이지/컴포넌트 작성 시 반드시 참조.
---

# shadcn/ui 구현 패턴

## 0. 셋업

```bash
pnpm dlx shadcn@latest init    # 최초 1회
pnpm dlx shadcn@latest add button input table dialog form select tabs toast skeleton alert badge
pnpm add @tanstack/react-table react-hook-form zod @hookform/resolvers
```

`components.json`이 있으면 셋업됨. 모든 컴포넌트는 `src/components/ui/`에 추가됨.

## 1. 페이지 구조 (App Router)

```tsx
// src/app/(dashboard)/minus/page.tsx  ← Server Component (기본)
import { MinusClient } from './minus-client'

export default async function MinusPage() {
  // 서버에서 DB 조회 가능. 큰 엑셀 파싱은 클라이언트로 위임.
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">마이너스 매출이익률</h1>
        <p className="text-sm text-muted-foreground">두 파일을 업로드해 손실 품목을 확인합니다.</p>
      </header>
      <MinusClient />
    </div>
  )
}
```

```tsx
// src/app/(dashboard)/minus/minus-client.tsx
'use client'
// 업로드 + 파싱 + 결과 테이블
```

**Server / Client 경계:**
- Server: DB 조회, 환경변수 접근, SEO/메타
- Client: 파일 업로드, SheetJS 파싱, 폼 상태, 인터랙티브 테이블

## 2. DataTable (TanStack + shadcn)

```tsx
'use client'
import {
  ColumnDef, flexRender, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, useReactTable, SortingState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function DataTable<T>({ data, columns }: { data: T[]; columns: ColumnDef<T>[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useReactTable({
    data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(hg => (
            <TableRow key={hg.id}>
              {hg.headers.map(h => (
                <TableHead key={h.id} onClick={h.column.getToggleSortingHandler()}
                  className="cursor-pointer select-none">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map(r => (
              <TableRow key={r.id}>
                {r.getVisibleCells().map(c => (
                  <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow><TableCell colSpan={columns.length} className="h-24 text-center">결과가 없습니다.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

**숫자 셀 공통 포맷:**
```tsx
function NumCell({ value, isRate }: { value: number | null; isRate?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">-</span>
  const formatted = isRate
    ? `${(value * 100).toFixed(1)}%`
    : new Intl.NumberFormat('ko-KR').format(Math.round(value))
  return (
    <span className={`tabular-nums text-right ${value < 0 ? 'text-red-600' : ''}`}>
      {formatted}
    </span>
  )
}
```

## 3. Form (react-hook-form + zod + shadcn)

```tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const Schema = z.object({
  productCode: z.string().min(1, '필수'),
  amount: z.coerce.number().int(),
})
type FormValues = z.infer<typeof Schema>

export function CalAmountForm({ defaultValues, onSubmit }: {
  defaultValues?: Partial<FormValues>
  onSubmit: (v: FormValues) => Promise<void>
}) {
  const form = useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField name="productCode" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>상품코드 *</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="amount" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>추가후정산금 *</FormLabel>
            <FormControl><Input type="number" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" disabled={form.formState.isSubmitting}>저장</Button>
      </form>
    </Form>
  )
}
```

zod schema는 서버 측 Server Action에서도 동일하게 import해서 검증.

## 4. Dialog 패턴 (CRUD 추가/수정)

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

<Dialog>
  <DialogTrigger asChild><Button>+ 추가</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>추가후정산금 추가</DialogTitle></DialogHeader>
    <CalAmountForm onSubmit={…} />
  </DialogContent>
</Dialog>
```

## 5. 빈/로딩/에러 패턴

```tsx
// 로딩
import { Skeleton } from '@/components/ui/skeleton'
{loading && (
  <div className="space-y-2">
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
  </div>
)}

// 에러
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
{error && (
  <Alert variant="destructive">
    <AlertTitle>처리 중 오류가 발생했습니다</AlertTitle>
    <AlertDescription>{error.message}</AlertDescription>
  </Alert>
)}

// 빈 상태
{!loading && !error && data.length === 0 && (
  <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
    아직 데이터가 없습니다. 위에서 파일을 업로드해주세요.
  </div>
)}
```

## 6. Toast (sonner)

```tsx
// src/app/layout.tsx
import { Toaster } from 'sonner'
// <body>에 <Toaster richColors position="top-center" /> 추가

// 사용
import { toast } from 'sonner'
toast.success('저장됨')
toast.error('실패: ' + msg)
```

## 7. Tabs

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

<Tabs defaultValue="analysis">
  <TabsList>
    <TabsTrigger value="analysis">분석</TabsTrigger>
    <TabsTrigger value="manage">추가후정산금 관리</TabsTrigger>
  </TabsList>
  <TabsContent value="analysis">…</TabsContent>
  <TabsContent value="manage">…</TabsContent>
</Tabs>
```

분석/관리는 **별도 페이지 권장** (URL이 분리되어 북마크/공유 가능). Tabs는 하나의 페이지에서 보조 분기에만.

## 8. Server Action 호출 패턴

```tsx
// src/lib/cal-amount/actions.ts
'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'

const Input = z.object({ productCode: z.string(), amount: z.number().int() })

export async function upsertCalAmount(values: z.infer<typeof Input>) {
  const parsed = Input.parse(values)  // 서버에서도 검증
  // db.insert(…).onConflictDoUpdate(…)
  revalidatePath('/cal-amount')
}
```

클라이언트에서:
```tsx
await upsertCalAmount(values)  // 그냥 함수 호출처럼
```

## 9. 흔한 함정

- **`"use client"` 위치.** 파일 최상단(import 위) 또는 최상단 import 다음.
- **Server Component에서 useState 사용 불가.** 즉시 빌드 에러.
- **shadcn 컴포넌트 import 경로는 `@/components/ui/*`.** 절대로 `'shadcn-ui'`나 라이브러리 import 아님.
- **TanStack table v8는 hooks 기반.** v7 자료 보지 말 것.
- **`'use server'`는 파일 최상단** 또는 함수 내부 첫 줄. 같은 파일에서 클라이언트 코드와 섞이면 안 됨.

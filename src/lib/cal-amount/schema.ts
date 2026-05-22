import { z } from 'zod'

/**
 * 공용 cal_amount 입력 zod 스키마.
 * 클라이언트(react-hook-form resolver)와 Server Action 양쪽에서 import 가능.
 *
 * cal_amount.xlsx 그대로의 2필드만 유지:
 *   - productCode (상품코드)
 *   - extraSettlement (후정산금)
 */
export const calAmountInputSchema = z.object({
  productCode: z
    .string()
    .min(1, '상품코드를 입력하세요')
    .max(64, '상품코드는 64자 이내로 입력하세요')
    .regex(/^[\w-]+$/, '영문/숫자/하이픈/언더바만 입력 가능합니다'),
  extraSettlement: z.coerce
    .number({ message: '금액을 입력하세요' })
    .int('정수만 입력 가능합니다'),
})

export type CalAmountInput = z.infer<typeof calAmountInputSchema>

/** 목록 조회용 검색/페이지네이션 파라미터 */
export const listCalAmountParamsSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
})

export type ListCalAmountParams = z.input<typeof listCalAmountParamsSchema>

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

/**
 * 대량 업로드(엑셀) 전용 **관대한** 항목 스키마.
 *
 * 폼 스키마(`calAmountInputSchema`)의 엄격한 정규식(`^[\w-]+$`)을 적용하지 않는다.
 * 대량 실데이터의 상품코드는 슬래시·공백·한글 등 다양한 형태일 수 있어,
 * import 스크립트와 동일하게 "비어있지 않은 코드 + 정수 금액" 만 보장한다.
 * 클라이언트 파싱(`parse-upload.ts`)에서 1차 검증하지만 Server Action 백스톱.
 */
export const calAmountBatchItemSchema = z.object({
  productCode: z
    .string()
    .trim()
    .min(1, '상품코드가 비어있습니다')
    .max(128, '상품코드는 128자 이내여야 합니다'),
  extraSettlement: z.coerce
    .number({ message: '후정산금이 숫자가 아닙니다' })
    .int('후정산금은 정수여야 합니다'),
})

export type CalAmountBatchItem = z.infer<typeof calAmountBatchItemSchema>

/** 한 번에 보낼 수 있는 청크 최대 크기 (다중행 INSERT). */
export const CAL_AMOUNT_BATCH_MAX = 1000

export const calAmountBatchSchema = z
  .array(calAmountBatchItemSchema)
  .max(CAL_AMOUNT_BATCH_MAX, `한 번에 ${CAL_AMOUNT_BATCH_MAX}건까지만 처리합니다`)

/** 목록 조회용 검색/페이지네이션 파라미터 */
export const listCalAmountParamsSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
})

export type ListCalAmountParams = z.input<typeof listCalAmountParamsSchema>

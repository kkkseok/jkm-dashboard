import { z } from 'zod'

/**
 * 공용 product_master 입력 zod 스키마.
 * 클라이언트(react-hook-form resolver)와 Server Action 양쪽에서 import 가능.
 *
 * 필드:
 *   - productCode (상품코드) — 시스템 전체에서 UNIQUE
 *   - channelName (채널명)
 *   - brandName   (브랜드명)
 *   - productName (상품명)
 *   - isComposite (구분: true=복합, false=단품)
 *
 * UX 결정: `isComposite` 기본값 = **선택 없음** (필수 입력, 사용자 의식적 선택).
 *   - 폼 단에서 `RadioGroup` value 를 `undefined` 로 두고 submit 전 검증.
 *   - 본 스키마는 boolean 으로 받음(타입 안전). 폼 resolver 측에서 "선택 안 함" 메시지 처리.
 */
/**
 * v1.2 (2026-05-27): 상품코드만 형식·길이 검증 유지. 나머지 4개 필드는 required(빈 값 거부) 만.
 * 한글/공백/특수문자 모두 허용 — 엑셀 그대로 받음.
 */
export const productInputSchema = z.object({
  sabangnetCode: z.string().trim().min(1, '사방넷코드를 입력하세요'),
  brandName: z.string().trim().min(1, '브랜드명을 입력하세요'),
  channelName: z.string().trim().min(1, '채널명을 입력하세요'),
  productCode: z
    .string()
    .trim()
    .min(1, '상품코드를 입력하세요')
    .max(64, '상품코드는 64자 이내로 입력하세요')
    .regex(/^[\w-]+$/, '영문/숫자/하이픈/언더바만 입력 가능합니다'),
  productName: z.string().trim().min(1, '상품명을 입력하세요'),
  isComposite: z.boolean({
    message: '구분(단품/복합)을 선택하세요',
  }),
})

export type ProductInput = z.infer<typeof productInputSchema>

/** 정렬 가능 키 — UI 헤더 클릭으로 토글 가능한 컬럼만. */
export const productSortKeys = [
  'sabangnetCode',
  'brandName',
  'channelName',
  'productCode',
  'isComposite',
  'createdAt',
] as const
export type ProductSortKey = (typeof productSortKeys)[number]

/** 목록 조회 파라미터 */
export const listProductsParamsSchema = z.object({
  /** 상품코드/상품명/브랜드/채널 부분일치(대소문자 무시) */
  search: z.string().optional(),
  /** 다중 선택 채널명. 빈 배열 = 필터 없음. */
  channel: z.array(z.string()).optional(),
  /** 단품/복합 단일 선택. undefined = 전체. */
  isComposite: z.boolean().optional(),
  sort: z.enum(productSortKeys).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
})

export type ListProductsParams = z.input<typeof listProductsParamsSchema>

/** import 옵션 */
export const importProductsOptsSchema = z.object({
  /** ON: product_code 중복 시 기존 행 덮어쓰기. OFF(기본): 건너뜀. */
  upsert: z.boolean().default(false),
})

export type ImportProductsOpts = z.input<typeof importProductsOptsSchema>

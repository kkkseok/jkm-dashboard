---
name: profit-calc
description: jkm-dashboard 마이너스 매출이익률 기능의 5개 계산 컬럼 수식 정의 — 수수료, 후정산금, 추가후정산금, 총마진액, 총마진율. 사용자가 직접 정의한 비즈니스 룰이므로 임의 변경 금지. 이익률/마진/매출이익 계산 작업 시 반드시 참조.
---

# 매출이익 계산 수식

`memory/project_minus_logic.md`와 동일한 정의의 코드 친화 버전. 사용자(`seokcess@glitzy.kr`)가 2026-05-22에 직접 확정.

## 1. 입력 변수 (sales_status_basic 기준)

| 변수명 | Excel letter | 의미 |
|--------|-------------|------|
| `K` | K | 매출액 |
| `L` | L | 공급가 |
| `M` | M | 원가 |
| `R` | R | 이익액(공급가 기준) |
| `S` | S | 이익률(공급가 기준) — 기존 값 |
| `T` | T | 이익액(판매가 기준) |
| `U` | U | 이익률(판매가 기준) — 기존 값 |

## 2. 룩업 변수

- `extraSettlement`: `cal_amount` 테이블에서 상품코드로 룩업한 금액. **상품코드가 없거나 룩업 실패 시 0** (사용자 확정).

## 3. 5개 계산 컬럼 (TypeScript)

```ts
export type ProfitInput = {
  K: number | null  // 매출액
  L: number | null  // 공급가
  R: number | null  // 이익액(공급가)
  extraSettlement: number  // cal_amount 룩업 결과 (없으면 0)
}

export type ProfitOutput = {
  commissionRate: number | null   // 수수료 (비율, 0~1)
  settlementAmount: number | null // 후정산금
  extraSettlement: number         // 추가후정산금
  totalMargin: number | null      // 총마진액
  totalMarginRate: number | null  // 총마진율 (비율)
}

export function computeProfit(input: ProfitInput): ProfitOutput {
  const { K, L, R, extraSettlement } = input

  // 1. 수수료 = 1 - (L/K). K=0 이면 null.
  const commissionRate =
    K != null && K !== 0 && L != null ? 1 - L / K : null

  // 2. 후정산금 = K * (수수료 / 2). 수수료 null이면 null.
  const settlementAmount =
    K != null && commissionRate != null ? K * (commissionRate / 2) : null

  // 3. 추가후정산금 = 룩업 결과 (없으면 0)
  // → 그대로 사용

  // 4. 총마진액 = R + 후정산금 + 추가후정산금. R 또는 후정산금 null이면 null.
  const totalMargin =
    R != null && settlementAmount != null
      ? R + settlementAmount + extraSettlement
      : null

  // 5. 총마진율 = 총마진액 / L. L=0 또는 null이면 null.
  const totalMarginRate =
    totalMargin != null && L != null && L !== 0 ? totalMargin / L : null

  return {
    commissionRate,
    settlementAmount,
    extraSettlement,
    totalMargin,
    totalMarginRate,
  }
}
```

## 4. 단위/포맷팅

| 컬럼 | 단위 | UI 표기 |
|------|------|---------|
| 수수료 | 비율(0~1) | % (소수 1자리). 예: 0.115 → "11.5%" |
| 후정산금 | 원 | `Intl.NumberFormat('ko-KR')`. 음수 빨강 |
| 추가후정산금 | 원 | 동일 |
| 총마진액 | 원 | 동일. 음수 빨강 |
| 총마진율 | 비율 | % (소수 1자리). 음수 빨강 |

## 5. 엣지 케이스 처리

| 케이스 | 처리 |
|--------|------|
| K(매출액) = 0 | 수수료 = null → 후정산금/총마진/총마진율 모두 null. UI에 "-" 표시 |
| L(공급가) = 0 | 총마진율 = null. UI에 "-" 표시. (단, 매출액 / 공급가 둘 다 0인 경우는 데이터 오염 가능성, QA 보고 대상) |
| K, L 둘 다 null | 모든 계산 값 null |
| 룩업 실패 | extraSettlement = 0, 다른 계산은 정상 진행 |
| R(이익액) null | 총마진액 = null |

## 6. 절대 변경 금지 항목

- 수수료 공식 (`1 - L/K`)
- 후정산금 공식 (`K * (수수료 / 2)`)
- 총마진액 = R + 후정산금 + **추가**후정산금
- 총마진율 분모는 L(공급가) — 매출액 K가 아님

사용자가 명시적으로 변경 지시하지 않는 한 위 공식은 유지. 일반 회계 상식과 달라 보여도 변경 금지.

## 7. 보류 항목 (확정되면 본 문서 업데이트)

- **"매출이익률 마이너스" 판정 컬럼:** 후보 — 총마진율 < 0 / 총마진액 < 0 / R < 0. 사용자가 추후 확정.
- **음수 임계값:** 0보다 작으면 마이너스인지, 특정 threshold(예: -5%) 이하만인지.

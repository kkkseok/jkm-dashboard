---
name: profit-calc
description: jkm-dashboard 마이너스 매출이익률 기능의 7개 계산 컬럼 수식 정의 — 수수료, 후정산금, 추가후정산금, 총마진액, 총마진율, 최종이익액, 최종이익률. 사용자가 직접 정의한 비즈니스 룰이므로 임의 변경 금지. 이익률/마진/매출이익 계산 작업 시 반드시 참조.
---

# 매출이익 계산 수식

`memory/project_minus_logic.md`와 동일한 정의의 코드 친화 버전. 사용자가 2026-05-22에 직접 확정.
2026-05-24 v1.2: **최종이익액 / 최종이익률 추가** — Q(물류비) 차감 후 공급가 기준 마진. totalMargin 정의에는 영향 없음(독립 보조 지표).
2026-05-26 v1.5: **추가후정산금 = cal_amount 단가 × 수량(AQ)** — revenue 의 AQ 를 가져와 cal_amount 룩업 결과에 곱해야 최종 추가후정산금이 된다.
2026-05-26 v1.6: **quantity 출처를 revenue_profit_product.AQ(판매세트 수량)로 확정**. brand.AQ 는 단품 수량이라 부적합 (예: 1세트=10개일 때 brand=20, product=2). cal_amount Dialog 입력은 여전히 1세트(단위) 기준 단가.
2026-06-08 v1.8: **묶음 상품 추가후정산금 합산**. sales 1행 ↔ revenue 여러 상품(묶음)일 때, 추가후정산금 = 주문번호의 **각 product 행마다 `cal_amount[product.Y] × product.AQ`를 구성 기여분으로 만들고 non-null 합산**(부분합). 일부 구성만 등록되면 등록분만 더하고, 전부 미등록일 때만 null. 단품(product 1행)은 v1.6 과 동일 결과. 합산 룩업 키는 **product.Y**(단품에선 brand.Y 와 동일함을 데이터로 확인). 표시는 대표 1개 + "외 N건". `computeProfit` 수식 자체는 불변 — 입력 extraSettlement 산출만 변경.
2026-06-18 v1.12: **판매현황 입력 파일을 `sales_status_mod_*` 로 변경** (사용자 확정, 옵션 A). 이 파일은 R(이익액)에 물류비(Q)가 **이미 차감**돼 있어 `revenue_profit_product` 의 **BB(최종이익액)와 정렬**된다 — 실데이터로 MOD R == BB 99.8%, OLD R == BB 3.5%. 기존 파일은 R 이 물류비 미포함이라 BB(=총마진율의 짝)와 불일치였다. `computeProfit` 수식은 **불변**(여전히 Q 항을 별도로 더하지 않음). 다만 입력 R 의미가 바뀌어 **총마진율이 실질적으로 물류비를 반영** → '마이너스(총마진율<0)' 건수가 크게 증가(예: 0618 기준 13→427, 정상이며 손실 주문을 제대로 포착). 파일 구조(33컬럼/2행 헤더/조인키 AF·AE)는 동일해 **파이프라인 코드 변경 없음**. ⚠️ R 에 Q 를 다시 더해 '물류비 제외'로 되돌리지 말 것(그건 폐기된 옵션 B).
2026-06-12 v1.9: **최종이익액/최종이익률은 더 이상 계산하지 않는다.** `revenue_profit_product` 의 **BB("공급가기준 이익액")·BC("공급가기준 이익율")** 값을 파이프라인이 직접 읽어 그대로 표시한다(묶음은 대표=첫 행 값). 추가로 **원가총액(BA)** 컬럼 신규 표시(공급가↔이익액 사이). BC 는 `#,##0.00"%"` 서식이라 raw 가 퍼센트 수치 → /100 로 비율 변환(§3-1). 따라서 `computeProfit` 은 Q(물류비)를 받지 않으며 출력에서 finalProfit 계열이 빠진다 — 이제 `computeProfit` 은 **5개 컬럼**(수수료/후정산금/추가후정산금/총마진액/총마진율)만 산출. 총마진액 정의는 불변(여전히 Q 무관). cal_amount 셀 편집 재계산도 finalProfit/finalProfitRate 를 건드리지 않는다(파일 값 보존).
2026-06-24 v1.13: **최종이익률에 공급가 0 폴백 추가.** v1.11(64df308)에서 최종이익률을 ΣBB/공급가(L) **재계산**으로 바꾼 뒤로, **공급가(L)=0/null 인 행**은 재계산이 0으로 나눠져 빈칸이 됐다(0624 실데이터 26건: 단품 24 + 묶음 2). 사용자 확정 — 이런 행만 **product 대표행의 BC(% 수치)를 /100 해 폴백**해 파일값을 그대로 표시한다(v1.9 이전 동작 복원). 정상(L≠0)은 여전히 ΣBB/L 재계산(묶음 정확성 불변). 공급액 0 단품의 BC 는 원본이 -100 센티넬을 박아두므로 화면에 -100% 로 노출됨(실제 손실률 아님). 최종이익액(BB)이 없으면 폴백도 안 함. 또 **수수료 제거 규칙 D 추가**(§아래·calc.ts): brand 조인은 성공했으나 브랜드명(BF)만 빈 칸인 자사상품(메티스/JKM 제습제 등, 비제일제당)은 수수료·후정산금을 제거한다(진짜 조인 실패=상품코드도 없음만 현행 유지).

## 1. 입력 변수 (sales_status_basic 기준)

| 변수명 | Excel letter | 의미 |
|--------|-------------|------|
| `K` | K | 매출액 |
| `L` | L | 공급가 |
| `M` | M | 원가 |
| `Q` | Q | **물류비** (v1.2 추가) |
| `R` | R | 이익액(공급가 기준) |
| `S` | S | 이익률(공급가 기준) — 기존 값 |
| `T` | T | 이익액(판매가 기준) |
| `U` | U | 이익률(판매가 기준) — 기존 값 |

## 2. 룩업·매핑 변수

- `quantity` (**revenue_profit_product.AQ**): 판매세트 수량. product 조인 실패 시 null. (v1.6 출처 확정)
  - brand.AQ 는 단품 수량이라 사용하지 않음 — 예: "비비고 60g x10개" 1세트일 때 brand.AQ=10, product.AQ=1.
- `extraSettlement`: **cal_amount 단가 × quantity** (= 최종 추가후정산금). v1.5 변경 / v1.6 출처 확정.
  - **묶음(v1.8 2026-06-08, v1.10 2026-06-12 전표 단위로 변경)**: **전표번호(F base)** 의 product 행마다 기여분 `extra = cal_amount[product.Y] × product.AQ` 를 구하고, non-null 들을 합산(부분합). 전부 null 이면 extraSettlement = null. 파이프라인은 각 행에 구성 내역 `components: {productCode, quantity, extra}[]` 를 보존해 클라이언트 재계산(한 구성 단가 변경 시 그 기여분만 교체)을 가능케 한다. (한 주문에 전표 여러 개면 라인별로 분리 — 주문 전체를 합치지 않는다.)
  - cal_amount Dialog 입력값(perUnit)은 1세트 기준 단가.
  - 룩업 실패 OR quantity null → `extraSettlement = null` (계산 시 `?? 0` 으로 처리).

## 3. 계산 컬럼 (TypeScript)

`computeProfit` 은 **5개**(수수료/후정산금/추가후정산금/총마진액/총마진율)를 산출한다.
**최종이익액·최종이익률은 계산 대상이 아니다** — `revenue_profit_product` 의 BB/BC 를 파이프라인이
직접 읽어 EnrichedRow 에 주입한다(§3-1). 따라서 `computeProfit` 입력에서 Q 가 빠진다.

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

  // 3. 추가후정산금 = cal_amount 단가 × quantity (없으면 null, 계산 시 ?? 0)
  // → 파이프라인에서 미리 계산되어 extraSettlement 로 넘어옴

  // 4. 총마진액 = R + 후정산금 + 추가후정산금. R 또는 후정산금 null이면 null.
  //    Q(물류비) 는 totalMargin 정의에 포함하지 않음 (사용자 확정 2026-05-24).
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

### 3-1. 원가 / 최종이익액 / 최종이익률 — v1.9~v1.11 (2026-06-12 사용자 확정)

실제 파일(`revenue_profit_product_0612.xlsx`)로 검증한 컬럼. 헤더가 2행 병합이라 눈으로 세면 어긋난다.
**묶음(한 전표에 product 여러 행)은 금액을 합산**한다(대표값 아님). 단품 전표는 1건이라 그대로.

| 값 | 산출 | 비고 |
|------|------|------|
| 원가 (`cost`) | Σ **BA**("원가총액", `#,##0`) | 전표 구성 상품 합산(=총원가, sales.M 과 일치). 표시 위치=공급가(L)와 이익액(R) 사이. 반품 음수. (AZ "원가"=단가는 미사용) |
| 최종이익액 (`finalProfit`) | Σ **BB**("공급가기준 이익액", `#,##0`) | 전표 구성 상품 합산(=총이익액) |
| 최종이익률 (`finalProfitRate`) | **재계산** = 총최종이익액 / 공급가(L). 단 **L=0/null 이면 product 대표행 BC/100 폴백**(v1.13) | 구성별 BC=BB/공급액(AV)×100, Σ공급액(AV)=L → **단품은 BC/100 과 동일**(회귀 없음), 묶음은 ΣBB/L. **L=0/null** 이라 재계산 불가하면 파일 BC(% 수치)를 /100 해 폴백(이익액 null 이면 폴백도 null). 공급액 0 단품 BC=-100 센티넬 → -100% 표시 |

- 합산/재계산은 **전표번호(F base) 그룹** 기준. 한 주문에 전표가 여러 개면 각 라인이 별도 행·별도 합산.
- 표시 정보(상품명·상품코드·수취인명·브랜드)는 전표의 **대표(첫=-001) 행** 값.
- product 매칭 실패 시 cost/finalProfit/finalProfitRate = null.
- letter 정의는 `src/lib/minus/mapping.ts` `PRODUCT_MAPPING.fields.cost(BA)/finalProfit(BB)/finalProfitRate(BC)`. finalProfitRate 의 BC 는 **공급가 0 폴백 전용**(정상은 재계산).
- cal_amount 셀 편집 재계산은 이 세 값을 건드리지 않는다(product 파일 기준 값).

## 4. 단위/포맷팅

| 컬럼 | 단위 | UI 표기 |
|------|------|---------|
| 수수료 | 비율(0~1) | % (소수 1자리). 예: 0.115 → "11.5%" |
| 후정산금 | 원 | `Intl.NumberFormat('ko-KR')`. 음수 빨강 |
| 추가후정산금 | 원 | 동일 |
| 총마진액 | 원 | 동일. 음수 빨강 |
| 총마진율 | 비율 | % (소수 1자리). 음수 빨강 |
| 물류비 (Q) | 원 | 동일. 음수 빨강 (실데이터는 보통 양수) |
| 최종이익액 | 원 | 동일. 음수 빨강 |
| 최종이익률 | 비율 | % (소수 1자리). 음수 빨강 |

## 5. 엣지 케이스 처리

| 케이스 | 처리 |
|--------|------|
| K(매출액) = 0 | 수수료 = null → 후정산금/총마진/총마진율 모두 null. UI에 "-" 표시 |
| L(공급가) = 0 | 총마진율 = null. UI에 "-" 표시. **최종이익률은 재계산 불가 → product BC/100 폴백**(v1.13). 최종이익액(BB)이 있으면 폴백값 표시, 없으면 null |
| L(공급가) null | 총마진율 = null. **최종이익률도 동일하게 BC/100 폴백**(v1.13) |
| K, L 둘 다 null | 수수료~총마진율 전부 null |
| 룩업 실패 (cal_amount) | extraSettlement = 0, 다른 계산은 정상 진행 |
| R(이익액) null | 총마진액 = null (최종이익액/최종이익률은 파일 값이라 무관) |
| product 조인 실패 | **원가/최종이익액/최종이익률 = null** (BA/BB/BC 를 읽을 행이 없음). UI에 "-" 표시 |

## 6. 절대 변경 금지 항목

- 수수료 공식 (`1 - L/K`)
- 후정산금 공식 (`K * (수수료 / 2)`)
- 총마진액 = R + 후정산금 + **추가**후정산금 (수식에 Q 항을 추가하지 않음 — v1.12: mod 파일부터 R 자체에 물류비 차감 반영, R 은 그대로 사용·복원 금지). 추가후정산금은 cal_amount 단가 × quantity 의 결과 (v1.5)
- 총마진율 분모는 L(공급가) — 매출액 K가 아님
- 최종이익액은 `revenue_profit_product` **BB**(전표 구성 합산). 최종이익률은 **ΣBB/공급가(L) 재계산**(묶음 정확성), **단 L=0/null 폴백은 product 대표행 BC/100**(v1.13). 원가는 BA(원가총액) (v1.9 사용자 확정). ~~v1.2: R−Q~~ 폐기

사용자가 명시적으로 변경 지시하지 않는 한 위 공식은 유지. 일반 회계 상식과 달라 보여도 변경 금지.

## 7. 보류 항목 (확정되면 본 문서 업데이트)

- **"매출이익률 마이너스" 판정 컬럼:** 후보 — 총마진율 < 0 / 총마진액 < 0 / R < 0 / **최종이익액 < 0** / **최종이익률 < 0**. 사용자가 추후 확정. (v1.2 추가 후보 2개)
- **음수 임계값:** 0보다 작으면 마이너스인지, 특정 threshold(예: -5%) 이하만인지.

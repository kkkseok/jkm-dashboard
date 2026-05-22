---
name: excel-mapping
description: Excel 파일을 SheetJS(xlsx)로 안전하게 파싱하고, 병합된 헤더 구조를 다루고, 두 시트를 키로 LEFT JOIN하고, Excel column letter(A, B, …, AE)로 컬럼을 식별하는 패턴. xlsx/sheet/엑셀 업로드/파싱/매핑/JOIN 작업 시 반드시 참조.
---

# Excel 파싱 및 매핑 패턴

`jkm-dashboard`의 입력 파일은 **2행짜리 병합 헤더**를 가진 엑셀이다. 한글 헤더 텍스트는 인코딩과 병합으로 인해 라이브러리에 따라 다르게 읽힌다. 안정적인 식별자는 **Excel column letter**(A, B, …, AE, AF, AG)이다.

## 1. SheetJS 기본 (클라이언트사이드)

```ts
import * as XLSX from 'xlsx'

async function parseFile(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  // header: 1 → 2차원 배열(행 단위), 컬럼명 가공 없음
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
}
```

- **`header: 1`이 핵심.** 객체로 변환하면 SheetJS가 자동 생성한 키(`__EMPTY`, `__EMPTY_1`)에 의존하게 되어 불안정.
- **`raw: true`로 숫자/날짜 유지.** 문자열 변환 강제 금지.

## 2. Column letter ↔ 인덱스

```ts
// A=0, B=1, …, Z=25, AA=26, AB=27, …, AE=30
export function colToIdx(letter: string): number {
  let n = 0
  for (const ch of letter.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

export function idxToCol(idx: number): string {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
```

테스트: `colToIdx('A') === 0`, `colToIdx('AE') === 30`, `idxToCol(30) === 'AE'`.

## 3. 병합 헤더 건너뛰기

입력 파일은 첫 2행이 보통 병합된 헤더 영역이다. 데이터 시작 인덱스를 결정해야 한다.

```ts
const HEADER_ROWS = 2  // sales_status_basic.xlsx 기준
const dataRows = allRows.slice(HEADER_ROWS).filter(r => r.some(c => c != null))
```

- 빈 행 필터링 필수 (엑셀 끝에 공백 행이 흔함).
- 헤더 행 수가 파일마다 다를 수 있다. 시트별로 명시.

## 4. 안전한 셀 읽기

```ts
type Cell = string | number | null

export function readNum(row: unknown[], colLetter: string): number | null {
  const v = row[colToIdx(colLetter)]
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  // "1,000" 같은 문자열 숫자 방어
  const cleaned = String(v).replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function readStr(row: unknown[], colLetter: string): string | null {
  const v = row[colToIdx(colLetter)]
  if (v == null) return null
  return String(v).trim() || null
}
```

## 5. LEFT JOIN 패턴 (Map 기반 O(n))

```ts
type Row = unknown[]

export function leftJoin(
  leftRows: Row[],
  rightRows: Row[],
  leftKeyCol: string,  // 예: 'AE' (online_order_no)
  rightKeyCol: string, // 예: 'E'  (order_no)
): Array<{ left: Row; right: Row | null }> {
  const idx = new Map<string, Row>()
  const rk = colToIdx(rightKeyCol)
  for (const r of rightRows) {
    const k = r[rk]
    if (k != null && k !== '') idx.set(String(k), r)
  }

  const lk = colToIdx(leftKeyCol)
  return leftRows.map(l => {
    const k = l[lk]
    const right = k != null && k !== '' ? idx.get(String(k)) ?? null : null
    return { left: l, right }
  })
}
```

- **양쪽 키 모두 `String()`으로 정규화.** 한쪽이 문자열, 한쪽이 숫자일 수 있다.
- **중복 키가 있으면 마지막 행이 이김** (위 구현). 첫 행을 유지하려면 `if (!idx.has(…))` 가드.

## 6. 매핑 명세 → 코드 분리

매핑 규칙은 코드에 흩뿌리지 말고 **단일 설정 객체로 모은다**:

```ts
// src/lib/minus/mapping.ts
export const MINUS_MAPPING = {
  base: {
    file: 'sales_status_basic',
    headerRows: 2,
    keyCol: 'AE' as const,
    fields: {
      salesAmount: 'K',
      supplyPrice: 'L',
      cost: 'M',
      profitSupply: 'R',
      onlineOrderNo: 'AE',
    },
  },
  lookup: {
    file: 'revenue_profit_product',
    headerRows: 2,
    keyCol: 'E' as const,
    fields: {
      productCode: 'Y',
      productName: 'AG',
    },
  },
} as const
```

이후 수식/매핑 규칙이 바뀌면 이 객체만 수정.

## 7. 흔한 함정

- **날짜 셀이 숫자(serial)로 들어옴.** `cellDates: true` 옵션 또는 `XLSX.SSF.parse_date_code(n)`로 변환.
- **셀이 수식이면 결과값(`.v`)이 비어있을 수 있음.** SheetJS는 보통 계산값을 같이 제공하지만, 그렇지 않은 파일도 있음.
- **시트 이름이 영어가 아닐 수 있음.** `wb.Sheets[wb.SheetNames[0]]` 또는 명시적 이름 매핑.
- **파일이 .xls(구버전)일 가능성.** SheetJS는 둘 다 지원하지만 셀 정밀도 차이 있음.
- **사용자가 잘못된 파일을 업로드한 경우.** 컬럼 letter 위치에 기대 데이터 타입이 안 맞으면 즉시 진단 메시지 + 거부.

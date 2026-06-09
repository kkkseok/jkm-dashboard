/**
 * 그룹 업로드 생성 파이프라인 타입.
 *
 * 흐름: no_mapping.xlsx 클라이언트 파싱 → NoMappingLine[] → Server Action(resolveGroupUpload)
 *       → ResolveResult → 클라이언트에서 group_upload.xlsx 빌드/다운로드.
 */

/** no_mapping 한 주문 행(파싱 결과, 마켓코드 dedup 전). */
export type NoMappingLine = {
  marketCode: string
  /** 마켓명 원문(C). 채널 정규화 입력. */
  marketName: string
  /** 마켓 상품명(I). 미매핑 경고 표시용. */
  marketProductName: string
}

/** group_upload 출력 한 행(채워지는 컬럼만; 나머지는 빌드 시 공란). */
export type OutputRow = {
  /** A 그룹일련번호. 매핑 성공 그룹마다 입력 순서대로 1..N. */
  groupNo: number
  /** B 그룹상품명. buildGroupName 결과. 묶음은 전 내품 행에 동일 값. */
  groupName: string
  /** E 순번. 그룹 내 1..N (단품은 1). */
  seq: number
  /** F 상품코드 (ERPia). */
  erpCode: string
  /** G 상품명 (ERPia). */
  erpName: string
  /** I 수량. 단품=market_map.quantity / 묶음=bundle_item.quantity. */
  quantity: number
  /** M 자체코드. 단품=selfCode / 묶음=내품 selfCode. */
  selfCode: string
}

/** 매핑 실패(A 정책: 출력 제외 + 경고) 한 건. */
export type UnmappedLine = {
  marketCode: string
  marketProductName: string
  /** 실패 사유(시장맵 없음 / erp 없음 / 묶음 없음 등). */
  reason: string
}

export type ResolveResult = {
  rows: OutputRow[]
  unmapped: UnmappedLine[]
  stats: {
    /** 입력 주문 행 수(dedup 전). */
    inputCount: number
    /** 마켓코드 중복으로 합쳐진 수(첫 등장만 등록). */
    dupCount: number
    /** 매핑 성공 그룹(=출력 그룹일련번호) 수. */
    groupCount: number
    /** 출력 행 수(묶음 내품 펼친 총수). */
    rowCount: number
    /** 미매핑 건수. */
    unmappedCount: number
  }
}

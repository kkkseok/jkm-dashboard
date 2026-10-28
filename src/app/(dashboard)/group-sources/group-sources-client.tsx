"use client"

import { useRouter } from "next/navigation"

import { UploadCard } from "@/components/excel-upload-card"
import { parseProductInfo, parseProductMasterRaw } from "@/lib/group/parse"
import {
  uploadProductInfoData,
  uploadProductMasterData,
} from "@/lib/group/upload"
import type { GroupSourceStatus } from "@/lib/group/actions"
import type {
  ProductInfoParseResult,
  ProductMasterParseResult,
} from "@/lib/group/types"

const koInt = new Intl.NumberFormat("ko-KR")

export function GroupSourcesClient({ status }: { status: GroupSourceStatus }) {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          현황 · 마켓 {koInt.format(status.marketCount)} · 묶음{" "}
          {koInt.format(status.bundleCount)} · ERP {koInt.format(status.erpCount)}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard<ProductMasterParseResult>
          title="상품 마스터 원본"
          description="product_master.xlsx 원본. 마켓코드 → 자체코드·상품명·구성수량과 묶음 구성을 갱신합니다."
          lastCount={status.marketCount}
          lastUpdatedAt={status.marketUpdatedAt}
          parse={parseProductMasterRaw}
          upload={uploadProductMasterData}
          warnings={(p) => p.warnings}
          doneToast={(p) =>
            `상품 마스터 ${koInt.format(p.stats.marketCount)}건 적재 완료`
          }
          onDone={() => router.refresh()}
          renderPreview={(p) => (
            <div className="space-y-1">
              <p>
                마켓코드{" "}
                <span className="font-medium tabular-nums">
                  {koInt.format(p.stats.marketCount)}
                </span>
                건 · 묶음{" "}
                <span className="font-medium tabular-nums">
                  {koInt.format(p.stats.bundleCount)}
                </span>
                개(내품 {koInt.format(p.stats.bundleItemCount)})
              </p>
              <p className="text-xs text-muted-foreground">
                마켓코드 중복 {koInt.format(p.stats.dupMarketCount)} · 묶음수식 실패{" "}
                {koInt.format(p.stats.bundleFormulaFailCount)} (첫 등장/표준수식만 반영)
              </p>
              <p
                className="text-xs text-muted-foreground"
                title={p.layout.channelNames.join(", ")}
              >
                인식 · 헤더 {p.layout.headerRow}행 · 채널{" "}
                {koInt.format(p.layout.channelNames.length)}종(
                {p.layout.channelRange.first}~{p.layout.channelRange.last}) · 묶음 기준{" "}
                {p.layout.bundleFormulaLabel} · {p.layout.cols.bundleFormula}열
              </p>
            </div>
          )}
        />

        <UploadCard<ProductInfoParseResult>
          title="ERP 코드"
          description="product_info.xlsx. 자체코드 → ERPia 상품코드·상품명 매핑을 갱신합니다."
          lastCount={status.erpCount}
          lastUpdatedAt={status.erpUpdatedAt}
          parse={parseProductInfo}
          upload={uploadProductInfoData}
          warnings={(p) => p.warnings}
          doneToast={(p) => `ERP 코드 ${koInt.format(p.stats.erpCount)}건 적재 완료`}
          onDone={() => router.refresh()}
          renderPreview={(p) => (
            <div className="space-y-1">
              <p>
                ERP 코드{" "}
                <span className="font-medium tabular-nums">
                  {koInt.format(p.stats.erpCount)}
                </span>
                건
              </p>
              <p className="text-xs text-muted-foreground">
                자체코드 중복 {koInt.format(p.stats.dupSelfCount)} (첫 등장만 반영)
              </p>
            </div>
          )}
        />
      </div>
    </div>
  )
}

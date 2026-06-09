import { getGroupSourceStatus } from "@/lib/group/actions"
import { GroupSourcesClient } from "./group-sources-client"

/**
 * 그룹 매핑 소스 관리 페이지.
 *
 * 상품 마스터 raw(product_master.xlsx) + ERP 코드표(product_info.xlsx)를 업로드해
 * group_market_map / group_bundle_item / group_erp_code 를 통째로 갱신한다.
 * 기존 /products(상품 마스터, minus용)와는 별개의 그룹 업로드 전용 매핑이다.
 */
export default async function GroupSourcesPage() {
  const status = await getGroupSourceStatus()
  return <GroupSourcesClient status={status} />
}

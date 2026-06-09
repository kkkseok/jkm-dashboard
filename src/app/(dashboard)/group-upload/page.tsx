import { getGroupSourceStatus } from "@/lib/group/actions"
import { GroupUploadClient } from "./group-upload-client"

/**
 * 그룹 업로드 생성 페이지.
 *
 * no_mapping.xlsx(매핑 안 된 주문)를 올리면 group_market_map/group_bundle_item/group_erp_code 로
 * 매핑해 group_upload.xlsx(그룹 상품 등록 파일)를 만들어 다운로드한다.
 * 소스 3종은 /group-sources 에서 미리 적재돼 있어야 한다.
 */
export default async function GroupUploadPage() {
  const status = await getGroupSourceStatus()
  return <GroupUploadClient sourceReady={status.marketCount > 0} status={status} />
}

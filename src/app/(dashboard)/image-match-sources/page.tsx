import { connection } from "next/server"
import { getMatchSourceStatus } from "@/lib/match/actions"
import { MatchSourcesClient } from "./match-sources-client"

/**
 * 이미지 대조 대상 관리 페이지.
 *
 * 자재코드 / 자재명 / GS URL / 본사(CJ더마켓) URL 엑셀을 올려 match_pair 에 누적 upsert 한다.
 * 등록된 쌍은 파일에서 빠져도 남아 매 배치마다 계속 확인된다.
 *
 * connection(): 등록 현황은 업로드·배치로 계속 바뀌므로 빌드 시 정적 생성하지 않고 요청마다 렌더한다.
 */
export default async function ImageMatchSourcesPage() {
  await connection()
  const status = await getMatchSourceStatus()
  return <MatchSourcesClient status={status} />
}

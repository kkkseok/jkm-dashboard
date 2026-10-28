import { connection } from "next/server"
import { getMatchDashboard } from "@/lib/match/dashboard-actions"
import { MatchDashboardClient } from "./match-dashboard-client"

/** 마지막 정상 배치가 이보다 오래되면 경고 (매일 03:00 KST 실행 기준, 지연·실패 감지). */
const STALE_HOURS = 36

/**
 * 이미지 대조 대시보드.
 *
 * CJ더마켓(원본) ↔ GS샵 썸네일·상세 대조 결과를 보여주고, 사용자가 GS 를 고친 뒤 "처리 완료"를 표시한다.
 * 수집·판정은 GitHub Actions 배치(scripts/match/run.ts)가 하고, 이 화면은 DB 를 읽고 상태만 바꾼다.
 *
 * connection(): 배치·사용자 조작으로 계속 바뀌는 데이터라 요청마다 렌더한다.
 * 경과 시간은 DB now() 로 계산해 넘긴다(서버/브라우저 시각 차이로 인한 hydration 불일치 방지).
 */
export default async function ImageMatchPage() {
  await connection()
  const data = await getMatchDashboard()
  const stale = data.hoursSinceSuccess == null || data.hoursSinceSuccess > STALE_HOURS
  return <MatchDashboardClient data={data} stale={stale} />
}

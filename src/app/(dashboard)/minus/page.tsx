import { MinusAnalyzeClient } from "./minus-analyze-client"

/**
 * 마이너스 매출이익률 분석 페이지.
 *
 * Server Component — 정적 페이지로 둔다 (cal_amount 조회는 "분석 시작" 시점에
 * 클라이언트가 getCalAmountMap() Server Action 을 호출하는 패턴).
 *
 * 큰 엑셀 두 개를 업로드 → 클라이언트사이드에서 SheetJS 파싱 → enrichMinusData()
 * 호출 → KPI/테이블 렌더. 서버로 파일을 보내지 않아 Vercel 함수 타임아웃(10s) 회피.
 *
 * 명세: _workspace/02_uiux_minus.md §4 (v1.1)
 */
export default function MinusPage() {
  return <MinusAnalyzeClient />
}

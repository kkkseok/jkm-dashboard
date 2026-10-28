import { redirect } from "next/navigation"

/**
 * 예전 "이미지 대조 대상" 관리 페이지 주소.
 * 업로드는 /image-match 의 [대상 엑셀 업로드] 대화창으로 옮겼다(2026-10-28) — 북마크 대비 이동만 한다.
 */
export default function ImageMatchSourcesPage() {
  redirect("/image-match")
}

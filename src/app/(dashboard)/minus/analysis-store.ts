/**
 * 마이너스 분석 결과 저장소.
 *
 * 두 계층:
 *  1) 메모리(모듈 스코프) — 메뉴 이동(SPA 네비게이션)은 페이지를 새로고침하지 않으므로
 *     컴포넌트 밖 메모리에 두면 돌아왔을 때 즉시 복원. 용량 제한 없음.
 *  2) IndexedDB — 전체 새로고침/다음 방문 복원용. localStorage(보통 5MB)는 수천 행 결과에
 *     용량 초과로 실패하므로 IndexedDB(수백 MB)로 영속화.
 *
 * 분석 결과는 EnrichedRow[] (수천 행) 라 직렬화 비용이 크다. 메모리 계층이 일상적인
 * 메뉴 이동을 커버하고, IndexedDB 는 debounce 후 비동기로만 쓴다.
 */

import type { EnrichedRow, PipelineDiagnostics } from "@/lib/minus/types"

export type RowWithId = EnrichedRow & { _rowId: number }

/**
 * 스냅샷 스키마 버전 — EnrichedRow 의미가 바뀌면 올린다. 다르면 옛 캐시는 조용히 폐기.
 *  2: 2026-06-12 — finalProfit/finalProfitRate 를 product 파일 BB/BC 값으로, 원가총액(cost, BA) 컬럼 추가.
 *     (이전엔 finalProfit=R-Q 계산값이라 그대로 복원하면 잘못된 수치가 정상값처럼 보임 → 무효화.)
 *  3: 2026-06-12 — 조인 키를 주문번호 → 전표번호로 변경. 다중 라인 주문이 라인별로 분리되고
 *     추가후정산금이 전표 단위로 재계산되어 옛 스냅샷과 행 의미가 다름 → 무효화.
 */
const SCHEMA_VERSION = 3

export type AnalysisSnapshot = {
  rows: RowWithId[]
  diagnostics: PipelineDiagnostics
  analyzedFileNames: { sales: string; revenue: string; product: string }
  analyzedAt: string // ISO
  /** saveToIDB 가 스탬프. loadFromIDB 가 현재 SCHEMA_VERSION 과 다르면 폐기. 클라이언트는 설정 불필요. */
  schemaVersion?: number
}

/* ---------------------------------------------------------------
 * 1) 메모리 계층 (메뉴 이동 복원)
 * --------------------------------------------------------------- */

let memorySnapshot: AnalysisSnapshot | null = null

export function getMemorySnapshot(): AnalysisSnapshot | null {
  return memorySnapshot
}

export function setMemorySnapshot(snap: AnalysisSnapshot | null): void {
  memorySnapshot = snap
}

/* ---------------------------------------------------------------
 * 2) IndexedDB 계층 (새로고침/다음 방문 복원)
 * --------------------------------------------------------------- */

const DB_NAME = "jkm-minus"
const STORE = "analysis"
const KEY = "last" // 단일 레코드(마지막 분석 1건)
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadFromIDB(): Promise<AnalysisSnapshot | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    const db = await openDB()
    return await new Promise<AnalysisSnapshot | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => {
        const v = req.result as AnalysisSnapshot | undefined
        const valid =
          !!v && Array.isArray(v.rows) && !!v.diagnostics
        // 스키마 버전 불일치(또는 버전 없는 옛 스냅샷) → 조용히 폐기 + 캐시 삭제.
        if (valid && v!.schemaVersion === SCHEMA_VERSION) {
          resolve(v!)
        } else {
          if (valid) void clearIDB() // 옛 스키마 레코드는 지워 다음 방문에 다시 안 읽히게.
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
    })
  } catch {
    return null
  }
}

export async function saveToIDB(snap: AnalysisSnapshot): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false
  try {
    const db = await openDB()
    const stamped: AnalysisSnapshot = { ...snap, schemaVersion: SCHEMA_VERSION }
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(stamped, KEY)
      tx.oncomplete = () => {
        db.close()
        resolve(true)
      }
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
  }
}

async function clearIDB(): Promise<void> {
  if (typeof indexedDB === "undefined") return
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => resolve()
    })
  } catch {
    // ignore
  }
}

/** 메모리 + IndexedDB 양쪽 초기화 (재업로드/리셋 시). */
export function clearAnalysis(): void {
  memorySnapshot = null
  void clearIDB()
}

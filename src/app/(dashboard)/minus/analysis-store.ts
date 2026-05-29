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

export type AnalysisSnapshot = {
  rows: RowWithId[]
  diagnostics: PipelineDiagnostics
  analyzedFileNames: { sales: string; revenue: string; product: string }
  analyzedAt: string // ISO
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
        resolve(
          v && Array.isArray(v.rows) && v.diagnostics ? v : null,
        )
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
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(snap, KEY)
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

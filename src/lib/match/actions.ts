'use server'

import { db } from '@/db/client'
import { matchPair, matchStatusLog } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { CJ_URL_RE, GS_URL_RE } from './mapping'
import {
  type MatchPairInput,
  type MatchUploadDiff,
  type MatchUploadResult,
} from './types'

/**
 * 이미지 대조 대상 Server Action.
 *
 * 업로드는 **누적 upsert**(사용자 확정 2026-10-28): 파일에 없는 기존 쌍은 건드리지 않는다.
 *   - 신규 자재코드 → insert (status 'new')
 *   - URL 변경 → URL 갱신 + status 'new' 로 초기화 + 상태 이력(actor 'upload')
 *   - 상품명만 변경 → 상품명만 갱신 (상태 유지)
 * 대상은 ≤500쌍 규모라 한 번의 호출로 보낸다(Server Action body 1MB 이내).
 */

/** 한 번에 받을 최대 행 수 — body 제한·실수 업로드 방지. */
const MAX_ROWS = 3000

/** 클라이언트 파싱 결과를 서버에서 다시 검증한다. */
function validate(rows: MatchPairInput[]): void {
  if (rows.length > MAX_ROWS) {
    throw new Error(`한 번에 최대 ${MAX_ROWS}건까지 업로드할 수 있습니다 (${rows.length}건).`)
  }
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.matCode) throw new Error('자재코드가 빈 행이 있습니다.')
    if (seen.has(r.matCode)) throw new Error(`자재코드 중복: ${r.matCode}`)
    seen.add(r.matCode)
    if (!CJ_URL_RE.test(r.cjUrl)) throw new Error(`본사 URL 형식 오류: ${r.matCode}`)
    if (!GS_URL_RE.test(r.gsUrl)) throw new Error(`GS URL 형식 오류: ${r.matCode}`)
  }
}

type Existing = { id: number; matCode: string; productName: string; cjUrl: string; gsUrl: string; status: string }

async function loadExisting(matCodes: string[]): Promise<Map<string, Existing>> {
  if (matCodes.length === 0) return new Map()
  const found = await db
    .select({
      id: matchPair.id,
      matCode: matchPair.matCode,
      productName: matchPair.productName,
      cjUrl: matchPair.cjUrl,
      gsUrl: matchPair.gsUrl,
      status: matchPair.status,
    })
    .from(matchPair)
    .where(inArray(matchPair.matCode, matCodes))
  return new Map(found.map((e) => [e.matCode, e]))
}

type Classified = {
  inserts: MatchPairInput[]
  urlChanged: { row: MatchPairInput; prev: Existing }[]
  nameChanged: { row: MatchPairInput; prev: Existing }[]
  unchanged: number
}

function classify(rows: MatchPairInput[], existing: Map<string, Existing>): Classified {
  const out: Classified = { inserts: [], urlChanged: [], nameChanged: [], unchanged: 0 }
  for (const row of rows) {
    const prev = existing.get(row.matCode)
    if (!prev) out.inserts.push(row)
    else if (prev.cjUrl !== row.cjUrl || prev.gsUrl !== row.gsUrl) out.urlChanged.push({ row, prev })
    else if (prev.productName !== row.productName) out.nameChanged.push({ row, prev })
    else out.unchanged++
  }
  return out
}

/** 업로드 미리보기 — DB 와 비교해 신규/URL 변경/상품명 변경/동일 건수. */
export async function previewMatchUpload(rows: MatchPairInput[]): Promise<MatchUploadDiff> {
  validate(rows)
  const c = classify(rows, await loadExisting(rows.map((r) => r.matCode)))
  return {
    newCount: c.inserts.length,
    urlChangedCount: c.urlChanged.length,
    nameChangedCount: c.nameChanged.length,
    sameCount: c.unchanged,
  }
}

/** 업로드 반영 (누적 upsert). 한 트랜잭션. */
export async function upsertMatchPairs(rows: MatchPairInput[]): Promise<MatchUploadResult> {
  validate(rows)
  return db.transaction(async (tx) => {
    const c = classify(rows, await loadExisting(rows.map((r) => r.matCode)))
    const now = new Date()

    if (c.inserts.length > 0) {
      const inserted = await tx
        .insert(matchPair)
        .values(c.inserts)
        .returning({ id: matchPair.id })
      await tx.insert(matchStatusLog).values(
        inserted.map((p) => ({ pairId: p.id, fromStatus: null, toStatus: 'new', actor: 'upload', note: '신규 등록' })),
      )
    }

    for (const { row, prev } of c.urlChanged) {
      await tx
        .update(matchPair)
        .set({
          productName: row.productName,
          cjUrl: row.cjUrl,
          gsUrl: row.gsUrl,
          status: 'new',
          statusChangedAt: now,
          diffSummary: null,
          updatedAt: now,
        })
        .where(eq(matchPair.id, prev.id))
      await tx.insert(matchStatusLog).values({
        pairId: prev.id,
        fromStatus: prev.status,
        toStatus: 'new',
        actor: 'upload',
        note: 'URL 변경으로 초기화',
      })
    }

    for (const { row, prev } of c.nameChanged) {
      await tx
        .update(matchPair)
        .set({ productName: row.productName, updatedAt: now })
        .where(eq(matchPair.id, prev.id))
    }

    return {
      inserted: c.inserts.length,
      urlChanged: c.urlChanged.length,
      nameChanged: c.nameChanged.length,
      unchanged: c.unchanged,
    }
  })
}

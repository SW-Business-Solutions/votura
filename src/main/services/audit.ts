/**
 * Audit-Trail (§28) mit Hash-Chain (§60).
 *
 * Append-only: Es gibt keine Update- oder Delete-Operation. Jeder Eintrag
 * verkettet den vorherigen Hash, sodass nachträgliche Änderungen sichtbar werden.
 */
import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from '@shared/canonical'
import type { AuditChainCheck, AuditEntry, UUID } from '@shared/types'
import { db } from '../db'
import { fromJson, optionalString, type SqlValue } from '../db/driver'

export interface AuditInput {
  action: string
  userId?: UUID
  userName?: string
  eventId?: UUID
  electionRoundId?: UUID
  previousValue?: unknown
  newValue?: unknown
  reason?: string
}

interface AuditRow {
  seq: number
  id: string
  timestamp: string
  user_id: string | null
  user_name: string | null
  event_id: string | null
  round_id: string | null
  action: string
  previous_json: string | null
  new_json: string | null
  reason: string | null
  previous_hash: string | null
  entry_hash: string
}

function hashEntry(previousHash: string | null, payload: unknown): string {
  return createHash('sha256')
    .update(`${previousHash ?? ''}|${canonicalJson(payload)}`)
    .digest('hex')
}

function lastHash(): string | null {
  const row = db()
    .prepare(`SELECT entry_hash FROM audit ORDER BY seq DESC LIMIT 1`)
    .get<{ entry_hash: string }>()
  return row ? row.entry_hash : null
}

export function appendAudit(input: AuditInput): AuditEntry {
  const timestamp = new Date().toISOString()
  const id = randomUUID()
  const previousHash = lastHash()

  const payload = {
    id,
    timestamp,
    userId: input.userId ?? null,
    userName: input.userName ?? null,
    eventId: input.eventId ?? null,
    roundId: input.electionRoundId ?? null,
    action: input.action,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null
  }
  const entryHash = hashEntry(previousHash, payload)

  db()
    .prepare(
      `INSERT INTO audit (id, timestamp, user_id, user_name, event_id, round_id, action,
                          previous_json, new_json, reason, previous_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      timestamp,
      input.userId ?? null,
      input.userName ?? null,
      input.eventId ?? null,
      input.electionRoundId ?? null,
      input.action,
      input.previousValue === undefined ? null : canonicalJson(input.previousValue),
      input.newValue === undefined ? null : canonicalJson(input.newValue),
      input.reason ?? null,
      previousHash,
      entryHash
    )

  const row = db()
    .prepare(`SELECT * FROM audit WHERE id = ?`)
    .get<AuditRow>(id)
  return mapAudit(row as AuditRow)
}

function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    seq: Number(row.seq),
    timestamp: row.timestamp,
    userId: optionalString(row.user_id as SqlValue),
    userName: optionalString(row.user_name as SqlValue),
    eventId: optionalString(row.event_id as SqlValue),
    electionRoundId: optionalString(row.round_id as SqlValue),
    action: row.action,
    previousValue: fromJson<unknown>(row.previous_json as SqlValue, undefined),
    newValue: fromJson<unknown>(row.new_json as SqlValue, undefined),
    reason: optionalString(row.reason as SqlValue),
    entryHash: row.entry_hash,
    previousHash: optionalString(row.previous_hash as SqlValue)
  }
}

export function listAudit(filter: { eventId?: UUID; roundId?: UUID; limit?: number }): AuditEntry[] {
  const conditions: string[] = []
  const params: SqlValue[] = []
  if (filter.eventId) {
    conditions.push('event_id = ?')
    params.push(filter.eventId)
  }
  if (filter.roundId) {
    conditions.push('round_id = ?')
    params.push(filter.roundId)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 10000)
  const rows = db()
    .prepare(`SELECT * FROM audit ${where} ORDER BY seq DESC LIMIT ?`)
    .all<AuditRow>(...params, limit)
  return rows.map(mapAudit)
}

/** Prüft die Verkettung des gesamten Logs. */
export function verifyAuditChain(): AuditChainCheck {
  const rows = db().prepare(`SELECT * FROM audit ORDER BY seq ASC`).all<AuditRow>()
  let previousHash: string | null = null

  for (const row of rows) {
    const payload = {
      id: row.id,
      timestamp: row.timestamp,
      userId: row.user_id,
      userName: row.user_name,
      eventId: row.event_id,
      roundId: row.round_id,
      action: row.action,
      previousValue: row.previous_json === null ? null : JSON.parse(row.previous_json),
      newValue: row.new_json === null ? null : JSON.parse(row.new_json),
      reason: row.reason
    }
    const expected = hashEntry(previousHash, payload)
    if (row.previous_hash !== previousHash || row.entry_hash !== expected) {
      return {
        ok: false,
        entries: rows.length,
        brokenAtSeq: Number(row.seq),
        message: `Die Audit-Kette bricht bei Eintrag ${row.seq} (${row.action}). Der Datenbestand wurde ausserhalb der Anwendung verändert.`
      }
    }
    previousHash = row.entry_hash
  }

  return {
    ok: true,
    entries: rows.length,
    message:
      rows.length === 0
        ? 'Noch keine Audit-Einträge vorhanden.'
        : `Alle ${rows.length} Audit-Einträge sind lücken- und manipulationsfrei verkettet.`
  }
}

export function auditForExport(filter: { eventId?: UUID; roundId?: UUID }): AuditEntry[] {
  return listAudit({ ...filter, limit: 10000 }).reverse()
}

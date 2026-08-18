/**
 * Tagesordnung.
 *
 * Sie kann lange vor der Versammlung vorbereitet und während der Versammlung
 * jederzeit korrigiert werden: Punkte lassen sich umsortieren, ergänzen (z. B.
 * ein Änderungsantrag zwischen zwei Anträgen) und als erledigt markieren.
 * Ein Punkt ist entweder ein reiner Tagesordnungspunkt oder mit einem Wahlgang
 * verknüpft.
 */
import { randomUUID } from 'node:crypto'
import type { AgendaItem, AgendaItemInput, UUID } from '@shared/types'
import { db } from '../db'
import { optionalString, toBool } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'

interface AgendaRow {
  id: string
  event_id: string
  position: number
  label: string | null
  title: string
  note: string | null
  kind: string
  round_id: string | null
  done: number
  created_at: string
}

function mapItem(row: AgendaRow): AgendaItem {
  return {
    id: row.id,
    eventId: row.event_id,
    position: Number(row.position),
    label: optionalString(row.label),
    title: row.title,
    note: optionalString(row.note),
    kind: row.kind === 'round' ? 'round' : 'topic',
    roundId: optionalString(row.round_id),
    done: toBool(row.done),
    createdAt: row.created_at
  }
}

export function listAgenda(eventId: UUID): AgendaItem[] {
  return db()
    .prepare(`SELECT * FROM agenda_items WHERE event_id = ? ORDER BY position, created_at`)
    .all<AgendaRow>(eventId)
    .map(mapItem)
}

function nextPosition(eventId: UUID): number {
  const row = db()
    .prepare(`SELECT COALESCE(MAX(position), 0) AS max FROM agenda_items WHERE event_id = ?`)
    .get<{ max: number }>(eventId)
  return Number(row?.max ?? 0) + 1
}

export function addAgendaItem(input: AgendaItemInput): AgendaItem {
  const session = requirePermission('round.manage')
  if (!input.title.trim()) throw new Error('Der Tagesordnungspunkt braucht eine Bezeichnung.')

  const id = randomUUID()
  const position = input.position ?? nextPosition(input.eventId)

  db().transaction(() => {
    if (input.position !== undefined) {
      // Einschieben: alle nachfolgenden Punkte rücken auf.
      db()
        .prepare(`UPDATE agenda_items SET position = position + 1 WHERE event_id = ? AND position >= ?`)
        .run(input.eventId, position)
    }
    db()
      .prepare(
        `INSERT INTO agenda_items (id, event_id, position, label, title, note, kind, round_id, done, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        id,
        input.eventId,
        position,
        input.label?.trim() || null,
        input.title.trim(),
        input.note?.trim() || null,
        input.roundId ? 'round' : 'topic',
        input.roundId ?? null,
        new Date().toISOString()
      )
  })

  appendAudit({
    action: 'agenda.item_added',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: input.eventId,
    electionRoundId: input.roundId,
    newValue: { titel: input.title.trim(), position }
  })
  return listAgenda(input.eventId).find((item) => item.id === id) as AgendaItem
}

/** Wird beim Anlegen eines Wahlgangs automatisch aufgerufen. */
export function ensureAgendaItemForRound(input: {
  eventId: UUID
  roundId: UUID
  title: string
}): void {
  const existing = db()
    .prepare(`SELECT id FROM agenda_items WHERE round_id = ?`)
    .get<{ id: string }>(input.roundId)
  if (existing) return

  db()
    .prepare(
      `INSERT INTO agenda_items (id, event_id, position, title, kind, round_id, done, created_at)
       VALUES (?, ?, ?, ?, 'round', ?, 0, ?)`
    )
    .run(randomUUID(), input.eventId, nextPosition(input.eventId), input.title, input.roundId, new Date().toISOString())
}

export function updateAgendaItem(input: {
  id: UUID
  title?: string
  label?: string
  note?: string
  done?: boolean
}): AgendaItem {
  const session = requirePermission('round.manage')
  const row = db().prepare(`SELECT * FROM agenda_items WHERE id = ?`).get<AgendaRow>(input.id)
  if (!row) throw new Error('Tagesordnungspunkt nicht gefunden.')
  const before = mapItem(row)

  db()
    .prepare(`UPDATE agenda_items SET title = ?, label = ?, note = ?, done = ? WHERE id = ?`)
    .run(
      input.title?.trim() || before.title,
      input.label === undefined ? (before.label ?? null) : input.label.trim() || null,
      input.note === undefined ? (before.note ?? null) : input.note.trim() || null,
      input.done === undefined ? (before.done ? 1 : 0) : input.done ? 1 : 0,
      input.id
    )

  const after = listAgenda(before.eventId).find((item) => item.id === input.id) as AgendaItem
  appendAudit({
    action: input.done !== undefined && input.done !== before.done ? 'agenda.item_status' : 'agenda.item_updated',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: before.eventId,
    previousValue: { titel: before.title, erledigt: before.done },
    newValue: { titel: after.title, erledigt: after.done }
  })
  return after
}

/**
 * Reihenfolge neu setzen. Wahlgänge übernehmen die Position zusätzlich in ihre
 * eigene Sortierung, damit Tagesordnung und Wahlgangliste übereinstimmen.
 */
export function reorderAgenda(eventId: UUID, orderedIds: UUID[]): AgendaItem[] {
  const session = requirePermission('round.manage')
  const items = new Map(listAgenda(eventId).map((item) => [item.id, item]))

  db().transaction(() => {
    orderedIds.forEach((id, index) => {
      const item = items.get(id)
      if (!item) return
      db().prepare(`UPDATE agenda_items SET position = ? WHERE id = ?`).run(index + 1, id)
      if (item.roundId) {
        db()
          .prepare(`UPDATE rounds SET agenda_order = ?, row_version = row_version + 1 WHERE id = ?`)
          .run(index + 1, item.roundId)
      }
    })
  })

  appendAudit({
    action: 'agenda.reordered',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId,
    newValue: {
      reihenfolge: orderedIds.map((id) => items.get(id)?.title).filter((title): title is string => Boolean(title))
    }
  })
  return listAgenda(eventId)
}

/**
 * Entfernt einen reinen Tagesordnungspunkt. Punkte mit Wahlgang bleiben
 * erhalten — ein Wahlgang wird abgebrochen, nie gelöscht (§57).
 */
export function removeAgendaItem(id: UUID): AgendaItem[] {
  const session = requirePermission('round.manage')
  const row = db().prepare(`SELECT * FROM agenda_items WHERE id = ?`).get<AgendaRow>(id)
  if (!row) throw new Error('Tagesordnungspunkt nicht gefunden.')
  const item = mapItem(row)
  if (item.roundId) {
    throw new Error(
      'Dieser Punkt gehört zu einem Wahlgang. Wahlgänge werden nicht gelöscht, sondern bei Bedarf abgebrochen.'
    )
  }

  db().prepare(`DELETE FROM agenda_items WHERE id = ?`).run(id)
  appendAudit({
    action: 'agenda.item_removed',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: item.eventId,
    previousValue: { titel: item.title, position: item.position }
  })
  return listAgenda(item.eventId)
}

/** Aktueller und nächster Punkt für die Beameranzeige. */
export function agendaOverview(eventId: UUID): {
  items: AgendaItem[]
  current?: AgendaItem
  next?: AgendaItem
} {
  const items = listAgenda(eventId)
  const open = items.filter((item) => !item.done)
  return { items, current: open[0], next: open[1] }
}

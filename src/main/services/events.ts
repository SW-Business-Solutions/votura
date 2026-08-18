/** Veranstaltungen (§6). */
import { randomUUID } from 'node:crypto'
import type { ElectionEvent, ElectionRuleSet, EventStatus, UUID } from '@shared/types'
import type { EventInput } from '@shared/ipc'
import { db } from '../db'
import { fromJson, optionalNumber, optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'

interface EventRow {
  id: string
  title: string
  organization: string
  org_code: string
  date: string
  location: string
  status: string
  eligible_voter_count: number | null
  rule_set_json: string
  row_version: number
  created_at: string
  updated_at: string
  closed_at: string | null
  archived_at: string | null
}

function mapEvent(row: EventRow): ElectionEvent {
  return {
    id: row.id,
    title: row.title,
    organization: row.organization,
    orgCode: row.org_code,
    date: row.date,
    location: row.location,
    status: row.status as EventStatus,
    eligibleVoterCount: optionalNumber(row.eligible_voter_count),
    ruleSet: fromJson<ElectionRuleSet>(row.rule_set_json, {
      name: '',
      version: '',
      snapshotDate: row.date
    }),
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: optionalString(row.closed_at),
    archivedAt: optionalString(row.archived_at)
  }
}

export function listEvents(): ElectionEvent[] {
  return db()
    .prepare(`SELECT * FROM events ORDER BY date DESC, created_at DESC`)
    .all<EventRow>()
    .map(mapEvent)
}

export function getEvent(id: UUID): ElectionEvent {
  const row = db().prepare(`SELECT * FROM events WHERE id = ?`).get<EventRow>(id)
  if (!row) throw new Error('Veranstaltung nicht gefunden.')
  return mapEvent(row)
}

export function activeEvent(): ElectionEvent | null {
  const row = db()
    .prepare(`SELECT * FROM events WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`)
    .get<EventRow>()
  return row ? mapEvent(row) : null
}

function validate(input: EventInput): void {
  if (!input.title.trim()) throw new Error('Die Veranstaltung braucht einen Titel.')
  if (!input.organization.trim()) throw new Error('Bitte die Organisation angeben.')
  if (!/^[A-Za-z0-9]{2,12}$/.test(input.orgCode.trim())) {
    throw new Error('Der Kurzcode darf nur aus 2 bis 12 Buchstaben/Ziffern bestehen (z. B. MV26).')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Bitte ein gueltiges Datum angeben.')
  if (input.eligibleVoterCount !== undefined && input.eligibleVoterCount < 0) {
    throw new Error('Die Zahl der Stimmberechtigten darf nicht negativ sein.')
  }
}

export function createEvent(input: EventInput): ElectionEvent {
  const session = requirePermission('event.manage')
  validate(input)
  const id = randomUUID()
  const now = new Date().toISOString()
  db()
    .prepare(
      `INSERT INTO events (id, title, organization, org_code, date, location, status,
                           eligible_voter_count, rule_set_json, row_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.title.trim(),
      input.organization.trim(),
      input.orgCode.trim().toUpperCase(),
      input.date,
      input.location.trim(),
      input.eligibleVoterCount ?? null,
      JSON.stringify(input.ruleSet),
      now,
      now
    )
  const event = getEvent(id)
  appendAudit({
    action: 'event.created',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: id,
    newValue: { title: event.title, date: event.date, ruleSet: event.ruleSet }
  })
  return event
}

export function updateEvent(input: EventInput & { id: UUID; rowVersion: number }): ElectionEvent {
  const session = requirePermission('event.manage')
  validate(input)
  const before = getEvent(input.id)
  if (before.status === 'archived') throw new Error('Eine archivierte Veranstaltung ist unveränderbar.')
  if (before.rowVersion !== input.rowVersion) {
    throw new Error('Die Veranstaltung wurde zwischenzeitlich geändert. Bitte neu laden.')
  }

  db()
    .prepare(
      `UPDATE events SET title = ?, organization = ?, org_code = ?, date = ?, location = ?,
                         eligible_voter_count = ?, rule_set_json = ?, row_version = row_version + 1,
                         updated_at = ?
       WHERE id = ? AND row_version = ?`
    )
    .run(
      input.title.trim(),
      input.organization.trim(),
      input.orgCode.trim().toUpperCase(),
      input.date,
      input.location.trim(),
      input.eligibleVoterCount ?? null,
      JSON.stringify(input.ruleSet),
      new Date().toISOString(),
      input.id,
      input.rowVersion
    )

  const after = getEvent(input.id)
  appendAudit({
    action: 'event.updated',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: input.id,
    previousValue: {
      title: before.title,
      date: before.date,
      eligibleVoterCount: before.eligibleVoterCount,
      orgCode: before.orgCode
    },
    newValue: {
      title: after.title,
      date: after.date,
      eligibleVoterCount: after.eligibleVoterCount,
      orgCode: after.orgCode
    }
  })
  return after
}

function setStatus(id: UUID, status: EventStatus, column?: 'closed_at' | 'archived_at'): ElectionEvent {
  const now = new Date().toISOString()
  if (column) {
    db()
      .prepare(`UPDATE events SET status = ?, ${column} = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`)
      .run(status, now, now, id)
  } else {
    db()
      .prepare(`UPDATE events SET status = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`)
      .run(status, now, id)
  }
  return getEvent(id)
}

export function activateEvent(id: UUID): ElectionEvent {
  const session = requirePermission('event.manage')
  const event = getEvent(id)
  if (event.status === 'archived' || event.status === 'closed') {
    throw new Error('Diese Veranstaltung ist bereits abgeschlossen.')
  }
  // Es kann immer nur eine Veranstaltung aktiv sein.
  db().prepare(`UPDATE events SET status = 'draft' WHERE status = 'active' AND id <> ?`).run(id)
  const updated = setStatus(id, 'active')
  appendAudit({
    action: 'event.activated',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: id
  })
  return updated
}

/** Schließen ist nur zulässig, wenn alle Wahlgänge abgeschlossen/abgebrochen sind (§64). */
export function closeEvent(id: UUID): ElectionEvent {
  const session = requirePermission('event.manage')
  const open = db()
    .prepare(
      `SELECT round_label FROM rounds
       WHERE event_id = ? AND status NOT IN ('completed', 'cancelled')
       ORDER BY sequential_number`
    )
    .all<{ round_label: string }>(id)
  if (open.length > 0) {
    throw new Error(
      `Es sind noch Wahlgänge offen: ${open.map((row) => row.round_label).join(', ')}. Bitte zuerst abschließen oder abbrechen.`
    )
  }
  const event = setStatus(id, 'closed', 'closed_at')
  appendAudit({
    action: 'event.closed',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: id
  })
  return event
}

export function markArchived(id: UUID): ElectionEvent {
  const session = requirePermission('event.manage')
  const event = setStatus(id, 'archived', 'archived_at')
  appendAudit({
    action: 'event.archived',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: id
  })
  return event
}

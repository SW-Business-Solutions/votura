/** Kandidaten und Wahloptionen (§8, §15). */
import { randomUUID } from 'node:crypto'
import { sortCandidates } from '@shared/election'
import type { CandidateInput } from '@shared/ipc'
import type { Candidate, CandidateOrderMode, UUID } from '@shared/types'
import { db } from '../db'
import { optionalNumber, optionalString, toBool } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { candidatesAreEditable, getRound } from './rounds'

interface CandidateRow {
  id: string
  round_id: string
  first_name: string
  last_name: string
  display_name: string
  ballot_number: number | null
  sort_order: number
  withdrawn: number
  position_id: string | null
  note: string | null
  created_at: string
}

function mapCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id,
    electionRoundId: row.round_id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    ballotNumber: optionalNumber(row.ballot_number),
    sortOrder: Number(row.sort_order),
    withdrawn: toBool(row.withdrawn),
    positionId: optionalString(row.position_id),
    note: optionalString(row.note),
    createdAt: row.created_at
  }
}

export function listCandidates(roundId: UUID): Candidate[] {
  return db()
    .prepare(`SELECT * FROM candidates WHERE round_id = ? ORDER BY sort_order, created_at`)
    .all<CandidateRow>(roundId)
    .map(mapCandidate)
}

export function getCandidate(id: UUID): Candidate {
  const row = db().prepare(`SELECT * FROM candidates WHERE id = ?`).get<CandidateRow>(id)
  if (!row) throw new Error('Kandidat nicht gefunden.')
  return mapCandidate(row)
}

function assertCandidatesEditable(roundId: UUID): void {
  const round = getRound(roundId)
  if (!candidatesAreEditable(round)) {
    throw new Error(
      'Die Kandidatenliste ist geschlossen. Änderungen sind erst nach ausdrücklichem Entsperren des Wahlgangs möglich – dabei entsteht eine neue Wahlzettelversion.'
    )
  }
}

export function addCandidates(roundId: UUID, inputs: CandidateInput[]): Candidate[] {
  const session = requirePermission('candidate.manage')
  assertCandidatesEditable(roundId)
  const round = getRound(roundId)

  const existing = listCandidates(roundId)
  let order = existing.reduce((max, candidate) => Math.max(max, candidate.sortOrder), -1) + 1
  const added: Candidate[] = []

  db().transaction(() => {
    for (const input of inputs) {
      const displayName = input.displayName.trim()
      if (!displayName) continue
      const id = randomUUID()
      db()
        .prepare(
          `INSERT INTO candidates (id, round_id, first_name, last_name, display_name, ballot_number,
                                   sort_order, withdrawn, position_id, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          id,
          roundId,
          input.firstName.trim(),
          input.lastName.trim(),
          displayName,
          input.ballotNumber ?? null,
          order++,
          input.positionId ?? null,
          input.note?.trim() || null,
          new Date().toISOString()
        )
      added.push(getCandidate(id))
    }
    // Arbeitet der Wahlgang mit Kandidatennummern, bekommen auch nachträglich
    // erfasste Eintraege eine – sonst stünden sie ohne Nummer auf dem Zettel.
    renumberIfNumbered(roundId)
  })

  for (const candidate of added) {
    appendAudit({
      action: 'candidate.added',
      userId: session.user.id,
      userName: session.user.displayName,
      eventId: round.eventId,
      electionRoundId: roundId,
      newValue: { name: candidate.displayName, ballotNumber: candidate.ballotNumber }
    })
  }
  return listCandidates(roundId)
}

export function updateCandidate(input: { id: UUID } & Partial<CandidateInput>): Candidate {
  const session = requirePermission('candidate.manage')
  const before = getCandidate(input.id)
  assertCandidatesEditable(before.electionRoundId)

  db()
    .prepare(
      `UPDATE candidates SET first_name = ?, last_name = ?, display_name = ?, ballot_number = ?,
                             position_id = ?, note = ?
       WHERE id = ?`
    )
    .run(
      input.firstName?.trim() ?? before.firstName,
      input.lastName?.trim() ?? before.lastName,
      input.displayName?.trim() ?? before.displayName,
      input.ballotNumber === undefined ? (before.ballotNumber ?? null) : input.ballotNumber,
      input.positionId === undefined ? (before.positionId ?? null) : input.positionId,
      input.note === undefined ? (before.note ?? null) : input.note.trim() || null,
      input.id
    )

  const after = getCandidate(input.id)
  appendAudit({
    action: 'candidate.updated',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: before.electionRoundId,
    previousValue: { name: before.displayName, ballotNumber: before.ballotNumber },
    newValue: { name: after.displayName, ballotNumber: after.ballotNumber }
  })
  return after
}

/**
 * Kandidaten werden nie gelöscht (§57), sondern als zurückgezogen markiert.
 * So bleibt nachvollziehbar, wer zwischenzeitlich auf der Liste stand.
 */
export function withdrawCandidate(id: UUID, reason: string): Candidate {
  const session = requirePermission('candidate.manage')
  if (!reason.trim()) throw new Error('Bitte einen Grund für den Rückzug angeben.')
  const before = getCandidate(id)
  assertCandidatesEditable(before.electionRoundId)

  db().transaction(() => {
    db().prepare(`UPDATE candidates SET withdrawn = 1 WHERE id = ?`).run(id)
    // Nach einem Rückzug bleibt sonst eine Lücke in der Nummernfolge.
    renumberIfNumbered(before.electionRoundId)
  })
  const after = getCandidate(id)
  appendAudit({
    action: 'candidate.withdrawn',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: before.electionRoundId,
    previousValue: { name: before.displayName, withdrawn: false },
    newValue: { name: after.displayName, withdrawn: true },
    reason
  })
  return after
}

/**
 * Vergibt vorhandene Kandidatennummern in der aktuellen Druckreihenfolge neu.
 * Sonst stuenden auf dem Stimmzettel Nummern gegen die Reihenfolge (z. B.
 * "03, 02, 01"), was die Auszählung unnötig fehleranfaellig macht.
 */
function renumberIfNumbered(roundId: UUID): void {
  const list = listCandidates(roundId)
  if (!list.some((candidate) => candidate.ballotNumber !== undefined)) return
  let number = 1
  for (const candidate of list) {
    const value = candidate.withdrawn ? null : number++
    db().prepare(`UPDATE candidates SET ballot_number = ? WHERE id = ?`).run(value, candidate.id)
  }
}

export function reorderCandidates(roundId: UUID, orderedIds: UUID[]): Candidate[] {
  const session = requirePermission('candidate.manage')
  assertCandidatesEditable(roundId)

  db().transaction(() => {
    orderedIds.forEach((id, index) => {
      db().prepare(`UPDATE candidates SET sort_order = ? WHERE id = ? AND round_id = ?`).run(index, id, roundId)
    })
    db().prepare(`UPDATE rounds SET order_mode = 'manual', row_version = row_version + 1 WHERE id = ?`).run(roundId)
    renumberIfNumbered(roundId)
  })

  const candidates = listCandidates(roundId)
  appendAudit({
    action: 'candidate.reordered',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: roundId,
    newValue: { order: candidates.filter((c) => !c.withdrawn).map((c) => c.displayName), mode: 'manual' }
  })
  return candidates
}

/**
 * Reihenfolge nach Modus setzen (§15). Zufall ist nur auf ausdrückliche
 * Anordnung zulässig und wird mit Seed im Audit dokumentiert.
 */
export function applyOrderMode(roundId: UUID, mode: CandidateOrderMode, seed?: number): Candidate[] {
  const session = requirePermission('candidate.manage')
  assertCandidatesEditable(roundId)
  const candidates = listCandidates(roundId)
  const usedSeed = mode === 'random' ? (seed ?? Math.floor(Math.random() * 2_000_000_000)) : undefined
  const ordered = sortCandidates(candidates, mode, usedSeed)

  db().transaction(() => {
    ordered.forEach((candidate, index) => {
      db().prepare(`UPDATE candidates SET sort_order = ? WHERE id = ?`).run(index, candidate.id)
    })
    db()
      .prepare(`UPDATE rounds SET order_mode = ?, order_seed = ?, row_version = row_version + 1 WHERE id = ?`)
      .run(mode, usedSeed ?? null, roundId)
    renumberIfNumbered(roundId)
  })

  appendAudit({
    action: 'candidate.order_mode_applied',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: roundId,
    newValue: {
      mode,
      seed: usedSeed,
      order: ordered.filter((c) => !c.withdrawn).map((c) => c.displayName)
    }
  })
  return listCandidates(roundId)
}

/** Automatische Kandidatennummern (Wahlformen §36), eindeutig je Wahlgang. */
export function assignBallotNumbers(roundId: UUID): Candidate[] {
  const session = requirePermission('candidate.manage')
  assertCandidatesEditable(roundId)
  const candidates = listCandidates(roundId).filter((candidate) => !candidate.withdrawn)
  db().transaction(() => {
    candidates.forEach((candidate, index) => {
      db().prepare(`UPDATE candidates SET ballot_number = ? WHERE id = ?`).run(index + 1, candidate.id)
    })
  })
  appendAudit({
    action: 'candidate.numbers_assigned',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: roundId,
    newValue: { count: candidates.length }
  })
  return listCandidates(roundId)
}

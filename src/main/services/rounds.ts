/** Wahlgänge (§7, §9, §16, §29, §58). */
import { randomUUID } from 'node:crypto'
import {
  canTransition,
  defaultTemplateFor,
  isImmutable,
  profileFor,
  withTemplateDefaults
} from '@shared/election'
import { buildRoundCode, derivedRoundLabel, roundLabelFor } from '@shared/format'
import type { RoundInput, RoundPatch } from '@shared/ipc'
import type {
  BallotPosition,
  BallotTemplateConfig,
  CandidateOrderMode,
  ElectionProcedure,
  ElectionPurpose,
  ElectionRound,
  RoundStatus,
  RoundSummary,
  UUID
} from '@shared/types'
import { db } from '../db'
import { fromJson, optionalNumber, optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { getEvent } from './events'
import { accountingFor } from './accounting'
import { ensureAgendaItemForRound } from './agenda'

interface RoundRow {
  id: string
  event_id: string
  sequential_number: number
  agenda_order: number | null
  round_code: string
  round_label: string
  title: string
  purpose: string
  procedure: string
  seats: number
  max_votes: number | null
  seat_start: number | null
  seat_end: number | null
  status: string
  parent_round_id: string | null
  derived_as: string | null
  ballot_version: number
  approved_version: number | null
  template_json: string
  positions_json: string
  order_mode: string
  order_seed: number | null
  candidates_locked_at: string | null
  row_version: number
  created_at: string
  locked_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

/**
 * Präfix der internen Platzhalter-Kennung für Wahlgänge in Vorbereitung.
 * Nach außen — Anzeige, Druck, Export — ist die Kennung dieser Wahlgänge leer.
 */
export const ENTWURFSKENNUNG = '#entwurf:'

function sichtbareKennung(gespeichert: string): string {
  return gespeichert.startsWith(ENTWURFSKENNUNG) ? '' : gespeichert
}

export function mapRound(row: RoundRow): ElectionRound {
  return {
    id: row.id,
    eventId: row.event_id,
    sequentialNumber: Number(row.sequential_number),
    agendaOrder: Number(row.agenda_order ?? row.sequential_number),
    roundCode: sichtbareKennung(row.round_code),
    roundLabel: row.round_label,
    title: row.title,
    purpose: row.purpose as ElectionPurpose,
    procedure: row.procedure as ElectionProcedure,
    seats: Number(row.seats),
    maxVotes: row.max_votes === null ? null : Number(row.max_votes),
    seatStart: optionalNumber(row.seat_start),
    seatEnd: optionalNumber(row.seat_end),
    status: row.status as RoundStatus,
    parentRoundId: optionalString(row.parent_round_id),
    derivedAs: (optionalString(row.derived_as) as ElectionRound['derivedAs']) ?? undefined,
    ballotVersion: Number(row.ballot_version),
    approvedVersion: optionalNumber(row.approved_version),
    template: withTemplateDefaults(fromJson<Partial<BallotTemplateConfig>>(row.template_json, {})),
    orderMode: row.order_mode as CandidateOrderMode,
    orderSeed: optionalNumber(row.order_seed),
    positions: fromJson<BallotPosition[]>(row.positions_json, []),
    candidatesLockedAt: optionalString(row.candidates_locked_at),
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    lockedAt: optionalString(row.locked_at),
    completedAt: optionalString(row.completed_at),
    cancelledAt: optionalString(row.cancelled_at),
    cancelReason: optionalString(row.cancel_reason)
  }
}

export function getRound(id: UUID): ElectionRound {
  const row = db().prepare(`SELECT * FROM rounds WHERE id = ?`).get<RoundRow>(id)
  if (!row) throw new Error('Wahlgang nicht gefunden.')
  return mapRound(row)
}

export function listRounds(eventId: UUID): RoundSummary[] {
  const rows = db()
    .prepare(`SELECT * FROM rounds WHERE event_id = ? ORDER BY agenda_order, sequential_number`)
    .all<RoundRow>(eventId)

  return rows.map((row) => {
    const round = mapRound(row)
    const countRow = db()
      .prepare(`SELECT COUNT(*) AS count FROM candidates WHERE round_id = ? AND withdrawn = 0`)
      .get<{ count: number }>(round.id)
    const result = db()
      .prepare(`SELECT confirmed_at FROM results WHERE round_id = ?`)
      .get<{ confirmed_at: string | null }>(round.id)
    const approved = db()
      .prepare(`SELECT ballot_hash FROM ballot_versions WHERE round_id = ? AND version = ?`)
      .get<{ ballot_hash: string }>(round.id, round.approvedVersion ?? -1)

    return {
      ...round,
      candidateCount: Number(countRow?.count ?? 0),
      accounting: accountingFor(round.id),
      hasResult: Boolean(result),
      resultConfirmed: Boolean(result?.confirmed_at),
      approvedHash: approved?.ballot_hash
    }
  })
}

/** Kandidaten sind nur vor dem Schließen der Liste veränderbar (§9). */
export function candidatesAreEditable(round: ElectionRound): boolean {
  if (isImmutable(round.status)) return false
  if (round.candidatesLockedAt) return false
  return round.status === 'draft' || round.status === 'candidate_collection'
}

export function assertEditable(round: ElectionRound): void {
  if (isImmutable(round.status)) {
    throw new Error(
      'Dieser Wahlgang ist abgeschlossen und im normalen Betrieb unveränderbar. Änderungen sind nur als dokumentierte Notfallkorrektur durch die Administration möglich.'
    )
  }
}

function nextSequentialNumber(eventId: UUID): number {
  const row = db()
    .prepare(`SELECT COALESCE(MAX(sequential_number), 0) AS max FROM rounds WHERE event_id = ?`)
    .get<{ max: number }>(eventId)
  return Number(row?.max ?? 0) + 1
}

function nextAgendaOrder(eventId: UUID): number {
  const row = db()
    .prepare(`SELECT COALESCE(MAX(agenda_order), 0) AS max FROM rounds WHERE event_id = ?`)
    .get<{ max: number }>(eventId)
  return Number(row?.max ?? 0) + 1
}

/** Ein vorbereiteter Punkt hat noch keine Nummer und keine Kennung. */
export function isPrepared(round: ElectionRound): boolean {
  return round.status === 'draft' && round.sequentialNumber === 0
}

/**
 * Startet einen vorbereiteten Wahlgang: Jetzt — und erst jetzt — bekommt er
 * seine laufende Nummer und damit die endgültige Wahlgangkennung. Vorher kann
 * die Tagesordnung beliebig umsortiert werden, ohne dass Kennungen wandern.
 */
/**
 * Vergibt Nummer und Wahlgangkennung, falls noch keine vorhanden sind — ohne
 * den Status anzutasten.
 *
 * Die Kennung steht auf jedem Stimmzettel und ist das einzige Merkmal, das die
 * Zettel eines Wahlgangs zuordnet. Sie muss deshalb spätestens dann feststehen,
 * wenn die Kandidatenliste geschlossen oder der Stimmzettel freigegeben wird —
 * nicht erst beim Start, denn ein Wahlgang lässt sich auch aus der Vorbereitung
 * heraus freigeben.
 */
export function ensureRoundIdentity(roundId: UUID): ElectionRound {
  const round = getRound(roundId)
  if (round.sequentialNumber > 0 && round.roundCode) return round

  const event = getEvent(round.eventId)
  const sequentialNumber = round.sequentialNumber || nextSequentialNumber(round.eventId)
  const roundLabel = (round.roundLabel || roundLabelFor(sequentialNumber)).toUpperCase()
  const roundCode = (round.roundCode || buildRoundCode(event.orgCode, event.date, roundLabel)).toUpperCase()

  const duplicate = db()
    .prepare(`SELECT id FROM rounds WHERE event_id = ? AND round_code = ? AND id <> ?`)
    .get<{ id: string }>(round.eventId, roundCode, roundId)
  if (duplicate) throw new Error(`Die Wahlgangkennung "${roundCode}" ist bereits vergeben.`)

  db()
    .prepare(
      `UPDATE rounds SET sequential_number = ?, round_label = ?, round_code = ?,
                         row_version = row_version + 1
       WHERE id = ?`
    )
    .run(sequentialNumber, roundLabel, roundCode, roundId)

  return getRound(roundId)
}

export function startRound(roundId: UUID): ElectionRound {
  const session = requirePermission('round.manage')
  const round = getRound(roundId)
  if (round.status !== 'draft') return round

  ensureRoundIdentity(roundId)
  db()
    .prepare(
      `UPDATE rounds SET status = 'candidate_collection', row_version = row_version + 1 WHERE id = ?`
    )
    .run(roundId)

  const after = getRound(roundId)
  appendAudit({
    action: 'round.started',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    previousValue: { status: round.status },
    newValue: { status: after.status, nummer: after.sequentialNumber, kennung: after.roundCode }
  })
  return after
}

/**
 * Reihenfolge der Tagesordnung ändern. Bereits gestartete Wahlgänge behalten
 * ihre Nummer und Kennung; verschoben werden darf alles, was noch in
 * Vorbereitung ist — so lassen sich z. B. Änderungsanträge dazwischenschieben.
 */
export function reorderRounds(eventId: UUID, orderedIds: UUID[]): RoundSummary[] {
  const session = requirePermission('round.manage')
  const known = new Map(listRounds(eventId).map((round) => [round.id, round]))

  db().transaction(() => {
    orderedIds.forEach((id, index) => {
      if (!known.has(id)) return
      db()
        .prepare(`UPDATE rounds SET agenda_order = ?, row_version = row_version + 1 WHERE id = ?`)
        .run(index + 1, id)
    })
  })

  appendAudit({
    action: 'round.agenda_reordered',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId,
    newValue: {
      reihenfolge: orderedIds
        .map((id) => known.get(id)?.title)
        .filter((title): title is string => Boolean(title))
    }
  })
  return listRounds(eventId)
}

export function createRound(input: RoundInput): ElectionRound {
  const session = requirePermission('round.manage')
  const event = getEvent(input.eventId)
  if (event.status === 'archived' || event.status === 'closed') {
    throw new Error('Zu einer abgeschlossenen Veranstaltung können keine Wahlgänge angelegt werden.')
  }
  if (!input.title.trim()) throw new Error('Der Wahlgang braucht eine Bezeichnung.')

  const profile = profileFor(input.procedure)
  const seats = profile.multiSeat ? Math.max(1, input.seats) : 1

  // Ein neuer Punkt wird vorbereitet: Nummer und Kennung entstehen erst beim
  // Start (§7). Nur wenn ausdrücklich eine Kennung vorgegeben wird (z. B. bei
  // Folgewahlgängen), wird sie sofort festgeschrieben.
  const startImmediately = Boolean(input.roundLabel || input.roundCode)
  const sequentialNumber = startImmediately ? nextSequentialNumber(input.eventId) : 0
  const roundLabel = startImmediately
    ? (input.roundLabel ?? roundLabelFor(sequentialNumber)).toUpperCase()
    : ''
  const id = randomUUID()
  /*
   * Wahlgänge in Vorbereitung haben noch keine Kennung. Gespeichert wird
   * trotzdem ein eindeutiger Platzhalter: die Tabelle verlangt (Veranstaltung,
   * Kennung) als eindeutiges Paar, sodass sich sonst nur ein einziger Entwurf
   * je Veranstaltung anlegen ließe. Nach außen ist die Kennung leer — siehe
   * ENTWURFSKENNUNG.
   */
  const roundCode = startImmediately
    ? (input.roundCode ?? buildRoundCode(event.orgCode, event.date, roundLabel)).toUpperCase()
    : `${ENTWURFSKENNUNG}${id}`

  if (startImmediately && roundCode) {
    const duplicate = db()
      .prepare(`SELECT id FROM rounds WHERE event_id = ? AND round_code = ?`)
      .get<{ id: string }>(input.eventId, roundCode)
    if (duplicate) throw new Error(`Die Wahlgangkennung "${roundCode}" ist bereits vergeben.`)
  }

  const positions: BallotPosition[] = (input.positions ?? []).map((position) => ({
    id: randomUUID(),
    title: position.title,
    candidateIds: []
  }))

  db()
    .prepare(
      `INSERT INTO rounds (id, event_id, sequential_number, agenda_order, round_code, round_label, title,
                           purpose, procedure, seats, max_votes, seat_start, seat_end, status,
                           parent_round_id, derived_as, ballot_version, template_json, positions_json,
                           order_mode, row_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?)`
    )
    .run(
      id,
      input.eventId,
      sequentialNumber,
      nextAgendaOrder(input.eventId),
      roundCode,
      roundLabel,
      input.title.trim(),
      input.purpose,
      input.procedure,
      seats,
      input.maxVotes,
      input.seatStart ?? null,
      input.seatEnd ?? null,
      startImmediately ? 'candidate_collection' : 'draft',
      input.parentRoundId ?? null,
      input.derivedAs ?? null,
      JSON.stringify(input.template),
      JSON.stringify(positions),
      input.orderMode,
      new Date().toISOString()
    )

  const round = getRound(id)
  // Jeder Wahlgang erscheint automatisch in der Tagesordnung.
  ensureAgendaItemForRound({ eventId: input.eventId, roundId: id, title: round.title })

  appendAudit({
    action: 'round.created',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: input.eventId,
    electionRoundId: id,
    newValue: {
      roundCode: round.roundCode,
      title: round.title,
      purpose: round.purpose,
      procedure: round.procedure,
      seats: round.seats,
      maxVotes: round.maxVotes,
      orderMode: round.orderMode
    }
  })
  return round
}

/** Änderungen, die den gedruckten Stimmzettel betreffen. */
function isBallotRelevant(before: ElectionRound, patch: RoundPatch): boolean {
  if (patch.title !== undefined && patch.title !== before.title) return true
  if (patch.seats !== undefined && patch.seats !== before.seats) return true
  if (patch.maxVotes !== undefined && patch.maxVotes !== before.maxVotes) return true
  if (patch.seatStart !== undefined && patch.seatStart !== before.seatStart) return true
  if (patch.seatEnd !== undefined && patch.seatEnd !== before.seatEnd) return true
  if (patch.roundCode !== undefined && patch.roundCode !== before.roundCode) return true
  if (patch.orderMode !== undefined && patch.orderMode !== before.orderMode) return true
  if (patch.positions !== undefined) return true
  if (patch.template !== undefined) {
    return JSON.stringify(patch.template) !== JSON.stringify(before.template)
  }
  return false
}

/**
 * Aendert Wahlgangdaten. Ist die aktuelle Zettelversion bereits freigegeben und
 * betrifft die Änderung den Druck, entsteht automatisch eine neue Version (§58) —
 * die alte Version bleibt archiviert und muss erneut freigegeben werden.
 */
export function updateRound(input: RoundPatch & { id: UUID }): ElectionRound {
  const session = requirePermission('round.manage')
  const before = getRound(input.id)
  assertEditable(before)
  if (before.rowVersion !== input.rowVersion) {
    throw new Error('Der Wahlgang wurde zwischenzeitlich geändert. Bitte neu laden.')
  }

  const ballotRelevant = isBallotRelevant(before, input)
  const wasApproved = before.approvedVersion === before.ballotVersion
  const newVersion = ballotRelevant && wasApproved ? before.ballotVersion + 1 : before.ballotVersion

  const positions: BallotPosition[] | undefined = input.positions?.map((position) => ({
    id: position.id ?? randomUUID(),
    title: position.title,
    candidateIds: before.positions.find((existing) => existing.id === position.id)?.candidateIds ?? []
  }))

  db()
    .prepare(
      `UPDATE rounds SET title = ?, seats = ?, max_votes = ?, seat_start = ?, seat_end = ?,
                         template_json = ?, positions_json = ?, order_mode = ?, order_seed = ?,
                         round_code = ?, ballot_version = ?, row_version = row_version + 1
       WHERE id = ? AND row_version = ?`
    )
    .run(
      input.title?.trim() ?? before.title,
      input.seats ?? before.seats,
      input.maxVotes === undefined ? before.maxVotes : input.maxVotes,
      input.seatStart ?? before.seatStart ?? null,
      input.seatEnd ?? before.seatEnd ?? null,
      JSON.stringify(input.template ?? before.template),
      JSON.stringify(positions ?? before.positions),
      input.orderMode ?? before.orderMode,
      input.orderSeed ?? before.orderSeed ?? null,
      (input.roundCode ?? before.roundCode).toUpperCase(),
      newVersion,
      input.id,
      input.rowVersion
    )

  const after = getRound(input.id)
  appendAudit({
    action: newVersion !== before.ballotVersion ? 'round.updated_new_version' : 'round.updated',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: before.eventId,
    electionRoundId: input.id,
    previousValue: {
      title: before.title,
      seats: before.seats,
      maxVotes: before.maxVotes,
      template: before.template,
      positions: before.positions,
      ballotVersion: before.ballotVersion
    },
    newValue: {
      title: after.title,
      seats: after.seats,
      maxVotes: after.maxVotes,
      template: after.template,
      positions: after.positions,
      ballotVersion: after.ballotVersion
    },
    reason:
      newVersion !== before.ballotVersion
        ? 'Änderung nach Freigabe: neue Wahlzettelversion erforderlich'
        : undefined
  })
  return after
}

/** Kandidatenliste schließen (§9 Schritt 5). */
export function lockCandidates(roundId: UUID): ElectionRound {
  const session = requirePermission('round.manage')
  const round = getRound(roundId)
  assertEditable(round)
  if (round.candidatesLockedAt) return round
  ensureRoundIdentity(roundId)

  db()
    .prepare(`UPDATE rounds SET candidates_locked_at = ?, locked_at = ?, row_version = row_version + 1 WHERE id = ?`)
    .run(new Date().toISOString(), new Date().toISOString(), roundId)

  const after = getRound(roundId)
  appendAudit({
    action: 'round.candidates_locked',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    newValue: { lockedAt: after.candidatesLockedAt, orderMode: after.orderMode }
  })
  return after
}

/**
 * Wahlgang entsperren (§9). Erzeugt einen Audit-Eintrag und erzwingt eine neue
 * Wahlzettelversion, sobald die bisherige freigegeben war.
 */
export function unlockRound(roundId: UUID, reason: string): ElectionRound {
  const session = requirePermission('round.unlock')
  if (!reason.trim()) throw new Error('Für das Entsperren ist eine Begründung erforderlich.')
  const round = getRound(roundId)
  assertEditable(round)
  if (round.status === 'open' || round.status === 'counting') {
    throw new Error('Ein eröffneter Wahlgang kann nicht entsperrt werden. Bitte zuerst die Stimmabgabe beenden.')
  }

  const wasApproved = round.approvedVersion === round.ballotVersion
  const newVersion = wasApproved ? round.ballotVersion + 1 : round.ballotVersion

  db()
    .prepare(
      `UPDATE rounds SET candidates_locked_at = NULL, status = 'candidate_collection',
                         ballot_version = ?, row_version = row_version + 1
       WHERE id = ?`
    )
    .run(newVersion, roundId)

  const after = getRound(roundId)
  appendAudit({
    action: 'round.unlocked',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    previousValue: { status: round.status, ballotVersion: round.ballotVersion },
    newValue: { status: after.status, ballotVersion: after.ballotVersion },
    reason
  })
  return after
}

export function setRoundStatus(roundId: UUID, status: RoundStatus, reason?: string): ElectionRound {
  const session = requirePermission('round.manage')
  const round = getRound(roundId)
  if (isImmutable(round.status)) {
    throw new Error('Der Wahlgang ist abgeschlossen und kann nicht mehr geändert werden.')
  }
  if (!canTransition(round.status, status)) {
    throw new Error(`Der Wechsel von "${round.status}" nach "${status}" ist nicht vorgesehen.`)
  }
  if (status === 'open' && round.approvedVersion !== round.ballotVersion) {
    throw new Error('Der Wahlgang kann erst eröffnet werden, wenn der aktuelle Stimmzettel freigegeben ist.')
  }

  db().prepare(`UPDATE rounds SET status = ?, row_version = row_version + 1 WHERE id = ?`).run(status, roundId)
  const after = getRound(roundId)
  appendAudit({
    action: `round.status_${status}`,
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    previousValue: { status: round.status },
    newValue: { status },
    reason
  })
  return after
}

export function completeRound(roundId: UUID): ElectionRound {
  const session = requirePermission('round.manage')
  const round = getRound(roundId)
  if (isImmutable(round.status)) throw new Error('Der Wahlgang ist bereits abgeschlossen.')

  const profile = profileFor(round.procedure)
  const result = db()
    .prepare(`SELECT confirmed_at FROM results WHERE round_id = ?`)
    .get<{ confirmed_at: string | null }>(roundId)
  if (!result) throw new Error('Vor dem Abschluss muss ein Ergebnis erfasst werden.')
  if (!result.confirmed_at) throw new Error('Das Ergebnis muss zuerst bestätigt werden.')
  if (profile.ballotRequired && round.approvedVersion === undefined) {
    throw new Error('Zu diesem Wahlgang wurde nie ein Stimmzettel freigegeben.')
  }

  const now = new Date().toISOString()
  db()
    .prepare(`UPDATE rounds SET status = 'completed', completed_at = ?, row_version = row_version + 1 WHERE id = ?`)
    .run(now, roundId)

  const after = getRound(roundId)
  appendAudit({
    action: 'round.completed',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    newValue: { completedAt: now }
  })
  return after
}

export function cancelRound(roundId: UUID, reason: string): ElectionRound {
  const session = requirePermission('round.manage')
  if (!reason.trim()) throw new Error('Für den Abbruch ist eine Begründung erforderlich.')
  const round = getRound(roundId)
  if (isImmutable(round.status)) throw new Error('Der Wahlgang ist bereits abgeschlossen.')

  const now = new Date().toISOString()
  db()
    .prepare(
      `UPDATE rounds SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, row_version = row_version + 1
       WHERE id = ?`
    )
    .run(now, reason, roundId)

  const after = getRound(roundId)
  appendAudit({
    action: 'round.cancelled',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    previousValue: { status: round.status },
    newValue: { status: 'cancelled' },
    reason
  })
  return after
}

const FOLLOW_UP_LABELS: Record<
  NonNullable<ElectionRound['derivedAs']>,
  { kind: 'S' | 'R' | 'N' | '2'; banner: string; title: string }
> = {
  runoff: { kind: 'S', banner: 'STICHWAHL', title: 'Stichwahl' },
  repeat: { kind: 'R', banner: 'NEU ERÖFFNETE WAHL', title: 'Wiederholungswahl' },
  byelection: { kind: 'N', banner: 'NACHWAHL', title: 'Nachwahl' },
  second_round: { kind: '2', banner: '2. WAHLGANG', title: '2. Wahlgang' },
  stage_2: { kind: '2', banner: 'ZWEI-STUFEN-WAHL / STUFE 2', title: 'Stufe 2' }
}

/**
 * Folgewahlgang aus einem bestehenden Wahlgang ableiten (§27).
 * Uebernommen werden Veranstaltung, Bezug, ausgewählte Kandidaten und Titel —
 * es entsteht IMMER eine neue Kennung und eine neue Zettelversion.
 */
export function createFollowUpRound(input: {
  parentRoundId: UUID
  kind: NonNullable<ElectionRound['derivedAs']>
  title?: string
  seats?: number
  maxVotes?: number | null
  candidateIds: UUID[]
  procedure?: ElectionProcedure
}): ElectionRound {
  const session = requirePermission('round.manage')
  const parent = getRound(input.parentRoundId)
  const meta = FOLLOW_UP_LABELS[input.kind]

  const siblings = db()
    .prepare(`SELECT COUNT(*) AS count FROM rounds WHERE parent_round_id = ? AND derived_as = ?`)
    .get<{ count: number }>(input.parentRoundId, input.kind)
  const index = Number(siblings?.count ?? 0) + 1

  const event = getEvent(parent.eventId)
  const roundLabel = derivedRoundLabel(parent.roundLabel, meta.kind, index)
  const procedure = input.procedure ?? (input.kind === 'runoff' ? 'runoff' : parent.procedure)
  const seats = input.seats ?? (input.kind === 'runoff' ? 1 : parent.seats)
  const profile = profileFor(procedure)
  const maxVotes =
    input.maxVotes !== undefined ? input.maxVotes : profile.defaultMaxVotes(seats)

  const template = {
    ...defaultTemplateFor(procedure, {
      seats,
      maxVotes,
      entryCount: input.candidateIds.length
    }),
    banner: meta.banner
  }

  const round = createRoundInternal({
    session,
    eventId: parent.eventId,
    title: input.title?.trim() || `${parent.title} – ${meta.title}`,
    purpose: parent.purpose,
    procedure,
    seats,
    maxVotes,
    roundLabel,
    roundCode: buildRoundCode(event.orgCode, event.date, roundLabel),
    template,
    orderMode: parent.orderMode,
    parentRoundId: parent.id,
    derivedAs: input.kind
  })

  // Kandidaten aus dem Ursprungswahlgang übernehmen (neue Datensätze,
  // damit die Historie des Ursprungswahlgangs unangetastet bleibt).
  const source = db()
    .prepare(
      `SELECT id, first_name, last_name, display_name, ballot_number, sort_order
       FROM candidates WHERE round_id = ? ORDER BY sort_order`
    )
    .all<{
      id: string
      first_name: string
      last_name: string
      display_name: string
      ballot_number: number | null
      sort_order: number
    }>(parent.id)

  const selected = source.filter((candidate) => input.candidateIds.includes(candidate.id))
  let order = 0
  for (const candidate of selected) {
    db()
      .prepare(
        `INSERT INTO candidates (id, round_id, first_name, last_name, display_name, ballot_number, sort_order, withdrawn, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        randomUUID(),
        round.id,
        candidate.first_name,
        candidate.last_name,
        candidate.display_name,
        candidate.ballot_number,
        order++,
        new Date().toISOString()
      )
  }

  appendAudit({
    action: 'round.follow_up_created',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: parent.eventId,
    electionRoundId: round.id,
    previousValue: { parentRound: parent.roundCode },
    newValue: {
      roundCode: round.roundCode,
      kind: input.kind,
      candidates: selected.map((candidate) => candidate.display_name)
    }
  })

  return getRound(round.id)
}

function createRoundInternal(params: {
  session: { user: { id: string; displayName: string } }
  eventId: UUID
  title: string
  purpose: ElectionPurpose
  procedure: ElectionProcedure
  seats: number
  maxVotes: number | null
  roundLabel: string
  roundCode: string
  template: BallotTemplateConfig
  orderMode: CandidateOrderMode
  parentRoundId?: UUID
  derivedAs?: ElectionRound['derivedAs']
}): ElectionRound {
  const sequentialNumber = nextSequentialNumber(params.eventId)
  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO rounds (id, event_id, sequential_number, round_code, round_label, title, purpose, procedure,
                           seats, max_votes, status, parent_round_id, derived_as, ballot_version,
                           template_json, positions_json, order_mode, row_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate_collection', ?, ?, 1, ?, '[]', ?, 1, ?)`
    )
    .run(
      id,
      params.eventId,
      sequentialNumber,
      params.roundCode.toUpperCase(),
      params.roundLabel.toUpperCase(),
      params.title,
      params.purpose,
      params.procedure,
      params.seats,
      params.maxVotes,
      params.parentRoundId ?? null,
      params.derivedAs ?? null,
      JSON.stringify(params.template),
      params.orderMode,
      new Date().toISOString()
    )
  return getRound(id)
}

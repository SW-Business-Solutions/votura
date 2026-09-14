/**
 * Akkreditierung: wer da ist und wer mitstimmen darf.
 *
 * Die Zahl der Stimmberechtigten war bisher **eine Zahl am Ereignis**, einmal
 * eingetippt. In einer Versammlung kommen und gehen aber Leute: Beim vierten
 * Wahlgang sitzen andere im Saal als beim ersten, und damit ändert sich die
 * nötige Mehrheit. Wer das von Hand nachhält, rechnet irgendwann mit einer
 * veralteten Zahl — und merkt es erst, wenn jemand nachrechnet.
 *
 * **Der Anwesenheitsverlauf wird fortgeschrieben, nicht überschrieben.**
 * Kommen und Gehen stehen je als eigene Zeile; der aktuelle Zustand ist der
 * letzte Eintrag. Ein Feld „anwesend ja/nein" könnte die Frage nicht
 * beantworten, die im Protokoll zählt: Wer war zum Zeitpunkt dieses Wahlgangs
 * im Saal?
 *
 * **Der Voting Pass verlässt diesen Dienst nur ein einziges Mal** — beim
 * Ausgeben, damit er gedruckt werden kann. Danach steht in der Datenbank nur
 * noch sein Hash; die Liste zeigt lediglich, *dass* ein Pass ausgegeben wurde.
 */
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import type {
  AttendanceEntry,
  Participant,
  ParticipantInput,
  PresenceSummary,
  QuorumRule,
  RoundPresence,
  UUID
} from '@shared/types'
import { db } from '../db'
import { optionalString, toBool } from '../db/driver'
import { appendAudit } from './audit'
import { getSession, requirePermission } from './auth'

/**
 * Zeichenvorrat des Voting Passes.
 *
 * Ohne `I`, `O`, `0` und `1`: Der Pass wird gedruckt und im Zweifel abgetippt,
 * wenn die Kamera nicht mag. Verwechselbare Zeichen kosten dann genau die
 * Minute, die am Einlass niemand hat.
 */
const PASS_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PASS_LAENGE = 16

interface ParticipantRow {
  id: string
  event_id: string
  number: string | null
  last_name: string
  first_name: string
  note: string | null
  weight: number
  eligible: number
  pass_hash: string | null
  pass_issued_at: string | null
  blocked_at: string | null
  blocked_reason: string | null
  row_version: number
  created_at: string
  updated_at: string
  /* aus dem Anwesenheitsverlauf angefügt */
  last_kind?: string | null
  last_at?: string | null
}

function mapParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    eventId: row.event_id,
    number: optionalString(row.number),
    lastName: row.last_name,
    firstName: row.first_name,
    note: optionalString(row.note),
    weight: Number(row.weight),
    eligible: toBool(row.eligible),
    present: row.last_kind === 'in',
    lastSeenAt: optionalString(row.last_at ?? null),
    passIssued: row.pass_hash !== null,
    passIssuedAt: optionalString(row.pass_issued_at),
    blockedAt: optionalString(row.blocked_at),
    blockedReason: optionalString(row.blocked_reason),
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Die Abfrage hängt an jeden Teilnehmer seinen letzten Anwesenheitseintrag.
 *
 * In einem Zug statt einer Abfrage je Person: Am Einlass stehen 500 Leute in
 * der Liste, und die Ansicht frischt sich nach jedem Scan auf.
 */
const MIT_ANWESENHEIT = `
  SELECT p.*,
         (SELECT kind FROM attendance_log a WHERE a.participant_id = p.id
           ORDER BY a.at DESC, a.id DESC LIMIT 1) AS last_kind,
         (SELECT at   FROM attendance_log a WHERE a.participant_id = p.id
           ORDER BY a.at DESC, a.id DESC LIMIT 1) AS last_at
    FROM participants p
`

export function listParticipants(eventId: UUID): Participant[] {
  return db()
    .prepare(`${MIT_ANWESENHEIT} WHERE p.event_id = ? ORDER BY p.last_name, p.first_name`)
    .all<ParticipantRow>(eventId)
    .map(mapParticipant)
}

export function getParticipant(id: UUID): Participant | null {
  const row = db().prepare(`${MIT_ANWESENHEIT} WHERE p.id = ?`).get<ParticipantRow>(id)
  return row ? mapParticipant(row) : null
}

function pruefeName(input: ParticipantInput): void {
  if (!input.lastName.trim()) throw new Error('Der Teilnehmer braucht einen Nachnamen.')
  if (input.weight !== undefined && (!Number.isInteger(input.weight) || input.weight < 1)) {
    throw new Error('Das Stimmgewicht muss eine ganze Zahl ab 1 sein.')
  }
}

export function addParticipant(input: ParticipantInput): Participant {
  const session = requirePermission('participant.manage')
  pruefeName(input)

  const id = randomUUID()
  const jetzt = new Date().toISOString()
  db()
    .prepare(
      `INSERT INTO participants
         (id, event_id, number, last_name, first_name, note, weight, eligible,
          row_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.eventId,
      input.number?.trim() || null,
      input.lastName.trim(),
      input.firstName.trim(),
      input.note?.trim() || null,
      input.weight ?? 1,
      input.eligible === false ? 0 : 1,
      jetzt,
      jetzt
    )

  appendAudit({
    action: 'participant.added',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: input.eventId,
    newValue: { name: `${input.lastName}, ${input.firstName}`, stimmgewicht: input.weight ?? 1 }
  })
  return getParticipant(id)!
}

export function updateParticipant(id: UUID, input: ParticipantInput & { rowVersion: number }): Participant {
  const session = requirePermission('participant.manage')
  pruefeName(input)

  const jetzt = new Date().toISOString()
  const ergebnis = db()
    .prepare(
      `UPDATE participants
          SET number = ?, last_name = ?, first_name = ?, note = ?, weight = ?, eligible = ?,
              row_version = row_version + 1, updated_at = ?
        WHERE id = ? AND row_version = ?`
    )
    .run(
      input.number?.trim() || null,
      input.lastName.trim(),
      input.firstName.trim(),
      input.note?.trim() || null,
      input.weight ?? 1,
      input.eligible === false ? 0 : 1,
      jetzt,
      id,
      input.rowVersion
    )

  if (ergebnis.changes === 0) {
    throw new Error('Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.')
  }

  appendAudit({
    action: 'participant.updated',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: input.eventId,
    newValue: { name: `${input.lastName}, ${input.firstName}`, stimmgewicht: input.weight ?? 1 }
  })
  return getParticipant(id)!
}

/* --------------------------------------------------------- Anwesenheit */

/**
 * Kommen oder Gehen eintragen.
 *
 * Zweimal „gekommen" hintereinander ist kein Fehler, sondern ein Versehen am
 * Einlass — der zweite Scan wird stillschweigend übergangen, statt eine
 * Meldung zu erzeugen, die niemand liest, während zwanzig Leute warten.
 */
export function setAttendance(participantId: UUID, kind: 'in' | 'out', note?: string): Participant {
  const session = requirePermission('participant.manage')
  const teilnehmer = getParticipant(participantId)
  if (!teilnehmer) throw new Error('Unbekannter Teilnehmer.')
  if (teilnehmer.present === (kind === 'in')) return teilnehmer

  db()
    .prepare(
      `INSERT INTO attendance_log (id, participant_id, kind, at, by_user, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      participantId,
      kind,
      new Date().toISOString(),
      session.user.username,
      note?.trim() || null
    )

  appendAudit({
    action: kind === 'in' ? 'participant.arrived' : 'participant.left',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: teilnehmer.eventId,
    newValue: { name: `${teilnehmer.lastName}, ${teilnehmer.firstName}` }
  })
  return getParticipant(participantId)!
}

export function attendanceHistory(participantId: UUID): AttendanceEntry[] {
  return db()
    .prepare(`SELECT * FROM attendance_log WHERE participant_id = ? ORDER BY at, id`)
    .all<{
      id: string
      participant_id: string
      kind: string
      at: string
      by_user: string | null
      note: string | null
    }>(participantId)
    .map((row) => ({
      id: row.id,
      participantId: row.participant_id,
      kind: row.kind === 'out' ? 'out' : 'in',
      at: row.at,
      byUser: optionalString(row.by_user),
      note: optionalString(row.note)
    }))
}

/* ------------------------------------------------------- Voting Pass */

function passHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function neuerPass(): string {
  /* `randomBytes` statt Math.random: Der Pass weist die Stimmberechtigung
     nach. Ein erratbarer Pass ist eine fremde Stimme. */
  const bytes = randomBytes(PASS_LAENGE)
  let wert = ''
  for (const byte of bytes) wert += PASS_ZEICHEN[byte % PASS_ZEICHEN.length]
  return wert
}

/**
 * Gibt einen Voting Pass aus und liefert ihn **einmalig** zurück.
 *
 * Gespeichert wird nur der Hash. Geht der Ausdruck verloren, lässt sich der
 * Pass nicht nachschlagen, sondern nur neu ausgeben — der alte verfällt dabei.
 * Das ist Absicht: Ein nachlesbarer Pass wäre eine Stimme zum Mitnehmen.
 */
export function issuePass(participantId: UUID): { participant: Participant; token: string } {
  const session = requirePermission('participant.manage')
  const teilnehmer = getParticipant(participantId)
  if (!teilnehmer) throw new Error('Unbekannter Teilnehmer.')
  if (!teilnehmer.eligible) throw new Error('Gäste bekommen keinen Voting Pass.')
  if (teilnehmer.blockedAt) throw new Error('Dieser Teilnehmer ist gesperrt.')

  const token = neuerPass()
  db()
    .prepare(`UPDATE participants SET pass_hash = ?, pass_issued_at = ?, updated_at = ? WHERE id = ?`)
    .run(passHash(token), new Date().toISOString(), new Date().toISOString(), participantId)

  /* Der Pass selbst steht nie im Audit — protokolliert wird, *dass* einer
     ausgegeben wurde, nicht welcher. */
  appendAudit({
    action: teilnehmer.passIssued ? 'participant.pass_reissued' : 'participant.pass_issued',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: teilnehmer.eventId,
    newValue: { name: `${teilnehmer.lastName}, ${teilnehmer.firstName}` }
  })

  return { participant: getParticipant(participantId)!, token }
}

/**
 * Schlägt den Teilnehmer zu einem Pass nach — für den Einlass mit Scanner.
 *
 * Der Vergleich läuft über den Hash und zeitkonstant. Ein Zeitunterschied
 * zwischen „falscher Pass" und „fast richtiger Pass" verriete, wie weit man
 * beim Raten ist.
 */
export function findByPass(eventId: UUID, token: string): Participant | null {
  const gesucht = Buffer.from(passHash(token.trim().toUpperCase()), 'hex')
  const zeilen = db()
    .prepare(`${MIT_ANWESENHEIT} WHERE p.event_id = ? AND p.pass_hash IS NOT NULL`)
    .all<ParticipantRow>(eventId)

  let treffer: ParticipantRow | null = null
  for (const zeile of zeilen) {
    const kandidat = Buffer.from(zeile.pass_hash as string, 'hex')
    if (kandidat.length === gesucht.length && timingSafeEqual(kandidat, gesucht)) treffer = zeile
  }
  return treffer ? mapParticipant(treffer) : null
}

export function blockParticipant(participantId: UUID, reason: string): Participant {
  const session = requirePermission('participant.manage')
  const teilnehmer = getParticipant(participantId)
  if (!teilnehmer) throw new Error('Unbekannter Teilnehmer.')

  db()
    .prepare(`UPDATE participants SET blocked_at = ?, blocked_reason = ?, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), reason.trim() || null, new Date().toISOString(), participantId)

  appendAudit({
    action: 'participant.blocked',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: teilnehmer.eventId,
    newValue: { name: `${teilnehmer.lastName}, ${teilnehmer.firstName}`, grund: reason.trim() }
  })
  return getParticipant(participantId)!
}

export function unblockParticipant(participantId: UUID): Participant {
  const session = requirePermission('participant.manage')
  db()
    .prepare(`UPDATE participants SET blocked_at = NULL, blocked_reason = NULL, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), participantId)

  appendAudit({
    action: 'participant.unblocked',
    userId: session.user.id,
    userName: session.user.displayName,
    newValue: { teilnehmer: participantId }
  })
  return getParticipant(participantId)!
}

/* ------------------------------------------------- Stand und Beschlussfähigkeit */

/** Wie viele stimmberechtigte Anwesende die Regel verlangt. */
export function quorumRequired(rule: QuorumRule, eligibleTotal: number): number {
  if (rule.kind === 'none') return 0
  if (rule.kind === 'count') return Math.max(0, Math.ceil(rule.value))
  /* Anteil: aufgerundet. „Die Hälfte von 15" sind acht, nicht siebeneinhalb. */
  return Math.ceil(eligibleTotal * rule.value)
}

export function presenceSummary(eventId: UUID, quorum: QuorumRule): PresenceSummary {
  const zeilen = db()
    .prepare(`${MIT_ANWESENHEIT} WHERE p.event_id = ?`)
    .all<ParticipantRow>(eventId)
    .map(mapParticipant)

  const stimmberechtigt = zeilen.filter((teilnehmer) => teilnehmer.eligible && !teilnehmer.blockedAt)
  const anwesendBerechtigt = stimmberechtigt.filter((teilnehmer) => teilnehmer.present)
  const verlangt = quorumRequired(quorum, stimmberechtigt.length)

  return {
    total: zeilen.length,
    eligibleTotal: stimmberechtigt.length,
    present: zeilen.filter((teilnehmer) => teilnehmer.present).length,
    eligiblePresent: anwesendBerechtigt.length,
    weightPresent: anwesendBerechtigt.reduce((summe, teilnehmer) => summe + teilnehmer.weight, 0),
    passesIssued: zeilen.filter((teilnehmer) => teilnehmer.passIssued).length,
    quorum,
    quorumRequired: verlangt,
    quorumMet: anwesendBerechtigt.length >= verlangt
  }
}

/* ------------------------------------------------------ Stand je Wahlgang */

/**
 * Mit dem Abschluss der Versammlung verfallen alle Voting Pässe.
 *
 * Ein gedruckter Pass ist zwar für eine Versammlung ausgestellt, seine
 * Prüfsumme stünde ohne dies aber weiter in der Datenbank und gölte weiter.
 * Ein Zettel, den jemand einsteckt und mitnimmt, ist kein Ausweis mehr,
 * sobald die Versammlung vorbei ist — das soll auch technisch gelten.
 *
 * Dass ein Pass ausgegeben *war*, bleibt im Audit. Nur seine Gültigkeit
 * endet.
 */
export function expirePasses(eventId: UUID): number {
  const offen = db()
    .prepare(`SELECT COUNT(*) AS anzahl FROM participants WHERE event_id = ? AND pass_hash IS NOT NULL`)
    .get<{ anzahl: number }>(eventId)
  const anzahl = Number(offen?.anzahl ?? 0)
  if (anzahl === 0) return 0

  db()
    .prepare(
      `UPDATE participants SET pass_hash = NULL, updated_at = ? WHERE event_id = ? AND pass_hash IS NOT NULL`
    )
    .run(new Date().toISOString(), eventId)

  appendAudit({
    action: 'participant.passes_expired',
    eventId,
    newValue: { entwertet: anzahl }
  })
  return anzahl
}

/**
 * Führt diese Versammlung überhaupt eine Akkreditierung?
 *
 * Entscheidend vor dem Festhalten eines Standes: Ohne Teilnehmerliste stünde
 * dort eine Null — und die wäre schlimmer als die Zahl am Ereignis, denn sie
 * sähe aus wie eine Messung. Wer keine Liste führt, soll weiterarbeiten wie
 * bisher.
 */
export function hasAccreditation(eventId: UUID): boolean {
  const row = db()
    .prepare(`SELECT COUNT(*) AS anzahl FROM participants WHERE event_id = ?`)
    .get<{ anzahl: number }>(eventId)
  return Number(row?.anzahl ?? 0) > 0
}

/**
 * Hält den Stand im Saal für einen Wahlgang fest.
 *
 * Aufgerufen beim Eröffnen. Danach darf sich die Anwesenheit ändern, ohne das
 * laufende Verfahren zu verschieben — sonst änderte sich die nötige Mehrheit,
 * während schon gewählt wird.
 */
export function takeRoundPresence(roundId: UUID, eventId: UUID, quorum: QuorumRule): RoundPresence {
  const stand = presenceSummary(eventId, quorum)
  const eintrag: RoundPresence = {
    roundId,
    present: stand.present,
    eligible: stand.eligiblePresent,
    weightSum: stand.weightPresent,
    takenAt: new Date().toISOString()
  }

  db()
    .prepare(
      `INSERT INTO round_presence (round_id, present, eligible, weight_sum, taken_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET
         present = excluded.present, eligible = excluded.eligible,
         weight_sum = excluded.weight_sum, taken_at = excluded.taken_at`
    )
    .run(roundId, eintrag.present, eintrag.eligible, eintrag.weightSum, eintrag.takenAt)

  const session = getSession()
  appendAudit({
    action: 'round.presence_taken',
    userId: session?.user.id,
    userName: session?.user.displayName,
    eventId,
    electionRoundId: roundId,
    newValue: {
      anwesend: eintrag.present,
      stimmberechtigtAnwesend: eintrag.eligible,
      stimmgewicht: eintrag.weightSum
    }
  })
  return eintrag
}

export function roundPresence(roundId: UUID): RoundPresence | null {
  const row = db().prepare(`SELECT * FROM round_presence WHERE round_id = ?`).get<{
    round_id: string
    present: number
    eligible: number
    weight_sum: number
    taken_at: string
  }>(roundId)
  return row
    ? {
        roundId: row.round_id,
        present: Number(row.present),
        eligible: Number(row.eligible),
        weightSum: Number(row.weight_sum),
        takenAt: row.taken_at
      }
    : null
}

/**
 * Die Zahl der Stimmberechtigten für einen Wahlgang.
 *
 * Bevorzugt der festgehaltene Stand der Akkreditierung; wo keine geführt wird,
 * bleibt die Zahl am Ereignis. Damit ändert sich für bestehende Versammlungen
 * nichts — die Akkreditierung ist eine Möglichkeit, keine Pflicht.
 */
export function eligibleForRound(roundId: UUID, fallback?: number): number | undefined {
  return roundPresence(roundId)?.eligible ?? fallback
}

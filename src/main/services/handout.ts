/**
 * Ausgabe der Stimmzettel: ein Zettel gegen einen Ausweis.
 *
 * Der Tisch neben dem Einlass, an dem jemand sitzt und austeilt. Bisher war
 * das ein Handgriff ohne Gedächtnis: Der Zettel ging über den Tisch, und in
 * der Bilanz stand am Ende **eine getippte Zahl**. Wer doppelt austeilte,
 * merkte es beim Nachzählen — oder gar nicht.
 *
 * Hier bekommt der Handgriff ein Gedächtnis. Je Wahlgang genau ein Zettel je
 * Person; der zweite Versuch wird abgewiesen und nennt den Grund. Das ist das
 * Papieräquivalent zu der einmaligen Stimmberechtigung, die ADR-0006 für die
 * digitale Stimme vorsieht — dieselbe Regel, andere Form.
 *
 * ## Wo die Grenze verläuft
 *
 * Festgehalten wird, dass jemand einen **leeren** Zettel bekommen hat. Was
 * damit geschieht, weiß dieser Dienst nicht und darf es nicht wissen: Sobald
 * der Zettel über den Tisch ist, ist er anonym wie jeder andere. Es gibt
 * keine Verbindung zwischen dieser Tabelle und einer Stimme, und es darf nie
 * eine geben.
 */
import { randomUUID } from 'node:crypto'
import type { BallotIssue, Participant, UUID } from '@shared/types'
import { db } from '../db'
import { optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { assertMayVote } from './participants'
import { getRound } from './rounds'

interface IssueRow {
  id: string
  round_id: string
  participant_id: string
  issued_at: string
  kind: string
  by_user: string | null
}

function mapIssue(row: IssueRow): BallotIssue {
  return {
    id: row.id,
    roundId: row.round_id,
    participantId: row.participant_id,
    issuedAt: row.issued_at,
    kind: row.kind === 'replacement' ? 'replacement' : 'initial',
    byUser: optionalString(row.by_user)
  }
}

/** Wie viele Zettel für diesen Wahlgang über den Tisch gegangen sind. */
export function handoutCount(roundId: UUID): { initial: number; replacements: number } {
  const zeilen = db()
    .prepare(`SELECT kind, COUNT(*) AS anzahl FROM ballot_issues WHERE round_id = ? GROUP BY kind`)
    .all<{ kind: string; anzahl: number }>(roundId)
  const finde = (art: string): number => Number(zeilen.find((zeile) => zeile.kind === art)?.anzahl ?? 0)
  return { initial: finde('initial'), replacements: finde('replacement') }
}

export function handoutFor(roundId: UUID, participantId: UUID): BallotIssue[] {
  return db()
    .prepare(`SELECT * FROM ballot_issues WHERE round_id = ? AND participant_id = ? ORDER BY issued_at`)
    .all<IssueRow>(roundId, participantId)
    .map(mapIssue)
}

/**
 * Einen Stimmzettel herausgeben.
 *
 * `kind`:
 * - `initial` — der reguläre Zettel. Genau einer je Person und Wahlgang.
 * - `replacement` — ein Ersatzzettel, weil der erste verschrieben wurde. Er
 *   verlangt einen Grund und wird in der Bilanz getrennt geführt (§23): Der
 *   verdorbene Zettel muss zurückkommen, sonst geht die Rechnung nicht auf.
 *
 * Geprüft wird vorher, ob die Person **jetzt** stimmberechtigt ist — erfasst,
 * stimmberechtigt, nicht gesperrt und im Saal. Der letzte Punkt ist der, der
 * am Ausgabetisch zählt: Wer gegangen ist, bekommt keinen Zettel mehr.
 */
export function issueBallot(input: {
  roundId: UUID
  participantId: UUID
  kind?: BallotIssue['kind']
  reason?: string
}): { issue: BallotIssue; participant: Participant } {
  const session = requirePermission('print.execute')
  const art = input.kind ?? 'initial'
  const person = assertMayVote(input.participantId)

  const round = getRound(input.roundId)
  if (round.status === 'completed' || round.status === 'cancelled') {
    throw new Error('Dieser Wahlgang ist abgeschlossen.')
  }
  if (person.eventId !== round.eventId) {
    throw new Error('Der Teilnehmer gehört zu einer anderen Versammlung.')
  }
  if (art === 'replacement' && !input.reason?.trim()) {
    throw new Error('Ein Ersatzzettel braucht einen Grund.')
  }

  const bisher = handoutFor(input.roundId, input.participantId)
  if (art === 'initial' && bisher.some((eintrag) => eintrag.kind === 'initial')) {
    const wann = new Date(bisher[0].issuedAt).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    })
    throw new Error(
      `${person.firstName} ${person.lastName} hat für ${round.roundLabel} schon einen Stimmzettel bekommen (${wann} Uhr).`
    )
  }

  const eintrag: IssueRow = {
    id: randomUUID(),
    round_id: input.roundId,
    participant_id: input.participantId,
    issued_at: new Date().toISOString(),
    kind: art,
    by_user: session.user.username
  }
  db()
    .prepare(
      `INSERT INTO ballot_issues (id, round_id, participant_id, issued_at, kind, by_user)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      eintrag.id,
      eintrag.round_id,
      eintrag.participant_id,
      eintrag.issued_at,
      eintrag.kind,
      eintrag.by_user
    )

  appendAudit({
    action: art === 'replacement' ? 'ballot.replacement_issued' : 'ballot.issued',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: input.roundId,
    newValue: { name: `${person.lastName}, ${person.firstName}` },
    reason: input.reason?.trim()
  })

  return { issue: mapIssue(eintrag), participant: person }
}

/**
 * Eine Ausgabe zurücknehmen — für den Fehlgriff am Tisch.
 *
 * Kommt vor: Der Ausweis der falschen Person liegt oben auf, der Zettel ist
 * noch nicht über den Tisch. Rückgängig zu machen ist das besser, als die
 * Bilanz für den Rest des Abends falsch zu lassen.
 *
 * Der Vorgang bleibt im Audit stehen — gelöscht wird die Ausgabe, nicht ihre
 * Spur.
 */
export function revokeIssue(issueId: UUID, reason: string): void {
  const session = requirePermission('print.reprint')
  if (!reason.trim()) throw new Error('Das Zurücknehmen braucht einen Grund.')

  const zeile = db().prepare(`SELECT * FROM ballot_issues WHERE id = ?`).get<IssueRow>(issueId)
  if (!zeile) throw new Error('Diese Ausgabe gibt es nicht.')

  /* Die Versammlung mitschreiben, bevor die Zeile weg ist — sonst stünde der
     Vorgang im Protokoll, ohne dass er bei der Versammlung auftauchte, zu der
     er gehört. */
  const round = getRound(zeile.round_id)
  db().prepare(`DELETE FROM ballot_issues WHERE id = ?`).run(issueId)

  appendAudit({
    action: 'ballot.issue_revoked',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: zeile.round_id,
    previousValue: { ausgegebenUm: zeile.issued_at, art: zeile.kind },
    reason: reason.trim()
  })
}

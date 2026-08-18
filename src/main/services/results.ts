/**
 * Ergebniserfassung und -feststellung (§24, §25, §26, Beamer §14/§52).
 *
 * Zwei Zustände: erfasst (draft) und bestätigt (confirmed). Erst die
 * Bestätigung macht das Ergebnis öffentlich. Eine Korrektur nach der
 * Bestätigung ist nur mit Begründung möglich und wird protokolliert.
 */
import { randomUUID } from 'node:crypto'
import { validateResult } from '@shared/result'
import type { ResultInput } from '@shared/ipc'
import type { ElectionResult, ElectionRound, ResultData, UUID } from '@shared/types'
import { db } from '../db'
import { fromJson, optionalNumber, optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission, requirePinIfConfigured, requireSession } from './auth'
import { getRound } from './rounds'
import { getConfig } from './settings'

interface ResultRow {
  id: string
  round_id: string
  counting_mode: string
  declaration: string | null
  eligible_voters: number | null
  ballots_cast: number
  valid_ballots: number
  invalid_ballots: number
  abstentions: number | null
  result_json: string
  entered_by: string
  entered_by_name: string
  verified_by: string | null
  verified_by_name: string | null
  note: string | null
  determination: string | null
  final_decision: string | null
  elected_ids_json: string | null
  lot_decision: string | null
  created_at: string
  confirmed_at: string | null
}

function mapResult(row: ResultRow): ElectionResult {
  return {
    id: row.id,
    electionRoundId: row.round_id,
    countingMode: row.counting_mode === 'declared' ? 'declared' : 'counted',
    declaration: optionalString(row.declaration),
    eligibleVoters: optionalNumber(row.eligible_voters),
    ballotsCast: Number(row.ballots_cast),
    validBallots: Number(row.valid_ballots),
    invalidBallots: Number(row.invalid_ballots),
    abstentions: optionalNumber(row.abstentions),
    resultData: fromJson<ResultData>(row.result_json, { candidates: [] }),
    enteredBy: row.entered_by,
    enteredByName: row.entered_by_name,
    verifiedBy: optionalString(row.verified_by),
    verifiedByName: optionalString(row.verified_by_name),
    note: optionalString(row.note),
    determination: optionalString(row.determination),
    finalDecision: (optionalString(row.final_decision) as ElectionResult['finalDecision']) ?? undefined,
    electedCandidateIds: fromJson<UUID[]>(row.elected_ids_json, []),
    lotDecision: optionalString(row.lot_decision),
    createdAt: row.created_at,
    confirmedAt: optionalString(row.confirmed_at)
  }
}

export function getResult(roundId: UUID): ElectionResult | null {
  const row = db().prepare(`SELECT * FROM results WHERE round_id = ?`).get<ResultRow>(roundId)
  return row ? mapResult(row) : null
}

export function saveResult(input: ResultInput): ElectionResult {
  const session = requirePermission('result.enter')
  const round = getRound(input.electionRoundId)
  if (round.status === 'completed' || round.status === 'cancelled') {
    throw new Error('Der Wahlgang ist abgeschlossen. Eine Änderung ist nur als Notfallkorrektur möglich.')
  }

  const existing = getResult(input.electionRoundId)
  if (existing?.confirmedAt) {
    throw new Error(
      'Das Ergebnis ist bereits bestätigt. Für eine Korrektur muss es zuerst mit Begründung zur Überprüfung geöffnet werden.'
    )
  }

  const countingMode = input.countingMode ?? 'counted'

  if (countingMode === 'declared') {
    // Ohne Auszählung trägt der Wortlaut der Feststellung das Ergebnis — er ist
    // daher zwingend und ersetzt die Zahlenprüfung.
    if (!input.declaration?.trim()) {
      throw new Error(
        'Ohne Auszählung muss festgehalten werden, was die Versammlungsleitung festgestellt hat (z. B. „einstimmig angenommen").'
      )
    }
  } else {
    const issues = validateResult(round, input.resultData, {
      ballotsCast: input.ballotsCast,
      validBallots: input.validBallots,
      invalidBallots: input.invalidBallots
    })
    const errors = issues.filter((issue) => issue.level === 'error')
    if (errors.length > 0) {
      throw new Error(`Das Ergebnis ist nicht plausibel:\n- ${errors.map((issue) => issue.message).join('\n- ')}`)
    }
  }

  const now = new Date().toISOString()
  const id = existing?.id ?? randomUUID()

  if (existing) {
    db()
      .prepare(
        `UPDATE results SET counting_mode = ?, declaration = ?, eligible_voters = ?, ballots_cast = ?,
                            valid_ballots = ?, invalid_ballots = ?, abstentions = ?, result_json = ?,
                            note = ?, determination = ?, final_decision = ?, elected_ids_json = ?,
                            lot_decision = ?
         WHERE id = ?`
      )
      .run(
        countingMode,
        input.declaration?.trim() || null,
        input.eligibleVoters ?? null,
        input.ballotsCast,
        input.validBallots,
        input.invalidBallots,
        input.resultData.abstentions ?? null,
        JSON.stringify(input.resultData),
        input.note ?? null,
        input.determination ?? null,
        input.finalDecision ?? null,
        JSON.stringify(input.electedCandidateIds ?? []),
        input.lotDecision ?? null,
        id
      )
  } else {
    db()
      .prepare(
        `INSERT INTO results (id, round_id, counting_mode, declaration, eligible_voters, ballots_cast,
                              valid_ballots, invalid_ballots, abstentions, result_json, entered_by,
                              entered_by_name, note, determination, final_decision, elected_ids_json,
                              lot_decision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.electionRoundId,
        countingMode,
        input.declaration?.trim() || null,
        input.eligibleVoters ?? null,
        input.ballotsCast,
        input.validBallots,
        input.invalidBallots,
        input.resultData.abstentions ?? null,
        JSON.stringify(input.resultData),
        session.user.id,
        session.user.displayName,
        input.note ?? null,
        input.determination ?? null,
        input.finalDecision ?? null,
        JSON.stringify(input.electedCandidateIds ?? []),
        input.lotDecision ?? null,
        now
      )
  }

  appendAudit({
    action: existing ? 'result.updated' : 'result.entered',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: input.electionRoundId,
    previousValue: existing
      ? {
          ballotsCast: existing.ballotsCast,
          validBallots: existing.validBallots,
          invalidBallots: existing.invalidBallots,
          resultData: existing.resultData
        }
      : undefined,
    newValue: {
      erfassungsart: countingMode === 'declared' ? 'ohne Auszählung festgestellt' : 'ausgezählt',
      feststellung: input.declaration,
      ballotsCast: input.ballotsCast,
      validBallots: input.validBallots,
      invalidBallots: input.invalidBallots,
      resultData: input.resultData,
      finalDecision: input.finalDecision
    }
  })

  return getResult(input.electionRoundId) as ElectionResult
}

/** Bestätigung; optional im Vier-Augen-Prinzip (§24). */
export function confirmResult(roundId: UUID, pin?: string): ElectionResult {
  const session = requirePermission('result.confirm')
  const config = getConfig()
  const result = getResult(roundId)
  if (!result) throw new Error('Es ist kein Ergebnis erfasst.')
  if (result.confirmedAt) return result

  if (config.security.requireFourEyesForResult && result.enteredBy === session.user.id) {
    throw new Error(
      'Vier-Augen-Prinzip: Das Ergebnis muss von einer anderen Person bestätigt werden als von derjenigen, die es erfasst hat.'
    )
  }
  requirePinIfConfigured(pin)

  const now = new Date().toISOString()
  db()
    .prepare(`UPDATE results SET confirmed_at = ?, verified_by = ?, verified_by_name = ? WHERE round_id = ?`)
    .run(now, session.user.id, session.user.displayName, roundId)

  const round = getRound(roundId)
  appendAudit({
    action: 'result.confirmed',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    newValue: {
      confirmedAt: now,
      finalDecision: result.finalDecision,
      ballotsCast: result.ballotsCast,
      validBallots: result.validBallots,
      invalidBallots: result.invalidBallots
    }
  })
  return getResult(roundId) as ElectionResult
}

/**
 * Bestaetigtes Ergebnis zur Korrektur öffnen (Beamer §52).
 * Es wird nichts gelöscht; der bisherige Stand steht im Audit.
 */
export function reopenResult(roundId: UUID, reason: string): ElectionResult {
  const session = requirePermission('result.confirm')
  if (!reason.trim()) throw new Error('Für die Korrektur eines bestätigten Ergebnisses ist eine Begründung nötig.')
  const result = getResult(roundId)
  if (!result) throw new Error('Es ist kein Ergebnis erfasst.')
  const round = getRound(roundId)
  if (round.status === 'completed') {
    throw new Error('Der Wahlgang ist abgeschlossen. Korrekturen sind nur als Notfallkorrektur möglich.')
  }

  db().prepare(`UPDATE results SET confirmed_at = NULL, verified_by = NULL, verified_by_name = NULL WHERE round_id = ?`).run(roundId)
  appendAudit({
    action: 'result.reopened',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    previousValue: {
      confirmedAt: result.confirmedAt,
      resultData: result.resultData,
      finalDecision: result.finalDecision
    },
    newValue: { confirmedAt: null },
    reason
  })
  return getResult(roundId) as ElectionResult
}

/**
 * Notfallkorrektur eines abgeschlossenen Wahlgangs (§29) — nur Administration.
 *
 * Öffnet den abgeschlossenen Wahlgang so weit, dass das Ergebnis auf dem
 * regulären Weg berichtigt und erneut bestätigt werden kann: der Status geht
 * auf „Auszählung" zurück und die Bestätigung wird aufgehoben. Gelöscht wird
 * nichts — der bisherige Stand steht vollständig im Audit-Trail.
 */
export function emergencyReopen(roundId: UUID, reason: string): ElectionRound {
  requirePermission('system.manage')
  const session = requireSession()
  if (!reason.trim()) throw new Error('Eine Notfallkorrektur erfordert eine Begründung.')

  const round = getRound(roundId)
  if (round.status !== 'completed') {
    throw new Error('Dieser Wahlgang ist nicht abgeschlossen — eine Notfallkorrektur ist nicht nötig.')
  }
  const result = getResult(roundId)

  db().prepare(`UPDATE rounds SET status = 'counting', row_version = row_version + 1 WHERE id = ?`).run(roundId)
  db()
    .prepare(`UPDATE results SET confirmed_at = NULL, verified_by = NULL, verified_by_name = NULL WHERE round_id = ?`)
    .run(roundId)

  appendAudit({
    action: 'result.emergency_reopened',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    previousValue: {
      status: round.status,
      confirmedAt: result?.confirmedAt,
      finalDecision: result?.finalDecision,
      electedCandidateIds: result?.electedCandidateIds,
      resultData: result?.resultData
    },
    newValue: { status: 'counting', confirmedAt: null },
    reason
  })

  return getRound(roundId)
}

/** Notfallkorrektur eines abgeschlossenen Wahlgangs (§29) – nur Administration. */
export function emergencyCorrection(roundId: UUID, input: ResultInput, reason: string): ElectionResult {
  requirePermission('system.manage')
  const session = requireSession()
  if (!reason.trim()) throw new Error('Eine Notfallkorrektur erfordert eine Begründung.')
  const before = getResult(roundId)
  if (!before) throw new Error('Es ist kein Ergebnis erfasst.')

  db()
    .prepare(
      `UPDATE results SET ballots_cast = ?, valid_ballots = ?, invalid_ballots = ?, result_json = ?,
                          determination = ?, final_decision = ?, elected_ids_json = ?
       WHERE round_id = ?`
    )
    .run(
      input.ballotsCast,
      input.validBallots,
      input.invalidBallots,
      JSON.stringify(input.resultData),
      input.determination ?? null,
      input.finalDecision ?? null,
      JSON.stringify(input.electedCandidateIds ?? []),
      roundId
    )

  appendAudit({
    action: 'result.emergency_correction',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: roundId,
    previousValue: {
      ballotsCast: before.ballotsCast,
      validBallots: before.validBallots,
      invalidBallots: before.invalidBallots,
      resultData: before.resultData
    },
    newValue: {
      ballotsCast: input.ballotsCast,
      validBallots: input.validBallots,
      invalidBallots: input.invalidBallots,
      resultData: input.resultData
    },
    reason
  })
  return getResult(roundId) as ElectionResult
}

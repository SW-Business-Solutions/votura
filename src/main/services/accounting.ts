/** Stimmzettelbilanz (§22, §23). Gedruckte Mengen kommen aus den Druckaufträgen. */
import { emptyAccounting } from '@shared/accounting'
import type { AccountingInput } from '@shared/ipc'
import type { BallotAccounting, UUID } from '@shared/types'
import { db } from '../db'
import { optionalNumber, optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'

interface ManualRow {
  round_id: string
  issued: number
  replacements_issued: number
  returned_spoiled: number
  unused: number
  ballots_in_box: number | null
  updated_at: string | null
}

export function accountingFor(roundId: UUID): BallotAccounting {
  const base = emptyAccounting(roundId)

  const printed = db()
    .prepare(
      // Physisch bestätigte Menge hat Vorrang vor der übermittelten (§36).
      `SELECT COALESCE(SUM(CASE WHEN kind IN ('initial','reprint') THEN COALESCE(confirmed_copies, submitted_copies) ELSE 0 END), 0) AS printed,
              COALESCE(SUM(CASE WHEN kind IN ('initial','reprint') THEN failed_copies ELSE 0 END), 0) AS failures,
              COALESCE(SUM(CASE WHEN kind = 'test' THEN submitted_copies ELSE 0 END), 0) AS tests
       FROM print_batches WHERE round_id = ?`
    )
    .get<{ printed: number; failures: number; tests: number }>(roundId)

  const manual = db().prepare(`SELECT * FROM accounting WHERE round_id = ?`).get<ManualRow>(roundId)

  return {
    ...base,
    printed: Number(printed?.printed ?? 0),
    printFailures: Number(printed?.failures ?? 0),
    testPrints: Number(printed?.tests ?? 0),
    issued: Number(manual?.issued ?? 0),
    replacementsIssued: Number(manual?.replacements_issued ?? 0),
    returnedSpoiled: Number(manual?.returned_spoiled ?? 0),
    unused: Number(manual?.unused ?? 0),
    ballotsInBox: optionalNumber(manual?.ballots_in_box ?? null),
    updatedAt: optionalString(manual?.updated_at ?? null)
  }
}

export function saveAccounting(input: AccountingInput): BallotAccounting {
  const session = requirePermission('accounting.edit')
  const values = [input.issued, input.replacementsIssued, input.returnedSpoiled, input.unused]
  if (values.some((value) => value < 0)) throw new Error('Negative Mengen sind nicht zulässig.')
  if (input.ballotsInBox !== undefined && input.ballotsInBox < 0) {
    throw new Error('Negative Mengen sind nicht zulässig.')
  }

  const before = accountingFor(input.electionRoundId)
  db()
    .prepare(
      `INSERT INTO accounting (round_id, issued, replacements_issued, returned_spoiled, unused, ballots_in_box, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET
         issued = excluded.issued,
         replacements_issued = excluded.replacements_issued,
         returned_spoiled = excluded.returned_spoiled,
         unused = excluded.unused,
         ballots_in_box = excluded.ballots_in_box,
         updated_at = excluded.updated_at`
    )
    .run(
      input.electionRoundId,
      input.issued,
      input.replacementsIssued,
      input.returnedSpoiled,
      input.unused,
      input.ballotsInBox ?? null,
      new Date().toISOString()
    )

  const after = accountingFor(input.electionRoundId)
  appendAudit({
    action: 'accounting.updated',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: input.electionRoundId,
    previousValue: {
      issued: before.issued,
      replacementsIssued: before.replacementsIssued,
      returnedSpoiled: before.returnedSpoiled,
      unused: before.unused,
      ballotsInBox: before.ballotsInBox
    },
    newValue: {
      issued: after.issued,
      replacementsIssued: after.replacementsIssued,
      returnedSpoiled: after.returnedSpoiled,
      unused: after.unused,
      ballotsInBox: after.ballotsInBox
    }
  })
  return after
}

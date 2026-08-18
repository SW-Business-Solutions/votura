/**
 * Stimmzettelbilanz (§23).
 *
 * Wichtig: Abweichungen werden MARKIERT, niemals automatisch korrigiert.
 * Die Software stellt nur Mengen gegenueber – die Bewertung trifft die Wahlleitung.
 */
import type { AccountingCheck, BallotAccounting } from './types'

export function emptyAccounting(electionRoundId: string): BallotAccounting {
  return {
    electionRoundId,
    printed: 0,
    printFailures: 0,
    testPrints: 0,
    issued: 0,
    replacementsIssued: 0,
    returnedSpoiled: 0,
    unused: 0
  }
}

/** Regulaer verfügbare Stimmzettel: gedruckt abzueglich fehlgeschlagener Drucke. */
export function availableBallots(accounting: BallotAccounting): number {
  return accounting.printed - accounting.printFailures
}

/** Rechnerisch mögliche Stimmzettel in der Urne. */
export function expectedInBox(accounting: BallotAccounting): number {
  return accounting.issued - accounting.returnedSpoiled
}

export function checkAccounting(
  accounting: BallotAccounting,
  eligibleVoters?: number
): AccountingCheck[] {
  const checks: AccountingCheck[] = []
  const available = availableBallots(accounting)
  const expected = expectedInBox(accounting)

  if (accounting.issued > available) {
    checks.push({
      level: 'warning',
      message: `Es sind mehr Stimmzettel ausgegeben (${accounting.issued}) als regulär verfügbar waren (${available}). Bitte physisch prüfen.`
    })
  }

  if (accounting.ballotsInBox !== undefined && accounting.ballotsInBox !== expected) {
    const diff = accounting.ballotsInBox - expected
    checks.push({
      level: 'warning',
      message: `Zählung in der Urne (${accounting.ballotsInBox}) weicht um ${diff > 0 ? '+' : ''}${diff} von der rechnerischen Erwartung (${expected}) ab.`
    })
  }

  if (eligibleVoters !== undefined && accounting.issued > eligibleVoters) {
    checks.push({
      level: 'warning',
      message: `Es sind mehr Stimmzettel ausgegeben (${accounting.issued}) als Stimmberechtigte gemeldet sind (${eligibleVoters}).`
    })
  }

  if (accounting.replacementsIssued !== accounting.returnedSpoiled) {
    checks.push({
      level: 'notice',
      message: `Ersatzstimmzettel (${accounting.replacementsIssued}) und zurueckgenommene Stimmzettel (${accounting.returnedSpoiled}) stimmen nicht überein.`
    })
  }

  if (accounting.testPrints > 0) {
    checks.push({
      level: 'notice',
      message: `${accounting.testPrints} Testdruck(e) erzeugt – diese sind als ungültig gekennzeichnet und dürfen nicht ausgegeben werden.`
    })
  }

  const unaccounted = available - accounting.issued - accounting.unused
  if (accounting.unused > 0 && unaccounted !== 0) {
    checks.push({
      level: 'notice',
      message: `${Math.abs(unaccounted)} Stimmzettel sind rechnerisch weder ausgegeben noch als unbenutzt erfasst.`
    })
  }

  if (checks.length === 0) {
    checks.push({ level: 'ok', message: 'Die dokumentierten Mengen sind in sich schlüssig.' })
  }

  return checks
}

/** Vergleich der Bilanz mit dem erfassten Ergebnis. */
export function checkResultPlausibility(
  accounting: BallotAccounting,
  ballotsCast: number,
  validBallots: number,
  invalidBallots: number
): AccountingCheck[] {
  const checks: AccountingCheck[] = []
  if (validBallots + invalidBallots !== ballotsCast) {
    checks.push({
      level: 'warning',
      message: `Gültige (${validBallots}) und ungültige (${invalidBallots}) Stimmzettel ergeben zusammen ${validBallots + invalidBallots}, erfasst sind aber ${ballotsCast} abgegebene Stimmzettel.`
    })
  }
  const expected = expectedInBox(accounting)
  if (accounting.issued > 0 && ballotsCast > expected) {
    checks.push({
      level: 'warning',
      message: `Es wurden mehr Stimmzettel gezählt (${ballotsCast}) als rechnerisch ausgegeben (${expected}).`
    })
  }
  if (checks.length === 0) {
    checks.push({ level: 'ok', message: 'Ergebnis und Stimmzettelbilanz passen zusammen.' })
  }
  return checks
}

/** Geschätzter Rollenverbrauch (§66). */
export function estimatePaperUsage(
  linesPerBallot: number,
  copies: number,
  lineHeightMm = 3.5,
  cutMarginMm = 15
): { millimetersPerBallot: number; totalMeters: number } {
  const millimetersPerBallot = linesPerBallot * lineHeightMm + cutMarginMm
  return {
    millimetersPerBallot,
    totalMeters: (millimetersPerBallot * copies) / 1000
  }
}

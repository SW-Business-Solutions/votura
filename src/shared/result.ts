/**
 * Ergebnis-Mechanik.
 *
 * Die Software rechnet, sortiert und prüft auf Plausibilität. Sie stellt NICHT
 * fest, wer gewählt ist (§26, Wahlformen §46/§74) — Vorschläge sind immer als
 * Vorschlag gekennzeichnet und müssen von der Wahlleitung bestätigt werden.
 */
import { profileFor } from './election'
import type { CandidateResult, ElectionRound, ResultData } from './types'
import type { FinalDecision } from './projection'

export interface ResultInputRow {
  candidateId: string
  name: string
  /** Ankreuzverfahren. */
  votes?: number
  /** Akzeptanz-/Positionsverfahren. */
  yes?: number
  no?: number
  abstain?: number
  invalidVotes?: number
  positionId?: string
  positionTitle?: string
}

export type ResultInputKind = 'votes' | 'yes_no_abstain' | 'global_only'

/** Welche Eingabefelder braucht dieses Verfahren? */
export function resultInputKind(round: Pick<ElectionRound, 'procedure'>): ResultInputKind {
  const profile = profileFor(round.procedure)
  if (profile.perCandidateChoice) return 'yes_no_abstain'
  if (profile.entryKind === 'none') return 'global_only'
  return 'votes'
}

/** Handelt es sich um eine Sachabstimmung statt einer Personenwahl? */
export function isMotionProcedure(procedure: ElectionRound['procedure']): boolean {
  return (
    procedure === 'yes_no_abstain' ||
    procedure === 'single_choice_motion' ||
    procedure === 'multiple_choice_motion' ||
    procedure === 'alternative_choice'
  )
}

/**
 * Welche Feststellungen kommen für dieses Verfahren überhaupt in Betracht?
 * Bei einem Antrag ist „gewählt" ebenso sinnlos wie „angenommen" bei einer
 * Personenwahl.
 */
export function availableDecisions(procedure: ElectionRound['procedure']): FinalDecision[] {
  if (isMotionProcedure(procedure) || procedure === 'open_vote') {
    return ['accepted', 'rejected', 'tie', 'manual']
  }
  return ['elected', 'not_elected', 'runoff', 'tie', 'manual']
}

export interface ResultValidation {
  level: 'error' | 'warning'
  message: string
}

export function validateResult(
  round: Pick<ElectionRound, 'procedure' | 'seats' | 'maxVotes' | 'positions'> & {
    template?: Pick<ElectionRound['template'], 'votesPerCandidate'>
  },
  data: ResultData,
  totals: { ballotsCast: number; validBallots: number; invalidBallots: number }
): ResultValidation[] {
  const issues: ResultValidation[] = []
  const kind = resultInputKind(round)

  if (totals.ballotsCast < 0 || totals.validBallots < 0 || totals.invalidBallots < 0) {
    issues.push({ level: 'error', message: 'Negative Stimmzettelzahlen sind nicht zulässig.' })
  }
  if (totals.validBallots + totals.invalidBallots !== totals.ballotsCast) {
    issues.push({
      level: 'error',
      message: `Gültige (${totals.validBallots}) + ungültige (${totals.invalidBallots}) Stimmzettel müssen die abgegebenen (${totals.ballotsCast}) ergeben.`
    })
  }

  const rows = allRows(data)
  for (const row of rows) {
    const values = [row.votes, row.yes, row.no, row.abstain, row.invalidVotes].filter(
      (value): value is number => value !== undefined
    )
    if (values.some((value) => value < 0)) {
      issues.push({ level: 'error', message: `Negative Stimmenzahl bei "${row.name}".` })
    }
    if (kind === 'votes' && row.votes !== undefined) {
      // Beim Kumulieren darf ein Bewerber mehrere Stimmen je Stimmzettel
      // erhalten – die Obergrenze steigt entsprechend.
      const perCandidate = Math.max(1, round.template?.votesPerCandidate ?? 1)
      const maximum = totals.validBallots * perCandidate
      if (row.votes > maximum) {
        issues.push({
          level: 'error',
          message:
            perCandidate > 1
              ? `"${row.name}" hat mehr Stimmen (${row.votes}) als möglich: ${totals.validBallots} Stimmzettel x ${perCandidate} Stimmen je Bewerber = ${maximum}.`
              : `"${row.name}" hat mehr Stimmen (${row.votes}) als gültige Stimmzettel vorliegen (${totals.validBallots}).`
        })
      }
    }
    if (kind === 'yes_no_abstain') {
      const sum = (row.yes ?? 0) + (row.no ?? 0) + (row.abstain ?? 0) + (row.invalidVotes ?? 0)
      if (sum > totals.validBallots) {
        issues.push({
          level: 'warning',
          message: `Die Voten zu "${row.name}" (${sum}) übersteigen die Zahl gültiger Stimmzettel (${totals.validBallots}).`
        })
      }
    }
  }

  if (kind === 'votes' && round.maxVotes !== null) {
    const totalVotes = rows.reduce((sum, row) => sum + (row.votes ?? 0), 0)
    const maxPossible = totals.validBallots * round.maxVotes
    if (totalVotes > maxPossible) {
      issues.push({
        level: 'error',
        message: `Insgesamt ${totalVotes} Stimmen bei maximal ${maxPossible} möglichen (${totals.validBallots} Stimmzettel x ${round.maxVotes} Stimmen).`
      })
    }
  }

  if (kind === 'global_only') {
    const sum = (data.yes ?? 0) + (data.no ?? 0) + (data.abstentions ?? 0)
    if (sum > totals.validBallots) {
      issues.push({
        level: 'error',
        message: `Ja/Nein/Enthaltung ergeben ${sum}, es liegen aber nur ${totals.validBallots} gültige Stimmzettel vor.`
      })
    }
    if (sum < totals.validBallots) {
      issues.push({
        level: 'warning',
        message: `Ja/Nein/Enthaltung ergeben ${sum} von ${totals.validBallots} gültigen Stimmzetteln.`
      })
    }
  }

  return issues
}

function allRows(data: ResultData): CandidateResult[] {
  const rows = [...data.candidates]
  for (const position of data.positions ?? []) {
    rows.push(...position.candidates)
  }
  return rows
}

export interface RankedCandidate extends CandidateResult {
  rank: number
  /** Vorschlag: liegt innerhalb der zu besetzenden Plätze. */
  withinSeats: boolean
  /** Stimmengleich mit einem anderen Kandidaten am Blockende (Wahlformen §18). */
  tiedAtCutoff: boolean
}

/**
 * Sortiert Kandidaten nach Stimmen (bzw. Ja-Stimmen) und markiert die Grenze
 * der zu besetzenden Plätze. Das ist ein VORSCHLAG, keine Feststellung.
 */
export function rankCandidates(candidates: CandidateResult[], seats: number): RankedCandidate[] {
  const score = (candidate: CandidateResult): number => candidate.votes ?? candidate.yes ?? 0
  const sorted = [...candidates].sort((a, b) => {
    const diff = score(b) - score(a)
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'de-DE')
  })

  const cutoffScore = sorted.length >= seats && seats > 0 ? score(sorted[seats - 1]) : undefined
  const tiedCount =
    cutoffScore === undefined ? 0 : sorted.filter((candidate) => score(candidate) === cutoffScore).length
  const tieCrossesCutoff =
    cutoffScore !== undefined && tiedCount > 1 && sorted.length > seats && score(sorted[seats]) === cutoffScore

  let rank = 0
  let previousScore: number | undefined
  return sorted.map((candidate, index) => {
    const value = score(candidate)
    if (value !== previousScore) {
      rank = index + 1
      previousScore = value
    }
    return {
      ...candidate,
      rank,
      withinSeats: index < seats,
      tiedAtCutoff: tieCrossesCutoff && value === cutoffScore
    }
  })
}

/** Bei Akzeptanzverfahren gewählt: mehr Ja- als Nein-Stimmen (Wahlformen §12). */
export function acceptanceQualified(candidate: CandidateResult): boolean {
  return (candidate.yes ?? 0) > (candidate.no ?? 0)
}

export interface DecisionSuggestion {
  decision: FinalDecision
  reason: string
  /** Kandidaten, die nach der Rechnung innerhalb der Plätze liegen. */
  suggestedElectedIds: string[]
  requiresLeaderDecision: boolean
}

/**
 * Rechnerischer Vorschlag für die Feststellung. Wird der Wahlleitung angezeigt
 * und muss aktiv übernommen werden — es gibt keine automatische Uebernahme.
 */
export function suggestDecision(
  round: Pick<ElectionRound, 'procedure' | 'seats'>,
  data: ResultData,
  totals: { validBallots: number }
): DecisionSuggestion {
  const profile = profileFor(round.procedure)

  // Sachabstimmungen und offene Abstimmungen werden nach Ja/Nein beurteilt —
  // „gewählt" ergibt dort keinen Sinn.
  if (round.procedure === 'yes_no_abstain' || round.procedure === 'open_vote') {
    const yes = data.yes ?? 0
    const no = data.no ?? 0
    if (yes === no) {
      return {
        decision: 'tie',
        reason: 'Ja- und Nein-Stimmen sind gleich.',
        suggestedElectedIds: [],
        requiresLeaderDecision: true
      }
    }
    return {
      decision: yes > no ? 'accepted' : 'rejected',
      reason: `Ja: ${yes}, Nein: ${no} (Mehrheitserfordernis nach Geschaeftsordnung prüfen).`,
      suggestedElectedIds: [],
      requiresLeaderDecision: true
    }
  }

  if (round.procedure === 'single_candidate') {
    const candidate = data.candidates[0]
    const yes = candidate?.yes ?? data.yes ?? 0
    const no = candidate?.no ?? data.no ?? 0
    if (yes === no) {
      return {
        decision: 'tie',
        reason: 'Ja- und Nein-Stimmen sind gleich.',
        suggestedElectedIds: [],
        requiresLeaderDecision: true
      }
    }
    return {
      decision: yes > no ? 'elected' : 'not_elected',
      reason: `Ja: ${yes}, Nein: ${no}. Erforderliche Mehrheit nach Wahlordnung prüfen.`,
      suggestedElectedIds: yes > no && candidate ? [candidate.candidateId] : [],
      requiresLeaderDecision: true
    }
  }

  if (profile.perCandidateChoice) {
    const qualified = data.candidates
      .filter(acceptanceQualified)
      .sort((a, b) => (b.yes ?? 0) - (a.yes ?? 0))
    const within = qualified.slice(0, round.seats)
    return {
      decision: within.length > 0 ? 'elected' : 'not_elected',
      reason: `${qualified.length} Kandidat(en) mit mehr Ja- als Nein-Stimmen, ${round.seats} Position(en) zu besetzen.`,
      suggestedElectedIds: within.map((candidate) => candidate.candidateId),
      requiresLeaderDecision: true
    }
  }

  const ranked = rankCandidates(data.candidates, round.seats)
  const tied = ranked.some((candidate) => candidate.tiedAtCutoff)
  const within = ranked.filter((candidate) => candidate.withinSeats)

  if (tied) {
    return {
      decision: 'tie',
      reason: 'Stimmengleichheit an der Grenze der zu besetzenden Plätze. Weiteres Verfahren durch die Wahlleitung.',
      suggestedElectedIds: [],
      requiresLeaderDecision: true
    }
  }

  const majority = Math.floor(totals.validBallots / 2) + 1
  const reachedMajority = within.filter((candidate) => (candidate.votes ?? 0) >= majority)

  if (
    (round.procedure === 'single_multiple_candidates' || round.procedure === 'runoff') &&
    reachedMajority.length === 0
  ) {
    return {
      decision: 'runoff',
      reason: `Kein Kandidat erreicht ${majority} Stimmen (einfache Mehrheit der gültigen Stimmzettel).`,
      suggestedElectedIds: [],
      requiresLeaderDecision: true
    }
  }

  // Wer keine einzige Stimme erhalten hat, wird nicht als gewählt
  // vorgeschlagen — auch dann nicht, wenn rechnerisch Plätze frei bleiben.
  const withVotes = within.filter((candidate) => (candidate.votes ?? 0) > 0)
  const withoutVotes = within.length - withVotes.length

  return {
    decision: withVotes.length > 0 ? 'elected' : 'not_elected',
    reason:
      withoutVotes > 0
        ? `${withVotes.length} Kandidat(en) mit Stimmen auf ${round.seats} Plätzen; ${withoutVotes} ohne eine einzige Stimme bleiben unberücksichtigt. Erforderliche Mehrheit nach Wahlordnung prüfen.`
        : `${withVotes.length} Kandidat(en) auf den vorderen ${round.seats} Plätzen. Erforderliche Mehrheit nach Wahlordnung prüfen.`,
    suggestedElectedIds: withVotes.map((candidate) => candidate.candidateId),
    requiresLeaderDecision: true
  }
}

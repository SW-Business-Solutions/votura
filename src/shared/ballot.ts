/**
 * Erzeugung der kanonischen Stimmzettel-Vorlage.
 *
 * Dieselbe Funktion speist Bildschirmvorschau, Hash, Thermodruck und Archiv —
 * es darf keine zweite, abweichende Darstellung geben (§16, §30).
 */
import { profileFor, sortCandidates } from './election'
import type {
  AppConfig,
  BallotDocument,
  BallotSection,
  Candidate,
  ElectionEvent,
  ElectionRound
} from './types'

export type BallotLabels = AppConfig['ballots']['labels']

export const DEFAULT_BALLOT_LABELS: BallotLabels = {
  yes: 'JA',
  no: 'NEIN',
  abstention: 'ENTHALTUNG',
  abstentionShort: 'ENTH',
  alternative: 'Alternativ:',
  testPrintMarker: 'TESTDRUCK - UNGÜLTIG',
  endMarker: 'ENDE',
  cutMarker: 'SCHNITT'
}

/** Reihenfolge der Kandidaten, wie sie auf dem Stimmzettel erscheint. */
export function orderedCandidates(round: ElectionRound, candidates: Candidate[]): Candidate[] {
  const active = candidates.filter((candidate) => !candidate.withdrawn)
  return sortCandidates(active, round.orderMode, round.orderSeed)
}

export function buildBallotDocument(
  event: ElectionEvent,
  round: ElectionRound,
  candidates: Candidate[],
  labels: BallotLabels = DEFAULT_BALLOT_LABELS
): BallotDocument {
  const profile = profileFor(round.procedure)
  const ordered = orderedCandidates(round, candidates)
  const template = round.template

  const lineFor = (candidate: Candidate): { candidateId: string; name: string; number?: number } => ({
    candidateId: candidate.id,
    name: candidate.displayName,
    ...(template.showCandidateNumbers && candidate.ballotNumber !== undefined
      ? { number: candidate.ballotNumber }
      : {})
  })

  const perCandidateOptions = (): string[] => {
    const options: string[] = []
    if (template.allowYes) options.push(labels.yes)
    if (template.allowNo) options.push(labels.no)
    if (template.allowAbstention) {
      options.push(template.compactMode ? labels.abstentionShort : labels.abstention)
    }
    return options
  }

  const sections: BallotSection[] = []

  if (round.procedure === 'single_candidate') {
    // Ein Bewerber, global mit Ja/Nein/Enthaltung beschieden (Wahlformen §3).
    sections.push({
      kind: 'global_options',
      candidates: ordered.map(lineFor),
      options: perCandidateOptions()
    })
  } else if (profile.entryKind === 'positions') {
    // Verbundene Einzelwahl: jede Position ist logisch eine eigene Einzelwahl.
    for (const position of round.positions) {
      sections.push({
        title: position.title,
        kind: 'per_candidate_choice',
        candidates: ordered.filter((candidate) => candidate.positionId === position.id).map(lineFor),
        options: perCandidateOptions()
      })
    }
  } else if (profile.perCandidateChoice) {
    sections.push({
      kind: 'per_candidate_choice',
      candidates: ordered.map(lineFor),
      options: perCandidateOptions()
    })
  } else if (profile.blankLines) {
    sections.push({
      kind: 'blank_lines',
      candidates: [],
      options: [],
      blankLines: template.blankLines
    })
  } else if (profile.entryKind === 'none') {
    // Sachabstimmung ohne Optionsliste (Ja/Nein/Enthaltung).
    sections.push({
      kind: 'global_options',
      candidates: [],
      options: perCandidateOptions()
    })
  } else {
    sections.push({
      kind: 'choice_list',
      candidates: ordered.map(lineFor),
      options: []
    })
  }

  // Globale Nein-/Enthaltungs-Optionen beziehen sich auf ALLE Bewerber und
  // dürfen nie hinter einzelnen Kandidaten stehen (Wahlformen §8).
  const needsGlobalOptions =
    !profile.perCandidateChoice &&
    profile.entryKind !== 'positions' &&
    round.procedure !== 'single_candidate' &&
    profile.entryKind !== 'none' &&
    (template.allowNo || template.allowAbstention || template.allowYes)

  if (needsGlobalOptions) {
    const options: string[] = []
    if (template.allowYes) options.push(labels.yes)
    if (template.allowNo) options.push(labels.no)
    if (template.allowAbstention) options.push(labels.abstention)
    sections.push({
      title: labels.alternative,
      kind: 'global_options',
      candidates: [],
      options
    })
  }

  return {
    event: {
      title: event.title,
      organization: event.organization,
      date: event.date,
      location: event.location
    },
    round: {
      number: round.sequentialNumber,
      label: round.roundLabel,
      code: round.roundCode,
      title: round.title,
      purpose: round.purpose,
      procedure: round.procedure,
      seats: round.seats,
      maxVotes: round.maxVotes,
      ...(round.seatStart !== undefined ? { seatStart: round.seatStart } : {}),
      ...(round.seatEnd !== undefined ? { seatEnd: round.seatEnd } : {}),
      ...(template.banner ? { banner: template.banner } : {}),
      instructions: template.instructionText,
      ...(template.motionText ? { motionText: template.motionText } : {}),
      ...(template.notice ? { notice: template.notice } : {})
    },
    sections,
    template,
    version: round.ballotVersion
  }
}

/**
 * Kanonische Repraesentation für den Ballot-Hash (§30).
 * Enthaelt bewusst NUR druckwirksame Angaben — interne IDs bleiben aussen vor,
 * damit derselbe gedruckte Zettel denselben Hash ergibt.
 */
export function ballotHashInput(document: BallotDocument): unknown {
  return {
    event: document.event,
    round: document.round,
    version: document.version,
    template: document.template,
    sections: document.sections.map((section) => ({
      title: section.title,
      kind: section.kind,
      options: section.options,
      blankLines: section.blankLines,
      candidates: section.candidates.map((candidate) => ({
        name: candidate.name,
        number: candidate.number
      }))
    }))
  }
}

/**
 * Wahlverfahren-Mechanik.
 *
 * Bewusst datengetrieben (Spezifikation §3, Wahlformen §46): Aus der Zahl der
 * Positionen darf die Software NICHT ableiten, wie gewählt wird. Das Verfahren
 * beschliesst die Versammlung; hier steht nur die Mechanik dazu.
 */
import type {
  BallotTemplateConfig,
  Candidate,
  CandidateOrderMode,
  ElectionProcedure,
  ElectionRound,
  RoundStatus
} from './types'

export interface ProcedureProfile {
  procedure: ElectionProcedure
  /** Wird für dieses Verfahren ueberhaupt ein Stimmzettel gedruckt? */
  ballotRequired: boolean
  /** Was wird erfasst: Kandidaten, Sachoptionen, Positionen mit Kandidaten – oder nichts. */
  entryKind: 'candidates' | 'options' | 'positions' | 'none'
  minEntries: number
  multiSeat: boolean
  /** Pro Eintrag wird getrennt JA/NEIN/ENTHALTUNG angekreuzt. */
  perCandidateChoice: boolean
  /** Stimmzettel enthält handschriftliche Namenszeilen statt Ankreuzfelder. */
  blankLines: boolean
  /** null = keine feste Höchstzahl. */
  defaultMaxVotes: (seats: number) => number | null
  defaultTemplate: () => Pick<
    BallotTemplateConfig,
    'allowYes' | 'allowNo' | 'allowAbstention' | 'compactMode' | 'blankLines' | 'banner'
  >
  defaultInstruction: (round: InstructionContext) => string
}

export interface InstructionContext {
  seats: number
  maxVotes: number | null
  entryCount: number
}

const globalYesNoAbstain = {
  allowYes: false,
  allowNo: true,
  allowAbstention: true,
  compactMode: false,
  blankLines: 0,
  banner: undefined
}

export const PROCEDURE_PROFILES: Record<ElectionProcedure, ProcedureProfile> = {
  single_candidate: {
    procedure: 'single_candidate',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({ ...globalYesNoAbstain, allowYes: true }),
    defaultInstruction: () => 'Bitte genau eine Option ankreuzen.'
  },
  single_multiple_candidates: {
    procedure: 'single_multiple_candidates',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 2,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({ ...globalYesNoAbstain }),
    defaultInstruction: () => 'Bitte genau einen Kandidaten oder Nein bzw. Enthaltung ankreuzen.'
  },
  runoff: {
    procedure: 'runoff',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 2,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({ ...globalYesNoAbstain, banner: 'STICHWAHL' }),
    defaultInstruction: () => 'Bitte genau EINE Option ankreuzen.'
  },
  connected_single_election: {
    procedure: 'connected_single_election',
    ballotRequired: true,
    entryKind: 'positions',
    minEntries: 1,
    multiSeat: true,
    perCandidateChoice: true,
    blankLines: false,
    defaultMaxVotes: () => null,
    defaultTemplate: () => ({
      allowYes: true,
      allowNo: true,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: 'VERBUNDENE EINZELWAHL'
    }),
    defaultInstruction: () => 'Bitte für JEDE Position eine Auswahl treffen.'
  },
  group_preprinted: {
    procedure: 'group_preprinted',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: true,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: (seats) => seats,
    defaultTemplate: () => ({ ...globalYesNoAbstain }),
    defaultInstruction: (r) => `Sie dürfen maximal ${r.maxVotes ?? r.seats} Kandidaten ankreuzen.`
  },
  group_blank: {
    procedure: 'group_blank',
    ballotRequired: true,
    entryKind: 'none',
    minEntries: 0,
    multiSeat: true,
    perCandidateChoice: false,
    blankLines: true,
    defaultMaxVotes: (seats) => seats,
    defaultTemplate: () => ({ ...globalYesNoAbstain, blankLines: 0 }),
    defaultInstruction: (r) => `Sie dürfen höchstens ${r.maxVotes ?? r.seats} Namen eintragen.`
  },
  acceptance_single: {
    procedure: 'acceptance_single',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: false,
    perCandidateChoice: true,
    blankLines: false,
    defaultMaxVotes: () => null,
    defaultTemplate: () => ({
      allowYes: true,
      allowNo: true,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: 'AKZEPTANZWAHL'
    }),
    defaultInstruction: () => 'Bitte bei JEDEM Kandidaten eine Auswahl treffen.'
  },
  acceptance_group: {
    procedure: 'acceptance_group',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: true,
    perCandidateChoice: true,
    blankLines: false,
    defaultMaxVotes: () => null,
    defaultTemplate: () => ({
      allowYes: true,
      allowNo: true,
      allowAbstention: true,
      compactMode: true,
      blankLines: 0,
      banner: 'AKZEPTANZWAHL'
    }),
    defaultInstruction: () => 'Bitte bei jedem Kandidaten Ja, Nein oder Enthaltung markieren.'
  },
  two_stage_stage_1: {
    procedure: 'two_stage_stage_1',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: true,
    perCandidateChoice: false,
    blankLines: false,
    // Keine feste Höchstzahl: die Stufe 1 dient der Qualifikation (Wahlformen §13).
    defaultMaxVotes: () => null,
    defaultTemplate: () => ({
      allowYes: false,
      allowNo: false,
      allowAbstention: false,
      compactMode: false,
      blankLines: 0,
      banner: 'ZWEI-STUFEN-WAHL / STUFE 1'
    }),
    defaultInstruction: () => 'Sie können beliebig viele Kandidaten ankreuzen.'
  },
  two_stage_stage_2_single: {
    procedure: 'two_stage_stage_2_single',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({
      allowYes: false,
      allowNo: false,
      allowAbstention: false,
      compactMode: false,
      blankLines: 0,
      banner: 'ZWEI-STUFEN-WAHL / STUFE 2'
    }),
    defaultInstruction: () => 'Bitte genau EINEN Kandidaten ankreuzen.'
  },
  two_stage_stage_2_block: {
    procedure: 'two_stage_stage_2_block',
    ballotRequired: true,
    entryKind: 'candidates',
    minEntries: 1,
    multiSeat: true,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: (seats) => seats,
    defaultTemplate: () => ({
      allowYes: false,
      allowNo: false,
      allowAbstention: false,
      compactMode: false,
      blankLines: 0,
      banner: 'ZWEI-STUFEN-WAHL / STUFE 2'
    }),
    defaultInstruction: (r) => `Sie dürfen maximal ${r.maxVotes ?? r.seats} Kandidaten ankreuzen.`
  },
  yes_no_abstain: {
    procedure: 'yes_no_abstain',
    ballotRequired: true,
    entryKind: 'none',
    minEntries: 0,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({
      allowYes: true,
      allowNo: true,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: undefined
    }),
    defaultInstruction: () => 'Bitte genau eine Option ankreuzen.'
  },
  single_choice_motion: {
    procedure: 'single_choice_motion',
    ballotRequired: true,
    entryKind: 'options',
    minEntries: 2,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({
      allowYes: false,
      allowNo: false,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: undefined
    }),
    defaultInstruction: () => 'Bitte genau EINE Option auswählen.'
  },
  multiple_choice_motion: {
    procedure: 'multiple_choice_motion',
    ballotRequired: true,
    entryKind: 'options',
    minEntries: 2,
    multiSeat: true,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: (seats) => seats,
    defaultTemplate: () => ({
      allowYes: false,
      allowNo: false,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: undefined
    }),
    defaultInstruction: (r) => `Maximal ${r.maxVotes ?? r.seats} Optionen auswählen.`
  },
  alternative_choice: {
    procedure: 'alternative_choice',
    ballotRequired: true,
    entryKind: 'options',
    minEntries: 2,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => 1,
    defaultTemplate: () => ({
      allowYes: false,
      allowNo: false,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: undefined
    }),
    defaultInstruction: () => 'Bitte genau EINE Fassung auswählen.'
  },
  open_vote: {
    procedure: 'open_vote',
    ballotRequired: false,
    entryKind: 'none',
    minEntries: 0,
    multiSeat: false,
    perCandidateChoice: false,
    blankLines: false,
    defaultMaxVotes: () => null,
    defaultTemplate: () => ({
      allowYes: true,
      allowNo: true,
      allowAbstention: true,
      compactMode: false,
      blankLines: 0,
      banner: undefined
    }),
    defaultInstruction: () => ''
  }
}

export function profileFor(procedure: ElectionProcedure): ProcedureProfile {
  return PROCEDURE_PROFILES[procedure]
}

/** Standard-Template für ein Verfahren, inklusive automatisch erzeugter Wahlanweisung. */
export function defaultTemplateFor(
  procedure: ElectionProcedure,
  context: InstructionContext
): BallotTemplateConfig {
  const profile = profileFor(procedure)
  const base = profile.defaultTemplate()
  return {
    showOrganization: true,
    showEventTitle: true,
    showDate: true,
    showLocation: false,
    showRoundNumber: true,
    showRoundCode: true,
    showCandidateNumbers: context.entryCount >= 10,
    compactMode: base.compactMode,
    // Lesbarkeit geht vor Papierersparnis: große Namen, große Ankreuzfelder
    // und Abstand zwischen den Personen.
    largeCandidates: true,
    // Regelfall: eine Stimme je Bewerber. Kumulieren wird bewusst nur auf
    // ausdrückliche Einstellung hin gedruckt.
    votesPerCandidate: 1,
    candidateSpacingLines: 1,
    allowYes: base.allowYes,
    allowNo: base.allowNo,
    allowAbstention: base.allowAbstention,
    blankLines: profile.blankLines ? Math.max(context.seats, base.blankLines) : base.blankLines,
    banner: base.banner,
    instructionText: profile.defaultInstruction(context)
  }
}

/**
 * Ergaenzt fehlende Template-Felder mit sinnvollen Vorgaben. Noetig für
 * Wahlgänge, die vor einer Erweiterung der Vorlage angelegt wurden — sie
 * dürfen dadurch nicht plotzlich ohne Layoutangaben dastehen.
 */
export function withTemplateDefaults(template: Partial<BallotTemplateConfig> | undefined): BallotTemplateConfig {
  return {
    showOrganization: true,
    showEventTitle: true,
    showDate: true,
    showLocation: false,
    showRoundNumber: true,
    showRoundCode: true,
    showCandidateNumbers: false,
    compactMode: false,
    largeCandidates: true,
    votesPerCandidate: 1,
    candidateSpacingLines: 1,
    allowYes: false,
    allowNo: true,
    allowAbstention: true,
    blankLines: 0,
    instructionText: '',
    ...template
  }
}

export interface ValidationIssue {
  field: string
  message: string
  level: 'error' | 'warning'
}

/** Prüft die Wahlgang-Parameter vor dem Schließen der Kandidatenliste. */
export function validateRoundSetup(
  round: Pick<
    ElectionRound,
    'procedure' | 'seats' | 'maxVotes' | 'title' | 'template' | 'positions' | 'seatStart' | 'seatEnd'
  >,
  candidates: Pick<Candidate, 'displayName' | 'withdrawn' | 'ballotNumber' | 'positionId'>[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const profile = profileFor(round.procedure)
  const active = candidates.filter((c) => !c.withdrawn)

  if (!round.title.trim()) {
    issues.push({ field: 'title', message: 'Der Wahlgang braucht eine Bezeichnung.', level: 'error' })
  }
  if (round.seats < 1) {
    issues.push({ field: 'seats', message: 'Es muss mindestens eine Position besetzt werden.', level: 'error' })
  }
  if (!profile.multiSeat && round.seats !== 1) {
    issues.push({
      field: 'seats',
      message: 'Dieses Verfahren sieht genau eine zu besetzende Position vor.',
      level: 'error'
    })
  }

  if (profile.entryKind === 'candidates' || profile.entryKind === 'options') {
    const noun = profile.entryKind === 'options' ? 'Optionen' : 'Kandidaten'
    if (active.length < profile.minEntries) {
      issues.push({
        field: 'candidates',
        message: `Dieses Verfahren benötigt mindestens ${profile.minEntries} ${noun}.`,
        level: 'error'
      })
    }
  }

  if (profile.entryKind === 'positions') {
    if (round.positions.length < 1) {
      issues.push({ field: 'positions', message: 'Es ist keine Position erfasst.', level: 'error' })
    }
    for (const position of round.positions) {
      if (!position.title.trim()) {
        issues.push({ field: 'positions', message: 'Jede Position braucht eine Bezeichnung.', level: 'error' })
      }
      const assigned = active.filter((c) => c.positionId === position.id)
      if (assigned.length === 0) {
        issues.push({
          field: 'positions',
          message: `Zur Position "${position.title}" ist kein Kandidat erfasst.`,
          level: 'error'
        })
      }
    }
    if (round.positions.length !== round.seats) {
      issues.push({
        field: 'seats',
        message: `Die Zahl der Positionen (${round.positions.length}) weicht von der Zahl der zu besetzenden Positionen (${round.seats}) ab.`,
        level: 'warning'
      })
    }
  }

  if (round.maxVotes !== null) {
    if (round.maxVotes < 1) {
      issues.push({
        field: 'maxVotes',
        message: 'Die maximale Stimmenzahl muss mindestens 1 betragen.',
        level: 'error'
      })
    }
    if (profile.entryKind === 'candidates' && active.length > 0 && round.maxVotes > active.length) {
      issues.push({
        field: 'maxVotes',
        message: `Die maximale Stimmenzahl (${round.maxVotes}) ist größer als die Zahl der Kandidaten (${active.length}).`,
        level: 'warning'
      })
    }
    if (profile.multiSeat && !profile.perCandidateChoice && round.maxVotes !== round.seats) {
      issues.push({
        field: 'maxVotes',
        message: `Die maximale Stimmenzahl (${round.maxVotes}) weicht von der Zahl der Positionen (${round.seats}) ab. Bitte gegen die Wahlordnung prüfen.`,
        level: 'warning'
      })
    }
  }

  if (profile.entryKind === 'candidates' && active.length > 0 && active.length < round.seats) {
    issues.push({
      field: 'candidates',
      message: `Es kandidieren weniger Personen (${active.length}) als Positionen zu besetzen sind (${round.seats}).`,
      level: 'warning'
    })
  }

  if (round.seatStart !== undefined && round.seatEnd !== undefined) {
    const blockSize = round.seatEnd - round.seatStart + 1
    if (blockSize !== round.seats) {
      issues.push({
        field: 'seats',
        message: `Der Listenplatzbereich ${round.seatStart}–${round.seatEnd} umfasst ${blockSize} Plätze, der Wahlgang nennt ${round.seats}.`,
        level: 'error'
      })
    }
  }

  const seen = new Map<string, number>()
  for (const candidate of active) {
    const key = candidate.displayName.trim().toLocaleLowerCase('de-DE')
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push({
        field: 'candidates',
        message: `Der Eintrag "${key}" kommt ${count}-mal vor. Auf dem Stimmzettel wären die Zeilen nicht unterscheidbar.`,
        level: 'warning'
      })
    }
  }

  if (round.template.showCandidateNumbers) {
    const numbers = active.map((c) => c.ballotNumber).filter((n): n is number => n !== undefined)
    if (numbers.length !== active.length) {
      issues.push({
        field: 'candidates',
        message: 'Kandidatennummern sollen gedruckt werden, aber nicht jeder Eintrag hat eine Nummer.',
        level: 'warning'
      })
    }
    if (new Set(numbers).size !== numbers.length) {
      issues.push({
        field: 'candidates',
        message: 'Die Kandidatennummern sind innerhalb des Wahlgangs nicht eindeutig.',
        level: 'error'
      })
    }
  }

  if (profile.blankLines && round.template.blankLines < 1) {
    issues.push({
      field: 'template',
      message: 'Für einen Blanko-Stimmzettel muss mindestens eine Namenszeile vorgesehen sein.',
      level: 'error'
    })
  }

  return issues
}

/** Erlaubte Statusuebergaenge des Wahlgangs. */
export const ROUND_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  draft: ['candidate_collection', 'cancelled'],
  candidate_collection: ['ready', 'cancelled'],
  ready: ['printing', 'open', 'candidate_collection', 'cancelled'],
  printing: ['ready', 'open', 'cancelled'],
  open: ['counting', 'cancelled'],
  counting: ['completed', 'open', 'cancelled'],
  completed: [],
  cancelled: []
}

export function canTransition(from: RoundStatus, to: RoundStatus): boolean {
  return ROUND_TRANSITIONS[from].includes(to)
}

/** Ein abgeschlossener oder abgebrochener Wahlgang ist im normalen UI unveränderbar (§29). */
export function isImmutable(status: RoundStatus): boolean {
  return status === 'completed' || status === 'cancelled'
}

/** Nach dem Schließen der Liste sind Kandidaten nur nach Entsperren änderbar (§9). */
export function candidatesEditable(status: RoundStatus): boolean {
  return status === 'draft' || status === 'candidate_collection'
}

export function sortCandidates<T extends Pick<Candidate, 'displayName' | 'lastName' | 'firstName' | 'sortOrder'>>(
  candidates: T[],
  mode: CandidateOrderMode,
  randomSeed?: number
): T[] {
  const list = [...candidates]
  switch (mode) {
    case 'alphabetical':
      return list.sort((a, b) => {
        const byLast = a.lastName.localeCompare(b.lastName, 'de-DE')
        return byLast !== 0 ? byLast : a.firstName.localeCompare(b.firstName, 'de-DE')
      })
    case 'random': {
      // Deterministisch anhand des Seeds, damit die Reihenfolge im Audit-Trail
      // reproduzierbar belegt werden kann (§15: Zufall nie automatisch).
      let seed = (randomSeed ?? 1) >>> 0
      const rand = (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return seed / 4294967296
      }
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[list[i], list[j]] = [list[j], list[i]]
      }
      return list
    }
    case 'manual':
    case 'assembly_decision':
    default:
      return list.sort((a, b) => a.sortOrder - b.sortOrder)
  }
}

/** Zerlegt eine Zeile der Schnellerfassung in Vor- und Nachnamen. */
export function parseCandidateLine(
  line: string
): { firstName: string; lastName: string; displayName: string } | null {
  const cleaned = line.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  // Format "Mustermann, Max" ebenso unterstuetzen wie "Max Mustermann".
  if (cleaned.includes(',')) {
    const [last, first] = cleaned.split(',', 2).map((part) => part.trim())
    const displayName = first ? `${first} ${last}` : last
    return { firstName: first ?? '', lastName: last, displayName }
  }
  const parts = cleaned.split(' ')
  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0], displayName: parts[0] }
  }
  const lastName = parts[parts.length - 1]
  const firstName = parts.slice(0, -1).join(' ')
  return { firstName, lastName, displayName: cleaned }
}

export function parseCandidateBlock(
  text: string
): { firstName: string; lastName: string; displayName: string }[] {
  return text
    .split(/\r?\n/)
    .map(parseCandidateLine)
    .filter((entry): entry is { firstName: string; lastName: string; displayName: string } => entry !== null)
}

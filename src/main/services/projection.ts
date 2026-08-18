/**
 * Projektionsdienst für die Beamer-/Audience-Ansicht.
 *
 * Harte Regeln (Beamer §11, §14, §47, §75):
 * - Kandidaten stammen nach der Freigabe IMMER aus dem Ballot-Snapshot, damit
 *   Beamer und Papier dieselbe Liste zeigen.
 * - Ein Ergebnis wird erst nach ausdrücklicher Bestätigung projiziert.
 * - Es verlassen ausschließlich reduzierte DTOs den Main-Prozess.
 */
import { randomUUID } from 'node:crypto'
import { PROCEDURE_LABELS } from '@shared/types'
import {
  EMPTY_PROJECTION_STATE,
  PROJECTION_MODE_LABELS,
  paginateCandidates,
  projectionPageCount,
  projectionResultPageCount,
  type ProjectionCandidate,
  type ProjectionHistoryEntry,
  type ProjectionMode,
  type ProjectionResult,
  type ProjectionRound,
  type ProjectionState
} from '@shared/projection'
import { rankCandidates } from '@shared/result'
import { profileFor } from '@shared/election'
import type { ElectionRound, UUID } from '@shared/types'
import { db } from '../db'
import { fromJson } from '../db/driver'
import { appendAudit } from './audit'
import { getSession } from './auth'
import { approvedDocument } from './ballots'
import { listCandidates } from './candidates'
import { activeEvent, getEvent } from './events'
import { getRound } from './rounds'
import { getResult } from './results'
import { getProjectionTheme } from './settings'
import { agendaOverview } from './agenda'

type Listener = (state: ProjectionState) => void

let state: ProjectionState = { ...EMPTY_PROJECTION_STATE }
let currentRoundId: UUID | undefined
let demoMode = false
const listeners: Listener[] = []

export function onProjectionChanged(listener: Listener): void {
  listeners.push(listener)
}

function broadcast(): void {
  const snapshot = getProjectionState()
  for (const listener of listeners) listener(snapshot)
}

function persist(): void {
  db()
    .prepare(
      `INSERT INTO projection_state (id, state_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
    )
    .run(JSON.stringify({ state, currentRoundId }), state.updatedAt)
}

function recordHistory(mode: ProjectionMode): void {
  db()
    .prepare(`INSERT INTO projection_history (timestamp, mode, label, round_label) VALUES (?, ?, ?, ?)`)
    .run(state.updatedAt, mode, PROJECTION_MODE_LABELS[mode], state.round?.roundLabel ?? null)
}

export function history(): ProjectionHistoryEntry[] {
  return db()
    .prepare(`SELECT timestamp, mode, label, round_label FROM projection_history ORDER BY seq DESC LIMIT 200`)
    .all<{ timestamp: string; mode: string; label: string; round_label: string | null }>()
    .map((row) => ({
      timestamp: row.timestamp,
      mode: row.mode as ProjectionMode,
      label: row.label,
      roundLabel: row.round_label ?? undefined
    }))
}

/**
 * Kennung dieses Programmlaufs. Eine Netzwerkansicht erkennt daran, dass die
 * Anwendung neu gestartet wurde, und lädt sich selbst neu — sonst liefe sie
 * nach einer Aktualisierung mit altem Programmstand weiter.
 */
const SERVER_INSTANCE_ID = randomUUID()

export function getProjectionState(): ProjectionState {
  // Das Erscheinungsbild kommt immer frisch aus der Konfiguration, damit
  // Farb- und Logoänderungen sofort auf allen Anzeigen ankommen.
  return { ...state, serverInstanceId: SERVER_INSTANCE_ID, theme: getProjectionTheme() }
}

/** Nach Änderung von Farben oder Logo alle Anzeigen aktualisieren. */
export function refreshTheme(): ProjectionState {
  state = { ...state, theme: getProjectionTheme(), updatedAt: new Date().toISOString() }
  broadcast()
  return state
}

/**
 * Nach einem Neustart wird der letzte Zustand geladen, aber NICHT automatisch
 * ein Ergebnis wieder projiziert (Beamer §57) — der Beamer startet neutral.
 */
export function restoreProjection(): void {
  const row = db().prepare(`SELECT state_json FROM projection_state WHERE id = 1`).get<{ state_json: string }>()
  const stored = fromJson<{ state: ProjectionState; currentRoundId?: UUID } | null>(row?.state_json, null)
  const event = activeEvent()

  state = {
    ...EMPTY_PROJECTION_STATE,
    event: event
      ? { title: event.title, organization: event.organization, date: event.date }
      : EMPTY_PROJECTION_STATE.event,
    updatedAt: new Date().toISOString()
  }
  currentRoundId = stored?.currentRoundId
  if (stored && (stored.state.mode === 'result' || stored.state.mode === 'runoff_announced')) {
    // Ergebnisse werden nach Neustart nicht ungefragt erneut öffentlich gezeigt.
    state.mode = 'welcome'
  }
  broadcast()
}

function eventInfo(): ProjectionState['event'] {
  const event = activeEvent()
  if (!event) return state.event
  return { title: event.title, organization: event.organization, date: event.date }
}

function candidatesForProjection(round: ElectionRound): {
  candidates: ProjectionCandidate[]
  ballotVersion?: number
} {
  const approved = approvedDocument(round.id)
  if (approved) {
    const candidates = approved.document.sections
      .flatMap((section) => section.candidates)
      .map((candidate) => ({
        id: candidate.candidateId,
        displayName: candidate.name,
        ...(candidate.number !== undefined ? { ballotNumber: candidate.number } : {})
      }))
    return { candidates, ballotVersion: approved.version }
  }
  return {
    candidates: listCandidates(round.id)
      .filter((candidate) => !candidate.withdrawn)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        ...(candidate.ballotNumber !== undefined ? { ballotNumber: candidate.ballotNumber } : {})
      }))
  }
}

function projectionStatusFor(round: ElectionRound): ProjectionRound['status'] {
  switch (round.status) {
    case 'open':
      return 'open'
    case 'counting':
      return 'counting'
    case 'completed':
      return 'completed'
    case 'printing':
    case 'ready':
      return 'ready'
    default:
      return 'upcoming'
  }
}

function buildRound(roundId: UUID): ProjectionRound {
  const round = getRound(roundId)
  const { candidates, ballotVersion } = candidatesForProjection(round)
  return {
    id: round.id,
    roundNumber: round.sequentialNumber,
    roundLabel: round.roundLabel,
    roundCode: round.roundCode,
    title: round.title,
    banner: round.template.banner,
    procedure: round.procedure,
    procedureLabel: PROCEDURE_LABELS[round.procedure],
    seats: round.seats,
    maxVotes: round.maxVotes,
    seatStart: round.seatStart,
    seatEnd: round.seatEnd,
    instructions: round.template.instructionText,
    motionText: round.template.motionText,
    ballotVersion,
    candidates,
    candidateCount: candidates.length,
    status: projectionStatusFor(round)
  }
}

function buildResult(roundId: UUID, showAll: boolean): ProjectionResult | undefined {
  const result = getResult(roundId)
  // Ohne Bestätigung wird nichts projiziert (Beamer §14).
  if (!result?.confirmedAt) return undefined
  const round = getRound(roundId)
  const electedIds = new Set(result.electedCandidateIds ?? [])

  /*
   * Beim Akzeptanzverfahren zählen Ja/Nein je Bewerber, nicht eine
   * Stimmenzahl. Ältere Ergebnisse tragen dort eine mitgespeicherte Null in
   * "votes" — die würde auf dem Beamer als Stimmenzahl 0 erscheinen und die
   * Ja-Stimmen verdecken.
   */
  const perCandidateChoice = profileFor(round.procedure).perCandidateChoice
  const ranked = rankCandidates(
    perCandidateChoice
      ? result.resultData.candidates.map(({ votes: _votes, ...rest }) => rest)
      : result.resultData.candidates,
    round.seats
  )
  const candidates: ProjectionCandidate[] = ranked.map((candidate) => ({
    id: candidate.candidateId,
    displayName: candidate.name,
    votes: candidate.votes,
    yes: candidate.yes,
    no: candidate.no,
    abstain: candidate.abstain,
    elected: electedIds.has(candidate.candidateId),
    resultStatus: electedIds.has(candidate.candidateId)
      ? 'elected'
      : result.finalDecision === 'runoff'
        ? 'runoff'
        : 'not_elected'
  }))

  const declared = result.countingMode === 'declared'

  return {
    status: 'confirmed',
    declared,
    declaration: result.declaration,
    // Ohne Auszählung gibt es keine Zahlen – dann werden auch keine gezeigt.
    ballotsCast: declared ? undefined : result.ballotsCast,
    validBallots: declared ? undefined : result.validBallots,
    invalidBallots: declared ? undefined : result.invalidBallots,
    /*
     * Globale Ja/Nein/Enthaltung gibt es nur bei Verfahren, die sie kennen.
     * Beim Akzeptanzverfahren stehen sie je Bewerber — eine mitgespeicherte
     * globale Null stünde sonst als einzelne Kachel über der Liste.
     */
    yes: declared || perCandidateChoice ? undefined : result.resultData.yes,
    no: declared || perCandidateChoice ? undefined : result.resultData.no,
    abstentions: declared || perCandidateChoice ? undefined : result.resultData.abstentions,
    candidates: showAll
      ? candidates
      : candidates.filter((candidate) => candidate.elected || electedIds.size === 0),
    showAll,
    finalDecision: result.finalDecision,
    finalMessage: result.determination,
    runoffRequired: result.finalDecision === 'runoff'
  }
}

/**
 * Tagesordnung für die öffentliche Anzeige: die gepflegte Liste wird vollständig
 * übernommen, der erste offene Punkt gilt als aktueller.
 */
function buildAgenda(
  override: { top?: string; current?: string; next?: string } | undefined,
  view: 'full' | 'focus'
): ProjectionState['agenda'] {
  const event = activeEvent()
  if (!event) return { view, ...override }

  const { items, current, next } = agendaOverview(event.id)
  return {
    view,
    top: override?.top ?? current?.label,
    current: override?.current ?? current?.title,
    next: override?.next ?? next?.title,
    items: items.map((item) => ({
      label: item.label,
      title: item.title,
      done: item.done,
      current: item.id === current?.id
    }))
  }
}

export interface SetModeInput {
  mode: ProjectionMode
  roundId?: UUID
  message?: { title: string; body?: string; showRoundContext?: boolean }
  agenda?: { top?: string; current?: string; next?: string }
  /** Vollständige Tagesordnung oder nur der aktuelle Punkt. */
  agendaView?: 'full' | 'focus'
  showAll?: boolean
  /** Dauer einer Pause in Minuten; erzeugt den Countdown auf dem Beamer. */
  breakMinutes?: number
}

export function setProjection(input: SetModeInput, options: { audit?: boolean } = {}): ProjectionState {
  if (demoMode && input.mode !== 'welcome') demoMode = false

  const roundId = input.roundId ?? currentRoundId
  // Nur diese Ansichten beziehen sich auf einen Wahlgang. Bei Tagesordnung,
  // Begrüßung, Pause oder freier Mitteilung darf kein Wahlgang mitlaufen —
  // sonst stünde in der Fußzeile eine Kennung ohne Bezug zum Gezeigten.
  const usesRound: ProjectionMode[] = [
    'upcoming_round',
    'candidate_presentation',
    'round_ready',
    'round_open',
    'round_closed',
    'counting',
    'result',
    'runoff_announced'
  ]

  let round: ProjectionRound | undefined
  if (usesRound.includes(input.mode) && roundId) {
    try {
      const candidate = getRound(roundId)
      // Ein Wahlgang aus einer anderen (z. B. archivierten) Veranstaltung wird
      // nicht angezeigt.
      if (candidate.eventId === activeEvent()?.id) {
        round = buildRound(roundId)
        currentRoundId = roundId
      } else {
        currentRoundId = undefined
      }
    } catch {
      round = undefined
      currentRoundId = undefined
    }
  }

  // Standard ist die vollständige Anzeige: auch die nicht gewählten Bewerber
  // werden mit ihrer Stimmenzahl gezeigt (Transparenz der Auszählung).
  const showAll = input.showAll ?? state.result?.showAll ?? true
  const result =
    (input.mode === 'result' || input.mode === 'runoff_announced') && roundId
      ? buildResult(roundId, showAll)
      : undefined

  const candidateCount = round?.candidateCount ?? 0
  const agenda =
    input.mode === 'agenda'
      ? buildAgenda(input.agenda, input.agendaView ?? state.agenda?.view ?? 'full')
      : undefined

  // Auch die Tagesordnung blättert um, wenn sie zu lang für ein Bild ist:
  // ab elf Punkten zweispaltig (höchstens 32 je Seite), sonst höchstens 16.
  // Die Einträge werden anschließend gleichmäßig auf die Seiten verteilt.
  const agendaItems = agenda?.view === 'full' ? (agenda.items?.length ?? 0) : 0
  const agendaPages = agendaItems > 0 ? Math.max(1, Math.ceil(agendaItems / (agendaItems > 10 ? 32 : 16))) : 1

  state = {
    mode: input.mode,
    serverInstanceId: SERVER_INSTANCE_ID,
    theme: getProjectionTheme(),
    event: eventInfo(),
    round,
    result,
    message: input.message ?? (input.mode === 'custom_message' ? state.message : undefined),
    agenda,
    breakUntil:
      input.mode === 'break' && input.breakMinutes && input.breakMinutes > 0
        ? new Date(Date.now() + input.breakMinutes * 60_000).toISOString()
        : input.mode === 'break'
          ? state.breakUntil
          : undefined,
    candidatePage: 0,
    // Im Ergebnis zählt die tatsächlich gezeigte Liste: sie kann kürzer sein
    // als das Bewerberfeld (nur Gewählte) und blättert nach eigenen Regeln.
    candidatePageCount:
      input.mode === 'agenda'
        ? agendaPages
        : result?.candidates
          ? projectionResultPageCount(result.candidates.length)
          : projectionPageCount(candidateCount),
    candidatePageIntervalSeconds: state.candidatePageIntervalSeconds,
    locked: state.locked,
    updatedAt: new Date().toISOString()
  }

  persist()
  recordHistory(input.mode)
  broadcast()

  if (options.audit !== false) {
    const session = getSession()
    appendAudit({
      action: 'projection.mode_set',
      userId: session?.user.id,
      userName: session?.user.displayName,
      electionRoundId: roundId,
      newValue: { mode: input.mode, label: PROJECTION_MODE_LABELS[input.mode], round: round?.roundLabel }
    })
  }

  return state
}

/** Automatische Folge aus Domain-Ereignissen (Beamer §24/§49/§50). */
export function projectDomainEvent(
  event:
    | 'RoundAnnounced'
    | 'CandidatesFinalized'
    | 'BallotApproved'
    | 'RoundOpened'
    | 'RoundClosed'
    | 'CountingStarted'
    | 'ResultConfirmed'
    | 'RoundCompleted'
    | 'RunoffCreated',
  roundId: UUID
): void {
  const mapping: Record<typeof event, ProjectionMode | null> = {
    RoundAnnounced: 'upcoming_round',
    CandidatesFinalized: 'candidate_presentation',
    BallotApproved: 'round_ready',
    RoundOpened: 'round_open',
    RoundClosed: 'round_closed',
    CountingStarted: 'counting',
    ResultConfirmed: 'result',
    RoundCompleted: null,
    RunoffCreated: 'runoff_announced'
  }
  const mode = mapping[event]
  if (!mode) return
  // Beamer-Sperre: während laufender Wahl nicht ungefragt umschalten (§79).
  if (state.locked && state.round && state.round.id !== roundId) return
  setProjection({ mode, roundId }, { audit: false })
}

export function setCandidatePage(page: number): ProjectionState {
  const maxPage = Math.max(0, state.candidatePageCount - 1)
  state = {
    ...state,
    candidatePage: Math.min(Math.max(0, page), maxPage),
    updatedAt: new Date().toISOString()
  }
  persist()
  broadcast()
  return state
}

export function setLocked(locked: boolean): ProjectionState {
  const session = getSession()
  state = { ...state, locked, updatedAt: new Date().toISOString() }
  persist()
  broadcast()
  appendAudit({
    action: locked ? 'projection.locked' : 'projection.unlocked',
    userId: session?.user.id,
    userName: session?.user.displayName
  })
  return state
}

/** Kandidatenliste der aktuellen Beamerseite (für Renderer und Netzwerkansicht). */
export function currentPageCandidates(): ProjectionCandidate[] {
  if (!state.round) return []
  return paginateCandidates(state.round.candidates, state.candidatePage)
}

/* --------------------------------------------------------------- Demo-Modus */

export function setDemoMode(enabled: boolean): ProjectionState {
  demoMode = enabled
  if (!enabled) {
    restoreProjection()
    return state
  }

  const names = [
    'Max Mustermann',
    'Erika Musterfrau',
    'Peter Beispiel',
    'Anna Beispiel',
    'Thomas Muster',
    'Julia Mustermann',
    'Klaus Beispiel',
    'Maria Muster',
    'Frank Beispiel',
    'Laura Mustermann',
    'Sven Beispiel',
    'Jana Musterfrau'
  ]
  const candidates: ProjectionCandidate[] = names.map((name, index) => ({
    id: `demo-${index}`,
    displayName: name,
    ballotNumber: index + 1
  }))

  state = {
    mode: 'candidate_presentation',
    serverInstanceId: SERVER_INSTANCE_ID,
    theme: getProjectionTheme(),
    event: {
      title: 'Mitgliederversammlung (DEMO)',
      organization: 'Beispielorganisation',
      date: new Date().toISOString().slice(0, 10)
    },
    round: {
      id: 'demo-round',
      roundNumber: 7,
      roundLabel: '07',
      roundCode: 'DEMO-WG07',
      title: 'Delegiertenwahl',
      procedure: 'group_preprinted',
      procedureLabel: PROCEDURE_LABELS.group_preprinted,
      seats: 8,
      maxVotes: 8,
      instructions: 'Sie dürfen maximal 8 Kandidaten ankreuzen.',
      candidates,
      candidateCount: candidates.length,
      status: 'ready'
    },
    candidatePage: 0,
    candidatePageCount: projectionPageCount(candidates.length),
    candidatePageIntervalSeconds: 8,
    locked: false,
    updatedAt: new Date().toISOString()
  }
  broadcast()
  return state
}

export function isDemoMode(): boolean {
  return demoMode
}

export function refreshEventInfo(): void {
  const event = activeEvent()
  // Beim Wechsel der Veranstaltung darf kein Wahlgang der vorherigen
  // Veranstaltung hängen bleiben.
  if (currentRoundId) {
    try {
      if (getRound(currentRoundId).eventId !== event?.id) currentRoundId = undefined
    } catch {
      currentRoundId = undefined
    }
  }
  if (!event) return
  state = {
    ...state,
    event: { title: event.title, organization: event.organization, date: event.date },
    updatedAt: new Date().toISOString()
  }
  broadcast()
}

export function projectionEventTitle(eventId: UUID): string {
  return getEvent(eventId).title
}

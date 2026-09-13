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
  pausenende,
  redezeitRest,
  REDNER_VORSCHAU_MAX,
  projectionPageCount,
  projectionResultPageCount,
  type ProjectionCandidate,
  type ProjectionHistoryEntry,
  type ProjectionMode,
  type ProjectionResult,
  BUEHNEN_MAX,
  BUEHNE_VORGABE,
  HAUPTBUEHNE,
  type Buehne,
  type ProjectionRound,
  type ProjectionSpeaker,
  type ProjectionState
} from '@shared/projection'
import type { ProjectionPresentation } from '@shared/presentation'
import type { ProjectionVideo } from '@shared/video'
import { rankCandidates } from '@shared/result'
import { profileFor } from '@shared/election'
import type { ElectionRound, UUID } from '@shared/types'
import { db } from '../db'
import { fromJson } from '../db/driver'
import { appendAudit } from './audit'
import { presentationKind } from '@shared/presentation'
import { getPresentation, rememberSlideCount } from './presentations'
import { getVideo, rememberDuration } from './videos'
import { getSession } from './auth'
import { approvedDocument } from './ballots'
import { listCandidates } from './candidates'
import { activeEvent, getEvent } from './events'
import { getRound } from './rounds'
import { getResult } from './results'
import { getProjectionTheme } from './settings'
import { agendaOverview } from './agenda'

type Listener = (buehne: number, state: ProjectionState) => void

/**
 * Der Zustand je Bühne.
 *
 * Bis 0.13 war das eine einzelne Variable. Die Form des Zustands ist
 * unverändert geblieben — es sind nur mehrere davon, einer je Anzeigefläche.
 * `buehneVon()` liefert immer einen: Wird eine unbekannte Bühne gefragt,
 * entsteht sie mit leerem Zustand, statt dass irgendwo `undefined` auftaucht.
 */
const zustaende = new Map<number, ProjectionState>()
let buehnen: Buehne[] = [{ ...BUEHNE_VORGABE }]
let currentRoundId: UUID | undefined
let demoMode = false
const listeners: Listener[] = []

function buehneVon(id: number): ProjectionState {
  const vorhanden = zustaende.get(id)
  if (vorhanden) return vorhanden
  const frisch: ProjectionState = { ...EMPTY_PROJECTION_STATE }
  zustaende.set(id, frisch)
  return frisch
}

/** Schreibt den Zustand in die Sammlung und gibt ihn zurück. */
function setzeUndGib(id: number, neuerZustand: ProjectionState): ProjectionState {
  zustaende.set(id, neuerZustand)
  return neuerZustand
}

export function onProjectionChanged(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const stelle = listeners.indexOf(listener)
    if (stelle >= 0) listeners.splice(stelle, 1)
  }
}

export function listBuehnen(): Buehne[] {
  return buehnen.map((buehne) => ({ ...buehne }))
}

/**
 * Legt eine Bühne an oder ändert ihren Namen und ihr Folgeverhalten.
 *
 * Die Hauptbühne lässt sich nicht entfernen: Sie ist die Ansicht, die es
 * immer gab, und an ihr hängt der automatische Ablauf.
 */
export function saveBuehnen(eingabe: Buehne[]): Buehne[] {
  const sauber = eingabe
    .filter((buehne) => Number.isFinite(buehne.id) && buehne.id >= 1 && buehne.id <= BUEHNEN_MAX)
    .map((buehne) => ({
      id: Math.round(buehne.id),
      name: buehne.name.trim() || `Bühne ${buehne.id}`,
      followsRound: Boolean(buehne.followsRound)
    }))
  if (!sauber.some((buehne) => buehne.id === HAUPTBUEHNE)) sauber.unshift({ ...BUEHNE_VORGABE })
  buehnen = sauber.sort((a, b) => a.id - b.id)

  /* Zustände entfernter Bühnen mitnehmen — sonst wüchse die Ablage endlos. */
  for (const id of [...zustaende.keys()]) {
    if (!buehnen.some((buehne) => buehne.id === id)) zustaende.delete(id)
  }
  persist()
  for (const buehne of buehnen) broadcast(buehne.id)
  return listBuehnen()
}

function broadcast(buehne: number): void {
  const snapshot = getProjectionState(buehne)
  for (const listener of listeners) listener(buehne, snapshot)
}

function persist(): void {
  const haupt = buehneVon(HAUPTBUEHNE)
  db()
    .prepare(
      `INSERT INTO projection_state (id, state_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
    )
    .run(
      JSON.stringify({
        buehnen,
        zustaende: Object.fromEntries(zustaende),
        currentRoundId
      }),
      haupt.updatedAt
    )
}

/**
 * Hält fest, was gezeigt wurde.
 *
 * Der Verlauf ist bühnenübergreifend: Für das Protokoll zählt, was im Saal zu
 * sehen war, nicht auf welcher Fläche. Der Bühnenname steht deshalb im Etikett.
 */
function recordHistory(buehne: number, mode: ProjectionMode, zustand: ProjectionState): void {
  const name = buehnen.find((eintrag) => eintrag.id === buehne)?.name
  const etikett =
    buehne === HAUPTBUEHNE
      ? PROJECTION_MODE_LABELS[mode]
      : `${PROJECTION_MODE_LABELS[mode]} (${name ?? `Bühne ${buehne}`})`
  db()
    .prepare(`INSERT INTO projection_history (timestamp, mode, label, round_label) VALUES (?, ?, ?, ?)`)
    .run(zustand.updatedAt, mode, etikett, zustand.round?.roundLabel ?? null)
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

export function getProjectionState(buehne: number = HAUPTBUEHNE): ProjectionState {
  let state = buehneVon(buehne)
  // Das Erscheinungsbild kommt immer frisch aus der Konfiguration, damit
  // Farb- und Logoänderungen sofort auf allen Anzeigen ankommen.
  return { ...state, serverInstanceId: SERVER_INSTANCE_ID, theme: getProjectionTheme() }
}

/** Nach Änderung von Farben oder Logo alle Anzeigen aktualisieren. */
export function refreshTheme(buehne: number = HAUPTBUEHNE): ProjectionState {
  let state = buehneVon(buehne)
  state = setzeUndGib(buehne, { ...state, theme: getProjectionTheme(), updatedAt: new Date().toISOString() })
  broadcast(buehne)
  return state
}

/**
 * Nach einem Neustart wird der letzte Zustand geladen, aber NICHT automatisch
 * ein Ergebnis wieder projiziert (Beamer §57) — der Beamer startet neutral.
 */
export function restoreProjection(): void {
  const row = db().prepare(`SELECT state_json FROM projection_state WHERE id = 1`).get<{ state_json: string }>()
  /*
   * Zwei Ablageformen: Bis 0.13 stand dort ein einzelner Zustand unter
   * `state`, seither die Bühnen. Beide werden gelesen — sonst stünde nach
   * einer Aktualisierung mitten in der Versammlung plötzlich keine Bühne mehr
   * da.
   */
  const stored = fromJson<{
    state?: ProjectionState
    buehnen?: Buehne[]
    zustaende?: Record<string, ProjectionState>
    currentRoundId?: UUID
  } | null>(row?.state_json, null)
  const event = activeEvent()

  buehnen = stored?.buehnen?.length ? stored.buehnen : [{ ...BUEHNE_VORGABE }]
  currentRoundId = stored?.currentRoundId

  zustaende.clear()
  for (const buehne of buehnen) {
    /*
     * Der Modus wird bewusst **nicht** wiederhergestellt: Nach einem Neustart
     * beginnt jede Fläche bei der Begrüßung. Ergebnisse dürfen nicht
     * ungefragt erneut öffentlich werden.
     */
    zustaende.set(buehne.id, {
      ...EMPTY_PROJECTION_STATE,
      event: event
        ? { title: event.title, organization: event.organization, date: event.date }
        : EMPTY_PROJECTION_STATE.event,
      updatedAt: new Date().toISOString()
    })
  }
  for (const buehne of buehnen) broadcast(buehne.id)
}

function eventInfo(buehne: number): ProjectionState['event'] {
  const event = activeEvent()
  if (!event) return buehneVon(buehne).event
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
    round.seats,
    /* Was die Versammlung bei Gleichstand entschieden hat, gilt auch auf dem
       Beamer — sonst stünde dort eine andere Reihenfolge als auf dem Beleg. */
    { decidedOrder: result.rankOrder }
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
  /**
   * Feste Uhrzeit, zu der es weitergeht — als "HH:MM" nach der Uhr dieses
   * Rechners.
   *
   * Bequemer als eine Dauer, sobald die Pause angesagt ist: „weiter um 12:30"
   * bleibt richtig, auch wenn zwischen Ansage und Anzeigen noch fünf Minuten
   * vergehen. Liegt die Zeit schon in der Vergangenheit, ist der morgige Tag
   * gemeint — eine Versammlung kann über Mitternacht gehen.
   */
  breakUntilTime?: string
  /** Welche Präsentation gezeigt wird (nur im Modus 'presentation'). */
  presentationId?: UUID
  /** Welches Video gezeigt wird (nur im Modus 'video'). */
  videoId?: UUID
  /** Wer sich vorstellt und wie lange (nur im Modus 'speaker'). */
  speaker?: {
    name: string
    note?: string
    seconds?: number
    /** Wer danach an der Reihe ist, in Reihenfolge. */
    upcoming?: string[]
    /** Wie viele davon der Beamer zeigt; 0 blendet die Vorschau aus. */
    upcomingShown?: number
  }
}

export function setProjection(
  buehne: number,
  input: SetModeInput,
  options: { audit?: boolean } = {}
): ProjectionState {
  let state = buehneVon(buehne)
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

  state = setzeUndGib(buehne, {
    mode: input.mode,
    serverInstanceId: SERVER_INSTANCE_ID,
    theme: getProjectionTheme(),
    event: eventInfo(buehne),
    round,
    result,
    message: input.message ?? (input.mode === 'custom_message' ? state.message : undefined),
    agenda,
    breakUntil:
      input.mode === 'break' && input.breakUntilTime
        ? pausenende(input.breakUntilTime)
        : input.mode === 'break' && input.breakMinutes && input.breakMinutes > 0
        ? new Date(Date.now() + input.breakMinutes * 60_000).toISOString()
        : input.mode === 'break'
          ? state.breakUntil
          : undefined,
    candidatePage: 0,
    candidatePageCount: seitenZahlFuer(input.mode, {
      agendaPages,
      resultCount: result?.candidates?.length,
      candidateCount
    }),
    candidatePageIntervalSeconds: state.candidatePageIntervalSeconds,
    locked: state.locked,
    /*
     * Die Präsentation überlebt einen Moduswechsel nicht.
     *
     * Wer vom Vortrag zurück auf den Wahlgang schaltet, will den Wahlgang
     * sehen — bliebe die Folie im Zustand stehen, zeigte die Netzwerkansicht
     * beim nächsten Wechsel wieder den alten Stand. Der Folienzähler beginnt
     * deshalb bei jedem Aufruf der Präsentation von vorn.
     */
    presentation:
      input.mode === 'presentation' ? praesentationFuer(input.presentationId) : undefined,
    /*
     * Dasselbe gilt für das Video: Wer zurück auf den Wahlgang schaltet, will
     * den Wahlgang sehen. Es beginnt bei jedem Aufruf angehalten bei Sekunde
     * null — ein Film, der von selbst losläuft, sobald er auf den Beamer
     * kommt, überrumpelt den Saal.
     */
    video: input.mode === 'video' ? videoFuer(input.videoId) : undefined,
    /*
     * Wie bei Präsentation und Video überlebt auch die Vorstellung keinen
     * Moduswechsel: Wer zurück auf den Wahlgang schaltet, will den Wahlgang
     * sehen — und beim nächsten Aufruf soll die Uhr von vorn laufen, nicht
     * beim Rest des vorigen Redners.
     */
    speaker: input.mode === 'speaker' ? rednerFuer(input.speaker) : undefined,
    updatedAt: new Date().toISOString()
  })

  persist()
  recordHistory(buehne, input.mode, state)
  broadcast(buehne)

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
  /*
   * Nur die Bühnen, die dem Wahlgang folgen sollen.
   *
   * Folgten alle, zeigten sie zwangsläufig dasselbe — und mehrere Flächen
   * hätten keinen Zweck. Wer nebenher eine Rednerliste oder einen Film zeigt,
   * will davon nicht überschrieben werden.
   */
  for (const buehne of buehnen) {
    if (!buehne.followsRound) continue
    const zustand = buehneVon(buehne.id)
    // Beamer-Sperre: während laufender Wahl nicht ungefragt umschalten (§79).
    if (zustand.locked && zustand.round && zustand.round.id !== roundId) continue
    setProjection(buehne.id, { mode, roundId }, { audit: false })
  }
}

/**
 * Baut den Präsentationsbezug für den Zustand.
 *
 * Ist die Datei verschwunden — von Hand gelöscht, Stick gewechselt —, bleibt
 * das Feld leer, und die Beameransicht zeigt ihren Hinweis statt eines
 * leeren Rahmens.
 */
function praesentationFuer(id?: UUID): ProjectionPresentation | undefined {
  if (!id) return undefined
  const gefunden = getPresentation(id)
  if (!gefunden) return undefined
  return {
    id: gefunden.id,
    title: gefunden.title,
    kind: presentationKind(gefunden),
    slide: 1,
    slideCount: gefunden.slideCount
  }
}

/**
 * Wie viele Seiten die Ansicht hat.
 *
 * Nur vier Ansichten blättern überhaupt: Tagesordnung, Kandidatenliste,
 * Stichwahlankündigung und Ergebnis. Wurde die Zahl für alle berechnet, bot
 * die Bedienung auch bei „Nächster Wahlgang" ein „Seite 2 von 2" an — für eine
 * Ansicht, die gar keine Liste zeigt. Alles andere hat genau eine Seite.
 *
 * Im Ergebnis zählt die tatsächlich gezeigte Liste: Sie kann kürzer sein als
 * das Bewerberfeld (nur Gewählte) und blättert nach eigenen Regeln.
 */
function seitenZahlFuer(
  mode: ProjectionMode,
  zahlen: { agendaPages: number; resultCount?: number; candidateCount: number }
): number {
  switch (mode) {
    case 'agenda':
      return zahlen.agendaPages
    case 'result':
      return zahlen.resultCount !== undefined
        ? projectionResultPageCount(zahlen.resultCount)
        : projectionPageCount(zahlen.candidateCount)
    case 'candidate_presentation':
    case 'runoff_announced':
      return projectionPageCount(zahlen.candidateCount)
    default:
      return 1
  }
}

function rednerFuer(eingabe?: SetModeInput['speaker']): ProjectionSpeaker | undefined {
  const name = eingabe?.name?.trim()
  if (!name) return undefined
  const sekunden = eingabe?.seconds && eingabe.seconds > 0 ? Math.round(eingabe.seconds) : undefined
  const warteliste = (eingabe?.upcoming ?? []).map((eintrag) => eintrag.trim()).filter(Boolean)
  return {
    name,
    note: eingabe?.note?.trim() || undefined,
    /* Ohne Zeitangabe wird nur der Name gezeigt — nicht jede Vorstellung ist
       begrenzt. */
    until: sekunden ? new Date(Date.now() + sekunden * 1000).toISOString() : undefined,
    totalSeconds: sekunden,
    ...(warteliste.length ? { upcoming: warteliste } : {}),
    ...(eingabe?.upcomingShown !== undefined
      ? { upcomingShown: Math.max(0, Math.min(Math.round(eingabe.upcomingShown), REDNER_VORSCHAU_MAX)) }
      : {})
  }
}

/**
 * Ruft die nächste Person auf.
 *
 * Die Uhr beginnt von vorn mit derselben zugestandenen Zeit — das ist der
 * Regelfall bei einer Reihe von Vorstellungen. Eine abweichende Zeit wird
 * anschließend über ±1 Minute oder ±10 Sekunden gesetzt.
 *
 * **Ohne Prüfeintrag** wie die übrige Anzeigesteuerung.
 */
export function nextSpeaker(buehne: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'speaker' || !state.speaker) return state
  const [naechster, ...rest] = state.speaker.upcoming ?? []
  if (!naechster) return state
  const sekunden = state.speaker.totalSeconds
  state = setzeUndGib(buehne, {
    ...state,
    speaker: {
      name: naechster,
      /* Der Zusatz gehörte zur vorigen Person und wird nicht mitgeschleppt. */
      note: undefined,
      until: sekunden ? new Date(Date.now() + sekunden * 1000).toISOString() : undefined,
      totalSeconds: sekunden,
      upcomingShown: state.speaker.upcomingShown,
      ...(rest.length ? { upcoming: rest } : {})
    },
    updatedAt: new Date().toISOString()
  })
  broadcast(buehne)
  return state
}

/**
 * Hält die Redezeit an oder lässt sie weiterlaufen.
 *
 * Eine Zwischenfrage soll die Vorstellung nicht beenden — und die Uhr nicht
 * währenddessen weiterlaufen lassen. **Ohne Prüfeintrag**: eine Anzeige, keine
 * Wahlhandlung.
 */
export function setSpeakerPaused(buehne: number, paused: boolean): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'speaker' || !state.speaker) return state
  const redner = state.speaker
  if (paused === (redner.pausedSecondsLeft !== undefined)) return state

  if (paused) {
    const rest = redezeitRest(redner)
    if (rest === undefined) return state
    state = setzeUndGib(buehne, {
      ...state,
      speaker: { ...redner, pausedSecondsLeft: rest },
      updatedAt: new Date().toISOString()
    })
  } else {
    const rest = redner.pausedSecondsLeft ?? 0
    const { pausedSecondsLeft: _weg, ...ohnePause } = redner
    state = setzeUndGib(buehne, {
      ...state,
      speaker: { ...ohnePause, until: new Date(Date.now() + rest * 1000).toISOString() },
      updatedAt: new Date().toISOString()
    })
  }
  broadcast(buehne)
  return state
}

/**
 * Verlängert oder kürzt die laufende Redezeit.
 *
 * „Noch eine Minute" ist auf einer Versammlung ein üblicher Zuruf; ihn über
 * einen Neustart der Vorstellung abzubilden hieße, die Uhr zurückzusetzen.
 */
export function addSpeakerSeconds(buehne: number, seconds: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'speaker' || !state.speaker) return state
  if (!Number.isFinite(seconds) || seconds === 0) return state
  const redner = state.speaker
  const zusatz = Math.round(seconds)

  if (redner.pausedSecondsLeft !== undefined) {
    state = setzeUndGib(buehne, {
      ...state,
      speaker: { ...redner, pausedSecondsLeft: redner.pausedSecondsLeft + zusatz },
      updatedAt: new Date().toISOString()
    })
  } else if (redner.until) {
    state = setzeUndGib(buehne, {
      ...state,
      speaker: {
        ...redner,
        until: new Date(new Date(redner.until).getTime() + zusatz * 1000).toISOString()
      },
      updatedAt: new Date().toISOString()
    })
  } else {
    /* Bisher ohne Uhr: Der Zuschlag startet sie. */
    if (zusatz <= 0) return state
    state = setzeUndGib(buehne, {
      ...state,
      speaker: {
        ...redner,
        until: new Date(Date.now() + zusatz * 1000).toISOString(),
        totalSeconds: zusatz
      },
      updatedAt: new Date().toISOString()
    })
  }
  broadcast(buehne)
  return state
}

function videoFuer(id?: UUID): ProjectionVideo | undefined {
  if (!id) return undefined
  const gefunden = getVideo(id)
  if (!gefunden) return undefined
  return {
    id: gefunden.id,
    title: gefunden.title,
    playing: false,
    position: 0,
    anchoredAt: Date.now(),
    durationSeconds: gefunden.durationSeconds,
    /* Der Beamer hat den Ton. Ob Nebenbildschirme ihn bekommen, entscheidet
       jedes Gerät für sich — ein Saal mit zehn Tablets im Chor wäre
       unerträglich. */
    muted: false,
    readyCount: 0
  }
}

/**
 * Setzt die Uhr des laufenden Videos neu.
 *
 * Jede Änderung — Start, Pause, Sprung — schreibt Position **und** Zeitpunkt.
 * Nur beides zusammen ergibt eine Aussage: „Sekunde 42, gemessen um 17:03:11".
 * Daraus rechnet jedes Gerät seinen Sollstand aus, auch eines, das erst danach
 * dazukommt.
 */
function setzeVideo(buehne: number, aenderung: Partial<ProjectionVideo>): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video) return state
  state = setzeUndGib(buehne, {
    ...state,
    video: { ...state.video, ...aenderung, anchoredAt: aenderung.anchoredAt ?? Date.now() },
    updatedAt: new Date().toISOString()
  })
  broadcast(buehne)
  return state
}

/** Aktuelle Sollposition — bei laufendem Video aus der Uhr fortgeschrieben. */
function sollPosition(video: ProjectionVideo): number {
  const gelaufen = video.playing ? Math.max(0, (Date.now() - video.anchoredAt) / 1000) : 0
  const roh = video.position + gelaufen
  return video.durationSeconds !== undefined ? Math.min(roh, video.durationSeconds) : roh
}

/**
 * Start und Pause des Videos.
 *
 * **Ohne Prüfeintrag** wie beim Blättern: Dass ein Film gezeigt wurde, steht
 * bereits als Moduswechsel im Protokoll. Wie oft dabei pausiert wurde, gehört
 * nicht zu den Wahlhandlungen.
 */
export function setVideoPlaying(buehne: number, playing: boolean): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video) return state
  if (state.video.playing === playing) return state
  /* Beim Anhalten wird der erreichte Stand festgeschrieben — sonst liefe die
     Uhr im Zustand weiter, während das Bild steht. */
  return setzeVideo(buehne, { playing, position: sollPosition(state.video) })
}

export function seekVideo(buehne: number, seconds: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video) return state
  if (!Number.isFinite(seconds)) return state
  const grenze = state.video.durationSeconds
  const ziel = Math.max(0, grenze !== undefined ? Math.min(seconds, grenze) : seconds)
  /* Ein Sprung setzt die Bereitmeldungen zurück: Was die Geräte gepuffert
     hatten, liegt jetzt an der falschen Stelle. */
  return setzeVideo(buehne, { position: ziel, readyCount: 0 })
}

export function setVideoMuted(buehne: number, muted: boolean): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video) return state
  if (state.video.muted === muted) return state
  return setzeVideo(buehne, { muted, position: sollPosition(state.video) })
}

/**
 * Ein Gerät meldet, dass es genug gepuffert hat.
 *
 * Gezählt wird nur, wie viele es sind — welches Gerät, ist für die Anzeige
 * gleichgültig und wäre eine Angabe über Anwesende, die niemand braucht.
 */
export function reportVideoReady(buehne: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video) return state
  return setzeVideo(buehne, {
    readyCount: state.video.readyCount + 1,
    position: sollPosition(state.video)
  })
}

/**
 * Übernimmt die Laufzeit, die das Gerät aus der Datei gelesen hat.
 *
 * Sie steckt im Containerformat; ihn hier zu zerlegen hieße, einen
 * Videodecoder nachzubauen.
 */
export function reportVideoDuration(buehne: number, seconds: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video) return state
  if (!Number.isFinite(seconds) || seconds <= 0) return state
  const gerundet = Math.round(seconds * 100) / 100
  rememberDuration(state.video.id, gerundet)
  if (state.video.durationSeconds === gerundet) return state
  return setzeVideo(buehne, { durationSeconds: gerundet, position: sollPosition(state.video) })
}

/**
 * Das Video ist durchgelaufen.
 *
 * Es bleibt am Ende stehen statt zurückzuspringen: Ein Film, der von vorn
 * beginnt, während die Versammlungsleitung schon spricht, zieht die
 * Aufmerksamkeit zurück auf die Wand.
 */
export function videoEnded(buehne: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'video' || !state.video || !state.video.playing) return state
  return setzeVideo(buehne, {
    playing: false,
    position: state.video.durationSeconds ?? sollPosition(state.video)
  })
}

/**
 * Blättert in der laufenden Präsentation.
 *
 * **Ohne Prüfeintrag**: Auf einer Versammlung wird ein Vortrag fünfzig Mal
 * weitergeklickt; das Protokoll soll Wahlhandlungen festhalten, nicht
 * Tastendrücke. Dass eine Präsentation gezeigt wurde, steht bereits als
 * Moduswechsel darin.
 */
export function setPresentationSlide(buehne: number, slide: number): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'presentation' || !state.presentation) return state
  const gesamt = state.presentation.slideCount
  const sicher = Math.max(1, gesamt ? Math.min(Math.round(slide), gesamt) : Math.round(slide))
  if (sicher === state.presentation.slide) return state
  state = setzeUndGib(buehne, {
    ...state,
    presentation: { ...state.presentation, slide: sicher },
    updatedAt: new Date().toISOString()
  })
  broadcast(buehne)
  return state
}

/**
 * Übernimmt, was die Präsentation über sich meldet.
 *
 * Die Folienzahl kennt nur das Dokument selbst — sie steht nirgends im
 * Dateikopf, sondern ergibt sich, wenn dessen Skript gelaufen ist.
 */
export function reportPresentationState(
  buehne: number,
  slide: number,
  slideCount: number
): ProjectionState {
  let state = buehneVon(buehne)
  if (state.mode !== 'presentation' || !state.presentation) return state
  if (!Number.isFinite(slideCount) || slideCount < 1) return state
  const gerundet = Math.round(slideCount)
  rememberSlideCount(state.presentation.id, gerundet)
  const sicher = Math.max(1, Math.min(Math.round(slide), gerundet))
  if (state.presentation.slideCount === gerundet && state.presentation.slide === sicher) return state
  state = setzeUndGib(buehne, {
    ...state,
    presentation: { ...state.presentation, slide: sicher, slideCount: gerundet },
    updatedAt: new Date().toISOString()
  })
  broadcast(buehne)
  return state
}

/**
 * Takt des automatischen Seitenwechsels; 0 hält ihn an.
 *
 * **Ohne Prüfeintrag**: eine Anzeigeeinstellung, keine Wahlhandlung.
 */
export function setCandidatePageInterval(buehne: number, seconds: number): ProjectionState {
  let state = buehneVon(buehne)
  if (!Number.isFinite(seconds)) return state
  const sicher = Math.max(0, Math.min(Math.round(seconds), 300))
  if (sicher === state.candidatePageIntervalSeconds) return state
  state = setzeUndGib(buehne, { ...state, candidatePageIntervalSeconds: sicher, updatedAt: new Date().toISOString() })
  persist()
  broadcast(buehne)
  return state
}

export function setCandidatePage(buehne: number, page: number): ProjectionState {
  let state = buehneVon(buehne)
  const maxPage = Math.max(0, state.candidatePageCount - 1)
  state = setzeUndGib(buehne, {
    ...state,
    candidatePage: Math.min(Math.max(0, page), maxPage),
    updatedAt: new Date().toISOString()
  })
  persist()
  broadcast(buehne)
  return state
}

export function setLocked(buehne: number, locked: boolean): ProjectionState {
  let state = buehneVon(buehne)
  const session = getSession()
  state = setzeUndGib(buehne, { ...state, locked, updatedAt: new Date().toISOString() })
  persist()
  broadcast(buehne)
  appendAudit({
    action: locked ? 'projection.locked' : 'projection.unlocked',
    userId: session?.user.id,
    userName: session?.user.displayName
  })
  return state
}

/** Kandidatenliste der aktuellen Beamerseite (für Renderer und Netzwerkansicht). */
export function currentPageCandidates(buehne: number = HAUPTBUEHNE): ProjectionCandidate[] {
  let state = buehneVon(buehne)
  if (!state.round) return []
  return paginateCandidates(state.round.candidates, state.candidatePage)
}

/* --------------------------------------------------------------- Demo-Modus */

export function setDemoMode(buehne: number, enabled: boolean): ProjectionState {
  let state = buehneVon(buehne)
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

  state = setzeUndGib(buehne, {
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
  })
  broadcast(buehne)
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
  for (const buehne of buehnen) {
    const zustand = buehneVon(buehne.id)
    setzeUndGib(buehne.id, {
      ...zustand,
      event: { title: event.title, organization: event.organization, date: event.date },
      updatedAt: new Date().toISOString()
    })
    broadcast(buehne.id)
  }
}

export function projectionEventTitle(eventId: UUID): string {
  return getEvent(eventId).title
}

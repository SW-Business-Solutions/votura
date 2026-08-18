/**
 * Projektions-DTOs für die Beamer-/Audience-Ansicht.
 *
 * Grundsatz (Beamer §75/§88): Die Audience erhält NIEMALS Domain-Objekte,
 * sondern ausschließlich diese reduzierten DTOs — keine UUID-Referenzen auf
 * Nutzer, keine Notizen, keine Hashes, keine Batch-IDs. Und sie hat keine
 * Schreib-API.
 */
import type { ElectionProcedure, IsoDate, IsoDateTime, UUID } from './types'

export const PROJECTION_MODES = [
  'welcome',
  'agenda',
  'upcoming_round',
  'candidate_presentation',
  'round_ready',
  'round_open',
  'round_closed',
  'counting',
  'result',
  'runoff_announced',
  'break',
  'custom_message',
  'session_finished'
] as const
export type ProjectionMode = (typeof PROJECTION_MODES)[number]

export const PROJECTION_MODE_LABELS: Record<ProjectionMode, string> = {
  welcome: 'Willkommen',
  agenda: 'Tagesordnung',
  upcoming_round: 'Nächster Wahlgang',
  candidate_presentation: 'Kandidaten',
  round_ready: 'Wahlgang bereit',
  round_open: 'Wahl läuft',
  round_closed: 'Stimmabgabe beendet',
  counting: 'Auszählung läuft',
  result: 'Ergebnis',
  runoff_announced: 'Stichwahl angekündigt',
  break: 'Pause',
  custom_message: 'Freie Mitteilung',
  session_finished: 'Versammlung beendet'
}

export type CandidateResultStatus = 'elected' | 'not_elected' | 'runoff' | 'pending'

export interface ProjectionCandidate {
  id: UUID
  ballotNumber?: number
  displayName: string
  votes?: number
  yes?: number
  no?: number
  abstain?: number
  elected?: boolean
  resultStatus?: CandidateResultStatus
}

export interface ProjectionRound {
  id: UUID
  roundNumber: number
  roundLabel: string
  roundCode: string
  title: string
  subtitle?: string
  banner?: string
  procedure: ElectionProcedure
  procedureLabel: string
  seats: number
  maxVotes: number | null
  seatStart?: number
  seatEnd?: number
  instructions?: string
  motionText?: string
  /** Gesetzt, sobald aus dem freigegebenen Stimmzettel projiziert wird (§47). */
  ballotVersion?: number
  candidates: ProjectionCandidate[]
  candidateCount: number
  status: 'upcoming' | 'ready' | 'open' | 'closed' | 'counting' | 'completed'
}

export type FinalDecision =
  | 'elected'
  | 'not_elected'
  | 'runoff'
  | 'accepted'
  | 'rejected'
  | 'tie'
  | 'manual'

export const FINAL_DECISION_LABELS: Record<FinalDecision, string> = {
  elected: 'GEWÄHLT',
  not_elected: 'NICHT GEWÄHLT',
  runoff: 'ES FOLGT EINE STICHWAHL',
  accepted: 'ANTRAG ANGENOMMEN',
  rejected: 'ANTRAG ABGELEHNT',
  tie: 'STIMMENGLEICHHEIT',
  manual: ''
}

export interface ProjectionResult {
  status: 'draft' | 'confirmed'
  /** Ohne Auszählung festgestellt: dann wird der Wortlaut gezeigt, keine Zahlen. */
  declared?: boolean
  declaration?: string
  ballotsCast?: number
  validBallots?: number
  invalidBallots?: number
  yes?: number
  no?: number
  abstentions?: number
  candidates?: ProjectionCandidate[]
  /** Vollständiges Ergebnis oder nur die Gewählten anzeigen (§18). */
  showAll: boolean
  finalDecision?: FinalDecision
  finalMessage?: string
  runoffRequired?: boolean
}

/**
 * Erscheinungsbild der Beameransicht. Wird mit dem Zustand ausgeliefert, damit
 * Fenster und Netzwerkansicht identisch aussehen. Das Logo ist als Data-URL
 * eingebettet — es wird nichts aus dem Netz nachgeladen (§2.2).
 */
export const LOGO_POSITIONS = [
  'header_left',
  'header_center',
  'corner_top_left',
  'corner_top_right',
  'corner_bottom_right',
  'watermark',
  'hidden'
] as const
export type LogoPosition = (typeof LOGO_POSITIONS)[number]

export const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  header_left: 'Kopfzeile links (statt Organisationsname)',
  header_center: 'Kopfzeile mittig',
  corner_top_left: 'Obere linke Ecke',
  corner_top_right: 'Obere rechte Ecke',
  corner_bottom_right: 'Untere rechte Ecke',
  watermark: 'Wasserzeichen im Hintergrund',
  hidden: 'Nicht anzeigen'
}

export interface ProjectionTheme {
  background: string
  surface: string
  text: string
  muted: string
  primary: string
  success: string
  warning: string
  danger: string

  /** Eingebettetes Logo (Data-URL) oder leer. */
  logo: string
  logoPosition: LogoPosition
  /** Logohöhe in Prozent der Bildhöhe. */
  logoSizePercent: number
  /** Deckkraft des Logos (0,05–1) – vor allem für das Wasserzeichen. */
  logoOpacity: number

  /* Kopfzeile */
  showOrganization: boolean
  showEventTitle: boolean
  showEventDate: boolean
  showClock: boolean

  /* Fußzeile */
  showRoundLabel: boolean
  showRoundCode: boolean

  /** Gesamtskalierung der Schrift (0,7–1,5). */
  fontScale: number
  /** Sicherheitsabstand zum Bildrand in Prozent (Overscan bei Projektoren). */
  safeAreaPercent: number
  /** Dezente Einblendung beim Wechsel. */
  transitions: boolean
  /** Kopfzeile und Statuszeilen in Großbuchstaben. */
  uppercaseHeadings: boolean
}

export const DEFAULT_PROJECTION_THEME: ProjectionTheme = {
  background: '#08090b',
  surface: '#12151a',
  text: '#f7fafc',
  muted: '#9fb0bf',
  primary: '#4a9eff',
  success: '#38c46a',
  warning: '#f0b429',
  danger: '#ff6b5e',
  logo: '',
  logoPosition: 'header_left',
  logoSizePercent: 12,
  logoOpacity: 1,
  showOrganization: true,
  showEventTitle: true,
  showEventDate: true,
  showClock: false,
  showRoundLabel: true,
  showRoundCode: true,
  fontScale: 1,
  safeAreaPercent: 5,
  transitions: true,
  uppercaseHeadings: true
}

/** Ältere Konfigurationen auf die erweiterten Optionen anheben. */
export function normalizeProjectionTheme(stored: Partial<ProjectionTheme> | undefined): ProjectionTheme {
  const legacy = stored?.logoPosition as string | undefined
  const logoPosition: LogoPosition =
    legacy === 'header'
      ? 'header_left'
      : legacy === 'corner'
        ? 'corner_top_right'
        : ((legacy as LogoPosition) ?? DEFAULT_PROJECTION_THEME.logoPosition)

  return { ...DEFAULT_PROJECTION_THEME, ...stored, logoPosition }
}

export interface ProjectionState {
  mode: ProjectionMode
  /**
   * Kennung des laufenden Hauptprozesses. Eine Netzwerkansicht, die noch mit
   * älterem Programmstand geladen ist, erkennt daran den Wechsel und lädt sich
   * selbst neu — im Betrieb muss niemand die Seite von Hand aktualisieren.
   */
  serverInstanceId: string
  theme: ProjectionTheme
  event: {
    title: string
    organization: string
    date: IsoDate
    startTime?: string
  }
  round?: ProjectionRound
  result?: ProjectionResult
  message?: {
    title: string
    body?: string
    /** Bei freien Mitteilungen ist der Wahlgangbezug meist unerwünscht. */
    showRoundContext?: boolean
  }
  /** Ende einer Pause für den Countdown (ISO 8601, UTC). */
  breakUntil?: IsoDateTime
  agenda?: {
    /**
     * 'full' zeigt die gesamte Tagesordnung, 'focus' nur den aktuellen Punkt
     * mit Ausblick — beide Darstellungen sind ausdrücklich wählbar.
     */
    view: 'full' | 'focus'
    top?: string
    current?: string
    next?: string
    items?: { label?: string; title: string; done: boolean; current: boolean }[]
  }
  /** Seitenweise Kandidatendarstellung bei langen Listen (§8/§78). */
  candidatePage: number
  candidatePageCount: number
  /** Automatischer Seitenwechsel in Sekunden; 0 = aus. */
  candidatePageIntervalSeconds: number
  /** Beamer-Sperre während laufender Wahl (§79). */
  locked: boolean
  updatedAt: IsoDateTime
}

export interface ProjectionHistoryEntry {
  timestamp: IsoDateTime
  mode: ProjectionMode
  label: string
  roundLabel?: string
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  primary: boolean
  current: boolean
}

export interface AudienceWindowState {
  open: boolean
  displayId?: number
  displays: DisplayInfo[]
  /** Nur ein Bildschirm vorhanden – Fenster läuft im Fenstermodus (§35). */
  singleDisplay: boolean
}

/** Wie viele Spalten die Kandidatenliste auf dem Beamer bekommt (§8). */
export function projectionColumns(candidateCount: number): 1 | 2 | 3 {
  if (candidateCount <= 8) return 1
  if (candidateCount <= 20) return 2
  return 3
}

/** Zeilen je Spalte, die auf einem Beamerbild sicher lesbar bleiben. */
export const PROJECTION_ROWS_PER_COLUMN = 10

/** Wie viele Einträge höchstens auf ein Bild passen. */
function maxPerPage(candidateCount: number): number {
  return projectionColumns(candidateCount) * PROJECTION_ROWS_PER_COLUMN
}

export function projectionPageCount(candidateCount: number): number {
  if (candidateCount <= 0) return 1
  return Math.max(1, Math.ceil(candidateCount / maxPerPage(candidateCount)))
}

/**
 * Einträge je Beamerseite — gleichmäßig auf alle Seiten verteilt.
 *
 * Bei 46 Kandidaten wären es sonst 30 und 16; so zeigt jede Seite 23 Namen und
 * die Anzeige bleibt über den Seitenwechsel hinweg ruhig.
 */
export function projectionPageSize(candidateCount: number): number {
  if (candidateCount <= 0) return PROJECTION_ROWS_PER_COLUMN
  return Math.ceil(candidateCount / projectionPageCount(candidateCount))
}

export function paginateCandidates(
  candidates: ProjectionCandidate[],
  page: number,
  pageSize = projectionPageSize(candidates.length)
): ProjectionCandidate[] {
  const start = page * pageSize
  return candidates.slice(start, start + pageSize)
}

/*
 * Ergebnisliste. Eine Ergebniszeile trägt Name, Stimmenzahl und Feststellung
 * ("GEWÄHLT") und braucht damit mehr Breite als eine reine Kandidatenliste —
 * deshalb wird später auf drei Spalten umgestellt als dort. Über der Liste
 * stehen außerdem Überschrift, Titel, ggf. der Ja/Nein-Block, die Feststellung
 * und die Stimmzettelbilanz; deshalb passen weniger Zeilen aufs Bild als bei
 * der Kandidatenvorstellung.
 */
export function projectionResultColumns(candidateCount: number): 1 | 2 | 3 {
  if (candidateCount <= 6) return 1
  if (candidateCount <= 24) return 2
  return 3
}

export const PROJECTION_RESULT_ROWS_PER_COLUMN = 6

export function projectionResultPageCount(candidateCount: number): number {
  if (candidateCount <= 0) return 1
  const perPage = projectionResultColumns(candidateCount) * PROJECTION_RESULT_ROWS_PER_COLUMN
  return Math.max(1, Math.ceil(candidateCount / perPage))
}

/** Einträge je Ergebnisseite — gleichmäßig verteilt, damit keine Seite halb leer bleibt. */
export function projectionResultPageSize(candidateCount: number): number {
  if (candidateCount <= 0) return PROJECTION_RESULT_ROWS_PER_COLUMN
  return Math.ceil(candidateCount / projectionResultPageCount(candidateCount))
}

export const EMPTY_PROJECTION_STATE: ProjectionState = {
  mode: 'welcome',
  serverInstanceId: '',
  theme: DEFAULT_PROJECTION_THEME,
  event: { title: '', organization: '', date: '' },
  candidatePage: 0,
  candidatePageCount: 1,
  candidatePageIntervalSeconds: 8,
  locked: false,
  updatedAt: '1970-01-01T00:00:00.000Z'
}

/**
 * Projektions-DTOs für die Beamer-/Audience-Ansicht.
 *
 * Grundsatz (Beamer §75/§88): Die Audience erhält NIEMALS Domain-Objekte,
 * sondern ausschließlich diese reduzierten DTOs — keine UUID-Referenzen auf
 * Nutzer, keine Notizen, keine Hashes, keine Batch-IDs. Und sie hat keine
 * Schreib-API.
 */
import type { ProjectionPresentation } from './presentation'
import type { ProjectionAntrag } from './antrag'
import type { ProjectionUntertitel } from './untertitel'
import type { ProjectionCamera } from './kamera'
import type { ProjectionVideo } from './video'
import type { ElectionProcedure, IsoDate, IsoDateTime, UUID } from './types'

export const PROJECTION_MODES = [
  'welcome',
  'agenda',
  'upcoming_round',
  'candidate_presentation',
  'speaker',
  'round_ready',
  'round_open',
  'round_closed',
  'counting',
  'result',
  'runoff_announced',
  'break',
  'custom_message',
  'presentation',
  'video',
  'kamera',
  'antrag',
  'session_finished'
] as const
export type ProjectionMode = (typeof PROJECTION_MODES)[number]

export const PROJECTION_MODE_LABELS: Record<ProjectionMode, string> = {
  welcome: 'Willkommen',
  agenda: 'Tagesordnung',
  upcoming_round: 'Nächster Wahlgang',
  candidate_presentation: 'Kandidaten',
  speaker: 'Vorstellung',
  round_ready: 'Wahlgang bereit',
  round_open: 'Wahl läuft',
  round_closed: 'Stimmabgabe beendet',
  counting: 'Auszählung läuft',
  result: 'Ergebnis',
  runoff_announced: 'Stichwahl angekündigt',
  break: 'Pause',
  custom_message: 'Freie Mitteilung',
  presentation: 'Präsentation',
  video: 'Video',
  kamera: 'Kamera',
  antrag: 'Antrag',
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

export type FinalDecision = 'elected' | 'not_elected' | 'runoff' | 'accepted' | 'rejected' | 'tie' | 'manual'

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

export type { ProjectionUntertitel } from './untertitel'
export type { ProjectionAntrag } from './antrag'

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
  /**
   * Die laufende Präsentation — nur Kennung, Titel und Folienstand.
   *
   * Das Dokument selbst steht **nicht** hier: Der Zustand geht mehrmals je
   * Sekunde durch die SSE-Leitungen, eine eingebettete HTML-Datei von zwei
   * Megabyte täte das nicht. Die Ansicht holt sie als eigene Ressource.
   */
  presentation?: ProjectionPresentation
  /**
   * Das laufende Video — Kennung, Titel und eine Uhr.
   *
   * Auch hier steht die Datei **nicht** im Zustand. Statt eines Befehls
   * („jetzt abspielen") trägt er die Position zu einem genannten Zeitpunkt:
   * Jedes Gerät rechnet sich daraus seinen Sollstand aus, Nachzügler
   * eingeschlossen. Ein Befehl hätte die, die ihn verpasst haben, nie
   * erreicht.
   */
  video?: ProjectionVideo
  /**
   * Das laufende Kamerabild — nur der Name der NDI-Quelle.
   *
   * Auch hier keine Bilder im Zustand: Jeder Bildschirm baut seine eigene
   * Verbindung zur Kamera auf. Der Hauptrechner sähe sonst dreimal dasselbe
   * Bild durch sich hindurchlaufen, während er die Wahl führt.
   */
  camera?: ProjectionCamera
  /**
   * Wer gerade spricht und wie lange noch.
   *
   * Wie bei der Pause steht hier ein **Zeitpunkt**, keine Restdauer: Jedes
   * Gerät rechnet sich den Rest selbst aus, und ein Bildschirm, der später
   * dazukommt, zeigt sofort die richtige Zahl. Eine heruntergezählte Restzeit
   * im Zustand müsste dagegen mehrmals je Sekunde durch alle Leitungen.
   */
  speaker?: ProjectionSpeaker
  /**
   * Untertitel — was gesprochen wird, mitlesbar.
   *
   * Steht das Feld hier, sind sie eingeschaltet; eine leere Zeilenliste heißt
   * dann „eingeschaltet, aber gerade still". Beides zu unterscheiden ist
   * nötig, weil nur das Erste eine Entscheidung der Bedienung ist: Bei Stille
   * verschwindet das Band, eingeschaltet bleibt es trotzdem.
   *
   * Der Text selbst steht hier, anders als Bild und Video — er ist ein paar
   * Dutzend Zeichen lang und damit das Einzige an dieser Stelle, das klein
   * genug ist, um mitzureisen.
   */
  untertitel?: ProjectionUntertitel
  /**
   * Der Antrag, über den gerade gesprochen oder abgestimmt wird.
   *
   * Der Text steht hier — anders als bei Bild, Film und Foliensatz. Er ist
   * ein paar hundert Zeichen lang, schon in Seiten umbrochen, und es gibt
   * nichts, was die Ansicht nachschlagen könnte: Der Beamer kennt das
   * Antragsbuch nicht und soll es nicht kennen.
   */
  antrag?: ProjectionAntrag
  updatedAt: IsoDateTime
}

/** Wer sich gerade vorstellt — und wie lange die Redezeit noch läuft. */
export interface ProjectionSpeaker {
  name: string
  /** Zusatz unter dem Namen, etwa „Bewerbung um den Vorsitz". */
  note?: string
  /**
   * Ende der Redezeit. Fehlt es, wird nur der Name gezeigt — nicht jede
   * Vorstellung ist begrenzt.
   */
  until?: IsoDateTime
  /** Zugestandene Redezeit in Sekunden, für den Fortschrittsbalken. */
  totalSeconds?: number
  /**
   * Angehalten bei dieser Restzeit in Sekunden.
   *
   * Eine Zwischenfrage hält die Uhr an, ohne die Vorstellung zu beenden.
   * Steht hier ein Wert, ruht der Countdown.
   */
  pausedSecondsLeft?: number
  /**
   * Die Uhr steht noch am Anfang — sie wurde nie gestartet.
   *
   * Technisch dasselbe wie angehalten, und doch etwas anderes: Ein Aufruf ist
   * keine Ansage, dass jetzt gesprochen wird. Wer aufgerufen wird, steht auf
   * und geht nach vorn; die Zeit dafür gehört ihm nicht abgezogen. Der Saal
   * sieht Name und Redezeit, und **auf Klick** geht es los.
   *
   * Unterschieden wird beides für die Bedienung — „Starten" ist etwas anderes
   * als „Weiter" — und für die Ansicht: Eine ruhende Uhr wird gedimmt, weil
   * das Anhalten sichtbar sein muss; eine, die noch nie lief, nicht.
   */
  ungestartet?: boolean
  /**
   * Wer danach an der Reihe ist, in Reihenfolge.
   *
   * Die Liste ist der ganze Vorrat, aus dem „Nächster" schöpft — angezeigt
   * wird davon nur der vordere Teil (`upcomingShown`).
   */
  upcoming?: string[]
  /**
   * Wie viele der nächsten Namen der Beamer zeigt.
   *
   * Einstellbar, weil es von der Versammlung abhängt: Bei kurzen
   * Vorstellungen mögen zwei genügen, bei langen Wegen zum Pult helfen sechs.
   * 0 blendet die Vorschau aus.
   */
  upcomingShown?: number
}

/** Vorgabe, wenn nichts eingestellt ist. */
export const REDNER_VORSCHAU = 4
/** Mehr als das liest im Saal niemand mehr. */
export const REDNER_VORSCHAU_MAX = 8

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
  /** Welche Bühne dieses Fenster zeigt. */
  buehne: number
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

/**
 * Rechnet eine Uhrzeit "HH:MM" in den Zeitpunkt um, zu dem die Pause endet.
 *
 * Warum überhaupt eine Uhrzeit und nicht nur eine Dauer: „Weiter um 12:30"
 * bleibt richtig, auch wenn zwischen Ansage und Anzeigen noch fünf Minuten
 * vergehen — eine Dauer verschiebt sich dann mit.
 *
 * Liegt die Uhrzeit heute schon hinter uns, ist der nächste Tag gemeint: Eine
 * Versammlung kann über Mitternacht gehen, und eine Pause, die im selben
 * Augenblick abgelaufen ist, wäre keine.
 *
 * Gibt `undefined` bei unsinnigen Angaben zurück — dann läuft die Pause ohne
 * Countdown, statt mit einer geratenen Zeit.
 */
export function pausenende(uhrzeit: string, jetzt = new Date()): IsoDateTime | undefined {
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(uhrzeit.trim())
  if (!treffer) return undefined
  const stunde = Number(treffer[1])
  const minute = Number(treffer[2])
  if (stunde > 23 || minute > 59) return undefined
  const ziel = new Date(jetzt)
  ziel.setHours(stunde, minute, 0, 0)
  if (ziel.getTime() <= jetzt.getTime()) ziel.setDate(ziel.getDate() + 1)
  return ziel.toISOString()
}

/**
 * Verbleibende Redezeit in Sekunden.
 *
 * Angehalten heißt: Der gemerkte Rest gilt unverändert. Läuft die Uhr, ergibt
 * sich der Rest aus dem Endzeitpunkt. Negative Werte werden **nicht**
 * abgeschnitten — eine überzogene Redezeit soll sichtbar sein, nicht bei null
 * stehen bleiben.
 */
export function redezeitRest(speaker: ProjectionSpeaker, jetzt = Date.now()): number | undefined {
  if (speaker.pausedSecondsLeft !== undefined) return speaker.pausedSecondsLeft
  if (!speaker.until) return undefined
  return Math.round((new Date(speaker.until).getTime() - jetzt) / 1000)
}

/** Mundgerechte Anzeige: "4:03", bei Überziehung "-0:12". */
export function redezeitText(sekunden: number): string {
  const negativ = sekunden < 0
  const gesamt = Math.abs(sekunden)
  const minuten = Math.floor(gesamt / 60)
  const rest = gesamt % 60
  return `${negativ ? '-' : ''}${minuten}:${String(rest).padStart(2, '0')}`
}

/* ------------------------------------------------------------- Bühnen */

/**
 * Eine Bühne ist eine eigenständige Anzeigefläche mit eigenem Zustand.
 *
 * Bis 0.13 gab es genau eine: ein Beamerfenster, eine Netzansicht, ein
 * Zustand. Auf einer Versammlung reicht das oft nicht — vorne die
 * Rednerliste, seitlich wer gerade spricht; oder Begrüßung auf dem einen
 * Schirm und ein Film auf dem anderen.
 *
 * Die **Form** des Zustands ändert sich dadurch nicht: Jede Bühne trägt
 * denselben `ProjectionState` wie zuvor. Es sind nur mehrere davon.
 */
export interface Buehne {
  id: number
  /** Anzeigename in der Bedienung, z. B. „Hauptbeamer" oder „Seitenschirm". */
  name: string
  /**
   * Folgt dem Wahlgang automatisch.
   *
   * Kandidatenerfassung, Freigabe, Eröffnung, Auszählung, Ergebnis — diese
   * Wechsel stößt der Wahlgang selbst an. Sie dürfen **nicht** auf allen
   * Bühnen landen: Sonst zeigten alle dasselbe, und der Zweck mehrerer
   * Flächen wäre dahin. Ab Werk folgt nur die Hauptbühne.
   */
  followsRound: boolean
}

/** Die Bühne, die es immer gibt — die bisherige Beameransicht. */
export const HAUPTBUEHNE = 1
/**
 * Der Master: alle Bühnen zugleich.
 *
 * Mehrere Flächen sind der Normalfall, das gemeinsame Schalten aber auch —
 * „Pause" oder „Versammlung beendet" gehören auf jede Wand. Statt jede Bühne
 * einzeln anzufassen, nimmt jede Bühnenfunktion diese Null entgegen und tut
 * dasselbe überall. Sie ist bewusst keine Bühne: Sie hat keinen Zustand, kein
 * Fenster und keine Adresse.
 */
export const ALLE_BUEHNEN = 0

/**
 * Auf welche Bühnen sich eine Schaltung bezieht.
 *
 * Eine Zahl ist eine Bühne, `ALLE_BUEHNEN` sind alle, eine Liste sind genau
 * diese. Die Liste gibt es, weil „alle" im Saal selten stimmt: Pause auf die
 * beiden Wände im Saal, im Foyer läuft der Film weiter. Ausgewertet wird sie
 * an genau einer Stelle im Hauptprozess.
 */
export type Buehnenwahl = number | number[]

/**
 * Mehr als das wird unübersichtlich, und jede Bühne kostet ein Fenster oder
 * eine Netzverbindung. Wer mehr braucht, hat ein anderes Problem.
 */
export const BUEHNEN_MAX = 4

export const BUEHNE_VORGABE: Buehne = {
  id: HAUPTBUEHNE,
  name: 'Beamer',
  followsRound: true
}

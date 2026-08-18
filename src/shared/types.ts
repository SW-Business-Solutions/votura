/**
 * Fachliche Typen des Wahlgang- und Stimmzettelsystems.
 *
 * Grundsatz (Spezifikation §88): Das System kennt Wahlgang, Kandidaten, Stückzahlen
 * und Ergebnis — es kennt NIEMALS die Zuordnung Wähler -> Stimmzettel. Es darf daher
 * keinen Typ geben, der eine Person mit einem einzelnen Stimmzettel verknuepft.
 *
 * Grundsatz (Wahlformen §43/§52): Wahlzweck (purpose) und Wahlverfahren (procedure)
 * sind strikt getrennt. Aus "Delegiertenwahl" folgt KEIN Verfahren — das Verfahren
 * beschliesst die Versammlung.
 */

export type UUID = string
export type IsoDateTime = string // ISO 8601, immer UTC (z. B. 2026-09-12T16:41:00.000Z)
export type IsoDate = string // ISO 8601 Datum (z. B. 2026-09-12)

/* ------------------------------------------------------------------ Rollen */

export const ROLES = ['ADMIN', 'WAHLLEITUNG', 'WAHLKOMMISSION', 'PROTOKOLL', 'READ_ONLY'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administration',
  WAHLLEITUNG: 'Wahlleitung',
  WAHLKOMMISSION: 'Wahlkommission',
  PROTOKOLL: 'Protokoll',
  READ_ONLY: 'Nur Lesen'
}

/** Feingranulare Berechtigungen; Rollen sind Bündel daraus. */
export const PERMISSIONS = [
  'event.manage',
  'user.manage',
  'system.manage',
  'backup.create',
  'round.manage',
  'round.unlock',
  'candidate.manage',
  'ballot.approve',
  'print.execute',
  'print.reprint',
  'accounting.edit',
  'result.enter',
  'result.confirm',
  'export.read',
  'audit.read'
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  WAHLLEITUNG: [
    'event.manage',
    'round.manage',
    'round.unlock',
    'candidate.manage',
    'ballot.approve',
    'print.execute',
    'print.reprint',
    'accounting.edit',
    'result.enter',
    'result.confirm',
    'export.read',
    'audit.read',
    'backup.create'
  ],
  WAHLKOMMISSION: [
    'candidate.manage',
    'print.execute',
    'print.reprint',
    'accounting.edit',
    'result.enter',
    'export.read',
    'audit.read'
  ],
  PROTOKOLL: ['export.read', 'audit.read'],
  READ_ONLY: []
}

export interface User {
  id: UUID
  username: string
  displayName: string
  role: Role
  active: boolean
  hasPrintPin: boolean
  createdAt: IsoDateTime
  lastLoginAt?: IsoDateTime
}

export interface Session {
  user: User
  permissions: Permission[]
  expiresAt: IsoDateTime
}

/* ---------------------------------------------------------- Veranstaltung */

export const EVENT_STATUS = ['draft', 'active', 'closed', 'archived'] as const
export type EventStatus = (typeof EVENT_STATUS)[number]

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Entwurf',
  active: 'aktiv',
  closed: 'abgeschlossen',
  archived: 'archiviert'
}

/** Dokumentiert, auf welcher Regelbasis die Konfiguration beruhte (Wahlformen §48). */
export interface ElectionRuleSet {
  name: string
  version: string
  source?: string
  snapshotDate: IsoDate
}

export interface ElectionEvent {
  id: UUID
  title: string
  organization: string
  /** Kurzcode für die Wahlgangkennung, z. B. MV26 oder KV-NORD. */
  orgCode: string
  date: IsoDate
  location: string
  status: EventStatus
  eligibleVoterCount?: number
  ruleSet: ElectionRuleSet
  rowVersion: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  closedAt?: IsoDateTime
  archivedAt?: IsoDateTime
}

/* ------------------------------------------------------- Tagesordnung */

/**
 * Ein Punkt der Tagesordnung. Kann vorab gepflegt und während der Versammlung
 * jederzeit umsortiert, ergänzt oder korrigiert werden.
 */
export interface AgendaItem {
  id: UUID
  eventId: UUID
  position: number
  /** Freie Nummerierung, z. B. "TOP 7" oder "A-17". */
  label?: string
  title: string
  note?: string
  kind: 'topic' | 'round'
  roundId?: UUID
  done: boolean
  createdAt: IsoDateTime
}

export interface AgendaItemInput {
  eventId: UUID
  title: string
  label?: string
  note?: string
  roundId?: UUID
  /** Einfügeposition; ohne Angabe wird angehängt. */
  position?: number
}

/* ------------------------------------------------- Wahlzweck (fachlich) */

export const PURPOSES = [
  'chairperson',
  'deputy_chairperson',
  'treasurer',
  'secretary',
  'board_member',
  'auditor',
  'delegate',
  'substitute_delegate',
  'direct_candidate',
  'list_candidate',
  'motion',
  'custom'
] as const
export type ElectionPurpose = (typeof PURPOSES)[number]

export const PURPOSE_LABELS: Record<ElectionPurpose, string> = {
  chairperson: 'Vorsitz',
  deputy_chairperson: 'Stellvertretender Vorsitz',
  treasurer: 'Schatzmeister',
  secretary: 'Schriftführer',
  board_member: 'Beisitzer / Vorstandsmitglied',
  auditor: 'Rechnungsprüfer',
  delegate: 'Delegierte',
  substitute_delegate: 'Ersatzdelegierte',
  direct_candidate: 'Direktkandidat',
  list_candidate: 'Listenkandidat',
  motion: 'Sachabstimmung / Antrag',
  custom: 'Sonstiges'
}

/* --------------------------------------------- Wahlverfahren (technisch) */

export const PROCEDURES = [
  'single_candidate',
  'single_multiple_candidates',
  'runoff',
  'connected_single_election',
  'group_preprinted',
  'group_blank',
  'acceptance_single',
  'acceptance_group',
  'two_stage_stage_1',
  'two_stage_stage_2_single',
  'two_stage_stage_2_block',
  'yes_no_abstain',
  'single_choice_motion',
  'multiple_choice_motion',
  'alternative_choice',
  'open_vote'
] as const
export type ElectionProcedure = (typeof PROCEDURES)[number]

export const PROCEDURE_LABELS: Record<ElectionProcedure, string> = {
  single_candidate: 'Einzelwahl – ein Kandidat',
  single_multiple_candidates: 'Einzelwahl – mehrere Kandidaten',
  runoff: 'Stichwahl',
  connected_single_election: 'Verbundene Einzelwahl',
  group_preprinted: 'Gruppenwahl – Kandidaten vorgedruckt',
  group_blank: 'Gruppenwahl – Blanko-Namensfelder',
  acceptance_single: 'Akzeptanzwahl – Einzelposition',
  acceptance_group: 'Akzeptanzwahl – mehrere Positionen',
  two_stage_stage_1: 'Zwei-Stufen-Wahl – Stufe 1',
  two_stage_stage_2_single: 'Zwei-Stufen-Wahl – Stufe 2, Einzelplatz',
  two_stage_stage_2_block: 'Zwei-Stufen-Wahl – Stufe 2, Wahlblock',
  yes_no_abstain: 'Sachabstimmung – Ja / Nein / Enthaltung',
  single_choice_motion: 'Sachabstimmung – eine von mehreren Optionen',
  multiple_choice_motion: 'Sachabstimmung – mehrere Optionen',
  alternative_choice: 'Variantenwahl / Alternativanträge',
  open_vote: 'Offene Abstimmung (ohne Stimmzettel)'
}

export const ROUND_STATUS = [
  'draft',
  'candidate_collection',
  'ready',
  'printing',
  'open',
  'counting',
  'completed',
  'cancelled'
] as const
export type RoundStatus = (typeof ROUND_STATUS)[number]

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  draft: 'Entwurf',
  candidate_collection: 'Kandidatenerfassung',
  ready: 'Freigegeben – bereit zum Druck',
  printing: 'Druck läuft',
  open: 'Wahlgang eröffnet',
  counting: 'Auszählung',
  completed: 'Abgeschlossen',
  cancelled: 'Abgebrochen'
}

export const CANDIDATE_ORDER_MODES = ['manual', 'alphabetical', 'assembly_decision', 'random'] as const
export type CandidateOrderMode = (typeof CANDIDATE_ORDER_MODES)[number]

export const CANDIDATE_ORDER_LABELS: Record<CandidateOrderMode, string> = {
  manual: 'Manuell festgelegt',
  alphabetical: 'Alphabetisch',
  assembly_decision: 'Per Versammlungsbeschluss',
  random: 'Zufaellig (nur auf ausdrückliche Anordnung)'
}

/**
 * Layout- und Inhaltskonfiguration des Stimmzettels (Wahlformen §44).
 * Alles, was auf dem Bon erscheint, ist hierueber steuerbar — nichts ist
 * fest im Generator verdrahtet.
 */
export interface BallotTemplateConfig {
  showOrganization: boolean
  showEventTitle: boolean
  showDate: boolean
  showLocation: boolean
  showRoundNumber: boolean
  showRoundCode: boolean
  showCandidateNumbers: boolean
  /** Kompakte Darstellung (z. B. "JA [ ] NEIN [ ] ENTH [ ]" in einer Zeile). */
  compactMode: boolean
  /** Kandidatenzeilen in doppelter Höhe drucken – größere Namen und Ankreuzfelder. */
  largeCandidates: boolean
  /**
   * Stimmen, die ein Wähler einem einzelnen Bewerber geben darf (Kumulieren).
   * 1 = eine Stimme je Bewerber (Regelfall). Höhere Werte drucken entsprechend
   * viele Ankreuzfelder je Zeile. Ob Kumulieren zulässig ist, bestimmt die
   * jeweilige Wahlordnung – die Anwendung gibt nichts vor.
   */
  votesPerCandidate: number
  /** Leerzeilen zwischen zwei Kandidaten (Abstand auf dem Papier). */
  candidateSpacingLines: number
  allowYes: boolean
  allowNo: boolean
  allowAbstention: boolean
  /** Anzahl handschriftlicher Namenszeilen (group_blank / Freitext). */
  blankLines: number
  /** Überschrift oberhalb des Wahlgangtitels, z. B. "STICHWAHL". */
  banner?: string
  /** Wahlanweisung; wird beim Anlegen automatisch erzeugt, bleibt editierbar. */
  instructionText: string
  /** Zusaetzlicher Hinweis unterhalb der Optionen. */
  notice?: string
  /** Antrags-/Beschlusstext bei Sachabstimmungen. */
  motionText?: string
}

/** Eine Position innerhalb einer verbundenen Einzelwahl (Wahlformen §7). */
export interface BallotPosition {
  id: UUID
  title: string
  /** Kandidaten dieser Position (bei verbundener Einzelwahl i. d. R. genau einer). */
  candidateIds: UUID[]
}

export interface ElectionRound {
  id: UUID
  eventId: UUID
  /**
   * Laufende Nummer des Wahlgangs. 0 bedeutet: noch in Vorbereitung — die
   * Nummer und damit die Kennung wird erst beim Start des Wahlgangs vergeben,
   * damit vorbereitete Punkte frei umsortiert werden können.
   */
  sequentialNumber: number
  /** Position in der Tagesordnung (frei umsortierbar). */
  agendaOrder: number
  /** Wahlgangkennung, identisch auf allen Stimmzetteln dieses Wahlgangs. */
  roundCode: string
  /** Anzeigekennzeichen des Wahlgangs, z. B. "07" oder "07-S1". */
  roundLabel: string
  title: string
  purpose: ElectionPurpose
  procedure: ElectionProcedure
  seats: number
  /** null = keine feste Höchstzahl (z. B. Zwei-Stufen-Wahl Stufe 1). */
  maxVotes: number | null
  /** Listenplatzbereich bei Wahlbloecken (Wahlformen §17). */
  seatStart?: number
  seatEnd?: number
  status: RoundStatus
  parentRoundId?: UUID
  /** Art der Ableitung aus dem Ursprungswahlgang. */
  derivedAs?: 'runoff' | 'repeat' | 'byelection' | 'second_round' | 'stage_2'
  ballotVersion: number
  template: BallotTemplateConfig
  orderMode: CandidateOrderMode
  orderSeed?: number
  positions: BallotPosition[]
  candidatesLockedAt?: IsoDateTime
  approvedVersion?: number
  rowVersion: number
  createdAt: IsoDateTime
  lockedAt?: IsoDateTime
  completedAt?: IsoDateTime
  cancelledAt?: IsoDateTime
  cancelReason?: string
}

/**
 * Ein Eintrag auf dem Stimmzettel: Kandidat, Sachoption oder Antragsvariante.
 * Bewusst ein Typ, weil das Druck- und Ergebnisverhalten identisch ist.
 */
export interface Candidate {
  id: UUID
  electionRoundId: UUID
  firstName: string
  lastName: string
  displayName: string
  /** Optionale Kandidatennummer auf dem Bon (Wahlformen §36), eindeutig je Wahlgang. */
  ballotNumber?: number
  sortOrder: number
  withdrawn: boolean
  /** Zuordnung zu einer Position bei verbundener Einzelwahl. */
  positionId?: UUID
  /** Interne Notiz – erscheint niemals auf dem Stimmzettel. */
  note?: string
  createdAt: IsoDateTime
}

/* ------------------------------------------------------------- Stimmzettel */

export interface BallotCandidateLine {
  /** Nur zur internen Zuordnung des Ergebnisses – nicht Bestandteil des Drucks. */
  candidateId: UUID
  name: string
  number?: number
}

export interface BallotSection {
  /** Überschrift der Sektion (z. B. Positionstitel bei verbundener Einzelwahl). */
  title?: string
  kind: 'choice_list' | 'per_candidate_choice' | 'blank_lines' | 'global_options'
  candidates: BallotCandidateLine[]
  /** Optionen, die pro Kandidat bzw. global angeboten werden. */
  options: string[]
  blankLines?: number
}

/** Kanonische Druckvorlage. Grundlage für Layout, Hash und Archiv. */
export interface BallotDocument {
  event: {
    title: string
    organization: string
    date: IsoDate
    location: string
  }
  round: {
    number: number
    label: string
    code: string
    title: string
    purpose: ElectionPurpose
    procedure: ElectionProcedure
    seats: number
    maxVotes: number | null
    seatStart?: number
    seatEnd?: number
    banner?: string
    instructions: string
    motionText?: string
    notice?: string
  }
  sections: BallotSection[]
  template: BallotTemplateConfig
  version: number
}

/**
 * Eine Zeile der Druckvorschau samt Auszeichnung. Damit zeigt die
 * Bildschirmvorschau dieselben Größenverhältnisse wie der Ausdruck.
 */
export interface BallotPreviewRow {
  text: string
  /**
   * Ausrichtung wie auf dem Drucker. Die Vorschau richtet über CSS aus statt
   * über Leerzeichen — sonst verschöben sich Zeilen mit größerer Schrift.
   */
  align?: 'left' | 'center' | 'right'
  bold?: boolean
  large?: boolean
  invert?: boolean
  /** Markierung der Schnittstelle – wird nicht gedruckt. */
  cut?: boolean
}

export interface BallotVersionRecord {
  id: UUID
  electionRoundId: UUID
  version: number
  ballotHash: string
  document: BallotDocument
  approvedBy?: UUID
  approvedByName?: string
  approvedAt?: IsoDateTime
  supersededAt?: IsoDateTime
  createdAt: IsoDateTime
}

/* ------------------------------------------------------------------ Druck */

export const PRINTER_KINDS = ['epson_epos', 'escpos_network', 'escpos_windows', 'pdf_file'] as const
export type PrinterKind = (typeof PRINTER_KINDS)[number]

export const PRINTER_KIND_LABELS: Record<PrinterKind, string> = {
  epson_epos: 'Epson ePOS-Print (LAN, Epson-XML-Schnittstelle)',
  escpos_network: 'ESC/POS Netzwerk (RAW, Port 9100)',
  escpos_windows: 'ESC/POS über Windows-Druckertreiber (USB)',
  pdf_file: 'Datei-Ausgabe (Vorschau / kein Drucker)'
}

export interface PrinterConfig {
  id: string
  name: string
  kind: PrinterKind
  host?: string
  port?: number
  /** Gerätename bei ePOS (Standard: local_printer). */
  deviceId?: string
  /** Windows-Druckername (exakt wie in den Windows-Einstellungen). */
  windowsPrinterName?: string
  paperWidthMm: 58 | 80 | 112
  /** Zeichen pro Zeile in Font A. */
  charsPerLine: number
  /** Punkte pro Zeile (Grafikbreite), z. B. 576 für 80 mm @ 203 dpi. */
  dotsPerLine: number
  cutEveryBallot: boolean
  feedLinesBeforeCut: number
  codepage: 'CP858' | 'CP437' | 'CP1252'
  enabled: boolean
}

export const PRINT_BATCH_KINDS = ['initial', 'reprint', 'test', 'protocol'] as const
export type PrintBatchKind = (typeof PRINT_BATCH_KINDS)[number]

export const PRINT_BATCH_KIND_LABELS: Record<PrintBatchKind, string> = {
  initial: 'Erstdruck',
  reprint: 'Nachdruck',
  test: 'Testdruck (ungültig)',
  protocol: 'Protokollbeleg (kein Stimmzettel)'
}

export const PRINT_BATCH_STATUS = ['running', 'completed', 'aborted', 'failed', 'unknown'] as const
export type PrintBatchStatus = (typeof PRINT_BATCH_STATUS)[number]

export const PRINT_BATCH_STATUS_LABELS: Record<PrintBatchStatus, string> = {
  running: 'läuft',
  completed: 'abgeschlossen',
  aborted: 'abgebrochen',
  failed: 'fehlgeschlagen',
  unknown: 'unklar – bitte physisch prüfen'
}

export interface PrintBatch {
  id: UUID
  electionRoundId: UUID
  ballotVersion: number
  kind: PrintBatchKind
  printerId: string
  printerName: string
  requestedCopies: number
  /** An den Druckertreiber uebermittelte Exemplare (NICHT: physisch ausgegeben). */
  submittedCopies: number
  failedCopies: number
  /** Vom Bediener nach physischer Prüfung bestätigte Exemplare. */
  confirmedCopies?: number
  status: PrintBatchStatus
  reason?: string
  idempotencyKey: string
  operatorId: UUID
  operatorName: string
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  errorMessage?: string
}

export interface PrintProgress {
  batchId: UUID
  electionRoundId: UUID
  requestedCopies: number
  submittedCopies: number
  failedCopies: number
  status: PrintBatchStatus
  errorMessage?: string
}

export interface PrinterTestResult {
  ok: boolean
  message: string
  details?: Record<string, string | number | boolean>
}

/* ------------------------------------------------------- Stimmzettelbilanz */

export interface BallotAccounting {
  electionRoundId: UUID
  /** Aus PrintBatches abgeleitet. */
  printed: number
  printFailures: number
  testPrints: number
  /** Manuell dokumentierte Mengen. */
  issued: number
  replacementsIssued: number
  returnedSpoiled: number
  unused: number
  ballotsInBox?: number
  updatedAt?: IsoDateTime
}

export interface AccountingCheck {
  level: 'ok' | 'notice' | 'warning'
  message: string
}

/* ---------------------------------------------------------------- Ergebnis */

export interface CandidateResult {
  candidateId: UUID
  name: string
  /** Stimmen bei Ankreuzverfahren. */
  votes?: number
  /** Akzeptanzverfahren / verbundene Einzelwahl. */
  yes?: number
  no?: number
  abstain?: number
  /** Nur bei Akzeptanzverfahren: nur dieses Votum war ungültig. */
  invalidVotes?: number
}

export interface PositionResult {
  positionId: UUID
  title: string
  candidates: CandidateResult[]
}

export interface ResultData {
  candidates: CandidateResult[]
  positions?: PositionResult[]
  /** Globale Optionen (beziehen sich auf alle Bewerber, Wahlformen §8). */
  yes?: number
  no?: number
  abstentions?: number
  freeTextEntries?: { text: string; votes: number }[]
}

/**
 * Wie wurde das Ergebnis ermittelt?
 * - `counted`: ausgezählt, mit Zahlen je Bewerber bzw. Option.
 * - `declared`: bei offener Abstimmung ohne Auszählung festgestellt
 *   (z. B. „einstimmig", „deutliche Mehrheit"). Für das Protokoll ist dieser
 *   Unterschied wesentlich und wird deshalb ausdrücklich dokumentiert.
 */
export type CountingMode = 'counted' | 'declared'

export const DECLARATION_SUGGESTIONS = [
  'Einstimmig angenommen',
  'Einstimmig abgelehnt',
  'Mit großer Mehrheit angenommen',
  'Mit großer Mehrheit abgelehnt',
  'Mehrheitlich angenommen',
  'Mehrheitlich abgelehnt',
  'Angenommen bei Gegenstimmen und Enthaltungen',
  'Abgelehnt bei Gegenstimmen und Enthaltungen'
] as const

export interface ElectionResult {
  id: UUID
  electionRoundId: UUID
  /** Ausgezählt oder ohne Auszählung festgestellt. */
  countingMode: CountingMode
  /** Wortlaut der Feststellung, wenn nicht ausgezählt wurde. */
  declaration?: string
  eligibleVoters?: number
  ballotsCast: number
  validBallots: number
  invalidBallots: number
  abstentions?: number
  resultData: ResultData
  enteredBy: UUID
  enteredByName: string
  verifiedBy?: UUID
  verifiedByName?: string
  note?: string
  /** Feststellung der Wahlleitung (Freitext, keine automatische Rechtsfolge). */
  determination?: string
  /**
   * Öffentlich angezeigte Feststellung (Beamer §74). Stammt IMMER aus der
   * Entscheidung der Wahlleitung, nie aus einer automatischen Berechnung.
   */
  finalDecision?:
    | 'elected'
    | 'not_elected'
    | 'runoff'
    | 'accepted'
    | 'rejected'
    | 'tie'
    | 'manual'
  /** IDs der als gewählt festgestellten Kandidaten. */
  electedCandidateIds?: UUID[]
  /** Dokumentierter Losentscheid (Wahlformen §32). */
  lotDecision?: string
  createdAt: IsoDateTime
  confirmedAt?: IsoDateTime
}

/* ------------------------------------------------------------ Audit-Trail */

export interface AuditEntry {
  id: UUID
  seq: number
  timestamp: IsoDateTime
  userId?: UUID
  userName?: string
  eventId?: UUID
  electionRoundId?: UUID
  action: string
  previousValue?: unknown
  newValue?: unknown
  reason?: string
  entryHash: string
  previousHash?: string
}

export interface AuditChainCheck {
  ok: boolean
  entries: number
  brokenAtSeq?: number
  message: string
}

/* ----------------------------------------------------------- Konfiguration */

export interface AppConfig {
  organization: { name: string; code: string }
  timezone: string
  printing: {
    defaultPrinterId: string
    reserveCopies: number
    /** Verzoegerung zwischen Exemplaren in ms (Druckerpuffer schonen). */
    copyDelayMs: number
  }
  ballots: {
    printRoundCode: boolean
    printBallotVersion: boolean
    /** Texte der Stimmzettel – konfigurierbar, weil wahlordnungsabhaengig. */
    labels: {
      yes: string
      no: string
      abstention: string
      abstentionShort: string
      alternative: string
      testPrintMarker: string
      endMarker: string
      cutMarker: string
    }
  }
  security: {
    sessionTimeoutMinutes: number
    requirePinForMassPrint: boolean
    requireFourEyesForResult: boolean
  }
  backup: {
    directory: string
    secondaryDirectory?: string
  }
  /**
   * Hinweis auf neue Fassungen. Standardmäßig abgeschaltet: die Anwendung
   * arbeitet offline, und ein Abruf verrät dem Anbieter die Adresse des
   * Rechners. Sie lädt und installiert nichts von selbst — sie nennt nur die
   * verfügbare Fassung (§2.2).
   */
  updates: {
    /** Beim Start nachsehen, sofern eine Verbindung besteht. */
    checkOnStart: boolean
    /** Öffentliches Projekt, dessen Veröffentlichungen abgefragt werden. */
    repository: string
  }
}

export interface UpdateInstallCheck {
  possible: boolean
  /** Klartext, warum ein Wechsel gerade nicht vertretbar ist. */
  reasons: string[]
}

export interface UpdateProgress {
  phase: 'start' | 'download' | 'verify' | 'ready' | 'error'
  receivedBytes?: number
  totalBytes?: number
  message?: string
}

export interface UpdateInstallResult {
  file: string
  version: string
  /** true, wenn die Datei gegen eine veröffentlichte Prüfsumme geprüft wurde. */
  verified: boolean
  /**
   * 'installer' — die Installation startet und die Anwendung beendet sich.
   * 'portable' — die neue Programmdatei liegt bereit; der Wechsel erfolgt von Hand.
   */
  mode: 'installer' | 'portable'
}

export interface UpdateCheckResult {
  /** Zeitpunkt der Abfrage. */
  checkedAt: IsoDateTime
  installedVersion: string
  /** Fehlt, wenn die Abfrage nicht möglich war. */
  latestVersion?: string
  updateAvailable: boolean
  releaseUrl?: string
  publishedAt?: IsoDateTime
  notes?: string
  /** Klartext, wenn die Abfrage scheiterte – etwa ohne Internetverbindung. */
  error?: string
}

/* --------------------------------------------------------------- Preflight */

export interface PreflightItem {
  key: string
  label: string
  status: 'ok' | 'warn' | 'fail' | 'unknown'
  detail: string
}

/* ------------------------------------------------------------ Uebersichten */

export interface RoundSummary extends ElectionRound {
  candidateCount: number
  accounting: BallotAccounting
  hasResult: boolean
  resultConfirmed: boolean
  approvedHash?: string
}

export interface RecoveryState {
  hasOpenEvent: boolean
  event?: ElectionEvent
  lastRound?: ElectionRound
  unclearBatches: PrintBatch[]
}

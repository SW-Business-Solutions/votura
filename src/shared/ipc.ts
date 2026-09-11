/**
 * Vertrag zwischen Renderer und Main.
 *
 * Der Operator-Renderer erreicht das Main ausschließlich über diese Methoden.
 * Der Audience-Renderer bekommt eine eigene, rein lesende Brücke (§31).
 */
import type { NetworkProjectionConfig, SystemSettings } from './config'
import type {
  AudienceWindowState,
  DisplayInfo,
  ProjectionHistoryEntry,
  ProjectionMode,
  ProjectionState,
  ProjectionTheme
} from './projection'
import type { PresentationInfo, PrompterWindowState } from './presentation'
import type { VideoInfo } from './video'
import type {
  AgendaItem,
  AgendaItemInput,
  AppConfig,
  AuditChainCheck,
  AuditEntry,
  BallotAccounting,
  BallotDocument,
  BallotPreviewRow,
  BallotTemplateConfig,
  BallotVersionRecord,
  Candidate,
  CandidateOrderMode,
  CountingMode,
  ElectionEvent,
  ElectionProcedure,
  ElectionPurpose,
  ElectionResult,
  ElectionRound,
  ElectionRuleSet,
  IsoDate,
  PreflightItem,
  PrintBatch,
  PrinterConfig,
  PrinterTestResult,
  PrintProgress,
  RecoveryState,
  ResultData,
  Role,
  RoundSummary,
  Session,
  UpdateCheckResult,
  UpdateInstallCheck,
  UpdateInstallResult,
  UpdateProgress,
  User,
  UUID
} from './types'

export const IPC = {
  api: 'wz:api',
  printProgress: 'wz:print-progress',
  projectionState: 'wz:projection-state',
  audienceState: 'wz:audience-state',
  sessionChanged: 'wz:session-changed',
  notice: 'wz:notice',
  audienceGetState: 'wz:audience-get-state',
  updateProgress: 'wz:update-progress',
  /** Der Prompter meldet einen Folienwechsel an den Hauptprozess. */
  prompterCommand: 'wz:prompter-command',
  /** Der Hauptprozess meldet dem Prompter den aktuellen Stand. */
  prompterState: 'wz:prompter-state',
  /**
   * Der Prompter reicht weiter, was der Foliensatz über sich meldet.
   *
   * Warum von dort und nicht aus der Beameransicht: Die ist ausdrücklich rein
   * lesend (Beamer §31) und hat gar keinen Rückweg. Der Prompter hat einen —
   * er blättert ohnehin — und laedt denselben Foliensatz, bekommt dessen
   * Meldung also gleichermaßen.
   */
  prompterReport: 'wz:prompter-report',
  /**
   * Größe des Beamerfensters, damit die Vorschau im selben Format rechnet.
   *
   * Ein Foliensatz richtet sich nach seinem Fenster. Rechnete die Vorschau mit
   * einer anderen Größe, zeigte sie ein anderes Layout als die Wand.
   */
  beamerSize: 'wz:beamer-size',
  /**
   * Die Beameransicht meldet, was sie über das laufende Video weiß.
   *
   * Das ist die **einzige** Nachricht, die aus diesem Fenster hinausgeht, und
   * sie durchbricht die Regel „rein lesend" (Beamer §31) nicht: Sie verändert
   * keine Wahldaten, sondern sagt etwas über das Fenster selbst aus — wie
   * lang die Datei ist, ob genug gepuffert wurde, ob sie durchgelaufen ist.
   * Ohne diesen Weg wüsste niemand, wann der Film zu Ende ist, denn die
   * Laufzeit steckt im Containerformat und nirgends sonst.
   */
  audienceVideoReport: 'wz:audience-video-report'
} as const

/**
 * Die Preload-Skripte laufen in der Sandbox und dürfen keine gemeinsamen
 * Bundle-Chunks nachladen. Sie definieren die Kanalnamen deshalb selbst und
 * prüfen sie gegen diesen Typ — eine Abweichung fällt beim Kompilieren auf.
 */
export type IpcChannels = typeof IPC

export interface EventInput {
  title: string
  organization: string
  orgCode: string
  date: IsoDate
  location: string
  eligibleVoterCount?: number
  ruleSet: ElectionRuleSet
}

export interface RoundInput {
  eventId: UUID
  title: string
  purpose: ElectionPurpose
  procedure: ElectionProcedure
  seats: number
  maxVotes: number | null
  seatStart?: number
  seatEnd?: number
  roundLabel?: string
  roundCode?: string
  /**
   * Abweichungen von der Standardvorlage des Verfahrens. Fehlende Angaben
   * ergaenzt der Dienst aus den Vorgaben des gewaehlten Wahlverfahrens.
   */
  template: Partial<BallotTemplateConfig>
  orderMode: CandidateOrderMode
  parentRoundId?: UUID
  derivedAs?: ElectionRound['derivedAs']
  positions?: { title: string }[]
}

export interface RoundPatch {
  title?: string
  /**
   * Wahlzweck und Verfahren lassen sich nur ändern, solange der Wahlgang noch
   * in Vorbereitung ist und nichts gedruckt wurde. Ein Verfahrenswechsel
   * verändert den Stimmzettel grundlegend.
   */
  purpose?: ElectionPurpose
  procedure?: ElectionProcedure
  seats?: number
  maxVotes?: number | null
  seatStart?: number
  seatEnd?: number
  template?: BallotTemplateConfig
  orderMode?: CandidateOrderMode
  orderSeed?: number
  roundCode?: string
  /**
   * Nummer vorab vergeben (z. B. „04"). Ohne Angabe entsteht sie erst beim
   * Start des Wahlgangs.
   */
  roundLabel?: string
  positions?: { id?: UUID; title: string }[]
  /** Optimistic Locking (§59). */
  rowVersion: number
}

export interface CandidateInput {
  firstName: string
  lastName: string
  displayName: string
  ballotNumber?: number
  positionId?: UUID
  note?: string
}

export interface PrintRequest {
  electionRoundId: UUID
  printerId: string
  copies: number
  ballotVersion: number
  kind: 'initial' | 'reprint' | 'test'
  reason?: string
  idempotencyKey: string
  pin?: string
}

export interface PrintStartResult {
  batchId: UUID
  requestedCopies: number
  submittedCopies: number
  failedCopies: number
  /** true, wenn ein identischer Auftrag bereits lief und NICHT wiederholt wurde (§79). */
  deduplicated: boolean
}

export interface ResultInput {
  electionRoundId: UUID
  countingMode?: CountingMode
  declaration?: string
  eligibleVoters?: number
  ballotsCast: number
  validBallots: number
  invalidBallots: number
  resultData: ResultData
  note?: string
  determination?: string
  finalDecision?: ElectionResult['finalDecision']
  electedCandidateIds?: UUID[]
  lotDecision?: string
}

export interface AccountingInput {
  electionRoundId: UUID
  issued: number
  replacementsIssued: number
  returnedSpoiled: number
  unused: number
  ballotsInBox?: number
}

export interface BackupResult {
  path: string
  sizeBytes: number
  createdAt: string
  copies: string[]
}

export interface ExportResult {
  path: string
  files: string[]
  /** Der Speichern-unter-Dialog wurde abgebrochen; es wurde nichts geschrieben. */
  canceled?: boolean
}

export interface RoundDetail {
  round: ElectionRound
  candidates: Candidate[]
  accounting: BallotAccounting
  batches: PrintBatch[]
  versions: BallotVersionRecord[]
  result?: ElectionResult
  document: BallotDocument
}

export interface NetworkProjectionStatus extends NetworkProjectionConfig {
  running: boolean
  urls: string[]
  error?: string
}

export interface SetupState {
  needsSetup: boolean
  hasUsers: boolean
  version: string
  databasePath: string
}

/** Alle vom Operator-Renderer aufrufbaren Methoden. */
export interface Api {
  /* --------------------------------------------------------------- System */
  'system.setupState': () => Promise<SetupState>
  'system.createFirstAdmin': (input: {
    username: string
    displayName: string
    password: string
  }) => Promise<User>
  'system.settings': () => Promise<SystemSettings>
  'system.saveConfig': (config: AppConfig) => Promise<AppConfig>
  'system.savePrinters': (printers: PrinterConfig[]) => Promise<PrinterConfig[]>
  'system.preflight': () => Promise<PreflightItem[]>
  'system.recoveryState': () => Promise<RecoveryState>
  'system.acknowledgeBatch': (input: {
    batchId: UUID
    confirmedCopies: number
    note?: string
  }) => Promise<PrintBatch>
  'system.chooseDirectory': (title: string) => Promise<string | undefined>
  /** Bilddatei wählen und als eingebettete Data-URL zurückgeben (für das Beamer-Logo). */
  'system.chooseImage': (title: string) => Promise<string | undefined>
  /** Ordner oder Datei im Explorer anzeigen. */
  'system.revealPath': (path: string) => Promise<void>
  /** Eine Adresse im Standardbrowser öffnen – nur für die Veröffentlichungsseite. */
  'system.openExternal': (url: string) => Promise<void>
  /** Eine erzeugte Datei an einen frei gewählten Ort kopieren (z. B. USB-Stick). */
  'system.saveCopy': (input: { source: string; suggestedName?: string }) => Promise<string | undefined>
  /** Dateien eines Exports auflisten (Archivinhalt). */
  'system.listFiles': (directory: string) => Promise<{ name: string; path: string; sizeBytes: number }[]>

  /* ----------------------------------------------------------------- Auth */
  'auth.login': (input: { username: string; password: string }) => Promise<Session>
  'auth.logout': () => Promise<void>
  'auth.session': () => Promise<Session | null>
  'auth.touch': () => Promise<Session | null>
  'auth.listUsers': () => Promise<User[]>
  'auth.createUser': (input: {
    username: string
    displayName: string
    password: string
    role: Role
  }) => Promise<User>
  'auth.updateUser': (input: {
    id: UUID
    displayName?: string
    role?: Role
    active?: boolean
    password?: string
  }) => Promise<User>
  'auth.setPrintPin': (input: { pin: string }) => Promise<void>

  /* --------------------------------------------------------- Veranstaltung */
  'event.list': () => Promise<ElectionEvent[]>
  'event.active': () => Promise<ElectionEvent | null>
  'event.create': (input: EventInput) => Promise<ElectionEvent>
  'event.update': (input: EventInput & { id: UUID; rowVersion: number }) => Promise<ElectionEvent>
  'event.activate': (id: UUID) => Promise<ElectionEvent>
  'event.close': (id: UUID) => Promise<ElectionEvent>
  'event.archive': (id: UUID) => Promise<ExportResult>

  /* -------------------------------------------------------------- Wahlgang */
  'round.list': (eventId: UUID) => Promise<RoundSummary[]>
  'round.detail': (roundId: UUID) => Promise<RoundDetail>
  'round.create': (input: RoundInput) => Promise<ElectionRound>
  'round.update': (input: RoundPatch & { id: UUID }) => Promise<ElectionRound>
  'round.lockCandidates': (roundId: UUID) => Promise<ElectionRound>
  'round.unlock': (input: { roundId: UUID; reason: string }) => Promise<ElectionRound>
  'round.setStatus': (input: {
    roundId: UUID
    status: ElectionRound['status']
    reason?: string
  }) => Promise<ElectionRound>
  /** Vorbereiteten Punkt starten – erst dabei entsteht Nummer und Kennung. */
  'round.start': (roundId: UUID) => Promise<ElectionRound>
  'round.complete': (roundId: UUID) => Promise<ElectionRound>
  'round.cancel': (input: { roundId: UUID; reason: string }) => Promise<ElectionRound>
  'round.createFollowUp': (input: {
    parentRoundId: UUID
    kind: 'runoff' | 'repeat' | 'byelection' | 'second_round' | 'stage_2'
    title?: string
    seats?: number
    maxVotes?: number | null
    candidateIds: UUID[]
    procedure?: ElectionProcedure
  }) => Promise<ElectionRound>

  /* ---------------------------------------------------------- Tagesordnung */
  'agenda.list': (eventId: UUID) => Promise<AgendaItem[]>
  'agenda.add': (input: AgendaItemInput) => Promise<AgendaItem>
  'agenda.update': (input: {
    id: UUID
    title?: string
    label?: string
    note?: string
    done?: boolean
  }) => Promise<AgendaItem>
  'agenda.reorder': (input: { eventId: UUID; orderedIds: UUID[] }) => Promise<AgendaItem[]>
  'agenda.remove': (id: UUID) => Promise<AgendaItem[]>

  /* ------------------------------------------------------------ Kandidaten */
  'candidate.add': (input: { roundId: UUID; candidates: CandidateInput[] }) => Promise<Candidate[]>
  'candidate.update': (input: { id: UUID } & Partial<CandidateInput>) => Promise<Candidate>
  'candidate.withdraw': (input: { id: UUID; reason: string }) => Promise<Candidate>
  'candidate.reorder': (input: { roundId: UUID; orderedIds: UUID[] }) => Promise<Candidate[]>
  'candidate.applyOrderMode': (input: {
    roundId: UUID
    mode: CandidateOrderMode
    seed?: number
  }) => Promise<Candidate[]>

  /* ----------------------------------------------------------- Stimmzettel */
  'ballot.preview': (
    roundId: UUID
  ) => Promise<{
    document: BallotDocument
    lines: string[]
    rows: BallotPreviewRow[]
    hash: string
  }>
  'ballot.approve': (input: { roundId: UUID; checklist: string[] }) => Promise<BallotVersionRecord>
  'ballot.versions': (roundId: UUID) => Promise<BallotVersionRecord[]>

  /* ------------------------------------------------------------------ Druck */
  'print.start': (request: PrintRequest) => Promise<PrintStartResult>
  'print.abort': (batchId: UUID) => Promise<PrintBatch>
  /** Unterbrochenen Auftrag nach Papierwechsel fortsetzen (Restmenge drucken). */
  'print.resume': (input: {
    batchId: UUID
    confirmedCopies: number
    printerId?: string
    pin?: string
  }) => Promise<PrintStartResult & { remaining: number }>
  'print.batches': (roundId: UUID) => Promise<PrintBatch[]>
  'print.testPrinter': (printerId: string) => Promise<PrinterTestResult>
  'print.protocolSlip': (input: {
    roundId: UUID
    printerId: string
    kind: 'lot_decision' | 'result'
    text: string
  }) => Promise<PrintStartResult>
  /** Ergebnisbeleg auf dem Bondrucker – zum Weitergeben an die Versammlungsleitung. */
  'print.resultSlip': (input: { roundId: UUID; printerId: string }) => Promise<PrintStartResult>

  /* ------------------------------------------------------------- Bilanz */
  'accounting.get': (roundId: UUID) => Promise<BallotAccounting>
  'accounting.save': (input: AccountingInput) => Promise<BallotAccounting>

  /* ----------------------------------------------------------------- Ergebnis */
  'result.get': (roundId: UUID) => Promise<ElectionResult | null>
  'result.save': (input: ResultInput) => Promise<ElectionResult>
  'result.confirm': (input: { roundId: UUID; pin?: string }) => Promise<ElectionResult>
  'result.reopen': (input: { roundId: UUID; reason: string }) => Promise<ElectionResult>
  /** Notfallkorrektur: öffnet einen bereits abgeschlossenen Wahlgang (nur Administration). */
  'result.emergencyReopen': (input: { roundId: UUID; reason: string }) => Promise<ElectionRound>

  /* -------------------------------------------------------------- Audit */
  'audit.list': (input: { eventId?: UUID; roundId?: UUID; limit?: number }) => Promise<AuditEntry[]>
  'audit.verify': () => Promise<AuditChainCheck>

  /* ------------------------------------------------------------- Export */
  /*
   * Exporte fragen vor dem Schreiben nach dem Ziel. `askTarget: false` schreibt
   * ohne Rueckfrage in den Ablageordner der Anwendung – noetig fuer alles, was
   * ohne Bedienung laeuft (Tests, Archivierung im Hintergrund).
   */
  'export.round': (input: {
    roundId: UUID
    formats: ('pdf' | 'csv' | 'json')[]
    askTarget?: boolean
  }) => Promise<ExportResult>
  'export.event': (input: { eventId: UUID; askTarget?: boolean }) => Promise<ExportResult>
  'export.protocol': (input: { roundId: UUID; askTarget?: boolean }) => Promise<ExportResult>
  'backup.create': (target?: string) => Promise<BackupResult>

  /* --------------------------------------------------- Neue Fassung prüfen */
  /** Fragt die zuletzt veröffentlichte Fassung ab. Lädt und installiert nichts. */
  'update.check': () => Promise<UpdateCheckResult>
  /** Ist ein Wechsel der Fassung gerade vertretbar? (Keine laufende Wahl.) */
  'update.canInstall': () => Promise<UpdateInstallCheck>
  /**
   * Lädt das Installationsprogramm, prüft es gegen die veröffentlichte
   * Prüfsumme, startet es und beendet die Anwendung. Nur Administration.
   */
  'update.install': () => Promise<UpdateInstallResult>

  /* --------------------------------------------------------- Projektion */
  'projection.state': () => Promise<ProjectionState>
  'projection.setMode': (input: {
    mode: ProjectionMode
    roundId?: UUID
    message?: { title: string; body?: string; showRoundContext?: boolean }
    agenda?: { top?: string; current?: string; next?: string }
    agendaView?: 'full' | 'focus'
    showAll?: boolean
    breakMinutes?: number
    presentationId?: UUID
    videoId?: UUID
  }) => Promise<ProjectionState>
  'projection.setCandidatePage': (page: number) => Promise<ProjectionState>
  'projection.setLocked': (locked: boolean) => Promise<ProjectionState>
  'projection.history': () => Promise<ProjectionHistoryEntry[]>
  'projection.displays': () => Promise<DisplayInfo[]>
  'projection.audienceState': () => Promise<AudienceWindowState>
  'projection.openAudience': (displayId?: number) => Promise<AudienceWindowState>
  'projection.closeAudience': () => Promise<AudienceWindowState>
  'projection.network': () => Promise<NetworkProjectionStatus>
  'projection.setNetwork': (config: NetworkProjectionConfig) => Promise<NetworkProjectionStatus>
  'projection.demo': (enabled: boolean) => Promise<ProjectionState>
  /* ------------------------------------------------------- Präsentationen */
  /**
   * Eingespeiste Präsentationen. Die Datei selbst geht **nie** über diese
   * Schnittstelle — nur Kennung und Kennzahlen. Das Dokument liefert der
   * Projektionsserver als eigene Ressource aus.
   */
  'presentation.list': () => Promise<PresentationInfo[]>
  /** Öffnet den Dateidialog und übernimmt die gewählte HTML-Datei. */
  'presentation.import': () => Promise<PresentationInfo | null>
  'presentation.rename': (input: { id: UUID; title: string }) => Promise<PresentationInfo>
  'presentation.delete': (id: UUID) => Promise<void>
  /** Blättert in der laufenden Präsentation (1-basiert). */
  'presentation.setSlide': (slide: number) => Promise<ProjectionState>
  /** Was das Dokument über sich meldet — Folie und Gesamtzahl. */
  'presentation.report': (input: { slide: number; slideCount: number }) => Promise<ProjectionState>
  /* -------------------------------------------------------------- Videos */
  /**
   * Eingespeiste Videos. Die Datei selbst geht **nie** über diese
   * Schnittstelle — sie käme als ein Stück im Arbeitsspeicher an. Ausgeliefert
   * wird sie mit Bereichsanfragen über ein eigenes Schema bzw. den
   * Projektionsserver.
   */
  'video.list': () => Promise<VideoInfo[]>
  /** Öffnet den Dateidialog und übernimmt die gewählte Videodatei. */
  'video.import': () => Promise<VideoInfo | null>
  'video.rename': (input: { id: UUID; title: string }) => Promise<VideoInfo>
  'video.delete': (id: UUID) => Promise<void>
  /** Start und Pause; die Uhr im Zustand wird dabei neu gesetzt. */
  'video.setPlaying': (playing: boolean) => Promise<ProjectionState>
  /** Springt an diese Stelle (Sekunden). */
  'video.seek': (seconds: number) => Promise<ProjectionState>
  'video.setMuted': (muted: boolean) => Promise<ProjectionState>
  /** Was das Gerät aus der Datei gelesen hat. */
  'video.reportDuration': (seconds: number) => Promise<ProjectionState>
  /** Dieses Gerät hat genug gepuffert. */
  'video.reportReady': () => Promise<ProjectionState>
  /** Das Video ist durchgelaufen. */
  'video.reportEnded': () => Promise<ProjectionState>

  'presentation.prompterState': () => Promise<PrompterWindowState>
  'presentation.openPrompter': () => Promise<PrompterWindowState>
  'presentation.closePrompter': () => Promise<PrompterWindowState>

  'projection.theme': () => Promise<ProjectionTheme>
  'projection.setTheme': (theme: ProjectionTheme) => Promise<ProjectionTheme>
}

export type ApiMethod = keyof Api
export type ApiParams<M extends ApiMethod> = Parameters<Api[M]>
export type ApiResult<M extends ApiMethod> = Awaited<ReturnType<Api[M]>>

/** Ereignisse, die das Main an den Operator-Renderer schickt. */
export interface OperatorEvents {
  printProgress: PrintProgress
  projectionState: ProjectionState
  audienceState: AudienceWindowState
  sessionChanged: Session | null
  notice: { level: 'info' | 'warning' | 'error'; message: string }
  updateProgress: UpdateProgress
}

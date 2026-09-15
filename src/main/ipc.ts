/**
 * IPC-Registrierung.
 *
 * Der Renderer erreicht ausschließlich die hier eingetragenen Methoden
 * (Whitelist). Fehler werden als Ergebnisobjekt zurückgegeben, damit im
 * Renderer eine verständliche deutsche Meldung ankommt.
 */
import { app, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Permission } from '@shared/types'
import { IPC, type Api, type ApiMethod, type SaalnetzStatus } from '@shared/ipc'
import { ALLE_BUEHNEN, EMPTY_PROJECTION_STATE, HAUPTBUEHNE, type Buehnenwahl } from '@shared/projection'
import { db } from './db'
import { appPaths } from './paths'
import type { KameraQualitaet } from '@shared/kamera'
import {
  ptzErkennen,
  ptzHalt,
  ptzHeim,
  ptzPositionAbrufen,
  ptzPositionSpeichern,
  ptzScharfstellen,
  ptzSchwenken,
  ptzStellungLesen,
  ptzZoomen
} from './services/ptz'
import { logger } from './logger'
import {
  kameraAn as kameraAnschliessen,
  kameraAus as kameraLoesen,
  kameraStand,
  onKameraStand,
  sucheKameras
} from './services/kamera'
import {
  getPrompterView,
  loadSpeech,
  nudgePrompter,
  refreshSpeech,
  setPrompterAnsicht,
  setPrompterFolgtDemAufruf,
  setPrompterDarstellung,
  setPrompterLaufart,
  setPrompterNetzBedienung,
  setPrompterPosition,
  setPrompterRunning,
  setPrompterTempo,
  setPrompterUntil
} from './services/prompter'
import { sprachmodellEinlegen, sprachmodellEntfernen, sprachmodellInfo , sprachmodellLaden} from './services/sprachmodell'
import {
  assignSpeech,
  createSpeech,
  deleteSpeech,
  getSpeech,
  importSpeech,
  listSpeeches,
  renameSpeech,
  saveSpeech
} from './services/speeches'
import { networkStatus, startNetworkProjection, stopNetworkProjection } from './network-projection'
import { starteSuchruf, stoppeSuchruf, type SuchrufQuelle } from './suchruf'
import { accountingFor, saveAccounting } from './services/accounting'
import { appendAudit, listAudit, verifyAuditChain } from './services/audit'
import {
  createUser,
  getSession,
  hashSecret,
  listUsers,
  login,
  logout,
  setPrintPin,
  touchSession,
  updateUser,
  userCount,
  requirePermission,
  requireSession
} from './services/auth'
import { approveBallot, currentDocument, listVersions, previewBallot } from './services/ballots'
import { createBackup } from './services/backup'
import {
  addCandidates,
  applyOrderMode,
  listCandidates,
  listEventCandidates,
  reorderCandidates,
  updateCandidate,
  withdrawCandidate
,
  setCandidateQuotengruppe
} from './services/candidates'
import {
  activateEvent,
  activeEvent,
  closeEvent,
  createEvent,
  listEvents,
  updateEvent
} from './services/events'
import { preflight, recoveryState } from './services/preflight'
import {
  abortBatch,
  acknowledgeBatch,
  listBatches,
  printProtocolSlip,
  printResultSlip,
  resumePrint,
  startPrint,
  testPrinter
} from './services/printing'
import {
  getProjectionState,
  history as projectionHistory,
  refreshEventInfo,
  refreshTheme,
  addSpeakerSeconds,
  nextSpeaker,
  listBuehnen,
  saveBuehnen,
  setCandidatePage,
  setCandidatePageInterval,
  setSpeakerPaused,
  setDemoMode,
  setLocked,
  setProjection,
  setPresentationSlide,
  setVideoMuted,
  endeVorstellung,
  setKameraBauchbinde,
  setKameraNaechste,
  setKameraSpiegeln,
  setUntertitel,
  meldeUntertitel,
  untertitelIrgendwo,
  setVideoSchleife,
  setVideoPlaying,
  seekVideo,
  reportVideoDuration,
  reportVideoReady,
  videoEnded,
  reportPresentationState,
  projectDomainEvent
} from './services/projection'
import {
  deletePresentation,
  importPresentation,
  listPresentations,
  renamePresentation
} from './services/presentations'
import { deleteVideo, importVideo, listVideos, renameVideo } from './services/videos'
import {
  cancelRound,
  completeRound,
  createFollowUpRound,
  createRound,
  getRound,
  listRounds,
  lockCandidates,
  setRoundStatus,
  startRound,
  unlockRound,
  updateRound
} from './services/rounds'
import {
  antragAendern,
  antraegeSortieren,
  antragAnlegen,
  antragAnWahlgang,
  antragBeschlusstext,
  antragLoeschen,
  antragReihenfolge,
  antragStand,
  antragUebernehmen,
  antragZurAbstimmung,
  listAntraege
} from './services/antraege'
import {
  addAgendaItem,
  listAgenda,
  removeAgendaItem,
  reorderAgenda,
  updateAgendaItem
} from './services/agenda'
import {
  addParticipant,
  attendanceHistory,
  blockParticipant,
  findByPass,
  issuePass,
  listParticipants,
  presenceSummary,
  setAttendance,
  unblockParticipant,
  updateParticipant
} from './services/participants'
import {
  assignCard,
  cardHistory,
  cardStock,
  importCards,
  listCards,
  resolveScan,
  returnCard,
  setCardStatus
} from './services/cards'
import { handoutCount, handoutFor, issueBallot, revokeIssue } from './services/handout'
import { printUrnenListe, printVotingPass } from './services/printing'
import {
  closeVoting,
  openVoting,
  prepareVoting,
  urnenListe,
  votingLage,
  votingStand,
  berechtigungEntwerten,
  zaehlung
} from './services/voting'
import {
  confirmResult,
  emergencyReopen,
  getPapierergebnis,
  getResult,
  reopenResult,
  saveResult
,
  quotenbefund
} from './services/results'
import { ACME_ECHT, ACME_UEBUNG, auftragAbschliessen, auftragBeginnen } from './acme'
import { dhcpLaeuft, starteDhcp, stoppeDhcp, vergebeneAdressen } from './dhcp'
import { dnsLaeuft, starteDns, stoppeDns } from './dns'
import {
  eigenesZertifikatAblegen,
  eigenesZertifikatEntfernen,
  netzwerkkarten,
  saaladresse,
  zertifikatsName
} from './tls'
import {
  getConfig,
  getEigenesZertifikat,
  getNetworkProjection,
  getProjectionTheme,
  getSaalnetz,
  getSettings,
  getPtzKameras,
  saveConfig,
  saveEigenesZertifikat,
  saveNetworkProjection,
  savePrinters,
  saveProjectionTheme,
  savePtzKameras,
  saveSaalnetz
} from './services/settings'
import {
  eventArchiveFolderName,
  exportEventArchive,
  exportProtocol,
  exportRound,
  protocolFileName,
  roundExportFolderName
} from './export'
import { checkForUpdate } from './services/updates'
import { canInstallUpdate, downloadAndInstallUpdate } from './services/update-install'
import {
  audienceState,
  closeAudienceWindow,
  closePrompterWindow,
  getOperatorWindow,
  listDisplays,
  openAudienceWindow,
  closeTeleprompterWindow,
  getPrompterBuehne,
  openPrompterWindow,
  openTeleprompterWindow,
  teleprompterState,
  prompterState,
  setPrompterBuehne,
  sendToOperator,
  openZuhoererWindow,
  closeZuhoererWindow
} from './windows'

/*
 * Exporte sollen dort landen, wo die Bedienung sie sucht — nicht in einem
 * Anwendungsordner, den man erst finden muss. Deshalb fragt jeder Export nach
 * dem Ziel; die Vorschlaege unten nennen Wahlgang bzw. Veranstaltung, damit
 * sich die Dateien spaeter zuordnen lassen.
 */
async function ordnerWaehlen(title: string, vorschlag: string): Promise<string | undefined> {
  const window = getOperatorWindow()
  const options = {
    title,
    defaultPath: join(appPaths().exports, vorschlag),
    properties: ['openDirectory', 'createDirectory'] as const
  }
  const result = window
    ? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
    : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
  return result.canceled ? undefined : result.filePaths[0]
}

async function dateiZielWaehlen(title: string, vorschlag: string): Promise<string | undefined> {
  const window = getOperatorWindow()
  const options = { title, defaultPath: join(appPaths().exports, vorschlag) }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? undefined : result.filePath
}

/**
 * Die Bühne, auf die sich eine Abfrage bezieht.
 *
 * Der Master hat selbst keinen Zustand — gefragt wird dann die Hauptbühne.
 */
function bezugsbuehne(stage?: Buehnenwahl): number {
  const ziele = zielBuehnen(stage)
  return ziele.includes(HAUPTBUEHNE) ? HAUPTBUEHNE : ziele[0]
}

/**
 * Die Bühnen, auf die sich eine Schaltung bezieht.
 *
 * Eine leere Auswahl bedeutet „alle" und nicht „keine": Wer im Master nichts
 * angehakt hat, meint die ganze Versammlung — ein Knopf, der dann gar nichts
 * täte, wäre eine Falle.
 */
function zielBuehnen(stage?: Buehnenwahl): number[] {
  const vorhanden = listBuehnen().map((buehne) => buehne.id)
  if (Array.isArray(stage)) {
    const gewaehlt = stage.filter((id) => vorhanden.includes(id))
    return gewaehlt.length > 0 ? gewaehlt : vorhanden
  }
  if (stage === ALLE_BUEHNEN) return vorhanden
  return [stage ?? HAUPTBUEHNE]
}

/**
 * Führt eine Bühnenaktion aus — beim Master auf allen Bühnen zugleich.
 *
 * Zurück kommt immer die Antwort der Hauptbühne: Die Bedienung erwartet einen
 * Zustand, nicht eine Liste, und der Master ist nur eine Abkürzung für „das
 * Gleiche überall", keine eigene Fläche.
 */
function aufBuehnen<T>(stage: Buehnenwahl | undefined, tue: (buehne: number) => T): T {
  const ziele = zielBuehnen(stage)
  if (ziele.length === 1) return tue(ziele[0])
  const ergebnisse = new Map<number, T>()
  for (const buehne of ziele) ergebnisse.set(buehne, tue(buehne))
  return ergebnisse.get(bezugsbuehne(stage)) ?? ergebnisse.get(ziele[0])!
}

/**
 * Woher die Antwort auf einen Suchruf ihre Angaben nimmt.
 *
 * Als Funktionen und nicht als Werte: Der Dienst läuft weiter, während Bühnen
 * umbenannt oder angelegt werden — er soll dann das Heutige sagen, nicht das
 * von seinem Start.
 */
export function suchrufQuelle(): SuchrufQuelle {
  return {
    name: () => activeEvent()?.title ?? 'Votura',
    port: () => getNetworkProjection().port,
    version: () => app.getVersion(),
    tokenNoetig: () => Boolean(getNetworkProjection().token),
    buehnen: () => listBuehnen().map((buehne) => ({ id: buehne.id, name: buehne.name })),
    prompterBedienung: () => getNetworkProjection().allowPrompterControl,
    /*
     * Ist eine Netzwerkkarte fest eingestellt, gilt allein deren Adresse —
     * dann ist die Entscheidung schon gefallen. Sonst die eigene Sortierung:
     * echte Karten vor virtuellen Schaltern.
     */
    adressen: () => {
      const gebunden = getNetworkProjection().bindAddress
      if (gebunden && gebunden !== '0.0.0.0' && gebunden !== '127.0.0.1') return [gebunden]
      return netzwerkkarten()
        .filter((karte) => !karte.virtuell)
        .map((karte) => karte.adresse)
    },
    tls: () => getNetworkProjection().tls,
    zertifikatsName: () =>
      getNetworkProjection().tls
        ? (zertifikatsName(join(app.getPath('userData'), 'netz')) ?? undefined)
        : undefined
  }
}

/** Der Stand der Netzdienste — für die Oberfläche. */
function saalnetzStatus(): SaalnetzStatus {
  return {
    ...getSaalnetz(),
    dnsLaeuft: dnsLaeuft(),
    dhcpLaeuft: dhcpLaeuft(),
    vergeben: dhcpLaeuft() ? vergebeneAdressen() : []
  }
}

/**
 * Den Projektionsserver neu starten, damit ein gewechseltes Zertifikat gilt.
 *
 * Ein Zertifikat wird beim Start des Servers gelesen. Ohne Neustart läuft er
 * mit dem alten weiter, und die Oberfläche zeigte etwas anderes an, als über
 * die Leitung geht.
 */
async function netzNeu(): Promise<void> {
  const netz = getNetworkProjection()
  if (!netz.enabled) return
  await stopNetworkProjection()
  await startNetworkProjection(netz)
}

/**
 * Darf der Aufrufer das sehen — ohne dass eine Absage fliegt?
 *
 * `requirePermission` wirft und verlängert nebenbei die Sitzung. Beides ist
 * hier falsch: Gefragt wird nicht, ob jemand handeln darf, sondern ob er
 * etwas zu sehen bekommt.
 */
function darfSehen(recht: Permission): boolean {
  return getSession()?.permissions.includes(recht) ?? false
}

/**
 * Das Zugriffstoken aus einer Antwort nehmen, wenn der Aufrufer es nichts
 * angeht.
 *
 * **Warum das zählt.** Mit dem Token kommt jedes Gerät im Saalnetz an die
 * Beameransicht, an die Wahlseite und — bei „nur Wahlkabinen" — an die
 * Unterscheidung zwischen Kabine und mitgebrachtem Telefon. Es ist kein
 * Anzeigewert, sondern ein Schlüssel.
 *
 * Herausgegeben wurde es bisher an jeden Aufrufer, auch vor der Anmeldung.
 * Praktisch braucht das den entsperrten Rechner — und dort ist ohnehin alles
 * verloren. Sauber ist es trotzdem nicht.
 *
 * Die Adressen werden gleich mit bereinigt: Eine Adresse, die das Token in
 * der Abfrage trägt, wäre dasselbe noch einmal.
 */
function ohneGeheimnis<T extends { token: string; urls?: string[] }>(wert: T): T {
  if (darfSehen('system.manage')) return wert
  return {
    ...wert,
    token: '',
    ...(wert.urls ? { urls: wert.urls.map((url) => url.split('?')[0]) } : {})
  }
}

const api: Api = {
  /* --------------------------------------------------------------- System */
  'system.setupState': async () => ({
    needsSetup: userCount() === 0,
    hasUsers: userCount() > 0,
    version: app.getVersion(),
    databasePath: appPaths().database
  }),

  'system.createFirstAdmin': async (input) => {
    if (userCount() > 0) throw new Error('Es existieren bereits Benutzer. Bitte anmelden.')
    if (input.password.length < 8) throw new Error('Das Passwort muss mindestens 8 Zeichen haben.')
    if (!input.username.trim()) throw new Error('Bitte einen Benutzernamen angeben.')
    // Erstanlage läuft ohne Sitzung – danach ist eine Anmeldung nötig.
    db()
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, active, created_at)
         VALUES (?, ?, ?, ?, 'ADMIN', 1, ?)`
      )
      .run(
        randomUUID(),
        input.username.trim().toLowerCase(),
        input.displayName.trim() || input.username,
        hashSecret(input.password),
        new Date().toISOString()
      )
    appendAudit({ action: 'system.first_admin_created', newValue: { username: input.username } })
    return listUsers()[0]
  },

  'system.settings': async () => {
    const einstellungen = getSettings()
    return { ...einstellungen, networkProjection: ohneGeheimnis(einstellungen.networkProjection) }
  },

  'system.saveConfig': async (config) => {
    requirePermission('system.manage')
    const saved = saveConfig(config)
    appendAudit({ action: 'system.config_saved', newValue: { timezone: saved.timezone } })
    return saved
  },
  'system.savePrinters': async (printers) => {
    requirePermission('system.manage')
    const saved = savePrinters(printers)
    appendAudit({ action: 'system.printers_saved', newValue: { anzahl: saved.length } })
    return saved
  },
  'system.preflight': async () => preflight(),
  'system.recoveryState': async () => recoveryState(),
  'system.acknowledgeBatch': async (input) =>
    acknowledgeBatch(input.batchId, input.confirmedCopies, input.note),
  'system.chooseDirectory': async (title) => {
    const window = getOperatorWindow()
    const result = window
      ? await dialog.showOpenDialog(window, { title, properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
  },

  'system.chooseFile': async (input) => {
    const window = getOperatorWindow()
    const options = {
      title: input.titel,
      properties: ['openFile' as const],
      filters: [{ name: 'Dateien', extensions: input.endungen }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0]
  },

  'system.chooseImage': async (title) => {
    const window = getOperatorWindow()
    const options = {
      title,
      properties: ['openFile' as const],
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return undefined

    const file = result.filePaths[0]
    const data = readFileSync(file)
    if (data.byteLength > 1_500_000) {
      throw new Error('Die Bilddatei ist zu groß (maximal 1,5 MB). Bitte ein kleineres Logo verwenden.')
    }
    const extension = extname(file).toLowerCase()
    const mime =
      extension === '.png'
        ? 'image/png'
        : extension === '.gif'
          ? 'image/gif'
          : extension === '.webp'
            ? 'image/webp'
            : extension === '.svg'
              ? 'image/svg+xml'
              : 'image/jpeg'
    // Als Data-URL einbetten: die Anzeige lädt damit nichts aus dem Dateisystem
    // oder dem Netz nach und funktioniert auch in der Netzwerkansicht.
    return `data:${mime};base64,${data.toString('base64')}`
  },

  'system.openExternal': async (url) => {
    // Nur Veröffentlichungsseiten des Projekts: die Anwendung soll keine
    // beliebigen Adressen aus dem Renderer heraus öffnen können.
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\//.test(url)) {
      throw new Error('Diese Adresse darf nicht geöffnet werden.')
    }
    await shell.openExternal(url)
  },

  'system.revealPath': async (path) => {
    requirePermission('export.read')
    if (statSync(path).isDirectory()) await shell.openPath(path)
    else shell.showItemInFolder(path)
  },

  'system.saveCopy': async (input) => {
    requirePermission('export.read')
    const window = getOperatorWindow()
    const options = {
      title: 'Kopie speichern',
      defaultPath: input.suggestedName ?? basename(input.source)
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return undefined
    copyFileSync(input.source, result.filePath)
    appendAudit({
      action: 'export.copied',
      newValue: { quelle: basename(input.source), ziel: result.filePath }
    })
    return result.filePath
  },

  'system.listFiles': async (directory) => {
    requirePermission('export.read')
    if (!existsSync(directory)) return []
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(directory, entry.name)
        return { name: entry.name, path: full, sizeBytes: statSync(full).size }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de-DE'))
  },

  /* ----------------------------------------------------------------- Auth */
  'auth.login': async (input) => login(input.username, input.password),
  'auth.logout': async () => logout(),
  'auth.session': async () => getSession(),
  'auth.touch': async () => touchSession(),
  'auth.listUsers': async () => {
    requirePermission('user.manage')
    return listUsers()
  },
  'auth.createUser': async (input) => {
    requirePermission('user.manage')
    return createUser(input)
  },
  'auth.updateUser': async (input) => {
    requirePermission('user.manage')
    return updateUser(input)
  },
  'auth.setPrintPin': async (input) => {
    const session = requireSession()
    setPrintPin(session.user.id, input.pin)
  },

  /* --------------------------------------------------------- Veranstaltung */
  'event.list': async () => listEvents(),
  'event.active': async () => activeEvent(),
  'event.create': async (input) => createEvent(input),
  'event.update': async (input) => {
    const event = updateEvent(input)
    refreshEventInfo()
    return event
  },
  'event.activate': async (id) => {
    const event = activateEvent(id)
    refreshEventInfo()
    return event
  },
  'event.close': async (id) => closeEvent(id),
  'event.archive': async (id) => exportEventArchive(id),

  /* -------------------------------------------------------------- Wahlgang */
  'round.list': async (eventId) => listRounds(eventId),
  'round.detail': async (roundId) => {
    const round = getRound(roundId)
    return {
      round,
      candidates: listCandidates(roundId),
      accounting: accountingFor(roundId),
      batches: listBatches(roundId),
      versions: listVersions(roundId),
      result: getResult(roundId) ?? undefined,
      papierergebnis: getPapierergebnis(roundId) ?? undefined,
      document: currentDocument(roundId)
    }
  },
  'round.create': async (input) => {
    const round = createRound(input)
    projectDomainEvent('RoundAnnounced', round.id)
    return round
  },
  'round.update': async (input) => updateRound(input),
  'round.lockCandidates': async (roundId) => {
    const round = lockCandidates(roundId)
    projectDomainEvent('CandidatesFinalized', roundId)
    return round
  },
  'round.unlock': async (input) => unlockRound(input.roundId, input.reason),
  'round.setStatus': async (input) => {
    const round = setRoundStatus(input.roundId, input.status, input.reason)
    if (input.status === 'open') projectDomainEvent('RoundOpened', input.roundId)
    if (input.status === 'counting') projectDomainEvent('CountingStarted', input.roundId)
    return round
  },
  'round.start': async (roundId) => {
    const round = startRound(roundId)
    projectDomainEvent('RoundAnnounced', roundId)
    return round
  },
  'round.complete': async (roundId) => completeRound(roundId),
  'round.cancel': async (input) => cancelRound(input.roundId, input.reason),
  'round.createFollowUp': async (input) => {
    const round = createFollowUpRound(input)
    if (input.kind === 'runoff') projectDomainEvent('RunoffCreated', round.id)
    return round
  },

  /* ---------------------------------------------------------- Tagesordnung */
  /* ---------------------------------------------- Digitale Abstimmung */
  'voting.prepare': async (input) => prepareVoting(input),
  'voting.open': async (roundId) => openVoting(roundId),
  'voting.close': async (roundId) => closeVoting(roundId),
  'voting.lage': async (roundId) => votingLage(roundId),
  'voting.stand': async (roundId) => votingStand(roundId),
  'voting.urne': async (roundId) => urnenListe(roundId),
  /**
   * Das Ergebnis der digitalen Abstimmung in den Wahlgang übernehmen.
   *
   * Ausgezählt wird die Urne, nicht ein laufender Zähler — dieselbe Rechnung,
   * die auch jeder im Saal an der gedruckten Liste nachvollziehen kann.
   *
   * **Was hier nicht passiert: Zahlen schreiben.** Die geschlossene Urne wird
   * beim Lesen des Ergebnisses hinzugerechnet (`getResult`). Dieser Aufruf
   * legt nur die Zeile an, falls es noch keine gibt — bei einem rein digitalen
   * Wahlgang, in dem nichts von Hand zu zählen war. Wurde daneben auf Papier
   * abgestimmt und ausgezählt, bleibt diese Auszählung unangetastet; früher
   * hat diese Stelle sie überschrieben.
   */
  'voting.uebernehmen': async (roundId) => {
    const digital = zaehlung(roundId).ballotsCast
    /*
     * Gibt es schon ein Ergebnis, ist nichts zu tun: Die Urne wird beim Lesen
     * hinzugerechnet, und die eingetragene Papierauszählung bleibt unangetastet.
     * Gemeldet wird es trotzdem — ein stiller Klick sieht aus wie ein Fehler.
     */
    if (getPapierergebnis(roundId)) return { digital, hatteErgebnis: true }
    const stand = votingStand(roundId)
    saveResult({
      electionRoundId: roundId,
      countingMode: 'counted',
      /* Der Papieranteil eines rein digitalen Wahlgangs ist null — alles
         Weitere kommt aus der Urne dazu. */
      ballotsCast: 0,
      validBallots: 0,
      invalidBallots: 0,
      eligibleVoters: stand.ausgegeben,
      resultData: { candidates: [] }
    })
    return { digital, hatteErgebnis: false }
  },
  'voting.entwerten': async (input) => {
    berechtigungEntwerten(input)
  },
  'voting.drucken': async (input) => {
    await printUrnenListe(input)
  },

  /* ----------------------------------------------- Ausgabe der Zettel */
  'handout.issue': async (input) => issueBallot(input),
  'handout.count': async (roundId) => handoutCount(roundId),
  'handout.for': async (input) => handoutFor(input.roundId, input.participantId),
  'handout.revoke': async (input) => {
    revokeIssue(input.issueId, input.reason)
  },

  /* ------------------------------------------------ Karten und Bändchen */
  'card.list': async () => listCards(),
  'card.stock': async () => cardStock(),
  'card.import': async (input) => importCards(input.entries, input.kind),
  'card.assign': async (input) => assignCard(input.participantId, input.code),
  'card.return': async (code) => returnCard(code),
  'card.setStatus': async (input) => setCardStatus(input.id, input.status, input.note),
  'card.history': async (cardId) => cardHistory(cardId),
  'card.resolve': async (input) => resolveScan(input.eventId, input.code),

  /* ------------------------------------------------------- Akkreditierung */
  'participant.list': async (eventId) => listParticipants(eventId),
  'participant.add': async (input) => addParticipant(input),
  'participant.update': async (input) => updateParticipant(input.id, input),
  'participant.attendance': async (input) => setAttendance(input.id, input.kind, input.note),
  'participant.history': async (id) => attendanceHistory(id),
  'participant.issuePass': async (id) => issuePass(id),
  'participant.findByPass': async (input) => findByPass(input.eventId, input.token),
  'participant.block': async (input) => blockParticipant(input.id, input.reason),
  'participant.unblock': async (id) => unblockParticipant(id),
  'participant.presence': async (eventId) => presenceSummary(eventId, getConfig().assembly.quorum),
  'participant.issueAndPrintPass': async (input) => {
    const { participant, token } = issuePass(input.id)
    await printVotingPass({ participantId: input.id, token, printerId: input.printerId })
    return participant
  },

  'agenda.list': async (eventId) => listAgenda(eventId),
  'agenda.add': async (input) => addAgendaItem(input),
  'agenda.update': async (input) => updateAgendaItem(input),
  'agenda.reorder': async (input) => reorderAgenda(input.eventId, input.orderedIds),
  'agenda.remove': async (id) => removeAgendaItem(id),

  /* ------------------------------------------------------------ Kandidaten */
  'candidate.add': async (input) => addCandidates(input.roundId, input.candidates),
  'candidate.update': async (input) => updateCandidate(input),
  'candidate.withdraw': async (input) => withdrawCandidate(input.id, input.reason),
  'candidate.setQuotengruppe': async (input) => setCandidateQuotengruppe(input),
  'candidate.reorder': async (input) => reorderCandidates(input.roundId, input.orderedIds),
  'candidate.listForEvent': async (eventId) => listEventCandidates(eventId),
  'candidate.applyOrderMode': async (input) => applyOrderMode(input.roundId, input.mode, input.seed),

  /* ----------------------------------------------------------- Stimmzettel */
  'ballot.preview': async (roundId) => previewBallot(roundId),
  'ballot.approve': async (input) => {
    const version = approveBallot(input.roundId, input.checklist)
    projectDomainEvent('BallotApproved', input.roundId)
    return version
  },
  'ballot.versions': async (roundId) => listVersions(roundId),

  /* ------------------------------------------------------------------ Druck */
  'print.start': async (request) => startPrint(request),
  'print.abort': async (batchId) => abortBatch(batchId),
  'print.resume': async (input) => resumePrint(input),
  'print.batches': async (roundId) => listBatches(roundId),
  'print.testPrinter': async (printerId) => testPrinter(printerId),
  'print.protocolSlip': async (input) => printProtocolSlip(input),
  'print.resultSlip': async (input) => printResultSlip(input),

  /* ---------------------------------------------------------------- Bilanz */
  'accounting.get': async (roundId) => accountingFor(roundId),
  'accounting.save': async (input) => saveAccounting(input),

  /* -------------------------------------------------------------- Ergebnis */
  /* --------------------------------------------------------------- Anträge */
  'motion.list': async (eventId) => listAntraege(eventId),
  'motion.create': async (input) => antragAnlegen(input),
  'motion.update': async (input) => antragAendern(input),
  'motion.setStatus': async (input) => antragStand(input),
  'motion.adopt': async (id) => antragUebernehmen(id),
  'motion.delete': async (id) => antragLoeschen(id),
  'motion.reorder': async (input) => antraegeSortieren(input),
  'motion.order': async (hauptId) => antragReihenfolge(hauptId),
  'motion.text': async (hauptId) => antragBeschlusstext(hauptId),
  'motion.linkRound': async (input) => antragAnWahlgang(input),
  'motion.toRound': async (input) => antragZurAbstimmung(input),

  'result.get': async (roundId) => getResult(roundId),
  'result.papier': async (roundId) => getPapierergebnis(roundId),
  'result.save': async (input) => saveResult(input),
  'result.confirm': async (input) => {
    const result = confirmResult(input.roundId, input.pin)
    projectDomainEvent('ResultConfirmed', input.roundId)
    return result
  },
  'result.quote': async (roundId) => quotenbefund(roundId),
  'result.reopen': async (input) => reopenResult(input.roundId, input.reason),
  'result.emergencyReopen': async (input) => emergencyReopen(input.roundId, input.reason),

  /* ----------------------------------------------------------------- Audit */
  'audit.list': async (input) => listAudit(input),
  'audit.verify': async () => verifyAuditChain(),

  /* ---------------------------------------------------------------- Export */
  'export.round': async (input) => {
    if (input.askTarget === false) return exportRound(input.roundId, input.formats)
    const ordner = await ordnerWaehlen(
      'Vollstaendigen Export speichern unter',
      roundExportFolderName(input.roundId)
    )
    if (!ordner) return { path: '', files: [], canceled: true }
    return exportRound(input.roundId, input.formats, ordner)
  },
  'export.event': async (input) => {
    if (input.askTarget === false) return exportEventArchive(input.eventId)
    const ordner = await ordnerWaehlen(
      'Archiv der Veranstaltung speichern unter',
      eventArchiveFolderName(input.eventId)
    )
    if (!ordner) return { path: '', files: [], canceled: true }
    return exportEventArchive(input.eventId, ordner)
  },
  'export.protocol': async (input) => {
    if (input.askTarget === false) return exportProtocol(input.roundId)
    const datei = await dateiZielWaehlen('Wahlprotokoll speichern unter', protocolFileName(input.roundId))
    if (!datei) return { path: '', files: [], canceled: true }
    return exportProtocol(input.roundId, datei)
  },
  'backup.create': async (target) => createBackup(target),
  'update.check': async () => checkForUpdate(),
  'update.canInstall': async () => canInstallUpdate(),
  'update.install': async () =>
    downloadAndInstallUpdate((fortschritt) => sendToOperator(IPC.updateProgress, fortschritt)),

  /* ------------------------------------------------------------ Projektion */
  'projection.state': async (stage) => getProjectionState(bezugsbuehne(stage)),
  'projection.buehnen': async () => listBuehnen(),
  'projection.saveBuehnen': async (buehnen) => {
    requirePermission('system.manage')
    const vorher = listBuehnen()
    const gespeichert = saveBuehnen(buehnen)
    /* Eine abgebaute Bühne darf kein Fenster zurücklassen. */
    for (const alt of vorher) {
      if (!gespeichert.some((stage) => stage.id === alt.id)) closeAudienceWindow(alt.id)
    }
    appendAudit({ action: 'projection.stages_saved', newValue: { anzahl: gespeichert.length } })
    return gespeichert
  },
  'projection.setMode': async (input, stage) => {
    requirePermission('round.manage')
    return aufBuehnen(stage, (buehne) => setProjection(buehne, input))
  },
  'projection.setCandidatePage': async (page, stage) =>
    aufBuehnen(stage, (buehne) => setCandidatePage(buehne, page)),
  'projection.setCandidatePageInterval': async (seconds, stage) =>
    aufBuehnen(stage, (buehne) => setCandidatePageInterval(buehne, seconds)),
  'projection.setSpeakerPaused': async (paused, stage) =>
    aufBuehnen(stage, (buehne) => setSpeakerPaused(buehne, paused)),
  'projection.addSpeakerSeconds': async (seconds, stage) =>
    aufBuehnen(stage, (buehne) => addSpeakerSeconds(buehne, seconds)),
  'projection.nextSpeaker': async (stage) => aufBuehnen(stage, (buehne) => nextSpeaker(buehne)),

  'projection.endSpeaker': async (stage) => aufBuehnen(stage, (buehne) => endeVorstellung(buehne)),
  /* --------------------------------------------------------- Präsentationen */
  'presentation.list': async () => listPresentations(),
  'presentation.import': async () => {
    requirePermission('round.manage')
    const auswahl = await dialog.showOpenDialog({
      title: 'Präsentation einspeisen',
      buttonLabel: 'Einspeisen',
      properties: ['openFile'],
      filters: [
        { name: 'Präsentation', extensions: ['html', 'htm', 'pdf'] },
        { name: 'HTML-Foliensatz', extensions: ['html', 'htm'] },
        { name: 'PDF (z. B. aus PowerPoint)', extensions: ['pdf'] }
      ]
    })
    const pfad = auswahl.canceled ? undefined : auswahl.filePaths[0]
    return pfad ? importPresentation(pfad) : null
  },
  'presentation.rename': async ({ id, title }) => {
    requirePermission('round.manage')
    return renamePresentation(id, title)
  },
  'presentation.delete': async (id) => {
    requirePermission('round.manage')
    deletePresentation(id)
  },
  /*
   * Blättern braucht **kein** 'round.manage'.
   *
   * Wer vorträgt, ist nicht zwangsläufig die Person, die Wahlgänge führt —
   * und ein Vortrag, der mitten im Satz stehen bleibt, weil die Rechte
   * fehlen, hilft niemandem. Geändert wird dabei nichts, was zählt: eine
   * Foliennummer im Projektionszustand.
   */
  'presentation.setSlide': async (slide, stage) => setPresentationSlide(bezugsbuehne(stage), slide),
  'presentation.report': async ({ slide, slideCount, stage }) =>
    reportPresentationState(bezugsbuehne(stage), slide, slideCount),
  /* -------------------------------------------------------------- Videos */
  /*
   * Die Steuerung ist vom Bild getrennt.
   *
   * Eine Kamera kann ein Bild liefern, ohne steuerbar zu sein, und umgekehrt.
   * Wer beides in einen Aufruf legte, könnte das eine ohne das andere nicht
   * mehr einrichten.
   */
  'ptz.liste': async () => getPtzKameras(),
  'ptz.speichern': async (kameras) => {
    requirePermission('system.manage')
    return savePtzKameras(kameras)
  },
  'ptz.erkennen': async (eingabe) => ptzErkennen(eingabe.host, eingabe.port),
  'ptz.position': async (eingabe) => ptzPositionAbrufen(eingabe.id, eingabe.nummer),
  'ptz.positionSpeichern': async (eingabe) => ptzPositionSpeichern(eingabe.id, eingabe.nummer),
  'ptz.stellungLesen': async (id) => ptzStellungLesen(id),
  'ptz.schwenken': async (eingabe) => ptzSchwenken(eingabe.id, eingabe.x, eingabe.y, eingabe.tempo),
  'ptz.halt': async (id) => ptzHalt(id),
  'ptz.zoom': async (eingabe) => ptzZoomen(eingabe.id, eingabe.richtung, eingabe.tempo),
  'ptz.heim': async (id) => ptzHeim(id),
  'ptz.scharfstellen': async (id) => ptzScharfstellen(id),
  'kamera.stand': async () => kameraStand(),
  'kamera.suche': async (an) => {
    requirePermission('round.manage')
    return sucheKameras(an)
  },
  'kamera.setBauchbinde': async (an, stage) => {
    requirePermission('round.manage')
    return aufBuehnen(stage, (buehne) => setKameraBauchbinde(buehne, an))
  },
  'kamera.setNaechste': async (an, stage) => {
    requirePermission('round.manage')
    return aufBuehnen(stage, (buehne) => setKameraNaechste(buehne, an))
  },
  'kamera.setSpiegeln': async (an, stage) => {
    requirePermission('round.manage')
    return aufBuehnen(stage, (buehne) => setKameraSpiegeln(buehne, an))
  },
  'untertitel.setAn': async (an, stage) => {
    requirePermission('round.manage')
    const zustand = aufBuehnen(stage, (buehne) => setUntertitel(buehne, an))
    /*
     * Das Zuhören hängt am Schalter, nicht am Fenster.
     *
     * Gebraucht wird es, sobald **irgendeine** Bühne Untertitel zeigt, und
     * nicht mehr, sobald es keine mehr tut. Das Fenster dafür auf- und
     * zuzumachen ist die ehrlichere Form als eines, das immer läuft und
     * manchmal nichts sendet: Solange niemand mitliest, hat dieses Programm
     * kein offenes Mikrofon.
     */
    if (untertitelIrgendwo()) openZuhoererWindow()
    else closeZuhoererWindow()
    return zustand
  },
  /*
   * Kein `requirePermission` und keine Rückgabe.
   *
   * Der Weg wird viermal je Sekunde benutzt, solange jemand spricht. Eine
   * Rechteprüfung je Silbe brächte nichts hinzu: Eingeschaltet hat die
   * Untertitel bereits jemand mit `round.manage`, und ohne diesen Schalter
   * landet der Text nirgends — `meldeUntertitel` schreibt nur auf Bühnen, die
   * ihn zeigen sollen.
   */
  'untertitel.melde': async (stand) => {
    meldeUntertitel(stand)
  },
  'video.list': async () => listVideos(),
  'video.import': async () => {
    requirePermission('round.manage')
    const auswahl = await dialog.showOpenDialog({
      title: 'Video einspeisen',
      buttonLabel: 'Einspeisen',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm'] }]
    })
    const pfad = auswahl.canceled ? undefined : auswahl.filePaths[0]
    return pfad ? importVideo(pfad) : null
  },
  'video.rename': async ({ id, title }) => {
    requirePermission('round.manage')
    return renameVideo(id, title)
  },
  'video.delete': async (id) => {
    requirePermission('round.manage')
    deleteVideo(id)
  },
  /*
   * Start, Pause und Sprung brauchen **kein** 'round.manage' — wie beim
   * Blättern: Wer den Film zeigt, ist nicht zwangsläufig die Person, die
   * Wahlgänge führt.
   */
  'video.setPlaying': async (playing, stage) =>
    aufBuehnen(stage, (buehne) => setVideoPlaying(buehne, playing)),
  'video.seek': async (seconds, stage) => aufBuehnen(stage, (buehne) => seekVideo(buehne, seconds)),
  'video.setMuted': async (muted, stage) => aufBuehnen(stage, (buehne) => setVideoMuted(buehne, muted)),
  'video.setSchleife': async (schleife, stage) =>
    aufBuehnen(stage, (buehne) => setVideoSchleife(buehne, schleife)),
  'video.reportDuration': async (seconds, stage) => reportVideoDuration(bezugsbuehne(stage), seconds),
  'video.reportReady': async (stage) => reportVideoReady(bezugsbuehne(stage)),
  'video.reportEnded': async (stage) => videoEnded(bezugsbuehne(stage)),

  /* -------------------------------------------------------- Teleprompter */
  'speech.list': async () => listSpeeches(),
  'speech.get': async (id) => getSpeech(id) ?? null,
  'speech.import': async () => {
    requirePermission('round.manage')
    const auswahl = await dialog.showOpenDialog({
      title: 'Rede einspeisen',
      buttonLabel: 'Einspeisen',
      properties: ['openFile'],
      filters: [{ name: 'Rede (Markdown)', extensions: ['md', 'markdown', 'txt'] }]
    })
    const pfad = auswahl.canceled ? undefined : auswahl.filePaths[0]
    return pfad ? importSpeech(pfad) : null
  },
  'speech.create': async (title) => {
    requirePermission('round.manage')
    return createSpeech(title)
  },
  'speech.save': async ({ id, markdown }) => {
    requirePermission('round.manage')
    const eintrag = saveSpeech(id, markdown)
    /* Liegt die Rede gerade auf dem Prompter, bekommt er den neuen Text —
       ohne an den Anfang zu springen. */
    refreshSpeech(id)
    return eintrag
  },
  'speech.rename': async ({ id, title }) => {
    requirePermission('round.manage')
    return renameSpeech(id, title)
  },
  'speech.assign': async ({ id, candidateId, candidateName }) => {
    requirePermission('round.manage')
    return assignSpeech(id, candidateId, candidateName)
  },
  'speech.delete': async (id) => {
    requirePermission('round.manage')
    deleteSpeech(id)
  },

  'prompter.view': async () => getPrompterView(),
  'prompter.load': async (id) => {
    requirePermission('round.manage')
    return loadSpeech(id)
  },
  'prompter.setRunning': async (running) => setPrompterRunning(running),
  'prompter.setPosition': async (position) => setPrompterPosition(position),
  'prompter.nudge': async (zeilen) => nudgePrompter(zeilen),
  'prompter.setTempo': async (tempo) => setPrompterTempo(tempo),
  'prompter.setDarstellung': async (aenderung) => setPrompterDarstellung(aenderung),
  'prompter.setUntil': async (until) => setPrompterUntil(until),
  'prompter.setAnsicht': async (ansicht) => setPrompterAnsicht(ansicht),
  'prompter.folgtDemAufruf': async (folgt) => setPrompterFolgtDemAufruf(folgt),
  'prompter.setLaufart': async (laufart) => setPrompterLaufart(laufart),
  'prompter.openWindow': async () => {
    requirePermission('round.manage')
    return openTeleprompterWindow()
  },
  'prompter.closeWindow': async () => closeTeleprompterWindow(),
  'prompter.windowState': async () => teleprompterState(),

  'speechmodel.info': async () => sprachmodellInfo(),
  'speechmodel.install': async () => {
    requirePermission('system.manage')
    const auswahl = await dialog.showOpenDialog({
      title: 'Sprachmodell hinterlegen',
      buttonLabel: 'Hinterlegen',
      properties: ['openFile'],
      filters: [{ name: 'Modellarchiv', extensions: ['zip', 'gz', 'tgz'] }]
    })
    if (auswahl.canceled || !auswahl.filePaths[0]) return sprachmodellInfo()
    return sprachmodellEinlegen(auswahl.filePaths[0])
  },
  'speechmodel.download': async (datei) => {
    requirePermission('system.manage')
    return sprachmodellLaden(datei, (stand) => sendToOperator(IPC.speechmodelProgress, stand))
  },
  'speechmodel.remove': async () => {
    requirePermission('system.manage')
    return sprachmodellEntfernen()
  },

  'presentation.prompterState': async () => prompterState(),
  'presentation.prompterBuehne': async (stage) =>
    stage === undefined ? getPrompterBuehne() : setPrompterBuehne(stage),
  'presentation.openPrompter': async () => {
    requirePermission('round.manage')
    return openPrompterWindow()
  },
  'presentation.closePrompter': async () => closePrompterWindow(),
  'projection.setLocked': async (locked, stage) => aufBuehnen(stage, (buehne) => setLocked(buehne, locked)),
  'projection.history': async () => projectionHistory(),
  'projection.displays': async (stage) => listDisplays(bezugsbuehne(stage)),
  'projection.audienceState': async (stage) => audienceState(bezugsbuehne(stage)),
  'projection.openAudience': async (displayId, stage) => {
    requirePermission('round.manage')
    return aufBuehnen(stage, (buehne) => openAudienceWindow(displayId, buehne))
  },
  'projection.closeAudience': async (stage) => aufBuehnen(stage, (buehne) => closeAudienceWindow(buehne)),
  /* ------------------------------------------------ Saalnetz und Zertifikat */

  /**
   * Ein echtes Zertifikat beantragen — der Weg aus der Zertifikatswarnung.
   *
   * Schritt 1 stellt den Auftrag und nennt den Wert für das
   * Domain-Namensystem. Danach ist ein Mensch an der Reihe; erst wenn der
   * Eintrag steht **und übernommen ist**, folgt Schritt 2. Zu früh gefragt
   * zählt bei der Prüfstelle als Fehlversuch, und davon erlaubt sie wenige.
   */
  'cert.acmeBeginnen': async (input) => {
    requirePermission('system.manage')
    return auftragBeginnen({
      domain: input.domain,
      email: input.email,
      ordner: join(app.getPath('userData'), 'netz'),
      verzeichnisUrl: input.uebung ? ACME_UEBUNG : ACME_ECHT
    })
  },

  'cert.acmeAbschliessen': async (faden) => {
    requirePermission('system.manage')
    const ordner = join(app.getPath('userData'), 'netz')
    const { cert, key } = await auftragAbschliessen(faden)
    const angaben = eigenesZertifikatAblegen(ordner, cert, key)
    saveEigenesZertifikat(angaben)
    appendAudit({
      action: 'cert.issued',
      newValue: { domain: angaben.domain, laeuftAbAm: angaben.laeuftAbAm }
    })
    await netzNeu()
    return angaben
  },

  'cert.ausDateien': async (input) => {
    requirePermission('system.manage')
    const ordner = join(app.getPath('userData'), 'netz')
    const angaben = eigenesZertifikatAblegen(
      ordner,
      readFileSync(input.certPfad, 'utf8'),
      readFileSync(input.keyPfad, 'utf8')
    )
    saveEigenesZertifikat(angaben)
    appendAudit({ action: 'cert.imported', newValue: { domain: angaben.domain } })
    await netzNeu()
    return angaben
  },

  'cert.entfernen': async () => {
    requirePermission('system.manage')
    eigenesZertifikatEntfernen(join(app.getPath('userData'), 'netz'))
    saveEigenesZertifikat(undefined)
    appendAudit({ action: 'cert.removed' })
    await netzNeu()
  },

  'system.netzwerkkarten': async () => netzwerkkarten(),

  'saalnetz.get': async () => saalnetzStatus(),

  'saalnetz.set': async (config) => {
    requirePermission('system.manage')
    const gespeichert = saveSaalnetz(config)
    let fehler: string | undefined

    /*
     * Jeder Dienst für sich: Scheitert die Adressvergabe — etwa weil in
     * diesem Netz schon jemand verteilt —, soll der Namensdienst trotzdem
     * laufen. Beides zusammen abzubrechen hieße, wegen des riskanteren Teils
     * auch den harmlosen zu verlieren.
     */
    try {
      if (gespeichert.dns) {
        const gebunden = getNetworkProjection().bindAddress
        await starteDns({
          name: getEigenesZertifikat()?.domain ?? '',
          adresse: saaladresse(gebunden),
          /* An dieselbe Karte gebunden wie der Rest: Ein Namensdienst, der
             auch im Büronetz antwortet, wurde nicht bestellt. */
          bindAddress: gebunden === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
          weiterleitung: gespeichert.dnsWeiterleitung || undefined
        })
      } else {
        await stoppeDns()
      }
    } catch (grund) {
      fehler = grund instanceof Error ? grund.message : String(grund)
    }

    try {
      if (gespeichert.dhcp) {
        await starteDhcp({
          von: gespeichert.dhcpVon,
          bis: gespeichert.dhcpBis,
          maske: gespeichert.dhcpMaske,
          eigene: saaladresse(getNetworkProjection().bindAddress),
          router: gespeichert.dhcpRouter || undefined,
          laufzeit: gespeichert.dhcpLaufzeit
        })
      } else {
        await stoppeDhcp()
      }
    } catch (grund) {
      const text = grund instanceof Error ? grund.message : String(grund)
      fehler = fehler ? `${fehler}\n${text}` : text
    }

    appendAudit({
      action: 'saalnetz.changed',
      newValue: { dns: gespeichert.dns, dhcp: gespeichert.dhcp, router: gespeichert.dhcpRouter || null }
    })
    return { ...saalnetzStatus(), fehler }
  },

  'projection.network': async () => {
    const settings = getSettings()
    return ohneGeheimnis({ ...settings.networkProjection, ...networkStatus() })
  },
  'projection.setNetwork': async (config) => {
    requirePermission('system.manage')
    const saved = saveNetworkProjection(config)
    /* Der Prompter führt die Freigabe mit, damit die Netzansicht ihre Leiste
       zeigen oder weglassen kann. Durchgesetzt wird sie am Server. */
    setPrompterNetzBedienung(saved.enabled && saved.allowPrompterControl)
    const status = saved.enabled
      ? await startNetworkProjection(saved)
      : (await stopNetworkProjection(), networkStatus())
    /* Der Suchruf hängt an der Netzwerkansicht: Ohne sie gibt es nichts
       anzuzeigen, und ein Rechner, der still sein soll, antwortet auch nicht. */
    if (saved.enabled && status.running) await starteSuchruf(suchrufQuelle())
    else await stoppeSuchruf()
    appendAudit({
      action: saved.enabled ? 'projection.network_enabled' : 'projection.network_disabled',
      newValue: { port: saved.port, adresse: saved.bindAddress, tokenGesetzt: Boolean(saved.token) }
    })
    return { ...saved, ...status }
  },
  'projection.demo': async (enabled, stage) => aufBuehnen(stage, (buehne) => setDemoMode(buehne, enabled)),
  'projection.theme': async () => getProjectionTheme(),
  'projection.setTheme': async (theme) => {
    requirePermission('system.manage')
    const saved = saveProjectionTheme(theme)
    refreshTheme()
    appendAudit({
      action: 'projection.theme_changed',
      newValue: { logo: Boolean(saved.logo), logoPosition: saved.logoPosition, hintergrund: saved.background }
    })
    return saved
  }
}

/**
 * Führt eine API-Methode aus. Wird sowohl vom IPC-Kanal des Hauptfensters als
 * auch vom Fernzugriff genutzt — die Rechteprüfung liegt in den Diensten und
 * gilt damit für beide Wege gleichermaßen.
 */
export async function callApi(method: string, args: unknown[]): Promise<unknown> {
  const handler = Object.prototype.hasOwnProperty.call(api, method)
    ? (api[method as ApiMethod] as (...params: unknown[]) => Promise<unknown>)
    : undefined
  if (!handler) throw new Error(`Unbekannte Funktion "${method}".`)
  return handler(...(args ?? []))
}

export function registerIpc(): void {
  ipcMain.handle(IPC.api, async (_event, method: ApiMethod, args: unknown[]) => {
    try {
      const data = await callApi(method, args)
      return { ok: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`IPC ${String(method)}: ${message}`)
      return { ok: false, error: message }
    }
  })

  // Rein lesender Kanal für die Beameransicht (§31: keine Schreib-API).
  ipcMain.handle(
    IPC.audienceGetState,
    async (_event, stage?: number) => getProjectionState(stage ?? HAUPTBUEHNE) ?? EMPTY_PROJECTION_STATE
  )

  /*
   * Der Prompter blättert über `send`, nicht über `invoke`.
   *
   * Er will keine Antwort: Was aus dem Tastendruck wird, erfährt er wie alle
   * anderen über den Projektionszustand. Ein Rückgabewert wäre eine zweite
   * Quelle für dieselbe Wahrheit — und zwei Quellen laufen irgendwann
   * auseinander.
   */
  ipcMain.on(IPC.prompterCommand, (_event, input: { slide?: number; stage?: Buehnenwahl }) => {
    /* Ohne Folie ist es keine Anweisung zum Blättern, sondern die Ansage,
       welche Bühne dieses Fenster bedient. */
    if (input?.stage !== undefined && typeof input?.slide !== 'number') {
      setPrompterBuehne(bezugsbuehne(input.stage))
      return
    }
    /*
     * Geblättert wird auf allen genannten Bühnen.
     *
     * Läuft derselbe Foliensatz auf zwei Wänden, muss ein Tastendruck beide
     * weiterschalten — sonst stehen sie nach der ersten Folie auseinander.
     */
    if (typeof input?.slide === 'number') {
      const folie = input.slide
      aufBuehnen(input.stage, (buehne) => setPresentationSlide(buehne, folie))
    }
  })

  /* Alle Bühnen auf einmal — die Vortragssteuerung sucht sich die mit dem
     laufenden Foliensatz. */
  ipcMain.handle(IPC.stagesSnapshot, async () => {
    const stages = listBuehnen()
    return {
      buehnen: stages,
      zustaende: Object.fromEntries(stages.map((stage) => [stage.id, getProjectionState(stage.id)]))
    }
  })

  /*
   * Was der Foliensatz über sich meldet, kommt über den Prompter herein.
   *
   * Die Beameransicht koennte es nicht: Sie ist rein lesend und hat keinen
   * Rueckweg (Beamer §31). Ohne diese Zeile bliebe die Gesamtzahl unbekannt —
   * die Steuerung zaehlte dann ueber das Ende des Vortrags hinaus weiter.
   */
  /*
   * Was die Beameransicht über das laufende Video weiß.
   *
   * Das Fenster bleibt damit „rein lesend" im Sinne von §31: Es verändert
   * keine Wahldaten, sondern sagt etwas über sich selbst aus. Die Laufzeit
   * steckt im Containerformat und lässt sich nur dort ablesen, wo die Datei
   * geladen wurde.
   */
  ipcMain.on(
    IPC.audienceVideoReport,
    (_event, input: { durationSeconds?: number; ready?: boolean; ended?: boolean; stage?: number }) => {
      const buehne = input?.stage ?? HAUPTBUEHNE
      if (typeof input?.durationSeconds === 'number') reportVideoDuration(buehne, input.durationSeconds)
      if (input?.ready === true) reportVideoReady(buehne)
      if (input?.ended === true) videoEnded(buehne)
    }
  )

  /*
   * Ein Fenster bittet um ein Kamerabild.
   *
   * Es fragt selbst, und zwar erst, wenn es eine Kamera im Zustand sieht.
   * Der Hauptprozess entscheidet nicht, wer ein Bild braucht: Ein Beamer, der
   * ausgeschaltet im Nebenraum steht, soll keine Verbindung zur Kamera halten.
   */
  ipcMain.on(IPC.kameraAn, (event, input: { quelle?: string; qualitaet?: KameraQualitaet; kanal?: string }) => {
    const quelle = input?.quelle?.trim()
    if (!quelle) return
    kameraAnschliessen(
      event.sender,
      quelle,
      input?.qualitaet === 'vorschau' ? 'vorschau' : 'hoch',
      input?.kanal ?? 'bild'
    )
  })

  ipcMain.on(IPC.kameraAus, (event, input: { kanal?: string }) => {
    kameraLoesen(event.sender, input?.kanal ?? 'bild')
  })

  /* Gefundene Kameras und Störungen wandern von selbst in die Bedienung —
     eine Kamera, die eingesteckt wird, soll in der Liste erscheinen, ohne
     dass jemand sie sucht. */
  onKameraStand((stand) => sendToOperator(IPC.kameraStand, stand))

  ipcMain.on(
    IPC.prompterReport,
    (_event, input: { slide?: number; slideCount?: number; stage?: Buehnenwahl }) => {
      if (typeof input?.slide !== 'number' || typeof input?.slideCount !== 'number') return
      const { slide, slideCount } = input
      aufBuehnen(input.stage, (buehne) => reportPresentationState(buehne, slide, slideCount))
    }
  )
}

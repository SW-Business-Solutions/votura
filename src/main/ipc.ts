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
import { IPC, type Api, type ApiMethod } from '@shared/ipc'
import { ALLE_BUEHNEN, EMPTY_PROJECTION_STATE, HAUPTBUEHNE, type Buehnenwahl } from '@shared/projection'
import { db } from './db'
import { appPaths } from './paths'
import { logger } from './logger'
import {
  getPrompterView,
  loadSpeech,
  nudgePrompter,
  refreshSpeech,
  setPrompterAnsicht,
  setPrompterDarstellung,
  setPrompterLaufart,
  setPrompterNetzBedienung,
  setPrompterPosition,
  setPrompterRunning,
  setPrompterTempo,
  setPrompterUntil
} from './services/prompter'
import { sprachmodellEinlegen, sprachmodellEntfernen, sprachmodellInfo } from './services/sprachmodell'
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
  reorderCandidates,
  updateCandidate,
  withdrawCandidate
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
import { confirmResult, emergencyReopen, getResult, reopenResult, saveResult } from './services/results'
import {
  getConfig,
  getNetworkProjection,
  getProjectionTheme,
  getSettings,
  saveConfig,
  saveNetworkProjection,
  savePrinters,
  saveProjectionTheme
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
  sendToOperator
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
    prompterBedienung: () => getNetworkProjection().allowPrompterControl
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

  'system.settings': async () => getSettings(),
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

  'agenda.list': async (eventId) => listAgenda(eventId),
  'agenda.add': async (input) => addAgendaItem(input),
  'agenda.update': async (input) => updateAgendaItem(input),
  'agenda.reorder': async (input) => reorderAgenda(input.eventId, input.orderedIds),
  'agenda.remove': async (id) => removeAgendaItem(id),

  /* ------------------------------------------------------------ Kandidaten */
  'candidate.add': async (input) => addCandidates(input.roundId, input.candidates),
  'candidate.update': async (input) => updateCandidate(input),
  'candidate.withdraw': async (input) => withdrawCandidate(input.id, input.reason),
  'candidate.reorder': async (input) => reorderCandidates(input.roundId, input.orderedIds),
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
  'result.get': async (roundId) => getResult(roundId),
  'result.save': async (input) => saveResult(input),
  'result.confirm': async (input) => {
    const result = confirmResult(input.roundId, input.pin)
    projectDomainEvent('ResultConfirmed', input.roundId)
    return result
  },
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
  'projection.network': async () => {
    const settings = getSettings()
    return { ...settings.networkProjection, ...networkStatus() }
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

  ipcMain.on(
    IPC.prompterReport,
    (_event, input: { slide?: number; slideCount?: number; stage?: Buehnenwahl }) => {
      if (typeof input?.slide !== 'number' || typeof input?.slideCount !== 'number') return
      const { slide, slideCount } = input
      aufBuehnen(input.stage, (buehne) => reportPresentationState(buehne, slide, slideCount))
    }
  )
}

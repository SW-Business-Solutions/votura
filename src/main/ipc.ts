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
import { EMPTY_PROJECTION_STATE } from '@shared/projection'
import { db } from './db'
import { appPaths } from './paths'
import { logger } from './logger'
import {
  networkStatus,
  startNetworkProjection,
  stopNetworkProjection
} from './network-projection'
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
  resumePrint,
  startPrint,
  testPrinter
} from './services/printing'
import {
  getProjectionState,
  history as projectionHistory,
  refreshEventInfo,
  refreshTheme,
  setCandidatePage,
  setDemoMode,
  setLocked,
  setProjection,
  projectDomainEvent
} from './services/projection'
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
import { confirmResult, emergencyReopen, getResult, reopenResult, saveResult } from './services/results'
import {
  getProjectionTheme,
  getSettings,
  saveConfig,
  saveNetworkProjection,
  savePrinters,
  saveProjectionTheme
} from './services/settings'
import { exportEventArchive, exportProtocol, exportRound } from './export'
import {
  audienceState,
  closeAudienceWindow,
  getOperatorWindow,
  listDisplays,
  openAudienceWindow
} from './windows'

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
  'export.round': async (input) => exportRound(input.roundId, input.formats),
  'export.event': async (eventId) => exportEventArchive(eventId),
  'export.protocol': async (roundId) => exportProtocol(roundId),
  'backup.create': async (target) => createBackup(target),

  /* ------------------------------------------------------------ Projektion */
  'projection.state': async () => getProjectionState(),
  'projection.setMode': async (input) => {
    requirePermission('round.manage')
    return setProjection(input)
  },
  'projection.setCandidatePage': async (page) => setCandidatePage(page),
  'projection.setLocked': async (locked) => setLocked(locked),
  'projection.history': async () => projectionHistory(),
  'projection.displays': async () => listDisplays(),
  'projection.audienceState': async () => audienceState(),
  'projection.openAudience': async (displayId) => {
    requirePermission('round.manage')
    return openAudienceWindow(displayId)
  },
  'projection.closeAudience': async () => closeAudienceWindow(),
  'projection.network': async () => {
    const settings = getSettings()
    return { ...settings.networkProjection, ...networkStatus() }
  },
  'projection.setNetwork': async (config) => {
    requirePermission('system.manage')
    const saved = saveNetworkProjection(config)
    const status = saved.enabled ? await startNetworkProjection(saved) : (await stopNetworkProjection(), networkStatus())
    appendAudit({
      action: saved.enabled ? 'projection.network_enabled' : 'projection.network_disabled',
      newValue: { port: saved.port, adresse: saved.bindAddress, tokenGesetzt: Boolean(saved.token) }
    })
    return { ...saved, ...status }
  },
  'projection.demo': async (enabled) => setDemoMode(enabled),
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
  ipcMain.handle(IPC.audienceGetState, async () => getProjectionState() ?? EMPTY_PROJECTION_STATE)
}

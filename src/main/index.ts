import { app, BrowserWindow, dialog, Menu, session } from 'electron'
import { IPC } from '@shared/ipc'
import { initDatabase, closeDatabase } from './db'
import { callApi, registerIpc } from './ipc'
import { initLogger, logger } from './logger'
import { checkOnStartIfEnabled } from './services/updates'
import {
  broadcastProjection,
  networkStatus,
  setRemoteDispatcher,
  startNetworkProjection,
  stopNetworkProjection
} from './network-projection'
import { appPaths } from './paths'
import { onSessionChanged } from './services/auth'
import { markInterruptedBatches, onPrintProgress } from './services/printing'
import { onProjectionChanged, restoreProjection } from './services/projection'
import { getNetworkProjection } from './services/settings'
import {
  createOperatorWindow,
  getOperatorWindow,
  onAudienceStateChanged,
  sendToAudience,
  sendToOperator,
  watchDisplays
} from './windows'

// Nur eine Instanz: zwei parallele Prozesse auf derselben Datenbank wären
// während einer Versammlung ein unnötiges Risiko.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  const window = getOperatorWindow()
  if (window) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
})

function hardenSecurity(): void {
  // Keine Navigation aus der Anwendung heraus, kein Fernladen von Inhalten (§2.2).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const allowed = process.env.ELECTRON_RENDERER_URL
      if (!allowed || !url.startsWith(allowed)) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  // Strenge CSP: alles aus dem Paket, nichts aus dem Netz.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
    const policy = isDev
      ? "default-src 'self' 'unsafe-inline' data: blob: ws: http://localhost:*; img-src 'self' data:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

async function bootstrap(): Promise<void> {
  const paths = appPaths()
  initLogger(paths.logs)
  logger.info(`Anwendung startet (Version ${app.getVersion()}, Electron ${process.versions.electron})`)

  try {
    initDatabase(paths.database)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Datenbank konnte nicht geöffnet werden', message)
    app.exit(1)
    return
  }

  // Nach einem Absturz: unklare Druckaufträge markieren, nie fortsetzen (§35).
  const interrupted = markInterruptedBatches()
  if (interrupted > 0) {
    logger.warn(`${interrupted} Druckauftrag/-aufträge waren unterbrochen und wurden als unklar markiert.`)
  }

  restoreProjection()
  registerIpc()
  // Der Fernzugriff nutzt dieselbe API wie das Hauptfenster.
  setRemoteDispatcher((method, args) => callApi(method, args))
  watchDisplays()

  onPrintProgress((progress) => sendToOperator(IPC.printProgress, progress))
  onProjectionChanged((state) => {
    sendToOperator(IPC.projectionState, state)
    sendToAudience(IPC.projectionState, state)
    broadcastProjection(state)
  })
  onAudienceStateChanged((state) => sendToOperator(IPC.audienceState, state))
  onSessionChanged((currentSession) => sendToOperator(IPC.sessionChanged, currentSession))

  const network = getNetworkProjection()
  if (network.enabled) {
    const status = await startNetworkProjection(network)
    if (!status.running) {
      sendToOperator(IPC.notice, {
        level: 'warning',
        message: `Netzwerk-Beameransicht konnte nicht gestartet werden: ${status.error ?? 'unbekannter Fehler'}`
      })
    }
  }

  Menu.setApplicationMenu(null)
  createOperatorWindow()

  /*
   * Hinweis auf eine neue Fassung — nur wenn ausdrücklich eingeschaltet, und
   * nur als Meldung. Es wird nichts geladen und nichts installiert; ein
   * Fehlschlag bleibt ohne Folgen, damit der Betrieb ohne Netz normal läuft.
   */
  void checkOnStartIfEnabled()
    .then((ergebnis) => {
      if (!ergebnis?.updateAvailable) return
      sendToOperator(IPC.notice, {
        level: 'info',
        message: `Version ${ergebnis.latestVersion} ist verfügbar (installiert: ${ergebnis.installedVersion}). Ein Wechsel während einer laufenden Versammlung ist nicht ratsam.`
      })
    })
    .catch(() => undefined)
}

app.whenReady().then(async () => {
  hardenSecurity()
  await bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOperatorWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  logger.info('Anwendung wird beendet.')
})

app.on('will-quit', async (event) => {
  event.preventDefault()
  await stopNetworkProjection()
  closeDatabase()
  logger.info(`Netzwerkstatus beim Beenden: ${JSON.stringify(networkStatus())}`)
  app.exit(0)
})

process.on('uncaughtException', (error) => {
  logger.error(`Unbehandelter Fehler: ${error.stack ?? error.message}`)
  dialog.showErrorBox(
    'Unerwarteter Fehler',
    `${error.message}\n\nDie Daten sind gespeichert. Bitte prüfen Sie laufende Druckaufträge physisch, bevor Sie fortfahren.`
  )
})

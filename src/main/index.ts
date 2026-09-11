import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { PRESENTATION_SCHEME } from '@shared/presentation'
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
import { presentationFile } from './services/presentations'
import { getProjectionState } from './services/projection'
import { onSessionChanged } from './services/auth'
import { markInterruptedBatches, onPrintProgress } from './services/printing'
import { onProjectionChanged, restoreProjection } from './services/projection'
import { getNetworkProjection } from './services/settings'
import {
  createOperatorWindow,
  getOperatorWindow,
  onAudienceStateChanged,
  onPrompterStateChanged,
  sendToAudience,
  sendToOperator,
  sendToPrompter,
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

/**
 * Eigenes Schema für die laufende Präsentation.
 *
 * Im Beamerfenster gibt es keinen Server — die Oberfläche kommt aus dem
 * Paket. Die eingespeiste Datei liegt aber im Datenordner, also außerhalb.
 * Ein Protokoll-Handler schlägt die Brücke, ohne `file://` zu öffnen: Er
 * liefert **nur** die Datei aus, die gerade projiziert wird, und nichts
 * sonst aus dem Dateisystem.
 *
 * `standard` und `secure`, damit Chromium den Rahmen wie eine gewöhnliche
 * Webseite behandelt — sonst verweigert er Skripte darin.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: PRESENTATION_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } }
])

function registerPresentationProtocol(): void {
  protocol.handle(PRESENTATION_SCHEME, async () => {
    const laufend = getProjectionState().presentation
    if (!laufend) return new Response('Gerade läuft keine Präsentation.', { status: 404 })
    const datei = presentationFile(laufend.id)
    if (!existsSync(datei)) return new Response('Die Datei fehlt.', { status: 404 })
    return new Response(await readFile(datei), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    })
  })
}

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
    /*
     * Die eingespeiste Präsentation bekommt ihre **eigene** Richtlinie.
     *
     * Die strenge Regel der Anwendung verbietet Inline-Skripte — und genau
     * daraus besteht eine Präsentation als Einzeldatei: Schrift, Bild und
     * Steuerung stecken als `data:` und `<script>` darin. Mit der
     * Anwendungsregel bliebe sie auf Folie eins stehen.
     *
     * Erlaubt wird deshalb, was sie mitbringt, und sonst nichts. Vor allem
     * fehlt `connect-src` — sie kann nichts nachladen und nichts melden. Das
     * ist strenger als jeder Browser und passt zu §2.2: vollständig offline.
     */
    if (details.url.startsWith(`${PRESENTATION_SCHEME}:`)) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; " +
              "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; " +
              "media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"
          ]
        }
      })
      return
    }

    const policy = isDev
      ? "default-src 'self' 'unsafe-inline' data: blob: ws: http://localhost:*; img-src 'self' data:; frame-src " + PRESENTATION_SCHEME + ":"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src " + PRESENTATION_SCHEME + ":"
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
  registerPresentationProtocol()
  registerIpc()
  // Der Fernzugriff nutzt dieselbe API wie das Hauptfenster.
  setRemoteDispatcher((method, args) => callApi(method, args))
  watchDisplays()

  onPrintProgress((progress) => sendToOperator(IPC.printProgress, progress))
  onProjectionChanged((state) => {
    sendToOperator(IPC.projectionState, state)
    sendToAudience(IPC.projectionState, state)
    sendToPrompter(IPC.projectionState, state)
    broadcastProjection(state)
  })
  onAudienceStateChanged((state) => sendToOperator(IPC.audienceState, state))
  onPrompterStateChanged((state) => sendToOperator(IPC.prompterState, state))
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

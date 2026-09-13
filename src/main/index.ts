import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { PRESENTATION_SCHEME, presentationKind } from '@shared/presentation'
import { VIDEO_SCHEME } from '@shared/video'
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
import { getPresentation, presentationFileFor } from './services/presentations'
import { getVideo, videoFileFor } from './services/videos'
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
  /*
   * `corsEnabled` und `supportFetchAPI` sind für das PDF nötig: pdf.js holt das
   * Dokument per XHR, und ein eigenes Schema gilt vom `file://`-Ursprung aus
   * sonst als fremde Herkunft — Chromium bricht mit CORS ab. Für den
   * HTML-Foliensatz spielt beides keine Rolle, der wird als Rahmen geladen.
   */
  {
    scheme: PRESENTATION_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  },
  /*
   * `stream: true` ist hier das Entscheidende: Ohne dieses Recht behandelt
   * Chromium die Antwort als ein Stück und spielt das Video erst ab, wenn es
   * vollständig da ist. Ein Film von 300 MB stünde dann minutenlang schwarz.
   */
  { scheme: VIDEO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

function registerPresentationProtocol(): void {
  protocol.handle(PRESENTATION_SCHEME, async () => {
    const laufend = getProjectionState().presentation
    if (!laufend) return new Response('Gerade läuft keine Präsentation.', { status: 404 })
    const eintrag = getPresentation(laufend.id)
    if (!eintrag) return new Response('Die Datei fehlt.', { status: 404 })
    const datei = presentationFileFor(eintrag)
    if (!existsSync(datei)) return new Response('Die Datei fehlt.', { status: 404 })
    /* Ein PDF muss als PDF ausgeliefert werden — sonst versucht der Rahmen,
       Binärdaten als HTML zu lesen. */
    const typ =
      presentationKind(eintrag) === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8'
    return new Response(await readFile(datei), {
      headers: {
        'Content-Type': typ,
        'Cache-Control': 'no-store',
        /* Der Abruf kommt aus demselben Fenster; die Herkunft `file://` gilt
           Chromium aber als fremd. Ausgeliefert wird ohnehin nur die gerade
           projizierte Datei — mehr gibt dieses Schema nicht her. */
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}

/**
 * Das laufende Video im Beamerfenster.
 *
 * Mit Bereichsanfragen, damit der Browser vorauspuffert und springen kann,
 * ohne von vorn zu beginnen. Ausgeliefert wird ausschließlich die Datei, die
 * gerade projiziert wird — `file://` bleibt zu, der Rest des Dateisystems
 * unerreichbar.
 */
function registerVideoProtocol(): void {
  protocol.handle(VIDEO_SCHEME, async (request) => {
    const laufend = getProjectionState().video
    if (!laufend) return new Response('Gerade läuft kein Video.', { status: 404 })
    const eintrag = getVideo(laufend.id)
    if (!eintrag) return new Response('Die Datei fehlt.', { status: 404 })
    const datei = videoFileFor(eintrag)
    if (!existsSync(datei)) return new Response('Die Datei fehlt.', { status: 404 })

    const groesse = statSync(datei).size
    const kopf: Record<string, string> = {
      'Content-Type': eintrag.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    const bereich = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    if (!bereich) {
      return new Response(Readable.toWeb(createReadStream(datei)) as ReadableStream, {
        headers: { ...kopf, 'Content-Length': String(groesse) }
      })
    }

    const von = bereich[1] === '' ? 0 : Number(bereich[1])
    const bis = bereich[2] === '' ? groesse - 1 : Math.min(Number(bereich[2]), groesse - 1)
    if (!Number.isFinite(von) || !Number.isFinite(bis) || von > bis || von >= groesse) {
      return new Response(null, {
        status: 416,
        headers: { ...kopf, 'Content-Range': `bytes */${groesse}` }
      })
    }

    return new Response(Readable.toWeb(createReadStream(datei, { start: von, end: bis })) as ReadableStream, {
      status: 206,
      headers: {
        ...kopf,
        'Content-Range': `bytes ${von}-${bis}/${groesse}`,
        'Content-Length': String(bis - von + 1)
      }
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
      ? "default-src 'self' 'unsafe-inline' data: blob: ws: http://localhost:* " +
        PRESENTATION_SCHEME +
        ":; img-src 'self' data: blob:; frame-src " +
        PRESENTATION_SCHEME +
        ": ; media-src 'self' " +
        VIDEO_SCHEME +
        ": blob:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' " +
        PRESENTATION_SCHEME +
        ": ; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src " +
        PRESENTATION_SCHEME +
        ": ; media-src 'self' " +
        VIDEO_SCHEME +
        ": blob:"
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
    /*
     * Erst ins Protokoll, dann in den Dialog.
     *
     * Ein Fehler, den nur ein Meldungsfenster kennt, ist verloren, sobald
     * niemand davorsitzt — beim Start über eine Verknüpfung, aus einem Skript
     * oder auf einem Rechner, der gerade gesperrt ist. Genau dann braucht man
     * ihn aber.
     */
    logger.error(`Datenbank konnte nicht geöffnet werden (${paths.database}): ${message}`)
    if (error instanceof Error && error.stack) logger.error(error.stack)
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
  registerVideoProtocol()
  registerIpc()
  // Der Fernzugriff nutzt dieselbe API wie das Hauptfenster.
  setRemoteDispatcher((method, args) => callApi(method, args))
  watchDisplays()

  onPrintProgress((progress) => sendToOperator(IPC.printProgress, progress))
  onProjectionChanged((buehne, state) => {
    /*
     * Die Bühne reist mit.
     *
     * Die Bedienoberfläche hält alle Bühnen und ordnet den Zustand selbst zu;
     * Beamerfenster und Netzansichten bekommen nur, was ihre eigene Bühne
     * betrifft. Der Prompter hängt an der Bühne, die er steuert.
     */
    sendToOperator(IPC.projectionState, { buehne, state })
    sendToAudience(buehne, IPC.projectionState, { buehne, state })
    sendToPrompter(IPC.projectionState, { buehne, state })
    broadcastProjection(buehne, state)
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

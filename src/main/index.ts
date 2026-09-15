import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { PRESENTATION_SCHEME, presentationKind } from '@shared/presentation'
import { VIDEO_SCHEME } from '@shared/video'
import { PULT_SCHEME } from '@shared/speech'
import { darfMedium } from './medienrechte'
import { IPC } from '@shared/ipc'
import { initDatabase, closeDatabase } from './db'
import { callApi, registerIpc } from './ipc'
import { initLogger, logger } from './logger'
import { beendeKameras } from './services/kamera'
import { checkOnStartIfEnabled } from './services/updates'
import { onPrompterViewChanged, sprecherAufgerufen } from './services/prompter'
import { sprachmodellDatei } from './services/sprachmodell'
import { setPrompterNetzBedienung } from './services/prompter'
import { starteSuchruf, stoppeSuchruf } from './suchruf'
import { starteDhcp, stoppeDhcp } from './dhcp'
import { starteDns, stoppeDns } from './dns'
import { saaladresse } from './tls'
import { suchrufQuelle } from './ipc'
import {
  broadcastPrompter,
  broadcastProjection,
  networkStatus,
  setRemoteDispatcher,
  startNetworkProjection,
  stopNetworkProjection,
  setWahlDispatcher
} from './network-projection'
import { wahlBruecke } from './wahl-bruecke'
import { appPaths } from './paths'
import { getPresentation, presentationFileFor } from './services/presentations'
import { getVideo, videoFileFor } from './services/videos'
import { getProjectionState } from './services/projection'
import { onSessionChanged } from './services/auth'
import { markInterruptedBatches, onPrintProgress } from './services/printing'
import { onProjectionChanged, restoreProjection } from './services/projection'
import { getNetworkProjection, getEigenesZertifikat, getSaalnetz } from './services/settings'
import {
  createOperatorWindow,
  getOperatorWindow,
  getPrompterBuehne,
  onAudienceStateChanged,
  onPrompterStateChanged,
  onTeleprompterStateChanged,
  sendToTeleprompter,
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
  { scheme: VIDEO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  /*
   * Die Prompterseite braucht eine **echte Herkunft**.
   *
   * Unter `file://` verweigert Chromium Web Worker — und die Spracherkennung
   * läuft in einem. Als `standard` und `secure` angemeldet, verhält sich das
   * Schema wie eine Webseite: Worker, WebAssembly und Mikrofonzugriff sind
   * möglich, ohne dass ein Server laufen müsste.
   */
  {
    scheme: PULT_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

/**
 * Die gebaute Oberfläche unter eigenem Schema.
 *
 * Ausgeliefert wird ausschließlich der Ordner mit den gebauten Dateien; ein
 * Pfad, der aus ihm herausführt, wird abgewiesen. Damit ist dieses Schema
 * kein Fenster ins Dateisystem, sondern nur eine andere Adresse für das, was
 * ohnehin im Programm steckt.
 */
/**
 * Die Richtlinie der Prompterseite — eine Spur weiter als die der Anwendung.
 *
 * `unsafe-eval` steht hier, und nur hier. Die Spracherkennung erzeugt zur
 * Laufzeit Funktionen (`new Function`), wie es Emscripten-Anbindungen tun;
 * ohne diese Erlaubnis stirbt ihr Worker still, und am Pult stünde für immer
 * „wird geladen". Alles Übrige bleibt streng: `default-src 'self'`,
 * `connect-src` nur auf die eigene Herkunft, kein Weg ins Netz, keine fremden
 * Quellen. Und die Seite selbst kann wenig: Sie zeigt einen Text und darf
 * sieben Prompterbefehle auslösen — an Wahldaten kommt sie nicht heran.
 */
const PULT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' blob: ${PRESENTATION_SCHEME}:`,
  `frame-src ${PRESENTATION_SCHEME}:`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function registerPultProtocol(): void {
  const wurzel = resolve(join(__dirname, '../renderer'))
  const typen: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2'
  }
  protocol.handle(PULT_SCHEME, async (request) => {
    const pfad = new URL(request.url).pathname
    /*
     * Das Sprachmodell kommt nicht aus dem Oberflächenordner.
     *
     * Es liegt entweder in den Programmressourcen oder im Benutzerordner —
     * und wird als eine Datei ausgeliefert, die die Erkennung selbst
     * auspackt. Eine eigene Adresse dafür ist ehrlicher als ein Pfad, der
     * scheinbar in den Oberflächenordner zeigt.
     */
    if (pfad === '/sprachmodell') {
      const modell = sprachmodellDatei()
      if (!modell) return new Response('Kein Sprachmodell hinterlegt.', { status: 404 })
      return new Response(Readable.toWeb(createReadStream(modell.pfad)) as ReadableStream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(statSync(modell.pfad).size),
          'Cache-Control': 'no-store'
        }
      })
    }
    const datei = resolve(join(wurzel, decodeURIComponent(pfad)))
    if (!datei.startsWith(wurzel)) return new Response('Zugriff verweigert.', { status: 403 })
    if (!existsSync(datei)) return new Response('Die Datei fehlt.', { status: 404 })
    const endung = extname(datei).toLowerCase()
    return new Response(await readFile(datei), {
      headers: {
        'Content-Type': typen[endung] ?? 'application/octet-stream',
        ...(endung === '.html' ? { 'Content-Security-Policy': PULT_CSP } : {})
      }
    })
  })
}

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
    const typ = presentationKind(eintrag) === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8'
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

  /*
   * Rechte: grundsätzlich nichts — mit zwei genau umrissenen Ausnahmen.
   *
   * Welche das sind und warum, steht in `medienrechte.ts`. Dort steht es
   * prüfbar: Ein Fenster, das versehentlich ein Mikrofon bekommt, fällt
   * niemandem auf — eines, das versehentlich keines bekommt, erst im Saal.
   *
   * Gefragt wird nach der **Adresse des Fensters**, nicht nach seiner
   * Herkunft: Beim Entwickeln kommen alle Seiten vom selben Vite-Server, und
   * erst der Pfad sagt, welche davon das Pult ist.
   */
  const entwicklungsUrl = process.env.ELECTRON_RENDERER_URL

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, einzelheiten) => {
    if (permission !== 'media') {
      callback(false)
      return
    }
    const arten = (einzelheiten as { mediaTypes?: string[] }).mediaTypes ?? []
    callback(darfMedium(contents.getURL(), arten, entwicklungsUrl))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, herkunft, einzelheiten) => {
    if (permission !== 'media') return false
    const art = (einzelheiten as { mediaType?: string }).mediaType ?? 'unknown'
    /* Die Herkunft trägt keinen Pfad — beim Entwickeln sähen alle Seiten
       gleich aus. Wo es das Fenster gibt, zählt seine Adresse. */
    return darfMedium(contents?.getURL() || herkunft, [art], entwicklungsUrl)
  })

  // Strenge CSP: alles aus dem Paket, nichts aus dem Netz.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    /* Die Prompterseite bringt ihre eigene Richtlinie mit (siehe PULT_CSP) —
       hier würde sie sonst überschrieben. */
    if (details.url.startsWith(`${PULT_SCHEME}://`)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
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
      ? /*
         * Beim Entwickeln gilt dieselbe Regel auch für das Pult.
         *
         * Dort lädt die Prompterseite nicht unter ihrem eigenen Schema,
         * sondern vom Vite-Server — und fällt damit unter diese Richtlinie.
         * Ohne `wasm-unsafe-eval` verweigert Chromium der Spracherkennung die
         * Übersetzung ihres Rechenteils, und zwar ohne Fehlermeldung, die
         * irgendwo ankäme: Der Worker stirbt still, am Pult steht für immer
         * „wird geladen". Genau dieselbe Erlaubnis steht in `PULT_CSP`.
         */
        "default-src 'self' 'unsafe-inline' data: blob: ws: http://localhost:* " +
        PRESENTATION_SCHEME +
        ":; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data: " +
        "http://localhost:*; worker-src 'self' blob:; child-src 'self' blob:; " +
        "img-src 'self' data: blob:; frame-src " +
        PRESENTATION_SCHEME +
        ": ; media-src 'self' " +
        VIDEO_SCHEME +
        ': blob:'
      : /*
         * `worker-src 'self' blob:` ist für den Prompter da.
         *
         * Die Spracherkennung bringt ihren Worker als eingebettetes Skript mit
         * und startet ihn über eine `blob:`-Adresse. Ohne diese Erlaubnis
         * bricht Chromium das ab — ohne Fehlermeldung, die irgendwo ankäme.
         * Nachgeladen wird damit nichts: `blob:` sind Daten aus dem eigenen
         * Paket, kein Weg ins Netz.
         */
        /*
         * `wasm-unsafe-eval` ist ausschließlich für die Spracherkennung da.
         *
         * Sie bringt ihren Rechenteil als WebAssembly mit, und Chromium
         * verweigert dessen Übersetzung, sobald eine Richtlinie gesetzt ist —
         * ohne Fehlermeldung, die irgendwo ankäme: Der Worker stirbt still,
         * und am Pult steht für immer „wird geladen". Die Erlaubnis gilt nur
         * WebAssembly; `eval` von JavaScript-Text bleibt verboten, und
         * geladen wird weiterhin nichts aus dem Netz.
         */
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: " +
        PRESENTATION_SCHEME +
        ": ; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src " +
        PRESENTATION_SCHEME +
        ": ; media-src 'self' " +
        VIDEO_SCHEME +
        ': blob:'
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
  /* Beim Start dasselbe wie beim Speichern: Der Prompter soll von Anfang an
     wissen, ob ein Gerät im Saal bedienen darf. */
  const netz = getNetworkProjection()
  setPrompterNetzBedienung(netz.enabled && netz.allowPrompterControl)
  registerPresentationProtocol()
  registerVideoProtocol()
  registerPultProtocol()
  registerIpc()
  // Der Fernzugriff nutzt dieselbe API wie das Hauptfenster.
  setRemoteDispatcher((method, args) => callApi(method, args))
  /* Die Stimmabgabe bekommt eine eigene, schmale Brücke — sie kommt ohne
     Anmeldung herein und darf deshalb nicht an `callApi`. */
  setWahlDispatcher(wahlBruecke)
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
    sendToTeleprompter(IPC.projectionState, { buehne, state })
    broadcastProjection(buehne, state)

    /*
     * **Die einzige Stelle, an der die Bühne den Prompter anfasst.**
     *
     * Wird vorn jemand aufgerufen, dem eine Rede zugeordnet ist, legt der
     * Prompter sie auf. Umgekehrt gilt das nicht und soll es nie: Was am Pult
     * steht, gehört nicht an die Wand. Nur die Bühne, die der Prompter
     * steuert, darf es — sonst risse eine zweite Leinwand den Text weg.
     */
    if (buehne === getPrompterBuehne() && state.mode === 'speaker') {
      sprecherAufgerufen(state.speaker && { ...state.speaker, roundId: state.round?.id })
    }
  })
  onAudienceStateChanged((state) => sendToOperator(IPC.audienceState, state))
  onPrompterStateChanged((state) => sendToOperator(IPC.prompterState, state))
  /*
   * Der Prompter geht seinen eigenen Weg.
   *
   * Er hängt nicht am Projektionszustand: Was am Pult steht, ist nicht das,
   * was an der Wand steht — und soll es auch nie versehentlich werden.
   */
  onPrompterViewChanged((view) => {
    sendToOperator(IPC.prompterView, view)
    sendToTeleprompter(IPC.prompterView, view)
    broadcastPrompter(view)
  })
  onTeleprompterStateChanged((state) => sendToOperator(IPC.teleprompterState, state))
  onSessionChanged((currentSession) => sendToOperator(IPC.sessionChanged, currentSession))

  const network = getNetworkProjection()
  if (network.enabled) {
    const status = await startNetworkProjection(network)
    if (!status.running) {
      sendToOperator(IPC.notice, {
        level: 'warning',
        message: `Netzwerk-Beameransicht konnte nicht gestartet werden: ${status.error ?? 'unbekannter Fehler'}`
      })
    } else {
      /* Erst wenn der Server steht, hat es Sinn, sich rufen zu lassen. */
      await starteSuchruf(suchrufQuelle())
    }
  }

  /*
   * **Die Netzdienste gehören zum Start, nicht zum Einschalten.**
   *
   * Sie liefen bisher nur, solange niemand den Rechner neu startete — also
   * genau bis zum Morgen der Versammlung. Die Einstellung sagte „an", der
   * Namensdienst schwieg, und im Saal löste niemand mehr den Namen auf, für
   * den das Zertifikat gilt. Das ist die Sorte Fehler, die man erst bemerkt,
   * wenn das erste Telefon nichts findet.
   *
   * Scheitert einer der beiden, sagt es die Oberfläche und der andere läuft
   * trotzdem: Die Adressvergabe braucht Rechte, die der Namensdienst nicht
   * braucht, und wegen des einen auf den anderen zu verzichten wäre falsch.
   */
  const saalnetz = getSaalnetz()
  if (saalnetz.dns) {
    try {
      await starteDns({
        name: getEigenesZertifikat()?.domain ?? '',
        adresse: saaladresse(network.bindAddress),
        bindAddress: network.bindAddress === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
        weiterleitung: saalnetz.dnsWeiterleitung || undefined
      })
    } catch (grund) {
      sendToOperator(IPC.notice, {
        level: 'warning',
        message: `Namensdienst konnte nicht gestartet werden: ${grund instanceof Error ? grund.message : String(grund)}`
      })
    }
  }
  if (saalnetz.dhcp) {
    try {
      await starteDhcp({
        von: saalnetz.dhcpVon,
        bis: saalnetz.dhcpBis,
        maske: saalnetz.dhcpMaske,
        eigene: saaladresse(network.bindAddress),
        router: saalnetz.dhcpRouter || undefined,
        laufzeit: saalnetz.dhcpLaufzeit
      })
    } catch (grund) {
      sendToOperator(IPC.notice, {
        level: 'warning',
        message: `Adressvergabe konnte nicht gestartet werden: ${grund instanceof Error ? grund.message : String(grund)}`
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
  /* Zuerst die Kameras: Der Empfängerprozess ist ein eigener Prozess und
     bliebe sonst stehen, wenn dieser hier geht — mitsamt dem roten Licht an
     der Kamera. */
  beendeKameras()
  await stopNetworkProjection()
  await stoppeSuchruf()
  await stoppeDns()
  await stoppeDhcp()
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

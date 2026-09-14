/**
 * Beameransicht im Netzwerk.
 *
 * Liefert dieselbe Audience-App als Webseite aus und schickt Statuswechsel per
 * Server-Sent-Events. Streng lesend: es gibt keinen einzigen schreibenden
 * Endpunkt, POST/PUT werden abgelehnt (§51, Beamer §2).
 *
 * Standardmäßig deaktiviert. Wird sie eingeschaltet, läuft sie ausschließlich
 * im lokalen Netz der Veranstaltung – kein Internetzugang, keine Cloud.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { app } from 'electron'
import { zertifikatFuer } from './tls'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import type { NetworkProjectionConfig } from '@shared/config'
import { BUEHNEN_MAX, HAUPTBUEHNE, type ProjectionState } from '@shared/projection'
import { PROMPTER_PFAD, type PrompterViewState } from '@shared/speech'
import { AUSSCHUSS_PFAD, WAHL_PFAD } from '@shared/wahl'
import { logger } from './logger'
import { handleRemoteRequest, type RemoteDispatcher } from './remote-access'
import { getPresentation, presentationFileFor } from './services/presentations'
import { getVideo, videoFileFor } from './services/videos'
import { getProjectionState } from './services/projection'
import { getPrompterView } from './services/prompter'
import { sprachmodellDatei } from './services/sprachmodell'
import { SPRACHMODELL_PFAD } from '@shared/sprachmodell'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
}

let server: Server | null = null
let config: NetworkProjectionConfig | null = null
let lastError: string | undefined
let dispatcher: RemoteDispatcher | null = null
/** Fingerabdruck des laufenden Zertifikats — zum Vergleichen am Gerät. */
let fingerabdruck: string | undefined
/**
 * Offene SSE-Leitungen samt der Bühne, die sie abonniert haben.
 *
 * Ein Gerät im Saal wählt seine Bühne über die Adresse (`/b/2`); es bekommt
 * danach nur noch Wechsel dieser einen Bühne. So bleibt die Rednerliste auf
 * dem einen Beamer stehen, während auf dem anderen ein Video läuft.
 */
const clients = new Map<ServerResponse, number>()

/**
 * Leitungen der Prompteransicht — getrennt von denen der Bühnen.
 *
 * Der Prompter hat einen eigenen Endpunkt, weil er etwas anderes zeigt: den
 * Text, den das Publikum gerade **nicht** sehen soll. Eine gemeinsame Leitung
 * hieße, dass jedes Gerät im Saal beides bekommt.
 */
const prompterClients = new Set<ServerResponse>()

/** Liest die Bühne aus der Adresse — fehlt oder unsinnig, gilt die Hauptbühne. */
function buehneAus(url: URL): number {
  const roh = Number(url.searchParams.get('buehne'))
  if (!Number.isInteger(roh) || roh < 1 || roh > BUEHNEN_MAX) return HAUPTBUEHNE
  return roh
}

/** Verbindet den Netzwerkserver mit der API des Hauptprozesses. */
export function setRemoteDispatcher(next: RemoteDispatcher): void {
  dispatcher = next
}

/**
 * Was die Stimmabgabe vom Hauptprozess braucht.
 *
 * Bewusst **drei** Funktionen und keine allgemeine Brücke: Über diesen Weg
 * kommen Anfragen ohne Anmeldung herein. Was er kann, steht hier vollständig;
 * alles andere ist nicht erreichbar, weil es nicht aufgezählt ist.
 */
export interface WahlDispatcher {
  /**
   * `mitToken` sagt, ob die Anfrage das Zugriffstoken mitbrachte.
   *
   * Daran erkennt der Hauptrechner eine **Wahlkabine**: Sie gehört der
   * Veranstaltung und wurde eingerichtet, ein mitgebrachtes Telefon nicht.
   * Mehr ist es nicht — wer das Token an die Wand schreibt, hat den
   * Unterschied wieder aufgehoben.
   */
  lage(code: string, mitToken: boolean): Promise<unknown>
  berechtigung(eingabe: Record<string, unknown>, mitToken: boolean): Promise<unknown>
  abgeben(eingabe: Record<string, unknown>, mitToken: boolean): Promise<unknown>
  /** Das Gerät des Wählers holt seine Unterschrift ab (Ausschussbetrieb). */
  warten(eingabe: Record<string, unknown>): Promise<unknown>
  /** Der Wahlausschuss: Lage, Schlüssel melden, offene Anfragen, Unterschrift. */
  ausschuss(was: string, eingabe: Record<string, unknown>): Promise<unknown>
}

let wahlRuf: WahlDispatcher | null = null

export function setWahlDispatcher(next: WahlDispatcher): void {
  wahlRuf = next
}

function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

/**
 * Eine Seite an ein Gerät im Saal ausliefern.
 *
 * **Warum das im Entwicklungsmodus nicht einfach eine Weiterleitung ist.**
 * Vite liefert die Oberfläche unter einer eigenen Adresse aus, und eine
 * Weiterleitung dorthin schickt das Gerät auf eine **andere Herkunft**: Das
 * Zugriffstoken steht als Keks an dieser hier, `/api/…` gibt es dort nicht,
 * und `localhost` ist auf einem anderen Gerät ohnehin es selbst. Für den
 * Entwickler im eigenen Browser ging das gut — für die Begleitanwendung im
 * Saal brach die Verbindung sofort ab, und zwar ohne erkennbaren Grund.
 *
 * Ausgeliefert wird deshalb, was gebaut ist. Nur wenn es das nicht gibt —
 * jemand hat noch nie gebaut —, bleibt die Weiterleitung als Notnagel, jetzt
 * mitsamt der Abfrage, damit das Token nicht unterwegs verloren geht.
 */
function seiteAusliefern(response: ServerResponse, datei: string, url: URL): void {
  const gebaut = join(rendererRoot(), datei)
  if (existsSync(gebaut)) {
    serveFile(response, gebaut)
    return
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    const abfrage = url.search ? url.search : ''
    response.writeHead(302, { Location: `${process.env.ELECTRON_RENDERER_URL}/${datei}${abfrage}` })
    response.end()
    return
  }
  deny(response, 404, 'Nicht gefunden.')
}

function tokenValid(request: IncomingMessage, url: URL): boolean {
  if (!config?.token) return true
  const fromQuery = url.searchParams.get('t')
  if (fromQuery && fromQuery === config.token) return true
  const cookie = request.headers.cookie ?? ''
  const match = /(?:^|;\s*)wz_token=([^;]+)/.exec(cookie)
  return match?.[1] === config.token
}

function deny(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(message)
}

function serveFile(response: ServerResponse, filePath: string): void {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    deny(response, 404, 'Nicht gefunden.')
    return
  }
  response.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  createReadStream(filePath).pipe(response)
}

/**
 * Video mit Bereichsanfragen ausliefern.
 *
 * Ohne `Range` müsste jedes Gerät die ganze Datei von vorn laden, bevor es
 * irgendetwas zeigt — bei 300 MB im WLAN eines Saals ist das keine Option.
 * Mit Bereichsanfragen puffert der Browser von selbst voraus und kann
 * springen, ohne neu zu beginnen. Genau darauf beruht der Gleichlauf: Ein
 * Nachzügler holt sich den Abschnitt, der gerade läuft, statt den Anfang.
 */
function serveVideo(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  mimeType: string
): void {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    deny(response, 404, 'Nicht gefunden.')
    return
  }
  const groesse = statSync(filePath).size
  const kopf = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }

  const bereich = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')
  if (!bereich) {
    response.writeHead(200, { ...kopf, 'Content-Length': groesse })
    createReadStream(filePath).pipe(response)
    return
  }

  /* Ein offenes Ende ("bytes=500-") bedeutet: ab hier bis zum Schluss. */
  const von = bereich[1] === '' ? 0 : Number(bereich[1])
  const bis = bereich[2] === '' ? groesse - 1 : Math.min(Number(bereich[2]), groesse - 1)
  if (!Number.isFinite(von) || !Number.isFinite(bis) || von > bis || von >= groesse) {
    response.writeHead(416, { ...kopf, 'Content-Range': `bytes */${groesse}` })
    response.end()
    return
  }

  response.writeHead(206, {
    ...kopf,
    'Content-Range': `bytes ${von}-${bis}/${groesse}`,
    'Content-Length': bis - von + 1
  })
  createReadStream(filePath, { start: von, end: bis }).pipe(response)
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  // Fernzugriff auf die Bedienoberfläche – nur wenn ausdrücklich freigeschaltet.
  if (url.pathname.startsWith('/api/remote/')) {
    if (!config?.allowRemoteOperator || !dispatcher) {
      deny(response, 403, 'Der Fernzugriff auf die Bedienung ist nicht freigeschaltet.')
      return
    }
    await handleRemoteRequest(request, response, url, dispatcher)
    return
  }

  /*
   * Die **einzige** schreibende Stelle dieses Servers.
   *
   * Sie bewegt keine Wahldaten, sondern das Manuskript vor der Nase der
   * vortragenden Person: anhalten, weiterlaufen, eine Stelle zurück, Tempo,
   * Schriftgröße. Erlaubt ist genau diese Liste — was nicht darin steht, wird
   * abgewiesen, nicht geprüft. Und das Ganze nur, wenn es ausdrücklich
   * freigeschaltet wurde (§51).
   */
  if (url.pathname === '/api/prompter/control') {
    if (!config?.allowPrompterControl || !dispatcher) {
      deny(response, 403, 'Die Bedienung der Prompteransicht ist nicht freigeschaltet.')
      return
    }
    if (request.method !== 'POST') {
      deny(response, 405, 'Diese Stelle nimmt nur POST an.')
      return
    }
    if (!tokenValid(request, url)) {
      deny(response, 401, 'Zugriffstoken fehlt oder ist falsch.')
      return
    }
    await handlePrompterControl(request, response, dispatcher)
    return
  }

  /*
   * Die Stimmabgabe — ohne Anmeldung, weil der Ausweis der Nachweis ist.
   * Nur erreichbar, solange eine Abstimmung offen ist; das prüft der Dienst
   * dahinter bei jedem Aufruf.
   */
  if (url.pathname.startsWith('/api/ausschuss/')) {
    if (!wahlRuf) {
      deny(response, 503, 'Die digitale Stimmabgabe ist nicht bereit.')
      return
    }
    if (await handleAusschuss(request, response, url, wahlRuf)) return
  }

  if (url.pathname.startsWith('/api/stimme/')) {
    if (!wahlRuf) {
      deny(response, 503, 'Die digitale Stimmabgabe ist nicht bereit.')
      return
    }
    if (await handleWahl(request, response, url, wahlRuf)) return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Alles Übrige ist ausschließlich lesend.
    deny(response, 405, 'Diese Ansicht ist nur zum Lesen.')
    return
  }

  /* Die Wahlseite selbst — eine gewöhnliche Seite, die jedes Telefon im
     Saalnetz laden kann. */
  if (url.pathname === WAHL_PFAD || url.pathname === `${WAHL_PFAD}/`) {
    serveFile(response, join(rendererRoot(), 'wahl.html'))
    return
  }

  /* Die Seite des Wahlausschusses — sie hält den Schlüssel und unterschreibt. */
  if (url.pathname === AUSSCHUSS_PFAD || url.pathname === `${AUSSCHUSS_PFAD}/`) {
    serveFile(response, join(rendererRoot(), 'ausschuss.html'))
    return
  }

  // Bedienoberfläche im Netz: dieselbe Anwendung, aber mit Anmeldung.
  if (url.pathname === '/operator' || url.pathname === '/operator/') {
    if (!config?.allowRemoteOperator) {
      deny(response, 403, 'Der Fernzugriff auf die Bedienung ist nicht freigeschaltet.')
      return
    }
    seiteAusliefern(response, 'index.html', url)
    return
  }
  if (!tokenValid(request, url)) {
    deny(response, 401, 'Zugriffstoken fehlt oder ist falsch.')
    return
  }

  /*
   * Kurzadresse je Bühne: `/b/2` ist das, was auf einem Zettel neben dem
   * Beamer steht. Sie leitet auf die Ansicht mit gesetzter Bühne weiter, damit
   * alle Dateipfade relativ bleiben.
   */
  const kurz = /^\/b\/(\d+)\/?$/.exec(url.pathname)
  if (kurz) {
    const gewaehlt = Math.min(Math.max(Number(kurz[1]), 1), BUEHNEN_MAX)
    const token = config?.token ? `&t=${encodeURIComponent(config.token)}` : ''
    response.writeHead(302, { Location: `/?buehne=${gewaehlt}${token}` })
    response.end()
    return
  }

  /*
   * Die Prompteransicht auf eigenem Endpunkt.
   *
   * `/prompter` liefert dieselbe Seite wie das Fenster am Hauptrechner; der
   * Text kommt über die eigene Leitung darunter.
   */
  if (url.pathname === PROMPTER_PFAD || url.pathname === `${PROMPTER_PFAD}/`) {
    seiteAusliefern(response, 'teleprompter.html', url)
    return
  }

  /*
   * Das Sprachmodell für ein Gerät am Pult.
   *
   * Die Begleitanwendung zeigt die Prompterseite dieses Servers an; das
   * Modell muss dann von hier kommen und nicht aus ihrem eigenen Paket. So
   * bleibt sie klein, und es gibt nur eine Stelle, an der ein größeres Modell
   * hinterlegt wird — den Hauptrechner.
   */
  if (url.pathname === SPRACHMODELL_PFAD) {
    const modell = sprachmodellDatei()
    if (!modell) {
      deny(response, 404, 'Kein Sprachmodell hinterlegt.')
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(statSync(modell.pfad).size),
      'Cache-Control': 'no-store'
    })
    createReadStream(modell.pfad).pipe(response)
    return
  }

  if (url.pathname === '/api/prompter/state') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify(getPrompterView()))
    return
  }

  if (url.pathname === '/api/prompter/stream') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    response.write(`data: ${JSON.stringify(getPrompterView())}\n\n`)
    prompterClients.add(response)
    const keepAlive = setInterval(() => response.write(': ping\n\n'), 20000)
    request.on('close', () => {
      clearInterval(keepAlive)
      prompterClients.delete(response)
    })
    return
  }

  if (url.pathname === '/api/projection/state') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify(getProjectionState(buehneAus(url))))
    return
  }

  if (url.pathname === '/api/projection/stream') {
    const buehne = buehneAus(url)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    response.write(`data: ${JSON.stringify(getProjectionState(buehne))}\n\n`)
    clients.set(response, buehne)
    const keepAlive = setInterval(() => response.write(': ping\n\n'), 20000)
    request.on('close', () => {
      clearInterval(keepAlive)
      clients.delete(response)
    })
    return
  }

  /*
   * Die laufende Präsentation als eigene Ressource.
   *
   * Sie geht **nicht** durch den Projektionszustand: Der wandert bei jedem
   * Folienwechsel durch alle SSE-Leitungen, eine HTML-Datei von zwei Megabyte
   * täte das mit. Hier wird sie einmal geladen, danach bewegt sich nur noch
   * die Foliennummer.
   *
   * Ausgeliefert wird ausschließlich die Datei, die **gerade projiziert
   * wird** — nicht jede aus der Bibliothek. Sonst könnte jedes Gerät im Netz
   * eine noch unveröffentlichte Präsentation abrufen, indem es Kennungen
   * durchprobiert.
   */
  /*
   * Das laufende Video. Wie bei der Präsentation wird ausschließlich die
   * Datei ausgeliefert, die **gerade projiziert wird** — sonst könnte jedes
   * Gerät im Netz jeden Film aus der Bibliothek abrufen, indem es Kennungen
   * durchprobiert.
   */
  if (url.pathname === '/video') {
    const laufend = getProjectionState(buehneAus(url)).video
    if (!laufend) {
      deny(response, 404, 'Gerade läuft kein Video.')
      return
    }
    const eintrag = getVideo(laufend.id)
    if (!eintrag) {
      deny(response, 404, 'Die Datei fehlt.')
      return
    }
    serveVideo(request, response, videoFileFor(eintrag), eintrag.mimeType)
    return
  }

  if (url.pathname === '/presentation.html') {
    const laufend = getProjectionState(buehneAus(url)).presentation
    if (!laufend) {
      deny(response, 404, 'Gerade läuft keine Präsentation.')
      return
    }
    const eintrag = getPresentation(laufend.id)
    if (!eintrag) {
      deny(response, 404, 'Die Datei fehlt.')
      return
    }
    serveFile(response, presentationFileFor(eintrag))
    return
  }

  const headers: Record<string, string> = {}
  if (config?.token && url.searchParams.get('t') === config.token) {
    headers['Set-Cookie'] = `wz_token=${config.token}; Path=/; SameSite=Strict`
  }

  const requestedPath = url.pathname === '/' ? '/audience.html' : url.pathname
  const filePath = join(rendererRoot(), normalize(requestedPath).replace(/^(\.\.[/\\])+/, ''))
  if (!filePath.startsWith(rendererRoot())) {
    deny(response, 403, 'Zugriff verweigert.')
    return
  }
  if (Object.keys(headers).length > 0) {
    // Cookie zuerst setzen, dann Datei ausliefern.
    response.setHeader('Set-Cookie', headers['Set-Cookie'])
  }
  if (!existsSync(filePath) && url.pathname === '/') {
    seiteAusliefern(response, 'audience.html', url)
    return
  }
  serveFile(response, filePath)
}

export function broadcastProjection(buehne: number, state: ProjectionState): void {
  if (clients.size === 0) return
  const payload = `data: ${JSON.stringify(state)}\n\n`
  for (const [client, abonniert] of clients) {
    if (abonniert !== buehne) continue
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
}

/**
 * Was ein Gerät am Pult auslösen darf.
 *
 * Bewusst eine Liste und keine Regel: Wer sie erweitern will, muss den Namen
 * hier hinschreiben und dabei überlegen, ob er wirklich hingehört.
 */
const PROMPTER_BEFEHLE = new Set([
  'prompter.setRunning',
  'prompter.setPosition',
  'prompter.nudge',
  'prompter.setTempo',
  'prompter.setDarstellung',
  'prompter.setAnsicht',
  'prompter.setLaufart'
])

/* ------------------------------------------------------- Stimmabgabe */

/**
 * Die Endpunkte der digitalen Stimmabgabe.
 *
 * **Sie verlangen keine Anmeldung, und das ist kein Versehen.** Wer hier
 * abstimmt, hat kein Konto und darf keines brauchen — sein Ausweis ist der
 * Nachweis, und der wird bei jedem Aufruf geprüft. Eine Anmeldung wäre an
 * dieser Stelle sogar falsch: Bei einer geheimen Wahl darf der Rechner nicht
 * wissen, wer gerade seine Stimme abgibt.
 *
 * Die Endpunkte antworten nur, solange eine Abstimmung **offen** ist. Ist
 * keine offen, gibt es nichts zu holen und nichts einzulegen.
 */
async function leseKoerper(
  request: IncomingMessage,
  response: ServerResponse,
  grenze = 16384
): Promise<Record<string, unknown> | null> {
  const stuecke: Buffer[] = []
  let bytes = 0
  for await (const stueck of request) {
    bytes += (stueck as Buffer).length
    if (bytes > grenze) {
      deny(response, 413, 'Die Anfrage ist zu groß.')
      return null
    }
    stuecke.push(stueck as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(stuecke).toString('utf8')) as Record<string, unknown>
  } catch {
    deny(response, 400, 'Die Anfrage ist kein gültiges JSON.')
    return null
  }
}

function sendeJson(response: ServerResponse, status: number, daten: unknown): void {
  const inhalt = Buffer.from(JSON.stringify(daten), 'utf8')
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': inhalt.length,
    'Cache-Control': 'no-store'
  })
  response.end(inhalt)
}

/** Fehler als JSON — die Wahlseite liest `fehler` und zeigt ihn im Klartext. */
function sendeFehler(response: ServerResponse, status: number, text: string): void {
  sendeJson(response, status, { fehler: text })
}

async function handleWahl(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  ruf: WahlDispatcher
): Promise<boolean> {
  if (url.pathname === '/api/stimme/lage') {
    const code = url.searchParams.get('code') ?? ''
    try {
      sendeJson(response, 200, await ruf.lage(code, tokenValid(request, url)))
    } catch (fehler) {
      sendeFehler(response, 400, fehler instanceof Error ? fehler.message : String(fehler))
    }
    return true
  }

  if (
    url.pathname === '/api/stimme/berechtigung' ||
    url.pathname === '/api/stimme/abgeben' ||
    url.pathname === '/api/stimme/warten'
  ) {
    if (request.method !== 'POST') {
      sendeFehler(response, 405, 'Diese Stelle nimmt nur POST an.')
      return true
    }
    const koerper = await leseKoerper(request, response)
    if (!koerper) return true
    try {
      const mitToken = tokenValid(request, url)
      const ergebnis =
        url.pathname === '/api/stimme/berechtigung'
          ? await ruf.berechtigung(koerper, mitToken)
          : url.pathname === '/api/stimme/warten'
            ? await ruf.warten(koerper)
            : await ruf.abgeben(koerper, mitToken)
      sendeJson(response, 200, ergebnis ?? {})
    } catch (fehler) {
      sendeFehler(response, 400, fehler instanceof Error ? fehler.message : String(fehler))
    }
    return true
  }

  return false
}

/**
 * Die Endpunkte des Wahlausschusses.
 *
 * Anders als die Stimmabgabe **verlangen sie das Zugriffstoken**: Hier hängt
 * kein Ausweis als Nachweis dran, sondern ein Gerät, das den Schlüssel hält.
 * Wer es betreibt, hat es eingerichtet und kennt das Token.
 *
 * Über diesen Weg gehen nur verblendete Werte und Unterschriften. Auch wer
 * mitliest, erfährt daraus nichts.
 */
async function handleAusschuss(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  ruf: WahlDispatcher
): Promise<boolean> {
  const was = url.pathname.slice('/api/ausschuss/'.length)
  if (!['lage', 'schluessel', 'offen', 'signatur'].includes(was)) return false

  if (!tokenValid(request, url)) {
    sendeFehler(response, 401, 'Zugriffstoken fehlt oder ist falsch.')
    return true
  }

  const koerper =
    request.method === 'POST' ? await leseKoerper(request, response, 65536) : Object.create(null)
  if (koerper === null) return true

  try {
    sendeJson(response, 200, (await ruf.ausschuss(was, koerper as Record<string, unknown>)) ?? {})
  } catch (fehler) {
    sendeFehler(response, 400, fehler instanceof Error ? fehler.message : String(fehler))
  }
  return true
}

async function handlePrompterControl(
  request: IncomingMessage,
  response: ServerResponse,
  ruf: RemoteDispatcher
): Promise<void> {
  const stuecke: Buffer[] = []
  let bytes = 0
  for await (const stueck of request) {
    bytes += (stueck as Buffer).length
    /* Ein Befehl ist ein paar Dutzend Zeichen lang; alles darüber ist nichts,
       was hier ankommen sollte. */
    if (bytes > 8192) {
      deny(response, 413, 'Die Anfrage ist zu groß.')
      return
    }
    stuecke.push(stueck as Buffer)
  }
  let eingabe: { method?: string; args?: unknown[] }
  try {
    eingabe = JSON.parse(Buffer.concat(stuecke).toString('utf8'))
  } catch {
    deny(response, 400, 'Die Anfrage ist unlesbar.')
    return
  }
  if (!eingabe.method || !PROMPTER_BEFEHLE.has(eingabe.method)) {
    deny(response, 403, 'Dieser Befehl ist am Pult nicht erlaubt.')
    return
  }
  try {
    const daten = await ruf(eingabe.method, Array.isArray(eingabe.args) ? eingabe.args : [])
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify({ ok: true, data: daten }))
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    logger.warn(`Prompterbefehl ${eingabe.method}: ${text}`)
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, error: text }))
  }
}

/** Der Stand des Prompters an alle Geräte, die ihn zeigen. */
export function broadcastPrompter(state: PrompterViewState): void {
  if (prompterClients.size === 0) return
  const payload = `data: ${JSON.stringify(state)}\n\n`
  for (const client of prompterClients) {
    try {
      client.write(payload)
    } catch {
      prompterClients.delete(client)
    }
  }
}

export interface NetworkStatus {
  running: boolean
  urls: string[]
  error?: string
  /**
   * Fingerabdruck des Zertifikats, wenn verschlüsselt ausgeliefert wird.
   *
   * Bei einem selbst ausgestellten Zertifikat ist sein Vergleich die
   * einzige Prüfmöglichkeit, die ein Mensch hat — deshalb gehört er
   * sichtbar in die Oberfläche und nicht in eine Protokolldatei.
   */
  fingerabdruck?: string
}

export function localUrls(port: number, token: string, tls = config?.tls ?? false): string[] {
  const urls: string[] = []
  const schema = tls ? 'https' : 'http'
  const suffix = token ? `/?t=${encodeURIComponent(token)}` : '/'
  for (const [, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`${schema}://${address.address}:${port}${suffix}`)
      }
    }
  }
  urls.push(`${schema}://127.0.0.1:${port}${suffix}`)
  return urls
}

export async function stopNetworkProjection(): Promise<void> {
  for (const client of clients.keys()) {
    try {
      client.end()
    } catch {
      // Verbindung ist bereits weg.
    }
  }
  clients.clear()
  for (const client of prompterClients) {
    try {
      client.end()
    } catch {
      // Verbindung ist bereits weg.
    }
  }
  prompterClients.clear()
  if (!server) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = null
  logger.info('Netzwerk-Beameransicht gestoppt.')
}

export async function startNetworkProjection(next: NetworkProjectionConfig): Promise<NetworkStatus> {
  await stopNetworkProjection()
  config = next
  lastError = undefined

  if (!next.enabled) {
    return { running: false, urls: [] }
  }

  return new Promise<NetworkStatus>((resolve) => {
    const bearbeite = (request: IncomingMessage, response: ServerResponse): void => {
      void handle(request, response).catch((error) => {
        logger.error(`Netzwerkanfrage fehlgeschlagen: ${String(error)}`)
        if (!response.headersSent) deny(response, 500, 'Interner Fehler.')
      })
    }

    /*
     * Mit Verschlüsselung ein anderer Server, sonst derselbe wie bisher.
     * Das Zertifikat entsteht beim ersten Einschalten und bleibt liegen —
     * ein neues bei jedem Start hieße eine neue Warnung bei jedem Start,
     * und Warnungen, die sich ständig ändern, liest niemand mehr.
     */
    let instance: Server
    if (next.tls) {
      const zertifikat = zertifikatFuer(join(app.getPath('userData'), 'netz'))
      fingerabdruck = zertifikat.fingerabdruck
      instance = createSecureServer({ cert: zertifikat.cert, key: zertifikat.key }, bearbeite)
    } else {
      fingerabdruck = undefined
      instance = createServer(bearbeite)
    }
    instance.on('error', (error: NodeJS.ErrnoException) => {
      lastError =
        error.code === 'EADDRINUSE'
          ? `Der Port ${next.port} ist bereits belegt. Bitte einen anderen Port wählen.`
          : error.message
      logger.error(`Netzwerk-Beameransicht: ${lastError}`)
      server = null
      resolve({ running: false, urls: [], error: lastError })
    })
    instance.listen(next.port, next.bindAddress, () => {
      server = instance
      const urls = localUrls(next.port, next.token)
      logger.info(`Netzwerk-Beameransicht läuft auf ${next.bindAddress}:${next.port}`)
      resolve({ running: true, urls })
    })
  })
}

export function networkStatus(): NetworkStatus {
  return {
    running: server !== null,
    urls: server && config ? localUrls(config.port, config.token, config.tls) : [],
    error: lastError,
    fingerabdruck
  }
}

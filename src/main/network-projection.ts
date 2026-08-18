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
import { createReadStream, existsSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import type { NetworkProjectionConfig } from '@shared/config'
import type { ProjectionState } from '@shared/projection'
import { logger } from './logger'
import { handleRemoteRequest, type RemoteDispatcher } from './remote-access'
import { getProjectionState } from './services/projection'

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
const clients = new Set<ServerResponse>()

/** Verbindet den Netzwerkserver mit der API des Hauptprozesses. */
export function setRemoteDispatcher(next: RemoteDispatcher): void {
  dispatcher = next
}

function rendererRoot(): string {
  return join(__dirname, '../renderer')
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

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Alles Übrige ist ausschließlich lesend.
    deny(response, 405, 'Diese Ansicht ist nur zum Lesen.')
    return
  }

  // Bedienoberfläche im Netz: dieselbe Anwendung, aber mit Anmeldung.
  if (url.pathname === '/operator' || url.pathname === '/operator/') {
    if (!config?.allowRemoteOperator) {
      deny(response, 403, 'Der Fernzugriff auf die Bedienung ist nicht freigeschaltet.')
      return
    }
    if (process.env.ELECTRON_RENDERER_URL) {
      response.writeHead(302, { Location: `${process.env.ELECTRON_RENDERER_URL}/` })
      response.end()
      return
    }
    serveFile(response, join(rendererRoot(), 'index.html'))
    return
  }
  if (!tokenValid(request, url)) {
    deny(response, 401, 'Zugriffstoken fehlt oder ist falsch.')
    return
  }

  if (url.pathname === '/api/projection/state') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(getProjectionState()))
    return
  }

  if (url.pathname === '/api/projection/stream') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    response.write(`data: ${JSON.stringify(getProjectionState())}\n\n`)
    clients.add(response)
    const keepAlive = setInterval(() => response.write(': ping\n\n'), 20000)
    request.on('close', () => {
      clearInterval(keepAlive)
      clients.delete(response)
    })
    return
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    // Im Entwicklungsmodus liefert Vite die Oberfläche aus.
    response.writeHead(302, { Location: `${process.env.ELECTRON_RENDERER_URL}/audience.html` })
    response.end()
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
  serveFile(response, filePath)
}

export function broadcastProjection(state: ProjectionState): void {
  if (clients.size === 0) return
  const payload = `data: ${JSON.stringify(state)}\n\n`
  for (const client of clients) {
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
}

export interface NetworkStatus {
  running: boolean
  urls: string[]
  error?: string
}

export function localUrls(port: number, token: string): string[] {
  const urls: string[] = []
  const suffix = token ? `/?t=${encodeURIComponent(token)}` : '/'
  for (const [, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}${suffix}`)
      }
    }
  }
  urls.push(`http://127.0.0.1:${port}${suffix}`)
  return urls
}

export async function stopNetworkProjection(): Promise<void> {
  for (const client of clients) {
    try {
      client.end()
    } catch {
      // Verbindung ist bereits weg.
    }
  }
  clients.clear()
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
    const instance = createServer((request, response) => {
      void handle(request, response).catch((error) => {
        logger.error(`Netzwerkanfrage fehlgeschlagen: ${String(error)}`)
        if (!response.headersSent) deny(response, 500, 'Interner Fehler.')
      })
    })
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
    urls: server && config ? localUrls(config.port, config.token) : [],
    error: lastError
  }
}

/**
 * Fernzugriff im Veranstaltungsnetz (§70 Phase 3).
 *
 * Ein zweites Gerät öffnet dieselbe Oberfläche im Browser und meldet sich mit
 * einem lokalen Konto am Hauptrechner an. Grundsätze:
 *
 * - Standardmäßig ABGESCHALTET; nur für ein abgeschottetes Veranstaltungsnetz.
 * - Anmeldung mit Benutzername/Passwort wie am Hauptrechner; jede Sitzung
 *   bekommt ein zufälliges Token und läuft mit dem konfigurierten Zeitlimit ab.
 * - Rechteprüfung und Audit laufen über dieselben Dienste wie lokal — der
 *   Aufruf läuft im Sitzungskontext des angemeldeten Benutzers.
 * - Fehlversuche werden gebremst und protokolliert.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Session } from '@shared/types'
import { logger } from './logger'
import { appendAudit } from './services/audit'
import { authenticate, runWithSession } from './services/auth'
import { getConfig } from './services/settings'

interface RemoteSession {
  token: string
  session: Session
  client: string
  createdAt: number
}

const sessions = new Map<string, RemoteSession>()
const failures = new Map<string, { count: number; until: number }>()

const MAX_BODY_BYTES = 4_000_000
const MAX_FAILURES = 5
const LOCK_MS = 60_000

export type RemoteDispatcher = (method: string, args: unknown[]) => Promise<unknown>

function clientOf(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unbekannt'
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Die Anfrage ist zu groß.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(body)
}

function tokenFrom(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  const cookie = request.headers.cookie ?? ''
  return /(?:^|;\s*)wz_session=([^;]+)/.exec(cookie)?.[1]
}

function findSession(token: string | undefined): RemoteSession | undefined {
  if (!token) return undefined
  // Konstante Vergleichszeit über alle bekannten Token.
  const candidate = Buffer.from(token)
  for (const entry of sessions.values()) {
    const known = Buffer.from(entry.token)
    if (known.length === candidate.length && timingSafeEqual(known, candidate)) return entry
  }
  return undefined
}

function dropExpired(): void {
  const now = Date.now()
  for (const [token, entry] of sessions) {
    if (new Date(entry.session.expiresAt).getTime() < now) {
      sessions.delete(token)
      appendAudit({
        action: 'remote.session_expired',
        userId: entry.session.user.id,
        userName: entry.session.user.displayName,
        reason: `Gerät ${entry.client}`
      })
    }
  }
}

function locked(client: string): boolean {
  const entry = failures.get(client)
  if (!entry) return false
  if (entry.until < Date.now()) {
    failures.delete(client)
    return false
  }
  return entry.count >= MAX_FAILURES
}

function noteFailure(client: string): void {
  const entry = failures.get(client) ?? { count: 0, until: 0 }
  entry.count += 1
  entry.until = Date.now() + LOCK_MS
  failures.set(client, entry)
}

/**
 * Behandelt die Fernzugriffs-Pfade. Gibt `true` zurück, wenn die Anfrage
 * beantwortet wurde.
 */
export async function handleRemoteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dispatch: RemoteDispatcher
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/remote/')) return false

  dropExpired()
  const client = clientOf(request)

  if (url.pathname === '/api/remote/login' && request.method === 'POST') {
    if (locked(client)) {
      json(response, 429, { ok: false, error: 'Zu viele Fehlversuche. Bitte eine Minute warten.' })
      return true
    }
    try {
      const body = JSON.parse(await readBody(request)) as { username?: string; password?: string }
      const session = authenticate(body.username ?? '', body.password ?? '', `Netzwerk ${client}`)
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { token, session, client, createdAt: Date.now() })
      failures.delete(client)
      logger.info(`Fernzugriff: ${session.user.username} angemeldet von ${client}`)
      response.setHeader('Set-Cookie', `wz_session=${token}; Path=/; SameSite=Strict; HttpOnly`)
      json(response, 200, { ok: true, data: { token, session } })
    } catch (error) {
      noteFailure(client)
      json(response, 401, { ok: false, error: error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen.' })
    }
    return true
  }

  const entry = findSession(tokenFrom(request))

  if (url.pathname === '/api/remote/logout' && request.method === 'POST') {
    if (entry) {
      sessions.delete(entry.token)
      appendAudit({
        action: 'auth.logout',
        userId: entry.session.user.id,
        userName: entry.session.user.displayName,
        reason: `Netzwerk ${client}`
      })
    }
    json(response, 200, { ok: true, data: null })
    return true
  }

  if (!entry) {
    json(response, 401, { ok: false, error: 'Nicht angemeldet oder Sitzung abgelaufen.' })
    return true
  }
  if (new Date(entry.session.expiresAt).getTime() < Date.now()) {
    sessions.delete(entry.token)
    json(response, 401, { ok: false, error: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.' })
    return true
  }

  if (url.pathname === '/api/remote/session' && request.method === 'GET') {
    json(response, 200, { ok: true, data: entry.session })
    return true
  }

  if (url.pathname === '/api/remote/call' && request.method === 'POST') {
    let payload: { method?: string; args?: unknown[] }
    try {
      payload = JSON.parse(await readBody(request)) as { method?: string; args?: unknown[] }
    } catch {
      json(response, 400, { ok: false, error: 'Ungültige Anfrage.' })
      return true
    }

    const method = payload.method ?? ''
    // Auf dem Zweitgerät sind Systemdialoge des Hauptrechners sinnlos oder
    // irreführend – sie bleiben dem Gerät vor Ort vorbehalten.
    const blocked = ['system.chooseDirectory', 'system.chooseImage', 'system.revealPath', 'system.saveCopy']
    if (blocked.includes(method)) {
      json(response, 403, {
        ok: false,
        error: 'Dieser Vorgang ist nur direkt am Hauptrechner möglich.'
      })
      return true
    }

    try {
      const data = await runWithSession(
        entry.session,
        (refreshed) => {
          entry.session = refreshed
        },
        () => dispatch(method, payload.args ?? [])
      )
      json(response, 200, { ok: true, data })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(response, 200, { ok: false, error: message })
    }
    return true
  }

  json(response, 404, { ok: false, error: 'Unbekannter Endpunkt.' })
  return true
}

export function remoteSessionCount(): number {
  dropExpired()
  return sessions.size
}

export function remoteSessionList(): { user: string; role: string; client: string; since: string }[] {
  dropExpired()
  return [...sessions.values()].map((entry) => ({
    user: entry.session.user.displayName,
    role: entry.session.user.role,
    client: entry.client,
    since: new Date(entry.createdAt).toISOString()
  }))
}

export function endAllRemoteSessions(): void {
  for (const entry of sessions.values()) {
    appendAudit({
      action: 'remote.session_ended',
      userId: entry.session.user.id,
      userName: entry.session.user.displayName,
      reason: `Gerät ${entry.client}`
    })
  }
  sessions.clear()
}

/** Wird beim Abschalten des Fernzugriffs aufgerufen. */
export function remoteTimeoutMinutes(): number {
  return getConfig().security.sessionTimeoutMinutes
}

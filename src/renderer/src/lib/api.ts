/**
 * Zugriff auf den Hauptprozess.
 *
 * Zwei Wege, dieselbe Schnittstelle:
 * - Am Hauptrechner über die Preload-Brücke (IPC).
 * - Auf einem zweiten Gerät im Veranstaltungsnetz über HTTP mit Anmeldung.
 *
 * Der übrige Renderer merkt davon nichts; er ruft immer `api(...)` auf.
 */
import type { ApiMethod, ApiParams, ApiResult } from '@shared/ipc'
import type { AudienceWindowState, ProjectionState } from '@shared/projection'
import type { PrintProgress, Session } from '@shared/types'

interface Bridge {
  invoke<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>>
  onPrintProgress(listener: (progress: PrintProgress) => void): () => void
  onProjectionState(listener: (state: ProjectionState) => void): () => void
  onAudienceState(listener: (state: AudienceWindowState) => void): () => void
  onSessionChanged(listener: (session: Session | null) => void): () => void
  onNotice(listener: (notice: { level: 'info' | 'warning' | 'error'; message: string }) => void): () => void
}

declare global {
  interface Window {
    wahlzettel?: Bridge
  }
}

/** Läuft die Oberfläche auf einem zweiten Gerät im Netz? */
export const isRemote = !window.wahlzettel

const TOKEN_KEY = 'wz-remote-token'

function token(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

async function request(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const current = token()
  if (current) headers.Authorization = `Bearer ${current}`

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const body = (await response.json().catch(() => ({ ok: false, error: 'Unerwartete Antwort des Servers.' }))) as {
    ok: boolean
    data?: unknown
    error?: string
  }
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY)
  }
  return body
}

/** HTTP-Umsetzung derselben Methoden. */
async function remoteInvoke(method: string, args: unknown[]): Promise<unknown> {
  if (method === 'auth.login') {
    const body = await request('/api/remote/login', { method: 'POST', body: JSON.stringify(args[0]) })
    if (!body.ok) throw new Error(body.error ?? 'Anmeldung fehlgeschlagen.')
    const data = body.data as { token: string; session: Session }
    sessionStorage.setItem(TOKEN_KEY, data.token)
    return data.session
  }

  if (method === 'auth.logout') {
    await request('/api/remote/logout', { method: 'POST' }).catch(() => undefined)
    sessionStorage.removeItem(TOKEN_KEY)
    return undefined
  }

  if (method === 'auth.session' || method === 'auth.touch') {
    if (!token()) return null
    const body = await request('/api/remote/session')
    return body.ok ? (body.data as Session) : null
  }

  if (method === 'system.setupState') {
    // Die Ersteinrichtung erfolgt ausschließlich am Hauptrechner.
    const body = await request('/api/remote/call', {
      method: 'POST',
      body: JSON.stringify({ method, args })
    })
    if (!body.ok) {
      return { needsSetup: false, hasUsers: true, version: 'Fernzugriff', databasePath: '' }
    }
    return body.data
  }

  const body = await request('/api/remote/call', {
    method: 'POST',
    body: JSON.stringify({ method, args })
  })
  if (!body.ok) throw new Error(body.error ?? 'Der Aufruf ist fehlgeschlagen.')
  return body.data
}

/**
 * Ersatz für die Ereigniskanäle: Im Netzbetrieb gibt es keine Push-Kanäle des
 * Hauptprozesses, deshalb wird der Projektions- und Sitzungszustand in kurzen
 * Abständen abgefragt. Druckfortschritt kommt am Ende des jeweiligen Aufrufs.
 */
function pollingBridge(): Bridge {
  const poll = <T>(fetcher: () => Promise<T>, listener: (value: T) => void, intervalMs: number): (() => void) => {
    let stopped = false
    const tick = async (): Promise<void> => {
      if (stopped) return
      try {
        listener(await fetcher())
      } catch {
        // Verbindungsabbrüche werden beim nächsten Durchlauf erneut versucht.
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), intervalMs)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }

  return {
    invoke: ((method: string, ...args: unknown[]) => remoteInvoke(method, args)) as Bridge['invoke'],
    onPrintProgress: () => () => undefined,
    onProjectionState: (listener) =>
      poll(() => remoteInvoke('projection.state', []) as Promise<ProjectionState>, listener, 2000),
    onAudienceState: (listener) =>
      poll(() => remoteInvoke('projection.audienceState', []) as Promise<AudienceWindowState>, listener, 5000),
    onSessionChanged: () => () => undefined,
    onNotice: () => () => undefined
  }
}

export const bridge: Bridge = window.wahlzettel ?? pollingBridge()

export function api<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>> {
  return bridge.invoke(method, ...args)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

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
import type { AudienceWindowState, Buehne, ProjectionState } from '@shared/projection'
import type { PrompterWindowState } from '@shared/presentation'
import type { PrompterViewState } from '@shared/speech'
import type { KameraStand } from '@shared/kamera'
import type { PrintProgress, Session, UpdateProgress } from '@shared/types'

interface Bridge {
  invoke<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>>
  onPrintProgress(listener: (progress: PrintProgress) => void): () => void
  onProjectionState(listener: (nachricht: { buehne: number; state: ProjectionState }) => void): () => void
  onAudienceState(listener: (state: AudienceWindowState) => void): () => void
  onSessionChanged(listener: (session: Session | null) => void): () => void
  onNotice(listener: (notice: { level: 'info' | 'warning' | 'error'; message: string }) => void): () => void
  onUpdateProgress(listener: (progress: UpdateProgress) => void): () => void
  /**
   * Ob das Fenster der Vortragssteuerung offen ist.
   *
   * Nötig, weil es auch über sein eigenes Kreuz geschlossen werden kann. Ohne
   * diese Meldung behielte die Bedienung ihren alten Stand und böte
   * „Vortragssteuerung schließen" für ein Fenster an, das längst zu ist.
   */
  onPrompterState(listener: (state: PrompterWindowState) => void): () => void
  /** Der Stand des Teleprompters. */
  onPrompterView(listener: (state: PrompterViewState) => void): () => void
  /** Ob das Teleprompterfenster am Hauptrechner offen steht. */
  onTeleprompterState(listener: (state: PrompterWindowState) => void): () => void
  /** Gefundene Kameras und Störungen. */
  onKameraStand(listener: (stand: KameraStand) => void): () => void
  /**
   * Eine Kamera für **dieses Fenster** anfordern — die Vorschau in der
   * Bedienung. Am zweiten Gerät im Netz fehlt die Brücke; dort gibt es
   * kein NDI und also auch keine Vorschau.
   */
  kameraAn(eingabe: { quelle: string; qualitaet?: 'hoch' | 'vorschau'; kanal?: string }): void
  kameraAus(kanal?: string): void
}

declare global {
  interface Window {
    votura?: Bridge
  }
}

/** Läuft die Oberfläche auf einem zweiten Gerät im Netz? */
export const isRemote = !window.votura

const TOKEN_KEY = 'wz-remote-token'

function token(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

async function request(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const current = token()
  if (current) headers.Authorization = `Bearer ${current}`

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const body = (await response
    .json()
    .catch(() => ({ ok: false, error: 'Unerwartete Antwort des Servers.' }))) as {
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
  const poll = <T>(
    fetcher: () => Promise<T>,
    listener: (value: T) => void,
    intervalMs: number
  ): (() => void) => {
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
    /*
     * Im Netzbetrieb wird jede Bühne einzeln abgefragt. Es sind wenige, und
     * die Antwort ist klein — das wiegt leichter als ein zweiter Kanal.
     */
    onProjectionState: (listener) =>
      poll(
        async () => {
          const stages = (await remoteInvoke('projection.buehnen', [])) as Buehne[]
          return Promise.all(
            stages.map(async (stage) => ({
              buehne: stage.id,
              state: (await remoteInvoke('projection.state', [stage.id])) as ProjectionState
            }))
          )
        },
        (alle) => alle.forEach(listener),
        2000
      ),
    onAudienceState: (listener) =>
      poll(
        async () => {
          const stages = (await remoteInvoke('projection.buehnen', [])) as Buehne[]
          return Promise.all(
            stages.map(
              async (stage) =>
                (await remoteInvoke('projection.audienceState', [stage.id])) as AudienceWindowState
            )
          )
        },
        (alle) => alle.forEach(listener),
        5000
      ),
    onSessionChanged: () => () => undefined,
    onNotice: () => () => undefined,
    // Ein zweites Gerät spielt keine Fassung ein – das geschieht am Hauptrechner.
    onUpdateProgress: () => () => undefined,
    /* Die Vortragssteuerung ist ein Fenster am Hauptrechner; ein Gerät im Netz
       kann es weder öffnen noch sehen. */
    onPrompterState: (listener) =>
      poll(
        () => remoteInvoke('presentation.prompterState', []) as Promise<PrompterWindowState>,
        listener,
        5000
      ),
    onPrompterView: (listener) =>
      poll(() => remoteInvoke('prompter.view', []) as Promise<PrompterViewState>, listener, 2000),
    onTeleprompterState: (listener) =>
      poll(() => remoteInvoke('prompter.windowState', []) as Promise<PrompterWindowState>, listener, 5000),
    onKameraStand: (listener) =>
      poll(() => remoteInvoke('kamera.stand', []) as Promise<KameraStand>, listener, 3000),
    /*
     * Am zweiten Gerät im Netz gibt es keine Vorschau.
     *
     * Die Bilder lägen nur am Hauptrechner an, und sie über HTTP
     * weiterzureichen hieße, sie neu zu kodieren — auf dem Rechner, der die
     * Wahl führt. Die Kameraliste und das Schalten gehen von hier aus
     * trotzdem; nur das Bild bleibt vorn.
     */
    kameraAn: () => undefined,
    kameraAus: () => undefined
  }
}

export const bridge: Bridge = window.votura ?? pollingBridge()

export function api<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>> {
  return bridge.invoke(method, ...args)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

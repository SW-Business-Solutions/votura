/**
 * Brücke für die Operator-Oberfläche.
 *
 * Es wird ausschließlich ein typisierter Aufrufkanal freigegeben — der
 * Renderer bekommt weder Node-APIs noch direkten Datenbankzugriff.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ModellLadestand } from '@shared/sprachmodell-angebot'
import type { ApiMethod, ApiParams, ApiResult, IpcChannels } from '@shared/ipc'
import type { PrompterWindowState } from '@shared/presentation'
import type { PrompterViewState } from '@shared/speech'
import type { KameraStand } from '@shared/kamera'
import type { AudienceWindowState, ProjectionState } from '@shared/projection'
import type { PrintProgress, Session, UpdateProgress } from '@shared/types'

// Bewusst lokal definiert (kein Import eines geteilten Moduls), damit dieses
// Preload eine eigenständige Datei bleibt und in der Sandbox lädt.
const IPC: IpcChannels = {
  api: 'wz:api',
  printProgress: 'wz:print-progress',
  projectionState: 'wz:projection-state',
  audienceState: 'wz:audience-state',
  sessionChanged: 'wz:session-changed',
  notice: 'wz:notice',
  audienceGetState: 'wz:audience-get-state',
  updateProgress: 'wz:update-progress',
  speechmodelProgress: 'wz:speechmodel-progress',
  prompterCommand: 'wz:prompter-command',
  prompterReport: 'wz:prompter-report',
  beamerSize: 'wz:beamer-size',
  stagesSnapshot: 'wz:stages-snapshot',
  audienceVideoReport: 'wz:audience-video-report',
  prompterState: 'wz:prompter-state',
  prompterView: 'wz:prompter-view',
  teleprompterState: 'wz:teleprompter-state',
  kameraAn: 'wz:kamera-an',
  kameraAus: 'wz:kamera-aus',
  kameraPort: 'wz:kamera-port',
  kameraStand: 'wz:kamera-stand'
}

type IpcAnswer<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>> {
  const answer = (await ipcRenderer.invoke(IPC.api, method, args)) as IpcAnswer<ApiResult<M>>
  if (!answer.ok) throw new Error(answer.error)
  return answer.data
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge = {
  invoke,
  onPrintProgress: (listener: (progress: PrintProgress) => void) =>
    subscribe<PrintProgress>(IPC.printProgress, listener),
  onProjectionState: (listener: (nachricht: { buehne: number; state: ProjectionState }) => void) =>
    subscribe<{ buehne: number; state: ProjectionState }>(IPC.projectionState, listener),
  onAudienceState: (listener: (state: AudienceWindowState) => void) =>
    subscribe<AudienceWindowState>(IPC.audienceState, listener),
  onSessionChanged: (listener: (session: Session | null) => void) =>
    subscribe<Session | null>(IPC.sessionChanged, listener),
  onNotice: (listener: (notice: { level: 'info' | 'warning' | 'error'; message: string }) => void) =>
    subscribe<{ level: 'info' | 'warning' | 'error'; message: string }>(IPC.notice, listener),
  onUpdateProgress: (listener: (progress: UpdateProgress) => void) =>
    subscribe<UpdateProgress>(IPC.updateProgress, listener),
  /** Wie weit das Laden eines Sprachmodells ist. */
  onSpeechmodelProgress: (listener: (stand: ModellLadestand) => void) =>
    subscribe<ModellLadestand>(IPC.speechmodelProgress, listener),
  onPrompterView: (listener: (state: PrompterViewState) => void) =>
    subscribe<PrompterViewState>(IPC.prompterView, listener),
  onTeleprompterState: (listener: (state: PrompterWindowState) => void) =>
    subscribe<PrompterWindowState>(IPC.teleprompterState, listener),
  onPrompterState: (listener: (state: PrompterWindowState) => void) =>
    subscribe<PrompterWindowState>(IPC.prompterState, listener),
  onKameraStand: (listener: (stand: KameraStand) => void) => subscribe<KameraStand>(IPC.kameraStand, listener),
  /**
   * Eine Kamera anfordern — und wieder loslassen.
   *
   * `kanal` unterscheidet mehrere Bilder im selben Fenster: die Vorschau in
   * der Bedienung neben der großen Ansicht.
   */
  kameraAn: (eingabe: { quelle: string; qualitaet?: 'hoch' | 'vorschau'; kanal?: string }): void => {
    ipcRenderer.send(IPC.kameraAn, eingabe)
  },
  kameraAus: (kanal?: string): void => {
    ipcRenderer.send(IPC.kameraAus, { kanal })
  }
}

export type OperatorBridge = typeof bridge

contextBridge.exposeInMainWorld('votura', bridge)

/*
 * Der Port geht **nicht** über die Brücke.
 *
 * `contextBridge` kann einen MessagePort nicht hinüberreichen — er ist kein
 * Wert, der sich kopieren ließe. Der übliche und einzig verlässliche Weg ist
 * `window.postMessage`: Die Seite bekommt dabei einen echten Port, und die
 * Bilder laufen danach an jeder Brücke vorbei.
 */
/*
 * `window` ist im Typbild dieses Prozesses nicht vorgesehen (kein DOM-Lib) —
 * zur Laufzeit gibt es es. Derselbe Umweg wie oben bei `location`.
 */
const seite = globalThis as unknown as {
  postMessage(nachricht: unknown, ziel: string, ports: unknown[]): void
}

ipcRenderer.on(IPC.kameraPort, (ereignis, daten: { kanal: string; quelle: string }) => {
  seite.postMessage({ art: 'votura-kamera', ...daten }, '*', ereignis.ports)
})

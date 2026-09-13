/**
 * Brücke für die Operator-Oberfläche.
 *
 * Es wird ausschließlich ein typisierter Aufrufkanal freigegeben — der
 * Renderer bekommt weder Node-APIs noch direkten Datenbankzugriff.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ApiMethod, ApiParams, ApiResult, IpcChannels } from '@shared/ipc'
import type { PrompterWindowState } from '@shared/presentation'
import type { PrompterViewState } from '@shared/speech'
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
  prompterCommand: 'wz:prompter-command',
  prompterReport: 'wz:prompter-report',
  beamerSize: 'wz:beamer-size',
  stagesSnapshot: 'wz:stages-snapshot',
  audienceVideoReport: 'wz:audience-video-report',
  prompterState: 'wz:prompter-state',
  prompterView: 'wz:prompter-view',
  teleprompterState: 'wz:teleprompter-state'
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
  onPrompterView: (listener: (state: PrompterViewState) => void) =>
    subscribe<PrompterViewState>(IPC.prompterView, listener),
  onTeleprompterState: (listener: (state: PrompterWindowState) => void) =>
    subscribe<PrompterWindowState>(IPC.teleprompterState, listener),
  onPrompterState: (listener: (state: PrompterWindowState) => void) =>
    subscribe<PrompterWindowState>(IPC.prompterState, listener)
}

export type OperatorBridge = typeof bridge

contextBridge.exposeInMainWorld('votura', bridge)

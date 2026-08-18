/**
 * Brücke für die Operator-Oberfläche.
 *
 * Es wird ausschließlich ein typisierter Aufrufkanal freigegeben — der
 * Renderer bekommt weder Node-APIs noch direkten Datenbankzugriff.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ApiMethod, ApiParams, ApiResult, IpcChannels } from '@shared/ipc'
import type { AudienceWindowState, ProjectionState } from '@shared/projection'
import type { PrintProgress, Session } from '@shared/types'

// Bewusst lokal definiert (kein Import eines geteilten Moduls), damit dieses
// Preload eine eigenständige Datei bleibt und in der Sandbox lädt.
const IPC: IpcChannels = {
  api: 'wz:api',
  printProgress: 'wz:print-progress',
  projectionState: 'wz:projection-state',
  audienceState: 'wz:audience-state',
  sessionChanged: 'wz:session-changed',
  notice: 'wz:notice',
  audienceGetState: 'wz:audience-get-state'
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
  onProjectionState: (listener: (state: ProjectionState) => void) =>
    subscribe<ProjectionState>(IPC.projectionState, listener),
  onAudienceState: (listener: (state: AudienceWindowState) => void) =>
    subscribe<AudienceWindowState>(IPC.audienceState, listener),
  onSessionChanged: (listener: (session: Session | null) => void) =>
    subscribe<Session | null>(IPC.sessionChanged, listener),
  onNotice: (listener: (notice: { level: 'info' | 'warning' | 'error'; message: string }) => void) =>
    subscribe<{ level: 'info' | 'warning' | 'error'; message: string }>(IPC.notice, listener)
}

export type OperatorBridge = typeof bridge

contextBridge.exposeInMainWorld('votura', bridge)

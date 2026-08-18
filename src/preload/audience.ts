/**
 * Brücke für die Beamer-/Audience-Ansicht.
 *
 * Bewusst minimal und ausschließlich lesend (Beamer §31): den Zustand holen
 * und Änderungen empfangen. Es gibt keine Methode, die irgendetwas verändert.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels } from '@shared/ipc'
import type { ProjectionState } from '@shared/projection'

// Lokale Kanalnamen (siehe Preload der Operator-Oberfläche): das Audience-
// Preload muss eine eigenständige, sandboxfaehige Datei bleiben.
const CHANNEL_STATE: IpcChannels['projectionState'] = 'wz:projection-state'
const CHANNEL_GET_STATE: IpcChannels['audienceGetState'] = 'wz:audience-get-state'

const bridge = {
  getInitialState: (): Promise<ProjectionState> =>
    ipcRenderer.invoke(CHANNEL_GET_STATE) as Promise<ProjectionState>,
  onStateChange: (callback: (state: ProjectionState) => void): (() => void) => {
    const handler = (_event: unknown, state: ProjectionState): void => callback(state)
    ipcRenderer.on(CHANNEL_STATE, handler)
    return () => ipcRenderer.removeListener(CHANNEL_STATE, handler)
  }
}

export type AudienceBridge = typeof bridge

contextBridge.exposeInMainWorld('projection', bridge)

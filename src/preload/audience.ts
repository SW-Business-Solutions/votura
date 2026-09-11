/**
 * Brücke für die Beamer-/Audience-Ansicht.
 *
 * Bewusst minimal und ausschließlich lesend (Beamer §31): den Zustand holen
 * und Änderungen empfangen. Es gibt keine Methode, die Wahldaten verändert.
 *
 * Eine einzige Nachricht geht hinaus: `reportVideo`. Sie sagt etwas über
 * dieses Fenster aus — Laufzeit der Datei, Pufferstand, Ende erreicht — und
 * nichts über die Wahl. Ohne sie wüsste niemand, wie lang der Film ist: Die
 * Laufzeit steckt im Containerformat und lässt sich nur dort ablesen, wo er
 * geladen wurde.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels } from '@shared/ipc'
import type { ProjectionState } from '@shared/projection'

// Lokale Kanalnamen (siehe Preload der Operator-Oberfläche): das Audience-
// Preload muss eine eigenständige, sandboxfaehige Datei bleiben.
const CHANNEL_STATE: IpcChannels['projectionState'] = 'wz:projection-state'
const CHANNEL_GET_STATE: IpcChannels['audienceGetState'] = 'wz:audience-get-state'
const CHANNEL_VIDEO: IpcChannels['audienceVideoReport'] = 'wz:audience-video-report'

const bridge = {
  getInitialState: (): Promise<ProjectionState> =>
    ipcRenderer.invoke(CHANNEL_GET_STATE) as Promise<ProjectionState>,
  onStateChange: (callback: (state: ProjectionState) => void): (() => void) => {
    const handler = (_event: unknown, state: ProjectionState): void => callback(state)
    ipcRenderer.on(CHANNEL_STATE, handler)
    return () => ipcRenderer.removeListener(CHANNEL_STATE, handler)
  },

  /** Siehe Modulkopf: sagt etwas über dieses Fenster aus, nicht über die Wahl. */
  reportVideo: (meldung: { durationSeconds?: number; ready?: boolean; ended?: boolean }): void => {
    ipcRenderer.send(CHANNEL_VIDEO, meldung)
  }
}

export type AudienceBridge = typeof bridge

contextBridge.exposeInMainWorld('projection', bridge)

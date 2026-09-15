/**
 * Brücke für den Teleprompter am Hauptrechner.
 *
 * Sie darf zweierlei: den Stand lesen und **sich selbst** steuern — anhalten,
 * weiterlaufen, eine Zeile zurück. Das ist kein Widerspruch zur Zurückhaltung
 * der Beameransicht: Wer am Pult steht, muss den eigenen Text bewegen können,
 * und über diese Brücke geht nichts an Wahldaten heran. Die Methoden dafür
 * gibt es hier schlicht nicht.
 *
 * Wie in den anderen Sandbox-Preloads werden Kanalnamen lokal definiert und
 * keine **Werte** aus gemeinsamen Modulen importiert: Ein Wertimport würde
 * beim Bauen zu `require('./chunks/…')`, das die Sandbox nicht auflöst.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ApiMethod, ApiParams, ApiResult, IpcChannels } from '@shared/ipc'
import type { ProjectionState } from '@shared/projection'
import type { PrompterViewState } from '@shared/speech'

const CHANNEL_VIEW: IpcChannels['prompterView'] = 'wz:prompter-view'
const CHANNEL_API: IpcChannels['api'] = 'wz:api'
const CHANNEL_PROJECTION: IpcChannels['projectionState'] = 'wz:projection-state'
const CHANNEL_BEAMER_SIZE: IpcChannels['beamerSize'] = 'wz:beamer-size'

type Antwort<T> = { ok: true; data: T } | { ok: false; error: string }

/** Nur diese Aufrufe — die Liste ist die Grenze, nicht eine Prüfung im Main. */
const ERLAUBT = new Set<string>([
  'prompter.view',
  'prompter.setRunning',
  'prompter.setPosition',
  'prompter.nudge',
  'prompter.setTempo',
  'prompter.setDarstellung',
  'prompter.setAnsicht',
  'prompter.setLaufart',
  /* Nur lesend, und nur, um die laufenden Folien am Pult zu zeigen. */
  'projection.state',
  'projection.buehnen',
  /*
   * Untertitel vom Pult.
   *
   * Hier steht das Mikrofon, wo gesprochen wird — der Hauptrechner steht oft
   * hinten im Saal. Erkannt wird auf diesem Gerät; hinaus gehen zwei Zeilen
   * Text. Der Ton verlässt es nicht, so wenig wie beim Mithören.
   */
  'untertitel.melde'
])

async function rufe<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>> {
  if (!ERLAUBT.has(method)) throw new Error(`Der Teleprompter darf ${String(method)} nicht aufrufen.`)
  const antwort = (await ipcRenderer.invoke(CHANNEL_API, method, args)) as Antwort<ApiResult<M>>
  if (!antwort.ok) throw new Error(antwort.error)
  return antwort.data
}

const bridge = {
  invoke: rufe,
  onViewChange: (callback: (state: PrompterViewState) => void): (() => void) => {
    const handler = (_event: unknown, state: PrompterViewState): void => callback(state)
    ipcRenderer.on(CHANNEL_VIEW, handler)
    return () => ipcRenderer.removeListener(CHANNEL_VIEW, handler)
  },

  /** Was an der Wand steht — für die Vortragsansicht am Pult. */
  onProjectionChange: (
    callback: (nachricht: { buehne: number; state: ProjectionState }) => void
  ): (() => void) => {
    const handler = (_event: unknown, nachricht: { buehne: number; state: ProjectionState }): void =>
      callback(nachricht)
    ipcRenderer.on(CHANNEL_PROJECTION, handler)
    return () => ipcRenderer.removeListener(CHANNEL_PROJECTION, handler)
  },

  /** Größe des Beamerfensters, damit die Folienvorschau im selben Format rechnet. */
  beamerSize: (callback: (size: { width: number; height: number }) => void): (() => void) => {
    const handler = (_event: unknown, size: { width: number; height: number }): void => callback(size)
    ipcRenderer.on(CHANNEL_BEAMER_SIZE, handler)
    return () => ipcRenderer.removeListener(CHANNEL_BEAMER_SIZE, handler)
  }
}

export type TeleprompterBridge = typeof bridge

contextBridge.exposeInMainWorld('teleprompter', bridge)

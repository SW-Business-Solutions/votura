/**
 * Brücke für die Vortragssteuerung.
 *
 * Sie darf mehr als die Beameransicht — aber genau eine Sache: **blättern**.
 * Es gibt keinen Weg zu Wahlgängen, Kandidaten, Druck oder Ergebnissen, und
 * zwar nicht aus Vorsicht, sondern weil die Methoden hier schlicht fehlen
 * (Beamer §2). Wer vorträgt, kann von diesem Fenster aus keinen Wahlgang
 * eröffnen, auch nicht versehentlich.
 *
 * Der Prompter erfährt den Zustand über denselben Kanal wie die
 * Beameransicht — er zeigt ja dasselbe, nur mit einer Folie Vorsprung.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels } from '@shared/ipc'
import type { ProjectionState } from '@shared/projection'

/* Eigene Kanalnamen wie in den anderen Preloads: Eine Sandbox-Datei darf
   keine gemeinsamen Bundle-Teile nachladen. Der Typ prüft sie beim Übersetzen
   gegen die gemeinsame Liste — eine Abweichung fällt sofort auf. */
const CHANNEL_STATE: IpcChannels['projectionState'] = 'wz:projection-state'
const CHANNEL_GET_STATE: IpcChannels['audienceGetState'] = 'wz:audience-get-state'
const CHANNEL_COMMAND: IpcChannels['prompterCommand'] = 'wz:prompter-command'
const CHANNEL_REPORT: IpcChannels['prompterReport'] = 'wz:prompter-report'
const CHANNEL_BEAMER_SIZE: IpcChannels['beamerSize'] = 'wz:beamer-size'

const bridge = {
  getInitialState: (): Promise<ProjectionState> =>
    ipcRenderer.invoke(CHANNEL_GET_STATE) as Promise<ProjectionState>,

  onStateChange: (callback: (state: ProjectionState) => void): (() => void) => {
    const handler = (_event: unknown, state: ProjectionState): void => callback(state)
    ipcRenderer.on(CHANNEL_STATE, handler)
    return () => ipcRenderer.removeListener(CHANNEL_STATE, handler)
  },

  /**
   * Zeige diese Folie (1-basiert).
   *
   * Ohne Rückgabewert: Was daraus wird, kommt über `onStateChange` zurück —
   * denselben Weg, den auch der Beamer geht. Zwei Quellen für dieselbe
   * Wahrheit liefen sonst irgendwann auseinander.
   */
  goto: (slide: number): void => {
    ipcRenderer.send(CHANNEL_COMMAND, { slide })
  },

  /**
   * Reicht weiter, was der Foliensatz über sich meldet.
   *
   * Ohne diesen Weg bliebe die Gesamtzahl unbekannt: Sie steht nirgends im
   * Dokument, sondern ergibt sich erst, wenn dessen Skript gelaufen ist. Die
   * Beameransicht kann sie nicht melden — sie ist rein lesend. Der Prompter
   * laedt denselben Foliensatz und bekommt dieselbe Meldung.
   */
  report: (slide: number, slideCount: number): void => {
    ipcRenderer.send(CHANNEL_REPORT, { slide, slideCount })
  },

  /** Größe des Beamerfensters, damit die Vorschau im selben Format rechnet. */
  onBeamerSize: (callback: (size: { width: number; height: number }) => void): (() => void) => {
    const handler = (_event: unknown, size: { width: number; height: number }): void => callback(size)
    ipcRenderer.on(CHANNEL_BEAMER_SIZE, handler)
    return () => ipcRenderer.removeListener(CHANNEL_BEAMER_SIZE, handler)
  }
}

export type PrompterBridge = typeof bridge

contextBridge.exposeInMainWorld('prompter', bridge)

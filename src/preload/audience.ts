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
import type { Buehne, ProjectionState } from '@shared/projection'

/*
 * Bewusst als Zahl und nicht als Import.
 *
 * Dieses Preload läuft in der Sandbox und darf deshalb nichts nachladen: Ein
 * Wert aus einem gemeinsamen Modul zöge einen zweiten Baustein hinter sich
 * her, den die Sandbox nicht auflösen kann — die Brücke käme dann gar nicht
 * zustande, und die Beameransicht meldete „Verbindung unterbrochen".
 * Der Typ unten prüft beim Übersetzen, dass die Zahl zur Hauptbühne passt.
 */
const HAUPTBUEHNE: Buehne['id'] = 1

// Lokale Kanalnamen (siehe Preload der Operator-Oberfläche): das Audience-
// Preload muss eine eigenständige, sandboxfaehige Datei bleiben.
const CHANNEL_STATE: IpcChannels['projectionState'] = 'wz:projection-state'
const CHANNEL_GET_STATE: IpcChannels['audienceGetState'] = 'wz:audience-get-state'
const CHANNEL_VIDEO: IpcChannels['audienceVideoReport'] = 'wz:audience-video-report'
const CHANNEL_KAMERA_AN: IpcChannels['kameraAn'] = 'wz:kamera-an'
const CHANNEL_KAMERA_AUS: IpcChannels['kameraAus'] = 'wz:kamera-aus'
const CHANNEL_KAMERA_PORT: IpcChannels['kameraPort'] = 'wz:kamera-port'

/*
 * Welche Bühne dieses Fenster zeigt, steht in seiner Adresse — der
 * Hauptprozess hängt sie beim Öffnen an. So weiß das Fenster es vom ersten
 * Bild an und muss nicht erst nachfragen.
 */
const buehne = (() => {
  const suche = (globalThis as { location?: { search?: string } }).location?.search ?? ''
  const roh = Number(new URLSearchParams(suche).get('buehne'))
  return Number.isInteger(roh) && roh > 0 ? roh : HAUPTBUEHNE
})()

const bridge = {
  buehne,
  getInitialState: (): Promise<ProjectionState> =>
    ipcRenderer.invoke(CHANNEL_GET_STATE, buehne) as Promise<ProjectionState>,
  onStateChange: (callback: (state: ProjectionState) => void): (() => void) => {
    const handler = (_event: unknown, nachricht: { buehne: number; state: ProjectionState }): void => {
      /* Fremde Bühnen gehen dieses Fenster nichts an. */
      if (nachricht.buehne === buehne) callback(nachricht.state)
    }
    ipcRenderer.on(CHANNEL_STATE, handler)
    return () => ipcRenderer.removeListener(CHANNEL_STATE, handler)
  },

  /** Siehe Modulkopf: sagt etwas über dieses Fenster aus, nicht über die Wahl. */
  reportVideo: (meldung: { durationSeconds?: number; ready?: boolean; ended?: boolean }): void => {
    ipcRenderer.send(CHANNEL_VIDEO, { ...meldung, stage: buehne })
  },

  /**
   * Dieses Fenster braucht ein Kamerabild — oder keines mehr.
   *
   * Auch das ist keine Aussage über die Wahl, sondern über dieses Fenster:
   * Es sagt, dass es jetzt zeichnen kann. Welche Kamera es zeigt, steht im
   * Zustand und wird hier nicht entschieden.
   */
  kameraAn: (quelle: string, qualitaet: 'hoch' | 'vorschau'): void => {
    ipcRenderer.send(CHANNEL_KAMERA_AN, { quelle, qualitaet, kanal: 'bild' })
  },
  kameraAus: (): void => {
    ipcRenderer.send(CHANNEL_KAMERA_AUS, { kanal: 'bild' })
  }
}

export type AudienceBridge = typeof bridge

contextBridge.exposeInMainWorld('projection', bridge)

/*
 * Der Port geht **nicht** über die Brücke.
 *
 * `contextBridge` kann einen MessagePort nicht hinüberreichen. Der übliche
 * Weg ist `window.postMessage`: Die Seite bekommt einen echten Port, und die
 * Bilder laufen danach unmittelbar vom Empfängerprozess in dieses Fenster —
 * an der Brücke und am Hauptprozess vorbei.
 */
/*
 * `window` ist im Typbild dieses Prozesses nicht vorgesehen (kein DOM-Lib) —
 * zur Laufzeit gibt es es. Derselbe Umweg wie oben bei `location`.
 */
const seite = globalThis as unknown as {
  postMessage(nachricht: unknown, ziel: string, ports: unknown[]): void
}

ipcRenderer.on(CHANNEL_KAMERA_PORT, (ereignis, daten: { kanal: string; quelle: string }) => {
  seite.postMessage({ art: 'votura-kamera', ...daten }, '*', ereignis.ports)
})

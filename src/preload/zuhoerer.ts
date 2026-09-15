/**
 * Brücke für das Zuhörerfenster.
 *
 * Die schmalste Brücke im ganzen Programm, und das mit Absicht: Dieses Fenster
 * hat ein **Mikrofon**. Was es kann, ist genau eines — erkannten Text melden.
 * Es liest keinen Zustand, es kennt keine Wahl, es hat keine Liste erlaubter
 * Aufrufe, weil es nur einen einzigen gibt.
 *
 * Wie in den anderen Sandbox-Preloads wird der Kanalname lokal definiert und
 * kein **Wert** aus gemeinsamen Modulen importiert: Ein Wertimport würde beim
 * Bauen zu `require('./chunks/…')`, das die Sandbox nicht auflöst.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ApiMethod, ApiParams, IpcChannels } from '@shared/ipc'
import type { ProjectionUntertitel } from '@shared/untertitel'

const CHANNEL_API: IpcChannels['api'] = 'wz:api'

type Antwort<T> = { ok: true; data: T } | { ok: false; error: string }

const bridge = {
  /**
   * Erkannten Text melden.
   *
   * Ohne Rückgabe und ohne Fehlerbehandlung nach außen: Der Weg wird viermal
   * je Sekunde benutzt, und ein verlorener Zwischenstand ist nichts, worauf
   * jemand warten würde — der nächste kommt in einem Viertel einer Sekunde.
   */
  melde: (stand: ProjectionUntertitel): void => {
    const methode: ApiMethod = 'untertitel.melde'
    const args = [stand] as unknown as ApiParams<'untertitel.melde'>
    void (ipcRenderer.invoke(CHANNEL_API, methode, args) as Promise<Antwort<void>>).catch(
      () => undefined
    )
  }
}

export type ZuhoererBridge = typeof bridge

contextBridge.exposeInMainWorld('voturaZuhoerer', bridge)

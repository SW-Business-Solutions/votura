/**
 * Kamerabilder auf einem Gerät im Saal.
 *
 * Votura Saal zeigt eine Seite, die vom Hauptrechner kommt — für den Browser
 * ist sie eine ganz normale Netzwerkansicht. Ein Kamerabild kann sie von dort
 * aber nicht bekommen: Es liefe über dieselbe Leitung, über die auch die
 * Abstimmung geht, und müsste vorher neu kodiert werden, ausgerechnet auf dem
 * Rechner, der die Wahl führt.
 *
 * Also empfängt **dieses Gerät selbst**. Es hängt ohnehin im selben Netz wie
 * die Kamera; NDI verlangt nichts weiter als das. Der Hauptrechner sagt nur,
 * **welche** Quelle gemeint ist — das steht im Zustand, den die Seite ohnehin
 * schon hat. Dieselbe Entscheidung wie beim Video und bei der Redezeit:
 * Zustand verschicken, nicht Bilder.
 *
 * Diese Brücke gibt darum genau zwei Dinge frei: „ich brauche jetzt ein Bild"
 * und „ich brauche keines mehr". Sie kann nichts lesen und nichts ändern.
 *
 * NDI® ist eine eingetragene Marke der Vizrt NDI AB.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels } from '@shared/ipc'

// Lokale Kanalnamen: Dieses Preload läuft in der Sandbox und darf nichts
// nachladen — siehe die Brücke der Beameransicht.
const CHANNEL_AN: IpcChannels['kameraAn'] = 'wz:kamera-an'
const CHANNEL_AUS: IpcChannels['kameraAus'] = 'wz:kamera-aus'
const CHANNEL_PORT: IpcChannels['kameraPort'] = 'wz:kamera-port'

contextBridge.exposeInMainWorld('voturaKamera', {
  an: (quelle: string, qualitaet: 'hoch' | 'vorschau'): void => {
    ipcRenderer.send(CHANNEL_AN, { quelle, qualitaet, kanal: 'bild' })
  },
  aus: (): void => {
    ipcRenderer.send(CHANNEL_AUS, { kanal: 'bild' })
  }
})

/*
 * `window` steht im Typbild dieses Prozesses nicht (kein DOM-Lib); zur
 * Laufzeit gibt es es.
 */
const seite = globalThis as unknown as {
  postMessage(nachricht: unknown, ziel: string, ports: unknown[]): void
}

/* Der Port geht nicht über die Brücke — `contextBridge` kann ihn nicht
   kopieren. `window.postMessage` reicht einen echten Port in die Seite. */
ipcRenderer.on(CHANNEL_PORT, (ereignis, daten: { kanal: string; quelle: string }) => {
  seite.postMessage({ art: 'votura-kamera', ...daten }, '*', ereignis.ports)
})

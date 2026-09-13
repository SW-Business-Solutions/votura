/**
 * Brücke der Begleitanwendung — nur für die Einrichtungsseite.
 *
 * Die Anzeige selbst braucht keine: Sie ist eine Seite des Hauptrechners und
 * spricht mit ihm direkt. Hier geht es allein darum, ihn zu finden, die
 * Angaben zu prüfen und sie zu merken.
 *
 * Wie in den anderen Sandbox-Preloads keine **Werte** aus gemeinsamen
 * Modulen: Ein Wertimport würde beim Bauen zu `require('./chunks/…')`, das
 * die Sandbox nicht auflöst.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { SaalEinstellung, SaalFund } from '@shared/saal'

const bridge = {
  /** Was zuletzt eingestellt war — oder nichts beim ersten Start. */
  einstellung: (): Promise<SaalEinstellung | null> => ipcRenderer.invoke('saal:einstellung'),

  /** Ruft ins Netz und sammelt, wer sich meldet. */
  suchen: (): Promise<SaalFund[]> => ipcRenderer.invoke('saal:suchen'),

  /** Prüft Adresse und Token, bevor gespeichert wird. */
  pruefen: (master: string, token: string): Promise<{ ok: boolean; fehler?: string }> =>
    ipcRenderer.invoke('saal:pruefen', master, token),

  /** Speichert und startet neu — siehe Modulkopf der Anwendung. */
  uebernehmen: (einstellung: SaalEinstellung): Promise<void> =>
    ipcRenderer.invoke('saal:uebernehmen', einstellung),

  zuruecksetzen: (): Promise<void> => ipcRenderer.invoke('saal:zuruecksetzen')
}

export type SaalBridge = typeof bridge

contextBridge.exposeInMainWorld('saal', bridge)

/**
 * Typen für `linux-rechte.mjs`.
 *
 * Das Werkzeug selbst ist reines JavaScript — es läuft im Herstellungslauf mit
 * blankem `node`, ohne Übersetzungsschritt. Die Prüfungen sind TypeScript und
 * brauchen deshalb diese Beschreibung.
 */

/** Ein Eintrag, dessen Rechte geändert wurden. */
export interface Rechteaenderung {
  /** Pfad im Archiv, samt Wurzelordner. */
  name: string
  /** Die Rechte, die im Archiv standen. */
  von: number
  /** Die Rechte, die jetzt darin stehen. */
  auf: number
}

/** Setzt die Rechte in einem ausgepackten tar neu. Die Länge bleibt gleich. */
export function richteRechte(tar: Uint8Array): {
  daten: Buffer
  geaendert: Rechteaenderung[]
}

/** Stellt ein `tar.gz` an Ort und Stelle richtig und meldet die Änderungen. */
export function behandleArchiv(pfad: string): Rechteaenderung[]

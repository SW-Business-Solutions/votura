/**
 * Auskunft über das hinterlegte Sprachmodell.
 *
 * Eigene Datei, weil sowohl der Hauptprozess als auch die Oberfläche sie
 * brauchen — und der Prompter-Vertrag sie nicht mitschleppen soll.
 */
export interface SprachmodellInfo {
  /** Ist überhaupt eines da? */
  vorhanden: boolean
  /** Dateiname — er nennt in aller Regel Sprache und Größe. */
  name?: string
  bytes?: number
  /** Mitgeliefert oder selbst hinterlegt. */
  herkunft?: 'paket' | 'eigen'
}

/** Adresse, unter der die Prompterseite das Modell abholt. */
export const SPRACHMODELL_PFAD = '/sprachmodell'

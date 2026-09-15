/**
 * Mithören am Pult: dem Redner im Manuskript folgen.
 *
 * ## Was hier passiert — und was nicht
 *
 * Aufgenommen wird nichts. Das Zuhören selbst steht in
 * `@renderer/sprache/zuhoeren` und gibt Wörter heraus; hier werden sie mit dem
 * Manuskript abgeglichen. Nach außen wandert allein eine Zahl: die Stelle im
 * Text.
 *
 * ## Warum ein kleines Modell genügt
 *
 * Die Erkennung muss nicht diktieren, sondern **wiederfinden**. Der Text steht
 * bereits da; gesucht wird nur, wo darin gerade gesprochen wird. Ein paar
 * halbwegs erkannte Wörter reichen dafür — siehe `@shared/mitlauf`.
 *
 * Für Untertitel gilt das ausdrücklich **nicht**: Die zeigen jeden Irrtum der
 * Erkennung, weil ihnen kein Text zum Wiederfinden zur Seite steht.
 */
import { mitlaufStelle, wortfolge } from '@shared/mitlauf'
import { redeWortfolge } from '@shared/speech'
import { starteZuhoeren, type ZuhoerenStand } from '../sprache/zuhoeren'

/** Wie viele zuletzt gehörte Wörter für den Abgleich herangezogen werden. */
const GEDAECHTNIS = 12

export type MithoerenStand = ZuhoerenStand

export interface MithoerenOptionen {
  /** Das Manuskript, in dem gesucht wird. */
  manuskript: string
  /** Wo der Prompter gerade steht (Wortindex) — wird laufend nachgereicht. */
  stand: () => number
  /** Meldet eine neue Stelle. */
  aufStelle: (position: number) => void
  /** Meldet, wie es dem Mithören geht. */
  aufStand: (stand: MithoerenStand) => void
}

/** Läuft, bis `beenden()` gerufen wird. */
export interface Mithoeren {
  beenden(): void
}

export async function starteMithoeren(optionen: MithoerenOptionen): Promise<Mithoeren> {
  /* Hinweise in eckigen Klammern stehen nicht darin: Die Erkennung suchte
     sonst nach Wörtern, die niemand spricht. */
  const manuskript = redeWortfolge(optionen.manuskript)
  /* Die zuletzt gehörten Wörter — mehr braucht der Abgleich nicht, und mehr
     machte ihn nur träge. */
  let gehoert: string[] = []

  return starteZuhoeren({
    aufStand: optionen.aufStand,
    /*
     * Beide Meldungen zählen.
     *
     * Der Zwischenstand kommt schon während des Sprechens und hält den
     * Prompter in Bewegung; der endgültige Satz ist genauer. Nur auf das Ende
     * zu warten, ließe den Text satzweise ruckeln — deshalb wird hier nicht
     * unterschieden.
     */
    aufText: (text) => {
      const neu = wortfolge(text)
      if (neu.length === 0) return
      gehoert = [...gehoert, ...neu].slice(-GEDAECHTNIS)
      optionen.aufStelle(mitlaufStelle(manuskript, gehoert, optionen.stand()))
    }
  })
}

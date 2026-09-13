/**
 * Mitlaufen nach Gehör: gesprochene Wörter auf die Stelle im Manuskript.
 *
 * ## Warum das leichter ist, als es klingt
 *
 * Eine Spracherkennung, die aus dem Nichts diktieren soll, muss jedes Wort
 * richtig treffen. Hier ist der Text **bekannt** — gesucht wird nicht, *was*
 * gesagt wurde, sondern *wo im Manuskript* es steht. Dafür genügen wenige
 * halbwegs erkannte Wörter, und ein kleines Modell reicht aus.
 *
 * ## Wie gesucht wird
 *
 * Nur in einem **Fenster um die aktuelle Stelle**, nicht im ganzen Text. Das
 * hat zwei Gründe:
 *
 * 1. Reden wiederholen sich. „Liebe Mitglieder" steht oft dreimal darin; ohne
 *    Fenster spränge der Prompter beim dritten Vorkommen an den Anfang.
 * 2. Es ist billig. Ein Fenster von wenigen hundert Wörtern lässt sich
 *    mehrmals je Sekunde durchsehen, ein ganzes Manuskript nicht.
 *
 * Das Fenster reicht bewusst weiter nach vorn als zurück: Übersprungen wird
 * häufiger als zurückgesprungen — wer einen Absatz auslässt, tut das meist
 * absichtlich, wer zurückspringt, hat sich verhaspelt.
 *
 * ## Wann geglaubt wird
 *
 * Ein Treffer zählt erst, wenn genug aufeinanderfolgende Wörter passen.
 * Einzelne Wörter wie „und" oder „die" stehen überall; auf sie zu springen,
 * machte den Prompter unruhiger als gar keine Erkennung.
 */

/** Wie weit vor und zurück gesucht wird (in Wörtern). */
export const FENSTER_ZURUECK = 40
export const FENSTER_VOR = 160

/** So viele Wörter müssen zusammenpassen, damit ein Treffer zählt. */
export const TREFFER_MINDESTENS = 3

/**
 * Vergleichsform eines Wortes.
 *
 * Kleingeschrieben, ohne Satzzeichen, Umlaute aufgelöst: Eine Erkennung
 * liefert „muessen", das Manuskript schreibt „müssen" — und „Mitglieder,"
 * soll auf „Mitglieder" passen. Zahlen bleiben, sie sind oft der markanteste
 * Anker in einem Bericht.
 */
export function normalisiere(wort: string): string {
  return wort
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** Zerlegt einen Text in vergleichbare Wörter. */
export function wortfolge(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalisiere)
    .filter((wort) => wort.length > 0)
}

export interface MitlaufTreffer {
  /** Wortindex im Manuskript, an dem weitergelesen wird. */
  position: number
  /** Wie viele Wörter zusammenpassten. */
  treffer: number
}

/**
 * Sucht die zuletzt gesprochene Stelle im Manuskript.
 *
 * `gehoert` sind die letzten erkannten Wörter in der Reihenfolge, in der sie
 * fielen. Zurück kommt die Stelle **hinter** dem letzten passenden Wort —
 * dort geht es weiter, und genau dorthin soll der Text rücken.
 *
 * Bewertet wird jede mögliche Ausrichtung im Fenster: Wie viele der gehörten
 * Wörter stehen dort in derselben Reihenfolge? Lücken sind erlaubt, denn eine
 * Erkennung verschluckt Wörter — nur die Reihenfolge muss stimmen.
 */
export function findeStelle(
  manuskript: string[],
  gehoert: string[],
  stand: number
): MitlaufTreffer | undefined {
  if (manuskript.length === 0 || gehoert.length === 0) return undefined

  const von = Math.max(0, Math.floor(stand) - FENSTER_ZURUECK)
  const bis = Math.min(manuskript.length, Math.floor(stand) + FENSTER_VOR)

  let bester: MitlaufTreffer | undefined

  for (let start = von; start < bis; start++) {
    /* Von dieser Stelle aus die gehörten Wörter der Reihe nach abhaken. */
    let stelle = start
    let treffer = 0
    let letzte = start
    for (const wort of gehoert) {
      /* Kleine Lücke überspringen: Erkennungen verschlucken Wörter, und ein
         Manuskript enthält Einschübe, die niemand mitspricht. */
      const grenze = Math.min(bis, stelle + 4)
      let gefunden = -1
      for (let index = stelle; index < grenze; index++) {
        if (manuskript[index] === wort) {
          gefunden = index
          break
        }
      }
      if (gefunden < 0) continue
      treffer++
      stelle = gefunden + 1
      letzte = gefunden + 1
    }
    if (treffer >= TREFFER_MINDESTENS && (!bester || treffer > bester.treffer)) {
      bester = { position: letzte, treffer }
    }
    /* Alle gehörten Wörter getroffen — besser wird es nicht. */
    if (bester?.treffer === gehoert.length) break
  }

  return bester
}

/**
 * Die neue Stelle, oder der alte Stand, wenn nichts überzeugt.
 *
 * Bewusst nachsichtig: Lieber steht der Text einen Moment still, als dass er
 * auf ein zufälliges „und die" springt. Wer stehenbleibt, liest weiter; wer
 * springt, verliert die Zeile.
 */
export function mitlaufStelle(manuskript: string[], gehoert: string[], stand: number): number {
  return findeStelle(manuskript, gehoert, stand)?.position ?? stand
}

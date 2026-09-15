/**
 * Untertitel im Saal — was gesprochen wird, mitlesbar an der Wand.
 *
 * ## Wofür
 *
 * Zuerst für die, die schlecht hören. Eine Mitgliederversammlung ist der Ort,
 * an dem über Ämter und Anträge entschieden wird; wer den Wortbeitrag nicht
 * versteht, kann nicht mitentscheiden. Untertitel sind deshalb keine Spielerei,
 * sondern die Bedingung dafür, dass Teilhabe nicht am Gehör scheitert.
 *
 * Und dann für alle anderen: In einem halligen Saal mit einer schlechten
 * Anlage liest jeder mit.
 *
 * ## Die Technik ist schon da
 *
 * Erkannt wird mit demselben Sprachmodell, das der Prompter benutzt, um dem
 * Redner nach Gehör zu folgen — dieselbe Aufnahme, dieselbe Rechnung. Der
 * Unterschied ist, was hinten herauskommt: Der Prompter sucht eine **Stelle**
 * in einem bekannten Text, die Untertitel nehmen den **Text** selbst.
 *
 * Das macht sie auch schwächer. Der Prompter braucht nur ein paar halbwegs
 * erkannte Wörter, um sich zurechtzufinden; ein Untertitel zeigt jeden
 * Irrtum. Deshalb steht in der Anleitung, was das kleine mitgelieferte Modell
 * leistet und was nicht — und deshalb lässt sich ein größeres hinterlegen.
 *
 * ## Aufgezeichnet wird nichts
 *
 * Wie beim Mithören: Der Ton geht in die Erkennung und ist danach weg. Der
 * erkannte Text steht im Beamerzustand, solange er an der Wand steht, und
 * nirgends sonst — keine Datei, kein Protokoll, kein Nachschlagen hinterher.
 * Ein Wortprotokoll wäre etwas anderes, und etwas, das eine Versammlung
 * ausdrücklich beschließen müsste.
 */

/** Wie viele Zeilen gleichzeitig stehen. */
export const UNTERTITEL_ZEILEN = 2

/**
 * Wie viele Zeichen in eine Zeile passen.
 *
 * Nicht aus dem Layout gerechnet, sondern aus der Leseentfernung: Zwei kurze
 * Zeilen liest das Auge im Vorbeisehen, eine lange nicht. Der Wert ist
 * derselbe, den Fernsehuntertitel seit Jahrzehnten benutzen.
 */
export const UNTERTITEL_ZEICHEN_JE_ZEILE = 42

/**
 * Wie lange der letzte Satz nach dem Verstummen stehen bleibt.
 *
 * Lang genug, um ihn zu Ende zu lesen; kurz genug, dass an der Wand nicht
 * minutenlang ein Satz steht, den längst niemand mehr spricht. Wer eine
 * Kunstpause macht, verliert seinen Satz nicht.
 */
export const UNTERTITEL_STILLE_MS = 6000

/**
 * Wie oft der Zustand höchstens nachgeführt wird.
 *
 * Die Erkennung meldet Zwischenstände im Takt der Silben. Jede einzelne durch
 * die Leitungen an jeden Bildschirm zu schicken, hieße, den Beamerzustand
 * vielmals je Sekunde zu erneuern — für einen Text, den ohnehin niemand so
 * schnell liest. Viermal je Sekunde wirkt flüssig und kostet nichts.
 */
export const UNTERTITEL_TAKT_MS = 250

/** Was an der Wand steht. */
export interface ProjectionUntertitel {
  /**
   * Die Zeilen, fertig umbrochen — höchstens `UNTERTITEL_ZEILEN`.
   *
   * Umbrochen wird **hier** und nicht in der Ansicht: Sonst bräche jeder
   * Bildschirm nach seiner eigenen Breite um, und der Saal läse auf zwei
   * Wänden zwei verschiedene Bilder desselben Satzes.
   */
  zeilen: string[]
  /**
   * Der Teil, der noch im Fluss ist.
   *
   * Die Erkennung liefert erst einen Zwischenstand und später den
   * berichtigten Satz. Beides gleich auszuzeichnen hieße, eine Sicherheit zu
   * behaupten, die noch nicht da ist — der Zwischenstand wird deshalb
   * blasser gezeigt und nicht als Wahrheit.
   */
  vorlaeufigAbWort?: number
  /**
   * Welches Gerät zuhört.
   *
   * `hauptrechner` — das versteckte Zuhörerfenster am Rechner, an dem die
   * Versammlung geführt wird. Der Regelfall, und der einzige, der ohne
   * weiteres Gerät auskommt.
   *
   * `pult` — das Pult: das Prompterfenster, gleich ob am Hauptrechner oder
   * auf einem Saalgerät am Rednerpult. Dort steht das Mikrofon, wo
   * gesprochen wird; der Hauptrechner steht oft hinten im Saal oder im
   * Nebenraum und hört nur Hall.
   *
   * Die Angabe steht **im Zustand** und nicht in den Einstellungen, weil
   * jedes Gerät sie sehen muss: Das Pult erfährt daran, dass es zuhören
   * soll, und der Hauptrechner, dass er es lassen kann. Zwei Geräte, die
   * gleichzeitig zuhören, schrieben zwei Untertitelspuren übereinander.
   */
  quelle?: Untertitelquelle
}

export type Untertitelquelle = 'hauptrechner' | 'pult'

export const UNTERTITELQUELLE_LABELS: Record<Untertitelquelle, string> = {
  hauptrechner: 'Hauptrechner',
  pult: 'Pult (Prompterfenster oder Saalgerät)'
}

/**
 * Bricht einen Text in Zeilen um und behält die letzten.
 *
 * Gierig von links, an Wortgrenzen; ein Wort, das allein zu lang ist, bekommt
 * seine Zeile und wird nicht zerschnitten — ein zerschnittenes Wort liest sich
 * schlechter als ein überstehendes.
 */
export function untertitelZeilen(
  text: string,
  zeichenJeZeile = UNTERTITEL_ZEICHEN_JE_ZEILE,
  zeilen = UNTERTITEL_ZEILEN
): string[] {
  const woerter = text.trim().split(/\s+/).filter(Boolean)
  if (woerter.length === 0) return []

  const alle: string[] = []
  let laufend = ''
  for (const wort of woerter) {
    const versuch = laufend ? `${laufend} ${wort}` : wort
    if (versuch.length <= zeichenJeZeile || laufend === '') {
      laufend = versuch
    } else {
      alle.push(laufend)
      laufend = wort
    }
  }
  if (laufend) alle.push(laufend)

  return alle.slice(-zeilen)
}

/**
 * Setzt aus dem sicheren und dem vorläufigen Teil zusammen, was zu sehen ist.
 *
 * `sicher` ist, was die Erkennung abgeschlossen hat, `vorlaeufig` der
 * Zwischenstand des laufenden Satzes. Beides wird hintereinandergehängt und
 * dann auf die letzten Zeilen gekürzt — das Ende ist das Interessante, der
 * Anfang ist schon gelesen.
 */
export function untertitelBilden(sicher: string, vorlaeufig: string): ProjectionUntertitel {
  const ganz = `${sicher} ${vorlaeufig}`.replace(/\s+/g, ' ').trim()
  const zeilen = untertitelZeilen(ganz)
  if (zeilen.length === 0) return { zeilen: [] }

  /*
   * Ab welchem Wort der vorläufige Teil beginnt — gezählt in dem, was
   * übrigbleibt.
   *
   * Der Anfang wird beim Kürzen abgeschnitten, und damit verschiebt sich die
   * Grenze. Sie hier auszurechnen erspart der Ansicht, denselben Umbruch ein
   * zweites Mal nachzuvollziehen.
   */
  const sichtbar = zeilen.join(' ').split(' ').filter(Boolean).length
  const vorlaeufigeWoerter = vorlaeufig.trim().split(/\s+/).filter(Boolean).length
  const abWort = Math.max(0, sichtbar - vorlaeufigeWoerter)

  return vorlaeufigeWoerter > 0 ? { zeilen, vorlaeufigAbWort: abWort } : { zeilen }
}

/**
 * Hält den sicheren Teil kurz.
 *
 * Nur so viel Text wird behalten, wie an die Wand passt. Ein Puffer, der die
 * ganze Rede sammelt, wächst eine Stunde lang mit — und wäre nebenbei genau
 * das Wortprotokoll, das hier ausdrücklich nicht entstehen soll.
 */
export function untertitelKuerzen(
  sicher: string,
  zeichenJeZeile = UNTERTITEL_ZEICHEN_JE_ZEILE,
  zeilen = UNTERTITEL_ZEILEN
): string {
  return untertitelZeilen(sicher, zeichenJeZeile, zeilen).join(' ')
}

/* ------------------------------------------------------- Großschreibung */

/**
 * Die Erkennung schreibt alles klein — und daran lässt sich nur begrenzt
 * etwas ändern.
 *
 * ## Was nicht geht
 *
 * Deutsche Rechtschreibung aus einem Erkennungsergebnis zurückzugewinnen,
 * hieße Substantive zu erkennen. Dafür bräuchte es eine Wortartenanalyse, und
 * die läge daneben: „Das **Essen** war gut" gegen „wir wollen gleich
 * **essen**" ist ohne Satzbau nicht zu trennen. Eine Regel, die rät, schriebe
 * an der Wand Wörter groß, die klein gehören — und das sähe schlimmer aus als
 * durchgehende Kleinschreibung, weil es nach Absicht aussieht.
 *
 * ## Was geht
 *
 * **Namen, die Votura ohnehin kennt.** Wer da vorne steht, wer auf der
 * Kandidatenliste steht, wie der Verband heißt — das steht in der Datenbank
 * und muss nicht geraten werden. „clara fenske" wird zu „Clara Fenske", weil
 * Votura diese Person kennt, nicht weil eine Regel es vermutet.
 *
 * Und der **Anfang**: Der erste Buchstabe des Sichtbaren wird groß.
 *
 * ## Warum nur die Schreibweise, nie die Länge
 *
 * Umbrochen ist der Text zu diesem Zeitpunkt bereits — in Zeilen, die auf die
 * Wand passen. Würde hier ein Wort länger, stimmte der Umbruch nicht mehr,
 * und die letzte Zeile liefe über den Rand. Deshalb werden ausschließlich
 * Groß- und Kleinbuchstaben getauscht; ein Ersatz mit abweichender Länge wird
 * verworfen.
 */
export function namenGrossschreiben(zeilen: string[], bekannt: string[]): string[] {
  if (zeilen.length === 0) return zeilen

  /*
   * Ein Verzeichnis von klein nach richtig, Wort für Wort.
   *
   * Auch mehrteilige Namen zerfallen hier in einzelne Wörter: „Clara" und
   * „Fenske" werden getrennt erkannt, weil die Erkennung sie getrennt
   * ausgibt — und weil zwischen ihnen ein Zeilenumbruch liegen kann.
   */
  const verzeichnis = new Map<string, string>()
  for (const eintrag of bekannt) {
    for (const wort of eintrag.split(/\s+/)) {
      const sauber = wort.replace(/[^\p{L}\p{N}-]/gu, '')
      if (sauber.length < 3) continue
      verzeichnis.set(sauber.toLocaleLowerCase('de'), sauber)
    }
  }

  const ersetzt = zeilen.map((zeile) =>
    zeile.replace(/\p{L}[\p{L}\p{N}-]*/gu, (wort) => {
      const treffer = verzeichnis.get(wort.toLocaleLowerCase('de'))
      /* Nur wenn sich die Länge nicht ändert — sonst bräche der Umbruch. */
      return treffer && treffer.length === wort.length ? treffer : wort
    })
  )

  /* Der erste Buchstabe des Sichtbaren. */
  const erste = ersetzt.findIndex((zeile) => /\p{L}/u.test(zeile))
  if (erste >= 0) {
    ersetzt[erste] = ersetzt[erste].replace(/\p{L}/u, (buchstabe) =>
      buchstabe.toLocaleUpperCase('de')
    )
  }
  return ersetzt
}

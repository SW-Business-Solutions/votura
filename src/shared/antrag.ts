/**
 * Anträge — das Antragsbuch einer Versammlung.
 *
 * ## Was bisher fehlte
 *
 * „Antrag" war in Votura eine **Abstimmungsart**: ein Wahlgang mit einem
 * Beschlusstext im Stimmzettel. Das genügt, solange über genau einen Text
 * abgestimmt wird. Eine Versammlung, auf der wirklich Anträge behandelt
 * werden, sieht anders aus:
 *
 * - Anträge haben eine **Nummer** und einen **Antragsteller**, und beides
 *   steht später im Protokoll.
 * - Zu einem Antrag gibt es **Änderungsanträge**, und über die wird
 *   **zuerst** abgestimmt — in einer Reihenfolge, die die Versammlungsleitung
 *   festlegt.
 * - Ein Änderungsantrag kann vom Antragsteller **übernommen** werden. Dann
 *   wird über ihn nicht abgestimmt; sein Text wird Teil des Hauptantrags.
 * - Am Ende steht ein **Beschlusstext**, und der ist das Einzige, was die
 *   Versammlung wirklich beschlossen hat.
 *
 * ## Was diese Datei entscheidet — und was nicht
 *
 * Sie rechnet die **Reihenfolge** aus und setzt den **Beschlusstext**
 * zusammen. Was sie nicht entscheidet: welcher Änderungsantrag
 * „weitergehend" ist. Das ist eine Wertung, keine Rechnung — zwei Anträge
 * können sich in verschiedene Richtungen weiter vom Original entfernen, und
 * welche Richtung zählt, entscheidet die Versammlungsleitung.
 *
 * Votura hält deshalb eine **Reihenfolge**, die sich von Hand setzen lässt,
 * und schlägt als Vorgabe die Reihenfolge des Eingangs vor. Ein Programm, das
 * hier selbst sortierte, hätte eine Entscheidung getroffen, die anfechtbar
 * ist — und zwar unsichtbar.
 */

export type Antragsart =
  /** Ein Antrag zur Sache. */
  | 'haupt'
  /** Ein Änderungsantrag zu einem Hauptantrag. */
  | 'aenderung'

export type Antragsstatus =
  /** Eingereicht, noch nicht behandelt. */
  | 'eingereicht'
  /** Zur Abstimmung zugelassen. */
  | 'zugelassen'
  /** Vom Antragsteller des Hauptantrags übernommen — keine eigene Abstimmung. */
  | 'uebernommen'
  /** Vom Antragsteller zurückgezogen. */
  | 'zurueckgezogen'
  /**
   * Erledigt, ohne dass abgestimmt wurde.
   *
   * Der häufigste Fall: Ein weitergehender Änderungsantrag wurde angenommen,
   * und damit ist der weniger weitgehende gegenstandslos.
   */
  | 'erledigt'
  /** Angenommen. */
  | 'beschlossen'
  /** Abgelehnt. */
  | 'abgelehnt'

export const ANTRAGSSTATUS_LABELS: Record<Antragsstatus, string> = {
  eingereicht: 'Eingereicht',
  zugelassen: 'Zugelassen',
  uebernommen: 'Übernommen',
  zurueckgezogen: 'Zurückgezogen',
  erledigt: 'Erledigt',
  beschlossen: 'Beschlossen',
  abgelehnt: 'Abgelehnt'
}

/** Über diese Stände wird noch abgestimmt. */
const OFFEN: Antragsstatus[] = ['eingereicht', 'zugelassen']

export interface Antrag {
  id: string
  eventId: string
  art: Antragsart
  /** Freie Kennung, etwa „A 14" — sie steht später im Protokoll. */
  nummer: string
  titel: string
  text: string
  /** Wer ihn gestellt hat. Steht im Protokoll und entscheidet über Übernahme. */
  antragsteller: string
  /** Optionale Begründung — sie wird nicht mitbeschlossen. */
  begruendung?: string
  status: Antragsstatus
  /** Bei `aenderung`: der Hauptantrag, auf den er sich bezieht. */
  bezugId?: string
  /**
   * Platz in der Abstimmungsreihenfolge unter den Änderungsanträgen.
   *
   * Kleiner heißt früher. Die Vorgabe ist der Eingang; die
   * Versammlungsleitung ordnet um, wenn ein anderer weiter geht.
   */
  reihenfolge: number
  /** Der Wahlgang, in dem darüber abgestimmt wurde — sobald es einen gibt. */
  roundId?: string
  /** Warum er erledigt oder zurückgezogen ist. */
  vermerk?: string
  createdAt: string
}

/** Ein Schritt in der Abstimmungsreihenfolge. */
export interface Abstimmungsschritt {
  antrag: Antrag
  /** Der wievielte Schritt, bei 1 beginnend. */
  schritt: number
  /** Warum er an dieser Stelle steht. */
  grund: string
}

/**
 * Die Reihenfolge, in der abgestimmt wird.
 *
 * **Änderungsanträge zuerst, der Hauptantrag zuletzt.** Das ist keine
 * Geschmacksfrage: Über den Hauptantrag wird in der Fassung abgestimmt, die
 * er nach den Änderungen hat — also müssen die Änderungen vorher entschieden
 * sein.
 *
 * Draußen bleiben die, über die nicht mehr abgestimmt wird: übernommene,
 * zurückgezogene, erledigte und bereits entschiedene.
 */
export function abstimmungsreihenfolge(haupt: Antrag, aenderungen: Antrag[]): Abstimmungsschritt[] {
  const offen = aenderungen
    .filter((antrag) => antrag.bezugId === haupt.id)
    .filter((antrag) => OFFEN.includes(antrag.status))
    .sort((a, b) => a.reihenfolge - b.reihenfolge || a.nummer.localeCompare(b.nummer, 'de'))

  const schritte: Abstimmungsschritt[] = offen.map((antrag, i) => ({
    antrag,
    schritt: i + 1,
    grund:
      i === 0
        ? 'Änderungsanträge werden vor dem Hauptantrag abgestimmt.'
        : 'Nächster Änderungsantrag in der festgelegten Reihenfolge.'
  }))

  if (OFFEN.includes(haupt.status)) {
    schritte.push({
      antrag: haupt,
      schritt: schritte.length + 1,
      grund:
        offen.length > 0
          ? 'Der Hauptantrag zuletzt — in der Fassung, die er nach den Änderungen hat.'
          : 'Der Hauptantrag; es stehen keine Änderungsanträge mehr aus.'
    })
  }

  return schritte
}

/**
 * Der Text, über den abgestimmt wird.
 *
 * Übernommene und beschlossene Änderungsanträge gehören dazu — sie sind Teil
 * des Antrags geworden. Votura **verschmilzt** die Texte nicht ineinander:
 * Das ginge nur mit einer Vermutung darüber, welche Stelle gemeint ist, und
 * eine falsch geratene Stelle wäre ein verfälschter Beschluss.
 *
 * Stattdessen stehen sie untereinander, benannt und zurückverfolgbar. Wer den
 * Beschluss ins Protokoll überträgt, sieht, woraus er besteht.
 */
export function beschlusstext(haupt: Antrag, aenderungen: Antrag[]): string {
  const uebernommen = aenderungen
    .filter((antrag) => antrag.bezugId === haupt.id)
    .filter((antrag) => antrag.status === 'uebernommen' || antrag.status === 'beschlossen')
    .sort((a, b) => a.reihenfolge - b.reihenfolge)

  if (uebernommen.length === 0) return haupt.text

  const teile = [
    haupt.text,
    '',
    uebernommen.length === 1 ? 'Mit folgender Änderung:' : 'Mit folgenden Änderungen:'
  ]
  for (const antrag of uebernommen) {
    const wie = antrag.status === 'uebernommen' ? 'übernommen' : 'beschlossen'
    teile.push('', `${antrag.nummer} (${antrag.antragsteller}, ${wie}):`, antrag.text)
  }
  return teile.join('\n')
}

/**
 * Darf dieser Änderungsantrag übernommen werden?
 *
 * Übernehmen kann nur, wer den Hauptantrag gestellt hat — und nur, solange
 * über den Änderungsantrag noch nicht abgestimmt wurde. Danach ist es keine
 * Übernahme mehr, sondern eine Änderung des Ergebnisses.
 */
export function darfUebernehmen(aenderung: Antrag, haupt: Antrag): { erlaubt: boolean; grund: string } {
  if (aenderung.art !== 'aenderung') {
    return { erlaubt: false, grund: 'Nur Änderungsanträge lassen sich übernehmen.' }
  }
  if (aenderung.bezugId !== haupt.id) {
    return { erlaubt: false, grund: 'Der Änderungsantrag bezieht sich auf einen anderen Antrag.' }
  }
  if (!OFFEN.includes(aenderung.status)) {
    return {
      erlaubt: false,
      grund: `Über diesen Änderungsantrag ist bereits entschieden (${ANTRAGSSTATUS_LABELS[aenderung.status].toLowerCase()}).`
    }
  }
  if (!OFFEN.includes(haupt.status)) {
    return { erlaubt: false, grund: 'Über den Hauptantrag ist bereits entschieden.' }
  }
  return {
    erlaubt: true,
    grund: `${haupt.antragsteller} übernimmt den Änderungsantrag; über ihn wird dann nicht abgestimmt.`
  }
}

/**
 * Sortiert Antragsnummern so, wie ein Mensch sie erwartet.
 *
 * „A 10" gehört hinter „A 9" und nicht dazwischen. Die eingebaute
 * Zeichenkettensortierung stellt es umgekehrt — und auf einem Antragsbuch mit
 * dreißig Nummern fällt das sofort auf.
 */
export function nachNummer(a: Antrag, b: Antrag): number {
  return a.nummer.localeCompare(b.nummer, 'de', { numeric: true, sensitivity: 'base' })
}

/* ------------------------------------------------------- Auf dem Beamer */

/**
 * Was vom Antrag an der Wand steht.
 *
 * Bewusst **flach und fertig**: Der Beamer bekommt Text, keine Kennungen zum
 * Nachschlagen. Er hat keinen Zugriff auf das Antragsbuch und soll auch
 * keinen haben — dieselbe Regel wie beim Wahlgang.
 */
export interface ProjectionAntrag {
  nummer: string
  titel: string
  antragsteller: string
  /** Der Text, Seite für Seite — umbrochen in `antragSeiten`. */
  seiten: string[]
  /** Welche Seite gezeigt wird, bei 0 beginnend. */
  seite: number
  /**
   * Der Schritt in der Abstimmungsreihenfolge, wenn es einen gibt.
   *
   * „Änderungsantrag 1 von 2" sagt dem Saal, wo er sich befindet — und der
   * Versammlungsleitung, was noch kommt. Ohne diese Zeile ist ein Antrag an
   * der Wand nur ein Text.
   */
  schritt?: { nummer: number; von: number }
  /** Steht der Text schon samt übernommener Änderungen da? */
  mitAenderungen: boolean
}

/**
 * Wie viele Zeilen auf eine Beamerseite passen.
 *
 * Nicht aus dem Layout gerechnet, sondern aus der Leseentfernung: Ein
 * Antragstext an der Wand muss aus der letzten Reihe lesbar sein, und dann
 * bleiben ungefähr so viele Zeilen. Lieber eine Seite mehr als eine Schrift,
 * die keiner entziffert.
 */
export const ANTRAG_ZEILEN_JE_SEITE = 14

/** Wie viele Zeichen eine Zeile an der Wand fasst. */
export const ANTRAG_ZEICHEN_JE_ZEILE = 64

/**
 * Bricht einen Antragstext in Beamerseiten.
 *
 * ## Warum hier und nicht in der Ansicht
 *
 * Weil sonst jede Wand nach ihrer eigenen Breite umbräche — und „Seite 2 von
 * 3" auf der einen etwas anderes hieße als auf der anderen. Der Seitenzähler
 * muss überall dasselbe bedeuten, auch in der Vorschau der Bedienung.
 *
 * ## Warum Absätze nicht zerrissen werden, wo es sich vermeiden lässt
 *
 * Ein Antragstext ist gegliedert: Absätze, Aufzählungen, Spiegelstriche. Ein
 * Umbruch mitten in einer Aufzählung liest sich wie ein anderer Antrag.
 * Deshalb wird an Absatzgrenzen umbrochen, solange der Absatz auf eine Seite
 * passt — und erst darin an Zeilengrenzen, wenn er es nicht tut.
 */
export function antragSeiten(
  text: string,
  zeilenJeSeite = ANTRAG_ZEILEN_JE_SEITE,
  zeichenJeZeile = ANTRAG_ZEICHEN_JE_ZEILE
): string[] {
  /* Erst jeden Absatz in Zeilen brechen, dann Zeilen zu Seiten bündeln. */
  const absaetze = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const bloecke: string[][] = absaetze.map((absatz) => umbrechen(absatz, zeichenJeZeile))

  const seiten: string[] = []
  let laufend: string[] = []
  const abschliessen = (): void => {
    if (laufend.length > 0) seiten.push(laufend.join('\n').trimEnd())
    laufend = []
  }

  for (const block of bloecke) {
    /* Ein Absatz, der für sich genommen zu groß ist, wird aufgeteilt —
       daran führt kein Weg vorbei. */
    if (block.length > zeilenJeSeite) {
      abschliessen()
      for (let i = 0; i < block.length; i += zeilenJeSeite) {
        seiten.push(block.slice(i, i + zeilenJeSeite).join('\n').trimEnd())
      }
      continue
    }
    /* +1 für die Leerzeile zwischen zwei Absätzen. */
    const braucht = block.length + (laufend.length > 0 ? 1 : 0)
    if (laufend.length + braucht > zeilenJeSeite) abschliessen()
    if (laufend.length > 0) laufend.push('')
    laufend.push(...block)
  }
  abschliessen()

  return seiten.length > 0 ? seiten : ['']
}

/** Gierig an Wortgrenzen; ein zu langes Wort bekommt seine Zeile. */
function umbrechen(absatz: string, zeichenJeZeile: number): string[] {
  const zeilen: string[] = []
  for (const roh of absatz.split('\n')) {
    const woerter = roh.trim().split(/\s+/).filter(Boolean)
    if (woerter.length === 0) {
      zeilen.push('')
      continue
    }
    let laufend = ''
    for (const wort of woerter) {
      const versuch = laufend ? `${laufend} ${wort}` : wort
      if (versuch.length <= zeichenJeZeile || laufend === '') {
        laufend = versuch
      } else {
        zeilen.push(laufend)
        laufend = wort
      }
    }
    if (laufend) zeilen.push(laufend)
  }
  return zeilen
}

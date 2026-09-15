/**
 * Quotenprüfung bei Listenwahlen.
 *
 * ## Warum das kein Beiwerk ist
 *
 * Viele Satzungen — bei Parteien fast alle — knüpfen die Gültigkeit einer
 * gewählten Liste an eine Quote: mindestens die Hälfte Frauen, abwechselnde
 * Besetzung der Plätze, ein Platz für die Jugendorganisation. Wird sie
 * verfehlt, ist die Wahl **anfechtbar** — und das fällt in aller Regel erst
 * auf, wenn die Versammlung längst zu Ende ist.
 *
 * Votura kennt die Rangfolge, kennt die Zahl der Plätze und kann die Quote
 * deshalb **vor** der Feststellung nachrechnen. Eine Minute vor dem
 * Verkünden ist die Frage noch lösbar; eine Woche danach nicht mehr.
 *
 * ## Was diese Datei ausdrücklich nicht tut
 *
 * Sie **ordnet nichts um**. Wer gewählt ist, entscheiden die Stimmen und die
 * Satzung, nicht ein Programm. Ob eine verfehlte Quote zur Wiederholung
 * führt, zur Öffnung der Plätze oder zu gar nichts, steht in der Satzung —
 * und die Antwort darauf gehört der Versammlungsleitung, nicht dem Rechner.
 *
 * Diese Datei sagt deshalb nur: *Hier stimmt etwas nicht, und zwar das.*
 *
 * ## Warum ein freies Merkmal und nicht „Geschlecht"
 *
 * Weil die Satzungen verschieden sind. Die häufigste Quote ist die nach
 * Geschlecht, aber es gibt auch Quoten nach Gliederung, nach Alter, nach
 * Zugehörigkeit zu einer Arbeitsgemeinschaft. Ein fest eingebautes
 * „Geschlecht" hätte all diese Fälle ausgeschlossen — und nebenbei eine
 * Angabe erzwungen, die nicht jede Versammlung erheben will.
 *
 * Das Merkmal ist deshalb ein **Text**, den die Versammlung selbst benennt,
 * und die Zuordnung eines Bewerbers dazu ist freiwillig. Ohne Zuordnung gibt
 * es keine Prüfung — und keine falsche Sicherheit.
 */

/** Wonach eine Liste quotiert ist. */
export type Quotenart =
  /**
   * Mindestens ein Anteil der Plätze gehört der Anspruchsgruppe.
   *
   * Der Regelfall: „mindestens die Hälfte der Plätze Frauen". Gerechnet wird
   * **aufgerundet** — bei fünf Plätzen und der Hälfte sind es drei, nicht
   * zweieinhalb. Das ist die übliche Lesart und die für die Anspruchsgruppe
   * günstigere; wo eine Satzung es anders will, gehört das in den Text der
   * Regel und nicht in eine stille Annahme.
   */
  | 'mindestanteil'
  /**
   * Abwechselnde Besetzung — der „Reißverschluss".
   *
   * Platz 1 der Anspruchsgruppe, Platz 2 frei, Platz 3 der Anspruchsgruppe
   * und so fort. Geprüft werden nur die **ungeraden** Plätze: Die geraden
   * stehen allen offen, auch der Anspruchsgruppe.
   */
  | 'reissverschluss'

export interface Quotenregel {
  art: Quotenart
  /** Wie das Merkmal heißt, etwa „Geschlecht" — nur zur Anzeige. */
  merkmal: string
  /** Die Gruppe mit dem Anspruch, etwa „Frauen". */
  anspruchsgruppe: string
  /**
   * Der Mindestanteil bei `mindestanteil`, als Bruchteil von 1.
   *
   * 0,5 heißt „mindestens die Hälfte". Bei `reissverschluss` ohne Bedeutung.
   */
  mindestanteil?: number
}

/** Ein Bewerber, so weit die Quote ihn angeht. */
export interface Quotenbewerber {
  candidateId: string
  name: string
  /** Die Gruppe, der er zugeordnet ist — oder nichts. */
  gruppe?: string
}

/** Ein Platz, der die Regel verletzt. */
export interface Quotenverstoss {
  /** Listenplatz, bei 1 beginnend. */
  platz: number
  name: string
  grund: string
}

export interface Quotenbefund {
  /** Konnte überhaupt geprüft werden? */
  pruefbar: boolean
  erfuellt: boolean
  /** Ein Satz für die Bedienung — auch im guten Fall. */
  text: string
  /** Wie viele der gewählten Plätze die Anspruchsgruppe hält. */
  erreicht: number
  /** Wie viele es mindestens sein müssten. */
  gefordert: number
  /** Nur bei `reissverschluss` gefüllt. */
  verstoesse: Quotenverstoss[]
  /** Bewerber auf gewählten Plätzen ohne Zuordnung. */
  ohneZuordnung: string[]
}

/** „mindestens die Hälfte von fünf" sind drei. */
export function gefordertePlaetze(plaetze: number, anteil: number): number {
  return Math.ceil(plaetze * anteil - 1e-9)
}

/**
 * Prüft die gewählten Plätze gegen die Regel.
 *
 * `gewaehlte` sind die Bewerber **in der Reihenfolge der Liste**, und zwar
 * genau die, die einen Platz bekommen haben — nicht die Nachrücker. Die
 * Reihenfolge ist bei `reissverschluss` der ganze Gegenstand der Prüfung.
 */
export function quotePruefen(regel: Quotenregel, gewaehlte: Quotenbewerber[]): Quotenbefund {
  const leer: Quotenbefund = {
    pruefbar: false,
    erfuellt: true,
    text: '',
    erreicht: 0,
    gefordert: 0,
    verstoesse: [],
    ohneZuordnung: []
  }

  if (gewaehlte.length === 0) {
    return { ...leer, text: 'Noch niemand gewählt — nichts zu prüfen.' }
  }

  const ohneZuordnung = gewaehlte.filter((b) => !b.gruppe).map((b) => b.name)

  /*
   * Ohne jede Zuordnung wird nicht geprüft, sondern gesagt, dass nicht
   * geprüft werden kann.
   *
   * Ein „Quote erfüllt" auf Grundlage fehlender Angaben wäre die
   * gefährlichste Auskunft, die dieses Programm geben könnte: Sie sähe aus
   * wie eine Prüfung und wäre keine.
   */
  if (ohneZuordnung.length === gewaehlte.length) {
    return {
      ...leer,
      ohneZuordnung,
      text: `Keinem gewählten Bewerber ist ein Merkmal „${regel.merkmal}" zugeordnet — die Quote lässt sich nicht prüfen.`
    }
  }

  const gehoertDazu = (b: Quotenbewerber): boolean => b.gruppe === regel.anspruchsgruppe
  const erreicht = gewaehlte.filter(gehoertDazu).length

  if (regel.art === 'reissverschluss') {
    const verstoesse: Quotenverstoss[] = []
    gewaehlte.forEach((bewerber, i) => {
      const platz = i + 1
      /* Nur ungerade Plätze sind gebunden; die geraden stehen allen offen. */
      if (platz % 2 === 0) return
      if (gehoertDazu(bewerber)) return
      verstoesse.push({
        platz,
        name: bewerber.name,
        grund: bewerber.gruppe
          ? `Platz ${platz} ist für ${regel.anspruchsgruppe} vorgesehen, besetzt mit „${bewerber.gruppe}".`
          : `Platz ${platz} ist für ${regel.anspruchsgruppe} vorgesehen; hier fehlt die Zuordnung.`
      })
    })
    const gefordert = Math.ceil(gewaehlte.length / 2)
    return {
      pruefbar: true,
      erfuellt: verstoesse.length === 0,
      erreicht,
      gefordert,
      verstoesse,
      ohneZuordnung,
      text:
        verstoesse.length === 0
          ? `Abwechselnde Besetzung eingehalten: Alle ungeraden Plätze gehören ${regel.anspruchsgruppe}.`
          : `Abwechselnde Besetzung verfehlt: ${verstoesse.length} von ${gefordert} gebundenen Plätzen sind anders besetzt.`
    }
  }

  const anteil = regel.mindestanteil ?? 0.5
  const gefordert = gefordertePlaetze(gewaehlte.length, anteil)
  const erfuellt = erreicht >= gefordert
  return {
    pruefbar: true,
    erfuellt,
    erreicht,
    gefordert,
    verstoesse: [],
    ohneZuordnung,
    text: erfuellt
      ? `Quote erfüllt: ${erreicht} von ${gewaehlte.length} Plätzen gehören ${regel.anspruchsgruppe} (gefordert: ${gefordert}).`
      : `Quote verfehlt: ${erreicht} von ${gewaehlte.length} Plätzen gehören ${regel.anspruchsgruppe}, gefordert sind ${gefordert}.`
  }
}

/**
 * Wie die Quote in einem Satz heißt — für Listen und Überschriften.
 */
export function quoteBeschreibung(regel: Quotenregel): string {
  if (regel.art === 'reissverschluss') {
    return `Abwechselnd, ungerade Plätze für ${regel.anspruchsgruppe} (${regel.merkmal})`
  }
  const prozent = Math.round((regel.mindestanteil ?? 0.5) * 100)
  return `Mindestens ${prozent} % ${regel.anspruchsgruppe} (${regel.merkmal})`
}

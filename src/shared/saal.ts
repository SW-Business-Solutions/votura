/**
 * Die Begleitanwendung: was sie mit dem Hauptrechner austauscht.
 *
 * ## Warum es sie gibt
 *
 * Eine Bühne oder ein Pult im Saal lässt sich auch mit einem Browser
 * anzeigen — solange nur angezeigt wird. Sobald ein Mikrofon dazukommt, ist
 * Schluss: `getUserMedia` verlangt eine sichere Herkunft, und der
 * Projektionsserver spricht einfaches HTTP im Saalnetz. Eine eigene
 * Anwendung kann diese eine Herkunft als vertrauenswürdig führen — sie hat
 * sie ja selbst gewählt — und damit fällt die Beschränkung weg.
 *
 * Dazu kommt, was ein Browser im Saal ohnehin nicht gut kann: beim Start
 * selbst den Hauptrechner finden, ohne dass jemand eine Adresse abtippt.
 *
 * ## Der Suchruf
 *
 * Ein Ruf ins Netz, eine Antwort zurück — mehr nicht. Kein mDNS, kein
 * Dienstverzeichnis: Beides brächte eine Abhängigkeit und ein zweites
 * Protokoll mit, das im Saal genauso ausfallen kann. Ein Datagramm an alle
 * und die Antworten einsammeln ist in dreißig Zeilen erklärt und funktioniert
 * in jedem flachen Netz — und ein Saalnetz ist immer flach.
 */
import { AUSSCHUSS_PFAD, WAHL_PFAD } from './wahl'

/** Port des Suchrufs. Bewusst neben dem des Projektionsservers. */
export const SUCHRUF_PORT = 8478

/** Was gerufen wird. Kurz, damit ein Fehlläufer sofort erkennbar ist. */
export const SUCHRUF = 'VOTURA-SUCHE/1'

/**
 * Was der Hauptrechner antwortet.
 *
 * Bewusst ohne Zugriffstoken: Wer den Ruf hört, ist im selben Netz, mehr
 * nicht. Das Token gehört zu den Geräten, die es bekommen sollen — es hier
 * mitzuschicken hieße, es an jeden zu verteilen, der fragt. Gesagt wird nur,
 * **ob** eines nötig ist.
 */
export interface SaalAntwort {
  votura: typeof SUCHRUF
  /** Name der Versammlung, damit zwei Rechner im Haus unterscheidbar sind. */
  name: string
  /** Port des Projektionsservers. */
  port: number
  /** Fassung des Hauptrechners — bei grobem Unterschied wird gewarnt. */
  version: string
  /** Braucht es ein Zugriffstoken? */
  tokenNoetig: boolean
  /** Namen der Bühnen, damit die Begleitanwendung sie zur Wahl stellen kann. */
  buehnen: { id: number; name: string }[]
  /** Darf ein Gerät im Netz den Prompter bedienen? */
  prompterBedienung: boolean
}

/** Ein gefundener Hauptrechner samt der Adresse, unter der er antwortete. */
export interface SaalFund extends SaalAntwort {
  adresse: string
}

/**
 * Was die Begleitanwendung sein soll.
 *
 * Zwei Familien, und der Unterschied ist grundsätzlich:
 *
 * **Anzeigend** — Bühne und Prompter. Sie zeigen, was der Hauptrechner sagt,
 * und niemand bedient sie (der Prompter höchstens sich selbst).
 *
 * **Bedienend** — Akkreditierung, Ausgabe und Wahlkabine. Hinter ihnen steht
 * ein Mensch, der etwas auslöst: Ausweise ausgeben, Stimmzettel herausgeben,
 * eine Stimme abgeben. Die ersten beiden verlangen deshalb eine Anmeldung wie
 * jeder Fernzugriff (ADR-0005) — es sind Arbeitsplätze, keine Anzeigen.
 */
export type SaalRolle =
  | { art: 'buehne'; nummer: number }
  | { art: 'prompter' }
  /** Einlass: Teilnehmer suchen, Ausweis ausgeben und zurücknehmen. */
  | { art: 'akkreditierung' }
  /** Ausgabe: Stimmzettel gegen Ausweis herausgeben. */
  | { art: 'ausgabe' }
  /** Wahlkabine: die digitale Stimmabgabe (ADR-0006). */
  | { art: 'wahlkabine' }
  /**
   * Wahlausschuss: Dieses Gerät hält den Schlüssel und unterschreibt.
   *
   * Es ist weder anzeigend noch bedienend im gewohnten Sinn — es arbeitet für
   * sich. Eine Anmeldung braucht es nicht, wohl aber das Zugriffstoken: Hier
   * hängt kein Ausweis als Nachweis dran, sondern ein eingerichtetes Gerät.
   */
  | { art: 'wahlausschuss' }

/** Was sie sich merkt, damit sie es beim nächsten Start nicht wieder fragt. */
export interface SaalEinstellung {
  /** Grundadresse des Hauptrechners, etwa `http://192.168.1.5:8477`. */
  master: string
  token: string
  rolle: SaalRolle
  /** Name der Versammlung beim letzten erfolgreichen Verbinden. */
  name?: string
}

/** Prüft, ob eine Antwort aus dem Netz wirklich von Votura stammt. */
export function istSaalAntwort(wert: unknown): wert is SaalAntwort {
  if (typeof wert !== 'object' || wert === null) return false
  const kandidat = wert as Partial<SaalAntwort>
  return (
    kandidat.votura === SUCHRUF &&
    typeof kandidat.name === 'string' &&
    typeof kandidat.port === 'number' &&
    Array.isArray(kandidat.buehnen)
  )
}

/**
 * Die Adresse, die eine Rolle anzeigen soll.
 *
 * Sie zeigt auf den Projektionsserver des Hauptrechners — dieselben Seiten,
 * die auch ein Browser bekäme. Die Begleitanwendung baut nichts nach; sie
 * sorgt nur dafür, dass diese Seiten alles dürfen, was sie am Pult brauchen.
 */
export function rollenAdresse(einstellung: SaalEinstellung): string {
  const basis = einstellung.master.replace(/\/+$/, '')
  const token = einstellung.token ? `&t=${encodeURIComponent(einstellung.token)}` : ''
  const frage = einstellung.token ? `?t=${encodeURIComponent(einstellung.token)}` : ''

  switch (einstellung.rolle.art) {
    case 'prompter':
      return `${basis}/prompter${frage}`
    /*
     * Die bedienenden Rollen führen auf die Fernbedienung des Hauptrechners.
     * Sie bauen nichts nach — es ist dieselbe Oberfläche, dieselbe Anmeldung,
     * dieselbe Rechteprüfung. Ein zweiter, schwächerer Weg an dieselben Daten
     * wäre genau die Abkürzung, die man später bereut.
     */
    case 'akkreditierung':
      return `${basis}/operator${frage}#/akkreditierung`
    case 'ausgabe':
      return `${basis}/operator${frage}#/ausgabe`
    /*
     * Die Pfade kommen aus derselben Quelle, aus der sie auch ausgeliefert
     * werden. Hier stand einmal `/wahl`, ausgeliefert wurde `/stimme` — das
     * Fenster blieb schwarz, und zwar ohne Meldung: Ein 404 hat keine
     * Oberfläche. Zwei Schreibweisen desselben Pfades an zwei Orten laufen
     * früher oder später auseinander.
     */
    case 'wahlkabine':
      return `${basis}${WAHL_PFAD}${frage}`
    case 'wahlausschuss':
      return `${basis}${AUSSCHUSS_PFAD}${frage}`
    default:
      return `${basis}/?buehne=${einstellung.rolle.nummer}${token}`
  }
}

/** Klartext einer Rolle — für Auswahl, Fenstertitel und Meldungen. */
export function rollenName(rolle: SaalRolle, buehnen: { id: number; name: string }[] = []): string {
  switch (rolle.art) {
    case 'prompter':
      return 'Prompter am Pult'
    case 'akkreditierung':
      return 'Akkreditierung am Einlass'
    case 'ausgabe':
      return 'Ausgabe der Stimmzettel'
    case 'wahlkabine':
      return 'Wahlkabine'
    case 'wahlausschuss':
      return 'Wahlausschuss'
    default: {
      const treffer = buehnen.find((buehne) => buehne.id === rolle.nummer)
      return treffer ? treffer.name : `Bühne ${rolle.nummer}`
    }
  }
}

/**
 * Braucht diese Rolle eine Anmeldung?
 *
 * Anzeigende Rollen nicht — sie zeigen, was ohnehin auf der Leinwand steht.
 * Bedienende schon: Wer Ausweise ausgibt oder Stimmzettel herausgibt, handelt,
 * und Handeln gehört einem Konto zugeordnet.
 */
export function rolleBrauchtAnmeldung(rolle: SaalRolle): boolean {
  return rolle.art === 'akkreditierung' || rolle.art === 'ausgabe'
}

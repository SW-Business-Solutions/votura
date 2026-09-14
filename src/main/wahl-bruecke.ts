/**
 * Die Brücke zwischen den Teilnehmergeräten und dem Wahldienst.
 *
 * Sie ist bewusst schmal: drei Funktionen, mehr geht über diesen Weg nicht.
 * Über ihn kommen Anfragen **ohne Anmeldung** herein — wer abstimmt, hat kein
 * Konto und darf keines brauchen. Was hier nicht aufgezählt ist, ist von außen
 * nicht erreichbar.
 *
 * Jede Funktion prüft den Ausweis selbst, und zwar bei **jedem** Aufruf. Es
 * gibt keine Sitzung, kein Merken, kein „eben war er doch noch da": Wer
 * zwischen zwei Schritten den Saal verlässt, kann den zweiten nicht mehr tun.
 */
import type { WahlDispatcher } from './network-projection'
import type { Stimmabgabe, WahlAuskunft } from '@shared/wahl'
import { activeEvent } from './services/events'
import { mayVote } from './services/participants'
import { resolveScan } from './services/cards'
import {
  ausschussWahlgang,
  berechtigungAusgeben,
  committeeKeyMelden,
  hatStimmrecht,
  offeneSignaturen,
  offeneWahl,
  signaturAbholen,
  signaturEintragen,
  signaturZaehler,
  stimmeEinlegen,
  votingLage
} from './services/voting'

/** Den Ausweis zu einer Person auflösen — Karte, Bändchen oder gedruckter Pass. */
function personZu(code: string): { id: string; name: string; gewicht: number } | null {
  const event = activeEvent()
  if (!event) return null
  const treffer = resolveScan(event.id, String(code ?? '').trim())
  const person = treffer?.participant
  if (!person) return null
  return {
    id: person.id,
    name: `${person.firstName} ${person.lastName}`,
    gewicht: person.weight
  }
}

/**
 * Darf von diesem Gerät abgestimmt werden?
 *
 * Hat die Wahlleitung „nur Wahlkabinen" gewählt, war das bisher eine Angabe
 * in der Datenbank und sonst nichts — die Oberfläche versprach etwas, das der
 * Code nicht hielt.
 *
 * Erkannt wird eine Kabine am **Zugriffstoken**: Sie gehört der Veranstaltung
 * und wurde eingerichtet, ein mitgebrachtes Telefon nicht. Mehr ist es nicht,
 * und mehr behauptet es auch nicht — wer das Token an die Wand schreibt, hat
 * den Unterschied wieder aufgehoben. Ohne eingerichtetes Token lässt sich die
 * Beschränkung nicht durchsetzen, und dann sagt sie das auch.
 */
function kabinenpflicht(lage: { geraete: string }, mitToken: boolean): string | undefined {
  if (lage.geraete !== 'booth') return undefined
  if (mitToken) return undefined
  return 'Für diesen Wahlgang ist die Stimmabgabe nur in der Wahlkabine vorgesehen.'
}

/** Wurde für diesen Wahlgang schon eine Berechtigung ausgegeben? */
function schonAusgegeben(roundId: string, participantId: string): boolean {
  return hatStimmrecht(roundId, participantId)
}

export const wahlBruecke: WahlDispatcher = {
  /**
   * Was dieses Gerät gerade tun kann.
   *
   * Die Antwort nennt den Namen der Person — damit am Gerät niemand
   * versehentlich für einen anderen abstimmt, weil der falsche Ausweis oben
   * auf lag.
   */
  async lage(code: string, mitToken: boolean): Promise<WahlAuskunft> {
    const event = activeEvent()
    const lage = event ? offeneWahl(event.id) : null
    const person = personZu(code)

    if (!person) {
      return {
        lage,
        berechtigt: false,
        bereitsAusgegeben: false,
        hindernis: 'Dieser Ausweis gehört zu niemandem in dieser Versammlung.'
      }
    }

    const urteil = mayVote(person.id)
    if (!lage) {
      return {
        lage: null,
        berechtigt: false,
        bereitsAusgegeben: false,
        name: person.name,
        hindernis: 'Gerade ist keine Abstimmung offen.'
      }
    }

    const kabine = kabinenpflicht(lage, mitToken)
    return {
      lage,
      berechtigt: urteil.ok && !kabine,
      bereitsAusgegeben: schonAusgegeben(lage.roundId, person.id),
      name: person.name,
      gewicht: person.gewicht,
      hindernis: kabine ?? (urteil.ok ? undefined : urteil.reason)
    }
  },

  /**
   * Eine Stimmberechtigung holen.
   *
   * Bei geheimer Wahl kommt ein verblendeter Wert herein und eine
   * Blindsignatur zurück — was unterschrieben wird, erfährt der Rechner nicht.
   */
  async berechtigung(eingabe: Record<string, unknown>, mitToken: boolean): Promise<unknown> {
    /*
     * Erst die Lage, dann der Ausweis. „Hier darf gar nicht abgestimmt
     * werden" ist die grundsätzlichere Auskunft — und wer in der falschen
     * Schlange steht, soll das erfahren, bevor er seinen Ausweis zückt.
     */
    const roundId = String(eingabe.roundId ?? '')
    const lage = votingLage(roundId)
    if (!lage || lage.status !== 'open') throw new Error('Diese Abstimmung ist nicht geöffnet.')
    const kabine = kabinenpflicht(lage, mitToken)
    if (kabine) throw new Error(kabine)

    const person = personZu(String(eingabe.code ?? ''))
    if (!person) throw new Error('Dieser Ausweis gehört zu niemandem in dieser Versammlung.')

    return berechtigungAusgeben({
      roundId,
      participantId: person.id,
      verblendet: typeof eingabe.verblendet === 'string' ? eingabe.verblendet : undefined
    })
  },

  /**
   * Die Stimme einlegen.
   *
   * Bei **geheimer** Wahl wird der Ausweis hier bewusst *nicht* mehr gefragt:
   * Die Unterschrift ist der ganze Nachweis, und wer hier eine Person
   * mitschickte, hätte die Trennung im letzten Schritt wieder aufgehoben.
   *
   * Bei offener und namentlicher Abstimmung wird er gebraucht — dort trägt
   * die Stimme ihr Gewicht, und bei namentlicher gehört die Zuordnung ins
   * Protokoll.
   */
  async abgeben(eingabe: Record<string, unknown>, mitToken: boolean): Promise<unknown> {
    const roundId = String(eingabe.roundId ?? '')
    const lage = votingLage(roundId)
    if (!lage || lage.status !== 'open') throw new Error('Diese Abstimmung ist nicht geöffnet.')
    const kabine = kabinenpflicht(lage, mitToken)
    if (kabine) throw new Error(kabine)

    const choice = (eingabe.choice ?? {}) as Stimmabgabe
    if (lage.geheimnis === 'secret') {
      await stimmeEinlegen({
        roundId,
        serial: String(eingabe.serial ?? ''),
        signatur: String(eingabe.signatur ?? ''),
        choice
      })
      return {}
    }

    const person = personZu(String(eingabe.code ?? ''))
    if (!person) throw new Error('Dieser Ausweis gehört zu niemandem in dieser Versammlung.')
    const urteil = mayVote(person.id)
    if (!urteil.ok) throw new Error(urteil.reason ?? 'Keine Stimmberechtigung.')

    await stimmeEinlegen({
      roundId,
      serial: String(eingabe.serial ?? ''),
      choice,
      participantId: person.id,
      gewicht: person.gewicht
    })
    return {}
  },

  /**
   * Auf die Unterschrift warten — nur im Ausschussbetrieb.
   *
   * Das Gerät des Wählers fragt mit seiner Wartenummer nach. Sie ist ein
   * Zufallswert und sagt über niemanden etwas aus; eine Anmeldung wäre hier
   * sogar schädlich, denn sie verbände wieder Person und Stimmzettel.
   */
  async warten(eingabe: Record<string, unknown>): Promise<unknown> {
    return signaturAbholen(String(eingabe.ticket ?? ''))
  },

  /**
   * Die Gegenseite: das Gerät des Wahlausschusses.
   *
   * Vier Vorgänge, mehr nicht — die Lage erfragen, den Prüfschlüssel melden,
   * offene Anfragen abholen, eine Unterschrift zurückgeben.
   */
  async ausschuss(was: string, eingabe: Record<string, unknown>): Promise<unknown> {
    const event = activeEvent()
    if (!event) throw new Error('Es läuft keine Versammlung.')

    if (was === 'lage') {
      const lage = ausschussWahlgang(event.id)
      return { lage, zaehler: lage ? signaturZaehler(lage.roundId) : null }
    }
    if (was === 'schluessel') {
      committeeKeyMelden(String(eingabe.roundId ?? ''), {
        n: String(eingabe.n ?? ''),
        e: String(eingabe.e ?? '')
      })
      return {}
    }
    if (was === 'offen') {
      const lage = ausschussWahlgang(event.id)
      return { offen: lage ? offeneSignaturen(lage.roundId) : [] }
    }
    if (was === 'signatur') {
      signaturEintragen(String(eingabe.id ?? ''), String(eingabe.signatur ?? ''))
      return {}
    }
    throw new Error('Unbekannter Vorgang.')
  }
}

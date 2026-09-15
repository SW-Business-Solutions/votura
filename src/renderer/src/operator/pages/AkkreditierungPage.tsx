/**
 * Akkreditierung: der Einlass und die Liste dahinter.
 *
 * Die Seite hat zwei Betriebsarten, weil sie zwei Situationen bedient. Vor der
 * Versammlung wird die Liste gepflegt — in Ruhe, mit Tastatur. Während des
 * Einlasses stehen zwanzig Leute an, und es zählt nur, wie schnell jemand auf
 * „da" gesetzt ist.
 *
 * Deshalb steht das Suchfeld oben und nimmt den Fokus: Wer einen Scanner
 * benutzt, bekommt den Pass als Tastatureingabe mit Zeilenumbruch — der Scan
 * landet im Feld, die Eingabetaste schließt ihn ab, und die nächste Person
 * kann vortreten, ohne dass jemand die Maus anfasst.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AttendanceEntry, Card as Ausweis, CardStock, Participant, PresenceSummary } from '@shared/types'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState, Field, Modal, NumberInput } from '../components/ui'
import { kameraVerfuegbar, QrScanner } from '../../qr-scanner'

/** Wie ein Zeitpunkt am Einlass aussehen soll: kurz. */
function uhrzeit(wert?: string): string {
  if (!wert) return '—'
  return new Date(wert).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/** Wie viele nicht leere Zeilen stehen im Kasten? — die Zahl beruhigt vor dem Klick. */
function zeilenZahl(text: string): number {
  return text.split(/\r?\n/).filter((zeile) => zeile.trim()).length
}

export function AkkreditierungPage(): React.JSX.Element {
  const app = useApp()
  const event = app.event
  const [liste, setListe] = useState<Participant[]>([])
  const [stand, setStand] = useState<PresenceSummary | null>(null)
  const [suche, setSuche] = useState('')
  const [meldung, setMeldung] = useState<string | null>(null)
  const [passAnzeige, setPassAnzeige] = useState<{ name: string; token: string } | null>(null)
  const [neu, setNeu] = useState({ lastName: '', firstName: '', number: '', weight: '1' })
  const [bestand, setBestand] = useState<CardStock | null>(null)
  /*
   * Der Einlass funktioniert in beiden Richtungen: erst die Person wählen und
   * dann die Karte scannen — oder erst die Karte scannen und dann die Person
   * antippen. Wer in einer Schlange steht, macht es mal so und mal so.
   */
  const [ausgewaehlt, setAusgewaehlt] = useState<Participant | null>(null)
  const [wartendeKarte, setWartendeKarte] = useState<{ card: Ausweis; code: string } | null>(null)
  const [importText, setImportText] = useState('')
  const [importArt, setImportArt] = useState<Ausweis['kind']>('card')
  /* Die Kamera als zweiter Weg neben dem Handscanner — für Geräte, an denen
     keiner steckt (ADR-0007). */
  const [kamera, setKamera] = useState(false)
  /*
   * Eine Person bearbeiten. Der Dialog trägt alles, was selten gebraucht wird
   * und deshalb nicht in die Zeile gehört: die Korrektur eines Tippfehlers,
   * die Sperre und den Anwesenheitsverlauf. In der Zeile bleiben die drei
   * Handgriffe des Einlasses — mehr steht dort im Weg.
   */
  const [bearbeiten, setBearbeiten] = useState<{
    person: Participant
    form: {
      lastName: string
      firstName: string
      number: string
      note: string
      weight: number
      eligible: boolean
    }
    grund: string
  } | null>(null)
  const [verlauf, setVerlauf] = useState<AttendanceEntry[] | null>(null)
  /* Der Ausweisbestand, wenn jemand ihn sehen will. */
  const [ausweise, setAusweise] = useState<Ausweis[] | null>(null)
  const sucheFeld = useRef<HTMLInputElement | null>(null)

  /* Im Bestand steht nur die Teilnehmer-Kennung — der Name kommt aus der Liste,
     die ohnehin geladen ist. */
  const namen = useMemo(
    () => new Map(liste.map((person) => [person.id, `${person.lastName}, ${person.firstName}`])),
    [liste]
  )

  const laden = useCallback(async () => {
    if (!event) return
    try {
      const [teilnehmer, zusammenfassung, karten] = await Promise.all([
        api('participant.list', event.id),
        api('participant.presence', event.id),
        api('card.stock')
      ])
      setListe(teilnehmer)
      setStand(zusammenfassung)
      setBestand(karten)
    } catch (error) {
      app.reportError(error)
    }
  }, [event?.id])

  useEffect(() => {
    void laden()
  }, [laden])

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    if (!begriff) return liste
    return liste.filter((person) =>
      [person.lastName, person.firstName, person.number ?? ''].join(' ').toLowerCase().includes(begriff)
    )
  }, [liste, suche])

  if (!event) {
    return (
      <Card title="Keine aktive Veranstaltung">
        <p>Bitte zuerst eine Veranstaltung anlegen und aktivieren.</p>
        <button className="primary" onClick={() => navigate('event')}>
          Zur Veranstaltung
        </button>
      </Card>
    )
  }

  const anwesenheit = async (person: Participant, kind: 'in' | 'out'): Promise<void> => {
    try {
      await api('participant.attendance', { id: person.id, kind })
      setMeldung(`${person.firstName} ${person.lastName} — ${kind === 'in' ? 'eingetroffen' : 'gegangen'}`)
      await laden()
    } catch (error) {
      app.reportError(error)
    }
  }

  /** Den Dialog öffnen und gleich den Verlauf nachladen. */
  const bearbeitenOeffnen = (person: Participant): void => {
    setBearbeiten({
      person,
      form: {
        lastName: person.lastName,
        firstName: person.firstName,
        number: person.number ?? '',
        note: person.note ?? '',
        weight: person.weight,
        eligible: person.eligible
      },
      grund: ''
    })
    setVerlauf(null)
    void api('participant.history', person.id)
      .then(setVerlauf)
      .catch(() => setVerlauf([]))
  }

  /**
   * Eine Korrektur speichern.
   *
   * `rowVersion` geht mit: Hat jemand anders die Zeile zwischenzeitlich
   * angefasst, scheitert das Speichern, statt die fremde Änderung zu
   * überschreiben. Am Einlass sitzen mehrere Leute an derselben Liste.
   */
  const bearbeitenSpeichern = async (): Promise<void> => {
    if (!bearbeiten || !bearbeiten.form.lastName.trim()) return
    try {
      await api('participant.update', {
        id: bearbeiten.person.id,
        rowVersion: bearbeiten.person.rowVersion,
        eventId: bearbeiten.person.eventId,
        lastName: bearbeiten.form.lastName,
        firstName: bearbeiten.form.firstName,
        number: bearbeiten.form.number.trim() || undefined,
        note: bearbeiten.form.note.trim() || undefined,
        weight: bearbeiten.form.weight,
        eligible: bearbeiten.form.eligible
      })
      setBearbeiten(null)
      await laden()
      app.notify('ok', 'Der Eintrag ist geändert.')
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  /**
   * Eine Person sperren — und damit jeden Ausweis, den sie hat.
   *
   * Der schärfste Eingriff auf dieser Seite: Danach kommt diese Person weder
   * an einen Stimmzettel noch an eine digitale Berechtigung. Deshalb die
   * Begründung, und deshalb steht sie im Protokoll.
   */
  const personSperren = async (): Promise<void> => {
    if (!bearbeiten || !bearbeiten.grund.trim()) return
    const person = bearbeiten.person
    try {
      await api('participant.block', { id: person.id, reason: bearbeiten.grund.trim() })
      setBearbeiten(null)
      await laden()
      app.notify('ok', `${person.lastName}, ${person.firstName} ist gesperrt.`)
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const personEntsperren = async (person: Participant): Promise<void> => {
    try {
      await api('participant.unblock', person.id)
      setBearbeiten(null)
      await laden()
      app.notify('ok', 'Sperre aufgehoben.')
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  /** Den Ausweisbestand holen — erst wenn jemand ihn sehen will. */
  const ausweiseLaden = async (): Promise<void> => {
    try {
      setAusweise(await api('card.list'))
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  /**
   * Eine Karte oder ein Bändchen ungültig machen.
   *
   * „Verloren" ist der Fall, der im Saal zählt: Wer sie findet, soll damit
   * nichts anfangen können. „Ausgemustert" ist das Ende eines Lebenslaufs —
   * zerkratzt, unlesbar, verbraucht.
   */
  const ausweisStatus = async (karte: Ausweis, status: Ausweis['status']): Promise<void> => {
    try {
      await api('card.setStatus', { id: karte.id, status })
      await Promise.all([ausweiseLaden(), laden()])
      app.notify(
        'ok',
        status === 'lost'
          ? `${karte.serial} ist als verloren gemeldet und gilt nicht mehr.`
          : status === 'retired'
            ? `${karte.serial} ist ausgemustert.`
            : `${karte.serial} ist wieder im Bestand.`
      )
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const passAusgeben = async (person: Participant): Promise<void> => {
    if (
      person.passIssued &&
      !window.confirm(
        `${person.firstName} ${person.lastName} hat bereits einen Voting Pass.

` + 'Ein neuer Pass entwertet den alten. Fortfahren?'
      )
    ) {
      return
    }
    try {
      const drucker = app.settings?.config.printing.defaultPrinterId
      if (drucker) {
        await api('participant.issueAndPrintPass', { id: person.id, printerId: drucker })
        setMeldung(`Voting Pass für ${person.firstName} ${person.lastName} gedruckt.`)
      } else {
        const { token } = await api('participant.issuePass', person.id)
        setPassAnzeige({ name: `${person.firstName} ${person.lastName}`, token })
      }
      await laden()
    } catch (error) {
      app.reportError(error)
    }
  }

  /** Wie ein Ausweis in einem Satz heißt. */
  const bezeichnung = (karte: Ausweis): string =>
    karte.kind === 'band' ? `Bändchen ${karte.serial}` : `Karte ${karte.serial}`

  const zuruecksetzen = (): void => {
    setSuche('')
    sucheFeld.current?.focus()
  }

  const ausgeben = async (person: Participant, karte: Ausweis, code: string): Promise<void> => {
    try {
      await api('card.assign', { participantId: person.id, code })
      setMeldung(`${person.firstName} ${person.lastName} — ${bezeichnung(karte)} ausgegeben`)
      setAusgewaehlt(null)
      setWartendeKarte(null)
      await laden()
    } catch (error) {
      app.reportError(error)
    }
  }

  /**
   * Ein Scan oder eine Eingabe im Suchfeld.
   *
   * Kurze Eingaben sind eine Namenssuche — niemand tippt einen
   * Sechzehnstellet von Hand. Alles Längere wird als Code behandelt, und was
   * dahintersteckt, entscheidet das System: Karte, Bändchen oder gedruckter
   * Pass.
   */
  const scannen = async (roh = suche): Promise<void> => {
    /* Kommt der Code aus der Kamera, steht er noch nicht im Feld — React
       setzt den Zustand erst zum nächsten Bild. Deshalb der Umweg über das
       Argument. */
    const wert = roh.trim()
    if (wert.length < 10 || /\s/.test(wert)) return

    try {
      const treffer = await api('card.resolve', { eventId: event.id, code: wert })
      if (!treffer) {
        setMeldung('Dieser Code gehört zu nichts in dieser Versammlung.')
        zuruecksetzen()
        return
      }

      if (treffer.kind === 'pass') {
        if (treffer.participant.blockedAt) {
          setMeldung(
            `${treffer.participant.firstName} ${treffer.participant.lastName} ist gesperrt` +
              (treffer.participant.blockedReason ? ` — ${treffer.participant.blockedReason}` : '.')
          )
          zuruecksetzen()
          return
        }
        await anwesenheit(treffer.participant, treffer.participant.present ? 'out' : 'in')
        zuruecksetzen()
        return
      }

      /* Ein ausgegebener Ausweis wird zurückgenommen — das ist der Ausgang. */
      if (treffer.participant) {
        const { participant } = await api('card.return', wert)
        setMeldung(
          `${participant?.firstName ?? ''} ${participant?.lastName ?? ''} — gegangen, ` +
            (treffer.card.kind === 'band'
              ? `${bezeichnung(treffer.card)} verbraucht`
              : `${bezeichnung(treffer.card)} zurück im Stapel`)
        )
        await laden()
        zuruecksetzen()
        return
      }

      /* Ein freier Ausweis: Er braucht eine Person. Steht schon eine bereit,
         geht es sofort; sonst wartet der Ausweis auf den nächsten Antipper. */
      if (ausgewaehlt) {
        await ausgeben(ausgewaehlt, treffer.card, wert)
      } else {
        setWartendeKarte({ card: treffer.card, code: wert })
        setMeldung(`${bezeichnung(treffer.card)} bereit — jetzt die Person antippen.`)
      }
      zuruecksetzen()
    } catch (error) {
      app.reportError(error)
      zuruecksetzen()
    }
  }

  /**
   * Jemanden in der Liste antippen.
   *
   * Wartet ein gescannter Ausweis, bekommt die Person ihn sofort. Sonst wird
   * sie vorgemerkt und der nächste Scan gehört ihr.
   */
  const antippen = async (person: Participant): Promise<void> => {
    if (wartendeKarte) {
      await ausgeben(person, wartendeKarte.card, wartendeKarte.code)
      return
    }
    setAusgewaehlt(ausgewaehlt?.id === person.id ? null : person)
  }

  const kartenEinlesen = async (): Promise<void> => {
    /*
     * Die Liste kommt vom Hersteller: je Zeile die aufgedruckte Nummer und
     * der Code, getrennt durch Semikolon, Komma oder Tabulator. Mehr braucht
     * es nicht — und ein eigenes Dateiformat wäre eine Hürde ohne Gewinn.
     */
    const entries = importText
      .split('\n')
      .map((zeile) => zeile.split(/[;,\t]/).map((teil) => teil.trim()))
      .filter((teile) => teile.length >= 2 && teile[0] && teile[1])
      .map(([serial, code]) => ({ serial, code }))

    if (entries.length === 0) {
      setMeldung('Keine verwertbaren Zeilen gefunden — erwartet wird „Nummer;Code".')
      return
    }
    try {
      const ergebnis = await api('card.import', { entries, kind: importArt })
      setMeldung(`${ergebnis.added} aufgenommen, ${ergebnis.skipped} übersprungen (schon im Bestand).`)
      setImportText('')
      await laden()
    } catch (error) {
      app.reportError(error)
    }
  }

  const aufnehmen = async (): Promise<void> => {
    if (!neu.lastName.trim()) return
    try {
      await api('participant.add', {
        eventId: event.id,
        lastName: neu.lastName,
        firstName: neu.firstName,
        number: neu.number || undefined,
        weight: Number(neu.weight) || 1
      })
      setNeu({ lastName: '', firstName: '', number: '', weight: '1' })
      await laden()
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <div className="seite-sortiert">
      <div className="page-header" style={{ order: 0 }}>
        <div>
          <h1>Akkreditierung</h1>
          <div className="subtitle">
            Wer da ist und wer mitstimmen darf. Die Zahl der stimmberechtigten Anwesenden geht in jeden
            Wahlgang ein, der ab jetzt eröffnet wird.
          </div>
        </div>
      </div>

      {/*
        **Die Erklärung steht vor der Bedienung.**

        Diese Seite hatte drei Begriffe, die niemand von außen kennt —
        Akkreditierung, Ausweis, Voting Pass — und erklärte keinen davon. Sie
        zeigte stattdessen sofort ein Scanfeld für etwas, das es noch gar
        nicht gab. Wer hier zum ersten Mal steht, liest zuerst, worum es geht.
      */}
      <Card title="Wie das hier zusammenhängt">
        <div className="grid cols-3">
          <div>
            <strong>1. Teilnehmer erfassen</strong>
            <p className="hint">
              Wer zur Versammlung gehört und wer davon stimmberechtigt ist. Ohne diese Liste geht nichts
              Weiteres — sie ist die Grundlage für jede Zahl auf dieser Seite.
            </p>
          </div>
          <div>
            <strong>2. Ausweise vorbereiten</strong>
            <p className="hint">
              Jeder Anwesende bekommt am Einlass einen Ausweis: eine <strong>Stimmkarte</strong> oder ein{' '}
              <strong>Bändchen</strong> aus einer eingelesenen Lieferung — oder einen{' '}
              <strong>Voting Pass</strong>, den dieser Rechner selbst auf dem Bondrucker ausgibt. Alle drei
              tragen einen QR-Code und tun dasselbe.
            </p>
          </div>
          <div>
            <strong>3. Einlass</strong>
            <p className="hint">
              Ausweis scannen — das <em>ist</em> die Akkreditierung: Die Person gilt damit als anwesend und
              darf abstimmen. Wer geht, gibt den Ausweis zurück; nur wer im Saal ist, stimmt ab.
            </p>
          </div>
        </div>
        <div className="hint mt-2">
          Die Akkreditierung ist <strong>eine Möglichkeit, keine Pflicht</strong>. Wer keine Teilnehmerliste
          führt, arbeitet wie bisher: Die Zahl der Stimmberechtigten bleibt die, die an der Veranstaltung
          eingetragen ist.
        </div>
      </Card>

      {stand && (
        <Card tight>
          <div className="grid cols-4">
            <Zahl wert={stand.eligiblePresent} text="stimmberechtigt anwesend" />
            <Zahl wert={stand.present} text="anwesend insgesamt" />
            <Zahl wert={stand.eligibleTotal} text="stimmberechtigt erfasst" />
            <Zahl wert={stand.passesIssued} text="Voting Pässe" />
          </div>
          {stand.weightPresent !== stand.eligiblePresent && (
            <div className="hint mt-2">
              Mit Stimmgewicht: <strong>{stand.weightPresent}</strong> Stimmen.
            </div>
          )}
        </Card>
      )}

      {bestand && bestand.total > 0 && (
        <Card tight>
          <div className="grid cols-4">
            <Zahl wert={bestand.available} text="Ausweise frei" />
            <Zahl wert={bestand.assigned} text="ausgegeben" />
            <Zahl wert={bestand.lost} text="verloren" />
            <Zahl wert={bestand.retired} text="verbraucht" />
          </div>
        </Card>
      )}

      {stand && stand.quorum.kind !== 'none' && (
        <div className={`notice ${stand.quorumMet ? 'ok' : 'warn'}`}>
          <strong>{stand.quorumMet ? 'Beschlussfähig' : 'Nicht beschlussfähig'}</strong> —{' '}
          {stand.eligiblePresent} von {stand.quorumRequired} benötigten stimmberechtigten Anwesenden.
          {!stand.quorumMet && ` Es fehlen ${stand.quorumRequired - stand.eligiblePresent}.`}
        </div>
      )}

      {/*
        **Die Reihenfolge richtet sich danach, was gerade dran ist.**

        Ohne Teilnehmer steht das Aufnehmen oben und der Einlass unten — ein
        Scanfeld für eine leere Liste ist eine Einladung, etwas auszuprobieren,
        das nicht gehen kann. Sobald die Liste steht, rückt der Einlass nach
        oben: Er ist an dem Abend das einzige, was noch benutzt wird.

        Gelöst über die Anzeigereihenfolge, nicht über zwei Kopien desselben
        Abschnitts — zwei Kopien laufen bei der ersten Änderung auseinander.
      */}
      <div className="reihenfolge" style={{ order: liste.length > 0 ? 1 : 3 }}>
        <Card title="3. Einlass — Ausweis scannen">
          <div className="hint">
            Ein Scan genügt, und er entscheidet selbst, was er ist: Ein freier Ausweis wird ausgegeben und die
            Person gilt als anwesend; ein ausgegebener wird zurückgenommen und die Person gilt als gegangen.
            Es geht in beiden Richtungen — erst die Person antippen und dann scannen, oder umgekehrt.
          </div>
          <div className="hint">
            Ein Handscanner gibt den Code als Tastatureingabe ein und schließt mit der Eingabetaste ab; es
            muss niemand die Maus anfassen. Ohne Scanner hilft die Kamera oder das Tippen des Namens.
          </div>
          <div className="row mt-2">
            <div className="col">
              <input
                ref={sucheFeld}
                autoFocus
                placeholder="Voting Pass scannen oder Namen suchen …"
                value={suche}
                onChange={(ereignis) => setSuche(ereignis.target.value)}
                onKeyDown={(ereignis) => {
                  if (ereignis.key === 'Enter') void scannen()
                }}
              />
            </div>
            {kameraVerfuegbar() && <button onClick={() => setKamera(true)}>Mit der Kamera</button>}
          </div>
          {kamera && (
            <QrScanner
              titel="Ausweis scannen"
              aufSchliessen={() => setKamera(false)}
              aufCode={(gelesen) => {
                setKamera(false)
                setSuche(gelesen)
                void scannen(gelesen)
              }}
            />
          )}
          {(ausgewaehlt || wartendeKarte) && (
            <div className="notice mt-2">
              {wartendeKarte
                ? `${bezeichnung(wartendeKarte.card)} wartet — Person in der Liste antippen.`
                : `${ausgewaehlt?.firstName} ${ausgewaehlt?.lastName} ist vorgemerkt — jetzt Ausweis scannen.`}{' '}
              <button
                className="ghost"
                onClick={() => {
                  setAusgewaehlt(null)
                  setWartendeKarte(null)
                }}
              >
                Abbrechen
              </button>
            </div>
          )}
          {meldung && <div className="notice mt-2">{meldung}</div>}
        </Card>

        {passAnzeige && (
          <Card title={`Voting Pass für ${passAnzeige.name}`}>
            {/*
             * Der Pass steht hier genau einmal. Gespeichert ist nur sein Hash;
             * wer das Fenster schließt, ohne ihn zu drucken, muss einen neuen
             * ausgeben — und der alte verfällt dabei.
             */}
            <p className="mono" style={{ fontSize: '28px', letterSpacing: '3px' }}>
              {passAnzeige.token}
            </p>
            <div className="hint">
              Dieser Wert erscheint <strong>nur jetzt</strong>. Gespeichert wird nur seine Prüfsumme — er
              lässt sich später nicht nachschlagen, sondern nur neu ausgeben, wobei der alte verfällt.
            </div>
            <button className="mt-2" onClick={() => setPassAnzeige(null)}>
              Schließen
            </button>
          </Card>
        )}
      </div>

      {/*
        **Wo man einen Ausweis ungültig macht.**

        Die Frage taucht am Einlass auf — „Ich habe meine Karte verloren" —
        und war bisher nirgends beantwortet: Der Dienst konnte es seit jeher,
        nur rief es keine Stelle der Oberfläche auf.
      */}
      {bestand && bestand.total > 0 && (
        <div className="reihenfolge" style={{ order: 2 }}>
          <Card
            title="Ausweise sperren und verwalten"
            actions={
              <button onClick={() => void (ausweise ? setAusweise(null) : ausweiseLaden())}>
                {ausweise ? 'Schließen' : 'Bestand anzeigen'}
              </button>
            }
          >
            <p className="hint">
              Eine verlorene Karte oder ein verlorenes Bändchen wird hier ungültig — wer sie findet, kann
              damit nichts mehr anfangen. Ein <strong>gedruckter Pass</strong> steht nicht in dieser Liste:
              Den ersetzt man in der Teilnehmerliste über <em>Pass ersetzen</em>, und der alte gilt damit
              nicht mehr. Soll eine <strong>Person</strong> gar nicht mehr abstimmen, gleich welchen Ausweis
              sie vorzeigt, ist <em>Sperren</em> in der Teilnehmerzeile der richtige Weg.
            </p>
            {ausweise && (
              <table className="mt-2">
                <thead>
                  <tr>
                    <th>Nummer</th>
                    <th>Art</th>
                    <th>Status</th>
                    <th>Bei</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ausweise.map((karte) => (
                    <tr key={karte.id}>
                      <td className="mono">{karte.serial}</td>
                      <td>{karte.kind === 'band' ? 'Bändchen' : 'Karte'}</td>
                      <td>
                        {karte.status === 'lost' ? (
                          <span className="badge danger">verloren</span>
                        ) : karte.status === 'retired' ? (
                          <span className="badge">verbraucht</span>
                        ) : karte.heldBy ? (
                          <span className="badge ok">ausgegeben</span>
                        ) : (
                          'frei'
                        )}
                      </td>
                      <td>{karte.heldBy ? (namen.get(karte.heldBy) ?? 'unbekannt') : '—'}</td>
                      <td className="row">
                        {karte.status === 'available' ? (
                          <>
                            <button
                              className="ghost danger"
                              title="Wer sie findet, kann damit nichts mehr anfangen."
                              onClick={() => void ausweisStatus(karte, 'lost')}
                            >
                              Verloren
                            </button>
                            <button
                              className="ghost"
                              title="Zerkratzt, unlesbar, verbraucht — sie kommt nicht mehr in den Stapel."
                              onClick={() => void ausweisStatus(karte, 'retired')}
                            >
                              Ausmustern
                            </button>
                          </>
                        ) : (
                          <button className="ghost" onClick={() => void ausweisStatus(karte, 'available')}>
                            Wieder freigeben
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      <div className="reihenfolge" style={{ order: 2 }}>
        <Card title="2. Ausweise vorbereiten — Karten und Bändchen einlesen">
          <div className="hint">
            Die Liste kommt vom Hersteller — je Zeile die aufgedruckte Nummer und der Code, getrennt durch
            Semikolon. Gespeichert wird nur die Prüfsumme des Codes; die Liste gehört danach vernichtet, denn
            sie ist ein Stapel gültiger Ausweise in Textform.
          </div>
          <div className="row mt-2">
            {/* Breit genug, dass beide Wahlmöglichkeiten in einer Zeile stehen —
              in einer Reihe schrumpft ein Feld sonst auf seinen Inhalt. */}
            <div style={{ minWidth: '320px' }}>
              <Field label="Art des Ausweises">
                <select
                  value={importArt}
                  onChange={(ereignis) => setImportArt(ereignis.target.value as Ausweis['kind'])}
                >
                  <option value="card">Karten — kommen am Ausgang zurück</option>
                  <option value="band">Bändchen — werden abgerissen</option>
                </select>
              </Field>
            </div>
            <div className="hint" style={{ flex: 1, minWidth: '240px' }}>
              {importArt === 'card'
                ? 'Eine zurückgegebene Karte geht wieder in den Stapel — sie lässt sich an diesem Abend erneut ausgeben.'
                : 'Ein abgerissenes Bändchen ist verbraucht. Wer den Saal verlässt und wiederkommt, bekommt ein neues.'}
            </div>
          </div>
          <textarea
            className="mt-2"
            rows={4}
            placeholder={`0001;A7F2-9K3M-XQ81-2BVR
0002;L4D8-3PZ1-9WTC-6HNE`}
            value={importText}
            onChange={(ereignis) => setImportText(ereignis.target.value)}
          />
          <div className="row mt-2">
            <button className="primary" disabled={!importText.trim()} onClick={() => void kartenEinlesen()}>
              Einlesen
            </button>
            <div className="hint">
              {importText.trim() ? `${zeilenZahl(importText)} Zeilen` : 'Noch keine Liste eingefügt.'}
            </div>
          </div>
        </Card>
      </div>

      <div className="reihenfolge" style={{ order: liste.length > 0 ? 3 : 1 }}>
        <Card title="1. Teilnehmer aufnehmen">
          <div className="row">
            <Field label="Nachname">
              <input
                value={neu.lastName}
                onChange={(ereignis) => setNeu({ ...neu, lastName: ereignis.target.value })}
              />
            </Field>
            <Field label="Vorname">
              <input
                value={neu.firstName}
                onChange={(ereignis) => setNeu({ ...neu, firstName: ereignis.target.value })}
              />
            </Field>
            <Field label="Nummer">
              <input
                value={neu.number}
                onChange={(ereignis) => setNeu({ ...neu, number: ereignis.target.value })}
              />
            </Field>
            <Field label="Stimmgewicht">
              {/* Kein rohes Zahlenfeld: Eine 0 oder eine −1 nahm es bisher an,
                und eine Stimme, die nichts wiegt, gibt es nicht. */}
              <NumberInput
                value={Number.parseInt(neu.weight, 10) || 1}
                min={1}
                max={999}
                onChange={(wert) => setNeu({ ...neu, weight: String(wert) })}
              />
            </Field>
            <button className="primary" onClick={() => void aufnehmen()}>
              Aufnehmen
            </button>
          </div>
        </Card>

        <Card title={`Teilnehmer (${gefiltert.length} von ${liste.length})`}>
          {liste.length === 0 ? (
            <EmptyState text="Noch niemand erfasst. Teilnehmer oben aufnehmen." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Nummer</th>
                  <th>Stimmrecht</th>
                  <th>Seit</th>
                  <th>Pass</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {gefiltert.map((person) => (
                  <tr
                    key={person.id}
                    className={ausgewaehlt?.id === person.id ? 'ausgewaehlt' : undefined}
                    onClick={() => void antippen(person)}
                  >
                    <td>
                      {person.lastName}, {person.firstName}
                      {person.blockedAt && (
                        <span className="badge danger" title={person.blockedReason ?? undefined}>
                          gesperrt
                        </span>
                      )}
                    </td>
                    <td>{person.number ?? '—'}</td>
                    <td>
                      {person.eligible ? (person.weight > 1 ? `${person.weight} Stimmen` : 'ja') : 'Gast'}
                    </td>
                    <td>{person.present ? uhrzeit(person.lastSeenAt) : '—'}</td>
                    <td>{person.passIssued ? 'Pass' : '—'}</td>
                    <td className="row" onClick={(ereignis) => ereignis.stopPropagation()}>
                      <button onClick={() => void anwesenheit(person, person.present ? 'out' : 'in')}>
                        {person.present ? 'Gegangen' : 'Da'}
                      </button>
                      {person.eligible && !person.blockedAt && (
                        <button
                          onClick={() => void passAusgeben(person)}
                          title={
                            person.passIssued
                              ? 'Druckt einen neuen Pass. Der alte gilt damit nicht mehr — je Person gibt es genau einen.'
                              : 'Druckt einen Voting Pass mit QR-Code.'
                          }
                        >
                          {person.passIssued ? 'Pass ersetzen' : 'Pass'}
                        </button>
                      )}
                      <button
                        className="ghost"
                        title="Angaben berichtigen, sperren, Verlauf ansehen."
                        onClick={() => bearbeitenOeffnen(person)}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {bearbeiten && (
        <Modal
          title={`${bearbeiten.person.lastName}, ${bearbeiten.person.firstName}`}
          onClose={() => setBearbeiten(null)}
          actions={
            <>
              <button onClick={() => setBearbeiten(null)}>Abbrechen</button>
              <button
                className="primary"
                disabled={!bearbeiten.form.lastName.trim()}
                onClick={() => void bearbeitenSpeichern()}
              >
                Speichern
              </button>
            </>
          }
        >
          <div className="row">
            <Field label="Nachname">
              <input
                autoFocus
                value={bearbeiten.form.lastName}
                onChange={(ereignis) =>
                  setBearbeiten({
                    ...bearbeiten,
                    form: { ...bearbeiten.form, lastName: ereignis.target.value }
                  })
                }
              />
            </Field>
            <Field label="Vorname">
              <input
                value={bearbeiten.form.firstName}
                onChange={(ereignis) =>
                  setBearbeiten({
                    ...bearbeiten,
                    form: { ...bearbeiten.form, firstName: ereignis.target.value }
                  })
                }
              />
            </Field>
            <Field label="Nummer" hint="Mitglieds- oder Delegiertennummer, wie sie in der Einladung steht.">
              <input
                value={bearbeiten.form.number}
                onChange={(ereignis) =>
                  setBearbeiten({
                    ...bearbeiten,
                    form: { ...bearbeiten.form, number: ereignis.target.value }
                  })
                }
              />
            </Field>
            <Field
              label="Stimmen"
              hint="Wie viele Stimmen diese Person führt — bei Delegierten mehr als eine."
            >
              <NumberInput
                value={bearbeiten.form.weight}
                min={1}
                max={999}
                disabled={!bearbeiten.form.eligible}
                onChange={(wert) =>
                  setBearbeiten({ ...bearbeiten, form: { ...bearbeiten.form, weight: wert } })
                }
              />
            </Field>
          </div>
          <Field label="Rolle">
            <select
              value={bearbeiten.form.eligible ? 'ja' : 'nein'}
              onChange={(ereignis) =>
                setBearbeiten({
                  ...bearbeiten,
                  form: { ...bearbeiten.form, eligible: ereignis.target.value === 'ja' }
                })
              }
            >
              <option value="ja">Stimmberechtigt</option>
              <option value="nein">Gast — ohne Stimmrecht</option>
            </select>
          </Field>
          <Field label="Notiz" hint="Steht nur in der Liste, nicht auf dem Ausweis.">
            <input
              value={bearbeiten.form.note}
              onChange={(ereignis) =>
                setBearbeiten({ ...bearbeiten, form: { ...bearbeiten.form, note: ereignis.target.value } })
              }
            />
          </Field>

          {/*
            Die Sperre steht bewusst unter den Angaben und nicht in der Zeile:
            Sie ist der schärfste Eingriff dieser Seite und soll einen Moment
            Aufmerksamkeit kosten.
          */}
          <hr className="mt-2" />
          {bearbeiten.person.blockedAt ? (
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>Gesperrt</strong> seit {uhrzeit(bearbeiten.person.blockedAt)}
                {bearbeiten.person.blockedReason ? ` — ${bearbeiten.person.blockedReason}` : ''}
              </div>
              <button onClick={() => void personEntsperren(bearbeiten.person)}>Entsperren</button>
            </div>
          ) : (
            <Field
              label="Sperren"
              hint="Danach bekommt diese Person weder einen Stimmzettel noch eine digitale Berechtigung — gleich welchen Ausweis sie vorzeigt. Aufheben geht jederzeit; beides steht mit Begründung und Uhrzeit im Protokoll."
            >
              <div className="row">
                <input
                  value={bearbeiten.grund}
                  placeholder="Begründung, z. B. nicht stimmberechtigt laut Mitgliederliste"
                  onChange={(ereignis) => setBearbeiten({ ...bearbeiten, grund: ereignis.target.value })}
                />
                <button
                  className="danger"
                  disabled={!bearbeiten.grund.trim()}
                  onClick={() => void personSperren()}
                >
                  Sperren
                </button>
              </div>
            </Field>
          )}

          <hr className="mt-2" />
          <h3>Kommen und Gehen</h3>
          {verlauf === null ? (
            <p className="hint">Wird geladen …</p>
          ) : verlauf.length === 0 ? (
            <p className="hint">Noch kein Eintrag — diese Person war heute nicht am Einlass.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Zeit</th>
                  <th>Vorgang</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {verlauf.map((eintrag) => (
                  <tr key={eintrag.id}>
                    <td className="mono">{uhrzeit(eintrag.at)}</td>
                    <td>{eintrag.kind === 'in' ? 'gekommen' : 'gegangen'}</td>
                    <td>{eintrag.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  )
}

function Zahl({ wert, text }: { wert: number; text: string }): React.JSX.Element {
  return (
    <div className="kpi">
      <span className="value">{wert}</span>
      <span className="label">{text}</span>
    </div>
  )
}

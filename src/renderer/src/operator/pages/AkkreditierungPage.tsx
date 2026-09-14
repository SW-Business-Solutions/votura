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
import type { Card as Ausweis, CardStock, Participant, PresenceSummary } from '@shared/types'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState, Field } from '../components/ui'
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
  const sucheFeld = useRef<HTMLInputElement | null>(null)

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
    <>
      <div className="page-header">
        <div>
          <h1>Akkreditierung</h1>
          <div className="subtitle">
            Wer da ist und wer mitstimmen darf. Die Zahl der stimmberechtigten Anwesenden geht in jeden
            Wahlgang ein, der ab jetzt eröffnet wird.
          </div>
        </div>
      </div>

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

      <Card title="Einlass">
        <div className="hint">
          Pass scannen oder Namen tippen. Ein Scanner gibt den Pass als Tastatureingabe ein und schließt mit
          der Eingabetaste ab — es muss niemand die Maus anfassen.
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
            Dieser Wert erscheint <strong>nur jetzt</strong>. Gespeichert wird nur seine Prüfsumme — er lässt
            sich später nicht nachschlagen, sondern nur neu ausgeben, wobei der alte verfällt.
          </div>
          <button className="mt-2" onClick={() => setPassAnzeige(null)}>
            Schließen
          </button>
        </Card>
      )}

      <Card title="Karten und Bändchen einlesen">
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
            {importText.trim()
              ? `${zeilenZahl(importText)} Zeilen`
              : 'Noch keine Liste eingefügt.'}
          </div>
        </div>
      </Card>

      <Card title="Teilnehmer aufnehmen">
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
            <input
              type="number"
              min={1}
              value={neu.weight}
              onChange={(ereignis) => setNeu({ ...neu, weight: ereignis.target.value })}
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
                    {person.blockedAt && <span className="badge">gesperrt</span>}
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
                      <button onClick={() => void passAusgeben(person)}>
                        {person.passIssued ? 'Pass neu' : 'Pass'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
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

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
import type { Participant, PresenceSummary } from '@shared/types'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState, Field } from '../components/ui'

/** Wie ein Zeitpunkt am Einlass aussehen soll: kurz. */
function uhrzeit(wert?: string): string {
  if (!wert) return '—'
  return new Date(wert).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
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
  const sucheFeld = useRef<HTMLInputElement | null>(null)

  const laden = useCallback(async () => {
    if (!event) return
    try {
      const [teilnehmer, zusammenfassung] = await Promise.all([
        api('participant.list', event.id),
        api('participant.presence', event.id)
      ])
      setListe(teilnehmer)
      setStand(zusammenfassung)
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

  /**
   * Ein Scan oder eine Eingabe im Suchfeld.
   *
   * Sieht der Wert nach einem Voting Pass aus, wird er als solcher behandelt
   * und die Person unmittelbar auf „anwesend" gesetzt — das ist der Handgriff,
   * der am Einlass zählt. Sonst bleibt es eine gewöhnliche Suche.
   */
  const absenden = async (): Promise<void> => {
    const wert = suche.trim()
    if (!wert) return
    if (!/^[A-Za-z0-9]{16}$/.test(wert)) return

    try {
      const person = await api('participant.findByPass', { eventId: event.id, token: wert })
      if (!person) {
        setMeldung('Dieser Pass gehört zu niemandem in dieser Versammlung.')
        return
      }
      if (person.blockedAt) {
        setMeldung(`${person.firstName} ${person.lastName} ist gesperrt — ${person.blockedReason ?? ''}`)
        return
      }
      await anwesenheit(person, person.present ? 'out' : 'in')
      setSuche('')
      sucheFeld.current?.focus()
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

  const passAusgeben = async (person: Participant): Promise<void> => {
    if (
      person.passIssued &&
      !window.confirm(
        `${person.firstName} ${person.lastName} hat bereits einen Voting Pass.\n\n` +
          'Ein neuer Pass entwertet den alten. Fortfahren?'
      )
    ) {
      return
    }
    try {
      const { token } = await api('participant.issuePass', person.id)
      setPassAnzeige({ name: `${person.firstName} ${person.lastName}`, token })
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
        <input
          ref={sucheFeld}
          autoFocus
          className="mt-2"
          placeholder="Voting Pass scannen oder Namen suchen …"
          value={suche}
          onChange={(ereignis) => setSuche(ereignis.target.value)}
          onKeyDown={(ereignis) => {
            if (ereignis.key === 'Enter') void absenden()
          }}
        />
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
                <tr key={person.id} className={person.present ? 'anwesend' : undefined}>
                  <td>
                    {person.lastName}, {person.firstName}
                    {person.blockedAt && <span className="badge">gesperrt</span>}
                  </td>
                  <td>{person.number ?? '—'}</td>
                  <td>
                    {person.eligible ? (person.weight > 1 ? `${person.weight} Stimmen` : 'ja') : 'Gast'}
                  </td>
                  <td>{person.present ? uhrzeit(person.lastSeenAt) : '—'}</td>
                  <td>{person.passIssued ? 'ausgegeben' : '—'}</td>
                  <td className="row">
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

/**
 * Ausgabe der Stimmzettel: ein Zettel gegen einen Ausweis.
 *
 * Der Tisch neben dem Einlass. Hier steht jemand, hat die Hände voll und
 * schaut kaum auf den Bildschirm — deshalb ist diese Seite so gebaut, dass ein
 * einziger Scan alles auslöst und die Antwort in einem Satz dasteht, groß
 * genug, um sie im Vorbeigehen zu lesen.
 *
 * Was der Scan prüft, prüft der Dienst: erfasst, stimmberechtigt, nicht
 * gesperrt, **im Saal** — und für diesen Wahlgang noch keinen Zettel bekommen.
 * Die Seite entscheidet nichts selbst; sie zeigt nur, was herauskam.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Participant, RoundSummary } from '@shared/types'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState } from '../components/ui'

type Antwort = { art: 'gut'; text: string; person: Participant } | { art: 'schlecht'; text: string } | null

export function AusgabePage(): React.JSX.Element {
  const app = useApp()
  const event = app.event
  const [wahlgang, setWahlgang] = useState<RoundSummary | null>(null)
  const [stand, setStand] = useState<{ initial: number; replacements: number } | null>(null)
  const [code, setCode] = useState('')
  const [antwort, setAntwort] = useState<Antwort>(null)
  const feld = useRef<HTMLInputElement | null>(null)

  /*
   * Ausgegeben wird immer für **einen** Wahlgang, und zwar den, der gerade
   * läuft. Eine Auswahlliste wäre an diesem Tisch eine Fehlerquelle: Wer sie
   * einmal falsch stehen lässt, teilt den ganzen Abend die falschen Zettel
   * aus.
   */
  const offene = app.rounds.filter(
    (runde) => runde.status === 'printing' || runde.status === 'open' || runde.status === 'ready'
  )

  const laden = useCallback(async () => {
    if (!wahlgang) return
    try {
      setStand(await api('handout.count', wahlgang.id))
    } catch (error) {
      app.reportError(error)
    }
  }, [wahlgang?.id])

  useEffect(() => {
    void laden()
  }, [laden])

  useEffect(() => {
    /* Genau ein offener Wahlgang: dann ist die Frage beantwortet, und niemand
       muss an diesem Tisch etwas auswählen. */
    if (!wahlgang && offene.length === 1) setWahlgang(offene[0])
  }, [offene.length, wahlgang])

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

  const scannen = async (): Promise<void> => {
    const wert = code.trim()
    if (!wahlgang || wert.length < 10 || /\s/.test(wert)) return

    try {
      const treffer = await api('card.resolve', { eventId: event.id, code: wert })
      /* Karte, Bändchen oder Pass — an diesem Tisch ist nur eines wichtig:
         zu wem er gehört. */
      const person = treffer?.participant ?? null

      if (!person) {
        setAntwort({
          art: 'schlecht',
          text:
            treffer === null
              ? 'Unbekannter Ausweis.'
              : 'Dieser Ausweis ist niemandem zugewiesen — zuerst am Einlass ausgeben.'
        })
        return
      }

      const { participant } = await api('handout.issue', {
        roundId: wahlgang.id,
        participantId: person.id
      })
      setAntwort({
        art: 'gut',
        text: `${participant.firstName} ${participant.lastName} — Stimmzettel ausgeben`,
        person: participant
      })
      await laden()
    } catch (error) {
      /* Die Meldung des Dienstes ist die Antwort: Sie nennt Namen, Grund und
         Uhrzeit. Sie hier umzuformulieren hieße, sie zu verschlechtern. */
      setAntwort({ art: 'schlecht', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setCode('')
      feld.current?.focus()
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ausgabe der Stimmzettel</h1>
          <div className="subtitle">
            Ein Zettel gegen einen Ausweis. Je Wahlgang bekommt jeder genau einen; der zweite Versuch wird
            abgewiesen.
          </div>
        </div>
      </div>

      {offene.length === 0 ? (
        <EmptyState text="Gerade läuft kein Wahlgang, für den Zettel auszugeben wären." />
      ) : (
        <>
          <Card title="Wahlgang">
            {offene.length === 1 && wahlgang ? (
              <p>
                <strong>{wahlgang.roundLabel}</strong> — {wahlgang.title}
              </p>
            ) : (
              <div className="row">
                {offene.map((runde) => (
                  <button
                    key={runde.id}
                    className={wahlgang?.id === runde.id ? 'primary' : ''}
                    onClick={() => setWahlgang(runde)}
                  >
                    {runde.roundLabel} — {runde.title}
                  </button>
                ))}
              </div>
            )}
          </Card>

          {wahlgang && (
            <Card title="Ausweis scannen">
              <input
                ref={feld}
                autoFocus
                placeholder="Karte, Bändchen oder Pass scannen …"
                value={code}
                onChange={(ereignis) => setCode(ereignis.target.value)}
                onKeyDown={(ereignis) => {
                  if (ereignis.key === 'Enter') void scannen()
                }}
              />
              {antwort && (
                <div
                  className={`notice mt-2 ${antwort.art === 'gut' ? 'ok' : 'warn'}`}
                  style={{ fontSize: '18px' }}
                >
                  {antwort.text}
                </div>
              )}
            </Card>
          )}

          {stand && (
            <Card tight>
              <div className="grid cols-4">
                <div className="kpi">
                  <span className="value">{stand.initial}</span>
                  <span className="label">Zettel ausgegeben</span>
                </div>
                <div className="kpi">
                  <span className="value">{stand.replacements}</span>
                  <span className="label">davon Ersatz</span>
                </div>
              </div>
              <div className="hint mt-2">
                Diese Zahlen gehen unmittelbar in die Stimmzettelbilanz ein — sie werden nicht eingetippt,
                sondern gezählt.
              </div>
            </Card>
          )}
        </>
      )}
    </>
  )
}

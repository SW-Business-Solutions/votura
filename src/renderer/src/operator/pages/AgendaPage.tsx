/**
 * Tagesordnung: vorab vorbereiten, während der Versammlung korrigieren.
 *
 * Punkte lassen sich verschieben und an beliebiger Stelle einschieben — etwa
 * ein Änderungsantrag zwischen zwei Anträgen. Wahlgänge erhalten ihre Nummer
 * und Kennung erst beim Start, damit Verschieben gefahrlos bleibt.
 */
import { useCallback, useEffect, useState } from 'react'
import { PROCEDURE_LABELS, ROUND_STATUS_LABELS, type AgendaItem } from '@shared/types'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState, Field } from '../components/ui'

export function AgendaPage(): React.JSX.Element {
  const app = useApp()
  const event = app.event
  const [items, setItems] = useState<AgendaItem[]>([])
  const [title, setTitle] = useState('')
  const [label, setLabel] = useState('')
  const [insertAt, setInsertAt] = useState<number | undefined>(undefined)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!event) return
    try {
      setItems(await api('agenda.list', event.id))
    } catch (error) {
      app.reportError(error)
    }
  }, [event?.id])

  useEffect(() => {
    void load()
  }, [load, app.rounds.length])

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

  const roundOf = (item: AgendaItem): (typeof app.rounds)[number] | undefined =>
    app.rounds.find((round) => round.id === item.roundId)

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    try {
      await api('agenda.add', {
        eventId: event.id,
        title,
        label: label || undefined,
        position: insertAt
      })
      setTitle('')
      setLabel('')
      setInsertAt(undefined)
      await load()
    } catch (error) {
      app.reportError(error)
    }
  }

  const move = async (from: number, to: number): Promise<void> => {
    if (to < 0 || to >= items.length) return
    const ordered = [...items]
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    setItems(ordered)
    try {
      setItems(await api('agenda.reorder', { eventId: event.id, orderedIds: ordered.map((item) => item.id) }))
      await app.refreshRounds()
    } catch (error) {
      app.reportError(error)
      await load()
    }
  }

  const toggleDone = async (item: AgendaItem): Promise<void> => {
    try {
      await api('agenda.update', { id: item.id, done: !item.done })
      await load()
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tagesordnung</h1>
          <div className="subtitle">
            Vorab vorbereiten, während der Versammlung jederzeit ändern. Wahlgänge erscheinen automatisch;
            weitere Punkte können Sie frei ergänzen.
          </div>
        </div>
        <div className="row">
          <button onClick={() => navigate('round/new')}>+ Wahlgang vorbereiten</button>
          <button
            onClick={() =>
              void api('projection.setMode', {
                mode: 'agenda',
                agenda: {
                  top: items.find((item) => !item.done)?.label,
                  current: items.find((item) => !item.done)?.title,
                  next: items.filter((item) => !item.done)[1]?.title
                }
              }).catch(app.reportError)
            }
          >
            Auf Beamer zeigen
          </button>
        </div>
      </div>

      <div className="grid cols-2">
        <Card title={`Punkte (${items.length})`}>
          {items.length === 0 ? (
            <EmptyState text="Noch keine Tagesordnungspunkte." />
          ) : (
            <ul className="list-reset">
              {items.map((item, index) => {
                const round = roundOf(item)
                return (
                  <li
                    key={item.id}
                    className={`drag-item${dragIndex === index ? ' dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(dragEvent) => dragEvent.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== index) void move(dragIndex, index)
                      setDragIndex(null)
                    }}
                  >
                    <span className="grip">⋮⋮</span>
                    <input
                      type="checkbox"
                      checked={item.done}
                      title="Als erledigt markieren"
                      onChange={() => void toggleDone(item)}
                      style={{ width: 18, height: 18, flex: 'none' }}
                    />
                    <span style={{ flex: 1, opacity: item.done ? 0.55 : 1 }}>
                      <strong>
                        {item.label ? `${item.label} · ` : ''}
                        {item.title}
                      </strong>
                      {round && (
                        <div className="hint">
                          {round.sequentialNumber > 0 ? `Wahlgang ${round.roundLabel} · ` : 'In Vorbereitung · '}
                          {PROCEDURE_LABELS[round.procedure]} · {ROUND_STATUS_LABELS[round.status]}
                        </div>
                      )}
                      {item.note && <div className="hint">{item.note}</div>}
                    </span>
                    <button className="ghost" onClick={() => void move(index, index - 1)} title="Nach oben">
                      ↑
                    </button>
                    <button className="ghost" onClick={() => void move(index, index + 1)} title="Nach unten">
                      ↓
                    </button>
                    {round ? (
                      <button onClick={() => navigate(`round/${round.id}`)}>Öffnen</button>
                    ) : (
                      <button
                        className="ghost"
                        onClick={async () => {
                          try {
                            setItems(await api('agenda.remove', item.id))
                          } catch (error) {
                            app.reportError(error)
                          }
                        }}
                      >
                        Entfernen
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div>
          <Card title="Punkt hinzufügen">
            <div className="row">
              <div style={{ width: 130 }}>
                <Field label="Nummer">
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="TOP 7" />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Bezeichnung">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && void add()}
                    placeholder="z. B. Bericht des Vorstands"
                  />
                </Field>
              </div>
            </div>
            <Field
              label="Einfügen an Position"
              hint="Leer lassen, um den Punkt ans Ende zu setzen. So schieben Sie z. B. einen Änderungsantrag dazwischen."
            >
              <select
                value={insertAt ?? ''}
                onChange={(e) => setInsertAt(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">– ans Ende –</option>
                {items.map((item, index) => (
                  <option key={item.id} value={index + 1}>
                    vor „{item.title}"
                  </option>
                ))}
              </select>
            </Field>
            <button className="primary" disabled={!title.trim()} onClick={() => void add()}>
              Hinzufügen
            </button>
          </Card>

          <Card title="Ablauf">
            <p className="hint">
              Ein vorbereiteter Wahlgang bekommt seine Nummer und Wahlgangkennung erst, wenn Sie ihn starten.
              Bis dahin können Sie die Reihenfolge beliebig ändern, ohne dass Kennungen wandern.
            </p>
            <ul>
              <li>Punkte vorab anlegen und sortieren.</li>
              <li>Bei Bedarf Änderungsanträge einschieben.</li>
              <li>Wahlgang öffnen und starten, wenn er an der Reihe ist.</li>
              <li>Erledigte Punkte abhaken — der nächste offene Punkt ist der aktuelle.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}

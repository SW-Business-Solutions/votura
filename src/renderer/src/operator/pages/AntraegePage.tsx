/**
 * Das Antragsbuch.
 *
 * ## Warum eine eigene Seite und kein Reiter im Wahlgang
 *
 * Weil ein Antrag den Wahlgang überlebt — und ihn oft gar nicht erreicht. Er
 * wird eingereicht, bevor irgendjemand weiß, ob darüber abgestimmt wird; er
 * kann übernommen, zurückgezogen oder erledigt werden, ohne dass je ein
 * Wahlgang entsteht. Ihn unter „Wahlgänge" zu führen hieße, die Hälfte der
 * Anträge einer Versammlung nirgends unterzubringen.
 *
 * ## Was hier bewusst nicht automatisch geschieht
 *
 * Die **Reihenfolge** der Änderungsanträge wird gesetzt, nicht gerechnet.
 * Welcher „weitergehend" ist, ist eine Wertung der Versammlungsleitung; zwei
 * Anträge können sich in verschiedene Richtungen weiter vom Original
 * entfernen. Ein Programm, das hier selbst sortierte, träfe unsichtbar eine
 * anfechtbare Entscheidung.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ANTRAGSSTATUS_LABELS,
  type Abstimmungsschritt,
  type Antrag,
  type Antragsstatus
} from '@shared/antrag'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, ConfirmDialog, EmptyState, Field, Modal } from '../components/ui'

/** Über diese Stände wird noch abgestimmt. */
const OFFEN: Antragsstatus[] = ['eingereicht', 'zugelassen']

/**
 * Der Stand als Abzeichen — wie überall sonst im Programm.
 *
 * Er stand hier zuerst als graues Wort in einer Zeile mit Antragsteller und
 * Vermerk. Das war der Grund, warum „Zulassen" wie ein toter Knopf wirkte:
 * Der Aufruf lief, der Stand wechselte, und zu sehen war der Unterschied
 * zwischen „Eingereicht" und „Zugelassen" in zwei grauen Wörtern nebeneinander
 * praktisch nicht.
 */
function Stand({ status }: { status: Antragsstatus }): React.JSX.Element {
  const ton =
    status === 'beschlossen'
      ? 'ok'
      : status === 'abgelehnt' || status === 'zurueckgezogen'
        ? 'danger'
        : status === 'zugelassen'
          ? 'accent'
          : status === 'uebernommen' || status === 'erledigt'
            ? 'ok'
            : 'warn'
  return <span className={`badge ${ton}`}>{ANTRAGSSTATUS_LABELS[status]}</span>
}

export function AntraegePage(): React.JSX.Element {
  const app = useApp()
  const eventId = app.event?.id
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [neu, setNeu] = useState<{ art: 'haupt' | 'aenderung'; bezugId?: string } | null>(null)
  const [bearbeiten, setBearbeiten] = useState<Antrag | null>(null)
  const [erledigen, setErledigen] = useState<Antrag | null>(null)
  const [loeschen, setLoeschen] = useState<Antrag | null>(null)
  const [reihenfolge, setReihenfolge] = useState<Record<string, Abstimmungsschritt[]>>({})

  const darf = app.can('round.manage')

  const laden = useCallback(async () => {
    if (!eventId) return
    try {
      const liste = await api('motion.list', eventId)
      setAntraege(liste)
      /* Die Reihenfolge je Hauptantrag gleich mitholen — sie ist der Grund,
         warum diese Seite überhaupt existiert. */
      const schritte: Record<string, Abstimmungsschritt[]> = {}
      for (const antrag of liste.filter((a) => a.art === 'haupt')) {
        schritte[antrag.id] = await api('motion.order', antrag.id)
      }
      setReihenfolge(schritte)
    } catch (error) {
      app.reportError(error)
    }
  }, [eventId])

  useEffect(() => {
    void laden()
  }, [laden])

  const haupt = antraege.filter((antrag) => antrag.art === 'haupt')
  const aenderungenZu = (id: string): Antrag[] =>
    antraege.filter((antrag) => antrag.bezugId === id).sort((a, b) => a.reihenfolge - b.reihenfolge)

  /**
   * Etwas tun und die Liste neu holen — auf Wunsch mit einem Wort dazu.
   *
   * Die Meldung ist nicht Zierde. Ein Standwechsel ändert an dieser Seite
   * ein Abzeichen und sonst nichts; wer gerade auf die Knopfreihe geschaut
   * hat, sieht ihn nicht. Eine kurze Rückmeldung sagt, dass etwas geschehen
   * ist — und was.
   */
  const rufe = async (tun: () => Promise<unknown>, meldung?: string): Promise<void> => {
    try {
      await tun()
      await laden()
      if (meldung) app.notify('ok', meldung)
    } catch (error) {
      app.reportError(error)
    }
  }

  /**
   * Aus dem Antrag eine Abstimmung machen — und gleich hingehen.
   *
   * Der Sprung in den Wahlgang gehört dazu: Wer diesen Knopf drückt, hat es
   * eilig. Ihn danach auf der Antragsseite stehen zu lassen hieße, ihn den
   * eben angelegten Wahlgang selbst suchen zu lassen.
   */
  const zurAbstimmung = async (antrag: Antrag): Promise<void> => {
    try {
      const runde = await api('motion.toRound', { id: antrag.id })
      app.notify('ok', `Abstimmung zu ${antrag.nummer} angelegt.`)
      await app.refreshRounds()
      navigate(`round/${runde.id}`)
    } catch (error) {
      app.reportError(error)
    }
  }

  const verschieben = async (antrag: Antrag, richtung: -1 | 1): Promise<void> => {
    const geschwister = aenderungenZu(antrag.bezugId!)
    const i = geschwister.findIndex((eintrag) => eintrag.id === antrag.id)
    const j = i + richtung
    if (j < 0 || j >= geschwister.length) return
    const neueFolge = [...geschwister]
    ;[neueFolge[i], neueFolge[j]] = [neueFolge[j], neueFolge[i]]
    await rufe(() =>
      api('motion.reorder', {
        bezugId: antrag.bezugId!,
        reihenfolge: neueFolge.map((eintrag) => eintrag.id)
      })
    )
  }

  if (!eventId) {
    return <EmptyState text="Bitte zuerst eine Veranstaltung anlegen." />
  }

  return (
    <>
      {/*
        Seitenkopf wie überall: Titel und Untertitel links, die Handlung
        rechts. Hier stand zuerst `page-head` — eine Klasse, die es im
        Stylesheet gar nicht gibt. Die Seite sah dadurch aus wie aus einem
        anderen Programm, und zwar ohne dass etwas kaputt war.
      */}
      <div className="page-header">
        <div>
          <h1>Anträge</h1>
          <div className="subtitle">
            Das Antragsbuch dieser Versammlung. Über Änderungsanträge wird <strong>vor</strong> dem
            Hauptantrag abgestimmt — in der Reihenfolge, die hier gesetzt ist.
          </div>
        </div>
        <div className="row">
          <button className="primary" disabled={!darf} onClick={() => setNeu({ art: 'haupt' })}>
            + Antrag einreichen
          </button>
        </div>
      </div>

      {haupt.length === 0 ? (
        <EmptyState text="Noch keine Anträge. Sie bekommen eine Nummer und einen Antragsteller; beides steht später im Protokoll." />
      ) : (
        haupt.map((antrag) => {
          const aenderungen = aenderungenZu(antrag.id)
          const schritte = reihenfolge[antrag.id] ?? []
          return (
            <Card key={antrag.id} title={`${antrag.nummer} — ${antrag.titel}`}>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <Stand status={antrag.status} />
                <span className="hint">
                  {antrag.antragsteller}
                  {antrag.vermerk ? ` · ${antrag.vermerk}` : ''}
                </span>
              </div>
              <pre className="antrag-text">{antrag.text}</pre>
              {antrag.begruendung && (
                <details>
                  <summary>Begründung</summary>
                  {/* Die Begründung wird nicht mitbeschlossen — deshalb
                      eingeklappt und vom Antragstext abgesetzt. */}
                  <pre className="antrag-text">{antrag.begruendung}</pre>
                </details>
              )}

              <div className="row mt-3">
                <button disabled={!darf} onClick={() => setBearbeiten(antrag)}>
                  Bearbeiten
                </button>
                <button disabled={!darf} onClick={() => setNeu({ art: 'aenderung', bezugId: antrag.id })}>
                  Änderungsantrag dazu
                </button>
                {/*
                  Nur solange er etwas bewirkt.

                  Der Knopf stand zuerst auch bei einem bereits zugelassenen
                  Antrag da — und tat dann genau nichts. Ein Knopf, der nichts
                  auslöst, ist schlimmer als keiner: Wer ihn drückt, sucht den
                  Fehler bei sich.
                */}
                {antrag.status === 'eingereicht' && (
                  <button
                    disabled={!darf}
                    title="Der Antrag ist damit zur Abstimmung zugelassen."
                    onClick={() =>
                      void rufe(
                        () => api('motion.setStatus', { id: antrag.id, status: 'zugelassen' }),
                        `${antrag.nummer} zugelassen.`
                      )
                    }
                  >
                    Zulassen
                  </button>
                )}
                <button disabled={!darf} onClick={() => setErledigen(antrag)}>
                  Zurückziehen / erledigen
                </button>
                {/*
                  Der Weg für den Fall, den jede Versammlungsleitung kennt:
                  Das Handzeichen ist nicht eindeutig auszuzählen.

                  Dann muss es schnell gehen — „Wahlgang anlegen, Titel
                  abtippen, Antragstext einfügen, Verfahren wählen" ist in
                  diesem Moment zu lang. Ein Klick, und der Wahlgang steht
                  fertig da.
                */}
                {antrag.roundId ? (
                  <button onClick={() => navigate(`round/${antrag.roundId}`)}>
                    Zur Abstimmung
                  </button>
                ) : (
                  <button
                    disabled={!darf}
                    title="Legt einen Wahlgang als Sachabstimmung an — Wortlaut samt übernommener Änderungen, Ja / Nein / Enthaltung."
                    onClick={() => void zurAbstimmung(antrag)}
                  >
                    Abstimmen lassen
                  </button>
                )}
                {/*
                  Auf den Beamer — zweimal, und der Unterschied ist wichtig.

                  „Wortlaut" zeigt den eingereichten Text; „mit Änderungen"
                  den, über den am Ende abgestimmt wird. Während der Debatte
                  gilt der erste, bei der Schlussabstimmung der zweite. Ein
                  einziger Knopf müsste raten, welcher gemeint ist.
                */}
                <button
                  className="primary"
                  disabled={!darf}
                  title="Den eingereichten Wortlaut zeigen."
                  onClick={() =>
                    void rufe(() =>
                      api('projection.setMode', { mode: 'antrag', antrag: { id: antrag.id } }, app.ziel)
                    )
                  }
                >
                  Wortlaut auf den Beamer
                </button>
                <button
                  disabled={!darf}
                  title="Den Text zeigen, über den abgestimmt wird — samt übernommener Änderungen."
                  onClick={() =>
                    void rufe(() =>
                      api(
                        'projection.setMode',
                        { mode: 'antrag', antrag: { id: antrag.id, mitAenderungen: true } },
                        app.ziel
                      )
                    )
                  }
                >
                  Mit Änderungen auf den Beamer
                </button>
                {!antrag.roundId && (
                  <button className="ghost" disabled={!darf} onClick={() => setLoeschen(antrag)}>
                    Löschen
                  </button>
                )}
              </div>

              {aenderungen.length > 0 && (
                <div className="mt-3">
                  <h3>Änderungsanträge</h3>
                  {/*
                    Eine Liste aus `drag-item`-Zeilen wie die Tagesordnung —
                    nicht eine Tabelle. Hier stand zuerst `className="table"`,
                    und diese Klasse gibt es im Stylesheet nicht: Die Zeilen
                    hatten weder Rahmen noch Abstand noch Hintergrund.
                  */}
                  <ul className="list-reset">
                    {aenderungen.map((aenderung, i) => (
                      <li key={aenderung.id} className="drag-item antrag-zeile">
                        <div className="antrag-zeile-inhalt">
                          <div>
                            <strong>{aenderung.nummer}</strong> — {aenderung.titel}
                          </div>
                          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                            <Stand status={aenderung.status} />
                            <span className="hint">
                              {aenderung.antragsteller}
                              {aenderung.vermerk ? ` · ${aenderung.vermerk}` : ''}
                            </span>
                          </div>
                          <pre className="antrag-text">{aenderung.text}</pre>
                        </div>
                        <div className="row">
                          {/* Hoch und runter statt Ziehen: Auf einer
                              Versammlung wird mit der Maus gezielt, nicht
                              gezogen — und oft von jemandem, der das Gerät
                              zum ersten Mal bedient. */}
                          <button
                            className="mini"
                            aria-label="Früher abstimmen"
                            disabled={!darf || i === 0}
                            title="Früher abstimmen"
                            onClick={() => void verschieben(aenderung, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="mini"
                            aria-label="Später abstimmen"
                            disabled={!darf || i === aenderungen.length - 1}
                            title="Später abstimmen"
                            onClick={() => void verschieben(aenderung, 1)}
                          >
                            ↓
                          </button>
                          {OFFEN.includes(aenderung.status) && (
                            <button
                              disabled={!darf}
                              title={`${antrag.antragsteller} übernimmt den Änderungsantrag; über ihn wird dann nicht abgestimmt.`}
                              onClick={() =>
                                void rufe(
                                  () => api('motion.adopt', aenderung.id),
                                  `${aenderung.nummer} übernommen — darüber wird nicht abgestimmt.`
                                )
                              }
                            >
                              Übernehmen
                            </button>
                          )}
                          <button
                            disabled={!darf}
                            title="Diesen Änderungsantrag auf den Beamer."
                            onClick={() =>
                              void rufe(() =>
                                api(
                                  'projection.setMode',
                                  { mode: 'antrag', antrag: { id: aenderung.id } },
                                  app.ziel
                                )
                              )
                            }
                          >
                            Auf den Beamer
                          </button>
                          {aenderung.roundId ? (
                            <button onClick={() => navigate(`round/${aenderung.roundId}`)}>
                              Zur Abstimmung
                            </button>
                          ) : (
                            OFFEN.includes(aenderung.status) && (
                              <button
                                disabled={!darf}
                                title="Legt einen Wahlgang als Sachabstimmung über diesen Änderungsantrag an."
                                onClick={() => void zurAbstimmung(aenderung)}
                              >
                                Abstimmen lassen
                              </button>
                            )
                          )}
                          <button disabled={!darf} onClick={() => setBearbeiten(aenderung)}>
                            Bearbeiten
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {schritte.length > 0 && (
                <div className="notice mt-3">
                  <strong>Abstimmungsreihenfolge</strong>
                  <ol>
                    {schritte.map((schritt) => (
                      <li key={schritt.antrag.id}>
                        {schritt.antrag.nummer} — {schritt.antrag.titel}
                        <div className="hint">{schritt.grund}</div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
          )
        })
      )}

      {neu && (
        <AntragDialog
          eventId={eventId}
          art={neu.art}
          bezugId={neu.bezugId}
          bezugNummer={haupt.find((a) => a.id === neu.bezugId)?.nummer}
          onClose={() => setNeu(null)}
          onSaved={async () => {
            setNeu(null)
            await laden()
          }}
        />
      )}

      {bearbeiten && (
        <AntragDialog
          eventId={eventId}
          art={bearbeiten.art}
          vorhanden={bearbeiten}
          onClose={() => setBearbeiten(null)}
          onSaved={async () => {
            setBearbeiten(null)
            await laden()
          }}
        />
      )}

      {erledigen && (
        <ErledigenDialog
          antrag={erledigen}
          onClose={() => setErledigen(null)}
          onSaved={async () => {
            setErledigen(null)
            await laden()
          }}
        />
      )}

      {loeschen && (
        <ConfirmDialog
          title={`${loeschen.nummer} löschen?`}
          message={
            <p>
              Der Antrag verschwindet vollständig. Wurde er in der Versammlung bereits behandelt, ist{' '}
              <strong>Zurückziehen</strong> der richtige Weg — das bleibt nachvollziehbar.
            </p>
          }
          confirmLabel="Löschen"
          danger
          onCancel={() => setLoeschen(null)}
          onConfirm={async () => {
            await rufe(() => api('motion.delete', loeschen.id))
            setLoeschen(null)
          }}
        />
      )}
    </>
  )
}

function AntragDialog({
  eventId,
  art,
  bezugId,
  bezugNummer,
  vorhanden,
  onClose,
  onSaved
}: {
  eventId: string
  art: 'haupt' | 'aenderung'
  bezugId?: string
  bezugNummer?: string
  vorhanden?: Antrag
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const app = useApp()
  const [nummer, setNummer] = useState(vorhanden?.nummer ?? (art === 'aenderung' ? 'Ä ' : 'A '))
  const [titel, setTitel] = useState(vorhanden?.titel ?? '')
  const [text, setText] = useState(vorhanden?.text ?? '')
  const [antragsteller, setAntragsteller] = useState(vorhanden?.antragsteller ?? '')
  const [begruendung, setBegruendung] = useState(vorhanden?.begruendung ?? '')

  return (
    <Modal
      title={
        vorhanden
          ? `${vorhanden.nummer} bearbeiten`
          : art === 'aenderung'
            ? `Änderungsantrag zu ${bezugNummer ?? ''}`
            : 'Antrag einreichen'
      }
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                if (vorhanden) {
                  await api('motion.update', {
                    id: vorhanden.id,
                    nummer,
                    titel,
                    text,
                    antragsteller,
                    begruendung
                  })
                } else {
                  await api('motion.create', {
                    eventId,
                    art,
                    nummer,
                    titel,
                    text,
                    antragsteller,
                    begruendung,
                    bezugId
                  })
                }
                await onSaved()
              } catch (error) {
                app.reportError(error)
              }
            }}
          >
            Speichern
          </button>
        </>
      }
    >
      <div className="row">
        <div className="col-mittel">
          <Field label="Nummer" hint="Steht später im Protokoll.">
            <input value={nummer} onChange={(e) => setNummer(e.target.value)} autoFocus />
          </Field>
        </div>
        <div className="col">
          <Field label="Antragsteller" hint="Wer ihn gestellt hat — und wer ihn zurückziehen kann.">
            <input value={antragsteller} onChange={(e) => setAntragsteller(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="Titel">
        <input value={titel} onChange={(e) => setTitel(e.target.value)} />
      </Field>
      <Field label="Antragstext" hint="Genau der Wortlaut, über den abgestimmt wird.">
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Begründung (optional)" hint="Wird nicht mitbeschlossen.">
        <textarea rows={4} value={begruendung} onChange={(e) => setBegruendung(e.target.value)} />
      </Field>
    </Modal>
  )
}

function ErledigenDialog({
  antrag,
  onClose,
  onSaved
}: {
  antrag: Antrag
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const app = useApp()
  const [status, setStatus] = useState<Antragsstatus>('zurueckgezogen')
  const [vermerk, setVermerk] = useState('')

  return (
    <Modal
      title={`${antrag.nummer}: Stand ändern`}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={!vermerk.trim()}
            onClick={async () => {
              try {
                await api('motion.setStatus', { id: antrag.id, status, vermerk })
                await onSaved()
              } catch (error) {
                app.reportError(error)
              }
            }}
          >
            Übernehmen
          </button>
        </>
      }
    >
      <Field label="Neuer Stand">
        <select value={status} onChange={(e) => setStatus(e.target.value as Antragsstatus)}>
          <option value="zurueckgezogen">Zurückgezogen</option>
          <option value="erledigt">Erledigt</option>
        </select>
      </Field>
      {/*
        Der Vermerk ist Pflicht, und das ist keine Schikane.

        „Erledigt" heißt fast immer: Ein weitergehender Änderungsantrag wurde
        angenommen. Ohne diesen Satz steht im Protokoll ein Antrag, über den
        nie abgestimmt wurde, und niemand weiß mehr, warum.
      */}
      <Field
        label="Vermerk"
        hint="Warum? Etwa: „Durch Annahme von Ä 2 gegenstandslos.“ Ohne Vermerk ist es später nicht mehr nachvollziehbar."
      >
        <input value={vermerk} onChange={(e) => setVermerk(e.target.value)} autoFocus />
      </Field>
    </Modal>
  )
}

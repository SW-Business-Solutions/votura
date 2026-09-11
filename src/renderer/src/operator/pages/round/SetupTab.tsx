/**
 * Grunddaten eines Wahlgangs nachträglich ändern (§7, §58).
 *
 * Gedacht für vorbereitete Wahlgänge: Wer einen Punkt als Platzhalter angelegt
 * hat, soll Zweck, Verfahren, Sitzzahl und Nummer noch anpassen können, bevor
 * die Versammlung darüber abstimmt. Sobald Stimmzettel gedruckt sind oder die
 * Stimmabgabe begonnen hat, ist das Verfahren gesperrt — ein Wechsel würde
 * ausgegebene Zettel entwerten.
 */
import { useEffect, useState } from 'react'
import {
  PROCEDURE_LABELS,
  PROCEDURES,
  PURPOSE_LABELS,
  PURPOSES,
  type ElectionProcedure,
  type ElectionPurpose
} from '@shared/types'
import { profileFor, validateRoundSetup } from '@shared/election'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card, Field, NumberInput } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

export function SetupTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const round = detail.round

  const [title, setTitle] = useState(round.title)
  const [purpose, setPurpose] = useState<ElectionPurpose>(round.purpose)
  const [procedure, setProcedure] = useState<ElectionProcedure>(round.procedure)
  const [seats, setSeats] = useState(round.seats)
  const [maxVotes, setMaxVotes] = useState<number | null>(round.maxVotes)
  const [roundLabel, setRoundLabel] = useState(round.roundLabel)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTitle(round.title)
    setPurpose(round.purpose)
    setProcedure(round.procedure)
    setSeats(round.seats)
    setMaxVotes(round.maxVotes)
    setRoundLabel(round.roundLabel)
  }, [round])

  const profile = profileFor(procedure)
  const gedruckt = detail.accounting.printed
  const inVorbereitung = round.status === 'draft' || round.status === 'candidate_collection'
  const verfahrenOffen = inVorbereitung && gedruckt === 0
  const wechseltVerfahren = procedure !== round.procedure

  /* Die Nummer entsteht sonst beim Start; vorher lässt sie sich frei vergeben. */
  const nummerOffen = round.sequentialNumber === 0

  const issues = validateRoundSetup(
    { procedure, seats, maxVotes, title, template: round.template, positions: round.positions },
    detail.candidates
  )
  const fehler = issues.filter((issue) => issue.level === 'error')

  const speichern = async (): Promise<void> => {
    setBusy(true)
    try {
      await api('round.update', {
        id: round.id,
        rowVersion: round.rowVersion,
        title,
        purpose,
        procedure,
        seats,
        maxVotes,
        roundLabel: nummerOffen ? roundLabel : undefined
      })
      app.notify(
        'ok',
        wechseltVerfahren
          ? 'Gespeichert. Das Verfahren wurde gewechselt — bitte den Stimmzettel prüfen.'
          : 'Gespeichert.'
      )
      await reload()
      await app.refreshRounds()
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid cols-2">
      <div>
        <Card title="Grunddaten">
          {!inVorbereitung && (
            <div className="notice warn">
              Dieser Wahlgang läuft bereits (Status „{round.status}"). Zweck und Verfahren stehen
              damit fest; die Bezeichnung lässt sich noch anpassen.
            </div>
          )}
          {inVorbereitung && gedruckt > 0 && (
            <div className="notice warn">
              Es wurden bereits {gedruckt} Stimmzettel gedruckt. Ein Wechsel des Verfahrens würde sie
              unbrauchbar machen und ist deshalb gesperrt.
            </div>
          )}

          <Field label="Bezeichnung" hint="Erscheint auf dem Stimmzettel und auf dem Beamer.">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field
            label="Wahlzweck"
            hint="Was gewählt wird — das Verfahren folgt daraus nicht automatisch."
          >
            <select
              value={purpose}
              disabled={!verfahrenOffen}
              onChange={(e) => setPurpose(e.target.value as ElectionPurpose)}
            >
              {PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {PURPOSE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Wahlverfahren"
            hint="Wie gewählt wird — das beschließt die Versammlung nach ihrer Wahlordnung."
          >
            <select
              value={procedure}
              disabled={!verfahrenOffen}
              onChange={(e) => setProcedure(e.target.value as ElectionProcedure)}
            >
              {PROCEDURES.map((value) => (
                <option key={value} value={value}>
                  {PROCEDURE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <div className="row">
            <div style={{ flex: 1 }}>
              <Field label="Zu besetzende Positionen">
                <NumberInput
                  value={seats}
                  disabled={!verfahrenOffen || !profile.multiSeat}
                  onChange={setSeats}
                />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Stimmen je Stimmzettel" hint="Leer = ohne feste Höchstzahl">
                <input
                  type="number"
                  min={0}
                  value={maxVotes ?? ''}
                  disabled={!verfahrenOffen}
                  onChange={(e) => setMaxVotes(e.target.value === '' ? null : Number(e.target.value))}
                />
              </Field>
            </div>
          </div>

          <Field
            label="Nummer des Wahlgangs"
            hint={
              nummerOffen
                ? 'Vorab vergeben (z. B. 04). Ohne Angabe wird sie beim Start fortlaufend vergeben.'
                : 'Der Wahlgang ist gestartet — die Nummer steht fest.'
            }
          >
            <input
              value={roundLabel}
              disabled={!nummerOffen}
              placeholder="wird beim Start vergeben"
              onChange={(e) => setRoundLabel(e.target.value)}
            />
          </Field>

          <button
            className="primary big"
            disabled={busy || fehler.length > 0 || !app.can('round.manage')}
            onClick={() => void speichern()}
          >
            {busy ? 'Wird gespeichert …' : 'Änderungen übernehmen'}
          </button>
        </Card>
      </div>

      <div>
        <Card title="Auswirkung">
          {wechseltVerfahren ? (
            <div className="notice warn">
              <strong>
                Wechsel von „{PROCEDURE_LABELS[round.procedure]}" zu „{PROCEDURE_LABELS[procedure]}"
              </strong>
              <br />
              Der Stimmzettel wird neu aufgebaut: Höchststimmenzahl und die aufgedruckten Optionen
              richten sich ab dann nach dem neuen Verfahren. Eine bereits freigegebene Fassung
              verliert ihre Freigabe und muss erneut geprüft werden.
              {detail.candidates.length > 0 && profile.entryKind === 'none' && (
                <>
                  <br />
                  <br />
                  Achtung: Es sind {detail.candidates.length} Bewerber erfasst, das neue Verfahren
                  kennt aber keine. Sie bleiben gespeichert, erscheinen aber nicht mehr auf dem
                  Zettel.
                </>
              )}
            </div>
          ) : (
            <p className="hint">
              Hier ändern Sie, was beim Anlegen festgelegt wurde. Solange nichts gedruckt ist, darf
              auch das Verfahren noch wechseln — danach nicht mehr.
            </p>
          )}

          {issues.length > 0 && (
            <>
              <h3>Prüfung</h3>
              {issues.map((issue) => (
                <div
                  key={issue.field + issue.message}
                  className={`notice ${issue.level === 'error' ? 'error' : 'warn'}`}
                >
                  {issue.message}
                </div>
              ))}
            </>
          )}

          <table style={{ marginTop: 16 }}>
            <tbody>
              <tr>
                <th>Status</th>
                <td>{round.status}</td>
              </tr>
              <tr>
                <th>Kennung</th>
                <td>{round.roundCode || '– wird beim Start vergeben –'}</td>
              </tr>
              <tr>
                <th>Zettelfassung</th>
                <td>
                  v{round.ballotVersion}
                  {round.approvedVersion === round.ballotVersion ? ' (freigegeben)' : ' (nicht freigegeben)'}
                </td>
              </tr>
              <tr>
                <th>Gedruckt</th>
                <td>{gedruckt}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}

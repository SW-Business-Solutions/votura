/**
 * Sachabstimmung: Antragstext und Abstimmungsoptionen.
 *
 * Personenwahlen brauchen eine Kandidatenliste, Sachabstimmungen einen
 * Beschlusstext. Diese Ansicht tritt bei Antragsverfahren an die Stelle der
 * Kandidatenerfassung — der Text bleibt bis zur Freigabe jederzeit änderbar.
 */
import { useEffect, useState } from 'react'
import { candidatesEditable, isImmutable, parseCandidateBlock, profileFor } from '@shared/election'
import { PROCEDURE_LABELS } from '@shared/types'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card, Checkbox, ConfirmDialog, EmptyState, Field } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

export function MotionTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const profile = profileFor(round.procedure)
  const editable = candidatesEditable(round.status) && !round.candidatesLockedAt

  const [title, setTitle] = useState(round.title)
  const [motionText, setMotionText] = useState(round.template.motionText ?? '')
  const [instruction, setInstruction] = useState(round.template.instructionText)
  const [allowYes, setAllowYes] = useState(round.template.allowYes)
  const [allowNo, setAllowNo] = useState(round.template.allowNo)
  const [allowAbstention, setAllowAbstention] = useState(round.template.allowAbstention)
  const [optionsText, setOptionsText] = useState('')
  const [confirmLock, setConfirmLock] = useState(false)
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTitle(round.title)
    setMotionText(round.template.motionText ?? '')
    setInstruction(round.template.instructionText)
    setAllowYes(round.template.allowYes)
    setAllowNo(round.template.allowNo)
    setAllowAbstention(round.template.allowAbstention)
  }, [round.rowVersion])

  const options = detail.candidates.filter((candidate) => !candidate.withdrawn)

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api('round.update', {
        id: round.id,
        title,
        template: {
          ...round.template,
          motionText: motionText.trim() || undefined,
          instructionText: instruction,
          allowYes,
          allowNo,
          allowAbstention
        },
        rowVersion: round.rowVersion
      })
      app.notify('ok', 'Antrag gespeichert.')
      await reload()
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  const addOptions = async (): Promise<void> => {
    const parsed = parseCandidateBlock(optionsText)
    if (parsed.length === 0) return
    try {
      await api('candidate.add', {
        roundId: round.id,
        candidates: parsed.map((entry) => ({
          firstName: '',
          lastName: entry.displayName,
          displayName: entry.displayName
        }))
      })
      setOptionsText('')
      await reload()
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      {!editable && !isImmutable(round.status) && (
        <div className="notice warn">
          Der Antrag ist festgeschrieben. Änderungen sind erst nach ausdrücklichem Entsperren möglich — dabei
          entsteht eine neue Stimmzettelversion.
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={!app.can('round.unlock')} onClick={() => setConfirmUnlock(true)}>
              Wahlgang entsperren
            </button>
          </div>
        </div>
      )}

      {confirmUnlock && (
        <ConfirmDialog
          title="Wahlgang entsperren"
          message={
            <>
              <p>Das Entsperren wird mit Begründung im Audit-Trail festgehalten.</p>
              {round.approvedVersion === round.ballotVersion && (
                <div className="notice warn">
                  Eine Änderung erzeugt Version {round.ballotVersion + 1}. Bereits gedruckte Stimmzettel der
                  Version {round.ballotVersion} dürfen nicht mit der neuen Version vermischt werden.
                </div>
              )}
            </>
          }
          confirmLabel="Entsperren"
          danger
          requireReason
          onCancel={() => setConfirmUnlock(false)}
          onConfirm={async (reason) => {
            try {
              await api('round.unlock', { roundId: round.id, reason })
              app.notify('warning', 'Wahlgang entsperrt. Bitte anschließend neu freigeben.')
              setConfirmUnlock(false)
              await reload()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}

      <div className="grid cols-2">
        <Card title="Antrag">
          <Field label="Bezeichnung der Abstimmung">
            <input value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field
            label="Antrags- bzw. Beschlusstext"
            hint="Erscheint auf dem Stimmzettel und auf dem Beamer. Bei langen Anträgen empfiehlt sich eine knappe, eindeutige Zusammenfassung."
          >
            <textarea
              value={motionText}
              disabled={!editable}
              onChange={(e) => setMotionText(e.target.value)}
              style={{ minHeight: 160 }}
              placeholder={'z. B. Änderung des § 12 der Kreissatzung'}
            />
          </Field>
          <Field label="Abstimmungsanweisung">
            <input value={instruction} disabled={!editable} onChange={(e) => setInstruction(e.target.value)} />
          </Field>

          <h3>Abstimmungsmöglichkeiten</h3>
          <div className="hint" style={{ marginBottom: 8 }}>
            Die Enthaltung wird nicht erzwungen — maßgeblich ist die geltende Geschäfts- bzw. Abstimmungsordnung.
          </div>
          <Checkbox checked={allowYes} disabled={!editable} onChange={setAllowYes} label="JA" />
          <Checkbox checked={allowNo} disabled={!editable} onChange={setAllowNo} label="NEIN" />
          <Checkbox
            checked={allowAbstention}
            disabled={!editable}
            onChange={setAllowAbstention}
            label="ENTHALTUNG"
          />

          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary big" disabled={!editable || busy} onClick={() => void save()}>
              Antrag speichern
            </button>
          </div>
        </Card>

        <div>
          {profile.entryKind === 'options' && (
            <Card title={`Auswahloptionen (${options.length})`}>
              <p className="hint">
                Dieses Verfahren stellt mehrere Optionen zur Wahl (z. B. konkurrierende Fassungen). Eine Option je
                Zeile.
              </p>
              {options.length === 0 ? (
                <EmptyState text="Noch keine Optionen erfasst." />
              ) : (
                <ul className="list-reset">
                  {options.map((option, index) => (
                    <li key={option.id} className="drag-item">
                      <span style={{ minWidth: 24, color: 'var(--text-muted)' }}>{index + 1}</span>
                      <span style={{ flex: 1 }}>{option.displayName}</span>
                    </li>
                  ))}
                </ul>
              )}
              {editable && (
                <>
                  <Field label="Optionen hinzufügen">
                    <textarea
                      value={optionsText}
                      onChange={(e) => setOptionsText(e.target.value)}
                      placeholder={'Fassung A\nFassung B\nFassung C'}
                    />
                  </Field>
                  <button className="primary" disabled={!optionsText.trim()} onClick={() => void addOptions()}>
                    Hinzufügen
                  </button>
                </>
              )}
            </Card>
          )}

          <Card title="Verfahren">
            <table>
              <tbody>
                <tr>
                  <th>Abstimmungsart</th>
                  <td>{PROCEDURE_LABELS[round.procedure]}</td>
                </tr>
                <tr>
                  <th>Stimmzettel</th>
                  <td>{profile.ballotRequired ? 'geheime Abstimmung mit Stimmzettel' : 'offene Abstimmung'}</td>
                </tr>
                <tr>
                  <th>Kennung</th>
                  <td className="mono">{round.roundCode || 'wird beim Start vergeben'}</td>
                </tr>
              </tbody>
            </table>

            {profile.ballotRequired && (
              <div className="row" style={{ marginTop: 12 }}>
                {editable ? (
                  <button className="primary big" disabled={!title.trim()} onClick={() => setConfirmLock(true)}>
                    Antrag festschreiben
                  </button>
                ) : (
                  <span className="hint">
                    Weiter im Reiter „Wahlzettel“: dort prüfen Sie die Druckvorschau und geben den Stimmzettel
                    frei.
                  </span>
                )}
              </div>
            )}
            {!profile.ballotRequired && (
              <div className="notice" style={{ marginTop: 12 }}>
                Für eine offene Abstimmung wird kein Stimmzettel gedruckt. Erfassen Sie das Ergebnis direkt im
                Reiter „Ergebnis“.
              </div>
            )}
          </Card>
        </div>
      </div>

      {confirmLock && (
        <ConfirmDialog
          title="Antrag festschreiben"
          message={
            <>
              <p>
                Der Antragstext wird festgeschrieben. Danach sind Änderungen nur noch nach ausdrücklichem
                Entsperren möglich.
              </p>
              <p>
                <strong>{title}</strong>
                {motionText && (
                  <>
                    <br />
                    {motionText}
                  </>
                )}
              </p>
            </>
          }
          confirmLabel="Festschreiben"
          onCancel={() => setConfirmLock(false)}
          onConfirm={async () => {
            try {
              await api('round.lockCandidates', round.id)
              setConfirmLock(false)
              app.notify('ok', 'Antrag festgeschrieben. Bitte den Stimmzettel prüfen und freigeben.')
              await reload()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}
    </>
  )
}

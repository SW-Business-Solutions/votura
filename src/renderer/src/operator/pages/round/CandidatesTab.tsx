/** Kandidaten erfassen, ordnen und die Liste schließen (§8, §9, §15, §41). */
import { useMemo, useState } from 'react'
import {
  candidatesEditable,
  isImmutable,
  parseCandidateBlock,
  profileFor,
  validateRoundSetup
} from '@shared/election'
import {
  CANDIDATE_ORDER_LABELS,
  CANDIDATE_ORDER_MODES,
  type Candidate,
  type CandidateOrderMode
} from '@shared/types'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card, ConfirmDialog, EmptyState, Field, Modal, NumberInput } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

export function CandidatesTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const profile = profileFor(round.procedure)
  const editable = candidatesEditable(round.status) && !round.candidatesLockedAt

  const [bulkText, setBulkText] = useState('')
  const [search, setSearch] = useState('')
  const [editCandidate, setEditCandidate] = useState<Candidate | null>(null)
  const [withdrawCandidate, setWithdrawCandidate] = useState<Candidate | null>(null)
  const [confirmLock, setConfirmLock] = useState(false)
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const active = detail.candidates.filter((candidate) => !candidate.withdrawn)
  const issues = useMemo(() => validateRoundSetup(round, detail.candidates), [round, detail.candidates])

  const visible = detail.candidates.filter((candidate) =>
    candidate.displayName.toLocaleLowerCase('de-DE').includes(search.toLocaleLowerCase('de-DE'))
  )

  const addBulk = async (): Promise<void> => {
    const parsed = parseCandidateBlock(bulkText)
    if (parsed.length === 0) return
    try {
      await api('candidate.add', {
        roundId: round.id,
        candidates: parsed.map((candidate) => ({
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          displayName: candidate.displayName
        }))
      })
      setBulkText('')
      app.notify('ok', `${parsed.length} Eintrag/Einträge hinzugefügt.`)
      await reload()
    } catch (error) {
      app.reportError(error)
    }
  }

  const applyOrder = async (mode: CandidateOrderMode): Promise<void> => {
    try {
      await api('candidate.applyOrderMode', { roundId: round.id, mode })
      app.notify('ok', `Reihenfolge gesetzt: ${CANDIDATE_ORDER_LABELS[mode]}`)
      await reload()
    } catch (error) {
      app.reportError(error)
    }
  }

  const move = async (from: number, to: number): Promise<void> => {
    const ordered = [...detail.candidates]
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    try {
      await api('candidate.reorder', { roundId: round.id, orderedIds: ordered.map((c) => c.id) })
      await reload()
    } catch (error) {
      app.reportError(error)
    }
  }

  const assignNumbers = async (): Promise<void> => {
    try {
      for (const [index, candidate] of active.entries()) {
        await api('candidate.update', { id: candidate.id, ballotNumber: index + 1 })
      }
      app.notify('ok', 'Kandidatennummern vergeben.')
      await reload()
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      {!editable && !isImmutable(round.status) && (
        <div className="notice warn">
          Die Kandidatenliste ist geschlossen. Änderungen sind nur nach ausdrücklichem Entsperren möglich —
          dabei entsteht eine neue Wahlzettelversion, und bereits gedruckte Zettel dürfen nicht mit der neuen
          Version vermischt werden.
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={!app.can('round.unlock')} onClick={() => setConfirmUnlock(true)}>
              Wahlgang entsperren
            </button>
          </div>
        </div>
      )}

      <div className="grid cols-2">
        <Card
          title={`${profile.entryKind === 'options' ? 'Wahloptionen' : 'Kandidaten'} (${active.length})`}
          actions={
            <input
              placeholder="Suchen …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
          }
        >
          {visible.length === 0 ? (
            <EmptyState text="Noch keine Einträge erfasst." />
          ) : (
            <ul className="list-reset">
              {visible.map((candidate, index) => (
                <li
                  key={candidate.id}
                  className={`drag-item${dragIndex === index ? ' dragging' : ''}`}
                  draggable={editable && !search}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(dragEvent) => dragEvent.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== index) void move(dragIndex, index)
                    setDragIndex(null)
                  }}
                >
                  {editable && !search && <span className="grip">⋮⋮</span>}
                  <span style={{ minWidth: 28, color: 'var(--text-muted)' }}>
                    {candidate.ballotNumber !== undefined ? String(candidate.ballotNumber).padStart(2, '0') : index + 1}
                  </span>
                  <span style={{ flex: 1, textDecoration: candidate.withdrawn ? 'line-through' : undefined }}>
                    {candidate.displayName}
                    {candidate.withdrawn && <span className="badge danger" style={{ marginLeft: 8 }}>zurückgezogen</span>}
                    {candidate.positionId && (
                      <span className="hint">
                        {round.positions.find((position) => position.id === candidate.positionId)?.title ?? ''}
                      </span>
                    )}
                  </span>
                  {editable && (
                    <>
                      <button className="ghost" onClick={() => setEditCandidate(candidate)}>
                        Bearbeiten
                      </button>
                      {!candidate.withdrawn && (
                        <button className="ghost" onClick={() => setWithdrawCandidate(candidate)}>
                          Zurückziehen
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {editable && (
            <Card title="Schnellerfassung">
              <Field
                label="Ein Eintrag je Zeile"
                hint={'Unterstützt "Max Mustermann" und "Mustermann, Max"; Einfügen aus der Zwischenablage möglich.'}
              >
                <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              </Field>
              <button className="primary" disabled={!bulkText.trim()} onClick={() => void addBulk()}>
                Hinzufügen
              </button>
            </Card>
          )}

          <Card title="Reihenfolge">
            <p className="hint">
              Die gewählte Reihenfolge wird im Audit-Trail festgehalten. Zufall wird nie automatisch verwendet.
            </p>
            <div className="row">
              {CANDIDATE_ORDER_MODES.map((mode) => (
                <button
                  key={mode}
                  className={round.orderMode === mode ? 'primary' : ''}
                  disabled={!editable}
                  onClick={() => void applyOrder(mode)}
                >
                  {CANDIDATE_ORDER_LABELS[mode]}
                </button>
              ))}
            </div>
            {round.orderSeed !== undefined && (
              <div className="hint">Zufalls-Startwert: {round.orderSeed} (reproduzierbar dokumentiert)</div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button disabled={!editable} onClick={() => void assignNumbers()}>
                Kandidatennummern 01…n vergeben
              </button>
            </div>
          </Card>

          <Card title="Prüfung">
            {issues.length === 0 ? (
              <div className="notice ok">Die Angaben sind in sich schlüssig.</div>
            ) : (
              issues.map((issue, index) => (
                <div key={index} className={`notice ${issue.level === 'error' ? 'error' : 'warn'}`}>
                  {issue.message}
                </div>
              ))
            )}
            <div className="row">
              {editable ? (
                <button
                  className="primary big"
                  disabled={issues.some((issue) => issue.level === 'error')}
                  onClick={() => setConfirmLock(true)}
                >
                  Kandidatenliste schließen
                </button>
              ) : (
                <button className="big" disabled={!app.can('round.unlock')} onClick={() => setConfirmUnlock(true)}>
                  Wahlgang entsperren
                </button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {confirmLock && (
        <ConfirmDialog
          title="Kandidatenliste schließen"
          message={
            <>
              <p>
                Danach sind keine Änderungen mehr möglich, ohne den Wahlgang ausdrücklich zu entsperren.
                Anschließend können Sie die Druckvorschau prüfen und den Stimmzettel freigeben.
              </p>
              <p>
                <strong>{active.length}</strong> Einträge &middot; <strong>{round.seats}</strong> Positionen &middot;{' '}
                {round.maxVotes === null ? 'keine feste Stimmenhöchstzahl' : `maximal ${round.maxVotes} Stimmen`}
              </p>
            </>
          }
          confirmLabel="Liste schließen"
          onCancel={() => setConfirmLock(false)}
          onConfirm={async () => {
            try {
              await api('round.lockCandidates', round.id)
              app.notify('ok', 'Kandidatenliste geschlossen.')
              setConfirmLock(false)
              await reload()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}

      {confirmUnlock && (
        <ConfirmDialog
          title="Wahlgang entsperren"
          message={
            <>
              <p>
                Dieser Wahlgang {round.approvedVersion === round.ballotVersion ? 'wurde bereits freigegeben' : 'ist gesperrt'}.
                Das Entsperren wird protokolliert.
              </p>
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

      {editCandidate && (
        <EditCandidateDialog
          candidate={editCandidate}
          positions={round.positions}
          onClose={() => setEditCandidate(null)}
          onSaved={async () => {
            setEditCandidate(null)
            await reload()
          }}
        />
      )}

      {withdrawCandidate && (
        <ConfirmDialog
          title="Kandidat zurückziehen"
          message={
            <p>
              <strong>{withdrawCandidate.displayName}</strong> wird als zurückgezogen markiert. Der Eintrag bleibt
              zur Nachvollziehbarkeit erhalten und erscheint nicht mehr auf dem Stimmzettel.
            </p>
          }
          confirmLabel="Zurückziehen"
          danger
          requireReason
          onCancel={() => setWithdrawCandidate(null)}
          onConfirm={async (reason) => {
            try {
              await api('candidate.withdraw', { id: withdrawCandidate.id, reason })
              setWithdrawCandidate(null)
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

function EditCandidateDialog({
  candidate,
  positions,
  onClose,
  onSaved
}: {
  candidate: Candidate
  positions: { id: string; title: string }[]
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const app = useApp()
  const [displayName, setDisplayName] = useState(candidate.displayName)
  const [firstName, setFirstName] = useState(candidate.firstName)
  const [lastName, setLastName] = useState(candidate.lastName)
  const [ballotNumber, setBallotNumber] = useState(candidate.ballotNumber ?? 0)
  const [positionId, setPositionId] = useState(candidate.positionId ?? '')
  const [note, setNote] = useState(candidate.note ?? '')

  return (
    <Modal
      title="Eintrag bearbeiten"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                await api('candidate.update', {
                  id: candidate.id,
                  displayName,
                  firstName,
                  lastName,
                  ballotNumber: ballotNumber || undefined,
                  positionId: positionId || undefined,
                  note
                })
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
      <Field label="Anzeigename auf dem Stimmzettel">
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <div style={{ flex: 1 }}>
          <Field label="Vorname">
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Nachname">
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <div style={{ width: 130 }}>
          <Field label="Nummer">
            <NumberInput value={ballotNumber} onChange={setBallotNumber} />
          </Field>
        </div>
      </div>
      {positions.length > 0 && (
        <Field label="Position (verbundene Einzelwahl)">
          <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">– keine –</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Interne Notiz" hint="Erscheint niemals auf dem Stimmzettel oder dem Beamer.">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

/** Veranstaltungen anlegen, aktivieren, abschließen, archivieren (§6, §64). */
import { useEffect, useState } from 'react'
import { DEFAULT_RULE_SET } from '@shared/config'
import { formatDateDe, todayIsoDate } from '@shared/format'
import { EVENT_STATUS_LABELS, type ElectionEvent } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, ConfirmDialog, Field, Modal, NumberInput } from '../components/ui'

interface FormState {
  title: string
  organization: string
  orgCode: string
  date: string
  location: string
  eligibleVoterCount: number
  ruleName: string
  ruleVersion: string
  ruleSource: string
}

function emptyForm(): FormState {
  return {
    title: 'Mitgliederversammlung',
    organization: '',
    orgCode: '',
    date: todayIsoDate(),
    location: '',
    eligibleVoterCount: 0,
    ruleName: DEFAULT_RULE_SET.name,
    ruleVersion: DEFAULT_RULE_SET.version,
    ruleSource: DEFAULT_RULE_SET.source
  }
}

export function EventPage(): React.JSX.Element {
  const app = useApp()
  const [events, setEvents] = useState<ElectionEvent[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<ElectionEvent | null>(null)
  const [confirmClose, setConfirmClose] = useState<ElectionEvent | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<ElectionEvent | null>(null)
  const [showArchive, setShowArchive] = useState<ElectionEvent | null>(null)

  const load = async (): Promise<void> => {
    try {
      setEvents(await api('event.list'))
    } catch (error) {
      app.reportError(error)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const startEdit = (event: ElectionEvent): void => {
    setEditing(event)
    setForm({
      title: event.title,
      organization: event.organization,
      orgCode: event.orgCode,
      date: event.date,
      location: event.location,
      eligibleVoterCount: event.eligibleVoterCount ?? 0,
      ruleName: event.ruleSet.name,
      ruleVersion: event.ruleSet.version,
      ruleSource: event.ruleSet.source ?? ''
    })
  }

  const save = async (): Promise<void> => {
    const payload = {
      title: form.title,
      organization: form.organization,
      orgCode: form.orgCode,
      date: form.date,
      location: form.location,
      eligibleVoterCount: form.eligibleVoterCount || undefined,
      ruleSet: {
        name: form.ruleName,
        version: form.ruleVersion,
        source: form.ruleSource || undefined,
        snapshotDate: todayIsoDate()
      }
    }
    try {
      if (editing) {
        await api('event.update', { ...payload, id: editing.id, rowVersion: editing.rowVersion })
        app.notify('ok', 'Veranstaltung aktualisiert.')
      } else {
        const created = await api('event.create', payload)
        await api('event.activate', created.id)
        app.notify('ok', 'Veranstaltung angelegt und aktiviert.')
      }
      setEditing(null)
      setForm(emptyForm())
      await load()
      await app.refreshAll()
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Veranstaltung</h1>
          <div className="subtitle">
            Grunddaten, geltende Wahlordnung und Zahl der Stimmberechtigten. Es kann immer nur eine
            Veranstaltung aktiv sein.
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <Card title={editing ? `Bearbeiten: ${editing.title}` : 'Neue Veranstaltung'}>
          <Field label="Titel">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Organisation / Gliederung">
            <input
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
              placeholder="z. B. Musterverband Beispielstadt"
            />
          </Field>
          <Field
            label="Kurzcode für die Wahlgangkennung"
            hint="Bestandteil jeder Wahlgangkennung, z. B. MV26 oder KV-NORD. 2–12 Buchstaben/Ziffern."
          >
            <input
              value={form.orgCode}
              onChange={(e) => setForm({ ...form, orgCode: e.target.value.toUpperCase() })}
              placeholder="MV26"
            />
          </Field>
          <div className="row">
            <div style={{ flex: 1 }}>
              <Field label="Datum">
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Stimmberechtigte" hint="Kann jederzeit angepasst werden.">
                <NumberInput
                  value={form.eligibleVoterCount}
                  onChange={(value) => setForm({ ...form, eligibleVoterCount: value })}
                />
              </Field>
            </div>
          </div>
          <Field label="Ort">
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>

          <h3>Geltende Wahlordnung</h3>
          <div className="hint" style={{ marginBottom: 8 }}>
            Wird mit der Veranstaltung gespeichert, damit später nachvollziehbar ist, auf welcher
            Regelbasis die Konfiguration beruhte. Bitte prüfen, ob eine eigene Wahlordnung der
            Gliederung Vorrang hat.
          </div>
          <Field label="Bezeichnung">
            <input value={form.ruleName} onChange={(e) => setForm({ ...form, ruleName: e.target.value })} />
          </Field>
          <div className="row">
            <div style={{ flex: 1 }}>
              <Field label="Fassung">
                <input
                  value={form.ruleVersion}
                  onChange={(e) => setForm({ ...form, ruleVersion: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ flex: 2 }}>
              <Field label="Quelle (optional)">
                <input
                  value={form.ruleSource}
                  onChange={(e) => setForm({ ...form, ruleSource: e.target.value })}
                />
              </Field>
            </div>
          </div>

          <div className="row">
            <button className="primary big" onClick={() => void save()}>
              {editing ? 'Änderungen speichern' : 'Anlegen und aktivieren'}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setEditing(null)
                  setForm(emptyForm())
                }}
              >
                Abbrechen
              </button>
            )}
          </div>
        </Card>

        <Card title="Vorhandene Veranstaltungen">
          <table>
            <thead>
              <tr>
                <th>Titel</th>
                <th>Datum</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.title}</strong>
                    <br />
                    <span className="hint">
                      {event.organization} &middot; {event.orgCode}
                    </span>
                  </td>
                  <td>{formatDateDe(event.date)}</td>
                  <td>
                    <span className={`badge ${event.status === 'active' ? 'ok' : ''}`}>
                      {EVENT_STATUS_LABELS[event.status]}
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      {event.status !== 'archived' && <button onClick={() => startEdit(event)}>Bearbeiten</button>}
                      {event.status === 'draft' && (
                        <button
                          onClick={async () => {
                            await app.setActiveEvent(event.id)
                            await load()
                          }}
                        >
                          Aktivieren
                        </button>
                      )}
                      {event.status === 'active' && (
                        <button onClick={() => setConfirmClose(event)}>Abschließen</button>
                      )}
                      {event.status === 'closed' && (
                        <button className="primary" onClick={() => setConfirmArchive(event)}>
                          Archivieren
                        </button>
                      )}
                      {event.status === 'archived' && (
                        <button onClick={() => setShowArchive(event)}>Archivdateien</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {confirmClose && (
        <ConfirmDialog
          title="Veranstaltung abschließen"
          message={
            <p>
              Die Veranstaltung <strong>{confirmClose.title}</strong> kann nur abgeschlossen werden, wenn alle
              Wahlgänge abgeschlossen oder abgebrochen sind. Danach sind keine neuen Wahlgänge mehr möglich.
            </p>
          }
          confirmLabel="Abschließen"
          onCancel={() => setConfirmClose(null)}
          onConfirm={async () => {
            try {
              await api('event.close', confirmClose.id)
              app.notify('ok', 'Veranstaltung abgeschlossen.')
              setConfirmClose(null)
              await load()
              await app.refreshAll()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}

      {showArchive && <ArchiveFilesDialog event={showArchive} onClose={() => setShowArchive(null)} />}

      {confirmArchive && (
        <ConfirmDialog
          title="Archivpaket erzeugen"
          message={
            <p>
              Es wird ein vollständiges Archiv mit Veranstaltungsdaten, allen Wahlgängen, Stimmzettel-PDFs,
              Ergebnissen und dem Audit-Trail erzeugt (inklusive ZIP-Paket).
            </p>
          }
          confirmLabel="Archiv erzeugen"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={async () => {
            try {
              const result = await api('event.archive', confirmArchive.id)
              app.notify('ok', `Archiv erstellt: ${result.path}`)
              setConfirmArchive(null)
              await load()
              await app.refreshAll()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}
    </>
  )
}

/**
 * Archivdateien einsehen, im Explorer öffnen und an einen beliebigen Ort
 * kopieren (z. B. USB-Stick für die Aufbewahrung).
 */
function ArchiveFilesDialog({
  event,
  onClose
}: {
  event: ElectionEvent
  onClose: () => void
}): React.JSX.Element {
  const app = useApp()
  const [files, setFiles] = useState<{ name: string; path: string; sizeBytes: number }[]>([])
  const [directory, setDirectory] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        // Das Archiv wird beim Archivieren erzeugt; erneutes Aufrufen liefert den Pfad.
        const result = await api('export.event', event.id)
        setDirectory(result.path)
        setFiles(await api('system.listFiles', result.path))
      } catch (error) {
        app.reportError(error)
      }
    })()
  }, [event.id])

  return (
    <Modal
      title={`Archivdateien – ${event.title}`}
      onClose={onClose}
      wide
      actions={
        <>
          <button onClick={() => void api('system.revealPath', directory).catch(app.reportError)}>
            Ordner öffnen
          </button>
          <button onClick={onClose}>Schließen</button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 10 }}>
        Speicherort: <span className="mono">{directory || '…'}</span>
      </div>
      {files.length === 0 ? (
        <p>Archiv wird erzeugt …</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Datei</th>
              <th className="num">Größe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path}>
                <td>{file.name}</td>
                <td className="num">{(file.sizeBytes / 1024).toFixed(0)} kB</td>
                <td>
                  <div className="row">
                    <button
                      onClick={async () => {
                        try {
                          const target = await api('system.saveCopy', {
                            source: file.path,
                            suggestedName: file.name
                          })
                          if (target) app.notify('ok', `Gespeichert: ${target}`)
                        } catch (error) {
                          app.reportError(error)
                        }
                      }}
                    >
                      Speichern unter …
                    </button>
                    <button
                      className="ghost"
                      onClick={() => void api('system.revealPath', file.path).catch(app.reportError)}
                    >
                      Im Ordner zeigen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="notice" style={{ marginTop: 12 }}>
        Das ZIP-Paket enthält Veranstaltungsdaten, alle Wahlgänge, Stimmzettel-PDFs, Ergebnisse und den
        Audit-Trail. Die ausgefüllten Papier-Stimmzettel werden nicht digitalisiert.
      </div>
    </Modal>
  )
}

/** Startseite (§37): aktuelle Veranstaltung, aktueller Wahlgang, Verlauf. */
import { PROCEDURE_LABELS } from '@shared/types'
import { formatDateDe } from '@shared/format'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState, Kpi, StatusBadge } from '../components/ui'

export function DashboardPage(): React.JSX.Element {
  const app = useApp()
  const event = app.event

  if (!event) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Übersicht</h1>
            <div className="subtitle">Es ist keine Veranstaltung aktiv.</div>
          </div>
        </div>
        <Card>
          <EmptyState
            text="Legen Sie zuerst eine Veranstaltung an und aktivieren Sie sie."
            action={
              <button className="primary big" onClick={() => navigate('event')}>
                Zur Veranstaltung
              </button>
            }
          />
        </Card>
      </>
    )
  }

  const openRounds = app.rounds.filter((round) => round.status !== 'completed' && round.status !== 'cancelled')
  const current = openRounds[openRounds.length - 1]
  const completed = app.rounds.filter((round) => round.status === 'completed')

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{event.title}</h1>
          <div className="subtitle">
            {event.organization} &middot; {formatDateDe(event.date)} &middot; {event.location}
          </div>
        </div>
        <div className="row">
          <button className="primary big" onClick={() => navigate('round/new')}>
            + Neuer Wahlgang
          </button>
        </div>
      </div>

      <div className="grid cols-3">
        <Card tight>
          <Kpi label="Stimmberechtigte" value={event.eligibleVoterCount ?? '–'} />
        </Card>
        <Card tight>
          <Kpi label="Wahlgänge gesamt" value={app.rounds.length} />
        </Card>
        <Card tight>
          <Kpi label="Abgeschlossen" value={completed.length} tone="ok" />
        </Card>
      </div>

      {current ? (
        <Card
          title={`Aktueller Wahlgang ${current.roundLabel} – ${current.title}`}
          actions={<StatusBadge status={current.status} />}
        >
          <div className="grid cols-3" style={{ marginBottom: 14 }}>
            <Kpi label="Kandidaten / Optionen" value={current.candidateCount} />
            <Kpi label="Positionen" value={current.seats} />
            <Kpi
              label="Maximale Stimmen"
              value={current.maxVotes === null ? 'ohne Höchstzahl' : current.maxVotes}
            />
          </div>
          <div className="row">
            <span className="badge">{PROCEDURE_LABELS[current.procedure]}</span>
            {/* In Vorbereitung gibt es noch keine Kennung – dann bleibt der
                Hinweis weg, statt leer dazustehen. */}
            {current.roundCode && <span className="badge">Kennung {current.roundCode}</span>}
            <span className="badge">
              Zettelversion v{current.ballotVersion}
              {current.approvedVersion === current.ballotVersion ? ' (freigegeben)' : ' (nicht freigegeben)'}
            </span>
            {current.accounting.printed > 0 && (
              <span className="badge accent">{current.accounting.printed} gedruckt</span>
            )}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="big" onClick={() => navigate(`round/${current.id}/candidates`)}>
              Kandidaten
            </button>
            <button className="big" onClick={() => navigate(`round/${current.id}/ballot`)}>
              Wahlzettel
            </button>
            <button className="big primary" onClick={() => navigate(`round/${current.id}/print`)}>
              Drucken
            </button>
            <button className="big" onClick={() => navigate(`round/${current.id}/result`)}>
              Ergebnis
            </button>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            text="Kein offener Wahlgang."
            action={
              <button className="primary big" onClick={() => navigate('round/new')}>
                Wahlgang anlegen
              </button>
            }
          />
        </Card>
      )}

      <Card title="Alle Wahlgänge">
        {app.rounds.length === 0 ? (
          <EmptyState text="Noch keine Wahlgänge angelegt." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Bezeichnung</th>
                <th>Verfahren</th>
                <th className="num">Pos.</th>
                <th className="num">Kand.</th>
                <th>Zettel</th>
                <th className="num">Gedruckt</th>
                <th>Status</th>
                <th>Ergebnis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {app.rounds.map((round) => (
                <tr key={round.id}>
                  <td>{round.roundLabel}</td>
                  <td>{round.title}</td>
                  <td>{PROCEDURE_LABELS[round.procedure]}</td>
                  <td className="num">{round.seats}</td>
                  <td className="num">{round.candidateCount}</td>
                  <td>
                    <span
                      className={`badge ${
                        round.approvedVersion === round.ballotVersion ? 'ok' : 'warn'
                      }`}
                      title={
                        round.approvedVersion === round.ballotVersion
                          ? 'Diese Fassung ist freigegeben'
                          : 'Diese Fassung ist noch nicht freigegeben'
                      }
                    >
                      v{round.ballotVersion}
                    </span>
                  </td>
                  <td className="num">{round.accounting.printed}</td>
                  <td>
                    <StatusBadge status={round.status} />
                  </td>
                  <td>
                    {round.resultConfirmed ? (
                      <span className="badge ok">bestätigt</span>
                    ) : round.hasResult ? (
                      <span className="badge warn">erfasst</span>
                    ) : (
                      <span className="badge">offen</span>
                    )}
                  </td>
                  <td>
                    <button onClick={() => navigate(`round/${round.id}`)}>Öffnen</button>
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

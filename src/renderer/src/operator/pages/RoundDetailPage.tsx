/** Wahlgang-Detailseite mit allen Arbeitsschritten (§9, §17–§27, §42). */
import { useCallback, useEffect, useState } from 'react'
import type { RoundDetail } from '@shared/ipc'
import { PROCEDURE_LABELS, PURPOSE_LABELS, type ElectionRound } from '@shared/types'
import { isImmutable, profileFor } from '@shared/election'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, ConfirmDialog, StatusBadge } from '../components/ui'
import { CandidatesTab } from './round/CandidatesTab'
import { MotionTab } from './round/MotionTab'
import { BallotTab } from './round/BallotTab'
import { PrintTab } from './round/PrintTab'
import { AccountingTab } from './round/AccountingTab'
import { ResultTab } from './round/ResultTab'
import { HistoryTab } from './round/HistoryTab'

/**
 * Die Reiter richten sich nach dem Verfahren: eine Sachabstimmung braucht
 * keinen Kandidatenreiter, eine offene Abstimmung weder Stimmzettel noch Druck.
 */
function tabsFor(round: ElectionRound): { key: string; label: string }[] {
  const profile = profileFor(round.procedure)
  const isMotion = round.purpose === 'motion' || profile.entryKind === 'options' || round.procedure === 'yes_no_abstain'

  const tabs: { key: string; label: string }[] = [
    isMotion
      ? { key: 'candidates', label: 'Antrag' }
      : { key: 'candidates', label: profile.entryKind === 'options' ? 'Optionen' : 'Kandidaten' }
  ]

  if (profile.ballotRequired) {
    tabs.push(
      { key: 'ballot', label: 'Wahlzettel' },
      { key: 'print', label: 'Drucken' },
      { key: 'accounting', label: 'Stimmzettelbilanz' }
    )
  }
  tabs.push({ key: 'result', label: 'Ergebnis' }, { key: 'history', label: 'Verlauf' })
  return tabs
}

function usesMotionView(round: ElectionRound): boolean {
  const profile = profileFor(round.procedure)
  return (
    round.purpose === 'motion' ||
    round.procedure === 'yes_no_abstain' ||
    round.procedure === 'open_vote' ||
    profile.entryKind === 'options'
  )
}

export function RoundDetailPage({ roundId, tab }: { roundId: string; tab?: string }): React.JSX.Element {
  const app = useApp()
  const [detail, setDetail] = useState<RoundDetail | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const active = tab ?? 'candidates'

  const reload = useCallback(async () => {
    try {
      setDetail(await api('round.detail', roundId))
      await app.refreshRounds()
    } catch (error) {
      app.reportError(error)
    }
  }, [roundId])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!detail) return <Card>Wahlgang wird geladen …</Card>

  const round = detail.round
  const locked = isImmutable(round.status)
  const prepared = round.status === 'draft'
  const tabs = tabsFor(round)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            {round.sequentialNumber > 0 ? `Wahlgang ${round.roundLabel} – ` : 'In Vorbereitung: '}
            {round.title}
          </h1>
          <div className="subtitle">
            {PURPOSE_LABELS[round.purpose]} &middot; {PROCEDURE_LABELS[round.procedure]} &middot; Kennung{' '}
            <span className="mono">{round.roundCode || 'wird beim Start vergeben'}</span>
          </div>
        </div>
        <div className="row">
          <StatusBadge status={round.status} />
          <span className="badge">
            v{round.ballotVersion}
            {round.approvedVersion === round.ballotVersion ? ' freigegeben' : ' nicht freigegeben'}
          </span>
          {prepared && (
            <button
              className="primary"
              onClick={async () => {
                try {
                  const started = await api('round.start', round.id)
                  app.notify('ok', `Wahlgang ${started.roundLabel} gestartet (${started.roundCode}).`)
                  await reload()
                } catch (error) {
                  app.reportError(error)
                }
              }}
            >
              Wahlgang starten
            </button>
          )}
          {!locked && (
            <>
              <button onClick={() => setConfirmComplete(true)}>Abschließen</button>
              <button className="ghost" onClick={() => setConfirmCancel(true)}>
                Abbrechen
              </button>
            </>
          )}
        </div>
      </div>

      {prepared && (
        <div className="notice">
          Dieser Punkt ist vorbereitet. Nummer und Wahlgangkennung werden vergeben, sobald Sie ihn starten — bis
          dahin lässt er sich in der Tagesordnung frei verschieben.
        </div>
      )}

      <div className="tabs">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            className={`tab${active === entry.key ? ' active' : ''}`}
            onClick={() => navigate(`round/${roundId}/${entry.key}`)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {active === 'candidates' &&
        (usesMotionView(round) ? (
          <MotionTab detail={detail} reload={reload} />
        ) : (
          <CandidatesTab detail={detail} reload={reload} />
        ))}
      {active === 'ballot' && <BallotTab detail={detail} reload={reload} />}
      {active === 'print' && <PrintTab detail={detail} reload={reload} />}
      {active === 'accounting' && <AccountingTab detail={detail} reload={reload} />}
      {active === 'result' && <ResultTab detail={detail} reload={reload} />}
      {active === 'history' && <HistoryTab detail={detail} />}

      {confirmComplete && (
        <ConfirmDialog
          title="Wahlgang abschließen"
          message={
            <p>
              Nach dem Abschluss ist der Wahlgang im normalen Betrieb unveränderbar. Voraussetzung ist ein
              bestaetigtes Ergebnis.
            </p>
          }
          confirmLabel="Abschließen"
          onCancel={() => setConfirmComplete(false)}
          onConfirm={async () => {
            try {
              await api('round.complete', roundId)
              app.notify('ok', 'Wahlgang abgeschlossen.')
              setConfirmComplete(false)
              await reload()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Wahlgang abbrechen"
          message={<p>Der Wahlgang wird als abgebrochen dokumentiert. Es werden keine Daten gelöscht.</p>}
          confirmLabel="Abbrechen bestätigen"
          danger
          requireReason
          onCancel={() => setConfirmCancel(false)}
          onConfirm={async (reason) => {
            try {
              await api('round.cancel', { roundId, reason })
              app.notify('ok', 'Wahlgang abgebrochen.')
              setConfirmCancel(false)
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

export interface TabProps {
  detail: RoundDetail
  reload: () => Promise<void>
}

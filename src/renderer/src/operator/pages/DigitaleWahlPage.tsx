/**
 * Die digitale Abstimmung führen.
 *
 * Vier Schritte in einer festen Folge, weil jeder auf dem vorigen aufbaut:
 * vorbereiten, eröffnen, schließen, übernehmen. Die Reihenfolge steht sichtbar
 * da, damit niemand raten muss, wo er ist.
 *
 * Der Schlüssel des Wahlgangs gehört **vor** der Eröffnung auf die Leinwand —
 * danach lässt er sich nicht mehr unbemerkt austauschen. Deshalb steht er hier
 * groß und zum Abschreiben.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RoundSummary } from '@shared/types'
import {
  GEHEIMNIS_LABELS,
  GERAETE_LABELS,
  type Geraetewahl,
  type Wahlgeheimnis,
  type WahlLage,
  type WahlStand
} from '@shared/wahl'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, EmptyState, Field } from '../components/ui'

export function DigitaleWahlPage(): React.JSX.Element {
  const app = useApp()
  const event = app.event
  const [wahlgang, setWahlgang] = useState<RoundSummary | null>(null)
  const [lage, setLage] = useState<WahlLage | null>(null)
  const [stand, setStand] = useState<WahlStand | null>(null)
  const [geheimnis, setGeheimnis] = useState<Wahlgeheimnis>('open')
  const [geraete, setGeraete] = useState<Geraetewahl>('both')
  const [signer, setSigner] = useState<'hub' | 'committee'>('hub')

  const laden = useCallback(async () => {
    if (!wahlgang) return
    try {
      const [l, s] = await Promise.all([api('voting.lage', wahlgang.id), api('voting.stand', wahlgang.id)])
      setLage(l)
      setStand(s)
      if (l) {
        setGeheimnis(l.geheimnis)
        setGeraete(l.geraete)
      }
    } catch (error) {
      app.reportError(error)
    }
  }, [wahlgang?.id])

  useEffect(() => {
    void laden()
  }, [laden])

  /* Während die Abstimmung läuft, ist die einzige Frage: Wie viele haben
     schon? Zwei Sekunden sind schnell genug und belasten nichts. */
  useEffect(() => {
    if (lage?.status !== 'open') return
    const takt = setInterval(() => void laden(), 2000)
    return () => clearInterval(takt)
  }, [lage?.status, laden])

  if (!event) {
    return (
      <Card title="Keine aktive Veranstaltung">
        <button className="primary" onClick={() => navigate('event')}>
          Zur Veranstaltung
        </button>
      </Card>
    )
  }

  const tue = async (was: () => Promise<unknown>): Promise<void> => {
    try {
      await was()
      await laden()
    } catch (error) {
      app.reportError(error)
    }
  }

  /**
   * Die Urne ins Ergebnis übernehmen — und sagen, was dabei herauskam.
   *
   * Vorher passierte sichtbar nichts: Der Knopf schrieb ein Ergebnis in einen
   * anderen Reiter, und wer davon nichts wusste, hielt ihn für kaputt. Lag
   * bereits eine Papierauszählung vor, tat er sogar tatsächlich nichts — die
   * Urne wird ja beim Lesen hinzugerechnet.
   */
  const uebernehmen = async (): Promise<void> => {
    if (!wahlgang) return
    try {
      const { digital, hatteErgebnis } = await api('voting.uebernehmen', wahlgang.id)
      await laden()
      app.notify(
        'ok',
        hatteErgebnis
          ? `Die Urne mit ${digital} ${digital === 1 ? 'Stimme' : 'Stimmen'} ist im Ergebnis enthalten — sie wird zur Handauszählung hinzugerechnet.`
          : `${digital} ${digital === 1 ? 'Stimme' : 'Stimmen'} ins Ergebnis übernommen.`
      )
      /* Dorthin, wo das Ergebnis steht — sonst sucht die Wahlleitung es. */
      navigate(`round/${wahlgang.id}/result`)
    } catch (error) {
      app.reportError(error)
    }
  }

  const drucker = app.settings?.config.printing.defaultPrinterId

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Digitale Abstimmung</h1>
          <div className="subtitle">
            Teilnehmer stimmen mit ihrem eigenen Gerät oder in einer Wahlkabine ab. Die Papierwahl bleibt
            davon unberührt — je Wahlgang entscheidet die Wahlleitung.
          </div>
        </div>
      </div>

      <Card title="Wahlgang">
        {app.rounds.length === 0 ? (
          <EmptyState text="Noch kein Wahlgang angelegt." />
        ) : (
          <div className="row">
            {app.rounds.map((runde) => (
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
        <>
          <Card title="1. Vorbereiten">
            <Field label="Wie geheim">
              <select
                disabled={lage?.status === 'open' || lage?.status === 'closed'}
                value={geheimnis}
                onChange={(e) => setGeheimnis(e.target.value as Wahlgeheimnis)}
              >
                {(Object.keys(GEHEIMNIS_LABELS) as Wahlgeheimnis[]).map((wert) => (
                  <option key={wert} value={wert}>
                    {GEHEIMNIS_LABELS[wert]}
                  </option>
                ))}
              </select>
            </Field>
            {geheimnis === 'namentlich' && (
              <div className="notice warn">
                Bei einer namentlichen Abstimmung wird festgehalten, <strong>wer wie</strong> gestimmt hat.
                Das gehört ins Protokoll — aber nur, wenn die Versammlung es beschlossen hat.
              </div>
            )}
            {geheimnis === 'secret' && (
              <div className="notice warn">
                Für die geheime Wahl empfehlen wir <strong>Wahlkabinen</strong>. Bei eigenen Geräten am Platz
                lässt sich nicht verhindern, dass jemand über die Schulter schaut — und die Adresse des Geräts
                verbindet im Netz Berechtigung und Abgabe, auch wenn Votura es nicht tut.
              </div>
            )}
            <Field label="Womit">
              <select
                disabled={lage?.status === 'open' || lage?.status === 'closed'}
                value={geraete}
                onChange={(e) => setGeraete(e.target.value as Geraetewahl)}
              >
                {(Object.keys(GERAETE_LABELS) as Geraetewahl[]).map((wert) => (
                  <option key={wert} value={wert}>
                    {GERAETE_LABELS[wert]}
                  </option>
                ))}
              </select>
            </Field>
            {geheimnis === 'secret' && (
              <Field label="Wer unterschreibt">
                <select
                  disabled={lage?.status === 'open' || lage?.status === 'closed'}
                  value={signer}
                  onChange={(e) => setSigner(e.target.value as 'hub' | 'committee')}
                >
                  <option value="hub">Dieser Rechner</option>
                  <option value="committee">Der Wahlausschuss auf eigenem Gerät</option>
                </select>
              </Field>
            )}
            {geheimnis === 'secret' && signer === 'hub' && (
              <div className="notice warn">
                Der Schlüssel liegt dann <strong>auf diesem Rechner</strong>. Wer ihn vollständig
                kontrolliert, kann zusätzliche Stimmberechtigungen erzeugen — die Bilanz macht das sichtbar,
                verhindert es aber nicht. Beim Wahlausschuss auf eigenem Gerät kann er es nicht.
              </div>
            )}
            {geheimnis === 'secret' && signer === 'committee' && (
              <div className="notice">
                Das Gerät des Wahlausschusses erzeugt den Schlüssel und meldet nur den öffentlichen Teil
                hierher. <strong>Eröffnen lässt sich erst danach.</strong> Votura Saal hat dafür die Rolle
                „Wahlausschuss".
              </div>
            )}
            <button
              className="primary"
              disabled={lage?.status === 'open' || lage?.status === 'closed'}
              onClick={() =>
                void tue(() => api('voting.prepare', { roundId: wahlgang.id, geheimnis, geraete, signer }))
              }
            >
              Vorbereiten
            </button>
          </Card>

          {lage && (
            <>
              {lage.schluessel && (
                <Card title="Prüfschlüssel dieses Wahlgangs">
                  <div className="hint">
                    Er gehört <strong>vor</strong> der Eröffnung auf die Leinwand und ins Protokoll — danach
                    lässt er sich nicht mehr unbemerkt austauschen. Mit ihm kann jeder nachprüfen, dass in der
                    Urne nur unterschriebene Stimmzettel liegen.
                  </div>
                  <p className="mono mt-2" style={{ wordBreak: 'break-all', fontSize: '13px' }}>
                    {lage.schluessel.n.slice(0, 96)}…
                  </p>
                </Card>
              )}

              <Card title="2. Eröffnen und laufen lassen">
                <p>
                  Zustand:{' '}
                  <strong>
                    {lage.status === 'prepared'
                      ? 'vorbereitet'
                      : lage.status === 'open'
                        ? 'läuft'
                        : 'geschlossen'}
                  </strong>{' '}
                  · {GEHEIMNIS_LABELS[lage.geheimnis]} · {GERAETE_LABELS[lage.geraete]}
                </p>
                <div className="row mt-2">
                  <button
                    className="primary"
                    disabled={lage.status !== 'prepared'}
                    onClick={() => void tue(() => api('voting.open', wahlgang.id))}
                  >
                    Eröffnen
                  </button>
                  <button
                    disabled={lage.status !== 'open'}
                    onClick={() => void tue(() => api('voting.close', wahlgang.id))}
                  >
                    Schließen
                  </button>
                </div>
              </Card>

              {stand && (
                <Card tight>
                  <div className="grid cols-4">
                    <div className="kpi">
                      <span className="value">{stand.ausgegeben}</span>
                      <span className="label">Berechtigungen</span>
                    </div>
                    <div className="kpi">
                      <span className="value">{stand.abgegeben}</span>
                      <span className="label">Stimmen in der Urne</span>
                    </div>
                    {stand.gewicht !== stand.abgegeben && (
                      <div className="kpi">
                        <span className="value">{stand.gewicht}</span>
                        <span className="label">Stimmen mit Gewicht</span>
                      </div>
                    )}
                    {stand.entwertet > 0 && (
                      <div className="kpi">
                        <span className="value">{stand.entwertet}</span>
                        <span className="label">entwertet</span>
                      </div>
                    )}
                  </div>
                  {stand.entwertet > 0 && (
                    <div className="hint mt-2">
                      Entwertete Berechtigungen erklären die Lücke: Diese Personen haben am Gerät nicht
                      abgestimmt und einen Papierzettel bekommen. Grund und Uhrzeit stehen im Protokoll.
                    </div>
                  )}
                  {stand.abgegeben > stand.ausgegeben && (
                    <div className="notice warn mt-2">
                      In der Urne liegen <strong>mehr Stimmen als Berechtigungen ausgegeben</strong> wurden.
                      Das darf nicht vorkommen — das Ergebnis ist nicht zu verwenden.
                    </div>
                  )}
                </Card>
              )}

              {lage.status === 'closed' && (
                <Card title="3. Nachzählen und übernehmen">
                  <div className="hint">
                    Das Urnenverzeichnis macht die digitale Wahl nachzählbar wie einen Stapel Zettel — von
                    jedem im Saal, ohne Zugriff auf diesen Rechner.
                  </div>
                  <div className="row mt-2">
                    <button
                      disabled={!drucker}
                      onClick={() =>
                        void tue(() => api('voting.drucken', { roundId: wahlgang.id, printerId: drucker! }))
                      }
                    >
                      Urnenverzeichnis drucken
                    </button>
                    <button className="primary" onClick={() => void uebernehmen()}>
                      Ergebnis übernehmen
                    </button>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

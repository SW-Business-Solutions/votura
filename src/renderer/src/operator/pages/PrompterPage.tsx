/**
 * Bedienung des Teleprompters.
 *
 * Bewusst eine eigene Seite und kein Reiter unter „Beamer": Der Prompter ist
 * keine Bühne. Er zeigt genau das, was das Publikum **nicht** sehen soll, und
 * ein Griff, der beides verwechselt, wirft die Rede an die Wand.
 *
 * Links die Bibliothek der Reden mit einem einfachen Editor, rechts die
 * Steuerung des Laufs — dieselben Werte, die auch am Pult einstellbar sind.
 * Wer vorträgt, hat die Hände am Text; wer am Board sitzt, greift von hier
 * ein.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  prompterAmEnde,
  prompterPosition,
  redeDauer,
  redeWoerter,
  SCHRIFT_MAX,
  SCHRIFT_MIN,
  TEMPO_MAX,
  TEMPO_MIN,
  type SpeechInfo
} from '@shared/speech'
import type { NetworkProjectionStatus } from '@shared/ipc'
import { api, bridge } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field } from '../components/ui'

/** m:ss — dieselbe Darstellung wie überall sonst. */
function mss(sekunden: number): string {
  const ganz = Math.max(0, Math.round(sekunden))
  return `${Math.floor(ganz / 60)}:${String(ganz % 60).padStart(2, '0')}`
}

export function PrompterPage(): React.JSX.Element {
  const app = useApp()
  const view = app.prompter
  const [reden, setReden] = useState<SpeechInfo[]>([])
  const [offen, setOffen] = useState<string | null>(null)
  const [entwurf, setEntwurf] = useState('')
  const [gespeichert, setGespeichert] = useState(true)
  const [netz, setNetz] = useState<NetworkProjectionStatus | null>(null)
  const [fenster, setFenster] = useState(false)
  /* Die Uhr für die Anzeige „bei Zeile x von y" — der Lauf selbst hängt an
     der Uhr des Zustands, nicht an dieser. */
  const [jetzt, setJetzt] = useState(() => Date.now())
  const textfeld = useRef<HTMLTextAreaElement>(null)

  const laden = useCallback(async () => {
    try {
      setReden(await api('speech.list'))
    } catch (error) {
      app.reportError(error)
    }
  }, [app])

  useEffect(() => {
    void laden()
    void api('prompter.windowState')
      .then((zustand) => setFenster(zustand.open))
      .catch(() => undefined)
    void api('projection.network').then(setNetz).catch(() => undefined)
  }, [laden])

  useEffect(() => {
    const ab = bridge.onTeleprompterState((zustand) => setFenster(zustand.open))
    return ab
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const rufe = useCallback(
    async (tun: () => Promise<unknown>) => {
      try {
        await tun()
      } catch (error) {
        app.reportError(error)
      }
    },
    [app]
  )

  const oeffne = async (rede: SpeechInfo): Promise<void> => {
    try {
      const voll = await api('speech.get', rede.id)
      if (!voll) return
      setOffen(rede.id)
      setEntwurf(voll.markdown)
      setGespeichert(true)
    } catch (error) {
      app.reportError(error)
    }
  }

  const speichere = async (): Promise<void> => {
    if (!offen) return
    await rufe(async () => {
      await api('speech.save', { id: offen, markdown: entwurf })
      setGespeichert(true)
      await laden()
    })
  }

  /* Was im Editor steht, zählt — nicht, was zuletzt gespeichert wurde. */
  const woerterImEntwurf = useMemo(() => redeWoerter(entwurf), [entwurf])

  const stelle = prompterPosition(view, jetzt)
  const amEnde = prompterAmEnde(view, jetzt)

  const prompterAdresse = netz?.running && netz.urls[0]
    ? `${netz.urls[0].split('?')[0].replace(/\/$/, '')}/prompter${netz.token ? `?t=${netz.token}` : ''}`
    : undefined

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Prompter</h1>
          <div className="subtitle">
            Reden ablegen und am Pult anzeigen — im eigenen Fenster oder über das Netz. Nichts davon
            erscheint auf dem Beamer.
          </div>
        </div>
        <div className="row">
          <span className={`badge ${view.speech ? 'ok' : 'warn'}`}>
            {view.speech ? view.speech.title : 'Keine Rede aufgelegt'}
          </span>
          {view.running && <span className="badge accent">läuft</span>}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="beamer-spalte-fest">
          <Card title="Reden">
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  void rufe(async () => {
                    const neu = await api('speech.import')
                    if (neu) {
                      await laden()
                      await oeffne(neu)
                    }
                  })
                }
              >
                Rede einspeisen
              </button>
              <button
                onClick={() =>
                  void rufe(async () => {
                    const neu = await api('speech.create', 'Neue Rede')
                    await laden()
                    await oeffne(neu)
                  })
                }
              >
                Neu anlegen
              </button>
            </div>

            {reden.length === 0 ? (
              <div className="hint" style={{ marginTop: 12 }}>
                Noch keine Rede abgelegt. Markdown-Dateien (.md) lassen sich einspeisen; eine neue
                Rede kann auch hier entstehen.
              </div>
            ) : (
              <table className="tabelle" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Rede</th>
                    <th style={{ textAlign: 'right' }}>Umfang</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reden.map((rede) => {
                    const liegtAuf = view.speech?.id === rede.id
                    return (
                      <tr key={rede.id} className={liegtAuf ? 'hervorgehoben' : ''}>
                        <td>
                          <button className="linkartig" onClick={() => void oeffne(rede)}>
                            {rede.title}
                          </button>
                          {liegtAuf && <span className="badge ok" style={{ marginLeft: 8 }}>auf dem Prompter</span>}
                          {rede.candidateName && (
                            <div className="hint">für {rede.candidateName}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {rede.words} Wörter
                          <div className="hint">etwa {mss(redeDauer(rede.words))} min</div>
                        </td>
                        <td className="rede-knoepfe">
                          <button
                            className="mini"
                            onClick={() => void rufe(() => api('prompter.load', rede.id))}
                          >
                            Auflegen
                          </button>
                          <button
                            className="mini"
                            onClick={() =>
                              void rufe(async () => {
                                const name = window.prompt('Neuer Name', rede.title)
                                if (!name) return
                                await api('speech.rename', { id: rede.id, title: name })
                                await laden()
                              })
                            }
                          >
                            Umbenennen
                          </button>
                          <button
                            className="mini danger"
                            onClick={() =>
                              void rufe(async () => {
                                if (!window.confirm(`„${rede.title}" entfernen?`)) return
                                await api('speech.delete', rede.id)
                                if (offen === rede.id) {
                                  setOffen(null)
                                  setEntwurf('')
                                }
                                await laden()
                              })
                            }
                          >
                            Entfernen
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {offen && (
            <Card title="Text bearbeiten">
              {/* Markdown und kein Textprogramm: Eine Rede ist Text mit
                  Gliederung. Überschriften werden am Pult zu Marken, Striche
                  zu einer Stelle zum Durchatmen. */}
              <div className="hint">
                <code>#</code> Überschrift · <code>-</code> Aufzählung · <code>&gt;</code> Zitat ·{' '}
                <code>---</code> Atempause. Leerzeile trennt Absätze.
              </div>
              <textarea
                ref={textfeld}
                className="rede-editor"
                value={entwurf}
                spellCheck
                onChange={(event) => {
                  setEntwurf(event.target.value)
                  setGespeichert(false)
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                    event.preventDefault()
                    void speichere()
                  }
                }}
              />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="hint">
                  {woerterImEntwurf} Wörter · etwa {mss(redeDauer(woerterImEntwurf))} min
                  {!gespeichert && ' · nicht gespeichert'}
                </span>
                <div className="row">
                  <button className="primary" disabled={gespeichert} onClick={() => void speichere()}>
                    Speichern
                  </button>
                  <button onClick={() => void rufe(() => api('prompter.load', offen))}>
                    Auflegen
                  </button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div>
          <Card title="Lauf">
            {!view.speech ? (
              <div className="hint">
                Noch keine Rede aufgelegt. In der Liste links auf <strong>Auflegen</strong>.
              </div>
            ) : (
              <>
                {/* Eine Zeile, eine Fluchtlinie: Start, Feinsprung, Anfang.
                    Was selten gebraucht wird, steht unten und klein. */}
                <div className="prompter-lauf-zeile">
                  <button
                    className={view.running ? '' : 'primary'}
                    onClick={() => void rufe(() => api('prompter.setRunning', !view.running))}
                  >
                    {view.running ? 'Anhalten' : amEnde ? 'Von vorn' : 'Starten'}
                  </button>
                  <div className="segmented klein">
                    <button
                      onClick={() => void rufe(() => api('prompter.nudge', -12))}
                      title="Ein Stück zurück"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => void rufe(() => api('prompter.nudge', 12))}
                      title="Ein Stück vor"
                    >
                      ↓
                    </button>
                  </div>
                  <button className="mini" onClick={() => void rufe(() => api('prompter.setPosition', 0))}>
                    An den Anfang
                  </button>
                </div>

                <div className="prompter-stand-balken" style={{ marginTop: 12 }}>
                  <div
                    className="prompter-stand-fuellung"
                    style={{
                      width: `${view.laenge > 0 ? Math.min(100, (stelle / view.laenge) * 100) : 0}%`
                    }}
                  />
                </div>
                <div className="hint">
                  Wort {Math.round(stelle)} von {view.laenge}
                  {amEnde
                    ? ' — durchgelaufen'
                    : ` · noch etwa ${mss(((view.laenge - stelle) / view.tempo) * 60)} min`}
                </div>

                {/* Was den Text bewegt. „Hand" ist kein Verlegenheitsposten:
                    Bei einer Rede mit vielen Zwischenrufen ist Blättern von
                    Hand ruhiger als jede Automatik. */}
                <Field label="Was den Text bewegt">
                  <div className="segmented">
                    {(
                      [
                        ['auto', 'Gleichmäßig'],
                        ['stimme', 'Nach Stimme'],
                        ['hand', 'Von Hand']
                      ] as const
                    ).map(([wert, beschriftung]) => (
                      <button
                        key={wert}
                        className={view.laufart === wert ? 'active' : ''}
                        onClick={() => void rufe(() => api('prompter.setLaufart', wert))}
                      >
                        {beschriftung}
                      </button>
                    ))}
                  </div>
                </Field>
                {view.laufart === 'stimme' && (
                  <div className="hint">
                    Der Prompter hört mit und setzt die Stelle dorthin, wo gesprochen wird. Dafür
                    muss am Pult ein Sprachmodell hinterlegt sein — siehe Einstellungen.
                  </div>
                )}
                {view.laufart === 'hand' && (
                  <div className="hint">
                    Der Text bewegt sich nur, wenn hier oder am Pult geblättert wird.
                  </div>
                )}

                <Field label={`Tempo — ${view.tempo} Wörter je Minute`}>
                  <input
                    type="range"
                    min={TEMPO_MIN}
                    max={TEMPO_MAX}
                    step={5}
                    value={view.tempo}
                    onChange={(event) =>
                      void rufe(() => api('prompter.setTempo', Number(event.target.value)))
                    }
                  />
                </Field>
                <button className="mini" onClick={() => void rufe(() => api('prompter.load', undefined))}>
                  Rede herunternehmen
                </button>
              </>
            )}
          </Card>

          <Card title="Was am Pult zu sehen ist">
            {/* Wer abliest, braucht den Text; wer frei spricht, die Folien.
                Ein Wechsel rührt den Lauf nicht an — zurückgeschaltet steht
                die Rede wieder an derselben Stelle. */}
            <div className="segmented">
              <button
                className={view.ansicht === 'rede' ? 'active' : ''}
                onClick={() => void rufe(() => api('prompter.setAnsicht', 'rede'))}
              >
                Redetext
              </button>
              <button
                className={view.ansicht === 'vortrag' ? 'active' : ''}
                onClick={() => void rufe(() => api('prompter.setAnsicht', 'vortrag'))}
              >
                Laufende Folien
              </button>
            </div>
            <div className="hint">
              {view.ansicht === 'rede'
                ? 'Am Pult läuft der Redetext.'
                : 'Am Pult stehen die Folie an der Wand und die nächste — wie in der Vortragssteuerung.'}
            </div>
          </Card>

          <Card title="Darstellung am Pult">
            <Field label={`Schriftgröße — ${view.schrift} % der Höhe`}>
              <input
                type="range"
                min={SCHRIFT_MIN}
                max={SCHRIFT_MAX}
                step={0.5}
                value={view.schrift}
                onChange={(event) =>
                  void rufe(() =>
                    api('prompter.setDarstellung', { schrift: Number(event.target.value) })
                  )
                }
              />
            </Field>
            <Field label={`Textbreite — ${view.breite} %`}>
              <input
                type="range"
                min={40}
                max={100}
                step={5}
                value={view.breite}
                onChange={(event) =>
                  void rufe(() =>
                    api('prompter.setDarstellung', { breite: Number(event.target.value) })
                  )
                }
              />
            </Field>
            <Field label={`Lesezeile — ${view.leselinie} % von oben`}>
              <input
                type="range"
                min={10}
                max={80}
                step={5}
                value={view.leselinie}
                onChange={(event) =>
                  void rufe(() =>
                    api('prompter.setDarstellung', { leselinie: Number(event.target.value) })
                  )
                }
              />
            </Field>
            {/* Zwei Spiegelungen, weil zwei Aufbauten vorkommen: die Scheibe
                vor dem Objektiv und das Gerät über Kopf darunter. */}
            <Checkbox
              checked={view.spiegel.horizontal}
              onChange={(wert) =>
                void rufe(() =>
                  api('prompter.setDarstellung', {
                    spiegel: { ...view.spiegel, horizontal: wert }
                  })
                )
              }
              label="Seitenverkehrt (für den Prompterspiegel)"
            />
            <Checkbox
              checked={view.spiegel.vertikal}
              onChange={(wert) =>
                void rufe(() =>
                  api('prompter.setDarstellung', {
                    spiegel: { ...view.spiegel, vertikal: wert }
                  })
                )
              }
              label="Über Kopf (Gerät hängt umgedreht)"
            />
            <Checkbox
              checked={view.zeigeUhr}
              onChange={(wert) => void rufe(() => api('prompter.setDarstellung', { zeigeUhr: wert }))}
              label="Restzeit einblenden"
            />
            {/* Derselbe Wert wie unter Beamer → Ausgabe & Netz, nur von hier
                aus erreichbar: Wer den Prompter einrichtet, soll dafür nicht
                die Seite wechseln müssen. Das Prompterfenster am Hauptrechner
                darf ohnehin immer — gemeint ist das Gerät im Saal. */}
            <Checkbox
              checked={netz?.allowPrompterControl ?? false}
              disabled={!netz?.enabled}
              onChange={(wert) =>
                void rufe(async () => {
                  if (!netz) return
                  setNetz(await api('projection.setNetwork', { ...netz, allowPrompterControl: wert }))
                })
              }
              label="Bedienung am Gerät im Netz erlauben"
            />
            {!netz?.enabled && (
              <div className="hint">
                Dafür muss die Netzwerkansicht laufen — Beamer → Ausgabe &amp; Netz.
              </div>
            )}
          </Card>

          <Card title="Wo der Prompter läuft">
            <div className="row">
              <button
                className={fenster ? '' : 'primary'}
                onClick={() =>
                  void rufe(async () =>
                    setFenster((await (fenster ? api('prompter.closeWindow') : api('prompter.openWindow'))).open)
                  )
                }
              >
                {fenster ? 'Fenster schließen' : 'Prompterfenster öffnen'}
              </button>
            </div>
            {prompterAdresse ? (
              <>
                <label style={{ marginTop: 10 }}>Am Pult im Browser</label>
                <div className="mono">{prompterAdresse}</div>
                <div className="hint">
                  {view.netzBedienung
                    ? 'Dieses Gerät darf auch bedienen — anhalten, Stelle, Tempo, Darstellung. An Wahldaten kommt es nicht heran.'
                    : 'Eigener Endpunkt, rein lesend. Gesteuert wird von hier oder am Prompterfenster.'}
                </div>
              </>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>
                Für ein Gerät am Pult die <strong>Netzwerkansicht</strong> unter Beamer →
                Ausgabe &amp; Netz einschalten; die Adresse endet dann auf <code>/prompter</code>.
              </div>
            )}
          </Card>

          <Card title="Redezeit übernehmen">
            {/* Dieselbe Uhr wie auf dem Beamer: Wer vorn steht, sieht dieselbe
                Zahl wie der Saal — und nicht zwei, die auseinanderlaufen. */}
            <div className="hint">
              Läuft auf einer Bühne gerade eine Vorstellung mit Redezeit, lässt sich deren Uhr auf
              den Prompter holen.
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {app.buehnen.map((stage) => {
                const rede = app.projektionen[stage.id]?.speaker
                return (
                  <button
                    key={stage.id}
                    disabled={!rede?.until}
                    onClick={() => void rufe(() => api('prompter.setUntil', rede?.until))}
                  >
                    {stage.name}
                    {rede?.name ? ` — ${rede.name}` : ''}
                  </button>
                )
              })}
              {view.until && (
                <button onClick={() => void rufe(() => api('prompter.setUntil', undefined))}>
                  Uhr entfernen
                </button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

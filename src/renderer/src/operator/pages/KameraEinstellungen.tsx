/**
 * Steuerbare Kameras einrichten.
 *
 * Bild und Steuerung sind zweierlei: Das Bild kommt über NDI, die Steuerung
 * über VISCA — eine Kamera kann das eine ohne das andere. Hier wird beides
 * zusammengebracht, und zwar an **einer** Stelle für alle Hersteller.
 *
 * ## Warum „Erkennen" und keine Auswahl
 *
 * Es gibt drei Spielarten, in denen VISCA über das Netz vorkommt, und der Port
 * verrät nicht, welche gilt — PTZOptics spricht rohes VISCA auf demselben
 * Port, auf dem Sony gekapseltes spricht. Diese Wahl einer Wahlleitung
 * aufzubürden hieße, sie am Abend vor der Versammlung raten zu lassen. Votura
 * klopft die Adresse stattdessen mit einer Frage ab, die nichts verstellt, und
 * nimmt die Form, die antwortet.
 *
 * ## Warum Positionen und kein Joystick
 *
 * Auf einer Versammlung braucht niemand einen Schwenk von Hand. Gebraucht
 * werden zwei, drei feste Positionen — „Pult", „Präsidium", „Saal" —, die
 * einmal eingerichtet und danach abgerufen werden. Wer wirklich live schwenken
 * will, hat ein Pult mit einem Knüppel; das kann es besser als jede Maus.
 */
import { useEffect, useState, type JSX } from 'react'
import {
  PTZ_POSITIONEN_VORSCHLAG,
  PTZ_PROFILE,
  ptzProfil,
  type PtzKamera,
  type PtzPosition
} from '@shared/ptz'
import type { KameraStand } from '@shared/kamera'
import { kurzerQuellenname } from '@shared/kamera'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field } from '../components/ui'

function neueKamera(vorlage?: { name: string; adresse?: string }): PtzKamera {
  return {
    id: `ptz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: vorlage ? kurzerQuellenname(vorlage.name) : 'Kamera',
    /*
     * Die Adresse kommt aus der NDI-Suche.
     *
     * Das ist der eigentliche Gewinn daran, beides auf einer Seite zu haben:
     * Eine Kamera, die ihr Bild ins Netz sendet, verrät dabei, wo sie steht —
     * und genau diese Adresse braucht die Steuerung. Niemand muss sie
     * abtippen oder im Router suchen.
     */
    host: vorlage ? hostAus(vorlage.adresse) : '',
    profil: 'visca-roh-udp',
    quelle: vorlage?.name,
    positionen: PTZ_POSITIONEN_VORSCHLAG.map((position) => ({ ...position })),
    enabled: true
  }
}

/** Aus „192.168.1.60:5961" wird „192.168.1.60". */
function hostAus(adresse?: string): string {
  if (!adresse) return ''
  const doppelpunkt = adresse.lastIndexOf(':')
  return doppelpunkt > 0 ? adresse.slice(0, doppelpunkt) : adresse
}

export function KameraEinstellungen(): JSX.Element {
  const app = useApp()
  const [kameras, setKameras] = useState<PtzKamera[]>([])
  const [stand, setStand] = useState<KameraStand>({ bereit: false, quellen: [] })
  const [pruefung, setPruefung] = useState<Record<string, string>>({})
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    void api('ptz.liste').then(setKameras).catch(app.reportError)
    /*
     * Die NDI-Suche läuft, solange diese Seite offen ist — nur so lässt sich
     * einer Kamera ihr Bild zuordnen, ohne den Namen abzutippen.
     */
    void api('kamera.suche', true).then(setStand).catch(() => undefined)
    return () => {
      void api('kamera.suche', false).catch(() => undefined)
    }
  }, [])

  const aendern = (id: string, teil: Partial<PtzKamera>): void => {
    setKameras((liste) => liste.map((k) => (k.id === id ? { ...k, ...teil } : k)))
  }

  const sichern = async (liste: PtzKamera[]): Promise<void> => {
    setLaeuft(true)
    try {
      setKameras(await api('ptz.speichern', liste))
      app.notify('info', 'Die Kameras sind gespeichert.')
    } catch (fehler) {
      app.reportError(fehler)
    } finally {
      setLaeuft(false)
    }
  }

  const erkennen = async (kamera: PtzKamera): Promise<void> => {
    setPruefung((alt) => ({ ...alt, [kamera.id]: 'Wird gesucht …' }))
    try {
      const fund = await api('ptz.erkennen', { host: kamera.host, port: kamera.port })
      if (fund.erreichbar && fund.profil) {
        aendern(kamera.id, { profil: fund.profil, port: fund.port })
        const gefunden = ptzProfil(fund.profil)
        setPruefung((alt) => ({
          ...alt,
          [kamera.id]: `Antwortet — ${gefunden?.name ?? fund.profil} auf Port ${fund.port}. Noch speichern.`
        }))
      } else {
        setPruefung((alt) => ({ ...alt, [kamera.id]: fund.hinweis ?? 'Es antwortet niemand.' }))
      }
    } catch (fehler) {
      setPruefung((alt) => ({ ...alt, [kamera.id]: (fehler as Error).message }))
    }
  }

  const anfahren = async (kamera: PtzKamera, position: PtzPosition): Promise<void> => {
    try {
      await api('ptz.position', { id: kamera.id, nummer: position.nummer })
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  return (
    <>
      {/*
        Was im Saal steht, bevor es um Einstellungen geht.

        Ein Reiter namens „Kameras", der von den Kameras im Raum nichts zeigt,
        ist eine Falle: Man sucht sie hier und findet eine leere Liste. Dabei
        liefert die NDI-Suche genau die Adresse, die die Steuerung braucht.
      */}
      <Card title="Im Netz gefunden">
        {stand.untauglich ? (
          <p className="hint">
            Auf diesem Rechner lässt sich nicht nach Kameras suchen. {stand.untauglich} Eine
            Steuerung von Hand einzurichten geht trotzdem — dafür genügt die Adresse der Kamera.
          </p>
        ) : stand.quellen.length === 0 ? (
          <p className="hint">
            {stand.sucht ? 'Es meldet sich keine Kamera.' : 'Die Suche läuft an …'} Gefunden werden
            nur Geräte im <strong>selben Netz</strong>, die ihr Bild über NDI senden. Eine Kamera,
            die nur gesteuert werden soll, steht hier nicht — die wird unten von Hand eingetragen.
          </p>
        ) : (
          <table className="liste">
            <tbody>
              {stand.quellen.map((quelle) => {
                const schon = kameras.find((kamera) => kamera.quelle === quelle.name)
                return (
                  <tr key={quelle.name}>
                    <td>
                      <div>{kurzerQuellenname(quelle.name)}</div>
                      <div className="hint mono">{quelle.adresse ?? quelle.name}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {schon ? (
                        <span className="hint">
                          Steuerung eingerichtet: {schon.name}
                        </span>
                      ) : (
                        <button
                          onClick={() => setKameras([...kameras, neueKamera(quelle)])}
                        >
                          Steuerung einrichten
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Steuerbare Kameras">
        <p className="hint">
          Eine Kamera, die sich über das Netz bewegen lässt, fährt auf Wunsch von selbst auf ihre
          Position — zum Pult, wenn ein Redner aufgerufen wird. Das ist unabhängig vom Bild: Votura
          kann eine Kamera steuern, deren Bild woanders hingeht, und eines zeigen, das es nicht
          steuert.
        </p>

        {kameras.length === 0 && (
          <p className="hint">
            Es ist keine Kamera zum Steuern eingerichtet. Das ist der Regelfall: Ein Bild braucht
            keine Steuerung, und eine Kamera, die niemand bewegt, auch nicht.
          </p>
        )}

        {kameras.map((kamera) => {
          const profil = ptzProfil(kamera.profil)
          return (
            <div key={kamera.id} className="notice mb-3">
              <div className="row">
                <div className="col">
                  <Field label="Name">
                    <input
                      value={kamera.name}
                      onChange={(e) => aendern(kamera.id, { name: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="col">
                  <Field label="Adresse der Kamera">
                    <input
                      value={kamera.host}
                      placeholder="192.168.1.60"
                      onChange={(e) => aendern(kamera.id, { host: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="col">
                  <Field label="Port">
                    <input
                      value={kamera.port ?? ''}
                      placeholder={String(profil?.port ?? '')}
                      onChange={(e) =>
                        aendern(kamera.id, {
                          port: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                    />
                  </Field>
                </div>
              </div>

              <div className="row">
                <div className="col">
                  <Field label="Bauart">
                    <select
                      value={kamera.profil}
                      onChange={(e) => aendern(kamera.id, { profil: e.target.value })}
                    >
                      {PTZ_PROFILE.map((eintrag) => (
                        <option key={eintrag.kennung} value={eintrag.kennung}>
                          {eintrag.hersteller} — {eintrag.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="col">
                  {/*
                    Die Zuordnung zum Bild. Sie ist der Grund, warum Votura beim
                    Aufruf eines Redners die richtige Kamera bewegt und nicht die
                    im Nebenraum.
                  */}
                  <Field label="Ihr Bild (NDI)">
                    <select
                      value={kamera.quelle ?? ''}
                      onChange={(e) => aendern(kamera.id, { quelle: e.target.value || undefined })}
                    >
                      <option value="">— keines —</option>
                      {stand.quellen.map((quelle) => (
                        <option key={quelle.name} value={quelle.name}>
                          {kurzerQuellenname(quelle.name)}
                        </option>
                      ))}
                      {kamera.quelle && !stand.quellen.some((q) => q.name === kamera.quelle) && (
                        <option value={kamera.quelle}>{kurzerQuellenname(kamera.quelle)} (nicht da)</option>
                      )}
                    </select>
                  </Field>
                </div>
              </div>

              <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <button onClick={() => void erkennen(kamera)} disabled={!kamera.host.trim()}>
                  Bauart erkennen
                </button>
                <Checkbox
                  label="In Betrieb"
                  checked={kamera.enabled}
                  onChange={(wert) => aendern(kamera.id, { enabled: wert })}
                />
                <button
                  className="danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => void sichern(kameras.filter((k) => k.id !== kamera.id))}
                >
                  Entfernen
                </button>
              </div>

              {pruefung[kamera.id] && <p className="hint">{pruefung[kamera.id]}</p>}

              {/*
                Der eigentliche Zweck der Steuerung: Bei zwölf Bewerbern
                hintereinander soll niemand zwischendurch eine Kamera
                nachführen. Vorgabe ist trotzdem „nichts" — eine Kamera, die
                unaufgefordert losfährt, erschrickt einen Saal.
              */}
              <Field label="Beim Aufruf eines Redners">
                <select
                  value={kamera.beiAufruf ?? ''}
                  onChange={(e) =>
                    aendern(kamera.id, {
                      beiAufruf: e.target.value === '' ? undefined : Number(e.target.value)
                    })
                  }
                >
                  <option value="">— stehen bleiben —</option>
                  {kamera.positionen.map((position) => (
                    <option key={position.nummer} value={position.nummer}>
                      auf „{position.name}“ fahren
                    </option>
                  ))}
                </select>
              </Field>

              {/*
                Die Eigenheiten stehen hier, nicht im Quelltext: Wer sich
                wundert, warum das Neigen langsamer läuft als eingestellt,
                findet die Antwort dort, wo er sucht.
              */}
              {profil?.eigenheiten && profil.eigenheiten.length > 0 && (
                <>
                  <label className="mt-3">Besonderheiten dieses Modells</label>
                  <ul className="hint">
                    {profil.eigenheiten.map((eigenheit) => (
                      <li key={eigenheit}>{eigenheit}</li>
                    ))}
                  </ul>
                </>
              )}

              <label className="mt-3">Positionen</label>
              <table className="liste">
                <tbody>
                  {kamera.positionen.map((position, i) => (
                    <tr key={`${kamera.id}-${i}`}>
                      <td style={{ width: 90 }}>
                        <input
                          value={position.nummer}
                          onChange={(e) =>
                            aendern(kamera.id, {
                              positionen: kamera.positionen.map((p, j) =>
                                j === i ? { ...p, nummer: Number(e.target.value) || 0 } : p
                              )
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={position.name}
                          onChange={(e) =>
                            aendern(kamera.id, {
                              positionen: kamera.positionen.map((p, j) =>
                                j === i ? { ...p, name: e.target.value } : p
                              )
                            })
                          }
                        />
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => void anfahren(kamera, position)}>Anfahren</button>{' '}
                        <button
                          title="Die Kamera steht jetzt richtig? Dann hier ablegen."
                          onClick={() =>
                            void api('ptz.positionSpeichern', {
                              id: kamera.id,
                              nummer: position.nummer
                            }).catch(app.reportError)
                          }
                        >
                          Hier ablegen
                        </button>{' '}
                        <button
                          className="danger"
                          onClick={() =>
                            aendern(kamera.id, {
                              positionen: kamera.positionen.filter((_, j) => j !== i)
                            })
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="mt-3"
                onClick={() =>
                  aendern(kamera.id, {
                    positionen: [
                      ...kamera.positionen,
                      { nummer: kamera.positionen.length, name: 'Neue Position' }
                    ]
                  })
                }
              >
                Position ergänzen
              </button>
            </div>
          )
        })}

        <div className="row mt-3" style={{ gap: 10 }}>
          <button onClick={() => setKameras([...kameras, neueKamera()])}>Kamera ergänzen</button>
          <button className="primary" disabled={laeuft} onClick={() => void sichern(kameras)}>
            {laeuft ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        </div>
      </Card>

      <Card title="Woran das hängt">
        <p className="hint">
          Fast alle Netzwerkkameras sprechen <strong>VISCA</strong> — das Protokoll, das Sony für
          seine Steuerpulte erfunden hat. Der Inhalt eines Befehls ist dabei überall gleich;
          verschieden sind Verpackung, Weg und Port. Votura hält diese Unterschiede in einer Tabelle,
          nicht im Programm: Eine neue Kamera aufzunehmen heißt im Regelfall, eine Zeile zu ergänzen.
        </p>
        <p className="hint">
          Damit das Erkennen gelingt, muss die Steuerung über das Netz <strong>in der Kamera</strong>{' '}
          eingeschaltet sein — bei vielen Modellen ist sie es ab Werk nicht. Sie steht meist unter
          „VISCA over IP" oder „Netzwerksteuerung" in deren Weboberfläche.
        </p>
      </Card>
    </>
  )
}

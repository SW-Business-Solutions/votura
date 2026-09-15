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
import { useEffect, useRef, useState, type JSX } from 'react'
import {
  PTZ_POSITIONEN_VORSCHLAG,
  PTZ_PROFILE,
  ptzProfil,
  type PtzKamera,
  type PtzPosition
} from '@shared/ptz'
import type { KameraStand } from '@shared/kamera'
import { kurzerQuellenname } from '@shared/kamera'
import { api, bridge } from '../../lib/api'
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
  /*
   * Welche Kameras der Hauptprozess kennt.
   *
   * Bewegen und Positionen ablegen sprechen die **gespeicherte** Kamera an —
   * ein Eintrag, den es nur in diesem Formular gibt, ist dort unbekannt. Ohne
   * diese Unterscheidung drückt jemand „Hier ablegen" und bekommt „Diese
   * Kamera ist nicht eingerichtet" zu lesen, ohne zu ahnen, warum.
   */
  const [gespeichert, setGespeichert] = useState<string[]>([])
  /* Siehe `bewegen`: Eine Kamera, die weiterdreht, weil ein Halt ausblieb,
     ist im Saal ein Ärgernis und beim Einrichten ein Rätsel. */
  const notbremse = useRef<number | undefined>(undefined)

  useEffect(() => {
    void api('ptz.liste')
      .then((liste) => {
        setKameras(liste)
        setGespeichert(liste.map((kamera) => kamera.id))
      })
      .catch(app.reportError)
    /*
     * Die NDI-Suche läuft, solange diese Seite offen ist — nur so lässt sich
     * einer Kamera ihr Bild zuordnen, ohne den Namen abzutippen.
     */
    void api('kamera.stand').then(setStand).catch(() => undefined)
    void api('kamera.suche', true).then(setStand).catch(() => undefined)
    /*
     * Und dann zuhören.
     *
     * Ohne das fragte die Seite genau einmal — und zwar in dem Augenblick, in
     * dem der Empfängerprozess gerade erst hochkommt. Die Antwort war eine
     * leere Liste, und dabei blieb es, während die Kamera längst gefunden war.
     */
    const ab = bridge.onKameraStand(setStand)
    return () => {
      ab()
      void api('kamera.suche', false).catch(() => undefined)
    }
  }, [])

  const aendern = (id: string, teil: Partial<PtzKamera>): void => {
    setKameras((liste) => liste.map((k) => (k.id === id ? { ...k, ...teil } : k)))
  }

  const sichern = async (liste: PtzKamera[]): Promise<void> => {
    setLaeuft(true)
    try {
      const neu = await api('ptz.speichern', liste)
      setKameras(neu)
      setGespeichert(neu.map((kamera) => kamera.id))
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

  /**
   * Schwenken, solange die Taste gedrückt ist.
   *
   * Die Kamera fährt nach dem Befehl **weiter**, bis ein Halt kommt — so ist
   * VISCA gedacht, und so arbeitet jedes Steuerpult. Im Browser ist das eine
   * Gefahr: Geht die Maustaste außerhalb des Knopfes hoch oder wechselt das
   * Fenster, bleibt der Halt aus und die Kamera dreht sich weiter. Deshalb
   * hängt der Halt an `mouseup`, `mouseleave` **und** an einer Uhr, die nach
   * fünf Sekunden ohnehin stoppt. Länger als fünf Sekunden schwenkt niemand
   * am Stück, der eine Position einrichtet.
   */
  const bewegen = (kamera: PtzKamera, x: -1 | 0 | 1, y: -1 | 0 | 1): void => {
    void api('ptz.schwenken', { id: kamera.id, x, y }).catch(app.reportError)
    window.clearTimeout(notbremse.current)
    notbremse.current = window.setTimeout(() => halten(kamera), 5000)
  }

  const zoomen = (kamera: PtzKamera, richtung: -1 | 1): void => {
    void api('ptz.zoom', { id: kamera.id, richtung }).catch(app.reportError)
    window.clearTimeout(notbremse.current)
    notbremse.current = window.setTimeout(() => halten(kamera), 5000)
  }

  const halten = (kamera: PtzKamera): void => {
    window.clearTimeout(notbremse.current)
    void api('ptz.halt', kamera.id).catch(() => undefined)
    void api('ptz.zoom', { id: kamera.id, richtung: 0 }).catch(() => undefined)
  }

  /**
   * Die jetzige Stellung als Position festhalten.
   *
   * Zwei Wege, je nachdem, wer die Positionen führt. Liegt die Ablage in der
   * Kamera, bekommt sie einen Befehl und merkt es sich selbst. Liegt sie in
   * Votura — für Geräte ohne eigenen Speicher —, wird die Kamera nach ihren
   * Zahlen gefragt und die Antwort gespeichert.
   */
  const ablegen = async (kamera: PtzKamera, position: PtzPosition, i: number): Promise<void> => {
    try {
      if (kamera.ablage === 'votura') {
        const stellung = await api('ptz.stellungLesen', kamera.id)
        const positionen = kamera.positionen.map((p, j) =>
          j === i ? { ...p, koordinaten: stellung } : p
        )
        /* Gleich sichern: Eine gemerkte Stellung, die nur im Formular steht,
           ist beim nächsten Neustart weg — und niemand ahnt es. */
        await sichern(kameras.map((k) => (k.id === kamera.id ? { ...k, positionen } : k)))
      } else {
        await api('ptz.positionSpeichern', { id: kamera.id, nummer: position.nummer })
        app.notify('info', `„${position.name}" ist in der Kamera abgelegt.`)
      }
    } catch (fehler) {
      app.reportError(fehler)
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
                          /*
                           * Wird gleich gespeichert.
                           *
                           * Alles Nötige ist bekannt — Name, Adresse, Bild. Ein
                           * Eintrag, der erst nach einem zweiten Klick
                           * existiert, ist eine Falle: Bewegen und Ablegen
                           * sprechen das Gerät an und brauchen die
                           * gespeicherte Kamera.
                           */
                          onClick={() => void sichern([...kameras, neueKamera(quelle)])}
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
              {/*
                Wer die Positionen führt.

                Der Regelfall ist die Kamera: Sie fährt selbst an, das geht
                schneller und überlebt einen Wechsel des Rechners. Nicht jede
                Kamera hat aber einen Positionsspeicher — dann führt Votura ihn
                und schickt ihr die Zahlen.
              */}
              <Field label="Positionen liegen">
                <select
                  value={kamera.ablage ?? 'kamera'}
                  onChange={(e) =>
                    aendern(kamera.id, { ablage: e.target.value === 'votura' ? 'votura' : 'kamera' })
                  }
                >
                  <option value="kamera">in der Kamera (Regelfall)</option>
                  <option value="votura">in Votura — für Kameras ohne eigenen Speicher</option>
                </select>
              </Field>

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
              {/*
                Ohne diese zwei Sätze ist die Tabelle darunter nicht zu deuten.
                Die Nummer gehört der Kamera, der Name gehört euch — und
                „Hier ablegen" schreibt in die Kamera, nicht in Votura.
              */}
              <p className="hint">
                Zum Einrichten: Kamera mit dem Steuerkreuz hinstellen, wo sie stehen soll, dann{' '}
                <strong>Hier ablegen</strong>. <strong>Anfahren</strong> holt sie zurück.
                {kamera.ablage === 'votura' ? (
                  <>
                    {' '}
                    Die Stellung wird <strong>in Votura</strong> gespeichert — die{' '}
                    <strong>Nummer</strong> ist dann nur eine Ordnungszahl.
                  </>
                ) : (
                  <>
                    {' '}
                    Die <strong>Nummer</strong> ist der Speicherplatz <strong>in der Kamera</strong>,
                    der <strong>Name</strong> nur eure Bezeichnung dafür.
                  </>
                )}
              </p>

              {!gespeichert.includes(kamera.id) ? (
                <p className="hint">
                  Diese Kamera ist noch nicht gespeichert. Bewegen und Ablegen sprechen das Gerät an
                  und brauchen deshalb einen gespeicherten Eintrag — erst <strong>Speichern</strong>.
                </p>
              ) : (
                <div className="steuerkreuz">
                  {(
                    [
                      ['↖', -1, -1],
                      ['↑', 0, -1],
                      ['↗', 1, -1],
                      ['←', -1, 0],
                      ['⌂', 0, 0],
                      ['→', 1, 0],
                      ['↙', -1, 1],
                      ['↓', 0, 1],
                      ['↘', 1, 1]
                    ] as [string, -1 | 0 | 1, -1 | 0 | 1][]
                  ).map(([zeichen, x, y]) => (
                    <button
                      key={zeichen}
                      title={zeichen === '⌂' ? 'Auf die Ausgangsstellung fahren' : 'Halten zum Schwenken'}
                      onMouseDown={() =>
                        zeichen === '⌂'
                          ? void api('ptz.heim', kamera.id).catch(app.reportError)
                          : bewegen(kamera, x, y)
                      }
                      onMouseUp={() => halten(kamera)}
                      onMouseLeave={() => halten(kamera)}
                    >
                      {zeichen}
                    </button>
                  ))}
                  <div className="zoomknoepfe">
                    <button
                      title="Halten zum Hineinzoomen"
                      onMouseDown={() => zoomen(kamera, 1)}
                      onMouseUp={() => halten(kamera)}
                      onMouseLeave={() => halten(kamera)}
                    >
                      Zoom +
                    </button>
                    <button
                      title="Halten zum Herauszoomen"
                      onMouseDown={() => zoomen(kamera, -1)}
                      onMouseUp={() => halten(kamera)}
                      onMouseLeave={() => halten(kamera)}
                    >
                      Zoom −
                    </button>
                    <button onClick={() => void api('ptz.scharfstellen', kamera.id).catch(app.reportError)}>
                      Scharfstellen
                    </button>
                  </div>
                </div>
              )}

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
                        {position.koordinaten && kamera.ablage === 'votura' && (
                          <div className="hint mono">
                            Schwenk {position.koordinaten.pan} · Neigung {position.koordinaten.tilt} ·
                            Zoom {position.koordinaten.zoom}
                          </div>
                        )}
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
                        <button
                          disabled={!gespeichert.includes(kamera.id)}
                          onClick={() => void anfahren(kamera, position)}
                        >
                          Anfahren
                        </button>{' '}
                        <button
                          disabled={!gespeichert.includes(kamera.id)}
                          title="Die Kamera steht jetzt richtig? Dann hier ablegen."
                          onClick={() => void ablegen(kamera, position, i)}
                        >
                          Hier ablegen
                        </button>{' '}
                        <button
                          className="ghost danger"
                          title="Diese Position aus der Liste nehmen (die Kamera behält sie)."
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
        <p className="hint">NDI® ist eine eingetragene Marke der Vizrt NDI AB.</p>
      </Card>
    </>
  )
}

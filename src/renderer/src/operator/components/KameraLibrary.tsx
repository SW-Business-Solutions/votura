/**
 * Die Kameras im Saal — Liste, Vorschau und der Griff zum Beamer.
 *
 * ## Warum die Suche nur hier läuft
 *
 * NDI findet Quellen, indem es sich selbst im Netz anmeldet und herumfragt.
 * Das ist harmlos, aber es soll nicht den ganzen Tag laufen, während eine
 * Wahl über dasselbe Netz geht. Die Suche beginnt deshalb, wenn diese Karte
 * sichtbar wird, und endet, wenn sie verschwindet.
 *
 * ## Was die Vorschau ist und was nicht
 *
 * Ein eigener, kleiner Strom — nicht das Bild, das an der Wand hängt. NDI
 * liefert zu jeder Quelle einen Nebenstrom in geringer Auflösung; die
 * Vorschau nimmt den. Das volle Bild ein zweites Mal zu holen, kostete
 * dieselbe Bandbreite noch einmal, für eine Briefmarke.
 */
import { useEffect, useState, type JSX } from 'react'
import { kurzerQuellenname, type KameraStand } from '@shared/kamera'
import { KameraBild } from '../../projection/KameraBild'
import { api, bridge } from '../../lib/api'
import { useApp } from '../state'
import { Card } from './ui'

export function KameraLibrary(): JSX.Element {
  const app = useApp()
  const projection = app.projection
  const [stand, setStand] = useState<KameraStand>({ bereit: false, quellen: [] })
  const [vorschau, setVorschau] = useState(true)

  const kamera = projection.mode === 'kamera' ? projection.camera : undefined

  useEffect(() => {
    /* Erst den letzten Stand holen, dann zuhören — sonst bliebe die Liste
       leer, bis sich zufällig etwas ändert. */
    void api('kamera.stand').then(setStand).catch(app.reportError)
    void api('kamera.suche', true).then(setStand).catch(app.reportError)
    const ab = bridge.onKameraStand(setStand)
    return () => {
      ab()
      void api('kamera.suche', false).catch(() => undefined)
    }
  }, [])

  const aufDenBeamer = async (quelle: string): Promise<void> => {
    try {
      await api('projection.setMode', { mode: 'kamera', kamera: { quelle } }, app.ziel)
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  return (
    <Card title="Kameras">
      {stand.untauglich ? (
        /*
         * Kein Fehler, sondern eine Eigenschaft dieses Rechners — und darum
         * anders formuliert als eine Störung. Wer hier „Fehler" läse, suchte
         * an der Kamera.
         */
        <p className="hint">
          Auf diesem Rechner sind keine Kamerabilder zu haben. {stand.untauglich}
        </p>
      ) : (
        <>
          {kamera && (
            <div className="notice mb-3">
              <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <strong>{kamera.label ?? kurzerQuellenname(kamera.quelle)}</strong>
                <button
                  className={kamera.bauchbinde ? 'primary' : ''}
                  title={
                    kamera.bauchbinde
                      ? 'Name, Amt und Redezeit stehen im Bild, sobald jemand aufgerufen ist.'
                      : 'Das Bild bleibt ohne Beschriftung.'
                  }
                  onClick={() =>
                    void api('kamera.setBauchbinde', !kamera.bauchbinde, app.ziel).catch(app.reportError)
                  }
                >
                  {kamera.bauchbinde ? '🏷 Bauchbinde an' : '🏷 Bauchbinde aus'}
                </button>
                {/*
                  Die Spiegelung ist für den Rückblickschirm am Pult: Wer sich
                  selbst sieht, erwartet ein Spiegelbild. An der Saalwand wäre
                  dasselbe schlicht falsch herum.
                */}
                <button
                  className={kamera.spiegeln ? 'primary' : ''}
                  onClick={() =>
                    void api('kamera.setSpiegeln', !kamera.spiegeln, app.ziel).catch(app.reportError)
                  }
                >
                  {kamera.spiegeln ? '🪞 Gespiegelt' : '🪞 Normal'}
                </button>
                <button style={{ marginLeft: 'auto' }} onClick={() => setVorschau((an) => !an)}>
                  {vorschau ? 'Vorschau aus' : 'Vorschau an'}
                </button>
              </div>

              {vorschau && (
                <div className="kamera-vorschau mt-3">
                  <KameraBild camera={kamera} speaker={projection.speaker} klein />
                </div>
              )}
            </div>
          )}

          {stand.quellen.length === 0 ? (
            <p className="hint">
              Es meldet sich keine Kamera. NDI findet nur Geräte im <strong>selben Netz</strong> — ein
              Gastnetz oder ein zweites WLAN trennt sie. Und: Kameras gehören ans Kabel. Ein voller
              Bildstrom belegt über hundert Megabit je Sekunde; über dasselbe Funknetz läuft die
              Abstimmung.
            </p>
          ) : (
            <table className="liste">
              <tbody>
                {stand.quellen.map((quelle) => (
                  <tr key={quelle.name}>
                    <td>
                      <div>{kurzerQuellenname(quelle.name)}</div>
                      <div className="hint mono">{quelle.adresse ?? quelle.name}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className={kamera?.quelle === quelle.name ? 'primary' : ''}
                        onClick={() => void aufDenBeamer(quelle.name)}
                      >
                        {kamera?.quelle === quelle.name ? 'Läuft' : 'Auf den Beamer'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {stand.fehler && <p className="hint mt-3">{stand.fehler}</p>}
          {stand.sdk && <p className="hint mt-3 mono">{stand.sdk}</p>}
        </>
      )}
    </Card>
  )
}

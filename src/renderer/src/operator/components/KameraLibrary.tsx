/**
 * Die Kameras im Saal — Liste, Vorschau und der Griff zum Beamer.
 *
 * ## Wann die Suche läuft
 *
 * Sie beginnt, wenn diese Karte sichtbar wird, und läuft nach dem Weggehen
 * noch eine Minute weiter. Der erste Entwurf schaltete sie sofort ab — und
 * warf die gefundenen Quellen weg. Wer zwischen Kamerakarte, Videoliste und
 * Einstellungen blätterte, fing damit jedes Mal von vorn an und sah für ein
 * paar Sekunden eine leere Liste.
 *
 * Dahinter stand die Sorge, NDI dürfe im Saal nicht dauernd laufen. Die gilt
 * dem **Videostrom** — über hundert Megabit je Sekunde —, nicht der Suche,
 * die ein paar Pakete verschickt. Einmal gefundene Kameras bleiben deshalb
 * auch dann in der Liste, wenn gerade nicht gesucht wird; der letzte bekannte
 * Stand ist eine bessere Auskunft als nichts.
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
import type { PtzKamera } from '@shared/ptz'
import { KameraBild } from '../../projection/KameraBild'
import { api, bridge } from '../../lib/api'
import { useApp } from '../state'
import { Card } from './ui'

export function KameraLibrary(): JSX.Element {
  const app = useApp()
  const projection = app.projection
  const [stand, setStand] = useState<KameraStand>({ bereit: false, quellen: [] })
  const [vorschau, setVorschau] = useState(true)
  /*
   * Die eingerichteten Steuerungen.
   *
   * Gebraucht wird hier nur eine: die zu der Kamera, deren Bild gerade an der
   * Wand steht. Ihre Positionen gehören **in die Bedienung** und nicht in die
   * Einstellungen — „zeig mal den Saal" ist ein Griff während der
   * Versammlung, kein Einrichten davor.
   */
  const [steuerungen, setSteuerungen] = useState<PtzKamera[]>([])

  const kamera = projection.mode === 'kamera' ? projection.camera : undefined

  useEffect(() => {
    /* Erst den letzten Stand holen, dann zuhören — sonst bliebe die Liste
       leer, bis sich zufällig etwas ändert. */
    void api('kamera.stand').then(setStand).catch(app.reportError)
    void api('kamera.suche', true).then(setStand).catch(app.reportError)
    void api('ptz.liste').then(setSteuerungen).catch(() => undefined)
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
            <div className="notice mb-3 kamera-bedienung">
              {/*
                Drei Zeilen statt einer Reihe.

                Vorher hingen fünf Knöpfe nebeneinander, einer davon mit
                `margin-left: auto` — beim Umbrechen riss das eine Lücke, und
                „Vorschau" stand allein auf einer Zeile. Jetzt trennt die
                Gliederung, was verschieden ist: **welche Kamera**, was sie
                **im Bild** zeigt, und **wohin** sie schaut.
              */}
              <div className="kamera-kopf">
                <strong>{kamera.label ?? kurzerQuellenname(kamera.quelle)}</strong>
                <button className="ghost" onClick={() => setVorschau((an) => !an)}>
                  {vorschau ? 'Vorschau aus' : 'Vorschau an'}
                </button>
              </div>

              {/*
                Alles, was der Saal zusätzlich zum Bild sieht — Beschriftung,
                Reihe, Seitenrichtung. Drei Schalter mit derselben Wirkung auf
                dieselbe Fläche, deshalb in einer Gruppe.
              */}
              <div className="kamera-zeile">
                <span className="kamera-zeile-titel">Im Bild:</span>
                <button
                  className={kamera.bauchbinde ? 'primary' : ''}
                  aria-pressed={kamera.bauchbinde}
                  title={
                    kamera.bauchbinde
                      ? 'Name, Amt und Redezeit stehen im Bild, sobald jemand aufgerufen ist.'
                      : 'Das Bild bleibt ohne Beschriftung.'
                  }
                  onClick={() =>
                    void api('kamera.setBauchbinde', !kamera.bauchbinde, app.ziel).catch(app.reportError)
                  }
                >
                  {/* Der Zustand steht im Wort, nicht nur in der Farbe: Wer im
                      Saal kurz hinsieht, liest schneller, als er vergleicht. */}
                  {kamera.bauchbinde ? '🏷 Bauchbinde an' : '🏷 Bauchbinde aus'}
                </button>
                {/*
                  Getrennt von der Bauchbinde: Der Name dessen, der spricht,
                  gehört fast immer ins Bild; die Reihe dahinter nicht immer —
                  bei einem Grußwort gibt es keine.
                */}
                <button
                  className={kamera.naechste ? 'primary' : ''}
                  aria-pressed={kamera.naechste}
                  title={
                    kamera.naechste
                      ? 'Die nächsten Redner stehen im Bild.'
                      : 'Die Reihe der nächsten Redner bleibt aus.'
                  }
                  onClick={() =>
                    void api('kamera.setNaechste', !kamera.naechste, app.ziel).catch(app.reportError)
                  }
                >
                  {kamera.naechste ? '📋 Nächste an' : '📋 Nächste aus'}
                </button>
                {/*
                  Die Spiegelung ist für den Rückblickschirm am Pult: Wer sich
                  selbst sieht, erwartet ein Spiegelbild. An der Saalwand wäre
                  dasselbe schlicht falsch herum.
                */}
                <button
                  className={kamera.spiegeln ? 'primary' : ''}
                  aria-pressed={kamera.spiegeln}
                  title={
                    kamera.spiegeln
                      ? 'Seitenverkehrt — für den Rückblickschirm am Pult.'
                      : 'Seitenrichtig, wie es der Saal sieht.'
                  }
                  onClick={() =>
                    void api('kamera.setSpiegeln', !kamera.spiegeln, app.ziel).catch(app.reportError)
                  }
                >
                  {kamera.spiegeln ? '🪞 Gespiegelt' : '🪞 Normal'}
                </button>
              </div>

              {/*
                Die Positionen der Kamera, die gerade läuft.

                Erscheinen nur, wenn zu ihrem Bild eine Steuerung eingerichtet
                ist — und dann genau hier, wo während der Versammlung
                hingesehen wird.
              */}
              {(() => {
                const steuerung = steuerungen.find(
                  (eintrag) => eintrag.enabled && eintrag.quelle === kamera.quelle
                )
                if (!steuerung || steuerung.positionen.length === 0) return null
                return (
                  <div className="kamera-zeile">
                    <span className="kamera-zeile-titel">Position:</span>
                    {steuerung.positionen.map((position) => (
                      <button
                        key={position.nummer}
                        title={`${steuerung.name} auf „${position.name}" fahren`}
                        onClick={() =>
                          void api('ptz.position', {
                            id: steuerung.id,
                            nummer: position.nummer
                          }).catch(app.reportError)
                        }
                      >
                        {position.name}
                      </button>
                    ))}
                  </div>
                )
              })()}

              {/*
                Was im Bild stünde, steht auch hier.

                Die Vorstellung überlebt einen Ansichtswechsel — richtig so,
                eine Redezeit gehört zur Person und nicht zur Ansicht. Für das
                Kamerabild heißt das aber: Die Bauchbinde kann den nennen, der
                zuletzt gesprochen hat, während längst der Saal zu sehen ist.
                Wer das hier liest, entdeckt es nicht erst an der Wand.
              */}
              {(kamera.bauchbinde || kamera.naechste) && (
                <p className="hint">
                  {projection.speaker
                    ? `Im Bild steht: ${projection.speaker.name}`
                    : 'Es ist niemand aufgerufen — im Bild steht nichts.'}
                </p>
              )}

              {vorschau && (
                <div className="kamera-vorschau mt-3">
                  <KameraBild camera={kamera} speaker={projection.speaker} klein />
                </div>
              )}
            </div>
          )}

          {stand.quellen.length === 0 ? (
            <p className="hint">
              {stand.sucht ? 'Es meldet sich keine Kamera.' : 'Die Suche läuft an …'} NDI findet nur
              Geräte im <strong>selben Netz</strong> — ein Gastnetz oder ein zweites WLAN trennt sie.
              Und: Kameras gehören ans Kabel. Ein voller Bildstrom belegt über hundert Megabit je
              Sekunde; über dasselbe Funknetz läuft die Abstimmung.
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

          {/*
            Einmal gefundene Quellen bleiben stehen, auch wenn die Suche
            ausgelaufen ist — der letzte bekannte Stand ist eine bessere
            Auskunft als eine leere Liste. Gesagt werden muss es trotzdem.
          */}
          {!stand.sucht && stand.quellen.length > 0 && (
            <p className="hint mt-3">Zuletzt gefunden; die Suche läuft gerade nicht.</p>
          )}
          {stand.fehler && <p className="hint mt-3">{stand.fehler}</p>}
          {stand.sdk && <p className="hint mt-3 mono">{stand.sdk}</p>}
          {/*
            Die Lizenz des NDI-SDK verlangt, dass bei jeder Verwendung der
            Marke klar gesagt wird, dass es eine Marke ist — und dass nichts
            den Eindruck erweckt, das Programm komme von NDI.
          */}
          <p className="hint">NDI® ist eine eingetragene Marke der Vizrt NDI AB.</p>
        </>
      )}
    </Card>
  )
}

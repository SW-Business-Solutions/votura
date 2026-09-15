/**
 * Das Sprachmodell für Prompter und Untertitel.
 *
 * Eines liegt bei; wer mehr braucht — starker Dialekt, halliger Saal,
 * Untertitel statt bloßem Mitlaufen —, legt ein größeres darüber. Das geht
 * auf zwei Wegen, und beide stehen hier, weil es dieselbe Frage ist: Womit
 * hört Votura zu?
 *
 * **Nachladen aus dem Netz** ist der neue Weg. Er ist kein Bruch mit dem
 * Grundsatz, dass Votura offline läuft: Geladen wird nur auf Klick, nur aus
 * einer festen Liste, und wer den Rechner nie ans Netz hängt, bekommt davon
 * nichts zu sehen außer einem Knopf, der nicht antwortet.
 */
import { useEffect, useState } from 'react'
import type { SprachmodellInfo } from '@shared/sprachmodell'
import {
  BEKANNTE_MODELLE,
  MODELL_QUELLE,
  type ModellLadestand
} from '@shared/sprachmodell-angebot'
import { api, bridge } from '../../lib/api'
import { useApp } from '../state'
import { Card } from '../components/ui'

function megabyte(bytes?: number): string {
  if (!bytes) return '–'
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export function SprachmodellEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [modell, setModell] = useState<SprachmodellInfo | null>(null)
  const [laden, setLaden] = useState<ModellLadestand | null>(null)

  useEffect(() => {
    void api('speechmodel.info').then(setModell).catch(app.reportError)
    return bridge.onSpeechmodelProgress(setLaden)
  }, [])

  const rufe = async (tun: () => Promise<SprachmodellInfo>): Promise<void> => {
    try {
      setModell(await tun())
    } catch (error) {
      app.reportError(error)
    }
  }

  const holen = async (datei: string): Promise<void> => {
    setLaden({ datei, geladen: 0, bytes: 0 })
    try {
      setModell(await api('speechmodel.download', datei))
      app.notify('info', 'Sprachmodell geladen und geprüft.')
    } catch (error) {
      app.reportError(error)
    } finally {
      setLaden(null)
    }
  }

  const darf = app.can('system.manage')
  const beschaeftigt = laden !== null

  return (
    <>
      <Card title="Sprachmodell für Prompter und Untertitel">
        <p className="hint">
          Zwei Dinge in Votura hören zu: Am Pult folgt der Redetext auf Wunsch dem Gesprochenen, und an der
          Wand lassen sich Untertitel einblenden. Beides braucht ein Sprachmodell. Es arbeitet vollständig
          auf dem Gerät: Aufgenommen wird nichts, und nichts verlässt den Rechner.
        </p>

        {!modell ? (
          <p className="hint">Wird geladen …</p>
        ) : modell.vorhanden ? (
          <>
            <div className="mono">{modell.name}</div>
            <div className="hint">
              {megabyte(modell.bytes)} ·{' '}
              {modell.herkunft === 'paket' ? 'mit der Anwendung geliefert' : 'selbst hinterlegt'}
            </div>
          </>
        ) : (
          <div className="notice warn">
            Kein Sprachmodell hinterlegt. „Nach Stimme" bleibt am Pult ohne Wirkung, und Untertitel bleiben
            leer; der Redetext läuft dann gleichmäßig oder wird von Hand bewegt.
          </div>
        )}

        <div className="row mt-3">
          <button disabled={!darf || beschaeftigt} onClick={() => void rufe(() => api('speechmodel.install'))}>
            Eigenes Modell hinterlegen …
          </button>
          {modell?.herkunft === 'eigen' && (
            <button
              className="danger"
              disabled={!darf || beschaeftigt}
              onClick={() => void rufe(() => api('speechmodel.remove'))}
            >
              Eigenes Modell entfernen
            </button>
          )}
        </div>
        <div className="hint">
          Erwartet wird ein Modellarchiv (.zip oder .tar.gz). Es wird kopiert, nicht verknüpft — der Stick,
          von dem es kam, ist im Saal längst wieder in der Tasche.
        </div>
      </Card>

      {/*
        Die zweite Karte, nicht dieselbe.
        Von Hand hinterlegen und aus dem Netz holen führen zum selben
        Ergebnis, sind aber verschiedene Entscheidungen — die eine braucht
        einen Stick, die andere eine Leitung nach draußen. Zwischen zwölf
        Knöpfen in einer Karte wäre der Unterschied verschwunden.
      */}
      <Card title="Bekanntes Modell nachladen">
        <p className="hint">
          Diese Modelle kommen von <span className="mono">{MODELL_QUELLE}</span>, dem Anbieter der
          Erkennung. Geladen wird <strong>nur auf Klick</strong> — Votura fragt nichts von selbst ab, weder
          beim Start noch im Hintergrund. Dafür braucht dieser Rechner einmalig eine Verbindung ins
          Internet; im Saal danach nie wieder.
        </p>

        <table className="mt-3 modell-tabelle">
          <thead>
            <tr>
              <th>Modell</th>
              <th>Größe</th>
              <th>Geprüft</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {BEKANNTE_MODELLE.map((angebot) => {
              const dran = laden?.datei === angebot.datei
              const anteil =
                dran && laden.bytes > 0 ? Math.round((laden.geladen / laden.bytes) * 100) : 0
              return (
                <tr key={angebot.datei}>
                  <td>
                    <strong>{angebot.name}</strong>
                    <div className="hint">{angebot.hinweis}</div>
                    <div className="mono hint">{angebot.datei}</div>
                  </td>
                  <td>{megabyte(angebot.bytes)}</td>
                  <td>
                    {/*
                      Zurzeit trägt jeder Eintrag eine Prüfsumme. Die Spalte
                      bleibt trotzdem: Käme je einer ohne dazu, gehört das
                      hierhin und nicht ins Kleingedruckte. Eine erfundene
                      Prüfsumme wäre schlimmer als keine — sie behauptete
                      eine Sicherheit, die es nicht gibt.
                    */}
                    {angebot.sha256 ? (
                      <span title={angebot.sha256}>Größe und Prüfsumme</span>
                    ) : (
                      <span className="warn" title="Für dieses Archiv ist keine Prüfsumme hinterlegt.">
                        nur Größe
                      </span>
                    )}
                  </td>
                  <td>
                    {dran ? (
                      <span className="mono">
                        {laden.bytes > 0 ? `${anteil} %` : 'verbindet …'}
                      </span>
                    ) : (
                      <button
                        disabled={!darf || beschaeftigt}
                        onClick={() => void holen(angebot.datei)}
                      >
                        Laden
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="hint mt-3">
          Das geladene Archiv ersetzt ein zuvor hinterlegtes — es gilt immer genau eines. Geprüft wird vor
          dem Tausch: Bricht die Leitung nach vierzig von fünfzig Megabyte ab, bleibt das vorhandene Modell
          unangetastet.
        </div>
        <div className="hint">
          <strong>Warum kein großes Modell?</strong> Weil die Erkennung es nicht laden kann. Sie läuft in
          WebAssembly und packt das Archiv in einen einzigen Speicherblock aus; bei zwei Gigabyte bricht das
          ab, und die Wand bliebe leer. Ausprobiert — der Knopf hätte zwei Gigabyte geladen und danach
          zuverlässig nichts getan.
        </div>
        <div className="hint">
          Für den <strong>Prompter</strong> genügt das Kleine ohnehin: Er muss nicht diktieren, sondern im
          bekannten Text die Stelle wiederfinden. Für <strong>Untertitel</strong> bleibt es damit bei dem,
          was ein kleines Modell hergibt — verständlich, aber nicht wörtlich. Wenn eine Stimme schlecht
          erkannt wird, ist das zweite kleine Modell der Versuch, der hier möglich ist.
        </div>
      </Card>
    </>
  )
}

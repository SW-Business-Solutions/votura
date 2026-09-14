/**
 * Die Netzwerkansicht einrichten.
 *
 * Bewusst in den Einstellungen und nicht in der Beamersteuerung: Port, Token
 * und Freigaben stellt man einmal ein, bevor die Versammlung beginnt. Während
 * der Versammlung braucht man die Adresse zum Ablesen — die steht weiterhin
 * unter Beamer → Ausgabe & Netz.
 */
import { useEffect, useState } from 'react'
import type { NetworkProjectionStatus } from '@shared/ipc'
import { AUSSCHUSS_PFAD, WAHL_PFAD } from '@shared/wahl'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

export function NetzwerkEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [status, setStatus] = useState<NetworkProjectionStatus | null>(null)

  useEffect(() => {
    void api('projection.network').then(setStatus).catch(app.reportError)
  }, [])

  if (!status) return <Card title="Beamer im Netzwerk">Wird geladen …</Card>
  /* Die Abschnitte sind eigene Karten — eine Karte mit sechs Überschriften
     darin war eine Liste, durch die man scrollt, keine Gliederung. */
  return <NetworkSection status={status} onChange={setStatus} />
}

function NetworkSection({
  status,
  onChange
}: {
  status: NetworkProjectionStatus
  onChange: (status: NetworkProjectionStatus) => void
}): React.JSX.Element {
  const app = useApp()
  const [enabled, setEnabled] = useState(status.enabled)
  const [port, setPort] = useState(status.port)
  const [token, setToken] = useState(status.token)
  const [lanWide, setLanWide] = useState(status.bindAddress !== '127.0.0.1')
  const [bindAddress, setBindAddress] = useState(status.bindAddress)
  const [allowRemoteOperator, setAllowRemoteOperator] = useState(status.allowRemoteOperator)
  const [allowPrompterControl, setAllowPrompterControl] = useState(status.allowPrompterControl)
  const [tls, setTls] = useState(status.tls)
  /*
   * Welche Netzwerkkarte das Saalnetz ist.
   *
   * Bei Hyper-V, WSL oder einem VPN stecken schnell vier im Rechner, und nur
   * eine führt zu den Telefonen. Vorher war die Wahl „nur dieser Rechner"
   * oder „alle" — und alles Weitere, von den angezeigten Adressen bis zum
   * Namensdienst, riet sich die erste zusammen.
   */
  const [karten, setKarten] = useState<{ name: string; adresse: string; virtuell: boolean }[]>([])

  useEffect(() => {
    void api('system.netzwerkkarten').then(setKarten).catch(app.reportError)
  }, [])

  const save = async (): Promise<void> => {
    try {
      const next = await api('projection.setNetwork', {
        enabled,
        port,
        bindAddress: lanWide ? bindAddress : '127.0.0.1',
        token,
        tls,
        allowRemoteOperator,
        allowPrompterControl
      })
      onChange(next)
      app.notify(
        next.running ? 'ok' : 'info',
        next.running ? 'Netzwerkansicht läuft.' : 'Netzwerkansicht deaktiviert.'
      )
    } catch (error) {
      app.reportError(error)
    }
  }

  /*
   * Eine Adresse je Netzwerkkarte — auf einem Rechner mit Hyper-V, WSL oder
   * VPN sind das schnell fünf. Die Geräte im Saal erreichen genau eine davon,
   * und welche, sieht man ihr nicht an. Der Hinweis steht deshalb dabei,
   * statt dass jemand sie im Saal durchprobiert.
   */
  const mehrereAdressen = status.urls.filter((url) => !url.includes('127.0.0.1')).length > 1

  /**
   * Eine Adresse für eine andere Seite desselben Servers — mitsamt Token.
   *
   * Das Token gehört zwingend dazu: Ohne es lädt das Gerüst der Seite, aber
   * keines ihrer Skripte, denn die trägt der Browser ohne Abfrage nach. Auf
   * dem Gerät bleibt dann eine schwarze Fläche ohne Meldung.
   */
  const seitenAdresse = (url: string, pfad: string): string => {
    const [ohneFrage, frage] = url.split('?')
    return `${ohneFrage.replace(/\/$/, '')}${pfad}${frage ? `?${frage}` : ''}`
  }

  return (
    <>
      <Card title="Beamer im Netzwerk">
        {!app.can('system.manage') && (
          <div className="notice warn">
            Das Zugriffstoken wird nur der Systemverwaltung angezeigt — es ist kein Anzeigewert, sondern ein
            Schlüssel: Wer es hat, kommt an Beameransicht und Wahlseite. Ändern lässt sich hier ohnehin
            nichts; die Angaben stehen zum Nachsehen.
          </div>
        )}
        <p className="hint">
          Zeigt dieselbe Beameransicht im Browser eines anderen Geräts im Veranstaltungsnetz an –
          ausschließlich lesend, ohne Bedienelemente. Standardmäßig deaktiviert; nur in einem abgeschotteten
          lokalen Netz verwenden.
        </p>
        <Checkbox checked={enabled} onChange={setEnabled} label="Netzwerkansicht aktivieren" />
        <div className="row">
          <div className="col-mittel">
            <Field label="Port">
              <NumberInput value={port} min={1024} max={65535} onChange={setPort} />
            </Field>
          </div>
          <div className="col">
            <Field label="Zugriffstoken" hint="Leer = ohne Token (nur in vollständig abgeschotteten Netzen).">
              <input value={token} onChange={(e) => setToken(e.target.value)} />
            </Field>
          </div>
          <button
            onClick={() =>
              setToken(Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6))
            }
          >
            Token erzeugen
          </button>
        </div>
        <Field
          label="Netzwerkkarte für das Saalnetz"
          hint={
            'Gilt für die Beameransicht, die Bedienung, die Wahlseite und die Netzdienste darunter. ' +
            'Eine feste Karte ist genauer als „alle“ — und im Zweifel die, an der auch die Telefone hängen.'
          }
        >
          <select
            value={lanWide ? bindAddress : '127.0.0.1'}
            onChange={(ereignis) => {
              const wert = ereignis.target.value
              setLanWide(wert !== '127.0.0.1')
              setBindAddress(wert)
            }}
          >
            <option value="127.0.0.1">Nur dieser Rechner — kein Zugriff aus dem Netz</option>
            <option value="0.0.0.0">Alle Netzwerkkarten</option>
            {karten.map((karte) => (
              <option key={karte.adresse} value={karte.adresse}>
                {karte.name} — {karte.adresse}
                {karte.virtuell ? ' (virtuell, im Saal nicht erreichbar)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="Verschlüsselte Übertragung">
        <p className="hint">
          Ohne sie reisen alle Inhalte im Klartext durch das Saalnetz — bei einer{' '}
          <strong>digitalen Abstimmung</strong> also auch die Stimme, zusammen mit der Adresse des Geräts. Bei
          WLAN mit gemeinsamem Passwort kann jeder Teilnehmer den Verkehr jedes anderen entschlüsseln. Für
          Abstimmungen ist die Verschlüsselung deshalb Pflicht, nicht Zierde.
        </p>
        <p className="hint">
          Votura stellt das Zertifikat selbst aus. Gegen <strong>Mitlesen</strong> hilft das vollständig. Gegen
          einen aktiven Angreifer nur dort, wo das Gerät den Fingerabdruck kennt — auf mitgebrachten Telefonen
          erscheint eine Warnung. Das ist der Grund, warum für geheime Wahlen Wahlkabinen empfohlen sind: Die
          gehören der Veranstaltung.
        </p>
        <Checkbox
          checked={tls}
          onChange={setTls}
          label="Verschlüsselt ausliefern (HTTPS mit selbst ausgestelltem Zertifikat)"
        />
        {status.fingerabdruck && (
          <Field
            label="Fingerabdruck des Zertifikats"
            hint="Zum Vorlesen, wenn ein Gerät nachfragt — bei einem selbst ausgestellten Zertifikat ist sein Vergleich die einzige Prüfung, die ein Mensch hat."
          >
            <div className="mono" style={{ wordBreak: 'break-all', fontSize: '13px' }}>
              {status.fingerabdruck}
            </div>
          </Field>
        )}
      </Card>

      <Card title="Bedienung von einem zweiten Gerät">
        <p className="hint">
          Zusätzlich zur Beameransicht kann die vollständige Bedienoberfläche im Browser eines anderen Geräts
          geöffnet werden — unter der Adresse mit dem Zusatz <span className="mono">/operator</span>. Dort ist
          eine Anmeldung mit einem lokalen Konto nötig; es gelten dieselben Rollen und Rechte, und jede Aktion
          landet mit dem jeweiligen Benutzer im Audit-Trail. Systemdialoge (Ordnerwahl, Backup-Ziel) bleiben
          dem Hauptrechner vorbehalten.
        </p>
        <p className="hint">
          Auf diesem Weg laufen auch die Geräteklassen <strong>Akkreditierung</strong> und{' '}
          <strong>Ausgabe</strong> in Votura Saal. Sie bauen nichts nach — es ist dieselbe Oberfläche mit
          derselben Anmeldung.
        </p>
        <Checkbox
          checked={allowRemoteOperator}
          onChange={setAllowRemoteOperator}
          label="Anmeldung und Bedienung über das Netz erlauben"
        />
        {allowRemoteOperator && !tls && (
          <div className="notice warn">
            Die Verbindung ist unverschlüsselt (HTTP): Anmeldedaten und alles Weitere reisen im Klartext. Nur
            in einem abgeschotteten Veranstaltungsnetz verwenden — oder oben die Verschlüsselung einschalten.
          </div>
        )}
      </Card>

      <Card title="Bedienung der Prompteransicht">
        <p className="hint">
          Die Prompteransicht (<span className="mono">/prompter</span>) zeigt normalerweise nur an. Wer am Pult
          steht, hat aber oft ein Tablet vor sich und niemanden am Board — dann muss eine Verhaspelung dort zu
          beheben sein. Freigegeben wird ausschließlich das eigene Manuskript: anhalten, weiterlaufen, eine
          Stelle zurück, Tempo, Schriftgröße, Umschalten auf die Folien. An Wahldaten kommt diese Freigabe
          nicht heran; eine Anmeldung braucht sie deshalb auch nicht.
        </p>
        <Checkbox
          checked={allowPrompterControl}
          onChange={setAllowPrompterControl}
          label="Bedienung am Pult über das Netz erlauben"
        />
      </Card>

      <Card tight>
        <div className="row">
          <button className="primary" onClick={() => void save()}>
            Übernehmen
          </button>
          <div className="hint">Gilt für alle Angaben auf dieser Seite.</div>
        </div>
        {status.error && <div className="notice error mt-2">{status.error}</div>}
      </Card>

      {status.running && status.urls.length > 0 && (
        <Card title="Adressen für die Geräte im Saal">
          {mehrereAdressen && (
            <p className="hint">
              Dieser Rechner hat mehrere Netzwerkkarten — etwa durch Hyper-V, WSL oder ein VPN. Erreichbar ist
              für die Geräte im Saal nur die Adresse aus <strong>deren</strong> Netz; die übrigen führen ins
              Leere. Im Zweifel die des WLANs nehmen, in dem auch die Telefone hängen.
            </p>
          )}
          <label>Beameransicht</label>
          {status.urls.map((url) => (
            <div key={url} className="mono">
              {url}
            </div>
          ))}
          {/*
           * Eine Adresse je Bühne.
           *
           * Ein Gerät im Saal wählt seine Bühne über die Adresse — `/b/2`
           * neben dem zweiten Beamer, und es zeigt bis zum Schluss genau das,
           * was dort hingehört.
           */}
          {app.buehnen.length > 1 && (
            <>
              <label className="mt-3">Einzelne Bühnen</label>
              {app.buehnen.map((stage) => (
                <div key={`b-${stage.id}`} className="mono">
                  {seitenAdresse(status.urls[0], `/b/${stage.id}`)} — {stage.name}
                </div>
              ))}
            </>
          )}
          {status.allowRemoteOperator && (
            <>
              <label className="mt-3">Bedienung, Akkreditierung, Ausgabe (Anmeldung erforderlich)</label>
              {status.urls.map((url) => (
                <div key={`op-${url}`} className="mono">
                  {seitenAdresse(url, '/operator')}
                </div>
              ))}
            </>
          )}
          <label className="mt-3">Stimmabgabe und Wahlausschuss</label>
          <div className="mono">{seitenAdresse(status.urls[0], WAHL_PFAD)}</div>
          <div className="mono">{seitenAdresse(status.urls[0], AUSSCHUSS_PFAD)}</div>
          <div className="hint">
            Die Wahlseite bekommt jedes Telefon im Saalnetz; der Wahlausschuss gehört auf ein Gerät, das
            niemand sonst bedient.
          </div>
        </Card>
      )}
    </>
  )
}

/**
 * Echtes Zertifikat und die Netzdienste im Saal.
 *
 * Drei Dinge, die zusammen eine Frage beantworten: **Wie kommt ein
 * mitgebrachtes Telefon ohne Warnung an die Wahlseite?**
 *
 * 1. Ein Zertifikat, für das eine öffentliche Stelle bürgt — und die bürgt
 *    nur für einen Namen, nie für `192.168.1.5`.
 * 2. Ein Namensdienst, der diesen Namen im Saal beantwortet. Ohne ihn kennt
 *    ihn dort niemand, denn ein abgeschottetes Netz erreicht das öffentliche
 *    Namensystem nicht.
 * 3. Eine Adressvergabe, die den Geräten sagt, wen sie fragen sollen — nur
 *    dort, wo Votura das Netz selbst aufspannt.
 */
import { useEffect, useState } from 'react'
import type { SaalnetzStatus } from '@shared/ipc'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

export function SaalnetzEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [stand, setStand] = useState<SaalnetzStatus | null>(null)

  useEffect(() => {
    void api('saalnetz.get').then(setStand).catch(app.reportError)
  }, [])

  if (!stand) return <Card title="Saalnetz">Wird geladen …</Card>
  return (
    <>
      <ZertifikatKarte />
      <NetzdiensteKarte stand={stand} aufStand={setStand} />
    </>
  )
}

/* ----------------------------------------------------------- Zertifikat */

function ZertifikatKarte(): React.JSX.Element {
  const app = useApp()
  const eigenes = app.settings?.eigenesZertifikat
  const [domain, setDomain] = useState('')
  const [email, setEmail] = useState('')
  const [uebung, setUebung] = useState(true)
  const [offen, setOffen] = useState<{ name: string; wert: string; faden: string } | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const beginnen = async (): Promise<void> => {
    setLaeuft(true)
    try {
      const auftrag = await api('cert.acmeBeginnen', { domain, email, uebung })
      setOffen({ ...auftrag.eintrag, faden: auftrag.faden })
    } catch (fehler) {
      app.reportError(fehler)
    } finally {
      setLaeuft(false)
    }
  }

  const abschliessen = async (): Promise<void> => {
    if (!offen) return
    setLaeuft(true)
    try {
      const angaben = await api('cert.acmeAbschliessen', offen.faden)
      setOffen(null)
      await app.refreshSettings()
      app.notify(
        'ok',
        `Zertifikat für ${angaben.domain} ausgestellt, gültig bis ${new Date(angaben.laeuftAbAm).toLocaleDateString('de-DE')}.`
      )
    } catch (fehler) {
      app.reportError(fehler)
    } finally {
      setLaeuft(false)
    }
  }

  const ausDateien = async (): Promise<void> => {
    try {
      const certPfad = await api('system.chooseFile', {
        titel: 'Zertifikat auswählen (PEM)',
        endungen: ['pem', 'crt', 'cer']
      })
      if (!certPfad) return
      const keyPfad = await api('system.chooseFile', {
        titel: 'Zugehörigen Schlüssel auswählen (PEM)',
        endungen: ['pem', 'key']
      })
      if (!keyPfad) return
      const angaben = await api('cert.ausDateien', { certPfad, keyPfad })
      await app.refreshSettings()
      app.notify('ok', `Zertifikat für ${angaben.domain} hinterlegt.`)
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const entfernen = async (): Promise<void> => {
    try {
      await api('cert.entfernen')
      await app.refreshSettings()
      app.notify('info', 'Es gilt wieder das selbst ausgestellte Zertifikat.')
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const restTage = eigenes
    ? Math.floor((new Date(eigenes.laeuftAbAm).getTime() - Date.now()) / 86400000)
    : 0

  return (
    <Card title="Echtes Zertifikat">
      <p className="hint">
        Ein Zertifikat gilt, weil eine öffentliche Stelle für einen <strong>Namen</strong> bürgt. Für eine
        Adresse wie <span className="mono">192.168.1.5</span> bürgt niemand — deshalb warnt jedes
        mitgebrachte Telefon beim selbst ausgestellten Zertifikat. Wer eine eigene Domain besitzt, kommt da
        heraus: <span className="mono">saal.mein-verband.de</span> zeigt auf diesen Rechner, und für diesen
        Namen stellt Let&apos;s Encrypt aus.
      </p>

      {eigenes ? (
        <>
          <div className={`notice mt-2 ${restTage < 14 ? 'warn' : 'ok'}`}>
            Hinterlegt für <strong>{eigenes.domain}</strong>, gültig bis{' '}
            {new Date(eigenes.laeuftAbAm).toLocaleDateString('de-DE')}
            {restTage < 14
              ? ` — nur noch ${restTage} ${restTage === 1 ? 'Tag' : 'Tage'}. Vor der nächsten Versammlung erneuern.`
              : ` (noch ${restTage} Tage).`}
          </div>
          <div className="row mt-2">
            <button onClick={() => void ausDateien()}>Anderes Zertifikat hinterlegen</button>
            <button onClick={() => void entfernen()}>Entfernen</button>
          </div>
        </>
      ) : offen ? (
        <>
          <div className="notice warn mt-2">
            Jetzt ist der Mensch an der Reihe: Diesen Eintrag beim DNS-Anbieter anlegen und{' '}
            <strong>warten, bis er übernommen ist</strong> — je nach Anbieter Minuten. Zu früh geprüft zählt
            als Fehlversuch, und davon erlaubt die Prüfstelle nur wenige je Stunde.
          </div>
          <Field label="Art des Eintrags">
            <input value="TXT" readOnly />
          </Field>
          <Field label="Name">
            <input value={offen.name} readOnly onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <Field label="Wert">
            <input value={offen.wert} readOnly onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="row mt-2">
            <button className="primary" disabled={laeuft} onClick={() => void abschliessen()}>
              {laeuft ? 'Wird geprüft …' : 'Eintrag steht — jetzt prüfen lassen'}
            </button>
            <button disabled={laeuft} onClick={() => setOffen(null)}>
              Abbrechen
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row mt-2">
            <div className="col">
              <Field label="Name" hint="Der A-Eintrag dieses Namens muss auf die Adresse dieses Rechners zeigen.">
                <input
                  value={domain}
                  placeholder="saal.mein-verband.de"
                  onChange={(e) => setDomain(e.target.value)}
                />
              </Field>
            </div>
            <div className="col">
              <Field label="E-Mail" hint="Die Prüfstelle warnt darüber vor dem Ablauf.">
                <input value={email} placeholder="vorstand@mein-verband.de" onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          </div>
          <Checkbox
            checked={uebung}
            onChange={setUebung}
            label="Übungsumgebung verwenden (Zertifikat ist wertlos, aber der Ablauf lässt sich gefahrlos proben)"
          />
          <p className="hint">
            Die echte Prüfstelle erlaubt nur wenige Fehlversuche je Stunde. Wer den Ablauf zum ersten Mal
            geht, probt ihn hier — sonst steht er womöglich am Versammlungstag vor einer Sperre.
          </p>
          <div className="row mt-2">
            <button className="primary" disabled={laeuft || !domain || !email} onClick={() => void beginnen()}>
              {laeuft ? 'Auftrag läuft …' : 'Zertifikat beantragen'}
            </button>
            <button onClick={() => void ausDateien()}>Vorhandenes aus Dateien laden</button>
          </div>
          <p className="hint">
            Für den Auftrag braucht dieser Rechner <strong>einmalig</strong> Zugang zum Internet — im Saal
            später nicht mehr. Das Zertifikat gilt 90 Tage und liegt danach als Datei hier.
          </p>
        </>
      )}
    </Card>
  )
}

/* --------------------------------------------------------- Netzdienste */

function NetzdiensteKarte({
  stand,
  aufStand
}: {
  stand: SaalnetzStatus
  aufStand: (stand: SaalnetzStatus) => void
}): React.JSX.Element {
  const app = useApp()
  const [entwurf, setEntwurf] = useState(stand)
  const eigenes = app.settings?.eigenesZertifikat

  const speichern = async (): Promise<void> => {
    try {
      const neu = await api('saalnetz.set', {
        dns: entwurf.dns,
        dnsWeiterleitung: entwurf.dnsWeiterleitung,
        dhcp: entwurf.dhcp,
        dhcpVon: entwurf.dhcpVon,
        dhcpBis: entwurf.dhcpBis,
        dhcpMaske: entwurf.dhcpMaske,
        dhcpRouter: entwurf.dhcpRouter,
        dhcpLaufzeit: entwurf.dhcpLaufzeit
      })
      aufStand(neu)
      setEntwurf(neu)
      if (neu.fehler) app.notify('warning', neu.fehler)
      else app.notify('ok', 'Netzdienste übernommen.')
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  return (
    <Card title="Namensdienst und Adressvergabe">
      <p className="hint">
        Nur für den Aufbau, in dem Votura das Saalnetz selbst aufspannt. Steht ein Router der Location im
        Netz, gehören diese Einstellungen dorthin — und hier bleibt alles aus.
      </p>

      <h3>Namensdienst</h3>
      <p className="hint">
        Beantwortet im Saalnetz genau einen Namen: den des hinterlegten Zertifikats, mit der Adresse dieses
        Rechners. Ohne ihn kennt im Saal niemand diesen Namen, denn ein abgeschottetes Netz erreicht das
        öffentliche Namensystem nicht.
      </p>
      {!eigenes && (
        <div className="notice warn">
          Es ist kein eigenes Zertifikat hinterlegt — der Namensdienst wüsste nicht, welchen Namen er
          beantworten soll.
        </div>
      )}
      <Checkbox
        checked={entwurf.dns}
        onChange={(wert) => setEntwurf({ ...entwurf, dns: wert })}
        label={`Namensdienst betreiben${eigenes ? ` (für ${eigenes.domain})` : ''}`}
      />
      <Field
        label="Weiterleitung für alles Übrige"
        hint="Leer: Es gilt der eine Name und sonst nichts — die Gäste sind dann ohne Internet, und manche Telefone verlassen ein WLAN, in dem nichts geht."
      >
        <input
          value={entwurf.dnsWeiterleitung}
          placeholder="192.168.50.254 (Router)"
          onChange={(e) => setEntwurf({ ...entwurf, dnsWeiterleitung: e.target.value })}
        />
      </Field>
      {entwurf.dnsWeiterleitung && (
        <p className="hint">
          Mit Weiterleitung sieht dieser Rechner, welche Namen die Geräte im Saal abfragen.{' '}
          <strong>Aufgezeichnet wird nichts</strong> — kein Protokoll, keine Datei —, aber es geht hier
          durch. Wer das nicht will, lässt das Feld leer.
        </p>
      )}

      <h3>Adressvergabe</h3>
      <div className="notice warn">
        <strong>Nur in einem Netz, das Votura selbst aufspannt.</strong> Ein zweiter Adressverteiler legt ein
        fremdes Netz lahm — mitten in der Versammlung, und niemand weiß, warum. Votura hört vor dem Start
        hin und verweigert den Dienst, wenn bereits jemand verteilt.
      </div>
      <Checkbox
        checked={entwurf.dhcp}
        onChange={(wert) => setEntwurf({ ...entwurf, dhcp: wert })}
        label="Adressen vergeben"
      />
      <div className="row">
        <div className="col">
          <Field label="Von">
            <input value={entwurf.dhcpVon} onChange={(e) => setEntwurf({ ...entwurf, dhcpVon: e.target.value })} />
          </Field>
        </div>
        <div className="col">
          <Field label="Bis">
            <input value={entwurf.dhcpBis} onChange={(e) => setEntwurf({ ...entwurf, dhcpBis: e.target.value })} />
          </Field>
        </div>
        <div className="col">
          <Field label="Netzmaske">
            <input
              value={entwurf.dhcpMaske}
              onChange={(e) => setEntwurf({ ...entwurf, dhcpMaske: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="row">
        <div className="col">
          <Field
            label="Router (Weg nach draußen)"
            hint="Leer: Die Gäste haben im Saalnetz kein Internet."
          >
            <input
              value={entwurf.dhcpRouter}
              placeholder="192.168.50.254"
              onChange={(e) => setEntwurf({ ...entwurf, dhcpRouter: e.target.value })}
            />
          </Field>
        </div>
        <div className="col-mittel">
          <Field label="Geltungsdauer (Sekunden)">
            <NumberInput
              value={entwurf.dhcpLaufzeit}
              min={300}
              max={86400}
              onChange={(wert) => setEntwurf({ ...entwurf, dhcpLaufzeit: wert })}
            />
          </Field>
        </div>
      </div>

      <div className="row mt-2">
        <button className="primary" onClick={() => void speichern()}>
          Übernehmen
        </button>
        <span className={`badge ${stand.dnsLaeuft ? 'ok' : ''}`}>
          Namensdienst {stand.dnsLaeuft ? 'läuft' : 'aus'}
        </span>
        <span className={`badge ${stand.dhcpLaeuft ? 'ok' : ''}`}>
          Adressvergabe {stand.dhcpLaeuft ? 'läuft' : 'aus'}
        </span>
      </div>
      {stand.fehler && <div className="notice error mt-2">{stand.fehler}</div>}
      {stand.vergeben.length > 0 && (
        <div className="mt-3">
          <label>Vergebene Adressen</label>
          {stand.vergeben.map((eintrag) => (
            <div key={eintrag.mac} className="mono">
              {eintrag.adresse} — {eintrag.mac}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

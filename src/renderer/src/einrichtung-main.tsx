/**
 * Einrichtung der Begleitanwendung.
 *
 * Drei Fragen, in dieser Reihenfolge: **Welcher Rechner?**, **welche
 * Rolle?**, **Token?** — und ein Prüflauf, bevor gespeichert wird.
 *
 * Die Reihenfolge ist nicht beliebig: Erst wenn der Rechner feststeht, sind
 * seine Bühnen bekannt, und erst dann lässt sich sinnvoll wählen, welche
 * dieses Gerät sein soll. Wer die Fragen andersherum stellt, muss raten.
 */
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { SaalEinstellung, SaalFund, SaalRolle } from '@shared/saal'
import { rolleBrauchtAnmeldung } from '@shared/saal'
import './styles/einrichtung.css'

interface SaalBridge {
  einstellung(): Promise<SaalEinstellung | null>
  suchen(): Promise<SaalFund[]>
  pruefen(master: string, token: string): Promise<{ ok: boolean; fehler?: string }>
  uebernehmen(einstellung: SaalEinstellung): Promise<void>
  zuruecksetzen(): Promise<void>
}

declare global {
  interface Window {
    saal?: SaalBridge
  }
}

function EinrichtungsApp(): React.JSX.Element {
  const [funde, setFunde] = useState<SaalFund[]>([])
  const [sucht, setSucht] = useState(true)
  const [gewaehlt, setGewaehlt] = useState<SaalFund | null>(null)
  /* Von Hand eingetragen — für Netze, in denen der Suchruf nicht durchkommt. */
  const [handAdresse, setHandAdresse] = useState('')
  const [token, setToken] = useState('')
  const [rolle, setRolle] = useState<SaalRolle>({ art: 'buehne', nummer: 1 })
  const [pruefung, setPruefung] = useState<{ laeuft: boolean; fehler?: string }>({ laeuft: false })

  const suchen = useCallback(async () => {
    setSucht(true)
    try {
      const gefunden = (await window.saal?.suchen()) ?? []
      setFunde(gefunden)
      /* Genau einer gefunden: Dann ist die Frage schon beantwortet. */
      if (gefunden.length === 1) setGewaehlt(gefunden[0])
    } finally {
      setSucht(false)
    }
  }, [])

  useEffect(() => {
    void suchen()
  }, [suchen])

  const master = gewaehlt ? `http://${gewaehlt.adresse}:${gewaehlt.port}` : handAdresse.trim()
  const buehnen = gewaehlt?.buehnen ?? []
  const tokenNoetig = gewaehlt?.tokenNoetig ?? true

  const uebernehmen = async (): Promise<void> => {
    if (!master) return
    setPruefung({ laeuft: true })
    const ergebnis = await window.saal?.pruefen(master, token)
    if (!ergebnis?.ok) {
      setPruefung({ laeuft: false, fehler: ergebnis?.fehler ?? 'Der Rechner antwortet nicht.' })
      return
    }
    await window.saal?.uebernehmen({ master, token, rolle, name: gewaehlt?.name })
  }

  return (
    <div className="ein">
      <header>
        <h1>Votura Saal</h1>
        <p>
          Dieses Gerät zeigt eine Bühne oder den Prompter des Hauptrechners. Es wird nichts gespeichert außer
          dieser Zuordnung — alle Inhalte kommen vom Hauptrechner.
        </p>
      </header>

      <section>
        <div className="kopfzeile">
          <h2>1. Hauptrechner</h2>
          <button onClick={() => void suchen()} disabled={sucht}>
            {sucht ? 'Suche läuft …' : 'Erneut suchen'}
          </button>
        </div>

        {sucht && funde.length === 0 && <p className="leise">Ruft ins Netz …</p>}

        {!sucht && funde.length === 0 && (
          <p className="hinweis">
            Niemand hat geantwortet. Läuft am Hauptrechner die Netzwerkansicht? Sonst die Adresse unten von
            Hand eintragen — sie steht dort unter <strong>Beamer → Ausgabe &amp; Netz</strong>.
          </p>
        )}

        {funde.map((fund) => (
          <button
            key={fund.adresse}
            className={`fund${gewaehlt?.adresse === fund.adresse ? ' gewaehlt' : ''}`}
            onClick={() => {
              setGewaehlt(fund)
              setHandAdresse('')
            }}
          >
            <strong>{fund.name}</strong>
            <span className="mono">
              {fund.adresse}:{fund.port}
            </span>
            <span className="leise">
              Fassung {fund.version} · {fund.buehnen.length} {fund.buehnen.length === 1 ? 'Bühne' : 'Bühnen'}
              {fund.tokenNoetig ? ' · Token nötig' : ''}
            </span>
          </button>
        ))}

        <label className="feld">
          Oder Adresse von Hand
          <input
            value={handAdresse}
            placeholder="http://192.168.1.5:8477"
            onChange={(event) => {
              setHandAdresse(event.target.value)
              setGewaehlt(null)
            }}
          />
        </label>
      </section>

      <section>
        <h2>2. Was soll dieses Gerät sein?</h2>
        <div className="rollen">
          {(buehnen.length > 0 ? buehnen : [{ id: 1, name: 'Bühne 1' }]).map((buehne) => (
            <button
              key={buehne.id}
              className={rolle.art === 'buehne' && rolle.nummer === buehne.id ? 'gewaehlt' : ''}
              onClick={() => setRolle({ art: 'buehne', nummer: buehne.id })}
            >
              {buehne.name}
              <span className="leise">Beamer, rein anzeigend</span>
            </button>
          ))}
          <button
            className={rolle.art === 'prompter' ? 'gewaehlt' : ''}
            onClick={() => setRolle({ art: 'prompter' })}
          >
            Prompter am Pult
            <span className="leise">
              Redetext oder Folien
              {gewaehlt && !gewaehlt.prompterBedienung ? ' · nur anzeigend' : ' · mit Bedienung'}
            </span>
          </button>
          <button
            className={rolle.art === 'akkreditierung' ? 'gewaehlt' : ''}
            onClick={() => setRolle({ art: 'akkreditierung' })}
          >
            Akkreditierung am Einlass
            <span className="leise">Ausweise ausgeben und zurücknehmen · mit Anmeldung</span>
          </button>
          <button
            className={rolle.art === 'ausgabe' ? 'gewaehlt' : ''}
            onClick={() => setRolle({ art: 'ausgabe' })}
          >
            Ausgabe der Stimmzettel
            <span className="leise">Zettel gegen Ausweis herausgeben · mit Anmeldung</span>
          </button>
        </div>
        {rolleBrauchtAnmeldung(rolle) && (
          <p className="hinweis">
            Dieses Gerät wird <strong>bedient</strong>, nicht nur angesehen: Es meldet sich am Hauptrechner
            mit einem Konto an, und was dort ausgelöst wird, steht mit diesem Konto im Protokoll. Dafür muss
            am Hauptrechner der Fernzugriff eingeschaltet sein.
          </p>
        )}
        {rolle.art === 'prompter' && (
          <p className="hinweis">
            Als Prompter darf dieses Gerät das Mikrofon nutzen — nur dann, und nur gegenüber dem oben
            gewählten Rechner. Aufgenommen wird nichts.
          </p>
        )}
      </section>

      {tokenNoetig && (
        <section>
          <h2>3. Zugriffstoken</h2>
          <p className="leise">
            Der Hauptrechner verlangt eines. Es steht dort unter{' '}
            <strong>Einstellungen → Beamer → Beamer im Netzwerk</strong>.
          </p>
          <label className="feld">
            Token
            <input value={token} onChange={(event) => setToken(event.target.value)} />
          </label>
        </section>
      )}

      {pruefung.fehler && <div className="fehler">{pruefung.fehler}</div>}

      <footer>
        <button className="primaer" disabled={!master || pruefung.laeuft} onClick={() => void uebernehmen()}>
          {pruefung.laeuft ? 'Wird geprüft …' : 'Übernehmen und starten'}
        </button>
        <span className="leise">
          Die Anwendung startet dabei einmal neu — die Zusage an den Hauptrechner gilt erst ab dem nächsten
          Start. Strg + Umschalt + E bringt Sie später hierher zurück.
        </span>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <EinrichtungsApp />
  </StrictMode>
)

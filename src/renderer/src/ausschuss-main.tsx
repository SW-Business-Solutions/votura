/**
 * Das Gerät des Wahlausschusses.
 *
 * Es tut genau eine Sache, und die ist der ganze Unterschied: **Es hält den
 * privaten Schlüssel, und der Hauptrechner sieht ihn nie.**
 *
 * Bis hierher hielt der Hauptrechner ihn selbst. Wer ihn vollständig
 * kontrolliert, kann zusätzliche Stimmberechtigungen erzeugen — die Bilanz
 * macht das sichtbar, verhindert es aber nicht, und die Zahl der ausgegebenen
 * Berechtigungen stammt vom selben Rechner. Läuft dieses Gerät, kann er nichts
 * erzeugen, was der Ausschuss nicht gesehen hat.
 *
 * ## Warum hier gerechnet und nicht `crypto.subtle` benutzt wird
 *
 * Der Schlüssel *entsteht* mit `crypto.subtle` — Schlüsselerzeugung ist
 * Primzahlsuche, und die schreibt man nicht selbst. Unterschrieben wird
 * danach von Hand in BigInt: Eine Blindsignatur ist rohes RSA ohne Auffüllung,
 * und genau das kann `crypto.subtle` nicht. Sie kennt nur die Verfahren mit
 * Auffüllung, und die zerstören die Verblendung.
 *
 * ## Was dieses Gerät nie erfährt
 *
 * Es sieht ausschließlich **verblendete** Werte — Zufallszahlen. Wer wählt,
 * was gewählt wird, wie viele Bewerber es gibt: nichts davon kommt hier an.
 * Es zählt nur, wie oft es unterschrieben hat, und genau diese Zahl muss am
 * Ende zur Urne passen.
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ausBase64Url,
  modPot,
  schluessellaenge,
  zuBase64Url,
  zuBigInt,
  zuBytes,
  type OeffentlicherSchluessel
} from '@shared/blindsignatur'
import type { WahlLage } from '@shared/wahl'
import './styles/wahl.css'

/** Das Zugriffstoken steht in der Adresse — dieses Gerät wurde eingerichtet. */
const token = new URLSearchParams(location.search).get('t') ?? ''

async function ruf<T>(was: string, koerper?: unknown): Promise<T> {
  const adresse = `/api/ausschuss/${was}${token ? `?t=${encodeURIComponent(token)}` : ''}`
  const antwort = await fetch(adresse, {
    method: koerper ? 'POST' : 'GET',
    headers: koerper ? { 'Content-Type': 'application/json' } : undefined,
    body: koerper ? JSON.stringify(koerper) : undefined
  })
  const daten = (await antwort.json()) as { fehler?: string } & T
  if (!antwort.ok) throw new Error(daten.fehler ?? `Fehler ${antwort.status}`)
  return daten
}

interface PrivaterSchluessel {
  n: bigint
  d: bigint
  laenge: number
}

/**
 * Ein Schlüsselpaar erzeugen und den privaten Teil hierbehalten.
 *
 * `extractable: true` ist nötig, weil der private Exponent für die rohe
 * Signatur gebraucht wird. Er wird **nicht** gespeichert: Er lebt in dieser
 * einen Seite, und wenn sie geschlossen wird, ist er weg. Für eine
 * Versammlung ist das richtig — der Schlüssel gilt ohnehin nur für diesen
 * einen Wahlgang.
 */
async function schluesselErzeugen(): Promise<{
  oeffentlich: OeffentlicherSchluessel
  privat: PrivaterSchluessel
}> {
  const paar = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )
  const jwk = (await crypto.subtle.exportKey('jwk', paar.privateKey)) as {
    n: string
    e: string
    d: string
  }
  const oeffentlich = { n: jwk.n, e: jwk.e }
  return {
    oeffentlich,
    privat: {
      n: zuBigInt(ausBase64Url(jwk.n)),
      d: zuBigInt(ausBase64Url(jwk.d)),
      laenge: schluessellaenge(oeffentlich)
    }
  }
}

function Ausschuss(): React.JSX.Element {
  const [lage, setLage] = useState<WahlLage | null>(null)
  const [zaehler, setZaehler] = useState<{ angefragt: number; unterschrieben: number } | null>(null)
  const [schluessel, setSchluessel] = useState<OeffentlicherSchluessel | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [arbeitet, setArbeitet] = useState(false)
  /* Der private Teil steht bewusst nicht im Zustand der Oberfläche: Er gehört
     nicht in etwas, das React beliebig kopiert und weitergibt. */
  const privat = useRef<PrivaterSchluessel | null>(null)

  const lageHolen = useCallback(async () => {
    try {
      const daten = await ruf<{
        lage: WahlLage | null
        zaehler: { angefragt: number; unterschrieben: number } | null
      }>('lage')
      setLage(daten.lage)
      setZaehler(daten.zaehler)
      if (daten.lage?.schluessel) setSchluessel(daten.lage.schluessel)
      setFehler(null)
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void lageHolen()
    const takt = setInterval(() => void lageHolen(), 3000)
    return () => clearInterval(takt)
  }, [lageHolen])

  /**
   * Die Schleife, auf die es ankommt: abholen, unterschreiben, zurückgeben.
   *
   * Ein Wähler wartet währenddessen vor seinem Gerät, deshalb wird oft
   * gefragt. Unterschrieben wird in BigInt — eine Potenz mit einem 2048 Bit
   * langen Exponenten, was auf einem Tablet ein paar Zehntelsekunden dauert.
   */
  useEffect(() => {
    if (!lage || lage.status !== 'open' || !privat.current) return
    let abgebrochen = false

    const durchlauf = async (): Promise<void> => {
      if (abgebrochen || !privat.current) return
      try {
        const { offen } = await ruf<{ offen: { id: string; blinded: string }[] }>('offen')
        if (offen.length === 0) return
        setArbeitet(true)
        for (const anfrage of offen) {
          const wert = zuBigInt(ausBase64Url(anfrage.blinded))
          const signatur = modPot(wert, privat.current.d, privat.current.n)
          await ruf('signatur', {
            id: anfrage.id,
            signatur: zuBase64Url(zuBytes(signatur, privat.current.laenge))
          })
        }
        await lageHolen()
      } catch (error) {
        setFehler(error instanceof Error ? error.message : String(error))
      } finally {
        setArbeitet(false)
      }
    }

    const takt = setInterval(() => void durchlauf(), 700)
    return () => {
      abgebrochen = true
      clearInterval(takt)
    }
  }, [lage?.status, lage?.roundId, schluessel, lageHolen])

  const schluesselAnlegen = async (): Promise<void> => {
    if (!lage) return
    try {
      const { oeffentlich, privat: geheim } = await schluesselErzeugen()
      privat.current = geheim
      await ruf('schluessel', { roundId: lage.roundId, n: oeffentlich.n, e: oeffentlich.e })
      setSchluessel(oeffentlich)
      await lageHolen()
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error))
    }
  }

  if (!lage) {
    return (
      <main className="wahl">
        <h1>Wahlausschuss</h1>
        <p>
          Es ist gerade kein Wahlgang vorbereitet, der über den Ausschuss unterschreibt. Die Wahlleitung wählt
          beim Vorbereiten <em>Unterschrift durch den Wahlausschuss</em>.
        </p>
        {fehler && <p className="fehler">{fehler}</p>}
      </main>
    )
  }

  return (
    <main className="wahl">
      <p className="leise">Wahlausschuss</p>
      <h1>{lage.titel}</h1>
      <p className="leise">
        {lage.roundLabel} ·{' '}
        {lage.status === 'prepared' ? 'vorbereitet' : lage.status === 'open' ? 'läuft' : 'geschlossen'}
      </p>

      {!schluessel ? (
        <>
          <p>
            Dieses Gerät erzeugt den Schlüssel dieses Wahlgangs und <strong>behält ihn</strong>. Der
            Hauptrechner bekommt nur den öffentlichen Teil; unterschreiben kann ab dann nur dieses Gerät.
          </p>
          <p className="leise">
            Schließen Sie diese Seite nicht, solange die Abstimmung läuft — der Schlüssel lebt nur hier, und
            ohne ihn kann niemand mehr eine Stimmberechtigung bekommen.
          </p>
          <button className="gross abgeben" onClick={() => void schluesselAnlegen()}>
            Schlüssel erzeugen und melden
          </button>
        </>
      ) : (
        <>
          <p>
            Prüfschlüssel gemeldet. Er gehört <strong>vor der Eröffnung</strong> auf die Leinwand — danach
            lässt er sich nicht mehr unbemerkt austauschen.
          </p>
          <p className="mono" style={{ wordBreak: 'break-all', fontSize: '13px' }}>
            {schluessel.n.slice(0, 64)}…
          </p>
          {!privat.current && (
            <p className="fehler">
              Der Schlüssel dieses Wahlgangs wurde von einem anderen Gerät gemeldet — oder diese Seite wurde
              neu geladen. Unterschreiben kann nur das Gerät, auf dem der Schlüssel entstanden ist.
            </p>
          )}
          {zaehler && (
            <div className="auswahl">
              <div className="gross">
                <strong>{zaehler.unterschrieben}</strong> Unterschriften geleistet
              </div>
              {zaehler.angefragt > zaehler.unterschrieben && (
                <div className="gross">
                  {zaehler.angefragt - zaehler.unterschrieben} warten
                  {arbeitet ? ' — wird unterschrieben …' : ''}
                </div>
              )}
            </div>
          )}
          <p className="leise">
            Diese Zahl muss am Ende zur Urne passen: In ihr dürfen nie mehr Stimmen liegen, als hier
            unterschrieben wurde. Das ist der Zweck dieses Geräts — nicht, dass der Hauptrechner nichts kann,
            sondern dass jemand anderes nachrechnet.
          </p>
        </>
      )}

      {fehler && <p className="fehler">{fehler}</p>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Ausschuss />
  </StrictMode>
)

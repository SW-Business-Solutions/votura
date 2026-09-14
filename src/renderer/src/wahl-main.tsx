/**
 * Die Stimmabgabe auf dem Gerät eines Teilnehmers.
 *
 * Sie läuft im Browser eines Telefons, eines Tablets in der Wahlkabine oder
 * auf einem gestellten Gerät — dieselbe Seite, immer über das Netz der
 * Veranstaltung ausgeliefert. Keine App, kein Store, keine Installation.
 *
 * ## Was hier gerechnet wird und warum
 *
 * Bei geheimer Wahl entsteht die Seriennummer des Stimmzettels **auf diesem
 * Gerät**, wird verblendet zum Hauptrechner geschickt und dort unterschrieben,
 * ohne dass er sie sieht. Erst das macht aus zwei getrennten Tabellen eine
 * echte Trennung. Der Zufallsfaktor verlässt dieses Gerät nie — er steht in
 * keiner Anfrage und in keinem Speicher, der die Seite überlebt.
 *
 * ## Bewusst schlicht
 *
 * Große Schrift, große Flächen, keine Farbcodes ohne Text. Wer hier steht,
 * hält ein Telefon in einer Hand, hat die Lesebrille im Mantel und dreißig
 * Leute hinter sich.
 */
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  entblenden,
  verblenden,
  zuBase64Url,
  type OeffentlicherSchluessel,
  type Pruefsumme
} from '@shared/blindsignatur'
import { GEHEIMNIS_LABELS, type Stimmabgabe, type WahlAuskunft } from '@shared/wahl'
import './styles/wahl.css'

/** SHA-256 aus dem Browser — selbst zu hashen wäre die Art Rad, die man nicht neu erfindet. */
const sha256: Pruefsumme = async (daten) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', daten as BufferSource))

const zufall = (laenge: number): Uint8Array => crypto.getRandomValues(new Uint8Array(laenge))

async function hole<T>(pfad: string, koerper?: unknown): Promise<T> {
  const antwort = await fetch(pfad, {
    method: koerper ? 'POST' : 'GET',
    headers: koerper ? { 'Content-Type': 'application/json' } : undefined,
    body: koerper ? JSON.stringify(koerper) : undefined
  })
  const daten = (await antwort.json()) as { fehler?: string } & T
  if (!antwort.ok) throw new Error(daten.fehler ?? `Fehler ${antwort.status}`)
  return daten
}

type Schritt = 'ausweis' | 'wahl' | 'fertig'

function Wahlseite(): React.JSX.Element {
  const [schritt, setSchritt] = useState<Schritt>('ausweis')
  const [code, setCode] = useState('')
  const [auskunft, setAuskunft] = useState<WahlAuskunft | null>(null)
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [antwort, setAntwort] = useState<'ja' | 'nein' | 'enthaltung' | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const pruefen = useCallback(async (wert: string) => {
    setFehler(null)
    try {
      const ergebnis = await hole<WahlAuskunft>(`/api/stimme/lage?code=${encodeURIComponent(wert)}`)
      setAuskunft(ergebnis)
      if (ergebnis.berechtigt && ergebnis.lage) setSchritt('wahl')
      else setFehler(ergebnis.hindernis ?? 'Gerade ist keine Abstimmung offen.')
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error))
    }
  }, [])

  /* Ein Aufruf mit `?c=…` kommt vom Scan eines QR-Codes — dann ist der Ausweis
     schon da und der erste Schritt entfällt. */
  useEffect(() => {
    const ausAdresse = new URLSearchParams(location.search).get('c')
    if (ausAdresse) {
      setCode(ausAdresse)
      void pruefen(ausAdresse)
    }
  }, [pruefen])

  const abgeben = async (): Promise<void> => {
    const lage = auskunft?.lage
    if (!lage || laeuft) return
    setLaeuft(true)
    setFehler(null)

    try {
      const stimme: Stimmabgabe = lage.sachabstimmung
        ? { antwort: antwort ?? 'enthaltung' }
        : { kandidaten: [...gewaehlt] }

      if (lage.geheimnis === 'secret') {
        /*
         * Der geheime Weg. Die Seriennummer entsteht hier, wird verblendet
         * unterschrieben und erst danach — in einer zweiten, getrennten
         * Anfrage — zusammen mit der Stimme abgegeben.
         */
        const schluessel = lage.schluessel as OeffentlicherSchluessel
        const seriennummer = zufall(32)
        const { verblendet, faktor } = await verblenden(seriennummer, schluessel, sha256, zufall)

        const { signatur } = await hole<{ signatur: string }>('/api/stimme/berechtigung', {
          code,
          roundId: lage.roundId,
          verblendet
        })
        const echte = entblenden(signatur, faktor, schluessel)

        await hole('/api/stimme/abgeben', {
          roundId: lage.roundId,
          serial: zuBase64Url(seriennummer),
          signatur: echte,
          choice: stimme
        })
      } else {
        const { serial } = await hole<{ serial: string }>('/api/stimme/berechtigung', {
          code,
          roundId: lage.roundId
        })
        await hole('/api/stimme/abgeben', {
          code,
          roundId: lage.roundId,
          serial,
          choice: stimme
        })
      }
      setSchritt('fertig')
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error))
    } finally {
      setLaeuft(false)
    }
  }

  if (schritt === 'fertig') {
    return (
      <main className="wahl fertig">
        <div className="haken">✓</div>
        <h1>Ihre Stimme wurde angenommen.</h1>
        <p>
          Sie können das Gerät jetzt weglegen. Für diesen Wahlgang ist Ihre Stimme abgegeben; ein zweites Mal
          ist nicht möglich.
        </p>
        {auskunft?.lage?.geheimnis === 'secret' && (
          <p className="leise">
            Es gibt keinen Beleg — und das ist Absicht: Was sich nicht nachweisen lässt, lässt sich nicht
            erzwingen. Nachgezählt wird die Urne als Ganzes.
          </p>
        )}
      </main>
    )
  }

  if (schritt === 'ausweis' || !auskunft?.lage) {
    return (
      <main className="wahl">
        <h1>Stimmabgabe</h1>
        <p>Bitte den Code Ihres Ausweises eingeben oder den QR-Code scannen.</p>
        <input
          className="gross"
          autoFocus
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(ereignis) => setCode(ereignis.target.value.toUpperCase())}
          onKeyDown={(ereignis) => {
            if (ereignis.key === 'Enter') void pruefen(code)
          }}
        />
        <button className="gross" onClick={() => void pruefen(code)}>
          Weiter
        </button>
        {fehler && <p className="fehler">{fehler}</p>}
      </main>
    )
  }

  const lage = auskunft.lage
  const zuviele = !lage.sachabstimmung && gewaehlt.size > lage.maxStimmen

  return (
    <main className="wahl">
      <p className="leise">{GEHEIMNIS_LABELS[lage.geheimnis]}</p>
      <h1>{lage.titel}</h1>
      <p className="leise">
        {lage.roundLabel}
        {auskunft.name ? ` · ${auskunft.name}` : ''}
        {auskunft.gewicht && auskunft.gewicht > 1 ? ` · ${auskunft.gewicht} Stimmen` : ''}
      </p>

      {lage.sachabstimmung ? (
        <div className="auswahl">
          {(['ja', 'nein', 'enthaltung'] as const).map((wert) => (
            <button
              key={wert}
              className={`gross ${antwort === wert ? 'gewaehlt' : ''}`}
              onClick={() => setAntwort(wert)}
            >
              {wert === 'ja' ? 'Ja' : wert === 'nein' ? 'Nein' : 'Enthaltung'}
            </button>
          ))}
        </div>
      ) : (
        <>
          <p>
            Höchstens <strong>{lage.maxStimmen}</strong> {lage.maxStimmen === 1 ? 'Person' : 'Personen'}{' '}
            ankreuzen.
          </p>
          <div className="auswahl">
            {lage.kandidaten.map((kandidat) => (
              <button
                key={kandidat.id}
                className={`gross ${gewaehlt.has(kandidat.id) ? 'gewaehlt' : ''}`}
                onClick={() => {
                  const naechste = new Set(gewaehlt)
                  if (naechste.has(kandidat.id)) naechste.delete(kandidat.id)
                  else naechste.add(kandidat.id)
                  setGewaehlt(naechste)
                }}
              >
                <span className="kreuz">{gewaehlt.has(kandidat.id) ? '☒' : '☐'}</span>
                {kandidat.name}
              </button>
            ))}
          </div>
          <p className="leise">
            {gewaehlt.size} von höchstens {lage.maxStimmen} angekreuzt.
          </p>
        </>
      )}

      {zuviele && <p className="fehler">Zu viele angekreuzt — bitte eines wieder abwählen.</p>}
      {fehler && <p className="fehler">{fehler}</p>}

      <button
        className="gross abgeben"
        disabled={laeuft || zuviele || (lage.sachabstimmung && !antwort)}
        onClick={() => void abgeben()}
      >
        {laeuft ? 'Wird abgegeben …' : 'Stimme abgeben'}
      </button>
      <p className="leise">
        Nach dem Absenden lässt sich nichts mehr ändern — wie ein Zettel, der in der Urne ist.
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Wahlseite />
  </StrictMode>
)

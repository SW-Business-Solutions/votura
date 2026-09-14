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
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  entblenden,
  verblenden,
  zuBase64Url,
  type OeffentlicherSchluessel,
  type Pruefsumme
} from '@shared/blindsignatur'
import { GEHEIMNIS_LABELS, type Stimmabgabe, type WahlAuskunft, type WahlLage } from '@shared/wahl'
import { kameraVerfuegbar, QrScanner } from './qr-scanner'
import './styles/wahl.css'

/** SHA-256 aus dem Browser — selbst zu hashen wäre die Art Rad, die man nicht neu erfindet. */
const sha256: Pruefsumme = async (daten) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', daten as BufferSource))

const zufall = (laenge: number): Uint8Array => crypto.getRandomValues(new Uint8Array(laenge))

/**
 * Ein Fehler, der nichts über die Stimme sagt — nur über die Leitung.
 *
 * Der Unterschied ist der ganze Punkt: „Sie haben schon abgestimmt" ist eine
 * Antwort, „das WLAN war weg" ist keine. Nur beim zweiten lohnt es, dieselbe
 * Anfrage noch einmal zu schicken.
 */
class NetzFehler extends Error {}

async function hole<T>(pfad: string, koerper?: unknown): Promise<T> {
  let antwort: Response
  try {
    antwort = await fetch(pfad, {
      method: koerper ? 'POST' : 'GET',
      headers: koerper ? { 'Content-Type': 'application/json' } : undefined,
      body: koerper ? JSON.stringify(koerper) : undefined
    })
  } catch {
    throw new NetzFehler('Keine Verbindung zum Wahlrechner.')
  }
  const daten = (await antwort.json().catch(() => {
    throw new NetzFehler('Die Antwort kam nicht vollständig an.')
  })) as { fehler?: string } & T
  if (!antwort.ok) throw new Error(daten.fehler ?? `Fehler ${antwort.status}`)
  return daten
}

/**
 * Dieselbe Anfrage noch einmal, solange nur die Leitung schuld ist.
 *
 * Ein Saal-WLAN mit mehreren hundert Geräten verliert Verbindungen; das ist
 * der Normalfall, nicht die Ausnahme. Die Stimme darf dabei weder verloren
 * gehen noch doppelt ankommen — deshalb wird **dieselbe** Seriennummer mit
 * **derselben** Auswahl geschickt. Der Rechner erkennt sie wieder und zählt
 * sie nicht zweimal.
 */
async function mitWiederholung<T>(was: () => Promise<T>, versuche = 4): Promise<T> {
  for (let versuch = 1; ; versuch++) {
    try {
      return await was()
    } catch (error) {
      if (!(error instanceof NetzFehler) || versuch >= versuche) throw error
      await new Promise((weiter) => setTimeout(weiter, 800 * versuch))
    }
  }
}

type Schritt = 'ausweis' | 'wahl' | 'fertig'

/**
 * Wann sich der Bildschirm von selbst zurücksetzt.
 *
 * **In der Wahlkabine ist das keine Bequemlichkeit, sondern Teil des
 * Wahlgeheimnisses.** Wer fertig ist, geht — und ließe sonst seinen Namen,
 * seine Auswahl und die Bestätigung für den Nächsten stehen. Schlimmer noch
 * der Fall, dass jemand mitten in der Auswahl weggerufen wird: Der Nächste
 * fände einen angemeldeten Ausweis und einen halb ausgefüllten Stimmzettel
 * vor und könnte ihn absenden.
 *
 * Deshalb zwei Zeiten: nach der Abgabe kurz, weil niemand mehr etwas zu lesen
 * hat, und während der Auswahl lang genug, dass niemand beim Nachdenken
 * herausfliegt.
 */
const RUECKSETZEN_NACH_ABGABE = 15
const RUECKSETZEN_BEI_STILLE = 120

function Wahlseite(): React.JSX.Element {
  const [schritt, setSchritt] = useState<Schritt>('ausweis')
  const [code, setCode] = useState('')
  const [auskunft, setAuskunft] = useState<WahlAuskunft | null>(null)
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [antwort, setAntwort] = useState<'ja' | 'nein' | 'enthaltung' | null>(null)
  /*
   * Der zweite Ausweis.
   *
   * Wer eine Stimmkarte hält und einen gedruckten Pass hat, braucht beide:
   * Der Kartencode steht aufgedruckt da und lässt sich fotografieren, der
   * Pass lässt sich neu ausgeben und macht den alten damit ungültig. Welcher
   * noch fehlt, sagt der Hauptrechner — das Gerät rät nicht.
   */
  const [zweiterCode, setZweiterCode] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  /* Sichtbarer Rückwärtszähler: Ein Bildschirm, der ohne Ankündigung
     umspringt, sieht aus wie ein Absturz. */
  const [restzeit, setRestzeit] = useState(RUECKSETZEN_NACH_ABGABE)
  /* Die Kamera ist das Angebot, nicht die Bedingung — das Tippfeld bleibt
     daneben stehen und funktioniert immer (ADR-0007). */
  const [scannt, setScannt] = useState(false)
  /*
   * Was gerade offen ist — **ohne** dass jemand seinen Ausweis vorzeigt.
   *
   * Vorher fragte das Gerät erst nach dem Ausweis und teilte danach mit, dass
   * gar keine Abstimmung läuft. In einer Wahlkabine heißt das: Jemand holt
   * seine Karte heraus, tippt, wartet — und erfährt dann, dass er umsonst
   * angestanden hat. `undefined` bedeutet „noch nicht gefragt", `null`
   * bedeutet „nichts offen".
   */
  const [offeneAbstimmung, setOffeneAbstimmung] = useState<WahlLage | null | undefined>(undefined)
  /*
   * **Was bei einem zweiten Versuch nicht noch einmal passieren darf.**
   * Die Berechtigung gibt es je Wahlgang genau einmal. Bricht die Abgabe ab,
   * nachdem sie geholt wurde, wäre ein neuer Anlauf von vorn der sichere Weg
   * in „Für diesen Wahlgang wurde bereits eine Stimmberechtigung ausgegeben"
   * — und der Wähler stünde mit einer verbrauchten Berechtigung da, ohne zu
   * wissen, ob seine Stimme liegt. Sie wird deshalb festgehalten und beim
   * nächsten Versuch weiterverwendet.
   */
  const berechtigung = useRef<{ serial: string; signatur?: string } | null>(null)
  const [wartet, setWartet] = useState(false)

  const pruefen = useCallback(async (wert: string, zweiter = '') => {
    setFehler(null)
    try {
      const ergebnis = await hole<WahlAuskunft>(
        `/api/stimme/lage?code=${encodeURIComponent(wert)}&code2=${encodeURIComponent(zweiter)}`
      )
      setAuskunft(ergebnis)
      /*
       * Wer schon abgestimmt hat, erfährt es **vorher**. Es erst beim
       * Absenden zu sagen, hieße jemanden erst auswählen zu lassen und ihm
       * dann das Papier wieder wegzunehmen.
       */
      if (ergebnis.bereitsAusgegeben) {
        setFehler('Für diesen Wahlgang haben Sie bereits eine Stimmberechtigung erhalten.')
      } else if (ergebnis.fehlenderFaktor) {
        /* Kein Abbruch: Das Gerät bleibt stehen und fragt den zweiten Ausweis
           ab. Der erste bleibt dabei erhalten. */
        setFehler(null)
      } else if (ergebnis.berechtigt && ergebnis.lage) {
        setSchritt('wahl')
      } else {
        setFehler(ergebnis.hindernis ?? 'Gerade ist keine Abstimmung offen.')
      }
    } catch (error) {
      setFehler(error instanceof Error ? error.message : String(error))
    }
  }, [])

  /**
   * Alles vergessen und von vorn anfangen.
   *
   * Vollständig: Ausweise, Auswahl, Name, die geholte Berechtigung. Was hier
   * stehen bliebe, gehörte dem Vorigen — in einer Wahlkabine ist das der
   * Unterschied zwischen einem Gerät und einem Zeugen.
   *
   * Auch die Adresse wird gesäubert: Ein `?c=…` darin würde beim nächsten
   * Laden den Ausweis des Vorigen wieder einsetzen.
   */
  const zuruecksetzen = useCallback(() => {
    setSchritt('ausweis')
    setCode('')
    setZweiterCode('')
    setAuskunft(null)
    setGewaehlt(new Set())
    setAntwort(null)
    setFehler(null)
    setRestzeit(RUECKSETZEN_NACH_ABGABE)
    setScannt(false)
    berechtigung.current = null
    if (location.search) history.replaceState(null, '', location.pathname)
  }, [])

  /**
   * Der Rückwärtszähler nach der Abgabe.
   *
   * Er läuft nur auf dem Bestätigungsbildschirm; solange jemand auswählt,
   * hat er dort nichts zu suchen.
   */
  useEffect(() => {
    if (schritt !== 'fertig') return
    setRestzeit(RUECKSETZEN_NACH_ABGABE)
    const takt = setInterval(() => {
      setRestzeit((übrig) => {
        if (übrig <= 1) {
          clearInterval(takt)
          zuruecksetzen()
          return 0
        }
        return übrig - 1
      })
    }, 1000)
    return () => clearInterval(takt)
  }, [schritt, zuruecksetzen])

  /**
   * Der Bildschirm, an dem niemand mehr steht.
   *
   * Jede Berührung setzt die Uhr neu. Bleibt es still, wird zurückgesetzt —
   * sonst fände der Nächste einen angemeldeten Ausweis und eine fremde
   * Auswahl vor und könnte sie absenden.
   */
  useEffect(() => {
    if (schritt !== 'wahl') return
    let uhr = window.setTimeout(zuruecksetzen, RUECKSETZEN_BEI_STILLE * 1000)
    const neuStarten = (): void => {
      window.clearTimeout(uhr)
      uhr = window.setTimeout(zuruecksetzen, RUECKSETZEN_BEI_STILLE * 1000)
    }
    for (const art of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(art, neuStarten)
    }
    return () => {
      window.clearTimeout(uhr)
      for (const art of ['pointerdown', 'keydown'] as const) {
        window.removeEventListener(art, neuStarten)
      }
    }
  }, [schritt, zuruecksetzen])

  /**
   * Nachsehen, ob etwas offen ist — und zwar immer wieder.
   *
   * Ein Gerät in der Kabine steht den ganzen Abend dort. Es soll von selbst
   * bereit sein, wenn die Wahlleitung den nächsten Wahlgang eröffnet, und
   * nicht darauf warten, dass jemand die Seite neu lädt.
   */
  useEffect(() => {
    if (schritt !== 'ausweis') return
    let abgebrochen = false
    const nachsehen = async (): Promise<void> => {
      try {
        const ergebnis = await hole<WahlAuskunft>('/api/stimme/lage?code=')
        if (!abgebrochen) setOffeneAbstimmung(ergebnis.lage)
      } catch {
        /* Kein Netz ist keine Aussage über die Abstimmung — der nächste
           Versuch kommt in fünf Sekunden. */
      }
    }
    void nachsehen()
    const takt = setInterval(() => void nachsehen(), 5000)
    return () => {
      abgebrochen = true
      clearInterval(takt)
    }
  }, [schritt])

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
        if (!berechtigung.current) {
          const seriennummer = zufall(32)
          const { verblendet, faktor } = await verblenden(seriennummer, schluessel, sha256, zufall)

          const geholt = await mitWiederholung(() =>
            hole<{ signatur?: string; ticket?: string }>('/api/stimme/berechtigung', {
              code,
              code2: zweiterCode,
              roundId: lage.roundId,
              verblendet
            })
          )

        /*
         * Unterschreibt der Wahlausschuss, kommt statt der Unterschrift eine
         * Wartenummer zurück: Der Schlüssel liegt auf einem anderen Gerät.
         * Also nachfragen, bis sie da ist — ein paar Sekunden, in denen der
         * Wähler vor dem Bildschirm steht und lesen soll, warum.
         */
          let signatur = geholt.signatur
          if (!signatur && geholt.ticket) {
            setWartet(true)
            for (let versuch = 0; versuch < 120 && !signatur; versuch++) {
              await new Promise((weiter) => setTimeout(weiter, 500))
              const antwort = await mitWiederholung(() =>
                hole<{ signatur?: string }>('/api/stimme/warten', { ticket: geholt.ticket })
              )
              signatur = antwort.signatur
            }
            setWartet(false)
          }
          if (!signatur) {
            throw new Error(
              'Der Wahlausschuss hat nicht geantwortet. Bitte beim Wahlvorstand melden — Ihre Stimme ist noch nicht abgegeben.'
            )
          }

          berechtigung.current = {
            serial: zuBase64Url(seriennummer),
            signatur: entblenden(signatur, faktor, schluessel)
          }
        }

        await mitWiederholung(() =>
          hole('/api/stimme/abgeben', {
            roundId: lage.roundId,
            serial: berechtigung.current!.serial,
            signatur: berechtigung.current!.signatur,
            choice: stimme
          })
        )
      } else {
        if (!berechtigung.current) {
          const { serial } = await mitWiederholung(() =>
            hole<{ serial: string }>('/api/stimme/berechtigung', {
              code,
              code2: zweiterCode,
              roundId: lage.roundId
            })
          )
          berechtigung.current = { serial }
        }
        await mitWiederholung(() =>
          hole('/api/stimme/abgeben', {
            code,
            code2: zweiterCode,
            roundId: lage.roundId,
            serial: berechtigung.current!.serial,
            choice: stimme
          })
        )
      }
      setSchritt('fertig')
    } catch (error) {
      /*
       * Bei einem Netzfehler steht die Auswahl noch auf dem Bildschirm und
       * die Berechtigung ist festgehalten — der Knopf schickt dieselbe Stimme
       * noch einmal. Das muss dort stehen, denn die naheliegende Handlung,
       * die Seite neu zu laden, ist genau die falsche.
       */
      setFehler(
        error instanceof NetzFehler
          ? 'Die Verbindung zum Wahlrechner ist abgerissen. Ihre Auswahl steht noch — tippen Sie erneut auf „Stimme abgeben". Laden Sie die Seite nicht neu.'
          : error instanceof Error
            ? error.message
            : String(error)
      )
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
        <p className="leise">
          Der Bildschirm wird in {restzeit} {restzeit === 1 ? 'Sekunde' : 'Sekunden'} für die nächste Person
          zurückgesetzt.
        </p>
        <button className="gross" onClick={zuruecksetzen}>
          Für die nächste Person freigeben
        </button>
      </main>
    )
  }

  if (schritt === 'ausweis' || !auskunft?.lage) {
    const fehlt = auskunft?.fehlenderFaktor

    /*
     * Nichts offen: Dann gibt es hier nichts einzutippen. Das Gerät sieht
     * weiter nach und wird von selbst bereit, sobald eröffnet wird.
     */
    if (offeneAbstimmung === null && !fehlt) {
      return (
        <main className="wahl">
          <h1>Gerade läuft keine Abstimmung.</h1>
          <p>
            Dieses Gerät ist bereit. Sobald die Wahlleitung einen Wahlgang eröffnet, erscheint er hier von
            selbst — die Seite muss nicht neu geladen werden.
          </p>
          <p className="leise">Bitte den Ausweis so lange behalten.</p>
          {fehler && <p className="fehler">{fehler}</p>}
        </main>
      )
    }

    return (
      <main className="wahl">
        <h1>Stimmabgabe</h1>
        {offeneAbstimmung && !fehlt && (
          <p className="leise">
            {offeneAbstimmung.roundLabel} · {offeneAbstimmung.titel}
          </p>
        )}
        {fehlt ? (
          <>
            <p>
              {auskunft?.name ? `${auskunft.name} — ` : ''}
              {fehlt === 'karte'
                ? 'bitte zusätzlich Ihre Stimmkarte oder Ihr Bändchen scannen.'
                : 'bitte zusätzlich Ihren gedruckten Voting Pass scannen.'}
            </p>
            <p className="leise">
              Zum Abstimmen gehören beide Ausweise. Der aufgedruckte Code einer Karte lässt sich
              fotografieren und nicht ändern — der Pass dagegen wird bei Verlust neu ausgegeben, und der alte
              gilt im selben Augenblick nicht mehr.
            </p>
            {scannt ? (
              <QrScanner
                titel={fehlt === 'karte' ? 'Stimmkarte scannen' : 'Voting Pass scannen'}
                aufSchliessen={() => setScannt(false)}
                aufCode={(gelesen) => {
                  setScannt(false)
                  setZweiterCode(gelesen)
                  void pruefen(code, gelesen)
                }}
              />
            ) : kameraVerfuegbar() ? (
              <button className="gross" onClick={() => setScannt(true)}>
                Mit der Kamera scannen
              </button>
            ) : null}
            <input
              className="gross"
              autoCapitalize="characters"
              spellCheck={false}
              value={zweiterCode}
              onChange={(ereignis) => setZweiterCode(ereignis.target.value.toUpperCase())}
              onKeyDown={(ereignis) => {
                if (ereignis.key === 'Enter') void pruefen(code, zweiterCode)
              }}
            />
            <button className="gross" onClick={() => void pruefen(code, zweiterCode)}>
              Weiter
            </button>
          </>
        ) : (
          <>
            <p>Bitte den QR-Code Ihres Ausweises scannen oder den Code eingeben.</p>
            {scannt ? (
              <QrScanner
                titel="Ausweis scannen"
                aufSchliessen={() => setScannt(false)}
                aufCode={(gelesen) => {
                  setScannt(false)
                  setCode(gelesen)
                  void pruefen(gelesen)
                }}
              />
            ) : kameraVerfuegbar() ? (
              <button className="gross" onClick={() => setScannt(true)}>
                Mit der Kamera scannen
              </button>
            ) : (
              <p className="leise">
                Der QR-Code lässt sich auf diesem Gerät nicht scannen: Dafür müsste die Seite verschlüsselt
                ausgeliefert werden. Bitte den aufgedruckten Code eingeben.
              </p>
            )}
            <input
              className="gross"
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
          </>
        )}
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
        {wartet
          ? 'Der Wahlausschuss unterschreibt …'
          : laeuft
            ? 'Wird abgegeben …'
            : fehler && berechtigung.current
              ? 'Erneut versuchen'
              : 'Stimme abgeben'}
      </button>
      <p className="leise">
        Nach dem Absenden lässt sich nichts mehr ändern — wie ein Zettel, der in der Urne ist.
      </p>
      {wartet && (
        <p className="leise">
          Ihre Stimmberechtigung wird gerade vom Wahlausschuss unterschrieben — auf einem eigenen Gerät, damit
          niemand allein Berechtigungen erzeugen kann. Was er dabei sieht, ist eine Zufallszahl: Ihre Wahl
          erfährt er nicht.
        </p>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Wahlseite />
  </StrictMode>
)

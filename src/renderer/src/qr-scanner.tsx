/**
 * Der QR-Scanner — Kamerabild hinein, Code heraus, nichts verlässt das Gerät.
 *
 * ## Warum es ihn gibt
 *
 * Die Oberfläche sagt an vier Stellen „scannen", und gemeint war bisher ein
 * Handscanner am USB-Anschluss. Auf einem Tablet in der Wahlkabine und auf dem
 * Telefon eines Teilnehmers gibt es den nicht — dort wurde abgetippt. Seit zum
 * Abstimmen **zwei** Ausweise gehören (ADR-0006), sind das zweimal sechzehn
 * Zeichen in einer Schlange. Das ist keine Stimmabgabe, das ist eine Zumutung.
 *
 * ## Wie erkannt wird
 *
 * Zwei Stufen, und die Reihenfolge hat einen Grund:
 *
 * 1. **`BarcodeDetector`**, wo der Browser ihn mitbringt — Chromium, also
 *    Votura Saal und Android. Schneller als alles Mitgebrachte und kostenlos.
 * 2. **`jsqr`** sonst, damit es auch auf iPhones geht. Geladen wird das Modul
 *    erst beim ersten Scan: Wer nie scannt, bekommt es nie in den Speicher.
 *
 * ## Was der Scanner nicht tut
 *
 * Er nimmt nichts auf, speichert nichts und schickt nichts. Das Bild lebt
 * zwischen Kamera und Erkennung, und mit dem Schließen ist es weg — die
 * Kamera wird dabei ausdrücklich abgeschaltet, nicht nur ausgeblendet. Ein
 * Licht, das weiterleuchtet, wäre in einer Wahlkabine unerträglich.
 *
 * ## Die sichere Herkunft
 *
 * `getUserMedia` verweigert den Dienst auf gewöhnlichem HTTP. In Votura Saal
 * ist die eingestellte Adresse als vertrauenswürdig geführt (ADR-0005); auf
 * mitgebrachten Telefonen braucht es die verschlüsselte Übertragung. Statt
 * einer toten Schaltfläche steht dann dort, woran es liegt.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { codeAus } from '@shared/ausweis-code'

/** Der Erkenner von Chromium — in den Typen von TypeScript steht er nicht. */
interface Strichcodeleser {
  detect(quelle: CanvasImageSource): Promise<{ rawValue: string }[]>
}
declare const BarcodeDetector: {
  new (optionen?: { formats?: string[] }): Strichcodeleser
  getSupportedFormats?: () => Promise<string[]>
}

/** Kann dieses Gerät überhaupt eine Kamera öffnen? */
function kameraMoeglich(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/**
 * Hat es Sinn, den Knopf „Mit der Kamera" überhaupt anzubieten?
 *
 * Auf gewöhnlichem HTTP sperrt der Browser die Kamera grundsätzlich. Eine
 * Schaltfläche, die dann nur eine Erklärung ausspuckt, ist eine Enttäuschung
 * mit Vorlauf — besser, es steht gleich da, woran es liegt (ADR-0007).
 */
export function kameraVerfuegbar(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && kameraMoeglich()
}

export function QrScanner({
  aufCode,
  aufSchliessen,
  titel = 'Ausweis scannen'
}: {
  aufCode: (code: string) => void
  aufSchliessen: () => void
  titel?: string
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement | null>(null)
  const strom = useRef<MediaStream | null>(null)
  const fertig = useRef(false)
  const [fehler, setFehler] = useState<string | null>(null)

  /* Die Kamera abschalten — ausdrücklich und in jedem Ausgang. */
  const beenden = useCallback(() => {
    for (const spur of strom.current?.getTracks() ?? []) spur.stop()
    strom.current = null
  }, [])

  const treffer = useCallback(
    (gelesen: string) => {
      if (fertig.current) return
      fertig.current = true
      beenden()
      aufCode(codeAus(gelesen))
    },
    [aufCode, beenden]
  )

  useEffect(() => {
    let abgebrochen = false
    let takt: number | null = null

    const starten = async (): Promise<void> => {
      /*
       * **Zuerst die Herkunft, dann erst die Kamera.**
       *
       * Auf gewöhnlichem HTTP sperrt der Browser die Kamera grundsätzlich —
       * und meldet das je nach Fassung als „nicht erlaubt". Wer das für eine
       * verweigerte Erlaubnis hält, sucht den Fehler in den Einstellungen
       * seines Telefons und findet dort nichts. Deshalb wird gar nicht erst
       * gefragt, sondern gesagt, woran es liegt.
       */
      if (!window.isSecureContext) {
        setFehler(
          'Die Kamera ist gesperrt, weil diese Seite unverschlüsselt ausgeliefert wird — das entscheidet der Browser, nicht das Wahlprogramm. Bitte den Code eintippen. Dauerhaft behoben wird es am Hauptrechner unter Einstellungen → Netzwerk → Verschlüsselte Übertragung.'
        )
        return
      }
      if (!kameraMoeglich()) {
        setFehler('Dieses Gerät stellt keine Kamera zur Verfügung. Bitte den Code eintippen.')
        return
      }

      try {
        /* Die rückwärtige Kamera: Wer einen Ausweis scannt, hält ihn vor das
           Gerät, nicht vor sein Gesicht. */
        strom.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        })
      } catch (grund) {
        setFehler(
          grund instanceof Error && grund.name === 'NotAllowedError'
            ? 'Die Kamera wurde nicht freigegeben. Bitte den Code eintippen.'
            : 'Die Kamera lässt sich nicht öffnen. Bitte den Code eintippen.'
        )
        return
      }
      if (abgebrochen || !video.current) {
        beenden()
        return
      }
      video.current.srcObject = strom.current
      await video.current.play().catch(() => undefined)

      /* Der eingebaute Erkenner, wo es ihn gibt. */
      let leser: Strichcodeleser | null = null
      if (typeof BarcodeDetector !== 'undefined') {
        try {
          leser = new BarcodeDetector({ formats: ['qr_code'] })
        } catch {
          leser = null
        }
      }

      const flaeche = document.createElement('canvas')
      const stift = flaeche.getContext('2d', { willReadFrequently: true })
      let jsQR: ((daten: Uint8ClampedArray, breite: number, hoehe: number) => { data: string } | null) | null =
        null

      let laeuft = false
      const schauen = async (): Promise<void> => {
        const bild = video.current
        if (laeuft || abgebrochen || fertig.current || !bild || bild.readyState < 2) return
        laeuft = true
        try {
          if (leser) {
            const gefunden = await leser.detect(bild)
            if (gefunden[0]?.rawValue) treffer(gefunden[0].rawValue)
            return
          }
          if (!stift) return
          /* Der mitgelieferte Erkenner — erst jetzt geholt (ADR-0007). */
          if (!jsQR) jsQR = (await import('jsqr')).default
          flaeche.width = bild.videoWidth
          flaeche.height = bild.videoHeight
          if (!flaeche.width || !flaeche.height) return
          stift.drawImage(bild, 0, 0, flaeche.width, flaeche.height)
          const daten = stift.getImageData(0, 0, flaeche.width, flaeche.height)
          const gefunden = jsQR(daten.data, flaeche.width, flaeche.height)
          if (gefunden?.data) treffer(gefunden.data)
        } catch {
          /* Ein einzelnes Bild, das nicht taugt, ist kein Fehler — das nächste
             kommt in einem Sechstel einer Sekunde. */
        } finally {
          laeuft = false
        }
      }

      takt = window.setInterval(() => void schauen(), 160)
    }

    void starten()
    return () => {
      abgebrochen = true
      if (takt !== null) window.clearInterval(takt)
      beenden()
    }
  }, [beenden, treffer])

  return (
    <div className="qr-scanner">
      <div className="qr-kopf">
        <strong>{titel}</strong>
        <button
          onClick={() => {
            beenden()
            aufSchliessen()
          }}
        >
          Schließen
        </button>
      </div>
      {fehler ? (
        <p className="fehler">{fehler}</p>
      ) : (
        <>
          <video ref={video} playsInline muted className="qr-bild" />
          <p className="hint leise">
            Den QR-Code in das Bild halten. Es wird nichts aufgenommen und nichts gespeichert.
          </p>
        </>
      )}
    </div>
  )
}

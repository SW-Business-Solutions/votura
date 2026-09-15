/**
 * Das Kamerabild an der Wand — und die Bauchbinde darunter.
 *
 * ## Woher die Bilder kommen
 *
 * Nicht über die Brücke und nicht über den Zustand. Dieses Fenster meldet
 * sich an (`kameraAn`), bekommt daraufhin einen **eigenen Port** in die Seite
 * gereicht und empfängt darüber unmittelbar die Bilder aus dem Prozess, in
 * dem die NDI-Bindung läuft. Der Hauptprozess vermittelt einmal und ist dann
 * außen vor — bei 1920×1080 liefen sonst knapp 240 MB je Sekunde durch ihn
 * hindurch, während er die Wahl führt.
 *
 * ## Warum jedes Bild bestätigt wird
 *
 * Zeichnet dieses Gerät langsamer, als die Kamera liefert, wüchse die
 * Warteschlange im Port bis zum Speicherende. Jedes gezeichnete Bild wird
 * deshalb quittiert; die Gegenseite überspringt, was sie nicht loswird. Ein
 * übersprungenes Bild sieht niemand — ein volllaufender Speicher schon.
 *
 * ## Die Bauchbinde
 *
 * Sie ist der eigentliche Grund, warum dieses Programm Kamerabilder zeigt:
 * Votura weiß als Einziges im Saal, **wer** da vorne steht, wofür er sich
 * bewirbt und wie lange er noch hat. Getippt wird dafür nichts.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type JSX } from 'react'
import { KAMERA_STILLE_MS, bauchbinde, qualitaetFuer, type ProjectionCamera } from '@shared/kamera'
import { REDNER_VORSCHAU, redezeitRest, type ProjectionSpeaker } from '@shared/projection'

interface Props {
  camera: ProjectionCamera
  /** Wer aufgerufen ist — daraus entsteht die Bauchbinde. */
  speaker?: ProjectionSpeaker
  /** Logo der Veranstaltung, wenn eines hinterlegt ist. */
  logo?: string
  /** Vorschau in der Bedienung: kleiner, ohne Anspruch auf volle Qualität. */
  klein?: boolean
}

/** Was in der Seite ankommt, wenn der Hauptprozess einen Port hereinreicht. */
interface PortNachricht {
  art?: string
  kanal?: string
  quelle?: string
}

/** Ein Bild, so wie der Empfängerprozess es schickt. */
interface Kamerabild {
  breite: number
  hoehe: number
  stride: number
  daten: ArrayBuffer
}

/**
 * Wer hier ein Bild besorgen kann.
 *
 * Zwei Fenster zeigen Kamerabilder und haben verschiedene Brücken: die
 * Beameransicht (`projection`) und die Bedienung mit ihrer Vorschau
 * (`votura`). Beide können dasselbe, nur mit anderen Namen — der Unterschied
 * gehört an diese eine Stelle und nicht in die Zeichenlogik.
 */
interface Kamerabruecke {
  an(quelle: string, qualitaet: 'hoch' | 'vorschau', kanal: string): void
  aus(kanal: string): void
  /**
   * Wie der Kanal heißt, unter dem dieses Bild läuft.
   *
   * Im Beamerfenster und auf einem Saalgerät gibt es genau ein Bild; dort
   * heißt der Kanal schlicht `bild`. Die Bedienung zeigt dagegen **zwei** —
   * die Beamervorschau und die in der Kamerakarte. Bekämen beide denselben
   * Namen, würfe die zweite Anmeldung die erste hinaus, und eine der beiden
   * stünde auf „kein Bild“. Genau das ist passiert.
   */
  kanalName(eigen: string): string
}

function bruecke(): Kamerabruecke | undefined {
  const beamer = window.projection
  if (beamer?.kameraAn) {
    return {
      an: (quelle, qualitaet) => beamer.kameraAn?.(quelle, qualitaet),
      aus: () => beamer.kameraAus?.(),
      kanalName: () => 'bild'
    }
  }
  /*
   * Ein Gerät mit Votura Saal.
   *
   * Es zeigt dieselbe Seite wie jedes Gerät im Netz — nur empfängt es das
   * Kamerabild selbst, statt es sich vom Hauptrechner schicken zu lassen. Der
   * Zustand sagt ihm, **welche** Quelle; alles Weitere macht es allein.
   */
  const saal = window.voturaKamera
  if (saal) {
    return {
      an: (quelle, qualitaet) => saal.an(quelle, qualitaet),
      aus: () => saal.aus(),
      kanalName: () => 'bild'
    }
  }
  const bedienung = window.votura
  if (bedienung?.kameraAn) {
    return {
      an: (quelle, qualitaet, kanal) => bedienung.kameraAn({ quelle, qualitaet, kanal }),
      aus: (kanal) => bedienung.kameraAus(kanal),
      kanalName: (eigen) => eigen
    }
  }
  return undefined
}

declare global {
  interface Window {
    /** Nur auf einem Gerät mit Votura Saal vorhanden. */
    voturaKamera?: { an(quelle: string, qualitaet: 'hoch' | 'vorschau'): void; aus(): void }
  }
}

/**
 * Hängt dieses Gerät im Funknetz?
 *
 * Nur zur Wahl der Bildqualität. Die Auskunft ist nicht überall zu haben —
 * fehlt sie, gilt Kabel: Der Regelfall ist der Beamerrechner, und ein unnötig
 * grobes Bild an der Saalwand fällt auf.
 */
function ueberFunk(): boolean | undefined {
  const verbindung = (navigator as Navigator & { connection?: { type?: string } }).connection
  if (!verbindung?.type) return undefined
  return verbindung.type === 'wifi' || verbindung.type === 'cellular'
}

export function KameraBild({ camera, speaker, logo, klein }: Props): JSX.Element {
  const flaeche = useRef<HTMLCanvasElement>(null)
  const [laeuft, setLaeuft] = useState(false)
  /*
   * „Noch nie ein Bild“ und „Bild abgerissen“ sind zweierlei.
   *
   * Der Aufbau einer NDI-Verbindung dauert — gemessen zwei Sekunden bis
   * zum ersten Bild. Wer in dieser Zeit „kein Bild“ liest, sucht den
   * Fehler an der Kamera, wo keiner ist.
   */
  const [jeGesehen, setJeGesehen] = useState(false)
  const [imFenster] = useState(() => Boolean(bruecke()))
  /* Die Bedienung zeigt zwei Kamerabilder im selben Fenster — jedes braucht
     einen eigenen Kanal. `useId` gibt je Einbau einen. */
  const eigen = useId()
  const kanal = bruecke()?.kanalName(eigen) ?? 'bild'

  useEffect(() => {
    const bridge = bruecke()
    if (!bridge) return

    let port: MessagePort | undefined
    let letztesBild = 0
    let ziel: ImageData | undefined
    setJeGesehen(false)

    /*
     * Ein Bild landet auf der Fläche.
     *
     * `putImageData` ist hier die richtige Wahl und nicht `drawImage`: Die
     * Daten liegen bereits als Bildpunkte vor, und der Weg über ein
     * Zwischenbild kostete eine Kopie mehr, ohne etwas zu gewinnen.
     */
    const zeichne = (bild: Kamerabild): void => {
      const leinwand = flaeche.current
      if (!leinwand) return
      if (leinwand.width !== bild.breite || leinwand.height !== bild.hoehe) {
        leinwand.width = bild.breite
        leinwand.height = bild.hoehe
      }
      const stift = leinwand.getContext('2d')
      if (!stift) return

      /* Die Zielfläche wird **einmal** je Bildgröße angelegt und danach nur
         noch überschrieben: dreißigmal je Sekunde acht Megabyte neu zu
         belegen hieße, den Speichersammler zur Hauptarbeit zu machen. */
      if (!ziel || ziel.width !== bild.breite || ziel.height !== bild.hoehe) {
        ziel = stift.createImageData(bild.breite, bild.hoehe)
      }

      const punkte = new Uint8ClampedArray(bild.daten)
      const erwartet = bild.breite * 4
      if (bild.stride === erwartet) {
        ziel.data.set(punkte)
      } else {
        /*
         * NDI darf längere Zeilen liefern, als das Bild breit ist. Die
         * überzähligen Bytes am Zeilenende gehören nicht ins Bild — ohne
         * dieses zeilenweise Umschichten stünde es schräg.
         */
        for (let y = 0; y < bild.hoehe; y++) {
          ziel.data.set(punkte.subarray(y * bild.stride, y * bild.stride + erwartet), y * erwartet)
        }
      }

      /*
       * Deckkraft erzwingen.
       *
       * Bei RGBX trägt das vierte Byte keine Bedeutung — was drinsteht, ist
       * beliebig. Als Alphakanal gelesen wäre das ein Bild, das stellenweise
       * durchsichtig ist. Ein Durchgang über die Bildpunkte als 32-Bit-Werte
       * kostet wenig und macht es eindeutig.
       */
      const alsWorte = new Uint32Array(ziel.data.buffer, ziel.data.byteOffset, ziel.data.length / 4)
      for (let i = 0; i < alsWorte.length; i++) alsWorte[i] |= 0xff000000

      stift.putImageData(ziel, 0, 0)
      letztesBild = Date.now()
      setLaeuft(true)
      setJeGesehen(true)
      /* Quittung — siehe Modulkopf. */
      port?.postMessage(1)
    }

    const aufPort = (ereignis: MessageEvent): void => {
      const daten = ereignis.data as PortNachricht
      if (daten?.art !== 'votura-kamera') return
      if (daten.kanal !== kanal) return
      port?.close()
      port = ereignis.ports[0]
      port.onmessage = (nachricht) => zeichne(nachricht.data as Kamerabild)
      port.start()
    }

    window.addEventListener('message', aufPort)

    /*
     * Welche Qualität dieses Gerät anfordert.
     *
     * Die Vorschau in der Bedienung ist eine Briefmarke — dort das volle Bild
     * zu holen, hieße, dieselbe Bandbreite zweimal zu verbrauchen.
     */
    /* Die Vorschau in der Bedienung ist eine Briefmarke und nimmt immer
       den Nebenstrom; alle anderen richten sich nach ihrer Leitung. */
    bridge.an(camera.quelle, klein ? 'vorschau' : qualitaetFuer(ueberFunk()), kanal)

    /* Kommt nichts mehr, soll die Ansicht es sagen — nicht ein Standbild
       zeigen, das aussieht wie ein laufendes Bild. */
    const wache = window.setInterval(() => {
      if (letztesBild > 0 && Date.now() - letztesBild > KAMERA_STILLE_MS) setLaeuft(false)
    }, 1000)

    return () => {
      window.clearInterval(wache)
      window.removeEventListener('message', aufPort)
      port?.close()
      /* Abmelden ist nicht nur Aufräumen: Solange dieses Fenster angemeldet
         ist, hält der Empfängerprozess die Verbindung zur Kamera offen — und
         an der Kamera brennt das rote Licht. */
      bridge.aus(kanal)
    }
  }, [camera.quelle, klein, kanal])

  const bildStil: CSSProperties = camera.spiegeln ? { transform: 'scaleX(-1)' } : {}
  const inhalt = bauchbinde(speaker)

  return (
    <div className="kamera-bild">
      <canvas ref={flaeche} className="kamera-flaeche" style={bildStil} />
      {!laeuft && (
        <div className="kamera-warte">
          <div className="projection-status">KAMERA</div>
          <div className="projection-note">
            {!imFenster
              ? 'Kamerabilder gibt es nur am Hauptrechner und auf Votura Saal.'
              : jeGesehen
                ? `${camera.label ?? camera.quelle} — kein Bild`
                : `${camera.label ?? camera.quelle} — verbindet …`}
          </div>
        </div>
      )}
      {camera.bauchbinde && inhalt && <Bauchbinde inhalt={inhalt} logo={logo} speaker={speaker} />}
      {camera.naechste && <Naechste speaker={speaker} />}
    </div>
  )
}

/**
 * Wer danach an der Reihe ist.
 *
 * Dieselbe Reihe, die die Vorstellung an der Wand zeigt — nur über dem
 * Kamerabild. Bewusst auf der **anderen Seite** als die Bauchbinde und
 * kleiner: Sie ist eine Auskunft am Rand, kein Titel.
 */
export function Naechste({ speaker }: { speaker?: ProjectionSpeaker }): JSX.Element | null {
  const anzahl = speaker?.upcomingShown ?? REDNER_VORSCHAU
  const reihe = (speaker?.upcoming ?? []).slice(0, Math.max(0, anzahl))
  if (reihe.length === 0) return null
  return (
    <div className="kamera-naechste">
      <div className="kamera-naechste-titel">Als Nächstes</div>
      {/* Einer je Zeile. Als Aufzählung mit Trenner brach die Reihe mitten im
          Namen um — „Ruben ·" oben, „Thiele" darunter. */}
      <ol className="kamera-naechste-namen">
        {reihe.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Die Bauchbinde.
 *
 * Bewusst unten links und schmal: Sie steht über einem Gesicht und darf es
 * nicht verdecken. Die Redezeit bekommt einen Balken und keine große Ziffer —
 * an der Wand liest sie ohnehin niemand ab, aber jeder sieht, wie viel noch
 * übrig ist.
 */
export function Bauchbinde({
  inhalt,
  logo,
  speaker
}: {
  inhalt: NonNullable<ReturnType<typeof bauchbinde>>
  logo?: string
  speaker?: ProjectionSpeaker
}): JSX.Element {
  /*
   * Die Uhr läuft in der Ansicht weiter, nicht im Zustand.
   *
   * Im Zustand steht ein Zeitpunkt; jede Sekunde eine neue Nachricht durch
   * alle Leitungen zu schicken, nur damit eine Zahl kleiner wird, wäre
   * Verschwendung — und Geräte, die gerade nicht zuhören, hinkten hinterher.
   */
  const [, takt] = useState(0)
  useEffect(() => {
    if (!speaker?.until || speaker.pausedSecondsLeft !== undefined) return
    const uhr = window.setInterval(() => takt((n) => n + 1), 1000)
    return () => window.clearInterval(uhr)
  }, [speaker?.until, speaker?.pausedSecondsLeft])

  const rest = speaker ? redezeitRest(speaker) : undefined
  const anteil =
    inhalt.gesamtSekunden && inhalt.gesamtSekunden > 0 && rest !== undefined
      ? Math.min(1, Math.max(0, 1 - rest / inhalt.gesamtSekunden))
      : undefined

  return (
    <div className="kamera-bauchbinde">
      {logo && <img className="kamera-bauchbinde-logo" src={logo} alt="" />}
      <div className="kamera-bauchbinde-text">
        <div className="kamera-bauchbinde-name">{inhalt.name}</div>
        {inhalt.zusatz && <div className="kamera-bauchbinde-zusatz">{inhalt.zusatz}</div>}
      </div>
      {anteil !== undefined && (
        <div
          className={`kamera-bauchbinde-uhr${inhalt.angehalten ? ' ruht' : ''}`}
          aria-label="Verbleibende Redezeit"
        >
          <div className="kamera-bauchbinde-balken" style={{ width: `${Math.round((1 - anteil) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

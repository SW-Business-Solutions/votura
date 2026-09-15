/**
 * Der Kameraempfänger — ein eigener Prozess.
 *
 * Hier und nur hier läuft die NDI-Bindung. Das ist keine Ordnungsliebe,
 * sondern eine Sicherheitsentscheidung: Die Bibliothek dahinter ist fremder,
 * nativer Code. Stürzte sie im Hauptprozess ab, risse sie die laufende
 * Versammlung mit — Stimmen, Auszählung, Protokoll. In einem eigenen Prozess
 * fällt bestenfalls das Bild aus, und die Wahl läuft weiter.
 *
 * ## Wohin die Bilder gehen
 *
 * Nicht zum Hauptprozess. Jeder Empfänger bekommt beim Öffnen einen **Kanal
 * direkt zum Fenster**, das das Bild zeigt. Der Hauptprozess vermittelt die
 * Verbindung und sieht danach kein einziges Bild mehr — bei 1920×1080 wären
 * das knapp 240 MB je Sekunde durch einen Prozess, der nebenbei eine Wahl
 * führt.
 *
 * ## Warum kein `require`
 *
 * `grandi` ist ein reines ES-Modul, dieser Prozess wird als CommonJS gebaut.
 * Ein `import` hier oben würde beim Bauen zu `require` umgeschrieben und
 * liefe auf die Meldung „require() of ES Module" hinaus. Der Umweg über
 * `new Function` ist deshalb Absicht: Er ist für den Bündler undurchsichtig
 * und bleibt bis zur Laufzeit ein echtes `import()`.
 *
 * NDI® ist eine eingetragene Marke der Vizrt NDI AB.
 */
import type { MessagePortMain } from 'electron'
import type { KameraQualitaet, KameraQuelle } from '@shared/kamera'

/* Siehe Modulkopf: absichtlich für den Bündler undurchsichtig. */
const ladeModul = new Function('name', 'return import(name)') as (name: string) => Promise<unknown>

/** Was der Hauptprozess schicken kann. */
export type AnEmpfaenger =
  | { art: 'suche'; an: boolean }
  | { art: 'oeffnen'; kanal: string; quelle: string; qualitaet: KameraQualitaet }
  | { art: 'schliessen'; kanal: string }

/** Was der Empfänger zurückmeldet. */
export type VomEmpfaenger =
  | { art: 'bereit'; sdk: string }
  | { art: 'untauglich'; grund: string }
  | { art: 'quellen'; quellen: KameraQuelle[] }
  | { art: 'kanal'; kanal: string; verbunden: boolean; quelle: string }
  | { art: 'fehler'; text: string; kanal?: string }

/** Ein Bild, so wie es im Fenster ankommt. */
export interface Kamerabild {
  breite: number
  hoehe: number
  /** Bytes je Zeile — bei NDI nicht zwingend `breite * 4`. */
  stride: number
  daten: ArrayBuffer
}

/*
 * Wie viele Bilder unterwegs sein dürfen, bevor weitere übersprungen werden.
 *
 * Der Kanal zum Fenster nimmt alles an, was man hineinsteckt. Zeichnet das
 * Fenster langsamer, als die Kamera liefert — ein Pi bei 1080p —, wüchse die
 * Warteschlange bis zum Speicherende. Zwei ausstehende Bilder halten den
 * Fluss glatt; alles darüber ist ohnehin veraltet, bevor es gezeichnet wird.
 */
const AUSSTEHEND_MAX = 2

interface NdiEmpfaenger {
  video(timeoutMs?: number): Promise<{
    xres: number
    yres: number
    lineStrideBytes: number
    data: Buffer
  }>
  tally(zustand: { onProgram?: boolean; onPreview?: boolean }): boolean
  destroy(): boolean
}

interface Verbindung {
  port: MessagePortMain
  quelle: string
  ausstehend: number
  lauf: boolean
  empfaenger?: NdiEmpfaenger
}

const verbindungen = new Map<string, Verbindung>()

/*
 * Die Bibliothek wird zur Laufzeit geladen (siehe Modulkopf) und hat deshalb
 * hier keinen Typ aus dem Paket. Die drei Aufrufe, die benutzt werden, stehen
 * stattdessen hier — schmal, aber geprüft.
 */
interface NdiModul {
  isSupportedCPU(): boolean
  initialize(): boolean
  version(): string
  ColorFormat?: { RGBX_RGBA: number }
  find(optionen: { showLocalSources?: boolean }): Promise<NdiSucher>
  receive(optionen: {
    source: { name: string }
    colorFormat?: number
    bandwidth?: number
    name?: string
  }): Promise<NdiEmpfaenger>
}

interface NdiSucher {
  sources(): { name: string; urlAddress?: string }[]
  destroy(): boolean
}

let ndi: NdiModul | undefined
let sucher: NdiSucher | undefined
let sucheTakt: NodeJS.Timeout | undefined

function melde(nachricht: VomEmpfaenger): void {
  process.parentPort.postMessage(nachricht)
}

async function starte(): Promise<void> {
  try {
    ndi = ((await ladeModul('grandi')) as { default: NdiModul }).default
  } catch (fehler) {
    melde({
      art: 'untauglich',
      grund: `Die NDI-Bibliothek ließ sich nicht laden: ${(fehler as Error)?.message ?? String(fehler)}`
    })
    return
  }
  if (!ndi.isSupportedCPU()) {
    melde({ art: 'untauglich', grund: 'NDI wird auf diesem Prozessor nicht unterstützt.' })
    return
  }
  if (!ndi.initialize()) {
    melde({ art: 'untauglich', grund: 'Die NDI-Bibliothek ließ sich nicht starten.' })
    return
  }
  melde({ art: 'bereit', sdk: String(ndi.version()) })
}

/**
 * Die Suche nach Quellen im Netz.
 *
 * Sie läuft nur, solange jemand hinschaut. NDI meldet sich dabei selbst im
 * Netz an und fragt herum — auf einer Versammlung ohne Kameras wäre das
 * Grundrauschen ohne Zweck.
 */
async function suche(an: boolean): Promise<void> {
  if (!ndi) return
  if (!an) {
    if (sucheTakt) clearInterval(sucheTakt)
    sucheTakt = undefined
    sucher?.destroy()
    sucher = undefined
    return
  }
  if (sucher) return
  sucher = await ndi.find({ showLocalSources: true })
  const melden = (): void => {
    const quellen: KameraQuelle[] = (sucher?.sources() ?? []).map((q) => ({
      name: q.name,
      adresse: q.urlAddress
    }))
    melde({ art: 'quellen', quellen })
  }
  melden()
  sucheTakt = setInterval(melden, 2000)
}

async function oeffne(
  kanal: string,
  quelle: string,
  qualitaet: KameraQualitaet,
  port: MessagePortMain
): Promise<void> {
  schliesse(kanal)
  const verbindung: Verbindung = { port, quelle, ausstehend: 0, lauf: true }
  verbindungen.set(kanal, verbindung)

  /* Das Fenster bestätigt jedes gezeichnete Bild. Nur so lässt sich sagen,
     ob es mitkommt — siehe AUSSTEHEND_MAX. */
  port.on('message', () => {
    if (verbindung.ausstehend > 0) verbindung.ausstehend--
  })
  port.start()

  if (!ndi) {
    melde({ art: 'fehler', kanal, text: 'Ohne NDI-Bibliothek gibt es kein Kamerabild.' })
    return
  }

  let empfaenger: NdiEmpfaenger
  try {
    empfaenger = await ndi.receive({
      source: { name: quelle },
      colorFormat: ndi.ColorFormat?.RGBX_RGBA ?? 2,
      bandwidth: qualitaet === 'vorschau' ? 0 : 100,
      name: 'Votura'
    })
  } catch (fehler) {
    melde({
      art: 'fehler',
      kanal,
      text: `Die Kamera „${quelle}" nimmt keine Verbindung an: ${(fehler as Error)?.message ?? String(fehler)}`
    })
    return
  }
  verbindung.empfaenger = empfaenger

  /*
   * Das rote Licht an der Kamera.
   *
   * Wer gefilmt wird, soll es sehen — und wer neben der Kamera steht, soll
   * wissen, ob ihr Bild gerade an der Wand hängt. NDI trägt das von sich aus
   * bis zur Kamera zurück.
   */
  try {
    empfaenger.tally({ onProgram: true, onPreview: false })
  } catch {
    /* Nicht jede Quelle kann Tally. Das ist kein Grund, kein Bild zu zeigen. */
  }

  melde({ art: 'kanal', kanal, verbunden: true, quelle })

  while (verbindung.lauf) {
    let bild: { xres: number; yres: number; lineStrideBytes: number; data: Buffer } | undefined
    try {
      bild = await empfaenger.video(2000)
    } catch {
      /* Zeitüberschreitung: Die Kamera schweigt gerade. Weiterversuchen — eine
         abgesteckte Kamera meldet sich wieder, wenn sie zurückkommt. */
      continue
    }
    if (!verbindung.lauf) break
    if (!bild?.data) continue
    if (verbindung.ausstehend >= AUSSTEHEND_MAX) continue

    /*
     * Eine eigene Kopie, und zwar bewusst.
     *
     * Der Puffer aus der Bibliothek zeigt in deren Speicher und gilt nur bis
     * zum nächsten Bild. Ihn ohne Kopie weiterzureichen hieße, ihn unter der
     * Hand ausgetauscht zu bekommen.
     */
    const daten = bild.data.buffer.slice(
      bild.data.byteOffset,
      bild.data.byteOffset + bild.data.byteLength
    ) as ArrayBuffer
    verbindung.ausstehend++
    const inhalt: Kamerabild = {
      breite: bild.xres,
      hoehe: bild.yres,
      stride: bild.lineStrideBytes,
      daten
    }
    try {
      verbindung.port.postMessage(inhalt)
    } catch {
      verbindung.lauf = false
    }
  }

  try {
    empfaenger.tally({ onProgram: false, onPreview: false })
    empfaenger.destroy()
  } catch {
    /* Beim Schließen ist ein Fehler folgenlos. */
  }
  melde({ art: 'kanal', kanal, verbunden: false, quelle })
}

function schliesse(kanal: string): void {
  const verbindung = verbindungen.get(kanal)
  if (!verbindung) return
  verbindung.lauf = false
  verbindungen.delete(kanal)
  try {
    verbindung.port.close()
  } catch {
    /* Schon zu. */
  }
}

process.parentPort.on('message', (nachricht) => {
  const daten = nachricht.data as AnEmpfaenger
  if (daten.art === 'suche') void suche(daten.an)
  else if (daten.art === 'oeffnen')
    void oeffne(daten.kanal, daten.quelle, daten.qualitaet, nachricht.ports[0])
  else if (daten.art === 'schliessen') schliesse(daten.kanal)
})

void starte()

/**
 * Kameras im Saal — die Vermittlung.
 *
 * Dieser Dienst hält **kein einziges Bild**. Er startet den Prozess, in dem
 * die NDI-Bindung läuft (`src/ndi/empfaenger.ts`), führt die Liste der
 * gefundenen Quellen und legt zwischen jenem Prozess und einem Fenster einen
 * Kanal, über den die Bilder danach direkt laufen.
 *
 * ## Warum erst auf Verlangen
 *
 * Der Empfängerprozess startet nicht beim Programmstart, sondern beim ersten
 * Blick in die Kameraliste. Eine Versammlung ohne Kameras — der Regelfall —
 * merkt dadurch nichts davon: kein fremder Code im Speicher, keine
 * NDI-Anmeldung im Netz, kein Prozess in der Aufgabenliste.
 *
 * ## Was passiert, wenn er abstürzt
 *
 * Er wird neu gestartet, aber nicht endlos. Ein Prozess, der immer wieder
 * fällt, hat einen Grund dafür; ihn in einer Schleife neu zu starten,
 * verbrennt Rechenzeit, die an diesem Tag anderswo gebraucht wird. Nach
 * `NEUSTARTS_MAX` bleibt er unten, und die Oberfläche sagt es.
 *
 * NDI® ist eine eingetragene Marke der Vizrt NDI AB.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import type { KameraQualitaet, KameraQuelle, KameraStand } from '@shared/kamera'
import type { AnEmpfaenger, VomEmpfaenger } from '../../ndi/empfaenger'
import { logger } from '../logger'

/** Wie oft der Empfängerprozess nach einem Absturz neu anläuft. */
const NEUSTARTS_MAX = 3

/**
 * Wie lange eine gefundene Quelle in der Liste bleibt, nachdem sie
 * verschwunden ist.
 *
 * NDI meldet Quellen nicht ab, es hört nur auf, sie zu melden — und eine
 * Kamera, die kurz aus dem Funk fällt, wäre sonst aus der Liste weg, während
 * jemand sie gerade anklickt.
 */
const QUELLE_GNADENFRIST_MS = 8000

/**
 * Wie lange die Suche nach dem letzten Hinsehen noch weiterläuft.
 *
 * Sie sofort abzuschalten war ein Fehlgriff: Wer zwischen Kamerakarte,
 * Videoliste und Einstellungen hin- und herblättert, fing jedes Mal von vorn
 * an und sah für ein paar Sekunden eine leere Liste. Dahinter stand die Sorge,
 * NDI dürfe im Saal nicht dauernd laufen — die galt aber dem **Videostrom**,
 * der über hundert Megabit belegt, nicht der Suche, die ein paar Pakete
 * verschickt.
 *
 * Eine Minute Nachlauf trifft beides: kein Neuanfang beim Blättern, und auf
 * einer Versammlung ohne Kameras bleibt am Ende trotzdem Ruhe im Netz.
 */
const SUCHE_NACHLAUF_MS = 60_000

type Horcher = (stand: KameraStand) => void

let prozess: UtilityProcess | undefined
let neustarts = 0
let sdk: string | undefined
let untauglich: string | undefined
let letzterFehler: string | undefined
let sucheLaeuft = false
let nachlauf: NodeJS.Timeout | undefined

/** Gefundene Quellen mit dem Zeitpunkt der letzten Meldung. */
const gesehen = new Map<string, { quelle: KameraQuelle; zuletzt: number }>()
const horcher = new Set<Horcher>()

/** Fenster, an denen schon ein Aufräumer hängt. */
const beobachtet = new WeakSet<WebContents>()

/** Offene Kanäle, damit sie beim Neustart nicht als Leichen zurückbleiben. */
const kanaele = new Map<string, { quelle: string; empfaenger: WebContents }>()

export function onKameraStand(listener: Horcher): () => void {
  horcher.add(listener)
  return () => horcher.delete(listener)
}

function melde(): void {
  const stand = kameraStand()
  for (const listener of horcher) listener(stand)
}

export function kameraStand(): KameraStand {
  const jetzt = Date.now()
  /*
   * Die Gnadenfrist gilt nur, **solange gesucht wird**.
   *
   * Dann sagt das Ausbleiben einer Meldung etwas: Die Kamera ist weg. Läuft
   * keine Suche, sagt es gar nichts — dann ist der letzte bekannte Stand die
   * beste Auskunft, die es gibt, und allemal besser als eine leere Liste.
   */
  const quellen = [...gesehen.values()]
    .filter((eintrag) => !sucheLaeuft || jetzt - eintrag.zuletzt <= QUELLE_GNADENFRIST_MS)
    .map((eintrag) => eintrag.quelle)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return {
    bereit: Boolean(prozess) && !untauglich,
    sdk,
    untauglich,
    sucht: sucheLaeuft,
    quellen,
    fehler: letzterFehler
  }
}

/**
 * Wo der Empfängerprozess liegt.
 *
 * Nicht einfach `__dirname`: Dieser Dienst wird vom Bündler in einen
 * **gemeinsamen Baustein** gezogen, sobald ihn sowohl der Hauptrechner als
 * auch Votura Saal benutzt — und der liegt einen Ordner tiefer, in `chunks/`.
 * `__dirname` zeigte dann dorthin, die Datei war nicht da, und der Prozess
 * starb beim Start. Viermal hintereinander, dann blieb er unten: ein Fehler,
 * den es in der Entwicklungsfassung nicht gibt und der erst im gebauten
 * Programm auftaucht.
 *
 * Darum werden die möglichen Orte der Reihe nach geprüft, statt einen
 * anzunehmen.
 */
function pfadZumEmpfaenger(): string | undefined {
  const kandidaten = [
    join(app.getAppPath(), 'out', 'main', 'kamera-empfaenger.js'),
    join(__dirname, 'kamera-empfaenger.js'),
    join(__dirname, '..', 'kamera-empfaenger.js')
  ]
  return kandidaten.find((kandidat) => existsSync(kandidat))
}

function starte(): UtilityProcess | undefined {
  if (prozess) return prozess
  if (untauglich) return undefined
  if (neustarts > NEUSTARTS_MAX) return undefined

  const pfad = pfadZumEmpfaenger()
  if (!pfad) {
    /* Lieber eine klare Auskunft als vier Fehlstarts: Fehlt die Datei, wird
       sie auch beim fünften Versuch nicht da sein. */
    untauglich = 'Der Kameraempfänger fehlt in dieser Installation.'
    logger.error('Kameraempfänger nicht gefunden — Kamerabilder bleiben aus.')
    melde()
    return undefined
  }

  const kind = utilityProcess.fork(pfad, [], {
    serviceName: 'votura-kamera',
    /*
     * Die Ausgabe des Kindes wird mitgelesen, nicht weggeworfen.
     *
     * Ein Prozess, der abstürzt, ohne eine Zeile zu hinterlassen, ist im Saal
     * nicht zu diagnostizieren — und genau dort passiert es. Was hier
     * ankommt, gehört ins technische Protokoll.
     */
    stdio: 'pipe'
  })
  prozess = kind

  kind.stderr?.on('data', (brocken: Buffer) => {
    const text = String(brocken).trim()
    if (text) logger.error(`Kameraempfänger: ${text}`)
  })
  kind.stdout?.on('data', (brocken: Buffer) => {
    const text = String(brocken).trim()
    if (text) logger.info(`Kameraempfänger: ${text}`)
  })

  kind.on('message', (nachricht: VomEmpfaenger) => {
    if (nachricht.art === 'bereit') {
      sdk = nachricht.sdk
      logger.info(`Kameraempfänger bereit (${nachricht.sdk})`)
      /* Ein Neustart hat die Suche vergessen — sie wird wieder angestellt,
         wenn vorher jemand hingeschaut hat. */
      if (sucheLaeuft) sende({ art: 'suche', an: true })
      melde()
    } else if (nachricht.art === 'untauglich') {
      untauglich = nachricht.grund
      logger.warn(`Kameras auf diesem Rechner nicht verfügbar: ${nachricht.grund}`)
      melde()
    } else if (nachricht.art === 'quellen') {
      const jetzt = Date.now()
      for (const quelle of nachricht.quellen) gesehen.set(quelle.name, { quelle, zuletzt: jetzt })
      melde()
    } else if (nachricht.art === 'fehler') {
      letzterFehler = nachricht.text
      logger.warn(`Kamera meldet eine Störung: ${nachricht.text}`)
      melde()
    }
  })

  kind.on('exit', (code) => {
    prozess = undefined
    kanaele.clear()
    if (untauglich) return
    neustarts++
    logger.warn(`Kameraempfänger beendet (Code ${code}), Neustart ${neustarts}`)
    if (neustarts > NEUSTARTS_MAX) {
      letzterFehler =
        'Der Kameraempfänger ist mehrfach abgestürzt und bleibt aus. Ein Neustart des Programms setzt ihn zurück.'
      melde()
      return
    }
    /* Wieder hoch — die Fenster melden sich von selbst neu an, sobald sie
       merken, dass kein Bild mehr kommt. */
    starte()
    melde()
  })

  return kind
}

function sende(nachricht: AnEmpfaenger, ports?: Electron.MessagePortMain[]): void {
  const kind = starte()
  if (!kind) return
  kind.postMessage(nachricht, ports)
}

/**
 * Die Suche an- oder abstellen.
 *
 * Angestellt wird sie, solange jemand die Kameraliste offen hat — und wieder
 * abgestellt, wenn nicht. Siehe `src/ndi/empfaenger.ts`: NDI fragt dafür im
 * Netz herum, und das soll nicht den ganzen Tag laufen.
 */
export function sucheKameras(an: boolean): KameraStand {
  if (nachlauf) {
    clearTimeout(nachlauf)
    nachlauf = undefined
  }

  if (an) {
    sucheLaeuft = true
    starte()
    sende({ art: 'suche', an: true })
    return kameraStand()
  }

  /*
   * Nicht sofort ausschalten — siehe SUCHE_NACHLAUF_MS. Und die gefundenen
   * Quellen bleiben ohnehin stehen: Eine Kamera, die vor einer Minute im Netz
   * war, ist mit großer Wahrscheinlichkeit noch da. Sie zu vergessen hieße,
   * die Liste bei jedem Blick neu aufbauen zu lassen.
   */
  nachlauf = setTimeout(() => {
    nachlauf = undefined
    sucheLaeuft = false
    if (prozess) prozess.postMessage({ art: 'suche', an: false } satisfies AnEmpfaenger)
    melde()
  }, SUCHE_NACHLAUF_MS)

  return kameraStand()
}

/**
 * Ein Fenster an eine Kamera anschließen.
 *
 * Der Kanal gehört dem Fenster, nicht der Bühne: Zwei Fenster auf derselben
 * Bühne — der Beamer und die Vorschau in der Bedienung — brauchen jedes ihr
 * eigenes Bild, und wenn eines zugeht, soll das andere weiterlaufen.
 */
export function kameraAn(
  empfaenger: WebContents,
  quelle: string,
  qualitaet: KameraQualitaet,
  kanalName: string
): void {
  const kind = starte()
  if (!kind) return
  const kanal = `${empfaenger.id}:${kanalName}`
  kameraAus(empfaenger, kanalName)

  const { port1, port2 } = new MessageChannelMain()
  empfaenger.postMessage('wz:kamera-port', { kanal: kanalName, quelle }, [port2])
  /*
   * Die Adresse aus der Suche wandert mit.
   *
   * Gemessen: Ohne sie braucht NDI vier Sekunden bis zum ersten Bild, mit ihr
   * zwei. Wir kennen sie ohnehin — sie nicht weiterzureichen hieße, die
   * Kamera zweimal suchen zu lassen.
   */
  const adresse = gesehen.get(quelle)?.quelle.adresse
  kind.postMessage(
    { art: 'oeffnen', kanal, quelle, qualitaet, adresse } satisfies AnEmpfaenger,
    [port1]
  )
  kanaele.set(kanal, { quelle, empfaenger })

  /*
   * Ein geschlossenes Fenster kann niemand mehr fragen — es meldet sich nicht
   * ab, es ist einfach weg. Der Aufräumer hängt deshalb am Fenster und nicht
   * am Kanal, und er hängt **einmal**: Bei jedem Kamerawechsel einen weiteren
   * anzuhängen, hieße, dieselbe Arbeit später zehnmal zu tun.
   */
  if (!beobachtet.has(empfaenger)) {
    beobachtet.add(empfaenger)
    empfaenger.once('destroyed', () => {
      beobachtet.delete(empfaenger)
      for (const [name, eintrag] of kanaele) {
        if (eintrag.empfaenger !== empfaenger) continue
        kanaele.delete(name)
        if (prozess) prozess.postMessage({ art: 'schliessen', kanal: name } satisfies AnEmpfaenger)
      }
    })
  }
}

export function kameraAus(empfaenger: WebContents, kanalName: string): void {
  const kanal = `${empfaenger.id}:${kanalName}`
  if (!kanaele.has(kanal)) return
  kanaele.delete(kanal)
  /* Kein `sende` hier: Das würde den Empfängerprozess notfalls starten — um
     ihm zu sagen, dass er etwas schließen soll, das es nicht gibt. */
  if (prozess) prozess.postMessage({ art: 'schliessen', kanal } satisfies AnEmpfaenger)
}

/** Beim Beenden: den Prozess mitnehmen, statt ihn stehen zu lassen. */
export function beendeKameras(): void {
  if (!prozess) return
  const kind = prozess
  prozess = undefined
  kanaele.clear()
  try {
    kind.kill()
  } catch {
    /* Schon weg. */
  }
}

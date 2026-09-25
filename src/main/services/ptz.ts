/**
 * Kameras steuern — der Weg zur Kamera.
 *
 * Was gesendet wird, steht in `src/shared/ptz.ts` und ist dort als reine
 * Rechnung geprüft. Hier geht es nur noch darum, die Bytes über das Netz zu
 * bringen: über UDP oder TCP, roh oder in Sonys Umschlag.
 *
 * ## Warum keine Dauerverbindung
 *
 * Eine PTZ-Kamera wird auf einer Versammlung vielleicht zwanzigmal
 * angesprochen — beim Aufruf eines Redners, in der Pause, am Ende. Dafür eine
 * Verbindung über Stunden offen zu halten, hieße, einen Zustand zu pflegen,
 * der die meiste Zeit nichts tut und nach jedem Netzhänger wieder aufgebaut
 * werden müsste. Jeder Befehl bringt seine eigene Verbindung mit und räumt
 * sie hinter sich weg.
 *
 * Bei gekapseltem VISCA kostet das eine zusätzliche Nachricht: Die Laufnummer
 * wird zu Beginn zurückgesetzt, sonst hielte die Kamera das neue Paket für
 * ein altes und schwiege.
 *
 * ## Warum die Erkennung
 *
 * Der Port verrät die Spielart nicht — PTZOptics spricht rohes VISCA auf
 * demselben Port, auf dem Sony gekapseltes spricht, und Handbücher schweigen
 * dazu oft. Statt die Wahlleitung raten zu lassen, klopft Votura eine
 * unbekannte Kamera mit einer **harmlosen Frage** ab und nimmt die Form, die
 * antwortet.
 */
import { createSocket } from 'node:dgram'
import { connect } from 'node:net'
import {
  PTZ_ERKENNUNG,
  istViscaAntwort,
  pantiltAusAntwort,
  viscaFragePosition,
  viscaPositionAbsolut,
  viscaZoomAbsolut,
  zoomAusAntwort,
  ptzAntwort,
  ptzPaket,
  ptzProfil,
  ptzTempo,
  rahmeFolgeZuruecksetzen,
  viscaAutofokus,
  viscaFrageZoom,
  viscaHeim,
  viscaPresetAbrufen,
  viscaPresetSpeichern,
  viscaSchwenkStopp,
  viscaSchwenken,
  viscaZoom,
  type PtzKamera,
  type PtzFund,
  type PtzProfil,
  type PtzRichtung,
  type PtzStellung
} from '@shared/ptz'
import { getPtzKameras } from './settings'
import { requirePermission } from './auth'
import { logger } from '../logger'

/**
 * Wie lange auf eine Antwort gewartet wird.
 *
 * Eine Kamera im selben Netz antwortet in Millisekunden. Eine Sekunde ist
 * großzügig und immer noch kurz genug, dass eine Reihe von drei Versuchen bei
 * der Erkennung niemanden warten lässt.
 */
const ANTWORT_MS = 1000

/** Ergebnis eines Sendevorgangs. */
interface Sendung {
  /** Hat überhaupt jemand geantwortet? */
  antwort?: Uint8Array
  fehler?: string
}

function zielPort(kamera: PtzKamera, profil: PtzProfil): number {
  return kamera.port && kamera.port > 0 ? kamera.port : profil.port
}

/**
 * Ein Paket über UDP hinausschicken und kurz auf Antwort warten.
 *
 * Ohne Antwort ist es kein Fehler: Viele Kameras bestätigen einen Befehl,
 * manche nicht, und die OBSBOT antwortet, bevor sie sich bewegt hat. Wer
 * daraus „hat nicht geklappt" machte, meldete Störungen, wo keine sind.
 */
function sendeUdp(host: string, port: number, paket: Uint8Array, warten: boolean): Promise<Sendung> {
  return new Promise((fertig) => {
    const draht = createSocket('udp4')
    let erledigt = false
    const schliessen = (ergebnis: Sendung): void => {
      if (erledigt) return
      erledigt = true
      clearTimeout(uhr)
      try {
        draht.close()
      } catch {
        /* Schon zu. */
      }
      fertig(ergebnis)
    }

    const uhr = setTimeout(() => schliessen({}), warten ? ANTWORT_MS : 150)
    draht.on('message', (brocken) => schliessen({ antwort: new Uint8Array(brocken) }))
    draht.on('error', (fehler) => schliessen({ fehler: fehler.message }))
    draht.send(paket, port, host, (fehler) => {
      if (fehler) schliessen({ fehler: fehler.message })
    })
  })
}

/** Dasselbe über TCP. */
function sendeTcp(host: string, port: number, paket: Uint8Array, warten: boolean): Promise<Sendung> {
  return new Promise((fertig) => {
    const draht = connect({ host, port })
    let erledigt = false
    const schliessen = (ergebnis: Sendung): void => {
      if (erledigt) return
      erledigt = true
      clearTimeout(uhr)
      draht.destroy()
      fertig(ergebnis)
    }

    const uhr = setTimeout(() => schliessen({}), warten ? ANTWORT_MS : 400)
    draht.on('connect', () => draht.write(paket))
    draht.on('data', (brocken) => schliessen({ antwort: new Uint8Array(brocken) }))
    draht.on('error', (fehler) => schliessen({ fehler: fehler.message }))
  })
}

/**
 * Einen Befehl an eine Kamera schicken.
 *
 * `warten` sagt, ob auf eine Antwort gewartet wird. Beim Abrufen einer
 * Position ist das unnötig — der Befehl ist unterwegs, und die Kamera fährt.
 * Beim Erkennen ist die Antwort der ganze Zweck.
 */
async function sende(
  profil: PtzProfil,
  host: string,
  port: number,
  nutzlast: Uint8Array,
  optionen: { warten?: boolean; art?: 'befehl' | 'frage' } = {}
): Promise<Sendung> {
  const warten = optionen.warten ?? false
  const weg = profil.transport === 'tcp' ? sendeTcp : sendeUdp

  /*
   * Bei Sonys Umschlag geht eine Steuernachricht voraus, die die Laufnummer
   * zurücksetzt. Sie kostet ein Paket und erspart den Fall, in dem die Kamera
   * nach einem Neustart von Votura stumm bleibt.
   */
  if (profil.rahmung === 'gekapselt') {
    await weg(host, port, rahmeFolgeZuruecksetzen(), false)
  }

  const paket = ptzPaket(profil, nutzlast, 1, optionen.art ?? 'befehl')
  const ergebnis = await weg(host, port, paket, warten)
  if (!ergebnis.antwort) return ergebnis
  return { ...ergebnis, antwort: ptzAntwort(profil, ergebnis.antwort) }
}

function kameraVon(id: string): { kamera: PtzKamera; profil: PtzProfil } {
  const kamera = getPtzKameras().find((eintrag) => eintrag.id === id)
  if (!kamera) throw new Error('Diese Kamera ist nicht eingerichtet.')
  if (!kamera.enabled) throw new Error(`„${kamera.name}" ist abgeschaltet.`)
  const profil = ptzProfil(kamera.profil)
  if (!profil) throw new Error(`Zu „${kamera.name}" ist kein bekanntes Kameraprofil hinterlegt.`)
  return { kamera, profil }
}

async function anDieKamera(id: string, nutzlast: Uint8Array): Promise<void> {
  const { kamera, profil } = kameraVon(id)
  const ergebnis = await sende(profil, kamera.host, zielPort(kamera, profil), nutzlast)
  if (ergebnis.fehler) {
    throw new Error(`„${kamera.name}" ist nicht erreichbar: ${ergebnis.fehler}`)
  }
}

/* ------------------------------------------------------------- Die Befehle */

/**
 * Eine Position anfahren.
 *
 * Zwei Wege, und der Unterschied liegt nicht bei Votura, sondern bei der
 * Kamera: Hat sie einen eigenen Positionsspeicher, bekommt sie die Nummer und
 * fährt selbst — das ist schneller und überlebt einen Wechsel des Rechners.
 * Hat sie keinen, stehen die Zahlen in Voturas Datenbank, und sie bekommt sie
 * geschickt.
 */
export async function ptzPositionAbrufen(
  id: string,
  nummer: number,
  tempo?: number
): Promise<void> {
  requirePermission('round.manage')
  const { kamera, profil } = kameraVon(id)
  const position = kamera.positionen.find((eintrag) => eintrag.nummer === nummer)

  if (kamera.ablage === 'votura') {
    if (!position?.koordinaten) {
      throw new Error(
        `Zu „${position?.name ?? nummer}" ist keine Stellung hinterlegt. Die Kamera dorthin stellen und „Hier ablegen" drücken.`
      )
    }
    /*
     * So schnell, wie für diese Kamera eingestellt ist.
     *
     * Hier stand eine feste Zahl mit dem Vermerk, ein Schwenk vor Publikum
     * dürfe nicht hetzen. Das stimmt — nur ist es keine Entscheidung, die
     * hier zu treffen ist: Wie ruhig es aussehen muss, hängt an der
     * Leinwand, am Saal und daran, ob gerade eingerichtet oder getagt wird.
     */
    const anteil = ptzTempo(tempo === undefined ? kamera : { tempo })
    await anDieKamera(
      id,
      viscaPositionAbsolut(
        position.koordinaten,
        Math.round(profil.tempoMax.schwenk * anteil),
        Math.round(profil.tempoMax.neigen * anteil),
        profil.geraet
      )
    )
    await anDieKamera(id, viscaZoomAbsolut(position.koordinaten.zoom, profil.geraet))
    return
  }

  /*
   * Die Kamera führt ihre Positionen selbst — also fährt sie auch mit
   * ihrem eigenen Tempo an.
   *
   * VISCA kennt dafür einen Befehl, und er hält nicht, was er verspricht:
   * An einer OBSBOT Tail Air wurde `81 01 06 20 vv` mit „angenommen" und
   * „ausgeführt" quittiert und dann ignoriert — dieselbe Strecke brauchte
   * bei langsamster und schnellster Angabe dreimal 8,1 Sekunden. Diese
   * Kamera bestätigt übrigens auch ausgedachte Befehle, die Antwort taugt
   * also nicht als Nachweis.
   *
   * Einen Befehl zu schicken, von dem nur feststeht, dass er bei dem einen
   * Gerät, das hier stand, nichts tut, wäre eine Beruhigung für den
   * Quelltext und keine für den Saal. Wer das Tempo bestimmen will, lässt
   * die Positionen in Votura liegen — dort fährt Votura selbst, und dort
   * wirkt es: dieselbe Strecke in 38,4 statt 8,1 Sekunden.
   */
  await anDieKamera(id, viscaPresetAbrufen(nummer, profil.geraet))
}

/**
 * Die Kamera nach ihrer Stellung fragen.
 *
 * Für Kameras ohne eigenen Positionsspeicher: Was sie hier nennt, legt Votura
 * in seine Datenbank und schickt es ihr später zurück.
 *
 * Kommt keine oder eine unverständliche Antwort, gibt es einen Fehler und
 * keine geratene Zahl. Eine erfundene Stellung führte die Kamera später
 * zuverlässig an den falschen Ort — und zwar mitten in der Versammlung.
 */
export async function ptzStellungLesen(id: string): Promise<PtzStellung> {
  requirePermission('system.manage')
  const { kamera, profil } = kameraVon(id)
  const port = zielPort(kamera, profil)

  const schwenk = await sende(profil, kamera.host, port, viscaFragePosition(profil.geraet), {
    warten: true,
    art: 'frage'
  })
  const pantilt = schwenk.antwort && pantiltAusAntwort(schwenk.antwort)
  if (!pantilt) {
    throw new Error(
      `„${kamera.name}" nennt ihre Stellung nicht. Nicht jede Kamera kann das — dann bleibt nur, die Positionen in der Kamera selbst abzulegen.`
    )
  }

  const zoomAntwort = await sende(profil, kamera.host, port, viscaFrageZoom(profil.geraet), {
    warten: true,
    art: 'frage'
  })
  /* Ohne Zoomangabe ist die Stellung trotzdem brauchbar — dann bleibt der
     Zoom, wie er gerade steht. */
  const zoom = (zoomAntwort.antwort && zoomAusAntwort(zoomAntwort.antwort)) ?? 0
  return { ...pantilt, zoom }
}

export async function ptzPositionSpeichern(id: string, nummer: number): Promise<void> {
  requirePermission('system.manage')
  const { profil } = kameraVon(id)
  if (!profil.kann.presetsSpeichern) {
    throw new Error(`„${profil.name}" kann keine Positionen ablegen.`)
  }
  await anDieKamera(id, viscaPresetSpeichern(nummer, profil.geraet))
}

/**
 * Schwenken, solange die Taste gedrückt ist.
 *
 * Die Kamera fährt nach diesem Befehl **weiter**, bis ein Halt kommt. Das ist
 * kein Versehen der Festlegung, sondern ihr Sinn: Ein Steuerpult schickt
 * genau dasselbe, solange der Knüppel liegt.
 */
export async function ptzSchwenken(
  id: string,
  x: PtzRichtung,
  y: PtzRichtung,
  tempo?: number
): Promise<void> {
  requirePermission('round.manage')
  const { kamera, profil } = kameraVon(id)
  if (!profil.kann.schwenken) throw new Error(`„${profil.name}" lässt sich nicht schwenken.`)
  /*
   * Das Tempo kommt als Anteil zwischen 0 und 1 herein und wird auf die
   * Grenzen dieses Modells gerechnet. Die Bedienung muss so nicht wissen,
   * dass VISCA bis 0x18 zählt und dieses Modell nur bis 0x14.
   *
   * Ohne Angabe gilt, was an der Kamera eingestellt ist — ein Aufrufer, der
   * nichts zum Tempo sagt, will das eingestellte und nicht ein geratenes.
   */
  const anteil = ptzTempo(tempo === undefined ? kamera : { tempo })
  await anDieKamera(
    id,
    viscaSchwenken(
      x,
      y,
      Math.round(profil.tempoMax.schwenk * anteil),
      Math.round(profil.tempoMax.neigen * anteil),
      profil.geraet
    )
  )
}

export async function ptzHalt(id: string): Promise<void> {
  requirePermission('round.manage')
  const { profil } = kameraVon(id)
  await anDieKamera(id, viscaSchwenkStopp(profil.geraet))
}

export async function ptzZoomen(id: string, richtung: PtzRichtung, tempo = 0.5): Promise<void> {
  requirePermission('round.manage')
  const { profil } = kameraVon(id)
  if (!profil.kann.zoom) throw new Error(`„${profil.name}" lässt sich nicht zoomen.`)
  const stufe = Math.round(profil.tempoMax.zoom * Math.min(1, Math.max(0, tempo)))
  await anDieKamera(id, viscaZoom(richtung, stufe, profil.geraet))
}

export async function ptzHeim(id: string): Promise<void> {
  requirePermission('round.manage')
  const { profil } = kameraVon(id)
  await anDieKamera(id, viscaHeim(profil.geraet))
}

export async function ptzScharfstellen(id: string): Promise<void> {
  requirePermission('round.manage')
  const { profil } = kameraVon(id)
  await anDieKamera(id, viscaAutofokus(profil.geraet))
}

/* ----------------------------------------------------------- Die Erkennung */

/**
 * Herausfinden, wie eine Kamera unter dieser Adresse anspricht.
 *
 * Geschickt wird eine Frage nach dem Zoomstand: Sie verändert nichts — eine
 * Kamera, die nach dem Einrichten woanders steht als vorher, wäre ein
 * schlechter Anfang — und jede VISCA-Kamera beantwortet sie.
 */
export async function ptzErkennen(host: string, port?: number): Promise<PtzFund> {
  requirePermission('system.manage')
  const ziel = host.trim()
  if (!ziel) return { erreichbar: false, hinweis: 'Es ist keine Adresse angegeben.' }

  for (const kennung of PTZ_ERKENNUNG) {
    const profil = ptzProfil(kennung)
    if (!profil) continue
    const versuch = port && port > 0 ? port : profil.port
    const ergebnis = await sende(profil, ziel, versuch, viscaFrageZoom(profil.geraet), {
      warten: true,
      art: 'frage'
    })
    if (ergebnis.antwort && istViscaAntwort(ergebnis.antwort)) {
      logger.info(`Kamerasteuerung erkannt: ${ziel}:${versuch} spricht ${profil.name}`)
      return { erreichbar: true, profil: kennung, port: versuch }
    }
  }

  return {
    erreichbar: false,
    hinweis:
      'Unter dieser Adresse antwortet keine VISCA-Kamera. Zu prüfen: Ist die Steuerung über das Netz in der Kamera eingeschaltet? Steht sie im selben Netz? Und stimmt der Port — 52381 und 5678 sind die üblichen.'
  }
}

/**
 * Ein Redner ist aufgerufen — die Kameras fahren auf ihre Position.
 *
 * Ohne Rechteprüfung, und das ist Absicht: Das hier ist keine Handlung eines
 * Menschen, sondern die Folge einer Handlung, die längst geprüft wurde. Wer
 * einen Redner aufrufen darf, darf auch, dass die Kamera ihm folgt.
 *
 * Fehler werden protokolliert und nicht geworfen. Eine Kamera, die nicht
 * antwortet, darf den Aufruf des Redners nicht aufhalten — auf dem Beamer
 * steht dann eben ein Name ohne Bild, und das ist immer noch eine
 * funktionierende Versammlung.
 */
export async function ptzBeiAufruf(): Promise<void> {
  const kameras = getPtzKameras().filter(
    (kamera) => kamera.enabled && kamera.beiAufruf !== undefined
  )
  for (const kamera of kameras) {
    const profil = ptzProfil(kamera.profil)
    if (!profil) continue
    try {
      const ergebnis = await sende(
        profil,
        kamera.host,
        zielPort(kamera, profil),
        viscaPresetAbrufen(kamera.beiAufruf ?? 0, profil.geraet)
      )
      if (ergebnis.fehler) {
        logger.warn(`Kamera „${kamera.name}“ folgte dem Aufruf nicht: ${ergebnis.fehler}`)
      }
    } catch (fehler) {
      logger.warn(`Kamera „${kamera.name}“ folgte dem Aufruf nicht: ${(fehler as Error).message}`)
    }
  }
}

/**
 * Welche Kamera zu einem Bild gehört.
 *
 * Verbunden wird über den NDI-Namen: Das Bild, das an der Wand steht, sagt,
 * welche Kamera es aufgenommen hat — und nur die darf Votura dann bewegen.
 * Ohne diese Zuordnung führe beim Aufruf eines Redners womöglich die Kamera
 * im Nebenraum los.
 */
export function ptzKameraZuQuelle(quelle: string | undefined): PtzKamera | undefined {
  if (!quelle) return undefined
  return getPtzKameras().find((kamera) => kamera.enabled && kamera.quelle === quelle)
}

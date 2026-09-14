/**
 * Ein Namensserver für genau einen Namen.
 *
 * ## Warum es ihn braucht
 *
 * Ein echtes Zertifikat gilt für einen **Namen**, nicht für eine Adresse
 * (ADR-0008). Im Saal nützt `saal.mein-verband.de` aber nur, wenn dort jemand
 * diesen Namen auflösen kann — und ein abgeschottetes Veranstaltungsnetz hat
 * definitionsgemäß keinen Weg zum öffentlichen Namensystem. Ohne eine
 * Antwort vor Ort bricht die ganze Kette: kein Name, keine Verbindung, kein
 * Zertifikat, das etwas nützt.
 *
 * ## Warum er so wenig kann
 *
 * Er beantwortet **eine** Frage selbst: den eingestellten Namen mit der
 * Adresse dieses Rechners. Er löst nichts rekursiv auf und speichert nichts
 * zwischen. Alles andere wird abgelehnt (`REFUSED`) — oder, wenn eine
 * Weiterleitung eingestellt ist, unverändert an den Router gereicht.
 *
 * Das ist kein Geiz, sondern Absicht: Ein Namensserver, der jede Frage
 * beantwortet, ist ein offener Resolver — er taugt als Verstärker für
 * Angriffe auf Dritte.
 *
 * ## Die Weiterleitung, und was sie kostet
 *
 * Bekommen die Geräte Votura als Namensserver, ist für sie **alles andere
 * auch tot** — kein Wetterbericht, kein Messenger, nichts. Ein Abend im
 * Funkloch ist für niemanden zumutbar, und manche Telefone verlassen ein
 * WLAN von selbst, in dem nichts geht.
 *
 * Deshalb lässt sich eine Weiterleitung einstellen: Was nicht der eine Name
 * ist, geht an den Namensserver des Routers und dessen Antwort zurück an das
 * Gerät. Der Preis steht in der Oberfläche, nicht im Kleingedruckten:
 * **Votura sieht dabei, welche Namen im Saal abgefragt werden.**
 * Aufgezeichnet wird nichts — kein Protokoll, keine Datei, nichts in der
 * Datenbank —, aber es geht durch diesen Rechner. Wer das nicht will, lässt
 * die Weiterleitung aus; dann gilt der Name im Saal und sonst nichts.
 *
 * Gefragt werden darf ohnehin nur aus dem Saalnetz: Anfragen von außerhalb
 * der privaten Adressbereiche werden abgewiesen, gleich wonach sie fragen.
 *
 * ## Was er nicht ersetzt
 *
 * Er muss gefragt werden. Die Geräte erfahren ihren Namensserver aus DHCP —
 * entweder vom Router der Location (ein Eintrag dort) oder von Votura selbst
 * (`dhcp.ts`), wenn es das Netz aufspannt.
 */
import { createSocket, type Socket } from 'node:dgram'
import { logger } from './logger'

export interface DnsEinstellung {
  /** Der Name, der beantwortet wird, etwa `saal.mein-verband.de`. */
  name: string
  /** Die Adresse, mit der geantwortet wird. */
  adresse: string
  /** Woran gelauscht wird — `0.0.0.0` für das ganze Netz. */
  bindAddress?: string
  /** Abweichender Port; 53 ist der übliche und braucht unter Linux Rechte. */
  port?: number
  /**
   * Namensserver für alles Übrige — üblicherweise der Router.
   *
   * Ohne ihn bleibt das Saalnetz für die Gäste ein Funkloch. Mit ihm läuft
   * ihr gewöhnlicher Verkehr durch diesen Rechner; aufgezeichnet wird nichts.
   */
  weiterleitung?: string
}

/** Kommt diese Anfrage aus einem privaten Netz — also aus dem Saal? */
export function ausDemSaalnetz(adresse: string): boolean {
  const teile = adresse.split('.').map(Number)
  if (teile.length !== 4 || teile.some((zahl) => Number.isNaN(zahl))) return false
  const [a, b] = teile
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

let dienst: Socket | null = null

/* --------------------------------------------------------- Das Format */

/**
 * Den Namen aus einer Frage lesen.
 *
 * Er steht als Folge von Silben da: ein Längenbyte, dann so viele Zeichen,
 * bis eine Null kommt. Verweise (die oberen zwei Bits gesetzt) gibt es in
 * einer Frage nicht — wer sie schickt, bekommt hier eine Absage.
 */
export function nameLesen(paket: Buffer, ab: number): { name: string; ende: number } | null {
  const silben: string[] = []
  let stelle = ab
  while (stelle < paket.length) {
    const laenge = paket[stelle]
    if (laenge === 0) return { name: silben.join('.'), ende: stelle + 1 }
    if (laenge > 63 || stelle + 1 + laenge > paket.length) return null
    silben.push(paket.subarray(stelle + 1, stelle + 1 + laenge).toString('ascii'))
    stelle += 1 + laenge
  }
  return null
}

/** Einen Namen in dieselbe Form zurückschreiben. */
export function nameSchreiben(name: string): Buffer {
  const teile = name.split('.').filter(Boolean)
  const stuecke = teile.map((silbe) => Buffer.concat([Buffer.from([silbe.length]), Buffer.from(silbe, 'ascii')]))
  return Buffer.concat([...stuecke, Buffer.from([0])])
}

/**
 * Die Antwort auf eine Frage — oder eine Absage.
 *
 * Getrennt vom Netzbetrieb, damit sie prüfbar ist, ohne einen Dienst zu
 * starten: Bei einem Binärformat ist die Frage nicht, ob es plausibel
 * aussieht, sondern ob die Bytes stimmen.
 */
export function antwortAuf(frage: Buffer, einstellung: DnsEinstellung): Buffer | null {
  if (frage.length < 12) return null
  const kennung = frage.readUInt16BE(0)
  const flaggen = frage.readUInt16BE(2)
  /* Nur gewöhnliche Anfragen; alles andere geht uns nichts an. */
  if ((flaggen & 0x8000) !== 0) return null
  if (frage.readUInt16BE(4) !== 1) return absage(kennung, frage)

  const gelesen = nameLesen(frage, 12)
  if (!gelesen || gelesen.ende + 4 > frage.length) return absage(kennung, frage)
  const typ = frage.readUInt16BE(gelesen.ende)
  const klasse = frage.readUInt16BE(gelesen.ende + 2)
  const frageEnde = gelesen.ende + 4
  const frageBytes = frage.subarray(12, frageEnde)

  const passt = gelesen.name.toLowerCase() === einstellung.name.trim().toLowerCase().replace(/\.$/, '')
  if (!passt || klasse !== 1) return absage(kennung, frage)

  /*
   * Fragt jemand nach einer IPv6-Adresse, ist die richtige Antwort „für
   * diesen Namen gibt es davon keine" — **nicht** eine Absage. Sonst fragen
   * manche Geräte hartnäckig weiter, statt es mit IPv4 zu versuchen.
   */
  if (typ === 28) return kopfMitFrage(kennung, frageBytes, 0, 0)
  if (typ !== 1) return absage(kennung, frage)

  const teile = einstellung.adresse.split('.').map(Number)
  if (teile.length !== 4 || teile.some((zahl) => Number.isNaN(zahl))) return absage(kennung, frage)

  const eintrag = Buffer.concat([
    nameSchreiben(einstellung.name),
    Buffer.from([0x00, 0x01, 0x00, 0x01]), // Typ A, Klasse IN
    Buffer.from([0x00, 0x00, 0x00, 0x3c]), // 60 Sekunden — im Saal ändert sich nichts, aber lang halten muss es auch nichts
    Buffer.from([0x00, 0x04]),
    Buffer.from(teile)
  ])

  return Buffer.concat([kopfMitFrage(kennung, frageBytes, 1, 0), eintrag])
}

/** Kopf und wiederholte Frage — jede Antwort beginnt so. */
function kopfMitFrage(kennung: number, frageBytes: Buffer, antworten: number, rcode: number): Buffer {
  const kopf = Buffer.alloc(12)
  kopf.writeUInt16BE(kennung, 0)
  /* Antwort, autoritativ, **keine** Rekursion angeboten. */
  kopf.writeUInt16BE(0x8400 | rcode, 2)
  kopf.writeUInt16BE(1, 4)
  kopf.writeUInt16BE(antworten, 6)
  return Buffer.concat([kopf, frageBytes])
}

/** Eine höfliche Absage: „dafür bin ich nicht zuständig". */
function absage(kennung: number, frage: Buffer): Buffer {
  const gelesen = nameLesen(frage, 12)
  const frageBytes = gelesen ? frage.subarray(12, Math.min(gelesen.ende + 4, frage.length)) : Buffer.alloc(0)
  return kopfMitFrage(kennung, frageBytes, 0, 5)
}

/* ---------------------------------------------------------- Der Betrieb */

export async function starteDns(einstellung: DnsEinstellung): Promise<void> {
  await stoppeDns()
  const port = einstellung.port ?? 53

  return new Promise((fertig, fehlschlag) => {
    const neu = createSocket({ type: 'udp4', reuseAddr: true })

    neu.on('message', (nachricht, absender) => {
      /* Von außerhalb des Saalnetzes wird nichts beantwortet — auch nicht der
         eigene Name. Ein offener Resolver im Internet ist eine Waffe. */
      if (!ausDemSaalnetz(absender.address)) return

      const antwort = antwortAuf(nachricht, einstellung)
      const senden = (daten: Buffer): void => {
        neu.send(daten, absender.port, absender.address, (fehler) => {
          if (fehler) {
            logger.warn(`Namensdienst: Antwort an ${absender.address} fehlgeschlagen: ${fehler.message}`)
          }
        })
      }

      /*
       * `null` heißt „nicht mein Name". Mit eingestellter Weiterleitung geht
       * die Frage dann an den Router, damit die Gäste nicht den Abend ohne
       * Netz verbringen; ohne sie bleibt es bei der Absage aus `antwortAuf`.
       */
      if (antwort && !istAbsage(antwort)) {
        senden(antwort)
        return
      }
      if (!einstellung.weiterleitung) {
        if (antwort) senden(antwort)
        return
      }
      weiterleiten(nachricht, einstellung.weiterleitung)
        .then(senden)
        .catch(() => {
          if (antwort) senden(antwort)
        })
    })

    neu.on('error', (fehler: NodeJS.ErrnoException) => {
      neu.close()
      dienst = null
      fehlschlag(
        fehler.code === 'EACCES'
          ? new Error(
              'Für den Namensdienst auf Port 53 fehlen die Rechte. Unter Linux und auf dem Raspberry Pi braucht er erhöhte Rechte; unter Windows genügt gewöhnlich ein Neustart der Anwendung.'
            )
          : fehler.code === 'EADDRINUSE'
            ? new Error(
                'Port 53 ist belegt — auf diesem Rechner läuft bereits ein Namensdienst. Zwei zugleich gehen nicht.'
              )
            : fehler
      )
    })

    neu.bind(port, einstellung.bindAddress ?? '0.0.0.0', () => {
      dienst = neu
      logger.info(
        `Namensdienst antwortet auf ${einstellung.name} mit ${einstellung.adresse} (UDP ${port}) — und auf sonst nichts`
      )
      fertig()
    })
  })
}

export async function stoppeDns(): Promise<void> {
  if (!dienst) return
  await new Promise<void>((fertig) => dienst!.close(() => fertig()))
  dienst = null
  logger.info('Namensdienst beendet')
}

export function dnsLaeuft(): boolean {
  return dienst !== null
}

/** Trägt diese Antwort den Kode für „nicht zuständig"? */
function istAbsage(antwort: Buffer): boolean {
  return (antwort.readUInt16BE(2) & 0x000f) === 5
}

/**
 * Eine Frage an den Namensserver des Routers weiterreichen.
 *
 * Unverändert weiter, unverändert zurück: Dieses Programm liest die Antwort
 * nicht und merkt sie sich nicht. Nach drei Sekunden ohne Antwort wird
 * aufgegeben — ein hängendes Gerät ist schlimmer als ein schneller Fehler.
 */
async function weiterleiten(frage: Buffer, ziel: string): Promise<Buffer> {
  return new Promise((fertig, fehlschlag) => {
    const bote = createSocket('udp4')
    const uhr = setTimeout(() => {
      bote.close()
      fehlschlag(new Error('Der Namensserver des Routers antwortet nicht.'))
    }, 3000)

    bote.on('message', (antwort) => {
      clearTimeout(uhr)
      bote.close()
      fertig(antwort)
    })
    bote.on('error', (fehler) => {
      clearTimeout(uhr)
      bote.close()
      fehlschlag(fehler)
    })
    bote.send(frage, 53, ziel)
  })
}

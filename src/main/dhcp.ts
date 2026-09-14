/**
 * Adressen für das Saalnetz — nur dort, wo Votura das Netz selbst aufspannt.
 *
 * ## Wofür
 *
 * Der Namensdienst (`dns.ts`) nützt nichts, wenn niemand ihn fragt. Woher ein
 * Gerät seinen Namensserver erfährt, entscheidet DHCP. Wo ein Router der
 * Location steht, trägt man es dort ein; wo Votura das WLAN selbst aufspannt
 * — der Raspberry Pi mit eigenem Zugangspunkt —, gibt es niemanden sonst, der
 * es tun könnte.
 *
 * ## Die Gefahr, und was dagegen steht
 *
 * **Ein zweiter Adressverteiler in einem fremden Netz ist ein Störfall.** Er
 * verteilt Adressen, die dort nicht gelten, und legt im Zweifel das Netz der
 * Location lahm — mitten in einer Versammlung, und niemand weiß, warum.
 *
 * Deshalb zwei Vorkehrungen:
 *
 * 1. **Aus, solange es niemand einschaltet.** Kein Standard, keine
 *    Bequemlichkeit.
 * 2. **Vorher hinhören.** Beim Start fragt Votura selbst nach einer Adresse.
 *    Antwortet jemand, läuft hier bereits ein Verteiler — dann startet dieser
 *    hier **nicht** und sagt, wen er gehört hat. Das ist die Prüfung, die ein
 *    Mensch im Saal nicht leisten kann.
 *
 * ## Der Router gehört dazu
 *
 * Ohne Wegweiser nach draußen sitzen die Gäste den Abend im Funkloch, und
 * manche Telefone verlassen ein WLAN von selbst, in dem nichts geht. Die
 * Adresse des Routers ist deshalb einstellbar und wird mitgegeben — zusammen
 * mit Votura als Namensserver, der alles Fremde an eben diesen Router
 * weiterreicht.
 */
import { createSocket, type Socket } from 'node:dgram'
import { logger } from './logger'

export interface DhcpEinstellung {
  /** Erste vergebene Adresse, etwa `192.168.50.100`. */
  von: string
  /** Letzte vergebene Adresse. */
  bis: string
  /** Netzmaske, üblich `255.255.255.0`. */
  maske: string
  /** Adresse dieses Rechners — er ist Namensserver und Absender der Antwort. */
  eigene: string
  /** Wegweiser nach draußen. Leer heißt: kein Internet im Saalnetz. */
  router?: string
  /** Geltungsdauer in Sekunden; zwei Stunden reichen für eine Versammlung. */
  laufzeit?: number
  bindAddress?: string
}

interface Lehen {
  adresse: string
  bis: number
}

let dienst: Socket | null = null
const lehen = new Map<string, Lehen>()

/* ------------------------------------------------------------ Rechnerei */

export const alsZahl = (adresse: string): number =>
  adresse.split('.').reduce((summe, teil) => (summe << 8) + Number(teil), 0) >>> 0

export const alsAdresse = (zahl: number): string =>
  [(zahl >>> 24) & 255, (zahl >>> 16) & 255, (zahl >>> 8) & 255, zahl & 255].join('.')

/**
 * Die nächste freie Adresse für dieses Gerät.
 *
 * Wer schon eine hatte, bekommt sie wieder — ein Telefon, das kurz aus dem
 * Funkloch kommt, soll nicht plötzlich unter anderer Adresse dastehen.
 */
export function adresseFuer(mac: string, einstellung: DhcpEinstellung, jetzt = Date.now()): string | null {
  const bekannt = lehen.get(mac)
  if (bekannt) return bekannt.adresse

  const von = alsZahl(einstellung.von)
  const bis = alsZahl(einstellung.bis)
  const vergeben = new Set(
    [...lehen.values()].filter((eintrag) => eintrag.bis > jetzt).map((eintrag) => eintrag.adresse)
  )
  for (let zahl = von; zahl <= bis; zahl++) {
    const adresse = alsAdresse(zahl)
    if (adresse === einstellung.eigene || adresse === einstellung.router) continue
    if (!vergeben.has(adresse)) return adresse
  }
  return null
}

/** Was gerade vergeben ist — für die Anzeige, nicht für Entscheidungen. */
export function vergebeneAdressen(): { mac: string; adresse: string; bis: string }[] {
  return [...lehen.entries()].map(([mac, eintrag]) => ({
    mac,
    adresse: eintrag.adresse,
    bis: new Date(eintrag.bis).toISOString()
  }))
}

/* -------------------------------------------------------------- Pakete */

const MAGIE = Buffer.from([0x63, 0x82, 0x53, 0x63])

export interface DhcpFrage {
  art: number
  xid: number
  mac: string
  chaddr: Buffer
  flags: number
  gewuenscht?: string
}

/** Eine Anfrage lesen — nur so weit, wie für die Antwort nötig ist. */
export function frageLesen(paket: Buffer): DhcpFrage | null {
  if (paket.length < 240 || paket[0] !== 1) return null
  if (!paket.subarray(236, 240).equals(MAGIE)) return null

  const chaddr = paket.subarray(28, 34)
  const frage: DhcpFrage = {
    art: 0,
    xid: paket.readUInt32BE(4),
    flags: paket.readUInt16BE(10),
    chaddr,
    mac: [...chaddr].map((byte) => byte.toString(16).padStart(2, '0')).join(':')
  }

  let stelle = 240
  while (stelle < paket.length) {
    const art = paket[stelle]
    if (art === 255) break
    if (art === 0) {
      stelle += 1
      continue
    }
    const laenge = paket[stelle + 1]
    const wert = paket.subarray(stelle + 2, stelle + 2 + laenge)
    if (art === 53) frage.art = wert[0]
    if (art === 50 && laenge === 4) frage.gewuenscht = [...wert].join('.')
    stelle += 2 + laenge
  }
  return frage.art === 0 ? null : frage
}

function option(art: number, wert: Buffer | string | number[]): Buffer {
  const daten = Buffer.isBuffer(wert)
    ? wert
    : typeof wert === 'string'
      ? Buffer.from(wert.split('.').map(Number))
      : Buffer.from(wert)
  return Buffer.concat([Buffer.from([art, daten.length]), daten])
}

/**
 * Die Antwort bauen — Angebot oder Bestätigung.
 *
 * Mitgegeben wird genau das, was ein Gerät im Saal braucht: Maske, Wegweiser
 * nach draußen (wenn einer eingestellt ist) und **dieser Rechner als
 * Namensserver**. Der letzte Punkt ist der ganze Zweck der Übung: Ohne ihn
 * kennt niemand im Saal den Namen, für den das Zertifikat gilt.
 */
export function antwortBauen(
  frage: DhcpFrage,
  adresse: string,
  einstellung: DhcpEinstellung,
  art: 2 | 5
): Buffer {
  const kopf = Buffer.alloc(240)
  kopf[0] = 2 // Antwort
  kopf[1] = 1 // Ethernet
  kopf[2] = 6 // Länge der Hardwareadresse
  kopf.writeUInt32BE(frage.xid, 4)
  kopf.writeUInt16BE(frage.flags, 10)
  Buffer.from(adresse.split('.').map(Number)).copy(kopf, 16) // yiaddr
  Buffer.from(einstellung.eigene.split('.').map(Number)).copy(kopf, 20) // siaddr
  frage.chaddr.copy(kopf, 28)
  MAGIE.copy(kopf, 236)

  const laufzeit = einstellung.laufzeit ?? 7200
  const teile = [
    kopf,
    option(53, [art]),
    option(54, einstellung.eigene),
    option(51, [
      (laufzeit >>> 24) & 255,
      (laufzeit >>> 16) & 255,
      (laufzeit >>> 8) & 255,
      laufzeit & 255
    ]),
    option(1, einstellung.maske),
    /* Votura als Namensserver — sonst fragt niemand nach dem Namen, für den
       das Zertifikat gilt. */
    option(6, einstellung.eigene)
  ]
  if (einstellung.router) teile.push(option(3, einstellung.router))
  teile.push(Buffer.from([255]))
  return Buffer.concat(teile)
}

/* ------------------------------------------------------------- Betrieb */

/**
 * Hört hier schon jemand anders Adressen aus?
 *
 * Gefragt wird, wie ein Gerät fragen würde. Antwortet jemand, gibt es in
 * diesem Netz bereits einen Verteiler — und dann hat Votura hier nichts
 * verloren.
 */
export async function fremderVerteiler(bindAddress = '0.0.0.0', wartezeit = 2500): Promise<string | null> {
  return new Promise((fertig) => {
    const horcher = createSocket({ type: 'udp4', reuseAddr: true })
    let gefunden: string | null = null

    horcher.on('message', (nachricht, absender) => {
      const antwort = frageLesen(nachricht)
      /* Ein Angebot (2) oder eine Bestätigung (5) von jemand anderem. */
      if (nachricht[0] === 2 && !gefunden) gefunden = absender.address
      void antwort
    })

    horcher.on('error', () => {
      try {
        horcher.close()
      } catch {
        /* schon zu */
      }
      fertig(null)
    })

    horcher.bind(68, bindAddress, () => {
      horcher.setBroadcast(true)
      /* Eine Suchanfrage mit erfundener Hardwareadresse — sie soll niemandem
         eine Adresse wegnehmen, nur hörbar machen, wer antwortet. */
      const suche = Buffer.alloc(240)
      suche[0] = 1
      suche[1] = 1
      suche[2] = 6
      suche.writeUInt32BE(0x564f5455, 4) // „VOTU"
      suche.writeUInt16BE(0x8000, 10) // Antwort bitte an alle
      Buffer.from([0x02, 0x56, 0x4f, 0x54, 0x55, 0x52]).copy(suche, 28)
      MAGIE.copy(suche, 236)
      const paket = Buffer.concat([suche, option(53, [1]), Buffer.from([255])])
      horcher.send(paket, 67, '255.255.255.255')

      setTimeout(() => {
        try {
          horcher.close()
        } catch {
          /* schon zu */
        }
        fertig(gefunden)
      }, wartezeit)
    })
  })
}

export async function starteDhcp(einstellung: DhcpEinstellung): Promise<void> {
  await stoppeDhcp()

  const fremd = await fremderVerteiler(einstellung.bindAddress)
  if (fremd) {
    throw new Error(
      `In diesem Netz verteilt bereits ein anderes Gerät Adressen (${fremd}). Votura startet deshalb nicht: Zwei Verteiler in einem Netz legen es lahm. Die Adressvergabe ist nur für ein Netz gedacht, das Votura selbst aufspannt.`
    )
  }

  return new Promise((fertig, fehlschlag) => {
    const neu = createSocket({ type: 'udp4', reuseAddr: true })

    neu.on('message', (nachricht) => {
      const frage = frageLesen(nachricht)
      if (!frage) return

      const adresse = frage.gewuenscht ?? adresseFuer(frage.mac, einstellung)
      if (!adresse) {
        logger.warn(`Adressvergabe: keine freie Adresse mehr für ${frage.mac}`)
        return
      }

      /* 1 = Suche → Angebot, 3 = Anfrage → Bestätigung. Alles andere (etwa
         eine Freigabe) braucht keine Antwort. */
      const art = frage.art === 1 ? 2 : frage.art === 3 ? 5 : null
      if (art === null) {
        if (frage.art === 7) lehen.delete(frage.mac)
        return
      }
      if (art === 5) {
        lehen.set(frage.mac, { adresse, bis: Date.now() + (einstellung.laufzeit ?? 7200) * 1000 })
      }

      const antwort = antwortBauen(frage, adresse, einstellung, art)
      neu.send(antwort, 68, '255.255.255.255', (fehler) => {
        if (fehler) logger.warn(`Adressvergabe: Antwort an ${frage.mac} fehlgeschlagen: ${fehler.message}`)
      })
    })

    neu.on('error', (fehler: NodeJS.ErrnoException) => {
      neu.close()
      dienst = null
      fehlschlag(
        fehler.code === 'EACCES'
          ? new Error('Für die Adressvergabe auf Port 67 fehlen die Rechte.')
          : fehler.code === 'EADDRINUSE'
            ? new Error('Port 67 ist belegt — auf diesem Rechner läuft bereits eine Adressvergabe.')
            : fehler
      )
    })

    neu.bind(67, einstellung.bindAddress ?? '0.0.0.0', () => {
      neu.setBroadcast(true)
      dienst = neu
      logger.info(
        `Adressvergabe läuft: ${einstellung.von} bis ${einstellung.bis}, Namensserver ${einstellung.eigene}` +
          (einstellung.router ? `, Wegweiser ${einstellung.router}` : ', ohne Wegweiser nach draußen')
      )
      fertig()
    })
  })
}

export async function stoppeDhcp(): Promise<void> {
  if (!dienst) return
  await new Promise<void>((fertig) => dienst!.close(() => fertig()))
  dienst = null
  lehen.clear()
  logger.info('Adressvergabe beendet')
}

export function dhcpLaeuft(): boolean {
  return dienst !== null
}

/**
 * Ein selbst ausgestelltes Zertifikat für das Saalnetz.
 *
 * ## Warum das hier steht und nicht aus einer Bibliothek kommt
 *
 * Node kann Schlüssel erzeugen, aber keine Zertifikate — `crypto.X509Certificate`
 * liest sie nur. `openssl` liegt auf einem Windows-Rechner im Vereinsheim
 * nicht, und eine Bibliothek für diese eine Aufgabe wäre die zweite
 * Laufzeitabhängigkeit des Projekts.
 *
 * Bleibt, die paar hundert Bytes selbst zu kodieren. X.509 ist ASN.1 in
 * DER-Form, und DER ist übersichtlich: Typ, Länge, Inhalt. Der öffentliche
 * Schlüssel kommt fertig kodiert aus Node (`spki`), unterschrieben wird mit
 * `crypto.sign` — nichts davon muss nachgebaut werden.
 *
 * ## Was ein solches Zertifikat leistet und was nicht
 *
 * Gegen **Mitlesen** hilft es vollständig: Ein passiver Zuhörer im WLAN kann
 * nichts entschlüsseln, ganz gleich, wer das Zertifikat ausgestellt hat. Genau
 * das ist die Bedrohung im Saal — bei WPA2 mit gemeinsamem Passwort kann jeder
 * Teilnehmer den Verkehr jedes anderen entschlüsseln.
 *
 * Gegen einen **aktiven** Angreifer, der sich dazwischenschaltet, hilft es
 * nur, wenn das Gerät das Zertifikat wiedererkennt. Für Wahlkabinen ist das
 * lösbar — sie gehören der Veranstaltung. Für mitgebrachte Telefone nicht:
 * Dort erscheint eine Warnung. Deshalb wird der Fingerabdruck angezeigt, und
 * deshalb bleibt für geheime Wahlen die Kabine die Empfehlung.
 */
import { createHash, createPrivateKey, createSign, generateKeyPairSync, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'

/* ------------------------------------------------------------ DER-Bausteine */

export function laenge(bytes: number): Buffer {
  /* Kurzform bis 127, sonst „wie viele Längenbytes folgen" und dann die
     Länge selbst — das ist die ganze Regel. */
  if (bytes < 0x80) return Buffer.from([bytes])
  const roh: number[] = []
  let rest = bytes
  while (rest > 0) {
    roh.unshift(rest & 0xff)
    rest >>= 8
  }
  return Buffer.from([0x80 | roh.length, ...roh])
}

export function feld(typ: number, inhalt: Buffer): Buffer {
  return Buffer.concat([Buffer.from([typ]), laenge(inhalt.length), inhalt])
}

export const folge = (...teile: Buffer[]): Buffer => feld(0x30, Buffer.concat(teile))
const menge = (...teile: Buffer[]): Buffer => feld(0x31, Buffer.concat(teile))

function ganzzahl(wert: number | Buffer): Buffer {
  if (typeof wert === 'number') {
    const roh: number[] = []
    let rest = wert
    do {
      roh.unshift(rest & 0xff)
      rest >>= 8
    } while (rest > 0)
    /* Führendes Nullbyte, wenn das oberste Bit gesetzt ist: DER-Ganzzahlen
       sind vorzeichenbehaftet, und ohne das wäre die Zahl negativ. */
    if (roh[0] & 0x80) roh.unshift(0)
    return feld(0x02, Buffer.from(roh))
  }
  const bytes = wert[0] & 0x80 ? Buffer.concat([Buffer.from([0]), wert]) : wert
  return feld(0x02, bytes)
}

/** Ein Objektbezeichner wie `1.2.840.113549.1.1.11` in seiner DER-Form. */
export function oid(punkte: string): Buffer {
  const teile = punkte.split('.').map(Number)
  const roh: number[] = [teile[0] * 40 + teile[1]]
  for (const teil of teile.slice(2)) {
    const stuecke: number[] = []
    let rest = teil
    do {
      stuecke.unshift(rest & 0x7f)
      rest >>= 7
    } while (rest > 0)
    for (let i = 0; i < stuecke.length - 1; i++) stuecke[i] |= 0x80
    roh.push(...stuecke)
  }
  return feld(0x06, Buffer.from(roh))
}

const OID_SHA256_RSA = '1.2.840.113549.1.1.11'
const OID_CN = '2.5.4.3'
const OID_SAN = '2.5.29.17'
const OID_BASIC = '2.5.29.19'
const OID_KEYUSAGE = '2.5.29.15'
const OID_EXTKEYUSAGE = '2.5.29.37'
const OID_SERVERAUTH = '1.3.6.1.5.5.7.3.1'

/** Zeitpunkt als `GeneralizedTime` — gilt auch nach 2049, anders als UTCTime. */
function zeitpunkt(wann: Date): Buffer {
  const zwei = (wert: number): string => String(wert).padStart(2, '0')
  const text =
    `${wann.getUTCFullYear()}${zwei(wann.getUTCMonth() + 1)}${zwei(wann.getUTCDate())}` +
    `${zwei(wann.getUTCHours())}${zwei(wann.getUTCMinutes())}${zwei(wann.getUTCSeconds())}Z`
  return feld(0x18, Buffer.from(text, 'ascii'))
}

export function name(gemeinerName: string): Buffer {
  return folge(menge(folge(oid(OID_CN), feld(0x0c, Buffer.from(gemeinerName, 'utf8')))))
}

/**
 * Die alternativen Namen — ohne sie beanstandet jeder heutige Browser das
 * Zertifikat, auch wenn der gemeine Name passt.
 *
 * Adressen kommen als vier Bytes hinein (Typ 7), Namen als Text (Typ 2).
 */
function altNamen(namen: string[], adressen: string[]): Buffer {
  const teile = [
    ...namen.map((wert) => feld(0x82, Buffer.from(wert, 'ascii'))),
    ...adressen.map((wert) => feld(0x87, Buffer.from(wert.split('.').map(Number))))
  ]
  return folge(oid(OID_SAN), feld(0x04, folge(...teile)))
}

/* ------------------------------------------------------------- Zertifikat */

export interface Zertifikat {
  /** PEM des Zertifikats. */
  cert: string
  /** PEM des privaten Schlüssels. */
  key: string
  /** SHA-256 über das Zertifikat, in Zweiergruppen — zum Vergleichen. */
  fingerabdruck: string
}

export function pem(bezeichnung: string, daten: Buffer): string {
  const b64 = daten.toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${bezeichnung}-----\n${b64}\n-----END ${bezeichnung}-----\n`
}

/**
 * Netzwerkkarten, die es nur im Rechner gibt.
 *
 * Hyper-V, WSL, VirtualBox, VMware und VPN-Zugänge tragen eigene Adressen —
 * echte Adressen, die im Saal nur niemand erreicht. Sie gehören nach hinten,
 * nicht weg: Wer in einer virtuellen Maschine arbeitet, braucht sie.
 */
const NUR_IM_RECHNER = /vethernet|hyper-v|wsl|virtualbox|vmware|vpn|loopback|docker|tailscale|zerotier/i

/**
 * Die Adressen dieses Rechners — die brauchbarste zuerst.
 *
 * **Warum die Reihenfolge zählt.** Die erste Adresse steht nicht nur oben in
 * der Liste; aus ihr werden die Links für Bühnen, Wahlseite und Wahlausschuss
 * gebaut. Stand dort die Adresse eines virtuellen Netzwerkschalters, führte
 * jeder dieser Links ins Leere — und im Saal sucht dann jemand den Fehler bei
 * seinem Telefon.
 *
 * Erkennbar ist das am Namen der Netzwerkkarte, nicht an der Adresse: Ein
 * Hyper-V-Schalter vergibt dieselben privaten Adressen wie ein WLAN.
 */
export function eigeneAdressen(): string[] {
  const gefunden: { name: string; address: string }[] = []
  for (const [name, eintraege] of Object.entries(networkInterfaces())) {
    for (const eintrag of eintraege ?? []) {
      if (eintrag.family === 'IPv4' && !eintrag.internal) gefunden.push({ name, address: eintrag.address })
    }
  }
  return sortiereAdressen(gefunden)
}

/**
 * Die Netzwerkkarten dieses Rechners, mit Namen — für die Auswahl.
 *
 * Erst der Name macht sie unterscheidbar: Ein Hyper-V-Schalter vergibt
 * dieselben privaten Adressen wie ein WLAN, und aus `192.168.224.1` allein
 * kann niemand ablesen, ob das der Saal ist oder eine virtuelle Maschine.
 */
export function netzwerkkarten(): { name: string; adresse: string; virtuell: boolean }[] {
  const gefunden: { name: string; adresse: string; virtuell: boolean }[] = []
  for (const [name, eintraege] of Object.entries(networkInterfaces())) {
    for (const eintrag of eintraege ?? []) {
      if (eintrag.family !== 'IPv4' || eintrag.internal) continue
      gefunden.push({ name, adresse: eintrag.address, virtuell: NUR_IM_RECHNER.test(name) })
    }
  }
  return gefunden.sort((a, b) => Number(a.virtuell) - Number(b.virtuell))
}

/**
 * Die Adresse, unter der Votura im Saal zu erreichen ist.
 *
 * Ist eine Netzwerkkarte fest eingestellt, gilt deren Adresse. Sonst die
 * erste brauchbare — das ist eine Annahme, und sie steht in der Oberfläche
 * auch als solche da.
 */
export function saaladresse(bindAddress?: string): string {
  if (bindAddress && bindAddress !== '0.0.0.0' && bindAddress !== '127.0.0.1') return bindAddress
  return eigeneAdressen().find((adresse) => adresse !== '127.0.0.1') ?? '127.0.0.1'
}

/** Die Sortierung für sich — ohne Netzwerkkarten, damit sie prüfbar ist. */
export function sortiereAdressen(eintraege: { name: string; address: string }[]): string[] {
  const echte = eintraege.filter((eintrag) => !NUR_IM_RECHNER.test(eintrag.name))
  const virtuelle = eintraege.filter((eintrag) => NUR_IM_RECHNER.test(eintrag.name))
  /* Der eigene Rechner zuletzt: Er ist immer erreichbar und nie gemeint. */
  return [...new Set([...echte, ...virtuelle].map((eintrag) => eintrag.address).concat('127.0.0.1'))]
}

/**
 * Ein Zertifikat erzeugen, das für dieses Gerät im Saalnetz gilt.
 *
 * Zwei Jahre Laufzeit: lang genug, dass es nicht mitten in einer Versammlung
 * abläuft, kurz genug, dass ein liegengebliebener Schlüssel nicht ewig gilt.
 */
export function erzeugeZertifikat(adressen = eigeneAdressen()): Zertifikat {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  /* Unmittelbar exportieren: `createPublicKey` auf einen bereits öffentlichen
     Schlüssel anzuwenden lehnt Node ab. */
  const spki = publicKey.export({ type: 'spki', format: 'der' })

  const jetzt = new Date()
  const bis = new Date(jetzt.getTime() + 2 * 365 * 24 * 3600 * 1000)
  const algorithmus = folge(oid(OID_SHA256_RSA), feld(0x05, Buffer.alloc(0)))

  const tbs = folge(
    feld(0xa0, ganzzahl(2)), // Fassung 3
    ganzzahl(Buffer.from(createHash('sha256').update(String(jetzt.getTime())).digest().subarray(0, 8))),
    algorithmus,
    name('Votura'),
    folge(zeitpunkt(jetzt), zeitpunkt(bis)),
    name('Votura'),
    spki,
    feld(
      0xa3,
      folge(
        altNamen(['localhost'], adressen),
        /* Kein Zwischenzertifikat: Dieses Zertifikat steht für sich. */
        folge(oid(OID_BASIC), feld(0x01, Buffer.from([0xff])), feld(0x04, folge())),
        folge(
          oid(OID_KEYUSAGE),
          feld(0x01, Buffer.from([0xff])),
          feld(0x04, feld(0x03, Buffer.from([0x05, 0xa0])))
        ),
        folge(oid(OID_EXTKEYUSAGE), feld(0x04, folge(oid(OID_SERVERAUTH))))
      )
    )
  )

  const unterschrift = createSign('sha256').update(tbs).sign(privateKey)
  const zertifikat = folge(tbs, algorithmus, feld(0x03, Buffer.concat([Buffer.from([0]), unterschrift])))

  return {
    cert: pem('CERTIFICATE', zertifikat),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerabdruck: fingerabdruckVon(zertifikat)
  }
}

/** Der Fingerabdruck, wie ihn ein Browser zeigt: SHA-256 in Zweiergruppen. */
export function fingerabdruckVon(zertifikat: Buffer): string {
  return (createHash('sha256').update(zertifikat).digest('hex').toUpperCase().match(/.{2}/g) ?? []).join(':')
}

/** Wo ein eigenes, echtes Zertifikat liegt, wenn es eines gibt. */
export function eigenesZertifikatPfade(ordner: string): { cert: string; key: string } {
  return { cert: join(ordner, 'eigenes-zertifikat.pem'), key: join(ordner, 'eigener-schluessel.pem') }
}

/**
 * Ein eigenes Zertifikat hinterlegen — von Let's Encrypt oder von woher auch
 * immer.
 *
 * Geprüft wird beim Ablegen, nicht erst beim Ausliefern: Ein Schlüssel, der
 * nicht zum Zertifikat gehört, fiele sonst erst auf, wenn im Saal die erste
 * Verbindung scheitert. Dann ist es zu spät, um es zu bemerken, und zu früh,
 * um es zu beheben.
 */
export function eigenesZertifikatAblegen(
  ordner: string,
  cert: string,
  key: string
): { domain: string; laeuftAbAm: string } {
  const geprueft = new X509Certificate(cert)
  if (!geprueft.checkPrivateKey(createPrivateKey(key))) {
    throw new Error('Der Schlüssel gehört nicht zu diesem Zertifikat.')
  }
  if (new Date(geprueft.validTo).getTime() < Date.now()) {
    throw new Error(`Dieses Zertifikat ist am ${new Date(geprueft.validTo).toLocaleDateString('de-DE')} abgelaufen.`)
  }

  const pfade = eigenesZertifikatPfade(ordner)
  mkdirSync(dirname(pfade.cert), { recursive: true })
  writeFileSync(pfade.cert, cert, 'utf8')
  writeFileSync(pfade.key, key, { encoding: 'utf8', mode: 0o600 })

  /* Der Name, für den es gilt — aus den alternativen Namen, nicht aus dem
     gemeinen Namen: Auf den greift seit Jahren kein Browser mehr zurück. */
  const ersterName = /DNS:([^,\s]+)/.exec(geprueft.subjectAltName ?? '')?.[1] ?? geprueft.subject
  return { domain: ersterName, laeuftAbAm: new Date(geprueft.validTo).toISOString() }
}

/**
 * Der Name, für den das hinterlegte Zertifikat gilt — oder nichts.
 *
 * Er entscheidet, unter welcher Adresse die Geräte im Saal hereinkommen: Ein
 * Zertifikat gilt für einen Namen, niemals für eine Adresse. Wer
 * `https://192.168.2.174:8477` aufruft, bekommt deshalb auch mit einem
 * tadellosen Zertifikat eine Warnung — und zwar zu Recht.
 */
export function zertifikatsName(ordner: string): string | null {
  const pfade = eigenesZertifikatPfade(ordner)
  if (!existsSync(pfade.cert)) return null
  try {
    const geparst = new X509Certificate(readFileSync(pfade.cert, 'utf8'))
    return /DNS:([^,\s]+)/.exec(geparst.subjectAltName ?? '')?.[1] ?? null
  } catch {
    return null
  }
}

/** Ein hinterlegtes eigenes Zertifikat wieder entfernen. */
export function eigenesZertifikatEntfernen(ordner: string): void {
  for (const pfad of Object.values(eigenesZertifikatPfade(ordner))) {
    if (existsSync(pfad)) rmSync(pfad)
  }
}

/**
 * Das Zertifikat dieses Rechners.
 *
 * **Ein hinterlegtes eigenes hat Vorrang.** Es ist der einzige Weg, auf dem
 * ein mitgebrachtes Telefon ohne Warnung hereinkommt; das selbst ausgestellte
 * ist der Notnagel, nicht die Absicht.
 *
 * Sonst: beim ersten Mal erzeugt, danach gelesen. Neu erzeugt wird es, wenn
 * sich die Adressen geändert haben — ein Zertifikat für ein anderes Netz
 * nützt im Saal nichts, und der Fehler fiele erst auf, wenn das erste Telefon
 * sich weigert.
 */
export function zertifikatFuer(ordner: string): Zertifikat {
  const eigen = eigenesZertifikatPfade(ordner)
  if (existsSync(eigen.cert) && existsSync(eigen.key)) {
    const cert = readFileSync(eigen.cert, 'utf8')
    const roh = Buffer.from(
      (/-----BEGIN CERTIFICATE-----([^-]+)-----END CERTIFICATE-----/.exec(cert)?.[1] ?? '').replace(/\s/g, ''),
      'base64'
    )
    return { cert, key: readFileSync(eigen.key, 'utf8'), fingerabdruck: fingerabdruckVon(roh) }
  }
  return selbstAusgestellt(ordner)
}

/** Das selbst ausgestellte Zertifikat — der Notnagel ohne eigene Domain. */
function selbstAusgestellt(ordner: string): Zertifikat {
  const certPfad = join(ordner, 'saal-zertifikat.pem')
  const keyPfad = join(ordner, 'saal-schluessel.pem')
  const adressen = eigeneAdressen()

  if (existsSync(certPfad) && existsSync(keyPfad)) {
    const cert = readFileSync(certPfad, 'utf8')
    const key = readFileSync(keyPfad, 'utf8')
    const roh = Buffer.from(cert.replace(/-----[^-]+-----|\s/g, ''), 'base64')
    if (adressen.every((adresse) => cert.includes('') && passtAdresse(roh, adresse))) {
      return { cert, key, fingerabdruck: fingerabdruckVon(roh) }
    }
  }

  const frisch = erzeugeZertifikat(adressen)
  mkdirSync(dirname(certPfad), { recursive: true })
  writeFileSync(certPfad, frisch.cert, 'utf8')
  writeFileSync(keyPfad, frisch.key, { encoding: 'utf8', mode: 0o600 })
  return frisch
}

/** Steht diese Adresse in den alternativen Namen des Zertifikats? */
function passtAdresse(zertifikat: Buffer, adresse: string): boolean {
  const gesucht = Buffer.from(adresse.split('.').map(Number))
  if (gesucht.length !== 4) return true
  return zertifikat.includes(Buffer.concat([Buffer.from([0x87, 0x04]), gesucht]))
}

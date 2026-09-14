/**
 * Ein echtes Zertifikat von Let's Encrypt — geholt von diesem Rechner selbst.
 *
 * ## Das Problem dahinter
 *
 * Ein Zertifikat gilt, weil eine öffentliche Stelle für einen **Namen**
 * bürgt. Für `192.168.1.5` bürgt niemand und kann niemand bürgen — deshalb
 * warnt jedes mitgebrachte Telefon bei einem selbst ausgestellten Zertifikat,
 * und deshalb sind für geheime Wahlen bisher Wahlkabinen empfohlen.
 *
 * Wer eine eigene Domain besitzt, kommt aus dieser Sackgasse heraus:
 * `saal.mein-verband.de` zeigt auf die Adresse des Rechners im Saal, und für
 * diesen Namen stellt Let's Encrypt ein Zertifikat aus, dem jedes Gerät der
 * Welt vertraut. Ohne Warnung, ohne Installation, ohne Wegklicken.
 *
 * ## Warum das Verfahren über das Domain-Namensystem läuft
 *
 * Die üblichen Verfahren verlangen, dass der Rechner **aus dem Internet
 * erreichbar** ist — ein Notebook im Vereinsheim ist das nicht und soll es
 * nie sein. Bleibt `dns-01`: Die Prüfstelle fragt nicht den Rechner, sondern
 * das Namensystem. Dort trägt der Betreiber einen Wert ein, den dieses
 * Programm ausrechnet. Der Rechner muss dafür nur **hinaus** telefonieren
 * können, nicht erreichbar sein.
 *
 * Das heißt auch: **Zertifikat vorher holen, im Saal offline arbeiten.** Am
 * Versammlungstag braucht Votura kein Internet mehr; es liest die Datei.
 *
 * ## Warum das hier steht und nicht aus einer Bibliothek kommt
 *
 * ACME (RFC 8555) ist HTTPS mit JSON und unterschriebenen Nachrichten. Alles
 * dafür ist da: `node:https`, `node:crypto` zum Unterschreiben und die
 * DER-Bausteine aus `tls.ts`, mit denen schon das selbst ausgestellte
 * Zertifikat gebaut wird. Eine Bibliothek wäre die dritte Abhängigkeit — und
 * zwar eine, die im entscheidenden Moment Schlüssel in der Hand hält.
 *
 * ## Was dieses Modul nicht tut
 *
 * Es ändert **nichts** am DNS. Der Wert wird angezeigt; eintragen muss ihn
 * ein Mensch bei seinem Anbieter. Eine Schnittstelle zu einem
 * DNS-Dienstleister wäre ein weiterer Zugang mit weiteren Zugangsdaten auf
 * einem Rechner, der Wahlen durchführt.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  type KeyObject
} from 'node:crypto'
import { request } from 'node:https'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { feld, folge, name, oid, pem } from './tls'
import { logger } from './logger'

/** Die Prüfstelle. */
export const ACME_ECHT = 'https://acme-v02.api.letsencrypt.org/directory'

/**
 * Die Übungsumgebung von Let's Encrypt.
 *
 * Ihre Zertifikate sind **wertlos** — kein Gerät vertraut ihnen. Genau
 * deshalb gibt es sie: Die echte Umgebung erlaubt nur wenige Fehlversuche je
 * Stunde und wenige Zertifikate je Woche. Wer den Ablauf ausprobiert, tut das
 * hier, sonst steht er am Versammlungstag vor einer Sperre.
 */
export const ACME_UEBUNG = 'https://acme-staging-v02.api.letsencrypt.org/directory'

/* -------------------------------------------------------------- Kleinkram */

const b64url = (roh: Buffer | Uint8Array): string =>
  Buffer.from(roh).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

interface Antwort {
  status: number
  kopf: Record<string, string | string[] | undefined>
  text: string
  json: <T>() => T
}

/**
 * Eine Anfrage an die Prüfstelle.
 *
 * Zu Fuß und nicht über den bequemen Weg: Hier zählt der `Replay-Nonce` im
 * Kopf **jeder** Antwort, und der geht in manchen Umwegen verloren.
 */
async function ruf(adresse: string, koerper?: string, art = 'POST'): Promise<Antwort> {
  return new Promise((fertig, fehlschlag) => {
    const ziel = new URL(adresse)
    const anfrage = request(
      {
        hostname: ziel.hostname,
        port: ziel.port || 443,
        path: `${ziel.pathname}${ziel.search}`,
        method: koerper === undefined ? art : 'POST',
        headers: {
          'User-Agent': 'Votura',
          ...(koerper === undefined ? {} : { 'Content-Type': 'application/jose+json' })
        }
      },
      (antwort) => {
        let gesammelt = ''
        antwort.on('data', (stueck) => (gesammelt += stueck))
        antwort.on('end', () =>
          fertig({
            status: antwort.statusCode ?? 0,
            kopf: antwort.headers,
            text: gesammelt,
            json: <T>() => JSON.parse(gesammelt || '{}') as T
          })
        )
      }
    )
    anfrage.on('error', (grund) =>
      fehlschlag(
        new Error(
          `Die Prüfstelle ist nicht erreichbar (${grund.message}). Für dieses Verfahren braucht der Rechner einmalig Zugang zum Internet — im Saal später nicht mehr.`
        )
      )
    )
    if (koerper !== undefined) anfrage.write(koerper)
    anfrage.end()
  })
}

/** Der Fingerabdruck des Kontoschlüssels nach RFC 7638 — die Reihenfolge zählt. */
function daumenabdruck(oeffentlich: KeyObject): string {
  const jwk = oeffentlich.export({ format: 'jwk' }) as { e: string; n: string }
  const geordnet = `{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`
  return b64url(createHash('sha256').update(geordnet).digest())
}

/* --------------------------------------------------------- Kontoschlüssel */

interface Konto {
  privat: KeyObject
  oeffentlich: KeyObject
  /** Kennung des Kontos bei der Prüfstelle, sobald es angelegt wurde. */
  kid?: string
}

/**
 * Der Kontoschlüssel — einmal erzeugt, danach immer derselbe.
 *
 * Er ist **nicht** der Schlüssel des Zertifikats. Mit ihm unterschreibt
 * dieses Programm seine Nachrichten an die Prüfstelle; wer ihn hat, kann für
 * dieses Konto Zertifikate beantragen und widerrufen. Deshalb liegt er neben
 * den übrigen Schlüsseln und nur für den Benutzer lesbar.
 */
export function kontoSchluessel(ordner: string): Konto {
  const pfad = join(ordner, 'acme-konto.pem')
  if (existsSync(pfad)) {
    const privat = createPrivateKey(readFileSync(pfad, 'utf8'))
    return { privat, oeffentlich: createPublicKey(privat) }
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  mkdirSync(dirname(pfad), { recursive: true })
  writeFileSync(pfad, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), {
    encoding: 'utf8',
    mode: 0o600
  })
  return { privat: privateKey, oeffentlich: publicKey }
}

/* ------------------------------------------------------------ Das Protokoll */

interface Verzeichnis {
  newNonce: string
  newAccount: string
  newOrder: string
  meta?: { termsOfService?: string }
}

/**
 * Eine unterschriebene Nachricht (JWS, RFC 7515).
 *
 * `jwk` beim Anlegen des Kontos, danach `kid` — die Prüfstelle kennt den
 * Schlüssel dann bereits und will die Kennung sehen.
 */
function unterschreiben(konto: Konto, url: string, nonce: string, nutzlast: unknown | undefined): string {
  const jwk = konto.oeffentlich.export({ format: 'jwk' })
  const kopf = {
    alg: 'RS256',
    nonce,
    url,
    ...(konto.kid ? { kid: konto.kid } : { jwk })
  }
  const geschuetzt = b64url(Buffer.from(JSON.stringify(kopf)))
  /* „POST-as-GET" ist eine Nachricht mit **leerer** Nutzlast, nicht mit
     leerem Objekt. Der Unterschied entscheidet über 400 oder 200. */
  const inhalt = nutzlast === undefined ? '' : b64url(Buffer.from(JSON.stringify(nutzlast)))
  const signatur = createSign('sha256').update(`${geschuetzt}.${inhalt}`).sign(konto.privat)
  return JSON.stringify({ protected: geschuetzt, payload: inhalt, signature: b64url(signatur) })
}

/** Die Prüfstelle vergibt für jede Nachricht eine neue Einmalzahl. */
class Nonce {
  private wert: string | null = null
  constructor(private readonly quelle: string) {}

  merken(antwort: Antwort): void {
    const neu = antwort.kopf['replay-nonce']
    if (typeof neu === 'string') this.wert = neu
  }

  async holen(): Promise<string> {
    if (this.wert) {
      const wert = this.wert
      this.wert = null
      return wert
    }
    const antwort = await ruf(this.quelle, undefined, 'HEAD')
    const neu = antwort.kopf['replay-nonce']
    if (typeof neu !== 'string') throw new Error('Die Prüfstelle hat keine Einmalzahl geliefert.')
    return neu
  }
}

/* ------------------------------------------------------------- Der Ablauf */

export interface AuftragOffen {
  /** Der Name, für den das Zertifikat gilt. */
  domain: string
  /** Was ins Domain-Namensystem eingetragen werden muss. */
  eintrag: { name: string; wert: string }
  /** Kennung, mit der es nach dem Eintrag weitergeht. */
  faden: string
}

interface Zwischenstand {
  konto: Konto
  nonce: Nonce
  auftragUrl: string
  challengeUrl: string
  authUrl: string
  domain: string
}

/** Zwischen „Wert anzeigen" und „jetzt prüfen lassen" — nur im Arbeitsspeicher. */
const offeneAuftraege = new Map<string, Zwischenstand>()

/**
 * Schritt 1: Konto anlegen, Auftrag stellen, den DNS-Wert ausrechnen.
 *
 * Danach ist der Mensch an der Reihe: Er trägt den Wert bei seinem
 * DNS-Anbieter ein. Erst wenn das geschehen **und übernommen** ist, geht es
 * mit `auftragAbschliessen` weiter — zu früh gefragt zählt als Fehlversuch,
 * und davon erlaubt die Prüfstelle nur wenige je Stunde.
 */
export async function auftragBeginnen(input: {
  domain: string
  email: string
  ordner: string
  verzeichnisUrl?: string
}): Promise<AuftragOffen> {
  const domain = input.domain.trim().toLowerCase()
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw new Error('Das ist kein gültiger Name. Erwartet wird etwas wie „saal.mein-verband.de".')
  }
  if (!input.email.includes('@')) {
    throw new Error('Die Prüfstelle verlangt eine E-Mail-Adresse — sie warnt darüber vor Ablauf.')
  }

  const konto = kontoSchluessel(input.ordner)
  const verzeichnis = (await ruf(input.verzeichnisUrl ?? ACME_ECHT, undefined, 'GET')).json<Verzeichnis>()
  const nonce = new Nonce(verzeichnis.newNonce)

  /* Konto anlegen oder das vorhandene wiederfinden — beides beantwortet die
     Prüfstelle mit derselben Kennung im Kopf. */
  const kontoAntwort = await ruf(
    verzeichnis.newAccount,
    unterschreiben(konto, verzeichnis.newAccount, await nonce.holen(), {
      termsOfServiceAgreed: true,
      contact: [`mailto:${input.email.trim()}`]
    })
  )
  nonce.merken(kontoAntwort)
  if (kontoAntwort.status >= 400) throw new Error(fehlertext(kontoAntwort, 'Das Konto wurde abgelehnt'))
  const kid = kontoAntwort.kopf.location
  if (typeof kid !== 'string') throw new Error('Die Prüfstelle hat keine Kontokennung geliefert.')
  konto.kid = kid

  const auftrag = await ruf(
    verzeichnis.newOrder,
    unterschreiben(konto, verzeichnis.newOrder, await nonce.holen(), {
      identifiers: [{ type: 'dns', value: domain }]
    })
  )
  nonce.merken(auftrag)
  if (auftrag.status >= 400) throw new Error(fehlertext(auftrag, 'Der Auftrag wurde abgelehnt'))
  const auftragUrl = String(auftrag.kopf.location ?? '')
  const { authorizations } = auftrag.json<{ authorizations: string[] }>()

  const authUrl = authorizations[0]
  const auth = await ruf(authUrl, unterschreiben(konto, authUrl, await nonce.holen(), undefined))
  nonce.merken(auth)
  const { challenges } = auth.json<{ challenges: { type: string; url: string; token: string }[] }>()
  const dns = challenges.find((eintrag) => eintrag.type === 'dns-01')
  if (!dns) throw new Error('Die Prüfstelle bietet kein Verfahren über das Domain-Namensystem an.')

  /*
   * Der Wert, der ins DNS gehört: die Prüfsumme über Token und
   * Kontofingerabdruck. Er beweist, dass derselbe, der den Auftrag gestellt
   * hat, auch über den Namen verfügt.
   */
  const nachweis = `${dns.token}.${daumenabdruck(konto.oeffentlich)}`
  const wert = b64url(createHash('sha256').update(nachweis).digest())

  const faden = b64url(createHash('sha256').update(`${domain}${Date.now()}`).digest()).slice(0, 16)
  offeneAuftraege.set(faden, {
    konto,
    nonce,
    auftragUrl,
    challengeUrl: dns.url,
    authUrl,
    domain
  })

  logger.info(`ACME: Auftrag für ${domain} gestellt, wartet auf den DNS-Eintrag`)
  return { domain, eintrag: { name: `_acme-challenge.${domain}`, wert }, faden }
}

/**
 * Schritt 2: prüfen lassen und das Zertifikat holen.
 *
 * Erst hier entsteht der Schlüssel des Zertifikats. Er hat mit dem
 * Kontoschlüssel nichts zu tun und verlässt diesen Rechner nie — die
 * Prüfstelle sieht nur den öffentlichen Teil im Antrag.
 */
export async function auftragAbschliessen(faden: string): Promise<{ cert: string; key: string }> {
  const stand = offeneAuftraege.get(faden)
  if (!stand) throw new Error('Dieser Vorgang ist abgelaufen. Bitte neu beginnen.')
  const { konto, nonce } = stand

  const angestossen = await ruf(
    stand.challengeUrl,
    unterschreiben(konto, stand.challengeUrl, await nonce.holen(), {})
  )
  nonce.merken(angestossen)
  if (angestossen.status >= 400) throw new Error(fehlertext(angestossen, 'Die Prüfung wurde abgelehnt'))

  /* Die Prüfstelle fragt das Namensystem selbst ab; das dauert Sekunden bis
     Minuten, je nachdem, wie schnell der Eintrag sich verbreitet. */
  const auth = await warten(
    async () => {
      const antwort = await ruf(
        stand.authUrl,
        unterschreiben(konto, stand.authUrl, await nonce.holen(), undefined)
      )
      nonce.merken(antwort)
      return antwort.json<{ status: string; challenges?: { error?: { detail?: string } }[] }>()
    },
    (wert) => wert.status === 'valid' || wert.status === 'invalid',
    60
  )
  if (auth.status !== 'valid') {
    const grund = auth.challenges?.find((eintrag) => eintrag.error?.detail)?.error?.detail
    throw new Error(
      `Der Eintrag im Domain-Namensystem wurde nicht gefunden oder passt nicht${grund ? ` (${grund})` : ''}. Häufigster Grund: Er ist noch nicht überall übernommen — einige Minuten warten und erneut prüfen lassen.`
    )
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const csr = erzeugeAntrag(stand.domain, privateKey, publicKey)

  const auftrag = await ruf(
    stand.auftragUrl,
    unterschreiben(konto, stand.auftragUrl, await nonce.holen(), undefined)
  )
  nonce.merken(auftrag)
  const { finalize } = auftrag.json<{ finalize: string }>()

  const eingereicht = await ruf(
    finalize,
    unterschreiben(konto, finalize, await nonce.holen(), { csr: b64url(csr) })
  )
  nonce.merken(eingereicht)
  if (eingereicht.status >= 400) throw new Error(fehlertext(eingereicht, 'Der Antrag wurde abgelehnt'))

  const abgeschlossen = await warten(
    async () => {
      const antwort = await ruf(
        stand.auftragUrl,
        unterschreiben(konto, stand.auftragUrl, await nonce.holen(), undefined)
      )
      nonce.merken(antwort)
      return antwort.json<{ status: string; certificate?: string }>()
    },
    (wert) => wert.status === 'valid' || wert.status === 'invalid',
    60
  )
  if (abgeschlossen.status !== 'valid' || !abgeschlossen.certificate) {
    throw new Error('Die Prüfstelle hat kein Zertifikat ausgestellt.')
  }

  const abholung = await ruf(
    abgeschlossen.certificate,
    unterschreiben(konto, abgeschlossen.certificate, await nonce.holen(), undefined)
  )
  nonce.merken(abholung)
  offeneAuftraege.delete(faden)
  logger.info(`ACME: Zertifikat für ${stand.domain} ausgestellt`)

  return {
    cert: abholung.text,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }
}

/* --------------------------------------------------- Der Zertifikatsantrag */

/**
 * Ein PKCS#10-Antrag, von Hand kodiert.
 *
 * Er sagt: „Für diesen Namen, mit diesem öffentlichen Schlüssel" — und ist
 * mit dem zugehörigen privaten Schlüssel unterschrieben, damit niemand einen
 * fremden Schlüssel eintragen lassen kann. Die Bausteine sind dieselben, mit
 * denen `tls.ts` das selbst ausgestellte Zertifikat baut.
 */
export function erzeugeAntrag(domain: string, privat: KeyObject, oeffentlich: KeyObject): Buffer {
  const spki = oeffentlich.export({ type: 'spki', format: 'der' })
  /*
   * Der alternative Name gehört auch in den Antrag: Ohne ihn stellt die
   * Prüfstelle zwar aus, aber die Browser beanstanden das Ergebnis — der
   * Rückgriff auf den gemeinen Namen wurde vor Jahren abgeschafft.
   */
  const erweiterungen = folge(
    oid('1.2.840.113549.1.9.14'),
    feld(
      0x31,
      folge(folge(oid('2.5.29.17'), feld(0x04, folge(feld(0x82, Buffer.from(domain, 'ascii'))))))
    )
  )

  const inhalt = folge(
    feld(0x02, Buffer.from([0])), // Fassung 0
    name(domain),
    spki,
    feld(0xa0, erweiterungen)
  )
  const algorithmus = folge(oid('1.2.840.113549.1.1.11'), feld(0x05, Buffer.alloc(0)))
  const unterschrift = createSign('sha256').update(inhalt).sign(privat)
  return folge(inhalt, algorithmus, feld(0x03, Buffer.concat([Buffer.from([0]), unterschrift])))
}

/** Denselben Antrag als PEM — zum Ansehen und Aufheben. */
export function antragAlsPem(csr: Buffer): string {
  return pem('CERTIFICATE REQUEST', csr)
}

/* ------------------------------------------------------------------ Helfer */

async function warten<T>(holen: () => Promise<T>, fertig: (wert: T) => boolean, versuche: number): Promise<T> {
  let letzter = await holen()
  for (let i = 0; i < versuche && !fertig(letzter); i++) {
    await new Promise((weiter) => setTimeout(weiter, 2000))
    letzter = await holen()
  }
  return letzter
}

function fehlertext(antwort: Antwort, was: string): string {
  try {
    const { detail } = antwort.json<{ detail?: string }>()
    return `${was}: ${detail ?? antwort.text}`
  } catch {
    return `${was} (${antwort.status}).`
  }
}

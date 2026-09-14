/**
 * Das Rechenwerk der geheimen digitalen Wahl.
 *
 * Geprüft wird gegen echte RSA-Schlüssel und echte Zahlen, nicht gegen
 * Textstellen: Bei einer Rechnung sagt nur der Durchlauf, ob sie stimmt. Die
 * entscheidende Prüfung ist dabei nicht „es funktioniert", sondern **dass die
 * signierende Seite nichts erfährt** — das ist der ganze Zweck.
 */
import { createHash, generateKeyPairSync, constants, privateEncrypt, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ausBase64Url,
  entblenden,
  mgf1,
  modInvers,
  modPot,
  pruefeSignatur,
  schluessellaenge,
  seriennummerAufZahl,
  verblenden,
  zuBase64Url,
  zuBigInt,
  zuBytes,
  type OeffentlicherSchluessel
} from '../src/shared/blindsignatur'

const sha256 = async (daten: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(createHash('sha256').update(daten).digest())

/* Ein Schlüsselpaar für alle Prüfungen — 2048 Bit zu erzeugen kostet Zeit,
   und geprüft wird die Rechnung, nicht die Schlüsselerzeugung. */
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 65537
})
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string }
const schluessel: OeffentlicherSchluessel = { n: jwk.n, e: jwk.e }

/** Was der Server tut: roh signieren, ohne zu wissen, worüber. */
function blindSignieren(verblendet: string): string {
  const laenge = schluessellaenge(schluessel)
  const eingabe = Buffer.from(zuBytes(zuBigInt(ausBase64Url(verblendet)), laenge))
  const roh = privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, eingabe)
  return zuBase64Url(new Uint8Array(roh))
}

describe('Umrechnen', () => {
  it('geht verlustfrei durch Bytes und zurück', () => {
    const wert = 1234567890123456789012345678901234567890n
    expect(zuBigInt(zuBytes(wert, 32))).toBe(wert)
  })

  it('geht verlustfrei durch base64url und zurück', () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128, 64])
    expect([...ausBase64Url(zuBase64Url(bytes))]).toEqual([...bytes])
  })

  it('behält führende Nullen', () => {
    /* Eine Zahl, die zufällig mit einem Nullbyte beginnt, darf nicht kürzer
       werden — sonst passt die Länge nicht zum Modulus, und RSA rechnet mit
       einem anderen Wert als gemeint. */
    const bytes = new Uint8Array([0, 0, 42])
    expect(zuBytes(zuBigInt(bytes), 3)).toEqual(bytes)
  })
})

describe('Rechenwerk', () => {
  it('potenziert modular richtig', () => {
    expect(modPot(4n, 13n, 497n)).toBe(445n)
    expect(modPot(2n, 0n, 7n)).toBe(1n)
  })

  it('findet das Inverse', () => {
    expect((modInvers(3n, 11n) * 3n) % 11n).toBe(1n)
    expect((modInvers(65537n, 1000003n) * 65537n) % 1000003n).toBe(1n)
  })

  it('weist zurück, wo es kein Inverses gibt', () => {
    expect(() => modInvers(4n, 8n)).toThrow(/Inverses/)
  })

  it('dehnt die Prüfsumme auf die verlangte Länge', async () => {
    const kurz = await mgf1(new Uint8Array([1, 2, 3]), 10, sha256)
    const lang = await mgf1(new Uint8Array([1, 2, 3]), 255, sha256)
    expect(kurz).toHaveLength(10)
    expect(lang).toHaveLength(255)
    /* Derselbe Anfang: MGF1 hängt Blöcke an, es rechnet nicht neu. */
    expect([...lang.slice(0, 10)]).toEqual([...kurz])
  })

  it('bildet die Seriennummer unter den Modulus ab', async () => {
    /*
     * Ein Byte kürzer als der Modulus — damit ist das Ergebnis immer kleiner
     * als n, ohne Restbildung. Eine Restbildung verzerrte die Verteilung an
     * genau einer Stelle.
     */
    const n = zuBigInt(ausBase64Url(schluessel.n))
    for (let versuch = 0; versuch < 20; versuch++) {
      const m = await seriennummerAufZahl(new Uint8Array(randomBytes(32)), schluessel, sha256)
      expect(m).toBeLessThan(n)
      expect(m).toBeGreaterThan(0n)
    }
  })
})

describe('Blindsignatur', () => {
  const zufall = (laenge: number): Uint8Array => new Uint8Array(randomBytes(laenge))

  it('ergibt eine gültige Signatur über die Seriennummer', async () => {
    const seriennummer = new Uint8Array(randomBytes(32))
    const { verblendet, faktor } = await verblenden(seriennummer, schluessel, sha256, zufall)
    const signatur = entblenden(blindSignieren(verblendet), faktor, schluessel)

    expect(await pruefeSignatur(seriennummer, signatur, schluessel, sha256)).toBe(true)
  })

  it('verrät der signierenden Seite nichts', async () => {
    /*
     * **Die Prüfung, um die es geht.** Was der Server sieht — der verblendete
     * Wert und die Blindsignatur —, darf mit der Seriennummer und der fertigen
     * Signatur nichts gemein haben. Sonst wäre die Trennung nur eine
     * Behauptung.
     */
    const seriennummer = new Uint8Array(randomBytes(32))
    const { verblendet, faktor } = await verblenden(seriennummer, schluessel, sha256, zufall)
    const blind = blindSignieren(verblendet)
    const signatur = entblenden(blind, faktor, schluessel)

    expect(verblendet).not.toBe(signatur)
    expect(blind).not.toBe(signatur)
    expect(verblendet).not.toContain(zuBase64Url(seriennummer))
    expect(blind).not.toContain(zuBase64Url(seriennummer))
  })

  it('sieht bei gleicher Seriennummer jedes Mal anders aus', async () => {
    /*
     * Zweimal dieselbe Nummer verblenden ergibt zwei völlig verschiedene
     * Anfragen. Andernfalls könnte der Server zwei Vorgänge desselben Geräts
     * einander zuordnen.
     */
    const seriennummer = new Uint8Array(randomBytes(32))
    const erst = await verblenden(seriennummer, schluessel, sha256, zufall)
    const zweit = await verblenden(seriennummer, schluessel, sha256, zufall)
    expect(erst.verblendet).not.toBe(zweit.verblendet)

    /* Und beide ergeben trotzdem dieselbe gültige Signatur. */
    const a = entblenden(blindSignieren(erst.verblendet), erst.faktor, schluessel)
    const b = entblenden(blindSignieren(zweit.verblendet), zweit.faktor, schluessel)
    expect(a).toBe(b)
  })

  it('weist eine Signatur zu einer anderen Seriennummer ab', async () => {
    /* Sonst ließe sich eine einmal erhaltene Unterschrift auf beliebig viele
       Stimmzettel setzen. */
    const echte = new Uint8Array(randomBytes(32))
    const fremde = new Uint8Array(randomBytes(32))
    const { verblendet, faktor } = await verblenden(echte, schluessel, sha256, zufall)
    const signatur = entblenden(blindSignieren(verblendet), faktor, schluessel)

    expect(await pruefeSignatur(fremde, signatur, schluessel, sha256)).toBe(false)
  })

  it('weist eine erfundene Signatur ab', async () => {
    const seriennummer = new Uint8Array(randomBytes(32))
    const erfunden = zuBase64Url(new Uint8Array(randomBytes(256)))
    expect(await pruefeSignatur(seriennummer, erfunden, schluessel, sha256)).toBe(false)
  })

  it('weist eine Signatur unter einem anderen Schlüssel ab', async () => {
    /* Je Wahlgang ein eigenes Schlüsselpaar: Eine Berechtigung aus Wahlgang 1
       darf in Wahlgang 2 nichts gelten. */
    const anderes = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
    const anderesJwk = anderes.publicKey.export({ format: 'jwk' }) as { n: string; e: string }

    const seriennummer = new Uint8Array(randomBytes(32))
    const { verblendet, faktor } = await verblenden(seriennummer, schluessel, sha256, zufall)
    const signatur = entblenden(blindSignieren(verblendet), faktor, schluessel)

    expect(await pruefeSignatur(seriennummer, signatur, { n: anderesJwk.n, e: anderesJwk.e }, sha256)).toBe(
      false
    )
  })

  it('weist entartete Werte ab', async () => {
    /* 0, 1 und n selbst ergeben Signaturen, die sich ohne Schlüssel erzeugen
       lassen. */
    const seriennummer = new Uint8Array(randomBytes(32))
    const laenge = schluessellaenge(schluessel)
    for (const wert of [0n, 1n, zuBigInt(ausBase64Url(schluessel.n))]) {
      expect(await pruefeSignatur(seriennummer, zuBase64Url(zuBytes(wert, laenge)), schluessel, sha256)).toBe(
        false
      )
    }
  })
})

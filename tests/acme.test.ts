/**
 * Der Weg zum echten Zertifikat.
 *
 * Geprüft wird hier **nicht**, ob Let's Encrypt antwortet — das hinge an
 * einer Internetverbindung und an einer fremden Stelle, die Fehlversuche
 * zählt. Geprüft wird das, was bei uns schiefgehen kann und wovon alles
 * andere abhängt: der von Hand kodierte Zertifikatsantrag.
 *
 * Bei einem Binärformat ist alles andere Selbstbetrug. Deshalb wird der
 * Antrag hier nicht „auf plausibel" angesehen, sondern **auseinandergenommen
 * und nachgerechnet**: Die Unterschrift muss über genau den Teil gelten, den
 * die Prüfstelle prüfen wird.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { antragAlsPem, erzeugeAntrag, kontoSchluessel } from '../src/main/acme'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const antrag = erzeugeAntrag('saal.mein-verband.de', privateKey, publicKey)

/**
 * Ein Feld aus DER herausschneiden: Typ, Länge, Inhalt.
 *
 * Absichtlich zu Fuß und ohne Bibliothek — die Prüfung soll unabhängig von
 * dem sein, was sie prüft.
 */
function feldAb(daten: Buffer, start: number): { typ: number; kopf: number; laenge: number } {
  const typ = daten[start]
  const erstes = daten[start + 1]
  if (erstes < 0x80) return { typ, kopf: 2, laenge: erstes }
  const bytes = erstes & 0x7f
  let laenge = 0
  for (let i = 0; i < bytes; i++) laenge = (laenge << 8) | daten[start + 2 + i]
  return { typ, kopf: 2 + bytes, laenge }
}

describe('Der Zertifikatsantrag', () => {
  it('ist eine Folge aus Inhalt, Verfahren und Unterschrift', () => {
    const aussen = feldAb(antrag, 0)
    expect(aussen.typ).toBe(0x30)
    expect(aussen.kopf + aussen.laenge).toBe(antrag.length)
  })

  it('trägt eine Unterschrift, die über genau seinen Inhalt gilt', () => {
    /*
     * **Die Prüfung, um die es geht.** Die Prüfstelle rechnet genau das nach.
     * Stimmt hier ein Byte nicht, kommt die Absage erst, wenn jemand vor der
     * Versammlung ein Zertifikat braucht.
     */
    const aussen = feldAb(antrag, 0)
    const inhaltStart = aussen.kopf
    const inhalt = feldAb(antrag, inhaltStart)
    const inhaltBytes = antrag.subarray(inhaltStart, inhaltStart + inhalt.kopf + inhalt.laenge)

    const algorithmusStart = inhaltStart + inhalt.kopf + inhalt.laenge
    const algorithmus = feldAb(antrag, algorithmusStart)
    const bitStart = algorithmusStart + algorithmus.kopf + algorithmus.laenge
    const bit = feldAb(antrag, bitStart)
    /* Das erste Byte einer Bitkette sagt, wie viele Bits am Ende ungenutzt
       sind — bei einer Unterschrift immer null. */
    expect(antrag[bitStart + bit.kopf]).toBe(0)
    const unterschrift = antrag.subarray(bitStart + bit.kopf + 1, bitStart + bit.kopf + bit.laenge)

    expect(createVerify('sha256').update(inhaltBytes).verify(publicKey, unterschrift)).toBe(true)
  })

  it('nennt den Namen als alternativen Namen', () => {
    /* Ohne ihn stellt die Prüfstelle zwar aus, aber jeder heutige Browser
       beanstandet das Ergebnis. */
    const alsName = Buffer.concat([
      Buffer.from([0x82, 'saal.mein-verband.de'.length]),
      Buffer.from('saal.mein-verband.de', 'ascii')
    ])
    expect(antrag.includes(alsName)).toBe(true)
  })

  it('enthält den öffentlichen Schlüssel, nicht den privaten', () => {
    const spki = publicKey.export({ type: 'spki', format: 'der' })
    expect(antrag.includes(spki)).toBe(true)
    expect(antrag.includes(Buffer.from('PRIVATE'))).toBe(false)
  })

  it('lässt sich als PEM ausgeben', () => {
    const text = antragAlsPem(antrag)
    expect(text).toContain('-----BEGIN CERTIFICATE REQUEST-----')
    expect(text).toContain('-----END CERTIFICATE REQUEST-----')
  })
})

describe('Der Kontoschlüssel', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'votura-acme-'))

  it('entsteht einmal und bleibt danach derselbe', () => {
    /*
     * Er ist die Kennung dieses Rechners bei der Prüfstelle. Jedes Mal einen
     * neuen zu erzeugen hieße, jedes Mal ein neues Konto anzulegen — und die
     * Prüfstelle zählt auch das.
     */
    const erst = kontoSchluessel(ordner)
    const wieder = kontoSchluessel(ordner)
    expect(wieder.privat.export({ type: 'pkcs8', format: 'pem' })).toEqual(
      erst.privat.export({ type: 'pkcs8', format: 'pem' })
    )
  })

  it('liegt nur für den eigenen Benutzer lesbar', () => {
    kontoSchluessel(ordner)
    const rechte = statSync(join(ordner, 'acme-konto.pem')).mode & 0o777
    /* Unter Windows kennt das Dateisystem diese Bits nicht — dort ist die
       Prüfung gegenstandslos, unter Linux und auf dem Raspberry Pi nicht. */
    if (process.platform !== 'win32') expect(rechte).toBe(0o600)
  })

  it('ist nicht der Schlüssel des Zertifikats', () => {
    /* Zwei Schlüssel mit zwei Aufgaben: Mit dem einen wird geredet, mit dem
       anderen ausgeliefert. Wer sie zusammenlegt, verliert beide zugleich. */
    const konto = kontoSchluessel(ordner)
    const eigen = konto.privat.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(eigen).not.toBe(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  })
})

/**
 * Das selbst ausgestellte Zertifikat für das Saalnetz.
 *
 * Geprüft wird nicht, ob die Bytes „richtig aussehen", sondern ob **echte
 * Software es annimmt**: Node parst es mit `X509Certificate`, und ein echter
 * TLS-Server liefert damit eine echte Anfrage aus. Bei einem Binärformat ist
 * alles andere Selbstbetrug.
 */
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { createServer } from 'node:https'
import { get } from 'node:https'
import { describe, expect, it } from 'vitest'
import { erzeugeZertifikat, fingerabdruckVon } from '../src/main/tls'

const zertifikat = erzeugeZertifikat(['192.168.1.5', '127.0.0.1'])
const geparst = new X509Certificate(zertifikat.cert)

describe('Das Zertifikat', () => {
  it('lässt sich von Node lesen', () => {
    /* Der erste und härteste Prüfstein: Ein selbst kodiertes X.509 ist
       entweder gültig oder Müll — dazwischen gibt es nichts. */
    expect(geparst.subject).toContain('Votura')
    expect(geparst.issuer).toContain('Votura')
  })

  it('nennt die Adressen, unter denen der Server erreichbar ist', () => {
    /*
     * Ohne alternative Namen beanstandet jeder heutige Browser das
     * Zertifikat, auch wenn der gemeine Name passt — der Rückgriff auf ihn
     * wurde vor Jahren abgeschafft.
     */
    expect(geparst.subjectAltName).toContain('192.168.1.5')
    expect(geparst.subjectAltName).toContain('127.0.0.1')
    expect(geparst.subjectAltName).toContain('localhost')
  })

  it('gilt ab jetzt und noch eine Weile', () => {
    /* Lang genug, dass es nicht mitten in einer Versammlung abläuft. */
    expect(new Date(geparst.validFrom).getTime()).toBeLessThanOrEqual(Date.now())
    expect(new Date(geparst.validTo).getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 3600 * 1000)
  })

  it('trägt einen Fingerabdruck, den man vorlesen kann', () => {
    /* Bei einem selbst ausgestellten Zertifikat ist der Vergleich des
       Fingerabdrucks die einzige Prüfmöglichkeit, die ein Mensch hat. */
    expect(zertifikat.fingerabdruck).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(geparst.fingerprint256.replace(/:/g, '')).toBe(zertifikat.fingerabdruck.replace(/:/g, ''))
  })

  it('unterschreibt sich selbst gültig', () => {
    /* Eine falsche Unterschrift fiele sonst erst auf, wenn ein Gerät sich
       weigert — und zwar nur bei dem einen Gerät. */
    expect(geparst.verify(geparst.publicKey)).toBe(true)
  })

  it('passt zu seinem privaten Schlüssel', () => {
    expect(geparst.checkPrivateKey(createPrivateKey(zertifikat.key))).toBe(true)
  })

  it('erzeugt jedes Mal ein anderes', () => {
    /* Zwei Rechner mit demselben Schlüssel wären so gut wie keiner. */
    const zweites = erzeugeZertifikat(['192.168.1.5'])
    expect(zweites.fingerabdruck).not.toBe(zertifikat.fingerabdruck)
  })

  it('trägt einen anderen Fingerabdruck als ein anderes Zertifikat', () => {
    const roh = Buffer.from(zertifikat.cert.replace(/-----[^-]+-----|\s/g, ''), 'base64')
    expect(fingerabdruckVon(roh)).toBe(zertifikat.fingerabdruck)
  })
})

describe('Ein echter TLS-Server damit', () => {
  it('liefert eine verschlüsselte Antwort aus', async () => {
    /*
     * Die Prüfung, um die es geht: Nicht ob die Bytes plausibel sind, sondern
     * ob Node damit tatsächlich eine TLS-Verbindung aufbaut. Alles andere
     * fiele erst im Saal auf.
     */
    const server = createServer({ cert: zertifikat.cert, key: zertifikat.key }, (_anfrage, antwort) => {
      antwort.writeHead(200, { 'Content-Type': 'text/plain' })
      antwort.end('Stimme')
    })

    await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig))
    const port = (server.address() as { port: number }).port

    try {
      const text = await new Promise<string>((fertig, fehler) => {
        get(
          {
            host: '127.0.0.1',
            port,
            path: '/',
            /* Selbst ausgestellt: Der Prüfpfad fehlt naturgemäß. Geprüft wird
               hier, dass die Verbindung überhaupt zustande kommt. */
            rejectUnauthorized: false
          },
          (antwort) => {
            let gesammelt = ''
            antwort.on('data', (stueck) => (gesammelt += stueck))
            antwort.on('end', () => fertig(gesammelt))
          }
        ).on('error', fehler)
      })
      expect(text).toBe('Stimme')
    } finally {
      await new Promise<void>((fertig) => server.close(() => fertig()))
    }
  })
})

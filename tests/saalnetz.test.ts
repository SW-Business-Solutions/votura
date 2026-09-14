/**
 * Namensdienst und Adressvergabe im Saalnetz.
 *
 * Beide sprechen Binärformate, und bei Binärformaten ist „sieht plausibel
 * aus" wertlos. Geprüft werden deshalb die Bytes: Was steht im Kopf, welcher
 * Kode kommt zurück, welche Angaben bekommt ein Gerät mit.
 *
 * Der echte Netzbetrieb bleibt außen vor — Port 53 und 67 sind auf einem
 * Entwicklungsrechner belegt oder gesperrt, und ein Test, der davon abhängt,
 * ist ein Test, der irgendwann übersprungen wird.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { antwortAuf, ausDemSaalnetz, nameLesen, nameSchreiben } from '../src/main/dns'
import {
  adresseFuer,
  alsAdresse,
  alsZahl,
  antwortBauen,
  frageLesen,
  type DhcpEinstellung
} from '../src/main/dhcp'

const einstellung = { name: 'saal.mein-verband.de', adresse: '192.168.50.1' }

/** Eine Frage bauen, wie ein Telefon sie stellen würde. */
function frage(name: string, typ = 1, kennung = 0x1234): Buffer {
  const kopf = Buffer.alloc(12)
  kopf.writeUInt16BE(kennung, 0)
  kopf.writeUInt16BE(0x0100, 2) // gewöhnliche Anfrage, Rekursion erwünscht
  kopf.writeUInt16BE(1, 4)
  const schwanz = Buffer.alloc(4)
  schwanz.writeUInt16BE(typ, 0)
  schwanz.writeUInt16BE(1, 2)
  return Buffer.concat([kopf, nameSchreiben(name), schwanz])
}

describe('Der Namensdienst', () => {
  it('liest und schreibt Namen in Silben', () => {
    const geschrieben = nameSchreiben('saal.mein-verband.de')
    expect(nameLesen(geschrieben, 0)?.name).toBe('saal.mein-verband.de')
    /* Ein Längenbyte, das über das Paket hinausreicht, darf nicht in eine
       Endlosschleife oder in fremden Speicher führen. */
    expect(nameLesen(Buffer.from([40, 1, 2, 3]), 0)).toBeNull()
  })

  it('beantwortet den eingestellten Namen mit der eigenen Adresse', () => {
    const antwort = antwortAuf(frage('saal.mein-verband.de'), einstellung)!
    expect(antwort.readUInt16BE(0)).toBe(0x1234)
    /* Antwort, autoritativ, kein Fehler. */
    expect(antwort.readUInt16BE(2) & 0x000f).toBe(0)
    expect(antwort.readUInt16BE(6)).toBe(1)
    expect(antwort.subarray(antwort.length - 4)).toEqual(Buffer.from([192, 168, 50, 1]))
  })

  it('beantwortet ihn auch in anderer Schreibweise', () => {
    /* Namen sind ohne Rücksicht auf Groß- und Kleinschreibung gleich — manche
       Geräte fragen absichtlich gemischt, um Fälschungen zu erschweren. */
    const antwort = antwortAuf(frage('Saal.Mein-Verband.DE'), einstellung)!
    expect(antwort.readUInt16BE(6)).toBe(1)
  })

  it('bietet keine Rekursion an', () => {
    /* Das Bit sagt einem Gerät: „Ich löse nichts für dich auf." Wer es setzt,
       lädt dazu ein, ihn als offenen Resolver zu benutzen. */
    const antwort = antwortAuf(frage('saal.mein-verband.de'), einstellung)!
    expect(antwort.readUInt16BE(2) & 0x0080).toBe(0)
  })

  it('lehnt fremde Namen ab, statt zu raten', () => {
    const antwort = antwortAuf(frage('www.example.org'), einstellung)!
    expect(antwort.readUInt16BE(2) & 0x000f).toBe(5)
    expect(antwort.readUInt16BE(6)).toBe(0)
  })

  it('sagt bei IPv6 „gibt es nicht", statt abzulehnen', () => {
    /*
     * Eine Absage lässt manche Geräte hartnäckig weiterfragen, statt es mit
     * IPv4 zu versuchen — dann steht der Wähler vor einer Seite, die nicht
     * lädt, und niemand sieht, warum.
     */
    const antwort = antwortAuf(frage('saal.mein-verband.de', 28), einstellung)!
    expect(antwort.readUInt16BE(2) & 0x000f).toBe(0)
    expect(antwort.readUInt16BE(6)).toBe(0)
  })

  it('antwortet nicht auf Antworten', () => {
    /* Sonst lässt sich ein Ping-Pong zwischen zwei Diensten auslösen. */
    const gefaelscht = frage('saal.mein-verband.de')
    gefaelscht.writeUInt16BE(0x8180, 2)
    expect(antwortAuf(gefaelscht, einstellung)).toBeNull()
  })

  it('erkennt, was aus dem Saalnetz kommt', () => {
    for (const adresse of ['192.168.2.5', '10.0.0.9', '172.20.1.1', '127.0.0.1']) {
      expect(ausDemSaalnetz(adresse), adresse).toBe(true)
    }
    for (const adresse of ['8.8.8.8', '203.0.113.7', 'quatsch']) {
      expect(ausDemSaalnetz(adresse), adresse).toBe(false)
    }
  })
})

describe('Die Adressvergabe', () => {
  const netz: DhcpEinstellung = {
    von: '192.168.50.100',
    bis: '192.168.50.120',
    maske: '255.255.255.0',
    eigene: '192.168.50.1',
    router: '192.168.50.254',
    laufzeit: 7200
  }

  /** Eine Anfrage, wie ein Telefon sie stellt. */
  function anfrage(art: number, mac: number[]): Buffer {
    const kopf = Buffer.alloc(240)
    kopf[0] = 1
    kopf[1] = 1
    kopf[2] = 6
    kopf.writeUInt32BE(0xabcdef01, 4)
    Buffer.from(mac).copy(kopf, 28)
    Buffer.from([0x63, 0x82, 0x53, 0x63]).copy(kopf, 236)
    return Buffer.concat([kopf, Buffer.from([53, 1, art]), Buffer.from([255])])
  }

  it('rechnet Adressen hin und zurück', () => {
    expect(alsAdresse(alsZahl('192.168.50.120'))).toBe('192.168.50.120')
    expect(alsZahl('255.255.255.255')).toBe(4294967295)
  })

  it('liest die Art der Anfrage und die Hardwareadresse', () => {
    const gelesen = frageLesen(anfrage(1, [0xaa, 0xbb, 0xcc, 0x11, 0x22, 0x33]))!
    expect(gelesen.art).toBe(1)
    expect(gelesen.mac).toBe('aa:bb:cc:11:22:33')
  })

  it('übergeht Fremdes, statt es zu beantworten', () => {
    expect(frageLesen(Buffer.alloc(10))).toBeNull()
    /* Ohne die Kennzeichnung am Anfang ist es kein DHCP-Paket. */
    expect(frageLesen(Buffer.alloc(300))).toBeNull()
  })

  it('gibt demselben Gerät dieselbe Adresse', () => {
    const erst = adresseFuer('aa:bb:cc:00:00:01', netz)
    expect(erst).toBe('192.168.50.100')
    expect(adresseFuer('aa:bb:cc:00:00:01', netz)).toBe(erst)
  })

  it('nennt sich selbst als Namensserver und den Router als Weg nach draußen', () => {
    /*
     * **Der Zweck der ganzen Übung.** Ohne den Namensserver kennt im Saal
     * niemand den Namen, für den das Zertifikat gilt. Ohne den Wegweiser
     * sitzen die Gäste den Abend im Funkloch — und manche Telefone verlassen
     * ein WLAN von selbst, in dem nichts geht.
     */
    const gelesen = frageLesen(anfrage(3, [0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x02]))!
    const antwort = antwortBauen(gelesen, '192.168.50.101', netz, 5)

    expect(antwort[0]).toBe(2)
    expect(antwort.subarray(16, 20)).toEqual(Buffer.from([192, 168, 50, 101]))
    /* Kennung 6: Namensserver — wir selbst. */
    expect(antwort.includes(Buffer.from([6, 4, 192, 168, 50, 1]))).toBe(true)
    /* Kennung 3: Wegweiser nach draußen. */
    expect(antwort.includes(Buffer.from([3, 4, 192, 168, 50, 254]))).toBe(true)
    /* Kennung 1: Netzmaske. */
    expect(antwort.includes(Buffer.from([1, 4, 255, 255, 255, 0]))).toBe(true)
  })

  it('lässt den Wegweiser weg, wenn keiner eingestellt ist', () => {
    const ohne = { ...netz, router: undefined }
    const gelesen = frageLesen(anfrage(3, [0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x03]))!
    const antwort = antwortBauen(gelesen, '192.168.50.102', ohne, 5)
    expect(antwort.includes(Buffer.from([3, 4]))).toBe(false)
    /* Der Namensserver bleibt trotzdem — der Name im Saal gilt auch ohne
       Internet. */
    expect(antwort.includes(Buffer.from([6, 4, 192, 168, 50, 1]))).toBe(true)
  })

  it('vergibt weder die eigene noch die Adresse des Routers', () => {
    const eng: DhcpEinstellung = { ...netz, von: '192.168.50.1', bis: '192.168.50.3', router: '192.168.50.2' }
    expect(adresseFuer('ff:ff:ff:00:00:01', eng)).toBe('192.168.50.3')
  })
})

describe('Die Netzdienste beim Start', () => {
  const start = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8')

  it('werden wiederhergestellt, nicht nur eingeschaltet', () => {
    /*
     * **Der Fehler, den das verhindert.** Sie liefen nur, solange niemand den
     * Rechner neu startete — also genau bis zum Morgen der Versammlung. Die
     * Einstellung sagte „an", der Namensdienst schwieg, und im Saal löste
     * niemand mehr den Namen auf, für den das Zertifikat gilt.
     */
    expect(start).toContain('starteDns(')
    expect(start).toContain('starteDhcp(')
    expect(start).toContain('getSaalnetz()')
  })

  it('reißen einander nicht mit', () => {
    /* Die Adressvergabe braucht Rechte, die der Namensdienst nicht braucht.
       Wegen des einen auf den anderen zu verzichten wäre falsch. */
    const abschnitt = start.slice(start.indexOf('const saalnetz = getSaalnetz()'))
    expect((abschnitt.match(/try \{/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('werden beim Beenden abgeräumt', () => {
    expect(start).toContain('stoppeDns()')
    expect(start).toContain('stoppeDhcp()')
  })
})

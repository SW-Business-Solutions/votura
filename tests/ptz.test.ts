/**
 * Kamerasteuerung (VISCA over IP).
 *
 * Die Befehle sind hier **gerechnete Bytes**, keine verschickten. Genau
 * deshalb lässt sich prüfen, ob `81 01 04 3F 02 03 FF` herauskommt, ohne eine
 * Kamera im Raum zu haben — und ein Fehler fällt auf, bevor er im Saal
 * auffällt.
 *
 * Die Byte-Folgen stammen aus der VISCA-Festlegung, nicht aus dem Quelltext:
 * Ein Test, der nur nachschreibt, was die Funktion tut, prüft nichts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PTZ_ERKENNUNG,
  PTZ_PROFILE,
  istViscaAntwort,
  pantiltAusAntwort,
  ptzAntwort,
  ptzPaket,
  ptzProfil,
  rahmeFolgeZuruecksetzen,
  rahmeGekapselt,
  viscaAutofokus,
  viscaFragePosition,
  viscaFrageZoom,
  viscaHeim,
  viscaPositionAbsolut,
  viscaPresetAbrufen,
  viscaPresetSpeichern,
  viscaSchwenkStopp,
  viscaSchwenken,
  viscaZoom,
  viscaZoomAbsolut,
  zoomAusAntwort
} from '../src/shared/ptz'

/** Bytes lesbar machen — Testausgaben in Hex sind sonst nicht zu deuten. */
const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')

describe('VISCA-Befehle', () => {
  it('ruft eine Position ab', () => {
    expect(hex(viscaPresetAbrufen(3))).toBe('81 01 04 3f 02 03 ff')
  })

  it('speichert eine Position', () => {
    expect(hex(viscaPresetSpeichern(0))).toBe('81 01 04 3f 01 00 ff')
  })

  it('trägt die Geräteadresse im ersten Byte', () => {
    /* Am seriellen Bus hingen mehrere Kameras an einem Kabel; über das Netz
       ist es fast immer die 1. „Fast immer" ist der Grund, warum es einstellbar
       bleibt. */
    expect(viscaPresetAbrufen(1, 1)[0]).toBe(0x81)
    expect(viscaPresetAbrufen(1, 2)[0]).toBe(0x82)
    expect(viscaPresetAbrufen(1, 7)[0]).toBe(0x87)
  })

  it('hält die Gerätenummer in ihren Grenzen', () => {
    /* Eine 0 oder eine 9 ergäbe ein Byte, das etwas anderes bedeutet —
       lieber ein Befehl an Gerät 1 als einer an ein Phantom. */
    expect(viscaPresetAbrufen(1, 0)[0]).toBe(0x81)
    expect(viscaPresetAbrufen(1, 99)[0]).toBe(0x87)
  })

  it('schwenkt in die vier Richtungen', () => {
    /* 1 = links bzw. oben, 2 = rechts bzw. unten, 3 = halt. */
    expect(hex(viscaSchwenken(-1, 0, 8, 6))).toBe('81 01 06 01 08 06 01 03 ff')
    expect(hex(viscaSchwenken(1, 0, 8, 6))).toBe('81 01 06 01 08 06 02 03 ff')
    expect(hex(viscaSchwenken(0, -1, 8, 6))).toBe('81 01 06 01 08 06 03 01 ff')
    expect(hex(viscaSchwenken(0, 1, 8, 6))).toBe('81 01 06 01 08 06 03 02 ff')
  })

  it('hält an', () => {
    expect(hex(viscaSchwenkStopp())).toBe('81 01 06 01 01 01 03 03 ff')
  })

  it('begrenzt die Geschwindigkeit auf das, was VISCA kennt', () => {
    /* Schwenken geht bis 0x18, Neigen bis 0x14. Darüber steht im Byte etwas,
       das die Kamera anders versteht — oder gar nicht. */
    const schnell = viscaSchwenken(1, 1, 99, 99)
    expect(schnell[4]).toBe(0x18)
    expect(schnell[5]).toBe(0x14)
    const langsam = viscaSchwenken(1, 1, 0, 0)
    expect(langsam[4]).toBe(0x01)
    expect(langsam[5]).toBe(0x01)
  })

  it('zoomt hinein, heraus und hält an', () => {
    expect(hex(viscaZoom(1, 5))).toBe('81 01 04 07 25 ff')
    expect(hex(viscaZoom(-1, 5))).toBe('81 01 04 07 35 ff')
    expect(hex(viscaZoom(0, 5))).toBe('81 01 04 07 00 ff')
  })

  it('kennt Heimfahrt und Scharfstellen', () => {
    expect(hex(viscaHeim())).toBe('81 01 06 04 ff')
    expect(hex(viscaAutofokus())).toBe('81 01 04 18 01 ff')
  })

  it('stellt eine Frage, die nichts verändert', () => {
    /* Zum Erkennen einer Kamera darf nichts verstellt werden — sonst steht
       sie nach dem Einrichten woanders als vorher. */
    expect(hex(viscaFrageZoom())).toBe('81 09 04 47 ff')
  })

  it('endet jeder Befehl auf FF', () => {
    const alle = [
      viscaPresetAbrufen(1),
      viscaPresetSpeichern(1),
      viscaSchwenken(1, 1, 5, 5),
      viscaSchwenkStopp(),
      viscaZoom(1, 3),
      viscaHeim(),
      viscaAutofokus(),
      viscaFrageZoom()
    ]
    for (const befehl of alle) expect(befehl[befehl.length - 1]).toBe(0xff)
  })
})

describe('Stellungen statt Speicherplätze', () => {
  /*
   * Der Ausweg für Kameras ohne eigenen Positionsspeicher: Votura fragt die
   * Kamera nach ihren Zahlen, merkt sie sich und schickt sie ihr zurück.
   *
   * VISCA überträgt 16-Bit-Werte als vier Bytes mit je vier Bit. Wer das
   * übersieht, schickt ein Paket, das die Kamera mitten im Wort für beendet
   * hält — deshalb stehen die Halbbytes hier ausdrücklich im Test.
   */
  it('zerlegt die Stellung in Halbbytes', () => {
    expect(hex(viscaPositionAbsolut({ pan: 0x0123, tilt: 0x0456 }, 8, 6))).toBe(
      '81 01 06 02 08 06 00 01 02 03 00 04 05 06 ff'
    )
  })

  it('schickt auch negative Werte richtig', () => {
    /* Nach links ist ein Schwenk unter null; als Zweierkomplement wird daraus
       0xFFFF für −1. */
    const befehl = viscaPositionAbsolut({ pan: -1, tilt: 0 }, 8, 6)
    expect(hex(befehl.subarray(6, 10))).toBe('0f 0f 0f 0f')
    expect(hex(befehl.subarray(10, 14))).toBe('00 00 00 00')
  })

  it('setzt den Zoom auf einen genauen Wert', () => {
    expect(hex(viscaZoomAbsolut(0x4000))).toBe('81 01 04 47 04 00 00 00 ff')
  })

  it('fragt nach Schwenk und Neigung', () => {
    expect(hex(viscaFragePosition())).toBe('81 09 06 12 ff')
  })

  it('liest die Stellung aus der Antwort', () => {
    /* `90 50 0p 0p 0p 0p 0t 0t 0t 0t FF` */
    const antwort = new Uint8Array([
      0x90, 0x50, 0x00, 0x01, 0x02, 0x03, 0x00, 0x04, 0x05, 0x06, 0xff
    ])
    expect(pantiltAusAntwort(antwort)).toEqual({ pan: 0x0123, tilt: 0x0456 })
  })

  it('liest auch eine Stellung links der Mitte', () => {
    const antwort = new Uint8Array([
      0x90, 0x50, 0x0f, 0x0f, 0x0f, 0x0f, 0x00, 0x00, 0x00, 0x00, 0xff
    ])
    expect(pantiltAusAntwort(antwort)).toEqual({ pan: -1, tilt: 0 })
  })

  it('liest den Zoomstand', () => {
    expect(zoomAusAntwort(new Uint8Array([0x90, 0x50, 0x04, 0x00, 0x00, 0x00, 0xff]))).toBe(0x4000)
  })

  it('r\u00e4t nicht, wenn die Antwort nicht passt', () => {
    /*
     * Eine erfundene Stellung f\u00fchrte die Kamera sp\u00e4ter zuverl\u00e4ssig an den
     * falschen Ort — und zwar mitten in der Versammlung. Lieber nichts.
     */
    expect(pantiltAusAntwort(new Uint8Array([0x90, 0x41, 0xff]))).toBeUndefined()
    expect(pantiltAusAntwort(new Uint8Array([0x90, 0x50, 0x00, 0x01, 0xff]))).toBeUndefined()
    expect(pantiltAusAntwort(new Uint8Array([]))).toBeUndefined()
    expect(zoomAusAntwort(new Uint8Array([0x48, 0x54, 0x54, 0x50]))).toBeUndefined()
  })

  it('nennt die F\u00e4higkeit in jedem Profil', () => {
    for (const profil of PTZ_PROFILE) expect(typeof profil.kann.absolut).toBe('boolean')
  })
})

describe('Sonys Umschlag', () => {
  it('legt Art, Länge und Laufnummer davor', () => {
    /*
     * Beispiel aus der Festlegung: eine Frage mit Laufnummer 0 um den
     * Fünf-Byte-Befehl `81 09 04 00 FF`.
     */
    const nutzlast = new Uint8Array([0x81, 0x09, 0x04, 0x00, 0xff])
    expect(hex(rahmeGekapselt(nutzlast, 0, 'frage'))).toBe(
      '01 10 00 05 00 00 00 00 81 09 04 00 ff'
    )
  })

  it('zählt die Laufnummer mit dem höchsten Byte zuerst', () => {
    const paket = rahmeGekapselt(new Uint8Array([0xff]), 0x01020304)
    expect(hex(paket.subarray(4, 8))).toBe('01 02 03 04')
  })

  it('unterscheidet Befehl, Frage und Steuerung', () => {
    const nutzlast = new Uint8Array([0xff])
    expect(hex(rahmeGekapselt(nutzlast, 0, 'befehl').subarray(0, 2))).toBe('01 00')
    expect(hex(rahmeGekapselt(nutzlast, 0, 'frage').subarray(0, 2))).toBe('01 10')
    expect(hex(rahmeGekapselt(nutzlast, 0, 'steuerung').subarray(0, 2))).toBe('02 00')
  })

  it('setzt die Laufnummer zurück', () => {
    /*
     * Ohne diese Nachricht schweigt eine Kamera nach einem Neustart von
     * Votura: Sie hält die wieder bei null beginnenden Pakete für alte.
     */
    expect(hex(rahmeFolgeZuruecksetzen())).toBe('02 00 00 01 00 00 00 00 01')
  })
})

describe('Rahmung je Profil', () => {
  const roh = { rahmung: 'roh' } as const
  const gekapselt = { rahmung: 'gekapselt' } as const

  it('lässt rohe Pakete unangetastet', () => {
    const befehl = viscaPresetAbrufen(2)
    expect(hex(ptzPaket(roh, befehl, 7))).toBe(hex(befehl))
  })

  it('verpackt gekapselte Pakete', () => {
    const befehl = viscaPresetAbrufen(2)
    expect(ptzPaket(gekapselt, befehl, 7).length).toBe(befehl.length + 8)
  })

  it('schält die Antwort wieder aus', () => {
    const antwort = new Uint8Array([0x90, 0x41, 0xff])
    expect(hex(ptzAntwort(roh, antwort))).toBe('90 41 ff')
    expect(hex(ptzAntwort(gekapselt, rahmeGekapselt(antwort, 3)))).toBe('90 41 ff')
  })

  it('verschluckt sich nicht an einem zu kurzen Paket', () => {
    expect(ptzAntwort(gekapselt, new Uint8Array([0x01, 0x11])).length).toBe(0)
  })
})

describe('Antworten erkennen', () => {
  it('nimmt an, was von einer Kamera kommt', () => {
    expect(istViscaAntwort(new Uint8Array([0x90, 0x41, 0xff]))).toBe(true)
    expect(istViscaAntwort(new Uint8Array([0x90, 0x50, 0x00, 0x00, 0x00, 0x00, 0xff]))).toBe(true)
  })

  it('weist zurück, was keine ist', () => {
    /* Irgendein Dienst, der auf demselben Port zufällig etwas zurücksendet,
       darf nicht als Kamera durchgehen. */
    expect(istViscaAntwort(new Uint8Array([0x48, 0x54, 0x54, 0x50]))).toBe(false)
    expect(istViscaAntwort(new Uint8Array([0x90, 0x41]))).toBe(false)
    expect(istViscaAntwort(new Uint8Array([]))).toBe(false)
  })
})

describe('Die Tabelle der Kameras', () => {
  it('hält drei Spielarten bereit, bevor eine Marke genannt wird', () => {
    /*
     * Der Kern der Sache: Die ersten Einträge sind **keine Marken**, sondern
     * die Formen, in denen VISCA vorkommt. Damit läuft auch eine Kamera, die
     * hier gar nicht steht — und das ist der Regelfall.
     */
    for (const kennung of ['visca-roh-udp', 'visca-roh-tcp', 'visca-gekapselt']) {
      expect(ptzProfil(kennung)?.hersteller).toBe('Allgemein')
    }
  })

  it('vergibt jede Kennung nur einmal', () => {
    const kennungen = PTZ_PROFILE.map((profil) => profil.kennung)
    expect(new Set(kennungen).size).toBe(kennungen.length)
  })

  it('nennt zu jedem Profil Transport, Rahmung und Port', () => {
    for (const profil of PTZ_PROFILE) {
      expect(['udp', 'tcp']).toContain(profil.transport)
      expect(['roh', 'gekapselt']).toContain(profil.rahmung)
      expect(profil.port).toBeGreaterThan(0)
      expect(profil.port).toBeLessThan(65_536)
    }
  })

  it('schreibt die Eigenheiten eines Modells in Worte statt in Code', () => {
    /*
     * Die OBSBOT Tail Air weicht messbar ab. Stünde das als Verzweigung im
     * Quelltext, wüsste es niemand, der sich wundert; hier steht es dort, wo
     * die Bedienung es anzeigen kann.
     */
    const obsbot = ptzProfil('obsbot-tail')
    expect(obsbot?.hersteller).toBe('OBSBOT')
    expect(obsbot?.eigenheiten?.length).toBeGreaterThan(0)
    expect(obsbot?.eigenheiten?.join(' ')).toContain('Neigen')
  })

  it('klopft eine unbekannte Kamera in allen drei Formen ab', () => {
    /* Der Port verrät die Spielart nicht — PTZOptics spricht rohes VISCA auf
       demselben Port, auf dem Sony gekapseltes spricht. */
    expect(PTZ_ERKENNUNG.length).toBe(3)
    for (const kennung of PTZ_ERKENNUNG) expect(ptzProfil(kennung)).toBeDefined()
  })
})

const wurzel = join(__dirname, '..')
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), 'utf8')

describe('Eine Stelle für alle Hersteller', () => {
  it('kennt Rahmung und Transport nur an einer einzigen Stelle', () => {
    /*
     * Der Kern der Forderung: Wenn ein neues Modell eine andere Verpackung
     * braucht, darf genau **eine** Funktion davon wissen. Stünde die
     * Entscheidung mehrfach im Code, wäre jeder neue Hersteller ein Risiko
     * für alle bestehenden.
     */
    const kern = lies('src/shared/ptz.ts')
    /* Verpacken und Auspacken — mehr Stellen darf es nicht geben. */
    expect(kern).toContain('export function ptzPaket')
    expect(kern).toContain('export function ptzAntwort')

    /*
     * Und der Weg zur Kamera entscheidet nichts davon mit. Er fragt genau
     * einmal, ob eine Laufnummer zurückzusetzen ist, und reicht sonst durch.
     */
    const dienst = lies('src/main/services/ptz.ts')
    const entscheidungen = dienst
      .split('\n')
      .filter((zeile) => zeile.includes("rahmung === 'gekapselt'"))
    expect(entscheidungen.length).toBe(1)
  })

  it('lässt den Weg zur Kamera nichts über Befehle wissen', () => {
    /* Der Dienst schickt Bytes; welche, rechnet der gemeinsame Teil. Stünden
       hier Byte-Folgen, gäbe es zwei Wahrheiten. */
    const dienst = lies('src/main/services/ptz.ts')
    expect(dienst).not.toMatch(/0x3f|0x06, 0x01/)
  })

  it('prüft ein Kameraprofil beim Speichern, nicht erst im Saal', () => {
    const einstellungen = lies('src/main/services/settings.ts')
    expect(einstellungen).toContain('ptzKameras')
    expect(einstellungen).toContain('kein bekanntes Kameraprofil hinterlegt')
  })

  it('lässt die Kameras dem Aufruf folgen, auch wenn das Pult es nicht tut', () => {
    /*
     * Beide hängen am selben Ereignis und sind doch zweierlei. Stünde der
     * Aufruf hinter der Pult-Abfrage, bliebe die Kamera stehen, sobald jemand
     * den Prompter von Hand bedient.
     */
    const prompter = lies('src/main/services/prompter.ts')
    const aufruf = prompter.indexOf('void ptzBeiAufruf()')
    const pult = prompter.indexOf('if (!state.folgtDemAufruf) return')
    expect(aufruf).toBeGreaterThan(0)
    expect(aufruf).toBeLessThan(pult)
  })

  it('hält eine stumme Kamera nicht für eine Störung', () => {
    /*
     * Manche Kameras bestätigen Befehle, manche nicht, und die OBSBOT
     * antwortet, bevor sie sich bewegt hat. Wer aus fehlender Antwort einen
     * Fehler machte, meldete Störungen, wo keine sind.
     */
    const dienst = lies('src/main/services/ptz.ts')
    expect(dienst).toContain('Ohne Antwort ist es kein Fehler')
  })

  it('lässt einen Redneraufruf nie auf ein Gerät warten', () => {
    const prompter = lies('src/main/services/prompter.ts')
    /* Kein `await`: Eine Kamera am anderen Ende des Saals darf den Aufruf
       nicht aufhalten. */
    expect(prompter).toContain('void ptzBeiAufruf()')
    expect(prompter).not.toContain('await ptzBeiAufruf()')
  })
})

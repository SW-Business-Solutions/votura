/**
 * Die Ausführungsrechte in den Linux-Archiven.
 *
 * Hergestellt wird unter Windows, und NTFS kennt kein Ausführungsrecht. Ohne
 * Nachbehandlung trägt die Programmdatei im fertigen `tar.gz` `rw-r--r--` —
 * das Archiv ist dann unter Linux unbrauchbar, und am Raspberry Pi bricht die
 * Einrichtung mit „Im Archiv fehlt die Programmdatei" ab. Genau so ist es
 * einmal passiert.
 *
 * Geprüft wird an einem selbstgebauten Archiv statt an Textstellen: Bei einem
 * Byteformat sagt nur der Durchlauf, ob es stimmt.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { richteRechte } from '../tools/linux-rechte.mjs'

const BLOCK = 512
const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')

type Eintrag = { name: string; inhalt: Buffer; art?: string; recht?: number }

/** Baut ein tar aus Einträgen — mit den falschen Rechten, wie Windows es täte. */
function baueTar(eintraege: Eintrag[]): Buffer {
  const bloecke: Buffer[] = []
  for (const eintrag of eintraege) {
    const kopf = Buffer.alloc(BLOCK)
    kopf.write(eintrag.name, 0, 100, 'binary')
    kopf.write((eintrag.recht ?? 0o644).toString(8).padStart(7, '0') + '\0', 100, 8, 'binary')
    kopf.write('0000000\0', 108, 8, 'binary')
    kopf.write('0000000\0', 116, 8, 'binary')
    kopf.write(eintrag.inhalt.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'binary')
    kopf.write('00000000000\0', 136, 12, 'binary')
    kopf.write('        ', 148, 8, 'binary')
    kopf.write(eintrag.art ?? '0', 156, 1, 'binary')
    kopf.write('ustar\0' + '00', 257, 8, 'binary')
    let summe = 0
    for (const byte of kopf) summe += byte
    kopf.write(summe.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'binary')

    bloecke.push(kopf)
    const rumpf = Buffer.alloc(Math.ceil(eintrag.inhalt.length / BLOCK) * BLOCK)
    eintrag.inhalt.copy(rumpf)
    if (rumpf.length > 0) bloecke.push(rumpf)
  }
  bloecke.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(bloecke)
}

/** Liest Name, Rechte und Prüfsummenstand aller Einträge wieder aus. */
function lieseTar(tar: Buffer): { name: string; recht: number; stimmt: boolean }[] {
  const gefunden: { name: string; recht: number; stimmt: boolean }[] = []
  let stelle = 0
  while (stelle + BLOCK <= tar.length) {
    const kopf = tar.subarray(stelle, stelle + BLOCK)
    if (kopf.every((byte) => byte === 0)) break
    const name = kopf.subarray(0, 100).toString('binary').replace(/\0.*$/, '')
    const recht = parseInt(kopf.subarray(100, 108).toString('binary').replace(/[\0 ]/g, ''), 8)
    const groesse = parseInt(kopf.subarray(124, 136).toString('binary').replace(/[\0 ]/g, ''), 8) || 0
    const notiert = parseInt(kopf.subarray(148, 156).toString('binary').replace(/[\0 ]/g, ''), 8)
    let summe = 0
    for (let i = 0; i < BLOCK; i++) summe += i >= 148 && i < 156 ? 0x20 : kopf[i]
    gefunden.push({ name, recht, stimmt: summe === notiert })
    stelle += BLOCK + Math.ceil(groesse / BLOCK) * BLOCK
  }
  return gefunden
}

const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)])
const DATEN = Buffer.from('nur Daten, kein Programm')

describe('Rechte im Linux-Archiv', () => {
  const tar = baueTar([
    { name: 'Votura-Saal-1.2.0-linux-arm64/', inhalt: Buffer.alloc(0), art: '5' },
    { name: 'Votura-Saal-1.2.0-linux-arm64/votura-saal', inhalt: ELF },
    { name: 'Votura-Saal-1.2.0-linux-arm64/libffmpeg.so', inhalt: ELF },
    { name: 'Votura-Saal-1.2.0-linux-arm64/chrome-sandbox', inhalt: ELF },
    { name: 'Votura-Saal-1.2.0-linux-arm64/resources.pak', inhalt: DATEN },
    { name: 'Votura-Saal-1.2.0-linux-arm64/resources/app.asar', inhalt: DATEN }
  ])
  const { daten, geaendert } = richteRechte(tar)
  const nachher = new Map(lieseTar(daten).map((eintrag) => [eintrag.name, eintrag]))
  const recht = (name: string): number | undefined =>
    nachher.get(`Votura-Saal-1.2.0-linux-arm64/${name}`)?.recht

  it('macht die Programmdatei ausführbar', () => {
    /* Der Fehler, der den Bau des Pi-Abbilds abbrechen ließ. */
    expect(recht('votura-saal')).toBe(0o755)
  })

  it('macht die Bibliotheken ausführbar', () => {
    expect(recht('libffmpeg.so')).toBe(0o755)
  })

  it('gibt chrome-sandbox das setuid-Bit', () => {
    /* Ohne den Helfer startet Chromium auf Ubuntu 24.04 nicht. */
    expect(recht('chrome-sandbox')).toBe(0o4755)
  })

  it('lässt Daten lesbar, aber nicht ausführbar', () => {
    /* Erkannt an der fehlenden ELF-Kennung, nicht an einer Namensliste. */
    expect(recht('resources.pak')).toBe(0o644)
    expect(recht('resources/app.asar')).toBe(0o644)
  })

  it('macht Ordner betretbar', () => {
    expect(recht('')).toBe(0o755)
  })

  it('rechnet die Kopfprüfsumme neu', () => {
    /* Ohne das hielte tar jeden geänderten Eintrag für beschädigt. */
    expect([...nachher.values()].every((eintrag) => eintrag.stimmt)).toBe(true)
  })

  it('lässt die Länge und den Inhalt unangetastet', () => {
    /* Es wird nur das Rechtefeld überschrieben — nichts umgepackt. */
    expect(daten.length).toBe(tar.length)
    expect(daten.subarray(BLOCK * 2, BLOCK * 3)).toEqual(tar.subarray(BLOCK * 2, BLOCK * 3))
  })

  it('meldet, was es angefasst hat', () => {
    expect(geaendert.map((eintrag) => eintrag.name)).toContain('Votura-Saal-1.2.0-linux-arm64/votura-saal')
    /* Was schon richtig war, taucht nicht auf. */
    expect(geaendert.map((eintrag) => eintrag.name)).not.toContain(
      'Votura-Saal-1.2.0-linux-arm64/resources.pak'
    )
  })
})

describe('Die Nachbehandlung gehört in den Herstellungslauf', () => {
  it('läuft bei jedem Linux-Paket mit', () => {
    /* Sonst wäre die nächste Veröffentlichung wieder unbrauchbar, und
       auffallen würde es erst an einem Pi hinter dem Beamer. */
    const skripte = JSON.parse(lies('package.json')).scripts as Record<string, string>
    for (const name of ['dist:linux', 'dist:alle']) {
      expect(skripte[name]).toContain('tools/linux-rechte.mjs')
    }
  })

  it('läuft vor den Prüfsummen', () => {
    /* Andersherum stünden in pruefsummen.txt die Summen der alten Archive. */
    const lauf = (JSON.parse(lies('package.json')).scripts as Record<string, string>)['dist:linux']
    expect(lauf.indexOf('linux-rechte')).toBeLessThan(lauf.indexOf('pruefsummen'))
  })
})

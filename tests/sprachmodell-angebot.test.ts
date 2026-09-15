/**
 * Die Liste der nachladbaren Sprachmodelle.
 *
 * Geprüft wird hier nicht, ob ein Modell gut erkennt — das entscheidet das
 * Modell. Geprüft wird das, was schiefgehen kann, ohne dass es jemand merkt:
 * eine Adresse, die woandershin zeigt, eine Prüfsumme, die keine ist, und ein
 * Ladeweg, der mehr holen kann als das, was auf der Liste steht.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BEKANNTE_MODELLE,
  MODELL_QUELLE,
  modellAdresse
} from '../src/shared/sprachmodell-angebot'

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')

describe('Die Angaben in der Liste', () => {
  it('nennt jedes Modell genau einmal', () => {
    const dateien = BEKANNTE_MODELLE.map((m) => m.datei)
    expect(new Set(dateien).size).toBe(dateien.length)
  })

  it('nennt eine Größe, die keine Schätzung ist', () => {
    /*
     * Runde Zahlen wären ein Zeichen dafür, dass jemand „ungefähr 45 MB"
     * eingetragen hat. Die Größe ist aber das Einzige, was beim großen Modell
     * überhaupt geprüft wird — sie muss auf das Byte stimmen.
     */
    for (const angebot of BEKANNTE_MODELLE) {
      expect(angebot.bytes, angebot.datei).toBeGreaterThan(1_000_000)
      expect(angebot.bytes % 1_000_000, angebot.datei).not.toBe(0)
    }
  })

  it('hat entweder eine echte Prüfsumme oder gar keine', () => {
    /*
     * **Der Grund für diesen Test.** Eine erfundene Prüfsumme ist schlimmer
     * als keine: Sie behauptet eine Sicherheit, die es nicht gibt, und
     * niemand sieht ihr an, dass sie ausgedacht ist. Wo eine steht, muss sie
     * die Form haben, die aus `createHash('sha256')` fällt.
     */
    for (const angebot of BEKANNTE_MODELLE) {
      if (angebot.sha256 === undefined) continue
      expect(angebot.sha256, angebot.datei).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('stimmt beim mitgelieferten Modell mit dem Bauwerkzeug überein', () => {
    /*
     * `tools/sprachmodell.mjs` holt dasselbe Archiv beim Bauen und hat seine
     * eigene Prüfsumme. Zwei Angaben über dieselbe Datei an zwei Stellen sind
     * eine zu viel — solange sie nicht bewacht werden.
     */
    const werkzeug = lies('tools/sprachmodell.mjs')
    const klein = BEKANNTE_MODELLE.find((m) => m.datei === 'vosk-model-small-de-0.15.zip')
    expect(klein).toBeDefined()
    expect(werkzeug).toContain(String(klein!.bytes).replace(/\B(?=(\d{3})+(?!\d))/g, '_'))
    expect(werkzeug).toContain(klein!.sha256!)
  })
})

describe('Woher geladen wird', () => {
  it('holt alles von einer Stelle, und die ist verschlüsselt', () => {
    expect(MODELL_QUELLE.startsWith('https://')).toBe(true)
    for (const angebot of BEKANNTE_MODELLE) {
      expect(modellAdresse(angebot)).toBe(`${MODELL_QUELLE}${angebot.datei}`)
    }
  })

  it('baut die Adresse aus dem Dateinamen, statt eine entgegenzunehmen', () => {
    /*
     * **Die eigentliche Absicherung.** Nähme der Ladeweg eine Adresse
     * entgegen, wäre er eine offene Tür: Wer ihn aufrufen kann, ließe Votura
     * beliebige Dateien holen. Er nimmt deshalb nur einen Dateinamen und
     * schlägt ihn in der Liste nach; steht er nicht darin, geschieht nichts.
     */
    const dienst = lies('src/main/services/sprachmodell.ts')
    expect(dienst).toContain('BEKANNTE_MODELLE.find((eintrag) => eintrag.datei === datei)')
    expect(dienst).toContain('Unbekanntes Sprachmodell')
    expect(dienst).toContain('modellAdresse(angebot)')
    /* Kein fetch auf etwas, das von außen kommt. */
    expect(dienst).not.toMatch(/fetch\(\s*(url|adresse|datei)\b/)
  })

  it('lädt nur auf ausdrücklichen Aufruf', () => {
    /*
     * Votura läuft offline. Der einzige Weg nach draußen darf keiner sein,
     * den ein Zeitgeber oder der Programmstart auslöst.
     */
    const dienst = lies('src/main/services/sprachmodell.ts')
    expect(dienst).not.toMatch(/setInterval|setTimeout/)
    const start = lies('src/main/index.ts')
    expect(start).not.toContain('sprachmodellLaden')
  })
})

describe('Was beim Laden schiefgehen kann', () => {
  const dienst = lies('src/main/services/sprachmodell.ts')

  it('prüft Größe und — soweit vorhanden — Prüfsumme', () => {
    expect(dienst).toContain('Unerwartete Größe')
    expect(dienst).toContain('Die Prüfsumme stimmt nicht')
  })

  it('tauscht erst nach der Prüfung', () => {
    /*
     * Geschrieben wird unter einem Arbeitsnamen; erst wenn alles stimmt,
     * tritt das neue Modell an die Stelle des alten. Ein abgebrochener
     * Ladevorgang darf das vorhandene nicht beschädigen — ein halbes Archiv
     * fiele sonst erst am Pult auf.
     */
    expect(dienst).toContain('.teil')
    expect(dienst).toContain('renameSync(arbeitsdatei')
    /* Und im Fehlerfall bleibt nichts liegen. */
    expect(dienst).toMatch(/catch[\s\S]{0,200}rmSync\(arbeitsdatei/)
  })

  it('hält den Vorgang im Prüfpfad fest', () => {
    /* Wer später fragt, woher das Modell kam, findet es im Audit-Trail —
       samt der tatsächlich gerechneten Prüfsumme. */
    expect(dienst).toContain("action: 'speechmodel.installed'")
    expect(dienst).toContain('sha256: gerechnet')
  })

  it('verlangt das Recht, die Anlage zu verwalten', () => {
    const ipc = lies('src/main/ipc.ts')
    expect(ipc).toMatch(/'speechmodel\.download':[\s\S]{0,120}requirePermission\('system\.manage'\)/)
  })
})

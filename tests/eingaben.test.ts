/**
 * Eingabefelder, die keine unmöglichen Werte annehmen.
 *
 * Geprüft wird die Rechnerei dahinter, nicht die Darstellung: ob eine
 * Zeichenkette eine Adresse ist, entscheidet keine Oberfläche, sondern eine
 * Funktion — und die lässt sich ohne Browser prüfen.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { istAdresse } from '../src/shared/netz'

describe('Netzwerkadressen', () => {
  it('nimmt an, was eine Adresse ist', () => {
    for (const wert of ['192.168.50.1', '10.0.0.1', '255.255.255.0', '0.0.0.0']) {
      expect(istAdresse(wert), wert).toBe(true)
    }
  })

  it('weist ab, was keine ist', () => {
    /*
     * Die ersten beiden sind die Tippfehler, die im Saal auffallen — dort,
     * wo niemand mehr sucht: eine Zahl über 255 und eine abgeschnittene
     * Adresse.
     */
    for (const wert of ['192.168.500.1', '192.168.50.', '192.168.50', 'saal', '', '1.2.3.4.5']) {
      expect(istAdresse(wert), wert).toBe(false)
    }
  })
})

describe('Dialoge, die es in Electron gibt', () => {
  /*
   * `window.prompt` gibt es dort nicht: Der Aufruf schreibt „prompt() is not
   * supported" in die Ecke und tut nichts. In der Entwicklungsfassung im
   * Browser fiel das nie auf — im fertigen Programm war Umbenennen in drei
   * Bibliotheken ein toter Knopf.
   */
  it('kommt ohne window.prompt aus', () => {
    const dateien = readdirSync(join(__dirname, '..', 'src', 'renderer'), {
      recursive: true,
      encoding: 'utf8'
    }).filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))

    /* Ein leerer Lauf darf nicht als Beweis durchgehen. */
    expect(dateien.length).toBeGreaterThan(20)

    const fundstellen = dateien.filter((name) =>
      /\bwindow\.prompt\s*\(/.test(readFileSync(join(__dirname, '..', 'src', 'renderer', name), 'utf8'))
    )
    expect(fundstellen).toEqual([])
  })
})

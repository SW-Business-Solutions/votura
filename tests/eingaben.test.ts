/**
 * Eingabefelder, die keine unmöglichen Werte annehmen.
 *
 * Geprüft wird die Rechnerei dahinter, nicht die Darstellung: ob eine
 * Zeichenkette eine Adresse ist, entscheidet keine Oberfläche, sondern eine
 * Funktion — und die lässt sich ohne Browser prüfen.
 */
import { describe, expect, it } from 'vitest'
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

/**
 * Der QR-Scanner — geprüft wird, was ohne Kamera prüfbar ist.
 *
 * Ob Chromium ein Bild entzerrt, entscheidet Chromium. Was hier entschieden
 * wird, ist alles andere: dass der Decoder **nicht** mitgeladen wird, solange
 * niemand scannt, dass die Kamera in jedem Ausgang wieder ausgeht, und dass
 * aus dem Gelesenen der Ausweis wird und nicht irgendein Text.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeAus } from '../src/shared/ausweis-code'

const quelle = readFileSync(join(__dirname, '..', 'src/renderer/src/qr-scanner.tsx'), 'utf8')

describe('Was aus dem QR-Code wird', () => {
  it('nimmt einen nackten Code, wie er ist', () => {
    expect(codeAus('A7F2-9K3M-XQ81-2BVR')).toBe('A7F2-9K3M-XQ81-2BVR')
    expect(codeAus('  a7f2-9k3m  ')).toBe('A7F2-9K3M')
  })

  it('holt den Ausweis aus einer Adresse heraus', () => {
    /* Den ganzen Link ins Feld zu schreiben wäre für jede Prüfung ein
       Unbekannter — gemeint ist der Code dahinter. */
    expect(codeAus('https://192.168.1.5:8477/stimme?t=geheim&c=A7F2-9K3M')).toBe('A7F2-9K3M')
  })

  it('verschluckt nichts, wenn die Adresse keinen Ausweis trägt', () => {
    const roh = 'https://example.org/irgendwas'
    expect(codeAus(roh)).toBe(roh.toUpperCase())
  })
})

describe('Der Scanner selbst', () => {
  it('lädt den Decoder erst beim Scannen', () => {
    /*
     * Er ist die zweite Laufzeitabhängigkeit des Projekts (ADR-0007). Wer nie
     * scannt — Hauptrechner, Beamer, Prompter —, soll ihn nie im Speicher
     * haben. Ein `import` am Dateikopf würde ihn in jedes Bündel ziehen.
     */
    expect(quelle).toContain("await import('jsqr')")
    expect(quelle).not.toMatch(/^import .*from 'jsqr'/m)
  })

  it('nimmt den eingebauten Erkenner, wo es ihn gibt', () => {
    expect(quelle).toContain('BarcodeDetector')
  })

  it('schaltet die Kamera aus, statt sie nur auszublenden', () => {
    /* Ein Licht, das nach dem Schließen weiterleuchtet, wäre in einer
       Wahlkabine unerträglich — und ein Versprechen, das nicht gilt. */
    expect(quelle).toContain('spur.stop()')
    /* In jedem Ausgang: beim Treffer, beim Schließen, beim Verlassen. */
    expect(quelle.match(/beenden\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  it('nimmt nichts auf und schickt nichts', () => {
    expect(quelle).not.toContain('MediaRecorder')
    expect(quelle).not.toContain('fetch(')
    expect(quelle).toContain('audio: false')
  })

  it('erklärt die fehlende Verschlüsselung, statt eine tote Schaltfläche zu zeigen', () => {
    /*
     * Auf gewöhnlichem HTTP sperrt der Browser die Kamera — und meldet das je
     * nach Fassung als „nicht erlaubt". Wer das für eine verweigerte Erlaubnis
     * hält, sucht den Fehler in seinem Telefon und findet dort nichts.
     * Geprüft wird deshalb die **Reihenfolge**: erst die Herkunft, dann die
     * Kamera.
     */
    expect(quelle).toContain('isSecureContext')
    expect(quelle).toContain('unverschlüsselt ausgeliefert')
    expect(quelle.indexOf('isSecureContext')).toBeLessThan(quelle.indexOf('getUserMedia({'))
    /* Und der Knopf erscheint gar nicht erst, wo er nichts ausrichten kann. */
    expect(quelle).toContain('export function kameraVerfuegbar')
  })
})

/**
 * Die Überlagerung für einen Livestream.
 *
 * Geprüft wird nicht, wie sie aussieht — das wurde an der laufenden Anwendung
 * gemessen: Hintergrund `rgba(0, 0, 0, 0)`, Bildpunkt oben links mit Deckkraft
 * null, Bauchbinde und Rednerreihe mit echtem Inhalt, kein Beamerrahmen.
 *
 * Geprüft wird hier, was **still** kaputtgehen kann: ein Hintergrund, der sich
 * zurückschleicht, und eine Seite, die plötzlich mehr zeigt als die drei
 * Einblendungen. Beides fiele erst im Stream auf — also vor Publikum.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')

const seite = lies('src/renderer/src/projection/Ueberlagerung.tsx')
const css = lies('src/renderer/src/styles/projection.css')
const einstieg = lies('src/renderer/src/audience-main.tsx')

describe('Die Überlagerung bleibt durchsichtig', () => {
  it('macht Dokument und Fläche durchsichtig', () => {
    /*
     * Drei Ebenen, und alle drei müssen mit: `html`, `body` und die Fläche
     * selbst. Fehlt eine, liegt im Stream ein schwarzer Kasten über dem
     * Kamerabild — und zwar genau dort, wo das Gesicht ist.
     */
    expect(css).toMatch(/html\.ueberlagerung-seite[\s\S]{0,120}background: transparent/)
    expect(css).toMatch(/\.ueberlagerung \{[^}]*background: transparent/)
  })

  it('setzt die Klasse am Dokument und nimmt sie wieder weg', () => {
    /* Ohne das Aufräumen bliebe die Beameransicht durchsichtig, sobald
       jemand einmal die Überlagerung geöffnet hat. */
    expect(einstieg).toContain("classList.add('ueberlagerung-seite')")
    expect(einstieg).toContain("classList.remove('ueberlagerung-seite')")
  })

  it('lässt Mausklicks durch', () => {
    /* In OBS liegt darunter das Bild; eine Seite, die Klicks schluckt, wäre
       nur im Weg. */
    expect(css).toMatch(/\.ueberlagerung \{[^}]*pointer-events: none/)
  })
})

describe('Die Überlagerung zeigt nur die Einblendungen', () => {
  it('zeichnet Bauchbinde, Rednerreihe und Untertitel — und sonst nichts', () => {
    expect(seite).toContain('<Bauchbinde')
    expect(seite).toContain('<Naechste')
    expect(seite).toContain('<Untertitelband')
    /*
     * Keine vollständige Beameransicht: Der Rahmen mit Verband, Datum und
     * Logo gehört an die Wand, nicht über ein Kamerabild im Stream. Die
     * Bildmischung hat ihre eigene Gestaltung.
     */
    expect(seite).not.toContain('ProjectionScreen')
  })

  it('hält sich an die Schalter der Bedienung', () => {
    /*
     * **Der Punkt, an dem eine Übertragung lügen könnte.** Wer im Saal die
     * Bauchbinde ausschaltet, weil gerade niemand aufgerufen ist, soll sie
     * nicht im Stream stehen haben — sonst behauptet die Übertragung etwas,
     * das der Saal nicht sieht.
     */
    expect(seite).toContain('state.camera?.bauchbinde')
    expect(seite).toContain('state.camera?.naechste')
    expect(seite).toContain('state.untertitel')
  })

  it('wird über dieselbe Leitung versorgt wie die Beameransicht', () => {
    /*
     * Ein zweiter Weg zum Zustand wäre ein zweiter Weg, der irgendwann
     * anders aussieht als der erste. Die Überlagerung ist deshalb eine
     * Spielart derselben Seite — der Unterschied ist ein Zusatz in der
     * Adresse.
     */
    expect(einstieg).toContain("get('ueberlagerung') === '1'")
    expect(einstieg).toContain('<Ueberlagerung state={state} />')
  })
})

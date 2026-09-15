import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/*
 * Die Nutzungsbedingungen sind kein Text, den man „mal aufräumt".
 *
 * Acht ihrer Punkte stehen dort nicht aus eigenem Willen, sondern weil §3d
 * der NDI-SDK-Lizenz sie wörtlich verlangt: Wer die Laufzeit weitergibt, muss
 * das unter Bedingungen tun, die genau diese Punkte enthalten. Fällt einer
 * beim Kürzen heraus, ist die Weitergabe nicht mehr gedeckt — und es fällt
 * niemandem auf, weil nichts kaputtgeht.
 *
 * Deshalb wacht dieser Test darüber. Er prüft Inhalt, nicht Wortlaut: gesucht
 * wird nach dem, was den Punkt ausmacht, damit sich der Satz umformulieren
 * lässt, ohne dass der Test danebengreift.
 */
const lies = (datei: string) => readFileSync(datei, 'utf8')

const bedingungen = lies('NUTZUNGSBEDINGUNGEN.md')

describe('Die Nutzungsbedingungen tragen, was §3d der NDI-Lizenz verlangt', () => {
  const gefordert: [string, RegExp][] = [
    ['i — keine Veränderung des SDK', /nicht\s+verändert\s+werden/i],
    ['ii — kein Zurückentwickeln, auch nicht der Protokolle', /Zurückentwickeln.*Protokoll/is],
    ['iii — keine Umgehung technischer Beschränkungen', /Beschränkungen.*nicht\s+umgangen/is],
    ['iv — Hinweise nicht entfernen', /nicht\s+entfernt,\s+überdeckt\s+oder\s+geändert/i],
    ['v — Gewährleistungsausschluss zugunsten NDI', /NDI.*keinerlei\s+Gewährleistung/is],
    ['vi — Haftungsausschluss zugunsten NDI', /haften\s+NDI\s+und\s+seine\s+Lizenzgeber\s+nicht/i],
    ['vii — US-Ausfuhrrecht', /Ausfuhrbestimmungen\s+der\s+Vereinigten\s+Staaten/i],
    ['viii — Urheberrechtsvermerk NDI', /NDI\s+©\s+Vizrt\s+NDI\s+AB/],
    ['ix — Weiterentwickler binden', /NDI-SDK-Lizenz\s+einzuhalten/i]
  ]

  for (const [punkt, muster] of gefordert) {
    it(`nennt: ${punkt}`, () => {
      expect(bedingungen).toMatch(muster)
    })
  }

  it('nennt die Marke als Marke und bestreitet eine Zusammenarbeit', () => {
    /* §3f: Die Marke darf nur zur Kennzeichnung der Verträglichkeit stehen,
       mit klarer Notation — und nichts darf eine Förderung durch NDI
       nahelegen. */
    expect(bedingungen).toMatch(/NDI® ist eine eingetragene Marke der Vizrt NDI AB/)
    expect(bedingungen).toMatch(/kein\*{0,2}\s*Produkt von NDI/i)
  })
})

describe('Die Bedingungen erreichen den Nutzer', () => {
  it('liegen jedem Paket bei', () => {
    /* Die portable Fassung und die Linux-Archive haben kein
       Installationsprogramm — dort ist die Datei im Ordner der einzige Weg. */
    for (const bau of ['electron-builder.yml', 'electron-builder-saal.yml']) {
      expect(lies(bau)).toContain('from: NUTZUNGSBEDINGUNGEN.md')
    }
  })

  it('werden beim Installieren zur Zustimmung vorgelegt', () => {
    /* §3d verlangt die Weitergabe „under the terms of a license agreement".
       Eine Datei im Programmordner ist keine Vereinbarung; eine Seite, auf
       der jemand zustimmt, ist eine. */
    for (const bau of ['electron-builder.yml', 'electron-builder-saal.yml']) {
      expect(lies(bau)).toMatch(/license: build\/nutzungsbedingungen\.txt/)
    }
  })

  it('entstehen auf jedem Bauweg, der ein Paket erzeugt', () => {
    /* Der Text für das Installationsprogramm wird erzeugt und liegt nicht im
       Repository. Fehlte der Schritt auf einem Weg, bräche dort der Bau —
       lauter als ein stiller Verlust, aber immer noch unnötig. */
    const skripte = JSON.parse(lies('package.json')).scripts as Record<string, string>
    for (const [name, befehl] of Object.entries(skripte)) {
      if (!name.startsWith('dist:') || name === 'dist:dir') continue
      expect(befehl, name).toContain('tools/bedingungen.mjs')
    }
  })
})

/**
 * Mitlaufen nach Gehör.
 *
 * Der Text ist bekannt — gesucht wird nicht, was gesagt wurde, sondern wo im
 * Manuskript es steht. Geprüft wird vor allem, was schiefginge: Sprünge auf
 * Allerweltswörter, Sprünge an den Anfang bei wiederkehrenden Formeln, und
 * Stillstand, wo weitergegangen werden müsste.
 */
import { describe, expect, it } from 'vitest'
import { findeStelle, mitlaufStelle, normalisiere, wortfolge } from '../src/shared/mitlauf'

const REDE = wortfolge(
  `Liebe Mitglieder, ich begrüße euch herzlich zur Mitgliederversammlung.
   Wir blicken auf ein Jahr zurück, in dem viel entschieden wurde.
   Der Kreisverband hat vierundsiebzig neue Mitglieder aufgenommen.
   Die Bürgerdialoge fanden jeden Monat statt, ohne eine einzige Ausnahme.
   Liebe Mitglieder, ich danke euch für die Aufmerksamkeit.`
)

describe('Wörter vergleichbar machen', () => {
  it('löst Umlaute auf und wirft Satzzeichen weg', () => {
    expect(normalisiere('Mitglieder,')).toBe('mitglieder')
    expect(normalisiere('müssen')).toBe('muessen')
    expect(normalisiere('Straße')).toBe('strasse')
    expect(normalisiere('„Bericht"')).toBe('bericht')
  })

  it('behält Zahlen — sie sind oft der markanteste Anker', () => {
    expect(wortfolge('im Jahr 2026 waren es 74')).toEqual(['im', 'jahr', '2026', 'waren', 'es', '74'])
  })
})

describe('Die Stelle im Manuskript finden', () => {
  it('findet eine gesprochene Passage', () => {
    const treffer = findeStelle(REDE, wortfolge('der Kreisverband hat vierundsiebzig neue'), 10)
    expect(treffer).toBeDefined()
    /* Weitergelesen wird hinter dem letzten getroffenen Wort. */
    expect(REDE[treffer!.position]).toBe('mitglieder')
  })

  it('verschluckte Wörter machen nichts aus', () => {
    /* „hat" fehlt — eine Erkennung lässt regelmäßig etwas aus. */
    const treffer = findeStelle(REDE, wortfolge('der Kreisverband vierundsiebzig neue Mitglieder'), 10)
    expect(treffer?.treffer).toBeGreaterThanOrEqual(4)
  })

  it('springt nicht auf ein einzelnes Allerweltswort', () => {
    expect(findeStelle(REDE, ['die'], 5)).toBeUndefined()
    expect(findeStelle(REDE, ['und'], 5)).toBeUndefined()
  })

  it('bleibt bei der wiederkehrenden Formel in der Nähe', () => {
    /*
     * „Liebe Mitglieder, ich" steht zweimal darin. Steht der Prompter hinten,
     * darf die zweite Fundstelle gelten — nicht der Anfang der Rede.
     */
    const stand = REDE.length - 8
    const treffer = findeStelle(REDE, wortfolge('liebe Mitglieder ich danke euch'), stand)
    expect(treffer).toBeDefined()
    expect(treffer!.position).toBeGreaterThan(REDE.length - 8)
  })

  it('schaut weiter nach vorn als zurück', () => {
    /* Ein übersprungener Absatz wird gefunden, ein Rücksprung über die halbe
       Rede nicht — das ist gewollt. */
    const weitVorn = findeStelle(REDE, wortfolge('ich danke euch für die'), 5)
    expect(weitVorn).toBeDefined()
  })

  it('lässt den Stand stehen, wenn nichts überzeugt', () => {
    expect(mitlaufStelle(REDE, wortfolge('völlig anderer satz ohne bezug'), 12)).toBe(12)
  })

  it('kommt mit leeren Eingaben zurecht', () => {
    expect(findeStelle([], ['irgendwas'], 0)).toBeUndefined()
    expect(findeStelle(REDE, [], 0)).toBeUndefined()
  })
})

/**
 * Beameranzeige: Aufteilung langer Listen.
 *
 * Wichtig ist, dass Darstellung und Seitenangabe denselben Zuschnitt verwenden —
 * sonst steht auf dem Beamer „Kandidaten 1–23“, während 30 Namen zu sehen sind.
 */
import { describe, expect, it } from 'vitest'
import {
  paginateCandidates,
  projectionColumns,
  projectionPageCount,
  projectionPageSize,
  projectionResultColumns,
  projectionResultPageCount,
  projectionResultPageSize,
  PROJECTION_RESULT_ROWS_PER_COLUMN,
  type ProjectionCandidate
} from '../src/shared/projection'

function candidates(count: number): ProjectionCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    displayName: `Kandidat ${index + 1}`,
    ballotNumber: index + 1
  }))
}

describe('Aufteilung der Kandidatenliste', () => {
  it('waehlt die Spaltenzahl nach der Menge', () => {
    expect(projectionColumns(8)).toBe(1)
    expect(projectionColumns(20)).toBe(2)
    expect(projectionColumns(46)).toBe(3)
  })

  it('haelt Seitengroesse, Seitenzahl und Anzeige zusammen', () => {
    const anzahl = 46
    // Gleichmäßig verteilt statt 30 + 16.
    expect(projectionPageCount(anzahl)).toBe(2)
    expect(projectionPageSize(anzahl)).toBe(23)

    const ersteSeite = paginateCandidates(candidates(anzahl), 0)
    const zweiteSeite = paginateCandidates(candidates(anzahl), 1)
    expect(ersteSeite).toHaveLength(23)
    expect(zweiteSeite).toHaveLength(23)
    // Keine Lücke und keine Dopplung zwischen den Seiten.
    expect(ersteSeite.at(-1)?.id).toBe('c22')
    expect(zweiteSeite[0]?.id).toBe('c23')
  })

  it('verteilt die Eintraege moeglichst gleichmaessig auf die Seiten', () => {
    for (const anzahl of [31, 46, 61, 90, 121]) {
      const seiten = projectionPageCount(anzahl)
      const groesse = projectionPageSize(anzahl)
      const mengen = Array.from({ length: seiten }, (_, seite) =>
        paginateCandidates(candidates(anzahl), seite).length
      )
      // Alle Seiten bis auf die letzte sind voll; der Unterschied bleibt klein.
      expect(Math.max(...mengen) - Math.min(...mengen)).toBeLessThan(groesse)
      expect(mengen.reduce((summe, wert) => summe + wert, 0)).toBe(anzahl)
    }
  })

  it('kommt bei kurzen Listen mit einer Seite aus', () => {
    expect(projectionPageCount(8)).toBe(1)
    expect(paginateCandidates(candidates(8), 0)).toHaveLength(8)
  })

  it('haelt jede Seite innerhalb der Zeilen je Spalte', () => {
    for (const anzahl of [5, 12, 21, 46, 90]) {
      const spalten = projectionColumns(anzahl)
      const seite = paginateCandidates(candidates(anzahl), 0)
      const zeilen = Math.ceil(seite.length / spalten)
      expect(zeilen).toBeLessThanOrEqual(10)
    }
  })

  it('bleibt bei leeren Listen stabil', () => {
    expect(projectionPageCount(0)).toBe(1)
    expect(paginateCandidates([], 0)).toHaveLength(0)
  })
})

describe('Aufteilung der Ergebnisliste', () => {
  it('waehlt die Spaltenzahl nach der Menge', () => {
    // Name, Stimmenzahl und "GEWÄHLT" brauchen Breite – deshalb wird später
    // dreispaltig gesetzt als bei der reinen Kandidatenliste.
    expect(projectionResultColumns(6)).toBe(1)
    expect(projectionResultColumns(20)).toBe(2)
    expect(projectionResultColumns(58)).toBe(3)
  })

  it('blaettert lange Ergebnisse und verteilt sie gleichmaessig', () => {
    const anzahl = 58
    expect(projectionResultPageCount(anzahl)).toBe(4)
    expect(projectionResultPageSize(anzahl)).toBe(15)

    const groesse = projectionResultPageSize(anzahl)
    const mengen = Array.from({ length: projectionResultPageCount(anzahl) }, (_, seite) =>
      paginateCandidates(candidates(anzahl), seite, groesse).length
    )
    expect(mengen.reduce((summe, wert) => summe + wert, 0)).toBe(anzahl)
    expect(Math.max(...mengen) - Math.min(...mengen)).toBeLessThan(groesse)
  })

  it('haelt jede Ergebnisseite innerhalb der Zeilen je Spalte', () => {
    for (const anzahl of [4, 12, 30, 58, 121]) {
      const spalten = projectionResultColumns(anzahl)
      const seite = paginateCandidates(candidates(anzahl), 0, projectionResultPageSize(anzahl))
      expect(Math.ceil(seite.length / spalten)).toBeLessThanOrEqual(PROJECTION_RESULT_ROWS_PER_COLUMN)
    }
  })

  it('kommt bei kurzen Ergebnissen ohne Blaettern aus', () => {
    expect(projectionResultPageCount(6)).toBe(1)
    expect(projectionResultPageCount(0)).toBe(1)
  })
})

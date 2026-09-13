/**
 * Teleprompter: Zerlegung des Textes und der Lauf über die Uhr.
 *
 * Beides steckt in reinen Funktionen — so lässt sich prüfen, was ein Gerät am
 * Pult täte, ohne einen Browser zu starten, und alle Geräte rechnen
 * nachweislich gleich.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  prompterPosition,
  PROMPTER_PFAD,
  PROMPTER_VORGABE,
  redeBloecke,
  redeDauer,
  redeWoerter,
  WOERTER_JE_MINUTE,
  type PrompterViewState
} from '../src/shared/speech'

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')
const JETZT = 1_800_000_000_000

function zustand(overrides: Partial<PrompterViewState> = {}): PrompterViewState {
  return {
    ...PROMPTER_VORGABE,
    position: 10,
    anchoredAt: new Date(JETZT).toISOString(),
    tempo: 120,
    ...overrides
  }
}

describe('Der Lauf hängt an der Uhr', () => {
  it('steht still, solange nichts läuft', () => {
    const state = zustand({ running: false })
    expect(prompterPosition(state, JETZT + 60_000)).toBe(10)
  })

  it('rückt mit dem Tempo vor', () => {
    const state = zustand({ running: true })
    /* 120 Zeilen je Minute, eine halbe Minute: 60 Zeilen dazu. */
    expect(prompterPosition(state, JETZT + 30_000)).toBeCloseTo(70, 5)
  })

  it('rechnet ein spät hinzugekommenes Gerät auf dieselbe Stelle', () => {
    const state = zustand({ running: true })
    const frueh = prompterPosition(state, JETZT + 45_000)
    const spaet = prompterPosition({ ...state }, JETZT + 45_000)
    expect(spaet).toBe(frueh)
  })

  it('geht nie hinter den Anfang', () => {
    const state = zustand({ position: -5, running: false })
    expect(prompterPosition(state, JETZT)).toBe(0)
  })

  it('ignoriert eine Uhr, die zurückläuft', () => {
    const state = zustand({ running: true })
    expect(prompterPosition(state, JETZT - 10_000)).toBe(10)
  })
})

describe('Markdown wird zu Blöcken', () => {
  const text = [
    '# Bericht',
    '',
    'Erster Absatz, erste Zeile',
    'und zweite Zeile desselben Absatzes.',
    '',
    '- Ein Punkt',
    '> Ein Zitat',
    '---',
    'Danach weiter.'
  ].join('\n')

  it('erkennt Überschrift, Absatz, Punkt, Zitat und Atempause', () => {
    const bloecke = redeBloecke(text)
    expect(bloecke.map((block) => block.art)).toEqual([
      'ueberschrift',
      'absatz',
      'punkt',
      'zitat',
      'pause',
      'absatz'
    ])
    expect(bloecke[0].ebene).toBe(1)
  })

  it('führt die Zeilen eines Absatzes zusammen', () => {
    const bloecke = redeBloecke(text)
    expect(bloecke[1].text).toBe('Erster Absatz, erste Zeile und zweite Zeile desselben Absatzes.')
  })

  it('lässt Absätze getrennt, statt eine Textwand zu bauen', () => {
    /* Wer den Blick hebt und wieder senkt, findet die Stelle nur an einem
       Absatz wieder. */
    expect(redeBloecke('Eins.\n\nZwei.').length).toBe(2)
  })

  it('kommt mit Windows-Zeilenenden zurecht', () => {
    expect(redeBloecke('# Titel\r\n\r\nText.').map((block) => block.art)).toEqual([
      'ueberschrift',
      'absatz'
    ])
  })

  it('zählt nur wirkliche Wörter', () => {
    expect(redeWoerter('# Titel\n\n- Eins zwei drei\n\n---\n\n> Vier.')).toBe(5)
  })

  it('schätzt die Redezeit aus der Wortzahl', () => {
    expect(redeDauer(WOERTER_JE_MINUTE)).toBe(60)
    expect(redeDauer(WOERTER_JE_MINUTE * 3)).toBe(180)
  })
})

describe('Der Prompter geht seinen eigenen Weg', () => {
  it('hat einen eigenen Endpunkt im Netz', () => {
    const server = lies('src/main/network-projection.ts')
    expect(PROMPTER_PFAD).toBe('/prompter')
    expect(server).toContain('/api/prompter/stream')
    expect(server).toContain('prompterClients')
  })

  it('hängt nicht am Projektionszustand', () => {
    /* Was am Pult steht, darf nie versehentlich an die Wand geraten. */
    const dienst = lies('src/main/services/prompter.ts')
    expect(dienst).not.toContain("from './projection'")
  })

  it('verankert die Stelle, bevor sich das Tempo ändert', () => {
    /* Sonst rechnete jedes Gerät die verstrichene Zeit mit dem neuen Tempo
       neu, und die Rede rutschte um Minuten. */
    const dienst = lies('src/main/services/prompter.ts')
    expect(dienst).toContain('export function setPrompterTempo')
    expect(dienst).toContain('return setze({ tempo: Math.round(tempo) })')
  })
})

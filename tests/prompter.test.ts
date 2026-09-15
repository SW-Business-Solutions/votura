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
  blockGewicht,
  redeBloecke,
  redeDauer,
  redeLaenge,
  redeWoerter,
  redeWortfolge,
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
    expect(redeBloecke('# Titel\r\n\r\nText.').map((block) => block.art)).toEqual(['ueberschrift', 'absatz'])
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

  it('folgt dem Aufruf nur auf seiner eigenen Bühne und nur in diese Richtung', () => {
    /*
     * Die einzige Verbindung zwischen Bühne und Pult wird im Hauptprozess
     * geknüpft, nicht im Dienst — und sie gilt für die Bühne, die der Prompter
     * steuert. Eine zweite Leinwand risse sonst den Text weg.
     */
    const start = lies('src/main/index.ts')
    expect(start).toContain('buehne === getPrompterBuehne()')
    expect(start).toContain('sprecherAufgerufen(state.speaker')
    /* Der Wahlgang reist mit — er entscheidet, welche Rede gemeint ist, wenn
       dieselbe Person sich mehrfach bewirbt. */
    expect(start).toContain('roundId: state.round?.id')
    /* Und nichts nimmt den umgekehrten Weg. */
    const projektion = lies('src/main/services/projection.ts')
    expect(projektion).not.toContain("from './prompter'")
  })

  it('lässt am Pult nur Prompterbefehle zu', () => {
    /*
     * Die einzige schreibende Stelle des Projektionsservers. Sie darf das
     * Manuskript bewegen und sonst nichts — die Liste ist die Grenze.
     */
    const server = lies('src/main/network-projection.ts')
    expect(server).toContain('/api/prompter/control')
    expect(server).toContain('allowPrompterControl')
    expect(server).toContain('PROMPTER_BEFEHLE')
    /* Kein Wahlgang, kein Druck, kein Ergebnis. */
    const liste = /const PROMPTER_BEFEHLE = new Set\(\[([^\]]*)\]\)/.exec(server)?.[1] ?? ''
    expect(liste).not.toMatch(/round\.|print\.|result\.|ballot\./)
    expect(liste.match(/'/g)?.length).toBe(14)
  })

  it('ist standardmäßig aus', () => {
    const vorgabe = lies('src/shared/config.ts')
    expect(vorgabe).toContain('allowPrompterControl: false')
  })

  it('verankert die Stelle, bevor sich das Tempo ändert', () => {
    /* Sonst rechnete jedes Gerät die verstrichene Zeit mit dem neuen Tempo
       neu, und die Rede rutschte um Minuten. */
    const dienst = lies('src/main/services/prompter.ts')
    expect(dienst).toContain('export function setPrompterTempo')
    expect(dienst).toContain('return setze({ tempo: Math.round(tempo) })')
  })
})

describe('Hinweise an die vortragende Person', () => {
  /*
   * „[Zum Publikum schauen]" — eine Regieanweisung, keine Zeile zum Vorlesen.
   * Sie muss deshalb an drei Stellen anders behandelt werden als Text: beim
   * Zählen, beim Lauf und beim Mithören. Jede dieser drei Stellen wäre für
   * sich still falsch geworden.
   */
  const REDE = [
    '# Begrüßung',
    '',
    '[Zum Publikum schauen und kurz warten]',
    '',
    'Liebe Mitglieder, ich freue mich sehr.',
    '',
    '---',
    '',
    'Damit komme ich zum Bericht.'
  ].join('\n')

  it('erkennt die eckige Klammer auf einer eigenen Zeile', () => {
    const bloecke = redeBloecke(REDE)
    expect(bloecke.map((block) => block.art)).toEqual([
      'ueberschrift',
      'hinweis',
      'absatz',
      'pause',
      'absatz'
    ])
    expect(bloecke[1].text).toBe('Zum Publikum schauen und kurz warten')
  })

  it('lässt eine Klammer im Satz in Ruhe', () => {
    /* Ein eingeklammerter Einschub mitten im Text will vorgelesen werden —
       nur eine ganze Zeile ist ein Hinweis. */
    const bloecke = redeBloecke('Wir haben [wie angekündigt] beschlossen.')
    expect(bloecke[0].art).toBe('absatz')
    expect(bloecke[0].text).toBe('Wir haben [wie angekündigt] beschlossen.')
  })

  it('zählt den Hinweis nicht zur Redezeit', () => {
    /* Sonst wäre die Rede länger geschätzt, als sie dauert — und der Hinweis
       ist sechs Wörter lang. */
    expect(redeWoerter(REDE)).toBe(redeWoerter(REDE.replace(/^\[.*\]$/m, '')))
  })

  it('gibt ihm im Lauf trotzdem einen Moment', () => {
    /* Ohne Gewicht huschte er vorbei, bevor ihn jemand liest. Aber nur einen:
       Gesprochen wird er nicht, also kostet er nicht die Zeit seiner Wörter. */
    expect(blockGewicht({ art: 'hinweis', text: 'Zum Publikum schauen und kurz warten' })).toBe(1)
  })

  it('hält Lauflänge und Wortfolge auf derselben Zählung', () => {
    /*
     * Der Lauf rechnet in Blockgewichten, das Mithören in Wörtern. Laufen
     * beide auseinander, zeigt die Lesezeile beim Mithören auf die falsche
     * Stelle — und der Lauf hält vor dem letzten Satz an.
     */
    expect(redeWortfolge(REDE)).toHaveLength(redeLaenge(REDE))
  })

  it('sucht nicht nach Wörtern, die niemand spricht', () => {
    const folge = redeWortfolge(REDE)
    expect(folge).not.toContain('publikum')
    expect(folge).toContain('mitglieder')
  })
})

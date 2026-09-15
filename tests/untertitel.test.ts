import { describe, expect, it } from 'vitest'
import {
  UNTERTITEL_ZEICHEN_JE_ZEILE,
  UNTERTITEL_ZEILEN,
  untertitelBilden,
  untertitelKuerzen,
  untertitelZeilen
} from '@shared/untertitel'

describe('Der Zeilenumbruch der Untertitel', () => {
  it('bricht an Wortgrenzen', () => {
    const zeilen = untertitelZeilen('der antrag wird in der vorliegenden fassung angenommen', 20, 5)
    expect(zeilen.every((zeile) => zeile.length <= 20)).toBe(true)
    expect(zeilen.join(' ')).toBe('der antrag wird in der vorliegenden fassung angenommen')
  })

  it('zerschneidet kein Wort', () => {
    /* „Mitgliederversammlungsbeschluss" passt in keine Zeile — sie bekommt
       dann eben eine eigene. Ein zerschnittenes Wort liest sich schlechter
       als ein überstehendes. */
    const zeilen = untertitelZeilen('der mitgliederversammlungsbeschluss gilt', 12, 5)
    expect(zeilen).toContain('mitgliederversammlungsbeschluss')
  })

  it('behält das Ende, nicht den Anfang', () => {
    /*
     * Wer auf die Wand sieht, will wissen, was **gerade** gesagt wird. Der
     * Anfang des Satzes ist entweder schon gelesen oder verpasst; ihn stehen
     * zu lassen und das Neue abzuschneiden, hieße, die Untertitel nutzlos zu
     * machen.
     */
    const zeilen = untertitelZeilen('eins zwei drei vier fünf sechs sieben acht', 9, 2)
    expect(zeilen.join(' ')).toBe('sieben acht')
  })

  it('gibt bei leerem Text nichts zurück', () => {
    expect(untertitelZeilen('   ')).toEqual([])
  })

  it('hält sich an die vorgegebene Zeilenzahl', () => {
    const lang = Array.from({ length: 200 }, (_, i) => `wort${i}`).join(' ')
    expect(untertitelZeilen(lang).length).toBe(UNTERTITEL_ZEILEN)
    for (const zeile of untertitelZeilen(lang)) {
      expect(zeile.length).toBeLessThanOrEqual(UNTERTITEL_ZEICHEN_JE_ZEILE)
    }
  })
})

describe('Sicheres und Vorläufiges', () => {
  it('nennt die Stelle, ab der es unsicher wird', () => {
    const stand = untertitelBilden('ich beantrage', 'die abstimmung')
    expect(stand.zeilen.join(' ')).toBe('ich beantrage die abstimmung')
    /* Vier Wörter sichtbar, die letzten zwei sind vorläufig. */
    expect(stand.vorlaeufigAbWort).toBe(2)
  })

  it('kennt keine Unsicherheit, wenn nichts im Fluss ist', () => {
    const stand = untertitelBilden('der antrag ist angenommen', '')
    expect(stand.vorlaeufigAbWort).toBeUndefined()
  })

  it('verschiebt die Grenze mit, wenn der Anfang wegfällt', () => {
    /*
     * Die Grenze wird in dem gezählt, was **übrigbleibt**. Würde sie im
     * ganzen Text gezählt, zeigte die Ansicht nach dem ersten Kürzen die
     * falsche Hälfte blass — und zwar dauerhaft, weil der Fehler mit jedem
     * Satz größer wird.
     */
    const sicher = Array.from({ length: 80 }, (_, i) => `alt${i}`).join(' ')
    const stand = untertitelBilden(sicher, 'neu eins')
    const sichtbar = stand.zeilen.join(' ').split(' ')
    expect(sichtbar.slice(stand.vorlaeufigAbWort!)).toEqual(['neu', 'eins'])
  })

  it('kommt mit leerem Stand zurecht', () => {
    expect(untertitelBilden('', '')).toEqual({ zeilen: [] })
  })
})

describe('Der Puffer', () => {
  it('wächst nicht mit der Rede', () => {
    /*
     * Ein Puffer, der alles sammelt, wäre nach einer Stunde ein
     * Wortprotokoll — und genau das soll hier nicht entstehen. Er wird
     * deshalb auf das gekürzt, was ohnehin an die Wand passt.
     */
    let puffer = ''
    for (let i = 0; i < 500; i++) puffer = untertitelKuerzen(`${puffer} satzteil${i}`)
    expect(puffer.length).toBeLessThanOrEqual(UNTERTITEL_ZEILEN * (UNTERTITEL_ZEICHEN_JE_ZEILE + 1))
  })

  it('behält das zuletzt Gesagte', () => {
    const puffer = untertitelKuerzen('ganz am anfang stand etwas anderes und jetzt kommt das ende')
    expect(puffer.endsWith('das ende')).toBe(true)
  })
})

/*
 * Ab hier der Weg durch den Hauptprozess.
 *
 * Der Aufbau ist derselbe wie in `buehnen.test.ts`: Electron wird ersetzt, die
 * Ablage liegt in einem Wegwerfordner. Geprüft wird nicht, ob Kaldi versteht,
 * was jemand sagt — das entscheidet das Modell, nicht dieser Code. Geprüft
 * wird, **wohin** der erkannte Text geht und wohin nicht.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'wahlzettel-untertitel-'))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => join(root, name),
    getVersion: () => '0.1.0-test'
  },
  dialog: { showErrorBox: () => undefined },
  ipcMain: { handle: () => undefined },
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 0 }) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined },
  shell: { openExternal: () => undefined },
  session: { defaultSession: {} },
  Menu: { setApplicationMenu: () => undefined }
}))

const { initDatabase, db } = await import('../src/main/db')
const { initLogger } = await import('../src/main/logger')
const dienst = await import('../src/main/services/projection')
const { HAUPTBUEHNE } = await import('../src/shared/projection')

beforeAll(() => {
  initLogger(join(root, 'logs'))
  initDatabase(join(root, 'data', 'test.sqlite'))
  dienst.saveBuehnen([
    { id: HAUPTBUEHNE, name: 'Saalwand', followsRound: true },
    { id: 2, name: 'Rückblick am Pult', followsRound: false }
  ])
})

describe('Untertitel im Beamerzustand', () => {
  it('sind zuerst aus', () => {
    expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel).toBeUndefined()
  })

  it('werden je Bühne geschaltet', () => {
    /*
     * Die Saalwand liest mit, der Rückblickschirm am Pult nicht — der Redner
     * braucht nicht zu lesen, was er selbst gerade sagt.
     */
    dienst.setUntertitel(HAUPTBUEHNE, true)
    expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel).toEqual({ zeilen: [] })
    expect(dienst.getProjectionState(2).untertitel).toBeUndefined()
  })

  it('bekommen Text nur dort, wo sie eingeschaltet sind', () => {
    dienst.meldeUntertitel({ zeilen: ['ich beantrage die abstimmung'] })
    expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel?.zeilen).toEqual([
      'ich beantrage die abstimmung'
    ])
    expect(dienst.getProjectionState(2).untertitel).toBeUndefined()
  })

  it('räumen die Wand, wenn sie ausgeschaltet werden', () => {
    /* Kein halber Satz, der stehen bleibt, weil jemand den Schalter umgelegt
       hat. */
    dienst.setUntertitel(HAUPTBUEHNE, false)
    expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel).toBeUndefined()
  })

  it('werden nicht auf die Platte geschrieben', () => {
    /*
     * **Das ist die eigentliche Zusage.** Untertitel stehen an der Wand,
     * solange sie dort stehen — und sonst nirgends. Landete der Text in der
     * abgelegten Projektion, entstünde nebenbei ein Wortprotokoll: etwas,
     * das eine Versammlung ausdrücklich beschließen müsste.
     */
    dienst.setUntertitel(HAUPTBUEHNE, true)
    dienst.meldeUntertitel({ zeilen: ['das bleibt nirgendwo stehen'] })

    const abgelegt = (
      db().prepare('SELECT state_json FROM projection_state WHERE id = 1').get() as
        | { state_json: string }
        | undefined
    )?.state_json

    expect(abgelegt).not.toContain('das bleibt nirgendwo stehen')
    dienst.setUntertitel(HAUPTBUEHNE, false)
  })

  it('rühren den Zeitstempel des Inhalts nicht an', () => {
    /*
     * **Der zweite Fehler, den dieser Test festhält.**
     *
     * `updatedAt` heißt „der gezeigte Inhalt hat sich geändert". Daran hängt
     * mehr, als man ihm ansieht: Die Beameransicht misst danach ihren Text
     * neu ein, damit er die Fläche füllt, und die Bedienung holt Verlauf und
     * Netzstand nach.
     *
     * Trug jede Untertitelmeldung einen neuen Stempel, geschah beides
     * viermal je Sekunde — sichtbar als Zucken des ganzen Bildes bei jedem
     * erkannten Wort. Ein Untertitel ändert den Inhalt nicht; er steht in
     * einem eigenen Band darüber.
     */
    dienst.setUntertitel(HAUPTBUEHNE, true)
    const vorher = dienst.getProjectionState(HAUPTBUEHNE).updatedAt
    dienst.meldeUntertitel({ zeilen: ['erstes wort'] })
    dienst.meldeUntertitel({ zeilen: ['erstes wort zweites'] })
    expect(dienst.getProjectionState(HAUPTBUEHNE).updatedAt).toBe(vorher)
    /* Angekommen ist der Text trotzdem. */
    expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel?.zeilen).toEqual(['erstes wort zweites'])
    dienst.setUntertitel(HAUPTBUEHNE, false)
  })

  it('überleben jeden Ansichtswechsel', () => {
    /*
     * **Der Fehler, für den dieser Test da ist.**
     *
     * Untertitel hängen an keinem Modus: Gesprochen wird vor der
     * Tagesordnung genauso wie vor einem Kamerabild. Der erste Anlauf baute
     * den Zustand beim Moduswechsel neu auf und ließ sie dabei weg — der
     * Schalter blieb gesetzt, das Zuhörerfenster lief weiter, an der Wand
     * kam nichts mehr an.
     *
     * Es bricht nichts, es fehlt nur etwas. Genau deshalb muss ein Test
     * danach sehen.
     */
    dienst.setUntertitel(HAUPTBUEHNE, true)
    for (const modus of ['welcome', 'agenda', 'kamera', 'break', 'welcome'] as const) {
      dienst.setProjection(HAUPTBUEHNE, { mode: modus })
      expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel, modus).toBeDefined()
    }
    dienst.setUntertitel(HAUPTBUEHNE, false)
  })

  it('sind nach einem Neustart aus', () => {
    /*
     * Wie der Modus: Nach einem Neustart beginnt jede Fläche bei der
     * Begrüßung, und niemand spricht. Ein Mikrofon, das sich nach einem
     * Absturz von selbst wieder einschaltet, wäre eine Entscheidung, die der
     * Rechner nicht zu treffen hat — auch wenn es dieselbe wäre, die vorher
     * jemand getroffen hatte.
     *
     * Und der halbe Satz von vorhin stünde sonst wieder an der Wand, unter
     * einem Bild, zu dem er längst nicht mehr gehört.
     */
    dienst.setUntertitel(HAUPTBUEHNE, true)
    dienst.meldeUntertitel({ zeilen: ['gleich ist es weg'] })
    dienst.restoreProjection()
    expect(dienst.getProjectionState(HAUPTBUEHNE).untertitel).toBeUndefined()
  })
})

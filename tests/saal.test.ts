/**
 * Die Begleitanwendung und ihr Suchruf.
 *
 * Geprüft wird, was ohne Netz und ohne Fenster prüfbar ist: die Form der
 * Antwort, die Adressbildung — und die Zusagen, von denen alles abhängt.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  istSaalAntwort,
  rollenAdresse,
  rollenName,
  SUCHRUF,
  SUCHRUF_PORT,
  type SaalAntwort
} from '../src/shared/saal'

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')

const ANTWORT: SaalAntwort = {
  votura: SUCHRUF,
  name: 'Mitgliederversammlung 2026',
  port: 8477,
  version: '1.1.0',
  tokenNoetig: false,
  buehnen: [
    { id: 1, name: 'Hauptwand' },
    { id: 2, name: 'Seitenwand' }
  ],
  prompterBedienung: true
}

describe('Der Suchruf', () => {
  it('läuft auf einem eigenen Port neben dem Projektionsserver', () => {
    expect(SUCHRUF_PORT).toBe(8478)
    expect(SUCHRUF_PORT).not.toBe(8477)
  })

  it('erkennt eine Antwort von Votura', () => {
    expect(istSaalAntwort(ANTWORT)).toBe(true)
  })

  it('lässt fremden Verkehr auf demselben Port liegen', () => {
    /* Auf einem Broadcast-Port landet allerlei; nichts davon darf als
       Hauptrechner durchgehen. */
    expect(istSaalAntwort({ hallo: 'welt' })).toBe(false)
    expect(istSaalAntwort({ ...ANTWORT, votura: 'etwas anderes' })).toBe(false)
    expect(istSaalAntwort(null)).toBe(false)
    expect(istSaalAntwort('VOTURA-SUCHE/1')).toBe(false)
  })

  it('verrät das Zugriffstoken nicht', () => {
    /*
     * Wer den Ruf hört, ist im selben Netz — mehr nicht. Das Token
     * mitzuschicken hieße, es an jeden zu verteilen, der fragt.
     */
    expect(Object.keys(ANTWORT)).not.toContain('token')
    const dienst = lies('src/main/suchruf.ts')
    expect(dienst).toContain('tokenNoetig')
    expect(dienst).not.toMatch(/token:\s*[^N]/)
  })

  it('antwortet nur an den, der gefragt hat', () => {
    /* Eine Antwort per Broadcast erreichte alle — und wäre ein Werbezettel. */
    const dienst = lies('src/main/suchruf.ts')
    expect(dienst).toContain('absender.port, absender.address')
  })
})

describe('Die Adresse einer Rolle', () => {
  it('führt für eine Bühne auf die Beameransicht', () => {
    expect(
      rollenAdresse({ master: 'http://10.0.0.5:8477', token: '', rolle: { art: 'buehne', nummer: 2 } })
    ).toBe('http://10.0.0.5:8477/?buehne=2')
  })

  it('führt für den Prompter auf den eigenen Endpunkt', () => {
    expect(rollenAdresse({ master: 'http://10.0.0.5:8477', token: '', rolle: { art: 'prompter' } })).toBe(
      'http://10.0.0.5:8477/prompter'
    )
  })

  it('hängt das Token an, wenn eines gesetzt ist', () => {
    const mitToken = rollenAdresse({
      master: 'http://10.0.0.5:8477/',
      token: 'geheim 1',
      rolle: { art: 'buehne', nummer: 3 }
    })
    /* Auch der Schrägstrich am Ende darf nicht zu einem doppelten führen. */
    expect(mitToken).toBe('http://10.0.0.5:8477/?buehne=3&t=geheim%201')
  })

  it('benennt die Rolle mit dem Namen der Bühne, wenn er bekannt ist', () => {
    expect(rollenName({ art: 'buehne', nummer: 2 }, ANTWORT.buehnen)).toBe('Seitenwand')
    expect(rollenName({ art: 'buehne', nummer: 9 }, ANTWORT.buehnen)).toBe('Bühne 9')
    expect(rollenName({ art: 'prompter' })).toBe('Prompter am Pult')
  })
})

describe('Was die Begleitanwendung darf — und was nicht', () => {
  const anwendung = lies('src/saal/index.ts')

  it('führt genau eine Herkunft als sicher', () => {
    /*
     * Der Grund für die ganze Anwendung: `getUserMedia` verlangt eine sichere
     * Herkunft, der Projektionsserver spricht HTTP. Die Zusage gilt einer
     * Adresse, die jemand eingetragen hat — nicht dem Netz.
     */
    expect(anwendung).toContain('unsafely-treat-insecure-origin-as-secure')
    expect(anwendung).toContain('new URL(gespeichert.master).origin')
  })

  it('gibt das Mikrofon nur dem Prompter und nur dem eigenen Hauptrechner', () => {
    expect(anwendung).toContain("rolle.art === 'prompter'")
    expect(anwendung).toContain('setPermissionRequestHandler')
    expect(anwendung).toContain('vomMaster && darfMikrofon')
  })

  it('lässt sich nicht anderswohin navigieren', () => {
    expect(anwendung).toContain('will-navigate')
    expect(anwendung).toContain('setWindowOpenHandler')
  })

  it('wird aus derselben Quelle gebaut wie der Hauptrechner', () => {
    /* Sie zeigt dessen Seiten an — zwei Repositories liefen auseinander. */
    const plan = lies('electron.vite.config.ts')
    expect(plan).toContain("saal: resolve(__dirname, 'src/saal/index.ts')")
    const paket = lies('electron-builder-saal.yml')
    expect(paket).toContain('main: out/main/saal.js')
    expect(paket).toContain('appId: de.votura.saal')
  })

  it('bringt kein eigenes Sprachmodell mit', () => {
    /* Es kommt über das Netz vom Hauptrechner — eine Stelle, nicht zwei. */
    const paket = lies('electron-builder-saal.yml')
    expect(paket).not.toContain('sprachmodell')
    const server = lies('src/main/network-projection.ts')
    expect(server).toContain('SPRACHMODELL_PFAD')
  })
})

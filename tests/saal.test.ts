/**
 * Die Begleitanwendung und ihr Suchruf.
 *
 * Geprüft wird, was ohne Netz und ohne Fenster prüfbar ist: die Form der
 * Antwort, die Adressbildung — und die Zusagen, von denen alles abhängt.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUSSCHUSS_PFAD, WAHL_PFAD } from '../src/shared/wahl'
import {
  adressKandidaten,
  istSaalAntwort,
  rolleBrauchtAnmeldung,
  rollenAdresse,
  rollenName,
  SUCHRUF,
  SUCHRUF_PORT,
  type SaalAntwort,
  type SaalEinstellung,
  type SaalRolle
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

describe('Welche Adresse ein Gerät sich merkt', () => {
  /*
   * **Der Fehler, der das nötig machte.** Gemerkt wurde die Adresse, aus der
   * die Antwort kam. Die wählt aber das Betriebssystem des Hauptrechners je
   * Weg — auf einem Rechner mit Docker, WSL oder Hyper-V kommt sie schnell
   * aus einem virtuellen Schalter wie `172.17.144.1`. Der Fund sah richtig
   * aus, und beim Übernehmen stand „fetch failed": Diese Adresse gibt es nur
   * im Inneren jenes Rechners.
   */
  it('probiert zuerst, was der Hauptrechner selbst nennt', () => {
    const antwort: SaalAntwort = { ...ANTWORT, adressen: ['192.168.2.174'] }
    expect(adressKandidaten(antwort, '172.17.144.1')).toEqual(['192.168.2.174', '172.17.144.1'])
  })

  it('behält den Absender als letzten Halt', () => {
    /* Eine ältere Fassung nennt nichts — dann bleibt es beim bisherigen Weg. */
    expect(adressKandidaten(ANTWORT, '10.0.0.5')).toEqual(['10.0.0.5'])
  })

  it('klopft nicht zweimal an dieselbe Tür', () => {
    const antwort: SaalAntwort = { ...ANTWORT, adressen: ['10.0.0.5', '192.168.1.9'] }
    expect(adressKandidaten(antwort, '10.0.0.5')).toEqual(['10.0.0.5', '192.168.1.9'])
  })
})

describe('Der Hauptrechner nennt brauchbare Adressen', () => {
  it('lässt virtuelle Schalter aus und nimmt eine feste Bindung wörtlich', () => {
    /*
     * Beides steht in derselben Quelle: Ist eine Netzwerkkarte eingestellt,
     * ist die Entscheidung gefallen; sonst gilt die eigene Sortierung.
     */
    const ipc = lies('src/main/ipc.ts')
    expect(ipc).toContain('adressen: () => {')
    expect(ipc).toContain('filter((karte) => !karte.virtuell)')
    expect(ipc).toContain("if (gebunden && gebunden !== '0.0.0.0'")
  })

  it('probiert die Erreichbarkeit mit einer Verbindung, nicht mit einem Abruf', () => {
    /* Über HTTPS käme die Zertifikatsprüfung dazu — und ein Zertifikat gilt
       für einen Namen, nie für eine Adresse. */
    const saal = lies('src/saal/index.ts')
    expect(saal).toContain('connect({ host: adresse, port, timeout: 900 })')
    expect(saal).toContain('erreichbareAdresse')
  })
})

describe('Was die Einrichtung meldet, wenn es nicht geht', () => {
  /*
   * Zwei Fehlschläge, die gleich aussehen und nichts miteinander zu tun
   * haben: „niemand da" und „jemand da, aber er heißt anders". `fetch` meldet
   * beide als „fetch failed". Sie zu verwechseln schickt die Suche ins Netz,
   * wo alles in Ordnung ist — bei einer eingetippten IP-Adresse ist das der
   * Normalfall, denn ein Zertifikat gilt für einen Namen, nie für eine
   * Adresse.
   */
  it('unterscheidet ein fehlendes Gegenüber von einem fremden Namen', () => {
    const saal = lies('src/saal/index.ts')
    expect(saal).toContain('CERT|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY|SSL')
    expect(saal).toContain('sein Zertifikat gilt für einen anderen Namen')
    expect(saal).toContain('antwortet niemand')
  })

  it('sagt in der Einrichtung, mit wem sich das Gerät verbindet', () => {
    /* Ein Fund oben und ein Eintrag im Feld „von Hand" schließen einander
       aus — das Feld gewinnt, und das sah man der Seite nicht an. */
    const seite = lies('src/renderer/src/einrichtung-main.tsx')
    expect(seite).toContain('Dieses Gerät verbindet sich mit')
    expect(seite).toContain('Stattdessen den gefundenen Rechner benutzen')
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

  it('führt für die Präsentationsansicht auf denselben Endpunkt — festgelegt', () => {
    /*
     * Dieselbe Seite wie der Prompter, nur mit einer Ansicht, die dieses Gerät
     * nicht verstellt. Sie gehört sonst zum gemeinsamen Zustand des Pults: Ein
     * zweiter Bildschirm könnte die Folien nicht wählen, ohne dem Pult den
     * Text wegzunehmen.
     */
    expect(rollenAdresse({ master: 'http://10.0.0.5:8477', token: '', rolle: { art: 'vortrag' } })).toBe(
      'http://10.0.0.5:8477/prompter?ansicht=vortrag'
    )
  })

  it('nimmt das Token auch in die festgelegte Ansicht mit', () => {
    expect(
      rollenAdresse({ master: 'http://10.0.0.5:8477', token: 'geheim 1', rolle: { art: 'vortrag' } })
    ).toBe('http://10.0.0.5:8477/prompter?ansicht=vortrag&t=geheim%201')
  })

  it('verlangt für die Präsentationsansicht keine Anmeldung', () => {
    /* Sie zeigt, was ohnehin an der Wand steht. */
    expect(rolleBrauchtAnmeldung({ art: 'vortrag' })).toBe(false)
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
    expect(anwendung).toContain("darfMikrofon = rolle === 'prompter'")
    expect(anwendung).toContain('setPermissionRequestHandler')
    /* Von einer fremden Herkunft kommt nichts durch — gleich welche Rolle. */
    expect(anwendung).toContain('!vomMaster')
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

describe('Die bedienenden Rollen', () => {
  /*
   * Bühne und Prompter zeigen nur an. Akkreditierung, Ausgabe und Wahlkabine
   * werden bedient — hinter ihnen steht ein Mensch, der etwas auslöst.
   */
  const einstellung = (rolle: SaalRolle, token = ''): SaalEinstellung => ({
    master: 'http://192.168.1.5:8477',
    token,
    rolle
  })

  it('führen auf die Fernbedienung des Hauptrechners', () => {
    /*
     * Dieselbe Oberfläche, dieselbe Anmeldung, dieselbe Rechteprüfung. Ein
     * zweiter, schwächerer Weg an dieselben Daten wäre genau die Abkürzung,
     * die man später bereut.
     */
    expect(rollenAdresse(einstellung({ art: 'akkreditierung' }))).toBe(
      'http://192.168.1.5:8477/operator#/akkreditierung'
    )
    expect(rollenAdresse(einstellung({ art: 'ausgabe' }))).toBe('http://192.168.1.5:8477/operator#/ausgabe')
  })

  it('reichen das Zugriffstoken vor der Raute durch', () => {
    /* Alles hinter der Raute sieht der Server nie — das Token muss davor
       stehen, sonst käme es nie an. */
    const adresse = rollenAdresse(einstellung({ art: 'akkreditierung' }, 'geheim'))
    expect(adresse).toBe('http://192.168.1.5:8477/operator?t=geheim#/akkreditierung')
    expect(adresse.indexOf('t=geheim')).toBeLessThan(adresse.indexOf('#'))
  })

  it('zeigen auf die Pfade, die der Hauptrechner wirklich ausliefert', () => {
    /*
     * **Der Fehler, der hier gefangen wird.** Die Kabine zeigte auf `/wahl`,
     * ausgeliefert wurde `/stimme`. Das Fenster blieb schwarz — ein 404 hat
     * keine Oberfläche, und im Saal sieht niemand, woran es liegt.
     *
     * Verglichen wird deshalb gegen dieselben Begriffe, die der
     * Projektionsserver benutzt, nicht gegen abgeschriebene Zeichenketten.
     */
    expect(rollenAdresse(einstellung({ art: 'wahlkabine' }))).toBe(`http://192.168.1.5:8477${WAHL_PFAD}`)
    expect(rollenAdresse(einstellung({ art: 'wahlausschuss' }))).toBe(
      `http://192.168.1.5:8477${AUSSCHUSS_PFAD}`
    )
  })

  it('verlangen eine Anmeldung, die anzeigenden nicht', () => {
    expect(rolleBrauchtAnmeldung({ art: 'akkreditierung' })).toBe(true)
    expect(rolleBrauchtAnmeldung({ art: 'ausgabe' })).toBe(true)
    expect(rolleBrauchtAnmeldung({ art: 'buehne', nummer: 1 })).toBe(false)
    expect(rolleBrauchtAnmeldung({ art: 'prompter' })).toBe(false)
    /* Die Wahlkabine nicht: Dort meldet sich niemand an — dort wählt jemand,
       und genau deshalb darf sie niemanden kennen (ADR-0006). */
    expect(rolleBrauchtAnmeldung({ art: 'wahlkabine' })).toBe(false)
  })

  it('heißen im Klartext, wonach jemand am Gerät sucht', () => {
    expect(rollenName({ art: 'akkreditierung' })).toBe('Akkreditierung am Einlass')
    expect(rollenName({ art: 'ausgabe' })).toBe('Ausgabe der Stimmzettel')
    expect(rollenName({ art: 'wahlkabine' })).toBe('Wahlkabine')
  })
})

/**
 * Was die Begleitanwendung ihrer Seite erlaubt.
 *
 * **Kamera und Mikrofon sind zweierlei**, und in einer Wahlkabine ist der
 * Unterschied nicht akademisch: Eine Kamera scannt dort den Ausweis, ein
 * Mikrofon hätte dort nichts verloren. Chromium fasst beides unter „media"
 * zusammen — die Unterscheidung muss die Anwendung selbst treffen.
 */
describe('Kamera und Mikrofon je Rolle', () => {
  const quelle = readFileSync(join(__dirname, '..', 'src/saal/index.ts'), 'utf8')

  it('trennt beide Arten, statt sie gemeinsam zu entscheiden', () => {
    /*
     * Vorher hing beides an der Prompterrolle. Die Wahlkabine bekam die
     * Kamera deshalb nie, und der Browser meldete das als verweigerte
     * Erlaubnis — gesucht wurde der Fehler dann im Gerät.
     */
    expect(quelle).toContain('darfKamera')
    expect(quelle).toContain('darfMikrofon')
    expect(quelle).toContain('mediaTypes')
  })

  it('gibt das Mikrofon nur dem Prompter', () => {
    expect(quelle).toMatch(/darfMikrofon = rolle === 'prompter'/)
  })

  it('gibt die Kamera den scannenden Rollen', () => {
    for (const rolle of ['wahlkabine', 'akkreditierung', 'ausgabe']) {
      expect(quelle).toContain(`rolle === '${rolle}'`)
    }
  })

  it('bleibt bei einer fremden Herkunft verschlossen', () => {
    expect(quelle).toContain('herkunft !== erlaubteHerkunft')
  })
})

describe('Mit echtem Zertifikat', () => {
  const einrichtung = readFileSync(join(__dirname, '..', 'src/renderer/src/einrichtung-main.tsx'), 'utf8')
  const saalApp = readFileSync(join(__dirname, '..', 'src/saal/index.ts'), 'utf8')

  it('baut die Adresse auf den Namen, nicht auf die Zahl', () => {
    /*
     * **Der Fehler, den das verhindert.** Ein Zertifikat gilt für einen
     * Namen, nie für eine Adresse. `https://192.168.2.174:8477` ergibt auch
     * mit tadellosem Zertifikat eine Warnung — in einer Anwendung ohne
     * Adresszeile nicht einmal eine wegklickbare.
     */
    expect(einrichtung).toContain('zertifikatsName ?? gewaehlt.adresse')
    expect(einrichtung).toContain("gewaehlt.tls ? 'https' : 'http'")
  })

  it('löst den Namen über die Adresse auf, unter der geantwortet wurde', () => {
    /*
     * Im Saalnetz löst den Namen sonst niemand auf — außer Votura selbst, und
     * das setzte voraus, dass dieses Gerät es schon als Namensserver kennt.
     * Ein Henne-Ei-Problem, das hier entfällt.
     */
    expect(saalApp).toContain('host-resolver-rules')
    expect(saalApp).toContain('masterAdresse')
  })
})

describe('Das Fenster sagt, was dieses Gerät ist', () => {
  it('behält seinen Titel, auch wenn die Seite einen eigenen mitbringt', () => {
    /*
     * Die Prompterseite heißt „Votura – Teleprompter" — und überschrieb den
     * Fenstertitel. Damit standen dort weder die Rolle noch der Weg zurück in
     * die Einrichtung. Genau die beiden braucht, wer im Saal vor einem
     * fremden Gerät steht.
     */
    const saal = lies('src/saal/index.ts')
    expect(saal).toContain("fenster.on('page-title-updated'")
    expect(saal).toContain('Strg+Umschalt+E für die Einrichtung')
  })
})

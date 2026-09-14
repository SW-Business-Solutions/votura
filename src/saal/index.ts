/**
 * Votura Saal — die Begleitanwendung für Bühnen und Pult.
 *
 * ## Was sie ist
 *
 * Ein Fenster, das eine Seite des Hauptrechners anzeigt: eine Bühne oder den
 * Prompter. Sie baut **nichts nach**. Alles, was zu sehen ist, liefert der
 * Projektionsserver — dieselben Seiten, die auch ein Browser bekäme.
 *
 * ## Warum es sie trotzdem braucht
 *
 * Drei Dinge kann ein Browser im Saal nicht:
 *
 * 1. **Den Hauptrechner finden.** Hier ruft die Anwendung beim Start ins Netz
 *    und zeigt, wer geantwortet hat — niemand tippt eine IP-Adresse ab.
 * 2. **Kamera und Mikrofon geben.** `getUserMedia` verlangt eine sichere Herkunft,
 *    und der Projektionsserver spricht einfaches HTTP. Diese Anwendung führt
 *    die **eine** Adresse, die ihr genannt wurde, als vertrauenswürdig — mehr
 *    nicht, und nur solange sie eingestellt ist.
 * 3. **Vollbild ohne Ablenkung.** Keine Adresszeile, keine Reiter, kein
 *    Menü — und ein Bildschirmschoner, der aus bleibt.
 *
 * ## Warum ein Neustart nach der Einrichtung
 *
 * Die Zusage „diese Herkunft ist sicher" muss vor dem Start von Chromium
 * feststehen; sie lässt sich später nicht mehr nachreichen. Beim ersten Mal
 * startet die Anwendung deshalb einmal neu — sichtbar und angekündigt, statt
 * eine halbe Sitzung mit einem Mikrofon zu haben, das nicht geht.
 */
import { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, screen, session } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rollenAdresse, rollenName, type SaalEinstellung, type SaalFund } from '@shared/saal'
import { sucheHauptrechner } from '../main/suchruf'

/**
 * Diese Anwendung benennt sich selbst — und zwar, bevor irgendetwas anderes
 * geschieht.
 *
 * Der Name bestimmt den Ordner für die Einstellung **und** die Sperre, die
 * verhindert, dass zweimal dasselbe läuft. Ohne ihn übernimmt Electron den
 * Namen aus `package.json`, und der gehört dem Hauptprogramm: Saal schriebe
 * seine Einstellung in dessen Ordner und beendete sich beim Start
 * kommentarlos, weil es sich für eine zweite Ausgabe des Hauptprogramms
 * hielte. Im gepackten Bau stimmt der Name ohnehin — hier steht er für alle
 * anderen Startwege, und er kostet nichts.
 */
app.setName('Votura Saal')

const isDev = !!process.env.ELECTRON_RENDERER_URL

let fenster: BrowserWindow | null = null
let stromsperre: number | null = null

/* ------------------------------------------------------- Einstellung */

function einstellungsDatei(): string {
  const ordner = app.getPath('userData')
  if (!existsSync(ordner)) mkdirSync(ordner, { recursive: true })
  return join(ordner, 'saal.json')
}

function leseEinstellung(): SaalEinstellung | null {
  try {
    const roh = readFileSync(einstellungsDatei(), 'utf8')
    const gelesen = JSON.parse(roh) as Partial<SaalEinstellung>
    if (!gelesen.master || !gelesen.rolle) return null
    return { master: gelesen.master, token: gelesen.token ?? '', rolle: gelesen.rolle, name: gelesen.name }
  } catch {
    return null
  }
}

function schreibeEinstellung(einstellung: SaalEinstellung | null): void {
  if (!einstellung) {
    writeFileSync(einstellungsDatei(), '{}', 'utf8')
    return
  }
  writeFileSync(einstellungsDatei(), JSON.stringify(einstellung, null, 2), 'utf8')
}

/* ------------------------------------------------ Vertrauen zur Adresse */

/*
 * Die eine Adresse, der diese Anwendung vertraut.
 *
 * Chromium behandelt sie dann wie eine gesicherte Verbindung: Das Mikrofon
 * steht zur Verfügung, und die Seite darf, was eine Seite am Pult können muss.
 * Das ist eine bewusste Zusage an **einen** Rechner im Saalnetz — nicht an
 * das Netz. Sie steht in der Einstellung und lässt sich dort ansehen.
 */
const gespeichert = leseEinstellung()
if (gespeichert) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', new URL(gespeichert.master).origin)
  /* Ohne diesen Zusatz greift die Zusage in einem eigenen Prozess je Seite
     nicht — Chromium prüft sie dann erneut und kommt zu einem anderen
     Ergebnis. */
  app.commandLine.appendSwitch('disable-site-isolation-trials')
}

/* --------------------------------------------------------------- Fenster */

/**
 * Der Rückweg in die Einrichtung.
 *
 * **Strg + Umschalt + E**, an jedem Fenster dieser Anwendung. Er muss
 * zuverlässig sein: Steht ein Gerät im Vollbild und zeigt die falsche Bühne,
 * gibt es sonst keinen Weg zurück außer Task-Manager — und im Saal steht
 * niemand mit Tastatur und Ruhe daneben.
 *
 * Angehängt wird er beim Erzeugen des Fensters, nicht bei jedem Fokuswechsel:
 * Sonst sammeln sich Zuhörer an, und ob überhaupt einer angehängt wurde,
 * hinge von der Reihenfolge der Ereignisse ab.
 */
function ruestRueckweg(ziel: BrowserWindow): void {
  ziel.webContents.on('before-input-event', (_ereignis, eingabe) => {
    if (eingabe.type !== 'keyDown') return
    if (eingabe.control && eingabe.shift && eingabe.key.toLowerCase() === 'e') {
      schreibeEinstellung(null)
      app.relaunch()
      app.exit(0)
    }
  })
}

function ladeSeite(ziel: BrowserWindow, seite: 'einrichtung'): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void ziel.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${seite}.html`)
    return
  }
  void ziel.loadFile(join(__dirname, `../renderer/${seite}.html`))
}

function oeffneEinrichtung(): void {
  fenster = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'Votura Saal — einrichten',
    backgroundColor: '#0f1214',
    webPreferences: {
      preload: join(__dirname, '../preload/saal.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  fenster.setMenuBarVisibility(false)
  fenster.once('ready-to-show', () => fenster?.show())
  fenster.on('closed', () => {
    fenster = null
  })
  ruestRueckweg(fenster)
  ladeSeite(fenster, 'einrichtung')
}

function oeffneAnzeige(einstellung: SaalEinstellung): void {
  const bildschirme = screen.getAllDisplays()
  /* Auf einem Gerät im Saal gibt es meist nur einen Bildschirm — dann ist
     Vollbild richtig. Hängt ein zweiter dran, bleibt es beim Fenster, damit
     sich noch etwas bedienen lässt. */
  const nurEiner = bildschirme.length <= 1

  fenster = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    frame: !nurEiner,
    fullscreen: nurEiner,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    /* Der Kurzbefehl steht im Titel: Er ist in der Fensterleiste und in der
       Taskleiste zu sehen, ohne das Bild an der Wand zu stören. */
    title: `Votura Saal — ${rollenName(einstellung.rolle)} · Strg+Umschalt+E für die Einrichtung`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  fenster.setMenuBarVisibility(false)
  fenster.once('ready-to-show', () => fenster?.show())
  fenster.on('closed', () => {
    fenster = null
  })
  ruestRueckweg(fenster)

  /*
   * Kommt der Hauptrechner nicht ans Telefon, wird nicht schwarz gezeigt.
   *
   * Im Saal ist das der Regelfall beim Aufbauen: Das Gerät läuft schon, der
   * Rechner vorn noch nicht. Also warten und es in Ruhe wieder versuchen —
   * und dazwischen sagen, worauf gewartet wird.
   */
  fenster.webContents.on('did-fail-load', (_e, code, beschreibung) => {
    if (code === -3) return
    const meldung = `${beschreibung} (${code})`
    void fenster?.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(wartetext(einstellung, meldung))}`
    )
    setTimeout(() => {
      if (fenster && !fenster.isDestroyed()) void fenster.loadURL(rollenAdresse(einstellung))
    }, 4000)
  })

  if (stromsperre === null) stromsperre = powerSaveBlocker.start('prevent-display-sleep')
  void fenster.loadURL(rollenAdresse(einstellung))
}

/** Eine schlichte Seite fürs Warten — ohne Datei, ohne Server. */
function wartetext(einstellung: SaalEinstellung, meldung: string): string {
  return `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; height:100vh; display:grid; place-items:center; gap:8px;
         background:#0f1214; color:#eef2f5; font-family:'Segoe UI',system-ui,sans-serif; }
  div { text-align:center; max-width:34rem; padding:24px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { color:#9fadb8; margin:6px 0; }
  code { color:#7ab6ff; }
</style>
<div>
  <h1>Warte auf den Hauptrechner</h1>
  <p><code>${einstellung.master}</code> — ${rollenName(einstellung.rolle)}</p>
  <p>${meldung}</p>
  <p>Es wird alle vier Sekunden erneut versucht. Strg + Umschalt + E öffnet die Einrichtung.</p>
</div>`
}

/* ------------------------------------------------------------ Brücke */

function registriereBruecke(): void {
  ipcMain.handle('saal:einstellung', async () => leseEinstellung())

  ipcMain.handle('saal:suchen', async (): Promise<SaalFund[]> => {
    const funde = await sucheHauptrechner(1800)
    return funde.map(({ adresse, antwort }) => ({ ...antwort, adresse }))
  })

  /**
   * Prüft eine Adresse, bevor sie gespeichert wird.
   *
   * Eine abgetippte Adresse ist die häufigste Fehlerquelle — und ein Gerät,
   * das nach dem Neustart ins Leere zeigt, ist im Saal schwer zu retten.
   */
  ipcMain.handle('saal:pruefen', async (_e, master: string, token: string) => {
    try {
      const basis = master.replace(/\/+$/, '')
      const adresse = `${basis}/api/projection/state${token ? `?t=${encodeURIComponent(token)}` : ''}`
      const antwort = await fetch(adresse, { signal: AbortSignal.timeout(4000) })
      if (antwort.status === 401) return { ok: false, fehler: 'Zugriffstoken fehlt oder ist falsch.' }
      if (!antwort.ok) return { ok: false, fehler: `Der Rechner antwortet mit ${antwort.status}.` }
      await antwort.json()
      return { ok: true }
    } catch (fehler) {
      return { ok: false, fehler: fehler instanceof Error ? fehler.message : String(fehler) }
    }
  })

  ipcMain.handle('saal:uebernehmen', async (_e, einstellung: SaalEinstellung) => {
    schreibeEinstellung(einstellung)
    /* Siehe Modulkopf: Die Zusage zur Herkunft gilt erst ab dem nächsten
       Start. Einmal neu, dafür danach vollständig. */
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('saal:zuruecksetzen', async () => {
    schreibeEinstellung(null)
    app.relaunch()
    app.exit(0)
  })
}

/* ------------------------------------------------------------ Start */

function haerten(einstellung: SaalEinstellung | null): void {
  const erlaubteHerkunft = einstellung ? new URL(einstellung.master).origin : null

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, ziel) => {
      /* Nur innerhalb des Hauptrechners und der eigenen Seiten. */
      const erlaubt =
        (erlaubteHerkunft && ziel.startsWith(erlaubteHerkunft)) ||
        ziel.startsWith('data:') ||
        ziel.startsWith('file:') ||
        (process.env.ELECTRON_RENDERER_URL && ziel.startsWith(process.env.ELECTRON_RENDERER_URL))
      if (!erlaubt) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  /*
   * **Kamera und Mikrofon werden getrennt entschieden**, und das ist keine
   * Feinheit: Ein Mikrofon in einer Wahlkabine ist undenkbar, eine Kamera
   * dort dagegen der Weg, den Ausweis zu scannen, ohne sechzehn Zeichen zu
   * tippen. Chromium fasst beides unter „media" zusammen; welches gemeint
   * ist, steht in den Einzelheiten der Anfrage.
   *
   * Vorher hing beides an derselben Bedingung — der Prompterrolle. Die
   * Wahlkabine bekam die Kamera deshalb nie, und der Browser meldete das als
   * verweigerte Erlaubnis. Gesucht wurde der Fehler dann im Gerät.
   */
  const rolle = einstellung?.rolle.art
  const darfMikrofon = rolle === 'prompter'
  const darfKamera = rolle === 'wahlkabine' || rolle === 'akkreditierung' || rolle === 'ausgabe'

  /** Ist diese Art von Aufnahme für diese Rolle vorgesehen? */
  const artErlaubt = (art: string): boolean =>
    art === 'audio' ? darfMikrofon : art === 'video' ? darfKamera : false

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, einzelheiten) => {
    const vomMaster = Boolean(erlaubteHerkunft && contents.getURL().startsWith(erlaubteHerkunft))
    if (!vomMaster || permission !== 'media') {
      callback(false)
      return
    }
    /* Jede angefragte Art muss erlaubt sein — wer Kamera *und* Mikrofon
       verlangt, bekommt in der Kabine nichts. */
    const arten = (einzelheiten as { mediaTypes?: string[] }).mediaTypes ?? []
    callback(arten.length > 0 && arten.every(artErlaubt))
  })

  session.defaultSession.setPermissionCheckHandler((_contents, permission, herkunft, einzelheiten) => {
    if (!erlaubteHerkunft || herkunft !== erlaubteHerkunft || permission !== 'media') return false
    return artErlaubt((einzelheiten as { mediaType?: string }).mediaType ?? 'unknown')
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (fenster) {
      if (fenster.isMinimized()) fenster.restore()
      fenster.focus()
    }
  })

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    haerten(gespeichert)
    registriereBruecke()

    if (gespeichert) oeffneAnzeige(gespeichert)
    else oeffneEinrichtung()
  })

  app.on('window-all-closed', () => app.quit())

  app.on('will-quit', () => {
    if (stromsperre !== null) {
      powerSaveBlocker.stop(stromsperre)
      stromsperre = null
    }
  })

  if (isDev)
    app.on('browser-window-created', (_e, geoeffnet) =>
      geoeffnet.webContents.openDevTools({ mode: 'detach' })
    )
}

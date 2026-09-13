/**
 * Fensterverwaltung: Operator (interaktiv), Audience (Beamer, read-only) und
 * Prompter (Vortragssteuerung).
 *
 * Die Audience bekommt einen eigenen, minimalen Preload und lädt eine eigene
 * HTML-Datei — sie kann technisch nichts schreiben (Beamer §2/§31/§32).
 *
 * Der **Prompter** ist ein drittes Fenster und bewusst keine Seite im
 * Operatorfenster: Er lebt von den Pfeiltasten, und die sind dort längst
 * vergeben. Ein eigenes Fenster nimmt die Tastatur, sobald es vorn liegt —
 * und steht nicht im Weg, wenn die Wahlleitung daneben weiterarbeitet.
 */
import { app, BrowserWindow, powerSaveBlocker, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { PrompterWindowState } from '@shared/presentation'
import { HAUPTBUEHNE } from '@shared/projection'
import { PULT_SCHEME } from '@shared/speech'
import type { AudienceWindowState, DisplayInfo } from '@shared/projection'
import { logger } from './logger'

/**
 * Programmsymbol für die Fenster. Im gepackten Zustand liegt es in den
 * Ressourcen, in der Entwicklung im Projektordner — fehlt es, bleibt es beim
 * Standardsymbol, statt den Start zu verhindern.
 */
function fensterSymbol(): string | undefined {
  const orte = [
    join(process.resourcesPath ?? '', 'build', 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(app.getAppPath(), '..', 'build', 'icon.png')
  ]
  return orte.find((ort) => ort && existsSync(ort))
}

let operatorWindow: BrowserWindow | null = null
/**
 * Ein Beamerfenster je Bühne.
 *
 * Bis 0.13 gab es genau eines. Mehrere Anzeigeflächen brauchen mehrere
 * Fenster — jedes auf seinem Bildschirm, jedes mit dem Zustand seiner Bühne.
 */
const audienceWindows = new Map<number, BrowserWindow>()
const audienceDisplays = new Map<number, number>()
let prompterWindow: BrowserWindow | null = null
let teleprompterWindow: BrowserWindow | null = null
let teleprompterStateListener: ((state: PrompterWindowState) => void) | null = null
let prompterStateListener: ((state: PrompterWindowState) => void) | null = null
let powerSaveId: number | null = null
let audienceStateListener: ((state: AudienceWindowState) => void) | null = null

const isDev = !!process.env.ELECTRON_RENDERER_URL

type Seite = 'index' | 'audience' | 'prompter' | 'teleprompter'

function rendererUrl(page: Seite): { url?: string; file?: string } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { url: `${process.env.ELECTRON_RENDERER_URL}/${page === 'index' ? '' : `${page}.html`}` }
  }
  /*
   * Der Teleprompter läuft unter eigenem Schema, nicht unter `file://`.
   *
   * Grund ist die Spracherkennung: Chromium verweigert Web Worker auf Seiten
   * ohne Herkunft. Ein angemeldetes Schema gibt der Seite eine — für alle
   * anderen Fenster bleibt es beim Laden aus der Datei, dort wird nichts
   * gebraucht, was eine Herkunft verlangt.
   */
  if (page === 'teleprompter') return { url: `${PULT_SCHEME}://pult/teleprompter.html` }
  return { file: join(__dirname, `../renderer/${page}.html`) }
}

/**
 * Laedt eine Seite. `query` reist als Suchteil der Adresse mit — die
 * Beameransicht erfaehrt so, welche Buehne sie zeigt, ohne auf eine Antwort
 * aus dem Hauptprozess warten zu muessen.
 */
function load(window: BrowserWindow, page: Seite, query?: string): void {
  const target = rendererUrl(page)
  if (target.url) void window.loadURL(query ? `${target.url}?${query}` : target.url)
  else if (target.file) void window.loadFile(target.file, query ? { search: query } : undefined)
}

export function createOperatorWindow(): BrowserWindow {
  operatorWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: 'Votura – Wahlgangverwaltung',
    icon: fensterSymbol(),
    backgroundColor: '#111417',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  operatorWindow.once('ready-to-show', () => {
    operatorWindow?.show()
    operatorWindow?.maximize()
  })

  operatorWindow.on('closed', () => {
    operatorWindow = null
  })

  // Externe Links nie im Anwendungsfenster öffnen.
  operatorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  load(operatorWindow, 'index')
  return operatorWindow
}

export function getOperatorWindow(): BrowserWindow | null {
  return operatorWindow
}

export function getAudienceWindow(buehne = HAUPTBUEHNE): BrowserWindow | null {
  const fenster = audienceWindows.get(buehne)
  return fenster && !fenster.isDestroyed() ? fenster : null
}

export function listDisplays(buehne = HAUPTBUEHNE): DisplayInfo[] {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  return displays.map((display, index) => ({
    id: display.id,
    label:
      display.id === primary.id
        ? `Bildschirm ${index + 1} (Hauptbildschirm, ${display.size.width}x${display.size.height})`
        : `Bildschirm ${index + 1} (${display.size.width}x${display.size.height})`,
    bounds: display.bounds,
    primary: display.id === primary.id,
    current: display.id === audienceDisplays.get(buehne)
  }))
}

export function audienceState(buehne = HAUPTBUEHNE): AudienceWindowState {
  const displays = listDisplays(buehne)
  return {
    buehne,
    open: Boolean(getAudienceWindow(buehne)),
    displayId: audienceDisplays.get(buehne),
    displays,
    singleDisplay: displays.length <= 1
  }
}

export function onAudienceStateChanged(listener: (state: AudienceWindowState) => void): void {
  audienceStateListener = listener
}

function emitAudienceState(buehne: number): void {
  audienceStateListener?.(audienceState(buehne))
}

export function openAudienceWindow(displayId?: number, buehne = HAUPTBUEHNE): AudienceWindowState {
  const vorhanden = getAudienceWindow(buehne)
  if (vorhanden) {
    if (displayId !== undefined && displayId !== audienceDisplays.get(buehne)) {
      closeAudienceWindow(buehne)
    } else {
      vorhanden.focus()
      return audienceState(buehne)
    }
  }

  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const target =
    displays.find((display) => display.id === displayId) ??
    displays.find((display) => display.id !== primary.id) ??
    primary
  audienceDisplays.set(buehne, target.id)

  const onlyOneDisplay = displays.length <= 1
  const fenster = new BrowserWindow({
    x: target.bounds.x + (onlyOneDisplay ? 40 : 0),
    y: target.bounds.y + (onlyOneDisplay ? 40 : 0),
    width: onlyOneDisplay ? Math.min(1280, target.bounds.width - 80) : target.bounds.width,
    height: onlyOneDisplay ? Math.min(720, target.bounds.height - 80) : target.bounds.height,
    // Ohne zweiten Bildschirm bewusst im Fenstermodus, damit die Wahlleitung
    // weiterarbeiten kann (Beamer §35).
    fullscreen: !onlyOneDisplay,
    frame: onlyOneDisplay,
    autoHideMenuBar: true,
    title: buehne === HAUPTBUEHNE ? 'Votura – Beameransicht' : `Votura – Beameransicht ${buehne}`,
    icon: fensterSymbol(),
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/audience.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  audienceWindows.set(buehne, fenster)
  fenster.setMenuBarVisibility(false)
  if (!onlyOneDisplay) fenster.setAlwaysOnTop(true, 'screen-saver')

  fenster.on('closed', () => {
    audienceWindows.delete(buehne)
    emitAudienceState(buehne)
    emitBeamerSize()
  })
  /* Wird das Fenster gezogen oder auf einen anderen Bildschirm geschoben,
     aendert sich die Flaeche — die Vorschau muss mitziehen. */
  fenster.on('resize', emitBeamerSize)
  fenster.on('enter-full-screen', emitBeamerSize)
  fenster.on('leave-full-screen', emitBeamerSize)
  fenster.webContents.on('did-finish-load', emitBeamerSize)
  fenster.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Beamerfenster ${buehne} abgestuerzt: ${details.reason}`)
    emitAudienceState(buehne)
  })
  fenster.webContents.on('unresponsive', () => {
    logger.warn(`Beamerfenster ${buehne} reagiert nicht.`)
    emitAudienceState(buehne)
  })

  // Bildschirm während der Versammlung wach halten (Beamer §65).
  if (powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
  }

  /* Die Bühne reist in der Adresse mit — die Ansicht muss wissen, wessen
     Zustand sie zeigt. */
  load(fenster, 'audience', `buehne=${buehne}`)
  if (isDev) fenster.webContents.once('did-finish-load', () => emitAudienceState(buehne))
  emitAudienceState(buehne)
  return audienceState(buehne)
}

export function closeAudienceWindow(buehne = HAUPTBUEHNE): AudienceWindowState {
  const fenster = getAudienceWindow(buehne)
  if (fenster) fenster.destroy()
  audienceWindows.delete(buehne)
  /* Der Bildschirmschoner darf erst zurueck, wenn die letzte Buehne zu ist. */
  if (powerSaveId !== null && audienceWindows.size === 0) {
    powerSaveBlocker.stop(powerSaveId)
    powerSaveId = null
  }
  emitAudienceState(buehne)
  return audienceState(buehne)
}

/** Schliesst alle Beamerfenster — etwa beim Beenden oder Bühnenumbau. */
export function closeAllAudienceWindows(): void {
  for (const buehne of [...audienceWindows.keys()]) closeAudienceWindow(buehne)
}

/* ------------------------------------------------------------- Prompter */

export function prompterState(): PrompterWindowState {
  return { open: !!prompterWindow && !prompterWindow.isDestroyed() }
}

export function onPrompterStateChanged(listener: (state: PrompterWindowState) => void): void {
  prompterStateListener = listener
}

function emitPrompterState(): void {
  prompterStateListener?.(prompterState())
}

/**
 * Öffnet die Vortragssteuerung.
 *
 * Bewusst **nicht** auf dem Beamer-Bildschirm: Dort läuft die Präsentation.
 * Der Prompter gehört auf den Rechner der vortragenden Person — er zeigt die
 * nächste Folie, und die soll das Publikum gerade nicht sehen.
 */
export function openPrompterWindow(): PrompterWindowState {
  if (prompterWindow && !prompterWindow.isDestroyed()) {
    prompterWindow.focus()
    return prompterState()
  }

  prompterWindow = new BrowserWindow({
    width: 1180,
    height: 700,
    minWidth: 760,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    title: 'Votura – Vortragssteuerung',
    icon: fensterSymbol(),
    backgroundColor: '#111417',
    webPreferences: {
      preload: join(__dirname, '../preload/prompter.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  prompterWindow.setMenuBarVisibility(false)
  prompterWindow.once('ready-to-show', () => prompterWindow?.show())
  /* Die Vorschau braucht das Beamerformat, sobald sie da ist. */
  prompterWindow.webContents.on('did-finish-load', emitBeamerSize)
  prompterWindow.on('closed', () => {
    prompterWindow = null
    emitPrompterState()
  })
  prompterWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Prompterfenster abgestuerzt: ${details.reason}`)
    emitPrompterState()
  })

  load(prompterWindow, 'prompter')
  emitPrompterState()
  return prompterState()
}

export function closePrompterWindow(): PrompterWindowState {
  if (prompterWindow && !prompterWindow.isDestroyed()) prompterWindow.destroy()
  prompterWindow = null
  emitPrompterState()
  return prompterState()
}

/* --------------------------------------------------------- Teleprompter */

export function teleprompterState(): PrompterWindowState {
  return { open: !!teleprompterWindow && !teleprompterWindow.isDestroyed() }
}

export function onTeleprompterStateChanged(listener: (state: PrompterWindowState) => void): void {
  teleprompterStateListener = listener
}

function emitTeleprompterState(): void {
  teleprompterStateListener?.(teleprompterState())
}

/**
 * Öffnet den Teleprompter am Hauptrechner.
 *
 * Ein eigenes Fenster und keine Seite in der Bedienung: Es gehört auf den
 * Bildschirm vor der vortragenden Person, oft auf einen zweiten Rechner am
 * Pult — und es lebt von den Pfeiltasten, die in der Bedienung längst
 * vergeben sind. Ohne Rahmen und ohne Menü, damit nichts vom Text ablenkt.
 */
export function openTeleprompterWindow(): PrompterWindowState {
  if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
    teleprompterWindow.focus()
    return teleprompterState()
  }

  teleprompterWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 520,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    title: 'Votura – Teleprompter',
    icon: fensterSymbol(),
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/teleprompter.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  teleprompterWindow.setMenuBarVisibility(false)
  teleprompterWindow.once('ready-to-show', () => teleprompterWindow?.show())
  teleprompterWindow.on('closed', () => {
    teleprompterWindow = null
    emitTeleprompterState()
  })
  teleprompterWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Teleprompter abgestuerzt: ${details.reason}`)
    emitTeleprompterState()
  })

  teleprompterWindow.webContents.on('did-finish-load', emitBeamerSize)
  load(teleprompterWindow, 'teleprompter')
  emitTeleprompterState()
  return teleprompterState()
}

export function closeTeleprompterWindow(): PrompterWindowState {
  if (teleprompterWindow && !teleprompterWindow.isDestroyed()) teleprompterWindow.destroy()
  teleprompterWindow = null
  emitTeleprompterState()
  return teleprompterState()
}

export function sendToTeleprompter(channel: string, payload: unknown): void {
  if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
    teleprompterWindow.webContents.send(channel, payload)
  }
}

/**
 * Größe der Beamerfläche in Bildpunkten.
 *
 * Ein Foliensatz richtet sich nach seinem Fenster: Er bricht um, verteilt neu,
 * blendet aus. Die Vorschau in der Vortragssteuerung muss deshalb mit genau
 * dieser Größe rechnen und darf nur im Maßstab abweichen — sonst zeigt sie ein
 * anderes Layout als die Wand.
 *
 * Ist gerade kein Beamerfenster offen, gilt das gängige Beamerformat.
 */
export function beamerContentSize(buehne = prompterBuehne): { width: number; height: number } {
  const fenster = getAudienceWindow(buehne)
  if (fenster) {
    const [width, height] = fenster.getContentSize()
    if (width > 0 && height > 0) return { width, height }
  }
  return { width: 1920, height: 1080 }
}

function emitBeamerSize(): void {
  const groesse = beamerContentSize()
  sendToPrompter(IPC.beamerSize, groesse)
  /* Der Teleprompter zeigt in der Vortragsansicht dieselbe Folie und muss
     deshalb mit derselben Fläche rechnen. */
  sendToTeleprompter(IPC.beamerSize, groesse)
}

/**
 * Die Bühne, die die Vortragssteuerung gerade bedient.
 *
 * Ein Foliensatz kann auf jeder Bühne laufen; der Prompter zeigt und steuert
 * genau eine davon. Welche, entscheidet die vortragende Person im Fenster.
 */
let prompterBuehne = HAUPTBUEHNE

export function getPrompterBuehne(): number {
  return prompterBuehne
}

export function setPrompterBuehne(buehne: number): number {
  prompterBuehne = buehne
  emitBeamerSize()
  return prompterBuehne
}

export function sendToPrompter(channel: string, payload: unknown): void {
  if (prompterWindow && !prompterWindow.isDestroyed()) {
    prompterWindow.webContents.send(channel, payload)
  }
}

export function sendToOperator(channel: string, payload: unknown): void {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send(channel, payload)
  }
}

export function sendToAudience(buehne: number, channel: string, payload: unknown): void {
  getAudienceWindow(buehne)?.webContents.send(channel, payload)
}

/** Nachricht an alle offenen Beamerfenster — etwa Thema oder Uhrzeit. */
export function sendToAllAudiences(channel: string, payload: unknown): void {
  for (const fenster of audienceWindows.values()) {
    if (!fenster.isDestroyed()) fenster.webContents.send(channel, payload)
  }
}

export function watchDisplays(): void {
  const gemeldet = (): void => {
    /* Ein Bildschirm kam oder ging: jede Buehne bekommt die neue Liste. */
    const buehnen = audienceWindows.size > 0 ? [...audienceWindows.keys()] : [HAUPTBUEHNE]
    for (const buehne of buehnen) emitAudienceState(buehne)
  }
  screen.on('display-added', gemeldet)
  screen.on('display-removed', gemeldet)
  screen.on('display-metrics-changed', gemeldet)
}

/**
 * Fensterverwaltung: Operator (interaktiv) und Audience (Beamer, read-only).
 *
 * Die Audience bekommt einen eigenen, minimalen Preload und lädt eine eigene
 * HTML-Datei — sie kann technisch nichts schreiben (Beamer §2/§31/§32).
 */
import { BrowserWindow, powerSaveBlocker, screen, shell } from 'electron'
import { join } from 'node:path'
import type { AudienceWindowState, DisplayInfo } from '@shared/projection'
import { logger } from './logger'

let operatorWindow: BrowserWindow | null = null
let audienceWindow: BrowserWindow | null = null
let audienceDisplayId: number | undefined
let powerSaveId: number | null = null
let audienceStateListener: ((state: AudienceWindowState) => void) | null = null

const isDev = !!process.env.ELECTRON_RENDERER_URL

function rendererUrl(page: 'index' | 'audience'): { url?: string; file?: string } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { url: `${process.env.ELECTRON_RENDERER_URL}/${page === 'index' ? '' : 'audience.html'}` }
  }
  return { file: join(__dirname, `../renderer/${page}.html`) }
}

function load(window: BrowserWindow, page: 'index' | 'audience'): void {
  const target = rendererUrl(page)
  if (target.url) void window.loadURL(target.url)
  else if (target.file) void window.loadFile(target.file)
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

export function getAudienceWindow(): BrowserWindow | null {
  return audienceWindow
}

export function listDisplays(): DisplayInfo[] {
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
    current: display.id === audienceDisplayId
  }))
}

export function audienceState(): AudienceWindowState {
  const displays = listDisplays()
  return {
    open: Boolean(audienceWindow && !audienceWindow.isDestroyed()),
    displayId: audienceDisplayId,
    displays,
    singleDisplay: displays.length <= 1
  }
}

export function onAudienceStateChanged(listener: (state: AudienceWindowState) => void): void {
  audienceStateListener = listener
}

function emitAudienceState(): void {
  audienceStateListener?.(audienceState())
}

export function openAudienceWindow(displayId?: number): AudienceWindowState {
  if (audienceWindow && !audienceWindow.isDestroyed()) {
    if (displayId !== undefined && displayId !== audienceDisplayId) {
      closeAudienceWindow()
    } else {
      audienceWindow.focus()
      return audienceState()
    }
  }

  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const target =
    displays.find((display) => display.id === displayId) ??
    displays.find((display) => display.id !== primary.id) ??
    primary
  audienceDisplayId = target.id

  const onlyOneDisplay = displays.length <= 1
  audienceWindow = new BrowserWindow({
    x: target.bounds.x + (onlyOneDisplay ? 40 : 0),
    y: target.bounds.y + (onlyOneDisplay ? 40 : 0),
    width: onlyOneDisplay ? Math.min(1280, target.bounds.width - 80) : target.bounds.width,
    height: onlyOneDisplay ? Math.min(720, target.bounds.height - 80) : target.bounds.height,
    // Ohne zweiten Bildschirm bewusst im Fenstermodus, damit die Wahlleitung
    // weiterarbeiten kann (Beamer §35).
    fullscreen: !onlyOneDisplay,
    frame: onlyOneDisplay,
    autoHideMenuBar: true,
    title: 'Votura – Beameransicht',
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/audience.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  audienceWindow.setMenuBarVisibility(false)
  if (!onlyOneDisplay) audienceWindow.setAlwaysOnTop(true, 'screen-saver')

  audienceWindow.on('closed', () => {
    audienceWindow = null
    emitAudienceState()
  })
  audienceWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Beamerfenster abgestuerzt: ${details.reason}`)
    emitAudienceState()
  })
  audienceWindow.webContents.on('unresponsive', () => {
    logger.warn('Beamerfenster reagiert nicht.')
    emitAudienceState()
  })

  // Bildschirm während der Versammlung wach halten (Beamer §65).
  if (powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
  }

  load(audienceWindow, 'audience')
  if (isDev) audienceWindow.webContents.once('did-finish-load', () => emitAudienceState())
  emitAudienceState()
  return audienceState()
}

export function closeAudienceWindow(): AudienceWindowState {
  if (audienceWindow && !audienceWindow.isDestroyed()) {
    audienceWindow.destroy()
  }
  audienceWindow = null
  if (powerSaveId !== null) {
    powerSaveBlocker.stop(powerSaveId)
    powerSaveId = null
  }
  emitAudienceState()
  return audienceState()
}

export function sendToOperator(channel: string, payload: unknown): void {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send(channel, payload)
  }
}

export function sendToAudience(channel: string, payload: unknown): void {
  if (audienceWindow && !audienceWindow.isDestroyed()) {
    audienceWindow.webContents.send(channel, payload)
  }
}

export function watchDisplays(): void {
  screen.on('display-added', emitAudienceState)
  screen.on('display-removed', emitAudienceState)
  screen.on('display-metrics-changed', emitAudienceState)
}

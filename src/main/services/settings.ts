/** Konfigurationsverwaltung (§81). Alles lokal, nichts hartcodiert. */
import {
  DEFAULT_CONFIG,
  DEFAULT_NETWORK_PROJECTION,
  DEFAULT_PRINTERS,
  type NetworkProjectionConfig,
  type SystemSettings
} from '@shared/config'
import { normalizeProjectionTheme, type ProjectionTheme } from '@shared/projection'
import type { AppConfig, PrinterConfig } from '@shared/types'
import { db } from '../db'
import { fromJson } from '../db/driver'
import { appPaths } from '../paths'

function read<T>(key: string, fallback: T): T {
  const row = db().prepare(`SELECT value_json FROM settings WHERE key = ?`).get<{ value_json: string }>(key)
  if (!row) return fallback
  return fromJson<T>(row.value_json, fallback)
}

function write(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), new Date().toISOString())
}

export function getConfig(): AppConfig {
  const stored = read<Partial<AppConfig>>('config', {})
  const paths = appPaths()
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    organization: { ...DEFAULT_CONFIG.organization, ...stored.organization },
    printing: { ...DEFAULT_CONFIG.printing, ...stored.printing },
    ballots: {
      ...DEFAULT_CONFIG.ballots,
      ...stored.ballots,
      labels: { ...DEFAULT_CONFIG.ballots.labels, ...stored.ballots?.labels }
    },
    security: { ...DEFAULT_CONFIG.security, ...stored.security },
    backup: {
      ...DEFAULT_CONFIG.backup,
      ...stored.backup,
      directory: stored.backup?.directory || paths.backups
    }
  }
}

export function saveConfig(config: AppConfig): AppConfig {
  write('config', config)
  return getConfig()
}

export function getPrinters(): PrinterConfig[] {
  return read<PrinterConfig[]>('printers', DEFAULT_PRINTERS)
}

export function savePrinters(printers: PrinterConfig[]): PrinterConfig[] {
  write('printers', printers)
  return getPrinters()
}

export function getPrinter(id: string): PrinterConfig | undefined {
  return getPrinters().find((printer) => printer.id === id)
}

export function getNetworkProjection(): NetworkProjectionConfig {
  return { ...DEFAULT_NETWORK_PROJECTION, ...read<Partial<NetworkProjectionConfig>>('networkProjection', {}) }
}

export function saveNetworkProjection(config: NetworkProjectionConfig): NetworkProjectionConfig {
  write('networkProjection', config)
  return getNetworkProjection()
}

export function getProjectionTheme(): ProjectionTheme {
  return normalizeProjectionTheme(read<Partial<ProjectionTheme>>('projectionTheme', {}))
}

export function saveProjectionTheme(theme: ProjectionTheme): ProjectionTheme {
  // Ein Logo wird als Data-URL eingebettet; die Größe wird begrenzt, damit
  // der Zustand über IPC und Netzwerkansicht handlich bleibt.
  if (theme.logo && theme.logo.length > 2_000_000) {
    throw new Error('Das Logo ist zu groß (maximal etwa 1,5 MB). Bitte ein kleineres Bild verwenden.')
  }
  if (theme.logo && !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(theme.logo)) {
    throw new Error('Es werden nur eingebettete Bilddaten akzeptiert (PNG, JPEG, GIF, WebP oder SVG).')
  }
  write('projectionTheme', theme)
  return getProjectionTheme()
}

export function getSettings(): SystemSettings {
  return {
    config: getConfig(),
    printers: getPrinters(),
    networkProjection: getNetworkProjection(),
    projectionTheme: getProjectionTheme()
  }
}

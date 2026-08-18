/** Standardkonfiguration. Alle Werte sind zur Laufzeit änderbar (§81). */
import { DEFAULT_BALLOT_LABELS } from './ballot'
import { DEFAULT_PROJECTION_THEME, type ProjectionTheme } from './projection'
import type { AppConfig, PrinterConfig } from './types'

export interface NetworkProjectionConfig {
  /** Standardmäßig AUS – Freigabe ins LAN ist eine bewusste Entscheidung (§51). */
  enabled: boolean
  port: number
  /** '127.0.0.1' = nur lokal, '0.0.0.0' = im gesamten LAN erreichbar. */
  bindAddress: string
  /** Zugriffstoken; leer = kein Token (nur für abgeschottete Netze sinnvoll). */
  token: string
  /**
   * Zusätzlich zur reinen Beameransicht die vollständige Bedienoberfläche im
   * Netz anbieten. Erfordert eine Anmeldung mit einem lokalen Konto und ist
   * ebenfalls standardmäßig AUS (§51, §70 Phase 3).
   */
  allowRemoteOperator: boolean
}

export interface SystemSettings {
  config: AppConfig
  printers: PrinterConfig[]
  networkProjection: NetworkProjectionConfig
  projectionTheme: ProjectionTheme
}

export { DEFAULT_PROJECTION_THEME }
export type { ProjectionTheme }

export const DEFAULT_PRINTERS: PrinterConfig[] = [
  {
    id: 'thermal-main',
    name: 'Thermodrucker Haupt (Epson, LAN)',
    kind: 'epson_epos',
    host: '192.168.1.50',
    port: 80,
    deviceId: 'local_printer',
    paperWidthMm: 80,
    charsPerLine: 42,
    dotsPerLine: 576,
    cutEveryBallot: true,
    feedLinesBeforeCut: 3,
    codepage: 'CP858',
    enabled: true
  },
  {
    id: 'thermal-usb',
    name: 'Thermodrucker USB (Windows-Treiber)',
    kind: 'escpos_windows',
    windowsPrinterName: 'EPSON TM-T88VII Receipt',
    paperWidthMm: 80,
    charsPerLine: 42,
    dotsPerLine: 576,
    cutEveryBallot: true,
    feedLinesBeforeCut: 3,
    codepage: 'CP858',
    enabled: true
  },
  {
    id: 'file-preview',
    name: 'Datei-Ausgabe (kein Drucker)',
    kind: 'pdf_file',
    paperWidthMm: 80,
    charsPerLine: 42,
    dotsPerLine: 576,
    cutEveryBallot: false,
    feedLinesBeforeCut: 1,
    codepage: 'CP858',
    enabled: true
  }
]

export const DEFAULT_CONFIG: AppConfig = {
  organization: { name: '', code: '' },
  timezone: 'Europe/Berlin',
  printing: {
    defaultPrinterId: 'thermal-main',
    reserveCopies: 5,
    copyDelayMs: 60
  },
  ballots: {
    printRoundCode: true,
    printBallotVersion: false,
    labels: DEFAULT_BALLOT_LABELS
  },
  security: {
    sessionTimeoutMinutes: 30,
    requirePinForMassPrint: true,
    requireFourEyesForResult: false
  },
  backup: {
    directory: ''
  }
}

export const DEFAULT_NETWORK_PROJECTION: NetworkProjectionConfig = {
  enabled: false,
  port: 8477,
  bindAddress: '0.0.0.0',
  token: '',
  allowRemoteOperator: false
}

/*
 * Regelwerk der Versammlung. Die Anwendung ist an keine bestimmte Wahlordnung
 * gebunden — Name, Fassung und Fundstelle werden je Veranstaltung eingetragen
 * und mit jedem Wahlgang als Momentaufnahme gespeichert.
 */
export const DEFAULT_RULE_SET = {
  name: 'Wahlordnung',
  version: '',
  source: '',
  snapshotDate: ''
}

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
  /**
   * Verschlüsselte Übertragung (HTTPS).
   *
   * **Für digitale Abstimmungen ist sie Pflicht, nicht Zierde.** Ohne sie
   * reisen Stimme und Absenderadresse im Klartext durch das Saal-WLAN — und
   * bei WPA2 mit gemeinsamem Passwort kann jeder Teilnehmer den Verkehr jedes
   * anderen entschlüsseln.
   *
   * Das Zertifikat stellt Votura selbst aus. Gegen **Mitlesen** hilft das
   * vollständig; gegen einen aktiven Angreifer nur dort, wo das Gerät den
   * Fingerabdruck kennt. Auf mitgebrachten Telefonen erscheint eine Warnung —
   * das ist der Preis und steht so in der Oberfläche.
   */
  tls: boolean
  allowRemoteOperator: boolean
  /**
   * Darf die Prompteransicht im Netz auch **bedienen**?
   *
   * Der Server ist sonst streng lesend (§51). Diese eine Ausnahme betrifft
   * keine Wahldaten: Sie erlaubt genau die Handgriffe am eigenen Manuskript —
   * anhalten, weiterlaufen, eine Stelle zurück, Tempo, Schriftgröße. Wer am
   * Pult steht, hat ein Tablet vor sich und keinen Zugriff auf die Bedienung;
   * ohne diese Freigabe müsste bei jeder Verhaspelung jemand am Board
   * einspringen.
   *
   * Ebenfalls standardmäßig AUS, unabhängig vom Fernzugriff auf die Bedienung
   * — und wirksam nur für die Prompterbefehle, für nichts sonst.
   */
  allowPrompterControl: boolean
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
    copyDelayMs: 60,
    // Voreinstellung: jeder Zettel einzeln. Die genaue Zählung wiegt im
    // Regelfall schwerer als die Geschwindigkeit; wer viele Zettel braucht,
    // stellt die Bündelung in den Einstellungen höher.
    copiesPerRequest: 1
  },
  ballots: {
    printRoundCode: true,
    printBallotVersion: false,
    labels: DEFAULT_BALLOT_LABELS
  },
  assembly: { quorum: { kind: 'none', value: 0 } },
  security: {
    sessionTimeoutMinutes: 30,
    requirePinForMassPrint: true,
    requireFourEyesForResult: false
  },
  backup: {
    directory: ''
  },
  // Abgeschaltet, bis jemand es ausdrücklich einschaltet: die Anwendung soll
  // ohne Zutun keine Verbindung nach außen aufnehmen.
  updates: {
    checkOnStart: false,
    repository: 'SW-Business-Solutions/votura'
  }
}

export const DEFAULT_NETWORK_PROJECTION: NetworkProjectionConfig = {
  enabled: false,
  port: 8477,
  bindAddress: '0.0.0.0',
  token: '',
  /* Aus, weil die Beameransicht ohne auskommt und eine Zertifikatswarnung
     ohne Not niemandem hilft. Die digitale Abstimmung schaltet sie ein. */
  tls: false,
  allowRemoteOperator: false,
  allowPrompterControl: false
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

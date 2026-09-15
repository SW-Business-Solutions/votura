/** Standardkonfiguration. Alle Werte sind zur Laufzeit änderbar (§81). */
import { DEFAULT_BALLOT_LABELS } from './ballot'
import { DEFAULT_PROJECTION_THEME, type ProjectionTheme } from './projection'
import type { AppConfig, PrinterConfig } from './types'
import type { PtzKamera } from './ptz'

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

/**
 * Die Netzdienste im Saal — beide aus, bis jemand sie einschaltet.
 *
 * Sie gehören zusammen, weil sie **eine** Aufgabe haben: dafür zu sorgen,
 * dass ein Gerät im Saal den Namen auflösen kann, für den das Zertifikat
 * gilt. Ohne Namen kein gültiges Zertifikat, ohne Zertifikat eine Warnung auf
 * jedem Telefon (ADR-0008).
 */
export interface SaalnetzConfig {
  /** Beantwortet Votura den eigenen Namen im Saalnetz? */
  dns: boolean
  /**
   * Namensserver für alles Übrige — üblicherweise der Router.
   *
   * Leer heißt: Es gilt der eine Name und sonst nichts. Dann sind die Gäste
   * im Saalnetz ohne Internet, und manche Telefone verlassen ein WLAN von
   * selbst, in dem nichts geht.
   */
  dnsWeiterleitung: string
  /** Verteilt Votura Adressen? Nur in einem Netz, das es selbst aufspannt. */
  dhcp: boolean
  dhcpVon: string
  dhcpBis: string
  dhcpMaske: string
  /** Der Wegweiser nach draußen. Leer heißt: kein Internet im Saalnetz. */
  dhcpRouter: string
  /** Geltungsdauer einer Adresse in Sekunden. */
  dhcpLaufzeit: number
}

/**
 * Ein hinterlegtes echtes Zertifikat — was davon anzuzeigen ist.
 *
 * Zertifikat und Schlüssel liegen als Dateien; hier steht nur, wofür sie
 * gelten und wie lange. Ein abgelaufenes Zertifikat ist im Saal dasselbe wie
 * gar keines, und das soll man sehen, bevor die Versammlung beginnt.
 */
export interface EigenesZertifikat {
  domain: string
  laeuftAbAm: string
}

export interface SystemSettings {
  config: AppConfig
  printers: PrinterConfig[]
  networkProjection: NetworkProjectionConfig
  projectionTheme: ProjectionTheme
  saalnetz: SaalnetzConfig
  /** Steuerbare Kameras — meist leer. */
  ptzKameras: PtzKamera[]
  /** Fehlt, solange nur das selbst ausgestellte Zertifikat vorliegt. */
  eigenesZertifikat?: EigenesZertifikat
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

/**
 * Netzdienste: aus.
 *
 * Ein zweiter Adressverteiler in einem fremden Netz legt es lahm, und ein
 * Namensdienst, den niemand bestellt hat, verwirrt. Beides ist eine bewusste
 * Entscheidung für einen Aufbau, in dem Votura das Netz selbst aufspannt.
 */
export const DEFAULT_SAALNETZ: SaalnetzConfig = {
  dns: false,
  dnsWeiterleitung: '',
  dhcp: false,
  dhcpVon: '192.168.50.100',
  dhcpBis: '192.168.50.200',
  dhcpMaske: '255.255.255.0',
  dhcpRouter: '',
  /* Zwei Stunden: lang genug für eine Versammlung, kurz genug, dass ein Saal
     nicht am nächsten Tag noch belegte Adressen führt. */
  dhcpLaufzeit: 7200
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

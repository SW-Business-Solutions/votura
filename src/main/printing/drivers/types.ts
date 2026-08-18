import type { PrinterConfig, PrinterTestResult } from '@shared/types'
import type { PrintOp } from '../ops'

/**
 * Treiberabstraktion (§12). Der Druckdienst kennt nur dieses Interface —
 * konkrete Anbindungen (Epson ePOS, RAW-Netzwerk, Windows-Spooler, Datei)
 * sind austauschbar.
 */
export interface PrinterDriver {
  readonly config: PrinterConfig
  /** Verbindung/Bereitschaft prüfen, ohne zu drucken. */
  status(): Promise<PrinterTestResult>
  /** Ein einzelnes Exemplar übergeben. Auflösung = an Drucker übermittelt. */
  submit(ops: PrintOp[], meta: { label: string }): Promise<void>
}

export class PrinterError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'PrinterError'
  }
}

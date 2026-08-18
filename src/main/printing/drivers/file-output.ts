/**
 * Datei-Ausgabe.
 *
 * Ersatzweg ohne Drucker: schreibt die Textfassung und die ESC/POS-Rohdaten in
 * den Export-Ordner. Damit lässt sich das Layout prüfen und im Notfall über
 * einen anderen Rechner ausgeben — die Zettel gelten erst als produziert, wenn
 * sie tatsächlich gedruckt wurden.
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PrinterConfig, PrinterTestResult } from '@shared/types'
import { ensureDirectory, appPaths } from '../../paths'
import { encodeDocument } from '../escpos'
import { renderPreviewLines } from '../layout'
import type { PrintOp } from '../ops'
import type { PrinterDriver } from './types'

export class FileOutputPrinter implements PrinterDriver {
  private readonly directory: string

  constructor(readonly config: PrinterConfig) {
    this.directory = ensureDirectory(join(appPaths().exports, 'druckausgabe'))
  }

  async status(): Promise<PrinterTestResult> {
    return {
      ok: true,
      message: `Datei-Ausgabe aktiv. Die Dateien liegen unter ${this.directory}. Es wird nichts physisch gedruckt.`,
      details: { verzeichnis: this.directory }
    }
  }

  async submit(ops: PrintOp[], meta: { label: string }): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = join(this.directory, `${meta.label}-${stamp}`)
    const lines = renderPreviewLines(ops, this.config.charsPerLine)
    writeFileSync(`${base}.txt`, lines.join('\r\n'), 'utf8')
    writeFileSync(`${base}.escpos.bin`, encodeDocument(ops, this.config))
    appendFileSync(
      join(this.directory, 'ausgabe.log'),
      `${new Date().toISOString()} ${meta.label}\r\n`,
      'utf8'
    )
  }
}

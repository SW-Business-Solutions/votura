/**
 * ESC/POS-Encoder (Epson-Standardbefehlssatz).
 *
 * Bewusst ohne Fremdbibliothek: der Befehlssatz ist klein, stabil und muss
 * offline zuverlässig funktionieren.
 */
import type { PrinterConfig } from '@shared/types'
import { sanitizeForPrint } from '@shared/format'
import type { PrintOp } from './ops'

const ESC = 0x1b
const GS = 0x1d

const CODEPAGE_IDS: Record<PrinterConfig['codepage'], number> = {
  CP437: 0,
  CP858: 19,
  CP1252: 16
}

/** Zeichen jenseits von ASCII, die auf deutschen Bons vorkommen. */
const CP437_EXTRA: Record<string, number> = {
  ä: 0x84,
  ö: 0x94,
  ü: 0x81,
  Ä: 0x8e,
  Ö: 0x99,
  Ü: 0x9a,
  ß: 0xe1,
  '°': 0xf8,
  '§': 0x15
}

function encodeChar(char: string, codepage: PrinterConfig['codepage']): number {
  const code = char.charCodeAt(0)
  if (code < 0x80) return code
  if (codepage === 'CP1252') {
    return code <= 0xff ? code : 0x3f
  }
  return CP437_EXTRA[char] ?? 0x3f
}

export function encodeText(value: string, codepage: PrinterConfig['codepage']): Uint8Array {
  const clean = sanitizeForPrint(value)
  const bytes = new Uint8Array(clean.length)
  for (let index = 0; index < clean.length; index++) {
    bytes[index] = encodeChar(clean[index], codepage)
  }
  return bytes
}

class ByteWriter {
  private chunks: number[] = []

  push(...bytes: number[]): void {
    this.chunks.push(...bytes)
  }

  pushBytes(bytes: Uint8Array): void {
    for (const byte of bytes) this.chunks.push(byte)
  }

  toBuffer(): Buffer {
    return Buffer.from(this.chunks)
  }
}

/** Initialisierung: Reset, Codepage, Standard-Zeilenabstand. */
export function encodeInit(printer: PrinterConfig): Buffer {
  const writer = new ByteWriter()
  writer.push(ESC, 0x40) // ESC @  – Drucker zurücksetzen
  writer.push(ESC, 0x74, CODEPAGE_IDS[printer.codepage]) // ESC t – Zeichentabelle
  writer.push(ESC, 0x52, 0x02) // ESC R – internationaler Zeichensatz: Deutschland
  writer.push(ESC, 0x32) // ESC 2 – Standard-Zeilenabstand
  return writer.toBuffer()
}

export function encodeOps(ops: PrintOp[], printer: PrinterConfig): Buffer {
  const writer = new ByteWriter()

  for (const op of ops) {
    switch (op.type) {
      case 'text': {
        const align = op.align === 'center' ? 1 : op.align === 'right' ? 2 : 0
        writer.push(ESC, 0x61, align) // ESC a – Ausrichtung
        writer.push(ESC, 0x45, op.bold ? 1 : 0) // ESC E – Fettdruck
        writer.push(ESC, 0x2d, op.underline ? 1 : 0) // ESC - – Unterstreichen
        const size = (op.doubleWidth ? 0x10 : 0) | (op.doubleHeight ? 0x01 : 0)
        writer.push(GS, 0x21, size) // GS ! – Zeichengröße
        writer.push(GS, 0x42, op.invert ? 1 : 0) // GS B – Schwarz/Weiss-Umkehr
        writer.pushBytes(encodeText(op.text, printer.codepage))
        writer.push(0x0a)
        // Nach jeder Zeile in den Normalzustand zurück, damit sich Stile
        // nicht über die Zeile hinaus fortpflanzen.
        writer.push(GS, 0x21, 0x00)
        writer.push(GS, 0x42, 0x00)
        writer.push(ESC, 0x45, 0x00)
        writer.push(ESC, 0x2d, 0x00)
        break
      }
      case 'feed':
        writer.push(ESC, 0x64, Math.max(0, Math.min(255, op.lines))) // ESC d – n Zeilen vorschieben
        break
      case 'spacing':
        if (op.dots === 'default') writer.push(ESC, 0x32)
        else writer.push(ESC, 0x33, Math.max(0, Math.min(255, op.dots))) // ESC 3 – Zeilenabstand
        break
      case 'cut':
        writer.push(ESC, 0x64, printer.feedLinesBeforeCut)
        // GS V 66 n – Teilschnitt mit Papiervorschub (Epson-Funktion B)
        writer.push(GS, 0x56, 66, 0x00)
        break
    }
  }

  return writer.toBuffer()
}

export function encodeDocument(ops: PrintOp[], printer: PrinterConfig): Buffer {
  return Buffer.concat([encodeInit(printer), encodeOps(ops, printer)])
}

/** Statusabfrage (DLE EOT n) – wird nur von Treibern mit Rückkanal genutzt. */
export const STATUS_REQUEST = Buffer.from([0x10, 0x04, 0x01])
export const PAPER_STATUS_REQUEST = Buffer.from([0x10, 0x04, 0x04])

/**
 * Epson ePOS-Print (Epsons eigene Schnittstelle).
 *
 * Der Drucker (TM-i / TM-Serie mit Ethernet-Interface) nimmt XML über HTTP
 * entgegen und antwortet mit einem echten Gerätestatus — daher der bevorzugte
 * Treiber: er liefert als einziger belastbare Rückmeldung zu Papier, Cover und
 * Cutter. Es wird ausschließlich mit dem Gerät im lokalen Netz gesprochen.
 */
import { request } from 'node:http'
import { sanitizeForPrint } from '@shared/format'
import type { PrinterConfig, PrinterTestResult } from '@shared/types'
import { logger } from '../../logger'
import type { PrintOp } from '../ops'
import { PrinterError, type PrinterDriver } from './types'

const NAMESPACE = 'http://www.epson-pos.com/schemas/2011/03/epos-print'

function escapeXml(value: string): string {
  return sanitizeForPrint(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function opsToEposXml(ops: PrintOp[], printer: PrinterConfig): string {
  const parts: string[] = []
  for (const op of ops) {
    switch (op.type) {
      case 'text': {
        const attributes = [
          `align="${op.align ?? 'left'}"`,
          op.bold ? 'em="true"' : '',
          op.underline ? 'ul="true"' : '',
          op.invert ? 'reverse="true"' : '',
          op.doubleWidth ? 'dw="true"' : '',
          op.doubleHeight ? 'dh="true"' : ''
        ]
          .filter(Boolean)
          .join(' ')
        parts.push(`<text ${attributes}>${escapeXml(op.text)}&#10;</text>`)
        break
      }
      case 'feed':
        parts.push(`<feed line="${Math.max(0, op.lines)}"/>`)
        break
      case 'spacing':
        parts.push(op.dots === 'default' ? '<feed unit="0"/>' : '')
        break
      case 'cut':
        parts.push(`<feed line="${printer.feedLinesBeforeCut}"/>`)
        parts.push('<cut type="feed"/>')
        break
    }
  }
  return `<epos-print xmlns="${NAMESPACE}">${parts.join('')}</epos-print>`
}

function soapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`
}

interface EposResponse {
  success: boolean
  code: string
  status: number
  raw: string
}

function parseResponse(body: string): EposResponse {
  const success = /success="true"/i.test(body)
  const code = /code="([^"]*)"/i.exec(body)?.[1] ?? ''
  const status = Number(/status="(\d+)"/i.exec(body)?.[1] ?? '0')
  return { success, code, status, raw: body }
}

/** Statusbits der ePOS-Antwort (Auszug der Epson-Statusdefinition). */
function describeStatus(status: number): { paperOut: boolean; coverOpen: boolean; offline: boolean; text: string } {
  const online = (status & 0x00000008) === 0
  const coverOpen = (status & 0x00000020) !== 0
  const paperFeed = (status & 0x00000040) !== 0
  const paperEnd = (status & 0x00080000) !== 0
  const paperNearEnd = (status & 0x00020000) !== 0
  const drawer = (status & 0x00000004) !== 0
  void drawer
  void paperFeed

  const notes: string[] = []
  if (!online) notes.push('Drucker offline')
  if (coverOpen) notes.push('Abdeckung offen')
  if (paperEnd) notes.push('Papier leer')
  else if (paperNearEnd) notes.push('Papier fast leer')
  return {
    paperOut: paperEnd,
    coverOpen,
    offline: !online,
    text: notes.length ? notes.join(', ') : 'betriebsbereit'
  }
}

async function post(printer: PrinterConfig, xml: string, timeoutMs = 15000): Promise<EposResponse> {
  const deviceId = printer.deviceId || 'local_printer'
  const path = `/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(deviceId)}&timeout=10000`
  const payload = Buffer.from(soapEnvelope(xml), 'utf8')

  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: printer.host,
        port: printer.port ?? 80,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': payload.length,
          SOAPAction: '""'
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if ((res.statusCode ?? 0) >= 400) {
            reject(new PrinterError(`Drucker antwortete mit HTTP ${res.statusCode}.`, true))
            return
          }
          resolve(parseResponse(body))
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new PrinterError(`Zeitüberschreitung bei ${printer.host}.`, true))
    })
    req.on('error', (error: NodeJS.ErrnoException) => {
      reject(new PrinterError(`Verbindung zu ${printer.host} fehlgeschlagen: ${error.message}`, true))
    })
    req.write(payload)
    req.end()
  })
}

export class EpsonEposPrinter implements PrinterDriver {
  constructor(readonly config: PrinterConfig) {
    if (!config.host) throw new PrinterError('Für den Epson-ePOS-Treiber ist eine IP-Adresse erforderlich.', false)
  }

  async status(): Promise<PrinterTestResult> {
    try {
      // Leerer Druckauftrag: fragt den Gerätestatus ab, ohne Papier zu verbrauchen.
      const response = await post(this.config, `<epos-print xmlns="${NAMESPACE}"/>`, 8000)
      const status = describeStatus(response.status)
      return {
        ok: response.success && !status.offline && !status.paperOut,
        message: response.success
          ? `Epson ePOS erreichbar (${status.text}).`
          : `Drucker meldet Fehlercode "${response.code}".`,
        details: {
          host: this.config.host ?? '',
          geraet: this.config.deviceId || 'local_printer',
          papierLeer: status.paperOut,
          abdeckungOffen: status.coverOpen,
          offline: status.offline,
          statusCode: response.status
        }
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Unbekannter Fehler bei der Statusabfrage.',
        details: { host: this.config.host ?? '' }
      }
    }
  }

  async submit(ops: PrintOp[], meta: { label: string }): Promise<void> {
    const response = await post(this.config, opsToEposXml(ops, this.config))
    if (!response.success) {
      const status = describeStatus(response.status)
      logger.printer.error(`ePOS-Fehler (${meta.label}): code=${response.code} status=${status.text}`)
      throw new PrinterError(
        `Drucker hat den Auftrag nicht angenommen (${response.code || 'unbekannt'}, ${status.text}).`,
        !status.paperOut
      )
    }
  }
}

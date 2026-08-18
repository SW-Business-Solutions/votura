/**
 * ESC/POS über RAW-Netzwerkdruck (Port 9100).
 *
 * Für jeden Netzwerk-Thermodrucker verwendbar, der ESC/POS spricht. Die
 * Statusabfrage nutzt DLE EOT; antwortet ein Gerät darauf nicht, gilt nur die
 * Verbindung als geprüft — das wird in der Meldung ausdrücklich gesagt (§36).
 */
import { Socket } from 'node:net'
import type { PrinterConfig, PrinterTestResult } from '@shared/types'
import { encodeDocument, PAPER_STATUS_REQUEST, STATUS_REQUEST } from '../escpos'
import type { PrintOp } from '../ops'
import { PrinterError, type PrinterDriver } from './types'

function connect(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    socket.setTimeout(timeoutMs)
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      reject(new PrinterError(`Verbindung zu ${host}:${port} fehlgeschlagen: ${error.message}`, true))
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new PrinterError(`Zeitüberschreitung bei ${host}:${port}.`, true))
    })
    socket.connect(port, host, () => {
      socket.setTimeout(0)
      resolve(socket)
    })
  })
}

export class EscPosNetworkPrinter implements PrinterDriver {
  constructor(readonly config: PrinterConfig) {
    if (!config.host) throw new PrinterError('Für den Netzwerkdruck ist eine IP-Adresse erforderlich.', false)
  }

  async status(): Promise<PrinterTestResult> {
    const host = this.config.host as string
    const port = this.config.port ?? 9100
    let socket: Socket
    try {
      socket = await connect(host, port, 5000)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Verbindung fehlgeschlagen.',
        details: { host, port }
      }
    }

    const answer = await new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500)
      socket.once('data', (data: Buffer) => {
        clearTimeout(timer)
        resolve(data)
      })
      socket.write(STATUS_REQUEST)
      socket.write(PAPER_STATUS_REQUEST)
    })
    socket.end()

    if (!answer || answer.length === 0) {
      return {
        ok: true,
        message: `Verbindung zu ${host}:${port} steht. Der Drucker liefert keinen Statusrückkanal – Papier bitte visuell prüfen.`,
        details: { host, port, statusRueckkanal: false }
      }
    }

    const status = answer[0]
    const paperOut = (status & 0x60) !== 0
    return {
      ok: !paperOut,
      message: paperOut
        ? `Drucker ${host} meldet Papierende.`
        : `Drucker ${host}:${port} ist betriebsbereit.`,
      details: { host, port, statusRueckkanal: true, papierLeer: paperOut }
    }
  }

  async submit(ops: PrintOp[], meta: { label: string }): Promise<void> {
    const host = this.config.host as string
    const port = this.config.port ?? 9100
    const payload = encodeDocument(ops, this.config)
    const socket = await connect(host, port, 10000)

    await new Promise<void>((resolve, reject) => {
      socket.write(payload, (error) => {
        if (error) {
          socket.destroy()
          reject(new PrinterError(`Übertragung fehlgeschlagen (${meta.label}): ${error.message}`, true))
          return
        }
        // end() wartet, bis der Socket-Puffer geleert ist.
        socket.end(() => resolve())
      })
    })
  }
}

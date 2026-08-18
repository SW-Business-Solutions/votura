/**
 * Technische Logs — strikt getrennt vom Audit-Trail (§80).
 * Es werden bewusst keine personenbezogenen Inhalte protokolliert.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logDirectory = ''

export function initLogger(directory: string): void {
  logDirectory = directory
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
}

type Level = 'info' | 'warn' | 'error'

function write(file: string, level: Level, message: string): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`
  if (level === 'error') console.error(line.trimEnd())
  else console.log(line.trimEnd())
  if (!logDirectory) return
  try {
    appendFileSync(join(logDirectory, file), line, 'utf8')
  } catch {
    // Logging darf den Betrieb nie blockieren.
  }
}

export const logger = {
  info: (message: string) => write('application.log', 'info', message),
  warn: (message: string) => write('application.log', 'warn', message),
  error: (message: string) => write('application.log', 'error', message),
  printer: {
    info: (message: string) => write('printer.log', 'info', message),
    warn: (message: string) => write('printer.log', 'warn', message),
    error: (message: string) => write('printer.log', 'error', message)
  }
}

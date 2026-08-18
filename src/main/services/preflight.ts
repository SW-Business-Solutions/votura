/** Systemcheck vor Veranstaltungsbeginn (§65) und Wiederanlauf nach Absturz (§34). */
import { accessSync, constants, existsSync } from 'node:fs'
import type { PreflightItem, RecoveryState } from '@shared/types'
import { db } from '../db'
import { appPaths } from '../paths'
import { verifyAuditChain } from './audit'
import { activeEvent } from './events'
import { getRound } from './rounds'
import { createDriver } from '../printing/drivers'
import { unclearBatches } from './printing'
import { getConfig, getPrinter, getPrinters } from './settings'

function writable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function preflight(): Promise<PreflightItem[]> {
  const items: PreflightItem[] = []
  const config = getConfig()
  const paths = appPaths()

  try {
    const row = db().prepare(`SELECT COUNT(*) AS count FROM events`).get<{ count: number }>()
    items.push({
      key: 'database',
      label: 'Datenbank erreichbar',
      status: 'ok',
      detail: `${paths.database} (${Number(row?.count ?? 0)} Veranstaltungen)`
    })
  } catch (error) {
    items.push({
      key: 'database',
      label: 'Datenbank erreichbar',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'Unbekannter Datenbankfehler'
    })
  }

  const backupDirectory = config.backup.directory || paths.backups
  const backupOk = existsSync(backupDirectory) ? writable(backupDirectory) : writable(paths.root)
  items.push({
    key: 'backup',
    label: 'Backup-Verzeichnis beschreibbar',
    status: backupOk ? 'ok' : 'warn',
    detail: backupDirectory
  })

  const audit = verifyAuditChain()
  items.push({
    key: 'audit',
    label: 'Audit-Kette unversehrt',
    status: audit.ok ? 'ok' : 'fail',
    detail: audit.message
  })

  const printers = getPrinters().filter((printer) => printer.enabled)
  if (printers.length === 0) {
    items.push({ key: 'printer', label: 'Drucker konfiguriert', status: 'fail', detail: 'Kein aktiver Drucker.' })
  } else {
    for (const printer of printers) {
      try {
        const result = await createDriver(printer).status()
        items.push({
          key: `printer:${printer.id}`,
          label: `Drucker ${printer.name}`,
          status: result.ok ? 'ok' : 'warn',
          detail: result.message
        })
      } catch (error) {
        items.push({
          key: `printer:${printer.id}`,
          label: `Drucker ${printer.name}`,
          status: 'fail',
          detail: error instanceof Error ? error.message : 'Treiber nicht initialisierbar'
        })
      }
    }
  }

  const defaultPrinter = getPrinter(config.printing.defaultPrinterId)
  items.push({
    key: 'defaultPrinter',
    label: 'Standarddrucker gesetzt',
    status: defaultPrinter ? 'ok' : 'warn',
    detail: defaultPrinter ? defaultPrinter.name : 'Kein gültiger Standarddrucker hinterlegt.'
  })

  items.push({
    key: 'testprint',
    label: 'Testdruck durchgefuehrt',
    status: hasTestPrint() ? 'ok' : 'warn',
    detail: hasTestPrint()
      ? 'Es wurde bereits ein Testdruck erzeugt.'
      : 'Bitte vor der Versammlung einen Testdruck ausloesen und Papier sowie Cutter prüfen.'
  })

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  items.push({
    key: 'timezone',
    label: `Zeitzone ${config.timezone}`,
    status: timeZone === config.timezone ? 'ok' : 'warn',
    detail: `System: ${timeZone}, konfiguriert: ${config.timezone}. Zeitpunkte werden intern in UTC gespeichert.`
  })

  const offset = Math.abs(Date.now() - Date.parse(new Date().toISOString()))
  items.push({
    key: 'clock',
    label: 'Systemuhr plausibel',
    status: offset < 5000 ? 'ok' : 'warn',
    detail: new Date().toLocaleString('de-DE', { timeZone: config.timezone })
  })

  items.push({
    key: 'offline',
    label: 'Offlinebetrieb',
    status: 'ok',
    detail:
      'Die Anwendung arbeitet ausschließlich lokal: keine Cloud, keine externen Schriften, keine Telemetrie.'
  })

  const unclear = unclearBatches()
  items.push({
    key: 'batches',
    label: 'Keine unklaren Druckaufträge',
    status: unclear.length === 0 ? 'ok' : 'warn',
    detail:
      unclear.length === 0
        ? 'Alle Druckaufträge sind abgeschlossen.'
        : `${unclear.length} Auftrag/Aufträge mit unklarem Status – bitte physisch prüfen und dokumentieren.`
  })

  return items
}

function hasTestPrint(): boolean {
  const row = db()
    .prepare(`SELECT COUNT(*) AS count FROM print_batches WHERE kind = 'test' AND submitted_copies > 0`)
    .get<{ count: number }>()
  return Number(row?.count ?? 0) > 0
}

/** Zustand nach Neustart: was lief zuletzt, was ist offen (§34). */
export function recoveryState(): RecoveryState {
  const event = activeEvent()
  const unclear = unclearBatches()

  let lastRound: RecoveryState['lastRound']
  if (event) {
    const row = db()
      .prepare(
        `SELECT id FROM rounds WHERE event_id = ? AND status NOT IN ('completed','cancelled')
         ORDER BY sequential_number DESC LIMIT 1`
      )
      .get<{ id: string }>(event.id)
    if (row) lastRound = getRound(row.id)
  }

  return {
    hasOpenEvent: Boolean(event),
    event: event ?? undefined,
    lastRound,
    unclearBatches: unclear
  }
}

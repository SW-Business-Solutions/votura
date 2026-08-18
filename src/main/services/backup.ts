/**
 * Backup und Wiederherstellbarkeit (§33, §34).
 *
 * Ein Backup ist ein Ordner mit konsistenter Datenbankkopie, Konfiguration,
 * Audit-Export und den erzeugten Druckdateien. Ziel ist immer ein lokaler
 * Pfad oder ein USB-Stick — nie automatisch eine Cloud.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupResult } from '@shared/ipc'
import { backupDatabaseTo } from '../db'
import { logger } from '../logger'
import { appPaths, ensureDirectory } from '../paths'
import { appendAudit, auditForExport, verifyAuditChain } from './audit'
import { requirePermission } from './auth'
import { listEvents } from './events'
import { getSettings } from './settings'

function directorySize(directory: string): number {
  let total = 0
  const stack = [directory]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else total += statSync(path).size
    }
  }
  return total
}

export function createBackup(target?: string): BackupResult {
  const session = requirePermission('backup.create')
  const settings = getSettings()
  const paths = appPaths()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const root = ensureDirectory(target?.trim() || settings.config.backup.directory || paths.backups)
  const directory = join(root, `wahlzettel-backup-${stamp}`)
  mkdirSync(directory, { recursive: true })

  // VACUUM INTO liefert eine in sich konsistente Kopie, auch während Schreibzugriffen.
  backupDatabaseTo(join(directory, 'wahlzettel.sqlite'))

  writeFileSync(join(directory, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8')
  writeFileSync(join(directory, 'audit.json'), JSON.stringify(auditForExport({}), null, 2), 'utf8')
  writeFileSync(
    join(directory, 'audit-pruefung.json'),
    JSON.stringify(verifyAuditChain(), null, 2),
    'utf8'
  )
  writeFileSync(
    join(directory, 'veranstaltungen.json'),
    JSON.stringify(listEvents(), null, 2),
    'utf8'
  )

  if (existsSync(paths.exports)) {
    cpSync(paths.exports, join(directory, 'exports'), { recursive: true })
  }
  if (existsSync(paths.logs)) {
    cpSync(paths.logs, join(directory, 'logs'), { recursive: true })
  }

  const copies: string[] = []
  const secondary = settings.config.backup.secondaryDirectory?.trim()
  if (secondary) {
    try {
      const secondaryTarget = join(ensureDirectory(secondary), `wahlzettel-backup-${stamp}`)
      cpSync(directory, secondaryTarget, { recursive: true })
      copies.push(secondaryTarget)
    } catch (error) {
      logger.warn(`Zweitkopie des Backups fehlgeschlagen: ${String(error)}`)
    }
  }

  const sizeBytes = directorySize(directory)
  logger.info(`Backup erstellt: ${directory} (${sizeBytes} Bytes)`)

  appendAudit({
    action: 'backup.created',
    userId: session.user.id,
    userName: session.user.displayName,
    newValue: { pfad: directory, groesseBytes: sizeBytes, zweitkopien: copies }
  })

  return {
    path: directory,
    sizeBytes,
    createdAt: new Date().toISOString(),
    copies
  }
}

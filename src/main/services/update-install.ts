/**
 * Einspielen einer neuen Fassung (§29).
 *
 * Warum das eine bewusste Handlung bleibt und nichts im Hintergrund geschieht:
 * Geprüft, freigegeben und im Audit-Trail dokumentiert ist immer die Fassung,
 * die gerade läuft. Der Wechsel verlangt deshalb die Berechtigung zur
 * Systemverwaltung, eine Bestätigung, einen Eintrag im Audit-Trail — und er ist
 * gesperrt, solange eine Wahl läuft oder ein Wahlgang nicht abgeschlossen ist.
 *
 * Geladen wird ausschließlich von bekannten Rechnern, und die Datei wird gegen
 * die veröffentlichte Prüfsumme geprüft, bevor sie ausgeführt wird.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { get } from 'node:https'
import { join } from 'node:path'
import { app, shell } from 'electron'
import type { UpdateInstallCheck, UpdateInstallResult, UpdateProgress } from '@shared/types'
import { logger } from '../logger'
import { appPaths, ensureDirectory } from '../paths'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { activeEvent } from './events'
import { listRounds } from './rounds'
import { getConfig } from './settings'
import { istNeuer } from './updates'

/** Ist ein Wechsel der Fassung gerade vertretbar? */
export function canInstallUpdate(): UpdateInstallCheck {
  const reasons: string[] = []
  const event = activeEvent()
  if (event) {
    const offen = listRounds(event.id).filter(
      (round) =>
        round.status !== 'completed' && round.status !== 'cancelled' && round.status !== 'draft'
    )
    if (offen.length > 0) {
      reasons.push(
        `Die Veranstaltung "${event.title}" läuft: ${offen.length} Wahlgang/Wahlgänge sind noch nicht abgeschlossen.`
      )
    }
  }
  return { possible: reasons.length === 0, reasons }
}

const ERLAUBTE_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

/** Lädt eine Adresse und folgt Weiterleitungen – nur zu bekannten Rechnern. */
function laden(
  url: string,
  onProgress?: (empfangen: number, gesamt: number) => void,
  tiefe = 0
): Promise<Buffer> {
  return new Promise((erfuellen, ablehnen) => {
    if (tiefe > 5) {
      ablehnen(new Error('Zu viele Weiterleitungen.'))
      return
    }
    let ziel: URL
    try {
      ziel = new URL(url)
    } catch {
      ablehnen(new Error('Die Adresse ist ungültig.'))
      return
    }
    if (ziel.protocol !== 'https:' || !ERLAUBTE_HOSTS.has(ziel.hostname)) {
      ablehnen(new Error(`Diese Adresse wird nicht geladen: ${ziel.hostname}`))
      return
    }

    const anfrage = get(
      {
        host: ziel.hostname,
        path: ziel.pathname + ziel.search,
        headers: { 'User-Agent': `Votura/${app.getVersion()}`, Accept: '*/*' },
        timeout: 30_000
      },
      (antwort) => {
        const status = antwort.statusCode ?? 0
        if (status >= 300 && status < 400 && antwort.headers.location) {
          antwort.resume()
          laden(new URL(antwort.headers.location, ziel).toString(), onProgress, tiefe + 1).then(
            erfuellen,
            ablehnen
          )
          return
        }
        if (status !== 200) {
          antwort.resume()
          ablehnen(new Error(`Die Datei konnte nicht geladen werden (Status ${status}).`))
          return
        }
        const gesamt = Number(antwort.headers['content-length'] ?? 0)
        const stuecke: Buffer[] = []
        let empfangen = 0
        antwort.on('data', (stueck: Buffer) => {
          stuecke.push(stueck)
          empfangen += stueck.length
          onProgress?.(empfangen, gesamt)
        })
        antwort.on('end', () => erfuellen(Buffer.concat(stuecke)))
        antwort.on('error', ablehnen)
      }
    )
    anfrage.on('timeout', () => {
      anfrage.destroy()
      ablehnen(new Error('Zeitüberschreitung beim Laden.'))
    })
    anfrage.on('error', ablehnen)
  })
}

interface ReleaseAsset {
  name?: string
  browser_download_url?: string
  size?: number
}

/**
 * Liest die erwartete Prüfsumme aus der `latest.yml`, die beim Herstellen der
 * Fassung entsteht. Aufbau dort:
 *
 *   files:
 *     - url: Votura-0.3.0-x64-Setup.exe
 *       sha512: <base64>
 */
export function pruefsummeAus(latestYml: string, dateiname: string): string | undefined {
  const zeilen = latestYml.split(/\r?\n/)
  for (let i = 0; i < zeilen.length; i++) {
    if (!zeilen[i].includes(dateiname)) continue
    for (let j = i; j < Math.min(i + 5, zeilen.length); j++) {
      const treffer = /sha512:\s*(\S+)/.exec(zeilen[j])
      if (treffer) return treffer[1]
    }
  }
  return undefined
}

/**
 * Lädt das Installationsprogramm der neuesten Fassung, prüft es und startet es.
 * Die Anwendung beendet sich danach selbst — eine laufende Fassung lässt sich
 * nicht ersetzen.
 */
export async function downloadAndInstallUpdate(
  onProgress?: (fortschritt: UpdateProgress) => void
): Promise<UpdateInstallResult> {
  const session = requirePermission('system.manage')

  const moeglich = canInstallUpdate()
  if (!moeglich.possible) {
    throw new Error(
      `Ein Wechsel der Fassung ist jetzt nicht möglich:\n- ${moeglich.reasons.join('\n- ')}`
    )
  }

  const repository = getConfig().updates.repository.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Es ist kein gültiges Projekt hinterlegt (Form: benutzer/projekt).')
  }

  onProgress?.({ phase: 'start', message: 'Veröffentlichung wird abgefragt …' })
  const release = JSON.parse(
    (await laden(`https://api.github.com/repos/${repository}/releases/latest`)).toString('utf8')
  ) as { tag_name?: string; assets?: ReleaseAsset[] }

  const version = (release.tag_name ?? '').replace(/^v/i, '')
  if (!version) throw new Error('Es liegt keine veröffentlichte Fassung vor.')
  if (!istNeuer(version, app.getVersion())) {
    throw new Error(`Die installierte Fassung ${app.getVersion()} ist bereits aktuell.`)
  }

  /*
   * Portabler Betrieb wird anders bedient: Der Installer würde eine
   * installierte Fassung erneuern, nicht die Datei auf dem Stick. Außerdem
   * lässt sich eine laufende Programmdatei unter Windows nicht überschreiben.
   * Deshalb wird dort die neue portable Datei danebengelegt und der Ordner
   * geöffnet — den Wechsel vollzieht der Mensch.
   */
  const pfade = appPaths()
  const assets = release.assets ?? []
  const installer = pfade.portable
    ? assets.find((asset) => /-portable\.exe$/i.test(asset.name ?? ''))
    : assets.find((asset) => /-Setup\.exe$/i.test(asset.name ?? ''))
  if (!installer?.browser_download_url || !installer.name) {
    throw new Error(
      pfade.portable
        ? 'Zu dieser Fassung ist keine portable Programmdatei veröffentlicht.'
        : 'Zu dieser Fassung ist kein Installationsprogramm veröffentlicht.'
    )
  }

  let erwartet: string | undefined
  const latest = assets.find((asset) => asset.name === 'latest.yml')
  if (latest?.browser_download_url) {
    try {
      erwartet = pruefsummeAus(
        (await laden(latest.browser_download_url)).toString('utf8'),
        installer.name
      )
    } catch {
      erwartet = undefined
    }
  }

  onProgress?.({
    phase: 'download',
    message: `${installer.name} wird geladen …`,
    totalBytes: installer.size
  })
  const daten = await laden(installer.browser_download_url, (empfangen, gesamt) =>
    onProgress?.({
      phase: 'download',
      receivedBytes: empfangen,
      totalBytes: gesamt || installer.size
    })
  )

  onProgress?.({ phase: 'verify', message: 'Datei wird geprüft …' })
  const tatsaechlich = createHash('sha512').update(daten).digest('base64')
  if (erwartet && erwartet !== tatsaechlich) {
    throw new Error(
      'Die geladene Datei stimmt nicht mit der veröffentlichten Prüfsumme überein und wird verworfen.'
    )
  }

  // Portabel: neben die laufende Programmdatei, sonst in den Zwischenspeicher.
  const zielordner = pfade.portable
    ? (process.env.PORTABLE_EXECUTABLE_DIR ?? ensureDirectory(pfade.temp))
    : ensureDirectory(pfade.temp)
  const ziel = join(zielordner, installer.name)
  writeFileSync(ziel, daten)

  appendAudit({
    action: 'system.update_started',
    userId: session.user.id,
    userName: session.user.displayName,
    previousValue: { version: app.getVersion() },
    newValue: {
      version,
      datei: installer.name,
      pruefung: erwartet ? 'Prüfsumme stimmt überein' : 'keine Prüfsumme veröffentlicht'
    }
  })

  if (pfade.portable) {
    onProgress?.({
      phase: 'ready',
      message: `Die neue Programmdatei liegt bereit: ${installer.name}. Bitte Votura beenden, die neue Datei starten und die alte löschen. Die Daten im Ordner „Votura-Daten" bleiben unverändert.`
    })
    logger.info(`Neue portable Fassung ${version} bereitgelegt: ${ziel}`)
    shell.showItemInFolder(ziel)
    return { file: ziel, version, verified: Boolean(erwartet), mode: 'portable' }
  }

  onProgress?.({ phase: 'ready', message: 'Die Anwendung wird beendet und die Installation gestartet.' })
  logger.info(`Neue Fassung ${version} wird eingespielt: ${ziel}`)

  // Kurz warten, damit die Meldung den Bediener noch erreicht.
  setTimeout(() => {
    void shell.openPath(ziel).then(() => app.quit())
  }, 1500)

  return { file: ziel, version, verified: Boolean(erwartet), mode: 'installer' }
}

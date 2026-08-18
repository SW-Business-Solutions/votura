/**
 * Hinweis auf neue Fassungen (§2.2).
 *
 * Bewusst zurückhaltend gebaut:
 *
 * - Die Anwendung lädt und installiert **nichts** von selbst. Sie nennt nur die
 *   verfügbare Fassung und verweist auf die Veröffentlichungsseite. Eine
 *   Wahlanwendung, die sich während einer Versammlung selbst austauscht, wäre
 *   nicht mehr nachvollziehbar — geprüft und freigegeben wurde die Fassung, die
 *   läuft.
 * - Die Abfrage erfolgt nur auf ausdrückliche Anforderung oder, wenn es
 *   eingeschaltet ist, einmal beim Start. Ohne Einstellung gibt es keinerlei
 *   Verbindung nach außen.
 * - Sie ist streng begrenzt: ein GET auf die öffentliche Schnittstelle, kurzer
 *   Zeitablauf, kein Nachladen von Umleitungen auf fremde Rechner, und ein
 *   Fehlschlag bleibt folgenlos.
 */
import { get } from 'node:https'
import { app } from 'electron'
import type { UpdateCheckResult } from '@shared/types'
import { logger } from '../logger'
import { getConfig } from './settings'

const ZEITABLAUF_MS = 6000
const ERLAUBTER_HOST = 'api.github.com'

interface GithubRelease {
  tag_name?: string
  html_url?: string
  published_at?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

/** Vergleicht zwei Fassungen nach Semantic Versioning ("1.2.3"). */
export function istNeuer(kandidat: string, laufend: string): boolean {
  const teile = (wert: string): number[] =>
    wert
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((stueck) => Number.parseInt(stueck, 10) || 0)

  const a = teile(kandidat)
  const b = teile(laufend)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

function abrufen(repository: string): Promise<GithubRelease> {
  return new Promise((erfuellen, ablehnen) => {
    const anfrage = get(
      {
        host: ERLAUBTER_HOST,
        path: `/repos/${repository}/releases/latest`,
        headers: {
          // Kein Token, keine Kennung des Rechners – nur das Nötigste.
          'User-Agent': `Votura/${app.getVersion()}`,
          Accept: 'application/vnd.github+json'
        },
        timeout: ZEITABLAUF_MS
      },
      (antwort) => {
        if (antwort.statusCode !== 200) {
          antwort.resume()
          ablehnen(new Error(`Die Abfrage wurde mit Status ${antwort.statusCode} beantwortet.`))
          return
        }
        let text = ''
        antwort.setEncoding('utf8')
        // Obergrenze, damit eine unerwartet große Antwort nichts blockiert.
        antwort.on('data', (stueck: string) => {
          if (text.length < 200_000) text += stueck
        })
        antwort.on('end', () => {
          try {
            erfuellen(JSON.parse(text) as GithubRelease)
          } catch {
            ablehnen(new Error('Die Antwort war nicht lesbar.'))
          }
        })
      }
    )
    anfrage.on('timeout', () => {
      anfrage.destroy()
      ablehnen(new Error('Zeitüberschreitung – vermutlich besteht keine Internetverbindung.'))
    })
    anfrage.on('error', (fehler) => ablehnen(fehler))
  })
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const config = getConfig()
  const installedVersion = app.getVersion()
  const basis: UpdateCheckResult = {
    checkedAt: new Date().toISOString(),
    installedVersion,
    updateAvailable: false
  }

  const repository = config.updates.repository.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return { ...basis, error: 'Es ist kein gültiges Projekt hinterlegt (Form: benutzer/projekt).' }
  }

  try {
    const release = await abrufen(repository)
    if (release.draft || release.prerelease || !release.tag_name) {
      return { ...basis, error: 'Es liegt keine veröffentlichte Fassung vor.' }
    }
    const latestVersion = release.tag_name.replace(/^v/i, '')
    return {
      ...basis,
      latestVersion,
      updateAvailable: istNeuer(latestVersion, installedVersion),
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      notes: release.body?.slice(0, 2000)
    }
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    logger.info(`Aktualisierungsprüfung nicht möglich: ${text}`)
    return { ...basis, error: text }
  }
}

/**
 * Prüfung beim Start — nur wenn eingeschaltet. Ein Fehlschlag wird
 * verschluckt: ohne Netz soll die Anwendung ganz normal weiterlaufen.
 */
export async function checkOnStartIfEnabled(): Promise<UpdateCheckResult | null> {
  if (!getConfig().updates.checkOnStart) return null
  const ergebnis = await checkForUpdate()
  if (ergebnis.updateAvailable) {
    logger.info(`Neue Fassung verfügbar: ${ergebnis.latestVersion} (installiert: ${ergebnis.installedVersion})`)
  }
  return ergebnis
}

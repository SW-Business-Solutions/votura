/**
 * Das Sprachmodell für das Mitlaufen nach Gehör.
 *
 * ## Zwei Orte, eine Reihenfolge
 *
 * Zuerst wird im Benutzerordner nachgesehen, dann in den Programmressourcen.
 * So schlägt ein selbst hinterlegtes Modell immer das mitgelieferte: Wer für
 * einen halligen Saal oder starken Dialekt ein größeres einspielt, muss dafür
 * nichts austauschen und nichts löschen — und ein Programmwechsel nimmt es
 * ihm auch nicht wieder weg.
 *
 * ## Warum ein Archiv und kein Ordner
 *
 * Die Erkennung läuft im Browserteil und packt das Modell dort selbst aus. Sie
 * bekommt deshalb genau eine Datei ausgeliefert. Das erspart es, tausend
 * kleine Dateien einzeln über ein Protokoll zu reichen — und macht das
 * Hinterlegen zu einem einzigen Handgriff.
 */
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { SprachmodellInfo } from '@shared/sprachmodell'
import { appPaths } from '../paths'
import { logger } from '../logger'
import { appendAudit } from './audit'
import { getSession } from './auth'

/** Erlaubte Archive — mehr kann die Erkennung nicht auspacken. */
const ENDUNGEN = /^\.(zip|gz|tgz)$/i

function eigenerOrdner(): string {
  const ziel = join(appPaths().root, 'sprachmodell')
  if (!existsSync(ziel)) mkdirSync(ziel, { recursive: true })
  return ziel
}

function paketOrdner(): string[] {
  /* Im gepackten Zustand liegen die Ressourcen daneben, in der Entwicklung im
     Projektordner. Beide Orte werden geprüft, damit sich das Modell auch beim
     Entwickeln benutzen lässt. */
  return [
    join(process.resourcesPath ?? '', 'sprachmodell'),
    join(app.getAppPath(), 'resources', 'sprachmodell'),
    join(app.getAppPath(), '..', 'resources', 'sprachmodell')
  ]
}

function ersteDateiIn(ordner: string): string | undefined {
  if (!existsSync(ordner)) return undefined
  const treffer = readdirSync(ordner)
    .filter((name) => ENDUNGEN.test(extname(name)))
    .sort()
  return treffer[0] ? join(ordner, treffer[0]) : undefined
}

/** Der Pfad des Modells, das gelten soll — eigenes vor mitgeliefertem. */
export function sprachmodellDatei(): { pfad: string; herkunft: 'paket' | 'eigen' } | undefined {
  const eigen = ersteDateiIn(eigenerOrdner())
  if (eigen) return { pfad: eigen, herkunft: 'eigen' }
  for (const ordner of paketOrdner()) {
    const paket = ersteDateiIn(ordner)
    if (paket) return { pfad: paket, herkunft: 'paket' }
  }
  return undefined
}

export function sprachmodellInfo(): SprachmodellInfo {
  const gefunden = sprachmodellDatei()
  if (!gefunden) return { vorhanden: false }
  return {
    vorhanden: true,
    name: basename(gefunden.pfad),
    bytes: statSync(gefunden.pfad).size,
    herkunft: gefunden.herkunft
  }
}

/**
 * Legt ein eigenes Modell ab.
 *
 * Es wird **kopiert**, nicht verknüpft: Der Stick, von dem es kam, ist im Saal
 * längst wieder in der Tasche — dieselbe Überlegung wie bei Präsentationen.
 */
export function sprachmodellEinlegen(quelle: string): SprachmodellInfo {
  if (!existsSync(quelle)) throw new Error('Die Datei gibt es nicht mehr.')
  if (!ENDUNGEN.test(extname(quelle))) {
    throw new Error('Erwartet wird ein Modellarchiv (.zip, .tar.gz oder .tgz).')
  }
  const ordner = eigenerOrdner()
  /* Nur eines gleichzeitig: Zwei Modelle nebeneinander wären eine Frage, die
     niemand am Pult beantworten will. */
  for (const alt of readdirSync(ordner)) rmSync(join(ordner, alt), { force: true })
  copyFileSync(quelle, join(ordner, basename(quelle)))

  const session = getSession()
  appendAudit({
    action: 'speechmodel.installed',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { datei: basename(quelle), bytes: statSync(quelle).size }
  })
  logger.info(`Sprachmodell hinterlegt: ${basename(quelle)}`)
  return sprachmodellInfo()
}

/** Nimmt das eigene Modell wieder weg — das mitgelieferte bleibt. */
export function sprachmodellEntfernen(): SprachmodellInfo {
  const ordner = eigenerOrdner()
  for (const alt of readdirSync(ordner)) rmSync(join(ordner, alt), { force: true })

  const session = getSession()
  appendAudit({
    action: 'speechmodel.removed',
    userId: session?.user.id,
    userName: session?.user.displayName
  })
  return sprachmodellInfo()
}

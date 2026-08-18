/** Formatierung und Kennungserzeugung. Zeiten intern UTC, Anzeige lokal (§61). */
import type { IsoDate, IsoDateTime } from './types'

export function compactDate(date: IsoDate): string {
  return date.replace(/-/g, '')
}

/**
 * Wahlgangkennung. Identisch auf ALLEN Stimmzetteln eines Wahlgangs (§4.2) —
 * niemals pro Stimmzettel variierend.
 *
 * Beispiel: MV26-20260912-WG07 bzw. MV26-20260912-WG07-S1
 */
export function buildRoundCode(orgCode: string, date: IsoDate, roundLabel: string): string {
  const org = orgCode.trim().toUpperCase().replace(/\s+/g, '')
  return `${org}-${compactDate(date)}-WG${roundLabel.toUpperCase()}`
}

/** Laufende Nummer als zweistelliges Label ("07"). */
export function roundLabelFor(sequentialNumber: number): string {
  return String(sequentialNumber).padStart(2, '0')
}

/** Label eines abgeleiteten Wahlgangs, z. B. "07-S1" (Stichwahl 1). */
export function derivedRoundLabel(parentLabel: string, kind: 'S' | 'R' | 'N' | '2', index: number): string {
  return kind === '2' ? `${parentLabel}-${index + 1}` : `${parentLabel}-${kind}${index}`
}

export function formatDateDe(date: IsoDate): string {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

export function formatDateTimeDe(value: IsoDateTime, timeZone = 'Europe/Berlin'): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone
  }).format(new Date(value))
}

export function formatTimeDe(value: IsoDateTime, timeZone = 'Europe/Berlin'): string {
  return new Intl.DateTimeFormat('de-DE', { timeStyle: 'short', timeZone }).format(new Date(value))
}

export function nowIso(): IsoDateTime {
  return new Date().toISOString()
}

export function todayIsoDate(timeZone = 'Europe/Berlin'): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).format(new Date())
  return parts
}

/**
 * Umlaute und Sonderzeichen für Thermodrucker-Codepages absichern.
 * CP858/CP437 kennen die deutschen Umlaute; alles Übrige wird transliteriert,
 * damit auf dem Bon niemals ein unleserliches Zeichen erscheint.
 */
export function sanitizeForPrint(text: string): string {
  return text
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/[^\x20-\x7EÄÖÜäöüß°§]/g, '?')
}

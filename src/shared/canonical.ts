/**
 * Kanonische JSON-Serialisierung.
 *
 * Wird für Ballot-Hash und Audit-Hash-Chain verwendet. Die Darstellung muss
 * deterministisch sein: gleiche Daten -> identischer String -> identischer Hash.
 * Schlüssel werden rekursiv sortiert, `undefined` fällt weg.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? null : value
  }
  if (Array.isArray(value)) {
    return value.map(normalize)
  }
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue
    result[key] = normalize(source[key])
  }
  return result
}

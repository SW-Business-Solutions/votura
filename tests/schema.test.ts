/**
 * Das Datenbankschema und seine Versionszählung.
 *
 * Anlass: `SCHEMA_VERSION` war eine von Hand gepflegte Zahl und blieb beim
 * Ergänzen einer Migration auf dem alten Stand stehen. Die Folge war
 * heimtückisch — die Prüfung `current > SCHEMA_VERSION` liest den Stand **vor**
 * dem Wandern, also lief der erste Start durch und schrieb die neue Version in
 * die Datei; erst der zweite verweigerte den Dienst. Da standen die Daten
 * schon in der neuen Fassung, und die Anwendung ließ sich nicht mehr öffnen.
 */
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/schema'

describe('Schemaversion', () => {
  it('entspricht der höchsten Migration', () => {
    const hoechste = Math.max(...MIGRATIONS.map((migration) => migration.version))
    expect(SCHEMA_VERSION).toBe(hoechste)
  })

  /* Lückenlos und aufsteigend: Die Schleife in migrate() überspringt alles,
     was kleiner oder gleich dem aktuellen Stand ist — eine Migration mit
     kleinerer Nummer als ihr Vorgänger liefe nie. */
  it('nummeriert die Migrationen lückenlos ab 1', () => {
    const versionen = MIGRATIONS.map((migration) => migration.version)
    expect(versionen).toEqual(versionen.map((_wert, index) => index + 1))
  })

  it('vergibt jede Nummer nur einmal', () => {
    const versionen = MIGRATIONS.map((migration) => migration.version)
    expect(new Set(versionen).size).toBe(versionen.length)
  })

  /* Eine Migration ohne Inhalt hebt die Version, ohne etwas zu ändern — das
     wäre ein stiller Fehler beim Zusammenführen zweier Zweige. */
  it('hat zu jeder Nummer auch Anweisungen', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.sql.trim().length, `Migration ${migration.version}`).toBeGreaterThan(0)
    }
  })
})

# ADR-0002: SQLite über `node:sqlite` statt nativem Modul

- **Status:** angenommen
- **Datum:** 2026-08-17

## Kontext

Die Spezifikation verlangt SQLite. Der übliche Weg (`better-sqlite3`) ist ein natives Modul und
benötigt beim Installieren eine C++-Toolchain sowie einen ABI-Rebuild gegen die Electron-Version.
Auf dem Entwicklungsrechner war keine Visual-Studio-Toolchain vorhanden; auch bei Anwendern würde
jeder Electron-Wechsel einen Rebuild erzwingen.

## Entscheidung

Es wird das in Node 24 (und damit in Electron 43) enthaltene Modul `node:sqlite` verwendet. Der
Zugriff liegt hinter einem schmalen Treiber-Port (`src/main/db/driver.ts`), der zur Laufzeit
`better-sqlite3` bevorzugt, falls es installiert ist.

## Konsequenzen

**Positiv**

- Keine Build-Toolchain, kein `electron-rebuild`, kein ABI-Risiko beim Paketieren.
- Kleinerer Installer, reproduzierbarer Build auf jedem Rechner.
- Echtes SQLite (3.53) mit WAL, `VACUUM INTO` für konsistente Backups und Fremdschlüsseln.

**Negativ / Auflagen**

- `node:sqlite` ist in Node als experimentell markiert (Warnung beim Start unter Node; unter
  Electron nicht sichtbar). Die API ist seit Node 24 stabil, wird aber beobachtet.
- Alle Abfragen verwenden **ausschließlich positionale Parameter** (`?`) und primitive Werte
  (Boolesche Werte als 0/1), damit beide Treiber austauschbar bleiben.
- Transaktionen laufen über explizite `BEGIN IMMEDIATE` / `SAVEPOINT`-Steuerung im Port.

## Rückfallweg

Sollte `node:sqlite` künftig Probleme bereiten, genügt `npm install better-sqlite3` plus
`electron-builder install-app-deps` — der Port nutzt es dann automatisch, ohne Codeänderung.

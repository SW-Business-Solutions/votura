# Architektur

## Leitgedanke

Die Priorität ist in dieser Reihenfolge: Zuverlässigkeit, Wahlgeheimnis, Nachvollziehbarkeit,
Offlinefähigkeit, Drucksicherheit, Bediengeschwindigkeit, Optik. Wo eine einfache lokale Lösung
ausreicht, wird sie einer verteilten vorgezogen — es gibt keinen Server, keine Queue, keinen Cache
und keine Cloud.

## Prozesse und Fenster

```
Electron Main (Node 24)
├── Datenbank (node:sqlite, WAL)
├── Dienste: Auth, Events, Rounds, Candidates, Ballots, Printing,
│             Accounting, Results, Audit, Projection, Export, Backup, Preflight
├── Druckertreiber: Epson ePOS | ESC/POS RAW | Windows-Spooler | Datei
├── Projektionsdienst  ──► Netzwerkserver (SSE, optional, read-only)
│
├── Operator-Fenster  (preload/index.ts)    interaktiv, vollständige Bedienung
└── Audience-Fenster  (preload/audience.ts) read-only, Vollbild auf dem Beamer
```

Beide Renderer laufen mit `contextIsolation: true`, `nodeIntegration: false` und `sandbox: true`.
Der Renderer erreicht das Main ausschließlich über eine Whitelist typisierter Methoden
(`src/shared/ipc.ts`); die Audience-Brücke kennt nur zwei lesende Operationen.

## Schichten

| Schicht | Ort | Aufgabe |
|---|---|---|
| Domäne (geteilt) | `src/shared` | Typen, Verfahrensregeln, Stimmzettel-Erzeugung, Validierung, Bilanz, Ergebnislogik |
| Dienste | `src/main/services` | Persistenz, Rechte, Audit, Statusmaschine |
| Ausgabe | `src/main/printing`, `src/main/export` | ESC/POS, ePOS-XML, Vorschau, PDF, ZIP |
| Oberfläche | `src/renderer` | Operator-UI und Projektion |

Der Ordner `src/shared` ist bewusst frei von Node- und Electron-APIs: dieselben Funktionen erzeugen
Bildschirmvorschau, Druckvorlage und Hash — eine zweite, abweichende Darstellung kann es nicht geben.

## Datenmodell (Auszug)

- `events` — Veranstaltung inkl. dokumentierter Wahlordnung (`rule_set_json`)
- `rounds` — Wahlgang mit `purpose` (Zweck) und `procedure` (Verfahren), `ballot_version`,
  `approved_version`, Template-Konfiguration, Positionen, Reihenfolgemodus
- `candidates` — Kandidaten/Optionen, `withdrawn` statt Löschung
- `ballot_versions` — unveränderlicher Snapshot je Version inkl. SHA-256-Hash
- `print_batches` — Druckaufträge mit `idempotency_key` (unique), übermittelte und physisch
  bestätigte Mengen, Status
- `accounting` — manuell dokumentierte Mengen (ausgegeben, Ersatz, zurückgenommen, unbenutzt, Urne)
- `results` — Ergebnis mit Erfassung und getrennter Bestätigung
- `audit` — append-only, `previous_hash` + `entry_hash`
- `projection_state`, `projection_history` — Beamerzustand über Neustarts hinweg

**Nicht vorhanden und nicht vorgesehen:** jede Tabelle oder Spalte, die eine Person mit einem
Stimmzettel verknüpft.

## Zustandsmaschine des Wahlgangs

```
draft → candidate_collection → ready → printing → open → counting → completed
                     ▲            │                                   
                     └────────────┘  Entsperren (mit Begründung, erzeugt neue Version)
```

`completed` und `cancelled` sind Endzustände. Der Druck ist nur zulässig, wenn
`approved_version === ballot_version`; das Eröffnen setzt dasselbe voraus.

## Druckweg

```
BallotDocument ──► PrintOp[] ──┬─► ESC/POS-Bytes  ──► Netzwerk / Windows-Spooler
                               ├─► ePOS-XML       ──► Epson-HTTP-Schnittstelle
                               └─► Textzeilen     ──► Bildschirmvorschau / Datei
```

Ein Exemplar ist ein vollständiger, abgeschlossener Auftrag mit anschließendem Schnitt — Kandidaten
können nie über zwei Stimmzettel verteilt werden. Nach jedem Exemplar wird der Zähler in der
Datenbank fortgeschrieben, sodass ein Absturz keinen ungezählten Stapel hinterlässt.

## Fehlerverhalten beim Druck

| Situation | Verhalten |
|---|---|
| Treiberfehler mitten im Stapel | Abbruch, Status `unknown`, kein Retry, Aufforderung zur physischen Prüfung |
| Bediener bricht ab | Status `aborted`, Audit-Eintrag, bereits übermittelte Menge bleibt gezählt |
| Programmabsturz | Beim Neustart werden laufende Aufträge auf `unknown` gesetzt und abgefragt |
| Doppelklick / erneuter Aufruf | Idempotency-Key verhindert den zweiten Stapel |

## Projektion

Der Projektionsdienst erzeugt aus Domänendaten reduzierte DTOs. Sobald eine Stimmzettelversion
freigegeben ist, stammen die angezeigten Kandidaten aus deren Snapshot — Beamer und Papier zeigen
zwingend dieselbe Liste. Ergebnisse werden erst nach Bestätigung projiziert; nach einem Neustart
startet der Beamer neutral, statt ungefragt ein Ergebnis erneut zu zeigen.

## Sicherheit

- Passwörter und PINs: scrypt (RFC 7914) mit zufälligem Salt, Vergleich in konstanter Zeit
- Rollen mit feingranularen Rechten, Prüfung ausnahmslos im Main-Prozess
- Sitzungszeitlimit, optional PIN für Massendruck und Ergebnisbestätigung, optionales
  Vier-Augen-Prinzip
- Content-Security-Policy ohne externe Quellen, Navigation und neue Fenster blockiert
- Netzwerkansicht standardmäßig aus, nur GET-Endpunkte, optionales Token

## Tests

- `tests/election.test.ts` — Kennungen, Verfahrensprofile, Validierung, Reihenfolge, Statusmaschine
- `tests/ballot.test.ts` — Stimmzettelaufbau je Verfahren, Hash-Stabilität
- `tests/accounting-result.test.ts` — Bilanz, Plausibilität, Rangfolge, Feststellungsvorschläge
- `tests/printing.test.ts` — ESC/POS-Kodierung, Bon-Layout, ePOS-XML
- `tests/integration.test.ts` — vollständiges Abnahmeszenario gegen die echten Dienste

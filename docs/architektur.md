# Architektur

Votura verwaltet Wahlgänge und druckt Stimmzettel, bespielt bis zu vier Anzeigeflächen im Saal und
führt das Pult vorn — alles in einer Anwendung, auf einem Rechner, ohne Netz nach außen. Dieses
Dokument beschreibt, wie das zusammenhängt und warum es so und nicht anders gebaut ist.

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
├── Audience-Fenster  (preload/audience.ts) read-only, Vollbild auf dem Beamer
└── Prompter-Fenster  (preload/prompter.ts) Vortragssteuerung, kennt nur „blättern"
```

Alle drei Renderer laufen mit `contextIsolation: true`, `nodeIntegration: false` und
`sandbox: true`. Der Renderer erreicht das Main ausschließlich über eine Whitelist typisierter
Methoden (`src/shared/ipc.ts`); die Audience-Brücke kennt nur zwei lesende Operationen, die
Prompter-Brücke zusätzlich genau eine schreibende: die Foliennummer.

Der Prompter ist ein eigenes Fenster und keine Seite im Operator-Fenster, weil er von den
Pfeiltasten lebt — dort sind sie für Listen vergeben.

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

### Bühnen

Der Dienst hält nicht einen Zustand, sondern einen **je Bühne** (`Map<number, ProjectionState>`).
Jede Funktion nimmt die Bühne als ersten Parameter; Bühne 1 ist die Hauptbühne und lässt sich nicht
abbauen.

```
Bedienoberfläche ──► IPC (…, stage) ──► projection.ts   Map<buehne, ProjectionState>
                                             │
                     ┌───────────────────────┼───────────────────────┐
                     ▼                       ▼                       ▼
              Beamerfenster 1         Beamerfenster 2          SSE  /b/2
              audience.html?buehne=1  ?buehne=2                (nur diese Bühne)
```

- **Wer folgt dem Wahlgang:** `projectDomainEvent()` schaltet nur Bühnen mit `followsRound`. Ohne
  diese Unterscheidung zeigten alle Flächen zwangsläufig dasselbe — und mehrere hätten keinen Zweck.
- **Der Master** ist die Bühnennummer `0` (`ALLE_BUEHNEN`). Er hat keinen Zustand, kein Fenster und
  keine Adresse: `aufBuehnen()` in `src/main/ipc.ts` führt die Aktion auf jeder Bühne aus und gibt
  die Antwort der Hauptbühne zurück. Die Fallunterscheidung liegt damit an genau einer Stelle,
  nicht in jedem Aufruf der Oberfläche.
- **Wahl der Bühne:** lokale Fenster über die Bildschirmwahl, Geräte im Netz über die Adresse
  (`/b/2` leitet auf `/?buehne=2` weiter, damit alle Dateipfade relativ bleiben). In beiden Fällen
  liest die Ansicht ihre Bühne aus der Suchzeile — es gibt nur eine Stelle dafür.
- **Ablage:** `projection_state` enthält seit 0.14 `{ buehnen, zustaende, currentRoundId }`. Die
  ältere Form mit einem einzelnen `state` wird beim Lesen weiterhin erkannt.

> **Preloads bleiben importfrei.** Audience- und Prompter-Preload laufen in der Sandbox und dürfen
> keinen zweiten Baustein nachladen. Ein **Wert** aus einem gemeinsamen Modul wird beim Bauen zu
> `require('./chunks/…')`, das Preload lädt dann gar nicht, und die Beameransicht meldet dauerhaft
> „Verbindung unterbrochen". Reine Typimporte sind erlaubt; ein Test in `tests/buehnen.test.ts`
> wacht darüber.

## Teleprompter

Ein eigener Dienst (`src/main/services/prompter.ts`), **nicht** Teil des Projektionsdienstes: Der
Prompter ist keine Bühne. Er zeigt genau das, was das Publikum nicht sehen soll — ein gemeinsamer
Zustand wäre eine Gelegenheit, beides zu verwechseln. Ein Test wacht darüber, dass der Dienst den
Projektionsdienst nicht einmal importiert.

```
Bedienung ──► IPC prompter.* ──► prompter.ts   PrompterViewState
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
      Prompterfenster          Operatoransicht        SSE  /prompter
      (preload/teleprompter)                          /api/prompter/stream
```

- **Der Lauf hängt an der Uhr** — `position` (in Zeilenhöhen), `anchoredAt`, `tempo`. Jede Ansicht
  rechnet ihre Stelle mit `prompterPosition()` selbst aus; ein spät hinzugekommenes Gerät steht
  sofort richtig. Dieselbe Überlegung wie beim Video.
- **Zeilenhöhen statt Pixel:** Telefon, Tablet und Pultmonitor haben verschiedene Flächen und
  Schriftgrößen. In Pixeln stünde jedes woanders im Text.
- **Verankern vor jeder Tempoänderung.** Wer das Tempo ändert, ohne vorher die aktuelle Stelle
  festzuhalten, lässt alle Geräte die verstrichene Zeit mit dem *neuen* Tempo neu rechnen — die
  Rede rutscht dann um Minuten. Änderungen an der reinen Darstellung verankern deshalb bewusst
  **nicht** und lassen `anchoredAt` unangetastet.
- **Reden** liegen als Markdown neben der Datenbank (`speeches/`), Verzeichnis als JSON daneben —
  wie bei Präsentationen und Videos. `redeBloecke()` zerlegt nur, was in einer Rede vorkommt:
  Überschrift, Absatz, Punkt, Zitat, Atempause. Eine vollständige Markdown-Bibliothek brächte
  Tabellen, Bilder und HTML mit; nichts davon liest jemand am Pult vor.
- **Der Text wandert im Zustand mit.** Anders als Foliensatz und Video ist er klein, und die
  Ansicht am Pult soll nichts nachladen müssen.

## Votura Saal — die Begleitanwendung

Zweiter Einstiegspunkt (`src/saal/index.ts`) aus **derselben Quelle**, eigenes Paket
(`electron-builder-saal.yml`, `extraMetadata.main`). Sie zeigt die Seiten des Hauptrechners an und
baut nichts nach — zwei getrennte Projekte liefen bei der ersten Änderung an einem DTO
auseinander.

```
Saalgerät                                  Hauptrechner
  Suchruf  ──UDP 8478──►  „VOTURA-SUCHE/1"
           ◄──────────── { Name, Port, Bühnen, tokenNoetig }
  Anzeige  ──HTTP 8477──►  /?buehne=2   bzw.  /prompter
                            /sprachmodell, /api/prompter/*
```

- **Warum es sie gibt:** `getUserMedia` verlangt eine sichere Herkunft; der Projektionsserver
  spricht HTTP. Die Anwendung führt die **eine** eingetragene Adresse als sicher
  (`unsafely-treat-insecure-origin-as-secure`) — eine bewusste Zusage an einen Rechner, nicht an
  das Netz. Damit steht dem Prompter am Pult das Mikrofon zur Verfügung.
- **Warum ein Neustart nach der Einrichtung:** Diese Zusage muss vor dem Start von Chromium
  feststehen. Einmal sichtbar neu starten ist ehrlicher, als eine halbe Sitzung mit einem Mikrofon
  zu verbringen, das nicht geht.
- **Warum kein mDNS:** Ein Ruf ins Netz und die Antworten einsammeln ist in dreißig Zeilen erklärt
  und trägt in jedem flachen Netz — und ein Saalnetz ist immer flach. Ein Dienstverzeichnis brächte
  eine Abhängigkeit und ein zweites Protokoll, das genauso ausfallen kann.
- **Warum kein Token in der Antwort:** Wer den Ruf hört, ist im selben Netz, mehr nicht. Es
  mitzuschicken hieße, es an jeden zu verteilen, der fragt. Gesagt wird nur, **ob** eines nötig ist.
- **Rechte:** Mikrofon nur für die Rolle *Prompter* und nur gegenüber der eingetragenen Herkunft;
  keine Navigation nach außen, keine neuen Fenster.

## Ergebnis, Rangfolge und Gleichstand

Die Rangfolge entsteht in `rankCandidates()` (`src/shared/result.ts`) — als reine Funktion, damit
Oberfläche, Bon, Beameransicht und Export **dieselbe** Reihenfolge zeigen und sie sich ohne
Browser prüfen lässt.

```
compareResults(a, b)
  Akzeptanzverfahren → Ja absteigend, bei Gleichstand Nein aufsteigend
  sonst              → Stimmen absteigend
  Enthaltungen zählen nie mit
```

Drei Festlegungen tragen das:

- **Bedingung vor Zahl.** Wer die Bedingung des Verfahrens nicht erfüllt — bei der Akzeptanzwahl
  „mehr Ja als Nein" —, steht hinter allen anderen, auch bei freien Plätzen und hoher Ja-Zahl.
- **Offene Ränge werden benannt, nicht geraten.** Trennt kein Kriterium mehr, teilen sich beide
  denselben Rang und tragen `tied`. Die Sortierung fällt danach zwar auf den Namen zurück, aber
  nur, damit die Liste stabil bleibt — als Entscheidung gilt das ausdrücklich nicht.
- **Der Beschluss der Versammlung zählt zuletzt.** `decidedOrder` (im Ergebnis als `rankOrder`,
  Migration 5) greift erst, wenn `compareResults` nichts mehr hergibt. Eine eingetragene
  Reihenfolge kann damit niemanden an Bewerbern mit mehr Stimmen vorbeiziehen.

Gleichstehende tragen zusätzlich eine `tieGroup` — den Rang, bei dem ihre Gruppe beginnt. Die
Bedienung schreibt beim Umreihen **nur diese Gruppe** fest; ohne die Kennung galten bei mehreren
Gleichständen nach einem Klick alle als entschieden.

## Vorstellung mit Redezeit

Der Modus `speaker` trägt im Zustand einen **Zeitpunkt**, keine Restdauer:

```ts
speaker: { name, note?, until?, totalSeconds?, pausedSecondsLeft? }
```

Jedes Gerät rechnet den Rest über `redezeitRest()` selbst aus. Eine heruntergezählte Zahl im
Zustand müsste mehrmals je Sekunde durch alle SSE-Leitungen, und ein Bildschirm, der später
dazukommt, hätte keinen Anhalt. Dieselbe Überlegung wie bei der Pause (`breakUntil`) und beim
Video (`anchoredAt`).

`pausedSecondsLeft` hält die Uhr an, ohne die Vorstellung zu beenden — für eine Zwischenfrage.
Negative Reste werden **nicht** abgeschnitten: Eine überzogene Redezeit soll sichtbar bleiben,
nicht bei null stehen.

`upcoming` trägt die Reihe der Folgenden, `upcomingShown` wie viele davon der Beamer zeigt. Die
Reihe wird **nicht gepflegt**, sondern beim Aufruf aus der Kandidatenliste abgeleitet: Vorgestellt
wird in der Reihenfolge des Stimmzettels, und die steht dort bereits. `nextSpeaker()` schiebt sie
weiter und setzt die Uhr auf `totalSeconds` zurück — der Zusatz gehörte zur vorigen Person und
wird nicht mitgeschleppt.

## Präsentationen

Zwischen den Wahlgängen wird geredet. Eine eingespeiste **HTML-Präsentation** läuft im selben
Beamerfenster und derselben Netzwerkansicht; ein Tastendruck bringt den Wahlgang zurück.

```
Import (Dateidialog) ──► Kopie in <Datenordner>/presentations/<id>.html
                         Verzeichnis daneben als index.json

Beamerfenster ──► votura-presentation://…  (Protokoll-Handler, nur die laufende Datei)
Netzwerkansicht ──► /presentation.html     (derselbe Server, nur die laufende Datei)
Prompter ──► IPC „blättern" ──► ProjectionState.presentation.slide ──► beide Ansichten
```

Drei Festlegungen tragen das:

- **Die Datei geht nie durch den Zustand.** `ProjectionState` trägt nur Kennung, Titel und
  Folienstand; er wandert bei jedem Folienwechsel durch alle SSE-Leitungen. Das Dokument wird
  einmal geladen, danach bewegt sich nur eine Zahl.
- **Fremder Code bleibt eingesperrt.** Der `<iframe>` bekommt `sandbox="allow-scripts"` **ohne**
  `allow-same-origin` — undurchsichtige Herkunft, kein `window.parent`, keine Preload-Brücke,
  kein Zugriff auf Wahldaten. Die einzige Verbindung ist `postMessage` mit einer Foliennummer.
- **Eigene, engere CSP.** Die Anwendungsregel verbietet Inline-Skripte; eine Präsentation als
  Einzeldatei besteht daraus. Sie bekommt deshalb eine eigene Richtlinie — mit
  `script-src 'unsafe-inline'`, aber ohne `connect-src`: Sie kann nichts nachladen und nichts
  melden (§2.2).

Ausgeliefert wird ausschließlich die Datei, die **gerade projiziert wird** — nicht jede aus der
Bibliothek. Sonst könnte jedes Gerät im Netz eine noch ungezeigte Präsentation abrufen, indem es
Kennungen durchprobiert.

**PDF als zweite Art.** Ein Eintrag trägt `kind: 'html' | 'pdf'`; fehlt das Feld, gilt HTML — so
bleiben Einträge aus älteren Fassungen gültig. Nach außen verhalten sich beide gleich, nämlich als
durchnummerierte Folien: derselbe Zustand, dieselbe Vortragssteuerung, dieselbe Netzwerkansicht.

Ein PDF wird nicht eingebettet, sondern mit pdf.js auf eine Leinwand **gezeichnet**. Ein
eingebetteter Betrachter brächte Werkzeug- und Blätterleiste mit, die der Saal nicht sehen soll,
und keinen verlässlichen Weg, die Seite von außen zu setzen. Drei Eigenheiten gehören dazu:

- pdf.js läuft **ohne Arbeiterprozess**. Die Anwendung wird aus `file://` geladen; ein Worker von
  dort hat eine undurchsichtige Herkunft und wird abgewiesen. Der Arbeiter-Bau bringt seinen
  Nachrichtenbehandler auch als gewöhnliches Modul mit — liegt er unter `globalThis.pdfjsWorker`,
  rechnet pdf.js im Hauptstrang.
- Das Schema ist `corsEnabled`, und die Antwort trägt `Access-Control-Allow-Origin`. pdf.js holt
  das Dokument per XHR, und ein eigenes Schema gilt vom `file://`-Ursprung aus als fremde Herkunft.
- Gemessen wird mit `clientWidth`, nicht mit `getBoundingClientRect()`. In der Vortragssteuerung
  sitzt der Rahmen in einem Kasten, der per `transform` verkleinert wird; das Rechteck lieferte
  die bereits geschrumpften Maße.

## Video

Ein Film zwischen zwei Wahlgängen läuft auf Beamer **und** Netzwerkansicht gleichzeitig und mit
demselben Stand.

```
Import (Dateidialog) ──► Kopie in <Datenordner>/videos/<id>.<endung>
                         Verzeichnis daneben als index.json

Beamerfenster   ──► votura-video://…   (Protokoll-Handler, Bereichsanfragen)
Netzwerkansicht ──► /video?v=<id>      (derselbe Server, Bereichsanfragen)
Bedienung ──► IPC „abspielen/springen" ──► ProjectionState.video ──► alle Ansichten
Beameransicht ──► IPC „Laufzeit/bereit/Ende" ──► ProjectionState.video
```

Vier Festlegungen tragen das:

- **Eine Uhr statt Befehlen.** `ProjectionState.video` trägt `position` **und** `anchoredAt` — die
  Position zu einem genannten Zeitpunkt. Jedes Gerät rechnet daraus seinen Sollstand aus; ein
  Nachzügler braucht keinen Sonderweg und hat keine Nachricht verpasst. Ein Befehl („jetzt
  abspielen") hätte genau die nicht erreicht, die ihn verpasst haben.
- **Nachführen statt springen.** `berechneGleichlauf()` in `src/shared/video.ts` entscheidet:
  unter 0,08 s in Ruhe lassen, bis 0,75 s über die Abspielgeschwindigkeit ausgleichen (höchstens
  ±2 %), darüber springen. Die Rechnung ist eine reine Funktion — prüfbar ohne Browser und an
  jeder Stelle gleich.
- **Bereichsanfragen.** Beide Wege liefern mit `Accept-Ranges: bytes` aus und beantworten `Range`
  mit `206` samt `Content-Range`. Ohne das müsste jedes Gerät die ganze Datei laden, bevor es
  etwas zeigt. Das eigene Schema braucht dafür `stream: true`; sonst behandelt Chromium die
  Antwort als ein Stück.
- **Ton nur im Beamerfenster.** Die Netzwerkansicht läuft stumm. Zehn Geräte im Chor sind
  unerträglich, und schon Millisekunden Versatz klingen wie ein Echo.

Die Beameransicht ist rein lesend (§31) und hat genau **eine** Nachricht nach außen: Laufzeit,
Pufferstand, Ende erreicht. Das durchbricht die Regel nicht — sie sagt etwas über sich selbst aus,
nicht über die Wahl. Ohne diesen Weg bliebe die Laufzeit unbekannt, denn sie steckt im
Containerformat und lässt sich nur dort ablesen, wo die Datei geladen wurde.

Angenommen werden MP4 (H.264/AAC) und WebM — was jedes Chromium ohne Zusatzpaket abspielt. Wie bei
der Präsentation wird ausschließlich die Datei ausgeliefert, die **gerade projiziert wird**.

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

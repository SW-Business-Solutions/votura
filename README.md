# Votura

Offline-Desktopanwendung zur Verwaltung von Wahlgängen und zum Druck papierbasierter
Stimmzettel auf Thermodruckern — mit Beamer-/Publikumsansicht für Mitgliederversammlungen.

> **Das System ist kein elektronisches Wahlsystem.** Die Stimme existiert ausschließlich auf dem
> anonymen Papier-Stimmzettel. Die Software kennt Wahlgang, Kandidaten, Stückzahlen und Ergebnis —
> sie kennt **nicht**, wer welchen Stimmzettel ausgefüllt hat.

![Übersicht einer laufenden Versammlung](docs/screenshots/01-uebersicht.png)


## Überblick

| Bereich | Umsetzung |
|---|---|
| Plattform | Electron 43 (Chromium + Node 24), React 19, TypeScript |
| Datenhaltung | SQLite über `node:sqlite` (WAL), lokal im Benutzerprofil |
| Druck | ESC/POS; Epson ePOS-Print (LAN/XML), RAW-Netzwerk (9100), Windows-Spooler (USB), Dateiausgabe |
| Beamer | Zweites, rein lesendes Fenster + optionale Netzwerkansicht im Browser |
| Betrieb | Vollständig offline: keine Cloud, keine Telemetrie, keine externen Schriften |
| Installation | Windows-Installer (NSIS) und portable Fassung |

## Herunterladen

Fertige Windows-Fassungen liegen unter [Releases](../../releases):

- `Votura-<version>-x64-Setup.exe` — Installer
- `Votura-<version>-x64-portable.exe` — ohne Installation lauffähig

Die Dateien sind nicht signiert; Windows SmartScreen meldet sich daher beim ersten Start
(„Weitere Informationen" → „Trotzdem ausführen").

## Schnellstart (Entwicklung)

```bash
npm install
npm run dev          # Anwendung mit Hot Reload starten
npm test             # 130 Unit- und Integrationstests
npm run typecheck    # Typprüfung für Main-, Preload- und Renderer-Code
npm run build        # Produktionsbundle nach out/
npm run dist:win     # Windows-Installer und portable EXE nach release/
```

Die Installationsdateien liegen anschließend unter `release/`:

- `Votura-<version>-x64-Setup.exe` — Installer mit Desktop- und Startmenü-Verknüpfung
- `Votura-<version>-x64-portable.exe` — ohne Installation lauffähig (z. B. vom USB-Stick)

## Ablauf einer Versammlung

```
Veranstaltung anlegen → Wahlgang (Wizard) → Kandidaten → Liste schließen →
Druckvorschau → Prüfliste → Freigabe → Massendruck → Stimmabgabe auf Papier →
manuelle Auszählung → Ergebnis erfassen → Feststellung bestätigen → Wahlgang abschließen
```

Die Beameransicht folgt diesen Schritten automatisch; Ergebnisse erscheinen dort erst nach
ausdrücklicher Bestätigung durch die Wahlleitung.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/07-kandidaten.png" alt="Kandidatenerfassung"><br><sub><b>Kandidaten</b> — erfassen, sortieren, nummerieren; die Liste wird vor der Freigabe geschlossen.</sub></td>
<td width="50%"><img src="docs/screenshots/08-wahlzettel-vorschau.png" alt="Stimmzettelvorschau mit Freigabe"><br><sub><b>Stimmzettel</b> — zeichengetreue Vorschau des Bons, Prüfliste und Freigabe mit SHA-256-Hash.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/09-druck.png" alt="Druckauftrag"><br><sub><b>Druck</b> — Stückzahl, Drucker und Testdruck; jeder Auftrag wird protokolliert.</sub></td>
<td width="50%"><img src="docs/screenshots/10-ergebnis.png" alt="Ergebniserfassung"><br><sub><b>Ergebnis</b> — Auszählung erfassen, Plausibilität prüfen, Feststellung durch die Wahlleitung.</sub></td>
</tr>
</table>

## Wahlverfahren

Wahlzweck (`purpose`) und Wahlverfahren (`procedure`) sind strikt getrennt: Aus „Delegiertenwahl"
folgt kein Verfahren — das beschließt die Versammlung. Unterstützt sind 16 Verfahren, darunter Einzelwahl (ein/mehrere Bewerber), Stichwahl, verbundene Einzelwahl,
Gruppenwahl (vorgedruckt und blanko), Akzeptanzverfahren, Zwei-Stufen-Wahl (Stufe 1, Stufe 2 als
Einzelplatz oder Block), Sachabstimmungen und die offene Abstimmung ohne Stimmzettel.

## Sicherheitszusagen (technisch durchgesetzt)

- **Kein Personenbezug:** Es existiert keine Datenstruktur, die eine Person mit einem Stimmzettel
  verbindet. Ausgabe, Ersatz und Rücknahme werden ausschließlich als Mengen dokumentiert.
- **Keine Einzelkennung:** Alle Stimmzettel eines Wahlgangs sind identisch und tragen dieselbe
  Wahlgangkennung — keine Seriennummern, keine Codes je Zettel.
- **Freigabe vor Druck:** Ohne freigegebene Version verweigert der Druckdienst den Auftrag.
- **Versionierung:** Jede druckrelevante Änderung nach der Freigabe erzeugt eine neue Version;
  die alte bleibt mit SHA-256-Hash archiviert.
- **Keine automatische Wiederholung:** Ein abgebrochener oder unklarer Druckauftrag wird nie
  automatisch neu gedruckt; die tatsächliche Menge wird physisch geprüft und dokumentiert.
- **Idempotenz:** Ein identischer Druckauftrag (Idempotency-Key) wird nicht doppelt ausgeführt.
- **Ehrliche Zählung:** Gezählt wird, was an den Drucker übermittelt wurde. „Physisch gedruckt"
  behauptet die Anwendung erst nach menschlicher Bestätigung.
- **Audit-Trail:** Append-only mit Hash-Kette; nachträgliche Änderungen werden erkannt.
- **Unveränderbarkeit:** Abgeschlossene Wahlgänge sind im normalen Betrieb gesperrt.
- **Beamer read-only:** Die Publikumsansicht besitzt keine Schreib-API und erhält nur reduzierte
  Anzeige-DTOs — keine IDs, Hashes oder internen Notizen.

## Nachvollziehbarkeit

<table>
<tr>
<td width="50%"><img src="docs/screenshots/04-audit-trail.png" alt="Audit-Trail"><br><sub><b>Audit-Trail</b> — jede Handlung mit Zeit, Person und Begründung, als Hash-Kette gesichert.</sub></td>
<td width="50%"><img src="docs/screenshots/05-systemcheck.png" alt="Systemcheck"><br><sub><b>Systemcheck</b> — Drucker, Papier, Speicherplatz und Datenbank vor der Versammlung prüfen.</sub></td>
</tr>
</table>

## Drucker

Zielklasse: 80 mm, 203 dpi, Auto-Cutter, ESC/POS. Vier Anbindungen stehen zur Wahl:

1. **Epson ePOS-Print** (empfohlen bei Epson-Netzwerkgeräten): Epsons eigene XML-Schnittstelle über
   HTTP im LAN. Liefert als einzige Anbindung echten Gerätestatus (Papier, Abdeckung, Cutter).
2. **ESC/POS RAW** über Port 9100 für beliebige Netzwerk-Thermodrucker.
3. **Windows-Spooler (RAW)** für USB-Drucker mit installiertem Epson-Treiber.
4. **Dateiausgabe** als Ersatzweg ohne Drucker (Textfassung + ESC/POS-Rohdaten).

Alle Layoutparameter (Breite, Zeichen je Zeile, Zeichentabelle, Cutter, Vorschub) sind je Drucker
konfigurierbar.

## Beameransicht

![Ergebnis auf dem Beamer](docs/screenshots/11-beameransicht.png)

Die Publikumsansicht kennt eigene Bilder für Begrüßung, Tagesordnung, Kandidatenvorstellung,
laufende Wahl, Auszählung, Ergebnis, Pause mit Countdown und freie Mitteilungen. Farben, Logo und
Schriftgröße sind einstellbar; lange Listen blättern seitenweise um, und die Anzeige misst nach
jedem Wechsel nach, ob alles ins Bild passt.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/03-beamersteuerung.png" alt="Beamersteuerung"><br><sub><b>Steuerung</b> — Bild wählen, Vorschau, Netzwerkansicht und Sperre während laufender Wahl.</sub></td>
<td width="50%"><img src="docs/screenshots/02-tagesordnung.png" alt="Tagesordnung"><br><sub><b>Tagesordnung</b> — vorab anlegen, frei sortieren, Anträge dazwischenschieben.</sub></td>
</tr>
</table>

## Netzwerkbetrieb

Zwei getrennt schaltbare Funktionen, beide standardmäßig **deaktiviert** und nur für ein
abgeschottetes Veranstaltungsnetz vorgesehen:

- **Beameransicht im Browser** (`/`) — ausschließlich lesende Endpunkte, Server-Sent-Events,
  optionales Zugriffstoken.
- **Bedienung von einem zweiten Gerät** (`/operator`) — Anmeldung mit einem lokalen Konto, gleiche
  Rollen und Rechte, gleiche Audit-Zuordnung. Jeder Aufruf läuft im Sitzungskontext des
  angemeldeten Benutzers; Systemdialoge des Hauptrechners sind gesperrt. Details und Grenzen:
  `docs/adr/0005-fernzugriff-im-veranstaltungsnetz.md`.

## Datenablage

```
%APPDATA%\Votura\
  data\wahlzettel.sqlite   Datenbank (WAL)
  exports\                 PDF-, CSV-, JSON-Exporte und Archivpakete
  logs\application.log     technische Logs (getrennt vom Audit-Trail)
  logs\printer.log         Druckerprotokoll
```

Backups (konsistente Datenbankkopie, Konfiguration, Audit-Export, Exporte) landen standardmäßig
unter `Dokumente\Votura-Backups`; ein zweites Ziel (z. B. USB-Stick) ist konfigurierbar.

## Rechtlicher Hinweis

Die Anwendung unterstützt die organisatorische Durchführung einer Wahl. Sie ersetzt weder
Wahlleitung noch Satzung oder Wahlordnung und trifft keine rechtliche Entscheidung über die
Gültigkeit einer Wahl. Vor jedem Einsatz ist zu prüfen, welche Wahlordnung für die konkrete
Gliederung gilt; die zugrunde gelegte Fassung wird je Veranstaltung dokumentiert.

## Lizenz

Noch keine Lizenz vergeben — es gelten die gesetzlichen Vorgaben (alle Rechte vorbehalten).
Wer den Code nutzen möchte, wendet sich bitte an den Autor.

## Dokumentation

- `docs/architektur.md` — Aufbau, Schichten, Datenmodell
- `docs/betrieb.md` — Betriebshandbuch für die Versammlung
- `docs/adr/` — Architekturentscheidungen mit Begründung

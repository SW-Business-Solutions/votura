# Betriebshandbuch

## Vor der Versammlung

1. **Installieren:** `Votura-<version>-x64-Setup.exe` ausführen (keine Administratorrechte
   nötig, Installation je Benutzer). Alternativ die portable Fassung vom USB-Stick starten.
2. **Konten anlegen:** Beim ersten Start ein Administratorkonto anlegen, danach unter
   *Einstellungen → Benutzer* Konten für Wahlleitung, Wahlkommission und Protokoll ergänzen.
3. **PIN setzen:** Unter *Einstellungen → Allgemein* eine Wahlleiter-PIN hinterlegen, wenn
   Massendruck und Ergebnisbestätigung PIN-geschützt sein sollen (Standard: ja).
4. **Drucker einrichten:** *Einstellungen → Drucker*. Für Epson-Netzwerkgeräte „Epson ePOS-Print"
   mit IP wählen, für USB-Geräte „ESC/POS über Windows-Druckertreiber" mit dem exakten
   Windows-Druckernamen. Anschließend *Verbindung prüfen*.
5. **Backup-Ziele festlegen:** *Einstellungen → Backup*, möglichst ein zweites Ziel auf USB-Stick.
6. **Systemcheck ausführen:** Menüpunkt *Systemcheck*. Alle Punkte prüfen, insbesondere Drucker,
   Testdruck, Zeitzone und Backup-Verzeichnis.
7. **Testdruck:** Im Wahlgang unter *Drucken → Testdruck*. Der Testdruck ist oben und unten
   unübersehbar als ungültig gekennzeichnet und muss sofort vernichtet werden.
8. **Offline prüfen:** Netzwerkkabel ziehen bzw. WLAN abschalten und einen Testdurchlauf machen —
   die Anwendung benötigt keinerlei Internetverbindung. (Für Netzwerkdrucker und die
   Netzwerk-Beameransicht ist ein lokales Netz nötig, kein Internet.)

## Hardware vor Ort

- 1 Haupt-PC, 1 Ersatz-PC (mit installierter Anwendung)
- 1 Hauptdrucker, 1 Ersatzdrucker, ausreichend Thermorollen
- 2 USB-Sticks für wechselnde Backups
- USV oder Notebook-Akkubetrieb
- Beamer/Bildschirm am zweiten Grafikausgang

## Tagesordnung vorbereiten

Unter *Tagesordnung* (Strg+T) legen Sie die Punkte vorab an — auch reine Tagesordnungspunkte ohne
Wahlgang (z. B. „Bericht des Vorstands"). Wahlgänge erscheinen automatisch in der Liste.

- **Verschieben:** per Ziehen oder mit den Pfeiltasten in der Zeile.
- **Einschieben:** beim Hinzufügen die Position „vor …" wählen — so kommt ein Änderungsantrag genau
  zwischen zwei Anträge.
- **Abhaken:** erledigte Punkte markieren; der erste offene Punkt gilt als aktueller.
- **Anzeigen:** „Auf Beamer zeigen" projiziert die vollständige Tagesordnung mit hervorgehobenem
  aktuellem Punkt.

Ein vorbereiteter Wahlgang bekommt **erst beim Start** seine Nummer und Wahlgangkennung. Bis dahin
lässt sich die Reihenfolge gefahrlos ändern, ohne dass Kennungen wandern.

## Ablauf je Wahlgang

1. **Anlegen** (*Neuer Wahlgang*, Strg+N): Zweck wählen, **Verfahren gemäß Beschluss der
   Versammlung** wählen, Positionen und Stimmenzahl festlegen, Kandidaten einfügen (Copy/Paste
   möglich), Parameter prüfen.
2. **Kandidaten** ordnen (manuell, alphabetisch, per Beschluss; Zufall nur auf ausdrückliche
   Anordnung) und ggf. Nummern vergeben.
3. **Liste schließen.** Danach sind Änderungen nur durch Entsperren mit Begründung möglich.
4. **Wahlzettel** prüfen: Druckvorschau lesen, Prüfliste abhaken, **freigeben**.
5. **Drucken:** Stückzahl = Stimmberechtigte + Reserve. Massendruck bestätigen (PIN).
   Den Fortschritt beobachten; bei Abbruch die tatsächliche Menge physisch zählen.
6. **Ausgabe dokumentieren:** Reiter *Stimmzettelbilanz* — ausgegeben, Ersatz, zurückgenommen,
   unbenutzt. Nur Mengen, niemals Namen.
7. **Wahl eröffnen** (Reiter *Verlauf*): Der Beamer zeigt „WAHL LÄUFT".
8. **Stimmabgabe beenden** → Auszählung. Der Beamer zeigt „AUSZÄHLUNG LÄUFT".
9. **Ergebnis erfassen** (Reiter *Ergebnis*), Plausibilitätshinweise prüfen.
10. **Feststellung treffen:** Der rechnerische Vorschlag ist nur ein Vorschlag. Die Wahlleitung
    wählt die öffentliche Feststellung und die als gewählt festgestellten Personen aus.
11. **Ergebnis bestätigen** — erst dadurch wird es auf dem Beamer öffentlich.
12. **Wahlgang abschließen.** Danach im normalen Betrieb unveränderbar.
13. Bei Bedarf **Folgewahlgang** erzeugen (Stichwahl, Wiederholung, Nachwahl, zweiter Wahlgang) —
    mit eigener Kennung und neuer Zettelversion.

## Beamer bedienen

- *Beamer* (Strg+B) → Bildschirm auswählen → *Beamerfenster öffnen*.
- Die Seite ist gegliedert: Die Vorschau steht links fest, rechts liegen **Inhalte**,
  **Präsentation & Video**, **Ausgabe & Netz** und **Verlauf** hinter Reitern.
- **Erscheinungsbild:** unter *Einstellungen → Beamer-Design* Farben wählen und ein Logo hinterlegen
  (wird in die Konfiguration eingebettet, kein Nachladen aus dem Netz).
- **Pause mit Countdown:** entweder *Dauer* in Minuten oder *Bis Uhrzeit* („weiter um 12:30", nach
  der Uhr dieses Rechners). Die Uhrzeit ist bei einer angesagten Pause die bessere Wahl: Sie bleibt
  richtig, auch wenn zwischen Ansage und Anzeigen noch Minuten vergehen. Für die Stimmabgabe gibt
  es bewusst keinen Countdown.
- **Freie Mitteilung:** optional mit oder ohne Wahlgangbezug in der Fußzeile.
- **Sachanträge:** Beschlusstext und Abstimmungsmöglichkeiten werden statt einer Kandidatenliste
  angezeigt.
- **Ergebnis:** standardmäßig vollständig — auch die nicht gewählten Bewerber mit ihrer Stimmenzahl.
- Die Vorschau links zeigt jederzeit exakt das, was öffentlich zu sehen ist.
- Statuswechsel erfolgen automatisch aus dem Wahlgang; manuelle Übersteuerung ist jederzeit möglich
  (Pause, freie Mitteilung, Tagesordnung).
- *Beamer sperren* verhindert ein versehentliches Umschalten **und** hält das automatische
  Weiterblättern an. Bei langen Kandidaten- und Ergebnislisten ist das der Griff, wenn die Anzeige
  auf einer bestimmten Seite stehen bleiben soll — von Hand lässt sich weiter blättern.
- **Automatisch weiter:** unter der Vorschau einstellbar (aus, 8, 15 oder 30 Sekunden). Gilt für
  Kandidaten- und Ergebnisseiten.
- Bei nur einem Bildschirm öffnet das Fenster bewusst im Fenstermodus.
- **Netzwerkansicht** (optional): aktivieren, Port und Token vergeben, angezeigte Adresse am
  Zweitgerät im Browser öffnen. Rein lesend; nur in einem abgeschotteten Veranstaltungsnetz nutzen.

## Rangliste bei mehreren Plätzen

Im Reiter *Ergebnis* steht unter der Feststellung die **Rangliste**: erst die Gewählten in ihrer
Reihenfolge, dann eine Trennlinie, dann die Nichtgewählten. Bei einer Delegiertenwahl ist genau
das die Auskunft, mit der jemand nach vorne geht — wer ist Delegierter, wer Ersatz, in welcher
Folge wird nachgerückt.

Sortiert wird nach den Regeln des Verfahrens:

- **Ankreuzverfahren:** nach Stimmen.
- **Akzeptanzverfahren:** zuerst nach Ja-Stimmen; bei gleicher Ja-Zahl entscheidet die
  **geringere** Zahl an Nein-Stimmen. Enthaltungen bleiben außen vor. Wer mehr Nein als Ja hat,
  steht hinter der Trennlinie — auch dann, wenn ein Platz frei bliebe.

**Bleibt ein Rang offen**, weil zwei Bewerber in beiden Zahlen gleichauf liegen, sagt die
Anwendung das und sortiert **nicht** heimlich nach dem Namen. Die betroffenen Zeilen tragen den
Hinweis *Rang offen* und zwei Pfeile.

So sehen es die meisten Wahlordnungen vor — und so unterstützt Votura es:

1. **Stichwahl** zwischen den Gleichstehenden. Unter *Weiteres Vorgehen → Folgewahlgang erzeugen*;
   die Gleichstehenden sind dort schon ausgewählt.
2. **Losentscheid**, wenn auch die Stichwahl gleich ausgeht. So steht es unter anderem im
   Bundeswahlgesetz (§ 6: „entscheidet das Los").
3. **Verzicht** auf den höheren Platz — der formlose Weg, der in der Praxis am häufigsten
   vorkommt.

Für Verzicht und Losentscheid tragen Sie die Entscheidung mit den Pfeilen **↑ ↓** ein; der
Hinweis *Rang offen* verschwindet dann. Halten Sie im Feld *Losentscheid dokumentieren* fest, wie
es dazu kam — das gehört ins Protokoll. Die eingetragene Reihenfolge hebt niemanden über die
Zahlen hinweg: Sie zählt nur dort, wo sonst nichts mehr trennt.

Die Rangliste lässt sich über *Rangliste auf Bon drucken* sofort ausgeben — derselbe Beleg wie
*Ergebnis auf Bon drucken*, mit Trennlinie zwischen Gewählten und Nichtgewählten und einem
Hinweis, falls ein Rang offen ist.

## Vorstellung mit Redezeit

Unter *Beamer → Inhalte → Vorstellung mit Redezeit*: Ist ein **Bezugswahlgang** gewählt, steht
dort die Liste seiner Bewerber zur Auswahl — abtippen entfällt, und ein Tippfehler steht nicht
groß an der Wand. Für alles andere — Gast, Bericht, Grußwort — gibt es daneben ein freies Feld.
Dazu optional ein Zusatz wie „Bewerbung um den Vorsitz", die Redezeit in Minuten, dann
*Vorstellung anzeigen*.

Der Saal sieht den Namen groß, darunter den Zusatz und die verbleibende Zeit mit Balken. Die
letzten dreißig Sekunden werden gelb, danach zählt die Anzeige **ins Minus weiter** und wird rot —
wer überzieht, soll es sehen, und die Versammlungsleitung auch.

Während der Vorstellung stehen drei Schaltflächen bereit:

- **Anhalten / Weiter** — für eine Zwischenfrage, ohne die Vorstellung zu beenden.
- **+1 Min. / −1 Min.** — der übliche Zuruf „noch eine Minute", ohne die Uhr zurückzusetzen.
- **+10 s / −10 s** — zum Nachjustieren kurz vor Schluss.

Redezeit 0 zeigt nur den Namen, ohne Uhr — nicht jede Vorstellung ist begrenzt.

## Vortrag und Film zwischen den Wahlgängen

Beides liegt unter *Beamer → Präsentation & Video* und läuft im selben Beamerfenster wie die
Wahlansicht. Zurück zum Wahlgang geht es mit jeder Schaltfläche unter *Anzeige steuern*.

**Präsentation (HTML)**

- *Präsentation einspeisen* → HTML-Foliensatz **oder PDF** wählen. Die Datei wird kopiert, nicht
  verknüpft: Der Stick darf danach wieder in die Tasche.
- **Aus PowerPoint:** dort über *Datei → Exportieren → PDF/XPS erstellen* speichern und die
  PDF-Datei einspeisen. Layout und Schriften bleiben originalgetreu; Animationen und
  Folienübergänge gehen verloren.
- *Auf den Beamer* startet sie; die **Vortragssteuerung** öffnet sich mit. Dieses Fenster lässt
  sich auf den Laptop der vortragenden Person schieben — es zeigt die laufende Folie, die nächste,
  die Position und die Zeit seit Beginn. Wahlgänge lassen sich von dort nicht bedienen.
- Geblättert wird mit ← →, Leertaste, Bild auf/ab, Pos1/Ende.
- Wie eine solche Datei aufgebaut sein muss, steht in `docs/praesentationen.md`; eine lauffähige
  Vorlage liegt als `docs/beispiel-praesentation.html` bei.
- **Vorher prüfen:** Steht in der Vortragssteuerung `1 / n` und nicht `1 / ?`? Nur dann kennt
  Votura die Folienzahl und weiß, wann der Vortrag zu Ende ist. Bei einem PDF steht sie sofort
  fest; bei HTML nur, wenn der Foliensatz sie meldet.

**Video**

- *Video einspeisen* → MP4 (H.264/AAC) oder WebM. Große Dateien brauchen beim Kopieren einen
  Moment; das ist gewollt, damit im Saal nichts von einem gezogenen Stick abhängt.
- *Auf den Beamer*, dann Abspielen, Anhalten, ±10 Sekunden oder Zeitleiste. Beamer und alle Geräte
  im Netz richten sich nach derselben Zeit — auch eines, das erst mitten im Film dazukommt.
- **Den Ton gibt nur der Beamer aus.** Geräte im Netz laufen stumm mit; sonst entstünde ein Echo
  im Saal.
- Nach dem Einspeisen einmal kurz anspielen: Erst dann steht die Laufzeit fest, und der Beamer
  hat vorgepuffert.
- Am Ende bleibt der Film stehen statt zurückzuspringen.

## Zweites Gerät im Veranstaltungsnetz

Unter *Beamer → Beamer im Netzwerk* lassen sich zwei Dinge getrennt freischalten:

1. **Beameransicht** — rein lesend, Adresse `http://<IP>:8477/`
2. **Bedienung** — Adresse `http://<IP>:8477/operator`, Anmeldung mit einem lokalen Konto

Für die Bedienung gelten dieselben Rollen und Rechte wie am Hauptrechner; jede Aktion steht mit dem
jeweiligen Benutzer im Audit-Trail. Nach fünf Fehlversuchen ist das Gerät eine Minute gesperrt.

Zu beachten:
- Nur in einem **abgeschotteten** Veranstaltungsnetz verwenden — die Verbindung ist unverschlüsselt.
- Ordnerauswahl, Logo-Auswahl und „Speichern unter" funktionieren nur am Hauptrechner.
- Der Druckfortschritt wird live nur am Hauptrechner angezeigt; am Zweitgerät erscheint das Ergebnis,
  sobald der Auftrag abgeschlossen ist.
- Arbeiten zwei Personen am selben Wahlgang, meldet die Anwendung beim Speichern einen veralteten
  Stand statt zu überschreiben.

## Zwischenfälle

| Situation | Vorgehen |
|---|---|
| Drucker verliert Verbindung | Auftrag stoppt, Status „unklar". Gedruckte Zettel zählen, Menge im Dialog bestätigen, dann gezielt nachdrucken. |
| Papier leer | Rolle wechseln, Auftrag physisch prüfen, fehlende Menge als Nachdruck mit Grund erzeugen. |
| Anwendung stürzt ab | Neu starten; die Daten sind gespeichert. Der Wiederanlauf-Dialog fragt unklare Druckaufträge ab. Es wird nie automatisch nachgedruckt. |
| Kandidat falsch geschrieben (vor Freigabe) | Einfach korrigieren. |
| Kandidat falsch geschrieben (nach Freigabe) | Entsperren mit Begründung → neue Version → erneut freigeben → **alte und neue Stapel nicht mischen**. |
| Kandidat zieht zurück | Als zurückgezogen markieren (kein Löschen). Nach Freigabe: Entscheidung der Wahlleitung, dann neue Version. |
| Beschädigter Stimmzettel | Ersatz ausgeben, im Reiter *Stimmzettelbilanz* als Menge erfassen (Ersatz +1, zurückgenommen +1). |
| Stimmengleichheit | Wird markiert, nicht automatisch aufgelöst. Feststellung bzw. Losentscheid dokumentieren; optional Protokollbeleg drucken (kein Stimmzettel). |

## Nach der Versammlung

1. Ergebnisse und Protokolle exportieren (*Ergebnis → Wahlprotokoll / Vollständiger Export*).
2. Alle Wahlgänge abschließen oder abbrechen, dann *Veranstaltung → Abschließen*.
3. *Archivieren* erzeugt das vollständige Archivpaket inkl. ZIP. Über *Archivdateien* lassen sich die
   einzelnen Dateien ansehen, im Explorer öffnen und per *Speichern unter …* auf einen USB-Stick
   kopieren.
4. **Backup erstellen** und auf beide USB-Sticks legen.
5. Papier-Stimmzettel gemäß Wahlordnung sammeln, verpacken und versiegeln. Ausgefüllte
   Stimmzettel werden **nicht** digitalisiert.

## Tastatur

| Kürzel | Funktion |
|---|---|
| Strg+N | Neuer Wahlgang |
| Strg+T | Tagesordnung |
| Strg+B | Beamer-Steuerung |
| Esc | Dialog schließen |

Kein Tastenkürzel löst einen Massendruck aus.

## Bildschirmansichten

Die folgenden Aufnahmen stammen aus einem Demo-Bestand und lassen sich mit
`node tools/screenshots.mjs` jederzeit neu erzeugen.

| Ansicht | Zweck |
|---|---|
| ![Übersicht](screenshots/01-uebersicht.png) | Stand der Versammlung: Wahlgänge, Zettelversionen, Druckmengen, Ergebnisse |
| ![Tagesordnung](screenshots/02-tagesordnung.png) | Punkte vorab anlegen, sortieren, Anträge einschieben |
| ![Beamersteuerung](screenshots/03-beamersteuerung.png) | Auswahl des Bildes, Vorschau, Netzwerkansicht, Sperre |
| ![Kandidaten](screenshots/07-kandidaten.png) | Bewerber erfassen, sortieren, zurückziehen |
| ![Stimmzettel](screenshots/08-wahlzettel-vorschau.png) | Druckvorschau, Prüfliste, Freigabe |
| ![Druck](screenshots/09-druck.png) | Stückzahl, Drucker, Testdruck, Protokoll |
| ![Ergebnis](screenshots/10-ergebnis.png) | Auszählung, Plausibilitätsprüfung, Feststellung |
| ![Akzeptanzwahl](screenshots/12-akzeptanzwahl-stimmzettel.png) | Akzeptanzverfahren: Ja/Nein/Enthaltung je Bewerber |
| ![Ergebnis der Akzeptanzwahl](screenshots/13-akzeptanzwahl-ergebnis.png) | Gewählt ist, wer mehr Ja- als Nein-Stimmen hat |
| ![Audit-Trail](screenshots/04-audit-trail.png) | Lückenlose Nachvollziehbarkeit aller Handlungen |
| ![Systemcheck](screenshots/05-systemcheck.png) | Prüfung vor der Versammlung |
| ![Einstellungen](screenshots/06-einstellungen.png) | Drucker, Sicherheit, Konten, Beamer-Erscheinungsbild |
| ![Beameransicht](screenshots/11-beameransicht.png) | Öffentliche Anzeige des Ergebnisses |

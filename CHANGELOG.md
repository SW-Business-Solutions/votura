# Änderungen

Was sich von Fassung zu Fassung geändert hat — in der Sprache derer, die damit
eine Versammlung durchführen, nicht in der Sprache des Quelltextes.

## Unveröffentlicht

### Kameras steuern

Eine PTZ-Kamera fährt auf Wunsch von selbst auf ihre Position, sobald ein Redner aufgerufen wird —
zum Pult. Bei zwölf Bewerbern hintereinander führt damit niemand mehr zwischendurch eine Kamera
nach.

Gebaut als **eine Stelle für alle Hersteller**: Fast alle Netzwerkkameras sprechen VISCA, und der
Inhalt eines Befehls ist überall derselbe. Verschieden sind Verpackung, Weg, Port und ein paar
Eigenheiten je Modell — und die stehen in einer **Tabelle**, nicht im Programm. Eine neue Kamera
aufzunehmen heißt im Regelfall, eine Zeile zu ergänzen.

Welche Spielart eine Kamera spricht, muss niemand raten: Der Port verrät sie nicht, und Handbücher
schweigen oft dazu. Votura klopft die Adresse mit einer Frage ab, die nichts verstellt, und nimmt
die Form, die antwortet.

Kein Joystick. Wer live schwenken will, hat ein Pult mit einem Knüppel, und das kann es besser als
jede Maus.

### Kameras im Saal

Eine Kamera vor dem Pult, ihr Bild an der Wand — und darunter **Name, Bewerbung und die
verbleibende Redezeit**. Empfangen wird über **NDI**, das Verfahren, mit dem Produktionskameras im
Netz senden: Wer solche Kameras hat, steckt sie ein, und Votura findet sie.

Die Bauchbinde ist der eigentliche Grund für die Sache. Einen Bildmischer hat mancher Saal; was
keiner hat, ist das Wissen, **wer** da vorne steht und wie lange er noch hat. Genau das weiß
Votura ohnehin — aus demselben Aufruf, der auch die Uhr auf dem Beamer stellt. Getippt wird
nichts.

Drei Entscheidungen, die man dem Bild nicht ansieht:

- **Jedes Gerät empfängt selbst.** Im Zustand steht nur der Name der Quelle, nie ein Bild. Der
  Beamerrechner baut seine Verbindung zur Kamera auf, ein Pi hinter dem zweiten Beamer seine
  eigene. Einmal empfangen und weiterverteilen hieße, jedes Bild neu zu kodieren — auf dem
  Rechner, der die Wahl führt.
- **Eigener Prozess.** Die NDI-Bibliothek ist fremder, nativer Code. Stürzt sie ab, fällt das Bild
  aus und sonst nichts.
- **Erst auf Verlangen.** Ohne einen Blick in die Kameraliste startet nichts — eine Versammlung
  ohne Kameras merkt von alledem nichts.

Dazu: Steht das Bild einer Kamera an der Wand, schaltet Votura ihr **rotes Licht**. Wer gefilmt
wird, sieht es.

Und eine Grenze, die nicht verhandelbar ist: **Kameras gehören ans Kabel.** Ein voller NDI-Strom
belegt über hundert Megabit je Sekunde; über dasselbe WLAN laufen Handzettel und digitale
Abstimmung. Geräte im Funknetz bekommen deshalb den Nebenstrom, den jede NDI-Quelle zusätzlich
sendet.

Votura zeichnet **nichts** auf. Das Bild endet mit der Rede.

NDI® ist eine eingetragene Marke der Vizrt NDI AB.

## 1.5.0 — Die Griffe, die gefehlt haben

Diese Fassung bringt kaum neue Fähigkeiten — sie macht erreichbar, was das
Programm längst konnte, und repariert drei Stellen, an denen ein Knopf nichts
tat. Wer 1.4.0 benutzt hat und sich gefragt hat, wo man eine verlorene Karte
ungültig macht oder einen Tippfehler berichtigt: Hier ist die Antwort.


### Was das Programm konnte und niemand erreichte

Ein Durchgang durch alle Fähigkeiten des Systems gegen jede Stelle der
Oberfläche hat sieben Dinge zutage gefördert, die geprüft, protokolliert und
einsatzbereit im Programm standen — ohne dass es einen Knopf dafür gab:

- **Ausweise ungültig machen.** „Ich habe meine Karte verloren" war am Einlass
  nicht zu beantworten. Karten und Bändchen lassen sich jetzt als verloren
  melden oder ausmustern, Personen mit Begründung sperren und wieder
  entsperren, und ein gedruckter Pass wird durch einen neuen ersetzt.
- **Teilnehmer berichtigen.** Ein Tippfehler im Namen war bisher endgültig.
  Name, Nummer, Stimmgewicht und Gast-Eigenschaft lassen sich ändern.
- **Kommen und Gehen nachlesen.** Der Anwesenheitsverlauf einer Person steht
  im selben Dialog.
- **Wer hatte diesen Ausweis?** Der Verlauf einer Karte — ausgegeben an wen,
  zurück wann.
- **Das Urnenverzeichnis ansehen.** Es war nur zu drucken, und der Knopf dafür
  ist ohne eingerichteten Drucker gesperrt. Damit hing die Nachzählbarkeit der
  digitalen Wahl an einem Stück Hardware.
- **Einen Fehlgriff am Ausgabetisch zurücknehmen.** Wer den falschen Ausweis
  scannte, hatte einen Zettel vergeben, der nie über den Tisch ging.
- **Beleg über den Losentscheid.** Kein Stimmzettel, sondern ein Zettel zum
  Unterschreiben fürs Protokoll.

### Filme in Dauerschleife

Ein Film bleibt am Ende stehen — das ist richtig, solange er zwischen zwei Wahlgängen läuft. Für den
Willkommensfilm vor dem Beginn und die Bilderschleife in der Pause gibt es jetzt den Knopf
**Dauerschleife**: Dann beginnt er am Ende von vorn, auf allen Bildschirmen zugleich.

### Behoben

- **Votura Saal fand den Hauptrechner unter einer Adresse, die es nur in ihm selbst gibt.** Gemerkt
  wurde die Adresse, aus der die Antwort kam — auf einem Rechner mit Docker, WSL oder Hyper-V ist
  das schnell ein virtueller Schalter wie `172.17.144.1`. Der Fund sah richtig aus, und beim
  Übernehmen stand „fetch failed". Jetzt nennt der Hauptrechner seine brauchbaren Adressen selbst,
  und das Gerät probiert sie aus, statt zu glauben. Und wenn doch nichts antwortet, sagt die
  Meldung, was zu tun ist.
- **Kein Mikrofon am Pult in der Entwicklungsfassung.** Das Mikrofon bekommt allein die
  Prompterseite, erkannt an ihrem eigenen Schema — beim Entwickeln lädt sie aber wie jede andere
  Seite vom Entwicklungsserver und war damit nicht als Pult zu erkennen. „Nach Stimme" ließ sich
  ausgerechnet dort nicht ausprobieren, wo daran gearbeitet wird. Betrifft die fertige Anwendung
  nicht.
- **Umbenennen ging nicht** — in der Redenbibliothek, bei den Präsentationen und bei den Videos.
  Der Knopf öffnete `window.prompt`, das es in Electron nicht gibt: Es erschien nur die Meldung
  „prompt() is not supported". Jetzt fragt ein richtiger Dialog nach dem Namen.
- **Die Aktualisierung aus dem Programm heraus fand keine Prüfsumme.** Der Veröffentlichung zu
  1.4.0 lag die Prüfsummenliste unter einem Namen mit Fassungsnummer bei — gesucht wird
  `pruefsummen.txt`. Die Anwendung lud deshalb nichts, sondern meldete, zu der Datei sei keine
  Prüfsumme veröffentlicht; auf der Bezugsseite blieb die Liste der Dateien leer. Die Liste
  heißt wieder wie erwartet.

### Hinweise im Manuskript

Eine Zeile in eckigen Klammern — `[Zum Publikum schauen]` — ist ab jetzt kein Satz zum Vorlesen,
sondern ein Hinweis an die vortragende Person. Am Pult steht er in Großbuchstaben und in anderer
Farbe, er zählt nicht zur Redezeit, und das Mitlaufen nach Gehör übergeht ihn — es suchte sonst
nach Wörtern, die niemand spricht.

Dabei ist noch eine alte Ungenauigkeit mitgegangen: Der Lauf hielt um so viele Schritte zu früh an,
wie die Rede Atempausen hat — der letzte Satz kam nie ganz bis zur Lesezeile.

### Votura Saal: ein Bildschirm nur für die Folien

Die Begleitanwendung kennt eine neue Rolle: **Präsentationsansicht**. Sie zeigt die Folie, die
gerade an der Wand steht, und daneben die nächste — ohne Redetext, ohne Bedienung, ohne Mikrofon.

Der Prompter konnte beides schon, aber die Ansicht gilt dort für alle Geräte zugleich: Ein zweiter
Bildschirm hätte die Folien nicht wählen können, ohne dem Pult den Text wegzunehmen. Als eigene
Rolle steht sie an diesem Gerät fest.

### Das Mikrofon hat jetzt einen Schalter

Bei _Nach Stimme_ lief das Mikrofon, sobald die Laufart gewählt war, und der Startknopf daneben war
grau. Jetzt schaltet genau dieser Knopf das Zuhören ein und aus — am Pult, am Board und mit der
Leertaste. Für eine Zwischenfrage oder ein Gespräch am Pult genügt damit ein Griff, statt die
Laufart zu wechseln.

### Der Prompter folgt dem Aufruf

Eine Rede lässt sich einem **Bewerber zuordnen** — und diese Zuordnung tut jetzt auch etwas: Wird
der Bewerber auf dem Beamer vorgestellt, legt der Prompter seinen Text von selbst auf, mitsamt der
Uhr, die der Saal sieht. Bei zwölf Bewerbern hintereinander sucht damit niemand mehr zwischendurch
in einer Liste.

Der Lauf beginnt dabei von selbst — die Redezeit zählt ab dem Aufruf, und wer vorn steht, hat die
Hände am Manuskript und nicht am Board. Bei _Nach Stimme_ und _Von Hand_ wird nur aufgelegt.

Und die Uhr gilt in beide Richtungen: Wird die Redezeit angehalten, ruht auch der Lauf am Pult;
läuft sie weiter, läuft er weiter. Vorn eine stehende Uhr und hier ein davonlaufender Text wäre ein
Widerspruch vor den Augen der vortragenden Person.

Weil derselbe Mensch oft mehrmals spricht — Vorstandsbericht, später Bewerbung um die Wiederwahl —,
hängt die Zuordnung an der **Bewerbung** und nicht an der Person: Der auf dem Beamer eingestellte
Wahlgang entscheidet, welche Rede gemeint ist. Bleibt es mehrdeutig, legt der Prompter nichts auf.

Abschaltbar, und mit Rücksicht gebaut: Wer keine Rede zugeordnet hat, räumt das Pult nicht leer;
eine von Hand aufgelegte Rede wird nicht wieder weggenommen; und was am Pult steht, kommt weiterhin
unter keinen Umständen auf den Beamer.

## 1.4.0 — Wer da ist, und wie abgestimmt wird

Die größte Erweiterung seit der ersten Fassung: Votura weiß jetzt, **wer im
Saal ist**, und kann Abstimmungen auch **digital** führen. Beides ist
zuschaltbar; wer weiter nur Papier druckt, merkt davon nichts.

### Akkreditierung — die Zahl, an der die Mehrheit hängt

- **Teilnehmerliste mit Anwesenheit.** Kommen und Gehen wird als Verlauf
  geführt, nicht als Schalter. Die Zahl der stimmberechtigten Anwesenden wird
  beim **Eröffnen jedes Wahlgangs festgehalten** — wer danach geht, hat
  trotzdem mitgewählt, und die nötige Mehrheit ändert sich nicht mitten im
  Verfahren.
- **Beschlussfähigkeit** einstellbar (Anteil, feste Zahl oder keine). Sie steht
  auf der Übersicht und im Systemcheck.
- **Drei Formen von Ausweis:** wiederverwendbare Stimmkarten, Einlassbändchen
  aus Papier und der gedruckte Voting Pass mit QR-Code vom Bondrucker.
  Gespeichert wird nur die Prüfsumme des Codes.
- **Ausgabe der Stimmzettel gegen Ausweis.** Je Wahlgang genau einer; die
  ausgegebene Menge geht unmittelbar in die Stimmzettelbilanz ein — gezählt
  statt eingetippt.
- **Wer den Saal verlässt, gibt ab.** Nur wer im Saal ist, darf abstimmen.

### Digitale Abstimmung — offen, namentlich und geheim

- **Offene und namentliche Abstimmungen** über die eigenen Geräte der
  Teilnehmer oder über Wahlkabinen.
- **Geheime Wahl mit Blindsignaturen.** Der Rechner unterschreibt eine
  Berechtigung, ohne zu sehen, was er unterschreibt; in der Urne steht keine
  Person. Nachgezählt wird ein gedrucktes Urnenverzeichnis — von jedem im
  Saal, ohne Zugriff auf den Rechner.
- **Vier-Augen-Prinzip:** Auf Wunsch hält das Gerät des **Wahlausschusses** den
  Schlüssel, und der Hauptrechner sieht ihn nie.
- **Hybride Wahlgänge:** Papier und digital im selben Wahlgang. Niemand bekommt
  beides, und beide Zählungen werden addiert statt überschrieben.
- **Zwei Ausweise, eine Stimme:** Wer eine Karte hält und einen Pass hat,
  braucht beide — der Kartencode ist gedruckt und unveränderlich, der Pass
  lässt sich ersetzen.
- **Ein abgerissenes Netz kostet keine Stimme:** Dieselbe Stimme zweimal zählt
  einmal, und das Gerät wiederholt von selbst.

> **Nicht für den produktiven Einsatz freigegeben.** Die Kryptografie der
> geheimen digitalen Wahl ist **nicht extern geprüft**, und ein Durchlauf mit
> echten Geräten in einem echten Saal steht aus. Für eine Wahl, an der etwas
> hängt, bleiben Papier und die offene Abstimmung der belastbare Weg. Das
> Programm sagt es an der Stelle, an der entschieden wird.

**Was dagegen gemessen ist:** Die Software hält 500 Geräte aus.
`npm run lastprobe` führt fünfhundert vollständige Abläufe über den echten
Server — 8,0 Sekunden bei offener, 6,5 bei geheimer Wahl, fünfzig gleichzeitig
unterwegs, **kein einziger Fehler**, 500 Stimmen bei 500 Berechtigungen. Die
Zahl stand seit M1 als Behauptung in der Dokumentation; jetzt steht sie als
Messwert da.

### Das Saalnetz

- **Verschlüsselte Übertragung.** Für Abstimmungen Pflicht: Ohne sie reist die
  Stimme im Klartext durch ein WLAN, in dem bei gemeinsamem Passwort jeder
  Teilnehmer den Verkehr jedes anderen mitlesen kann.
- **Echtes Zertifikat von Let's Encrypt**, beantragt aus der Anwendung heraus
  über das Domain-Namensystem. Damit erscheint auf mitgebrachten Telefonen
  **keine Warnung** mehr. Der Rechner braucht dafür einmalig Zugang zum
  Internet — im Saal später nicht mehr.
- **Namensdienst und Adressvergabe** für Aufbauten, in denen Votura das Netz
  selbst aufspannt. Beide abschaltbar, beide aus, bis jemand sie einschaltet;
  die Adressvergabe verweigert den Dienst, wenn im Netz bereits jemand
  Adressen verteilt.
- **Netzwerkkarte wählbar** — bei Hyper-V, WSL oder VPN stecken schnell vier im
  Rechner, und nur eine führt zu den Telefonen.

### Geräte im Saal

- **Neue Rollen für Votura Saal:** Akkreditierung, Ausgabe, Wahlkabine und
  Wahlausschuss.
- **QR-Codes mit der Kamera scannen** — auf der Wahlseite, am Einlass und an
  der Ausgabe. Erkannt wird im Gerät; es wird nichts aufgenommen und nichts
  gesendet.
- **Das Wahlgerät setzt sich zurück:** 15 Sekunden nach der Abgabe, zwei
  Minuten Stille während der Auswahl. In einer Kabine findet sonst der Nächste
  den Namen und die Auswahl des Vorigen vor.

### Oberfläche

- Die Navigation ist nach dem **Ablauf des Abends** gegliedert und lässt sich
  gruppenweise zuklappen.
- Die **Übersicht** zeigt die gemessene Anwesenheit, die Beschlussfähigkeit und
  eine laufende digitale Abstimmung.
- Die **Einstellungen** sind dorthin sortiert, wo man sie sucht: Druckverhalten
  zum Drucker, Programmaktualisierung zu „Allgemein".
- **Eingabefelder nehmen keine unmöglichen Werte mehr an** — begrenzt wird beim
  Verlassen, nicht beim Tippen.
- Der **Systemcheck** prüft Zertifikat, Verschlüsselung, Wahlkabinen,
  Prüfschlüssel und Beschlussfähigkeit.

### Behoben

- Systemdialoge lassen sich nicht mehr aus der Ferne auf dem Hauptrechner
  öffnen — ein modales Fenster dort legt mitten in einer Versammlung die
  Bedienung lahm.
- Das Zugriffstoken bekommt nur die Systemverwaltung zu sehen.
- Namensdienst und Adressvergabe überstehen einen Neustart der Anwendung.
- Auswahlknöpfe zerreißen ihre Zeile nicht mehr; Meldungen verschwinden wieder.

## 1.3.0 — Der Raspberry Pi als Hauptrechner

- Fertige Abbilder für den Raspberry Pi in zwei Rollen: **Saal** (Anzeige am
  Beamer) und **Hauptrechner** (vollständige Anwendung).
- Das Einrichtungsskript fragt nach der Rolle, Zeitzone und Tastaturbelegung.

## 1.2.0 — Linux und der Raspberry Pi

- Pakete für Linux (x64 und arm64), auch für Votura Saal.
- Die Archive tragen wieder ausführbare Rechte.

## 1.1.0 — Votura Saal, die Begleitanwendung

- Eine eigene Anwendung für Bühnen und Pult: findet den Hauptrechner im Netz,
  zeigt Beamer oder Prompter im Vollbild und gibt dem Prompter ein Mikrofon.

## 1.0.0 — Die erste Fassung

- Wahlgänge nach Verfahren, Stimmzettel mit Freigabe und Versionierung,
  Massendruck auf Bondruckern, Stimmzettelbilanz, Ergebniserfassung mit
  Plausibilitätsprüfung, Beameransicht, Teleprompter, Audit-Trail.

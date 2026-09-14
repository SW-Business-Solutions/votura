# Änderungen

Was sich von Fassung zu Fassung geändert hat — in der Sprache derer, die damit
eine Versammlung durchführen, nicht in der Sprache des Quelltextes.

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
> geheimen digitalen Wahl ist **nicht extern geprüft**, und eine Lastprobe mit
> vielen Geräten steht aus. Für eine Wahl, an der etwas hängt, bleiben Papier
> und die offene Abstimmung der belastbare Weg. Das Programm sagt es an der
> Stelle, an der entschieden wird.

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

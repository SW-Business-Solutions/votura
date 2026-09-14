# ADR-0006: Digitale Stimmabgabe neben der Papierwahl

- **Status:** angenommen (Entwurf der Architektur; Umsetzung in Meilensteinen)
- **Datum:** 2026-09-14

## Kontext

Votura führt die Versammlung, die Stimme selbst fällt bisher auf Papier: Bon drucken, ankreuzen,
einwerfen, auszählen. Das soll bleiben. Daneben soll eine **digitale Stimmabgabe** möglich werden —
über das eigene Telefon des Teilnehmers, über ein bereitgestelltes Tablet in einer Wahlkabine, im
lokalen Veranstaltungsnetz, ohne Internet.

Der Anlass ist der Aufwand: Eine Versammlung mit 500 Stimmberechtigten druckt, verteilt, sammelt und
zählt für jeden Wahlgang 500 Zettel. Bei sechs Wahlgängen sind das 3000 Zettel und mehrere Stunden
Auszählung.

Die Anforderung, die alles andere bestimmt: Bei einer **geheimen Wahl** darf aus der abgegebenen
Stimme nicht auf die Person zurückgeschlossen werden können — auch nicht von demjenigen, der den
Rechner bedient.

## Entscheidung

### Zwei Bereiche, getrennt wie zwei Geräte

|                 | **Berechtigung**                                                                            | **Urne**                                 |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| kennt           | Mitglied, Voting Pass, Anwesenheit, „hat für Wahlgang 3 bereits eine Berechtigung bekommen" | Stimme und eine Seriennummer             |
| kennt **nicht** | die Stimme                                                                                  | wer gewählt hat, wann, von welchem Gerät |

Beide laufen zunächst im selben Prozess auf dem Hauptrechner. **Die Schnittstelle zwischen ihnen
wird trotzdem so geschnitten, als lägen sie auf verschiedenen Geräten** — kein gemeinsamer
Speicher, kein gemeinsamer Datenbankzugriff, nur ein definierter Aufruf. Damit wird „Berechtigung
läuft auf dem Gerät des Wahlausschusses" später eine Betriebsart und keine Neuentwicklung.

### Blindsignaturen statt Vertrauen

Zwei getrennte Tabellen auf einem Rechner sind **keine** Trennung. Schreibt die eine „Pass 001 →
Berechtigung ausgegeben, 19:43:12" und die andere „Stimme eingegangen, 19:43:20", ist die Zuordnung
trivial — bei einer Versammlung, an der die Leute nacheinander an die Kabine treten, genügt dafür
die Reihenfolge, ganz ohne Datenbank.

Deshalb erzeugt **das Endgerät** die Seriennummer seines Stimmzettels selbst und lässt sie sich
**verblendet** unterschreiben (RSA-Blindsignatur, RFC 9474):

```
Gerät          Seriennummer s zufällig wählen, mit Zufallsfaktor r verblenden
   ↓ Voting Pass + verblendeter Wert
Berechtigung   Pass gültig? Für diesen Wahlgang noch nichts ausgegeben?
               → unterschreibt, ohne den Wert lesen zu können
   ↓ Blindsignatur
Gerät          Verblendung aufheben → (s, Unterschrift)
   ↓ s, Unterschrift, Stimme
Urne           Unterschrift gültig? s noch unbenutzt? → einlegen
```

Der Unterschied zu „wir speichern die Verbindung nicht" ist der entscheidende: Die
Berechtigungsseite **kann** sie nicht herstellen, auch wenn jemand es wollte und beide Datenbanken
nebeneinanderliegen. Nur das hält der Frage stand, woher wir das wissen.

Je Wahlgang ein eigenes Schlüsselpaar. Der öffentliche Teil wird **vor Öffnung** des Wahlgangs
angezeigt und ins Protokoll gedruckt — danach lässt er sich nicht mehr unbemerkt austauschen. Der
private Teil wird beim Schließen gelöscht.

### Ein Pass für den ganzen Abend, ein Zettel je Wahlgang

Der Voting Pass weist die Stimmberechtigung für die **Versammlung** nach, nicht für einen einzelnen
Wahlgang. Er wird bei der Akkreditierung einmal ausgegeben — als QR-Code, gedruckt auf demselben
Bondrucker, der auch die Stimmzettel druckt.

Je Wahlgang entsteht daraus eine neue, einmalige Berechtigung. Doppelte Stimmabgabe wird an zwei
Stellen verhindert: Die Berechtigungsseite gibt je Pass und Wahlgang genau eine Unterschrift aus,
die Urne nimmt jede Seriennummer genau einmal an.

### Die Bilanz wird zur Prüfung

Die Stimmzettelbilanz (§22, §23) gilt digital weiter und bekommt eine neue Bedeutung:

| Papier                    | Digital                    |
| ------------------------- | -------------------------- |
| ausgegebene Zettel        | ausgegebene Unterschriften |
| Zettel in der Urne        | angenommene Stimmen        |
| unbenutzt / zurückgegeben | verfallene Berechtigungen  |

**Angenommene Stimmen dürfen die ausgegebenen Unterschriften nie übersteigen.** Eine gefüllte Urne
bräuchte gültige Unterschriften; die Zahl der ausgegebenen ist öffentlich und läuft während des
Wahlgangs auf der Leinwand mit. Damit ist die Bilanz kein Formular mehr, sondern eine Rechnung, die
aufgehen muss.

### Die Urne wird gedruckt

Beim Schließen wird die Urne gemischt und als **Liste ausgedruckt**: jede Seriennummer mit ihrer
Stimme. Das Ergebnis ist damit nachzählbar wie ein Stapel Zettel — von jedem im Saal, ohne Zugriff
auf den Rechner.

**Der Teilnehmer bekommt seine Seriennummer nicht.** Das Gerät vergisst sie nach der Abgabe. Das ist
Absicht und entspricht genau dem Papier: Auch dort kann niemand später auf einen bestimmten Zettel
zeigen und sagen „der ist meiner" — **auch nicht er selbst**. Eine Quittung wäre sonst genau das,
was jemand verlangen kann, der Druck ausübt.

Der Preis: Eine einzelne Person kann nicht überprüfen, dass ihre Stimme in der Liste steht. Alle
zusammen können überprüfen, dass die Liste zum Ergebnis passt und nicht mehr Stimmen enthält als
Berechtigungen ausgegeben wurden.

### Je Wahlgang entscheidet die Wahlleitung

```
Verfahren:
  ○ Papier
  ○ Digital — eigene Geräte
  ○ Digital — nur Wahlkabinen
  ○ Digital — eigene Geräte und Wahlkabinen
  ○ Hybrid — Papier und digital in einem Wahlgang
```

Die Papierwahl bleibt vollständig erhalten und Voreinstellung. Satzungen, Wahlordnungen und
Beschlusslagen sind verschieden; die Entscheidung gehört der Wahlleitung, nicht dem Programm.

### Eigene Geräte in der Wahlkabine

Die Kabine und das eigene Telefon schließen sich nicht aus: In der Kabine sorgt die **Kabine** für
die Unbeobachtetheit, das Telefon ist nur das Eingabegerät. Das löst das Problem der beobachteten
Stimmabgabe, ohne für 500 Teilnehmer Geräte zu beschaffen.

## Was dafür schon da ist

- Ein lokaler HTTP-Server, der Anwendungen an Teilnehmergeräte ausliefert, mit Server-Sent-Events
  und schreibenden Endpunkten (`src/main/network-projection.ts`, ADR-0005).
- Votura Saal, das rollenbasiert auf billiger Hardware ohne Anmeldung hochfährt — die Wahlkabine ist
  eine weitere Rolle, kein neues Gerät.
- Der Bondrucker für den Voting Pass.
- Die Bilanz, das Audit und die Ergebnisfeststellung.

## Bewusste Grenzen

- **Der Hauptrechner hält den privaten Schlüssel.** Wer ihn vollständig kontrolliert, kann
  zusätzliche Unterschriften erzeugen. Die Bilanz macht das sichtbar, verhindert es aber nicht.
  Wirklich ausgeschlossen wird es erst, wenn die Berechtigungsseite auf einem Gerät des
  Wahlausschusses läuft — dafür ist die Schnittstelle vorbereitet, mehr nicht.
- **Netzkennungen bleiben ein Rest.** Die Blindsignatur trennt Pass und Stimme; die IP-Adresse des
  absendenden Geräts trennt sie nicht. Die Urne speichert keine Herkunft, aber wer den
  WLAN-Controller betreibt, sieht Zeitpunkte. Für geheime Wahlen ist das der Grund, die Kabine zu
  empfehlen: Dort gehört das Gerät nicht zur Person.
- **Keine individuelle Quittung** (siehe oben) — bewusst, nicht aus Nachlässigkeit.
- **Kein Internet.** Alles im Veranstaltungsnetz, wie bisher.
- **Rechtlich offen.** Ob eine elektronische Stimmabgabe in einer konkreten Gliederung zulässig ist,
  hängt an Satzung, Wahlordnung und Beschlusslage. Die einschlägigen Vorschriften des
  Parteiengesetzes sind am aktuellen Wortlaut zu prüfen; das Bedrohungsmodell nennt die offenen
  Fragen. Diese ADR trifft dazu keine Aussage.

## Meilensteine

|        | Inhalt                                                                                                            | Warum in dieser Reihenfolge                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Akkreditierung: Mitglieder, Anwesenheit, Kommen und Gehen, Beschlussfähigkeit, Voting Pass als gedruckter QR-Code | Fundament. `eligible_voters` ist heute **eine getippte Zahl am Ereignis** — beim vierten Wahlgang sind andere Leute im Saal als beim ersten. Verbessert sofort die Papierwahl, ganz ohne digitale Stimme. |
| **M1** | Offene Abstimmungen digital (Sach- und GO-Anträge)                                                                | Kein Wahlgeheimnis, also ohne Blindsignaturen. Erprobt Netz, Pass, Oberfläche und Bilanz unter echten Bedingungen — 500 Geräte im WLAN sind ein Problem für sich.                                         |
| **M2** | Geheime Wahl: Blindsignaturen, Kabinenrolle in Votura Saal, gedruckte Urnenliste                                  | Erst jetzt, mit erprobter Infrastruktur, der Teil mit der höchsten Fallhöhe.                                                                                                                              |
| **M3** | Hybride Wahlgänge, Berechtigungsseite auf eigenem Gerät (Vier-Augen-Prinzip)                                      | Setzt M2 voraus.                                                                                                                                                                                          |

## Verworfene Alternativen

**Eigene Stimmgeräte (VotePad).** Technisch reizvoll, wirtschaftlich fragwürdig: CE/RED, EMV,
ElektroG, Batterierecht, Importeurspflichten, Werkzeugkosten, Ersatzteilhaltung und Gewährleistung
über Jahre — eine zweite Firma, keine Funktion. Der QR-Ansatz macht sie überflüssig: Statt 500
Geräten genügen ein Server, zwei Zugangspunkte, einige Kabinen und die Telefone, die ohnehin da
sind. Falls doch Geräte gestellt werden sollen, sind es Tablets mit der Kabinenrolle.

**Stimme und Person verschlüsselt speichern, Schlüssel getrennt aufbewahren.** Einfacher zu bauen,
aber die Verbindung existiert dann — sie ist nur verschlossen. Wer den Schlüssel bekommt, bekommt
alles. Bei einer geheimen Wahl ist der Unterschied zwischen „verschlossen" und „nicht vorhanden"
der ganze Punkt.

**Ein QR-Code je Wahlgang.** Sicherheitstechnisch bequem, im Saal unbrauchbar: Bei sechs Wahlgängen
sechsmal an alle verteilen.

## Verweise

- Bedrohungsmodell: `docs/bedrohungsmodell-digitale-wahl.md`
- ADR-0005 (Fernzugriff, lokaler HTTP-Server, Sitzungskontext)
- ADR-0004 (Trennung von Wahlzweck und Verfahren) — die Betriebsart je Wahlgang folgt demselben
  Gedanken

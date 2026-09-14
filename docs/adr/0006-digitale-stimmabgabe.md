# ADR-0006: Digitale Stimmabgabe neben der Papierwahl

- **Status:** angenommen und umgesetzt (M0–M3)
- **Datum:** 2026-09-14, Umsetzung nachgetragen am 2026-09-14

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

### Nur wer im Saal ist, darf abstimmen

Der Ausweis weist die Berechtigung nach; **anwesend** sein muss man trotzdem. Beides fällt nicht von
selbst zusammen: Ein gedruckter Pass funktionierte sonst auch vom Parkplatz aus.

Der Ausweis kommt daher in drei Formen, und alle drei werden am Ausgang eingezogen oder verfallen:

|            | **Stimmkarte**               | **Einlassbändchen**           | **Gedruckter Pass**       |
| ---------- | ---------------------------- | ----------------------------- | ------------------------- |
| Material   | Plastik, wiederverwendbar    | Papier, um das Handgelenk     | Bon aus dem Thermodrucker |
| Am Ausgang | zurück in den Stapel         | abgerissen, verbraucht        | bleibt beim Teilnehmer    |
| Wofür      | wiederkehrende Versammlungen | einmalige Großveranstaltungen | kleine Runden, Nachzügler |

Wer den Saal verlässt, gibt ab; wer wiederkommt, bekommt einen neuen Ausweis. Damit ist die
Anwesenheit nicht mehr eine zusätzlich zu pflegende Liste, sondern fällt beim Ein- und Auslass von
selbst an — ein Scan gibt aus und macht anwesend, ein Scan nimmt zurück und macht abwesend.

**Der Ausweis ist ein Inhaberpapier.** Wer ihn hat, gilt als die Person, der er zugewiesen ist — wie
eine Garderobenmarke. Das ist im Saal gängige Praxis, aber es ist etwas anderes als ein
Ausweisdokument, und es gehört benannt statt verschwiegen. Vier Dinge begrenzen den Schaden: Im QR
steht ein langes Zufallsgeheimnis statt der aufgedruckten Nummer; ein Ausweis gilt nur, solange er
zugewiesen ist; mit dem Abschluss der Versammlung verfällt alles Ausgegebene — Karten, Bändchen
**und** gedruckte Pässe; und ein verlorener Ausweis wird gesperrt und bleibt es.

Eine **Einmalnutzung** der Karte wäre der naheliegende Schluss und hilft nicht: Das Foto entsteht,
während die Karte ausgegeben ist, und der Missbrauch geschieht im selben Zeitfenster. Entwertet wird
deshalb bei der Rückgabe, beim Abschluss der Versammlung und auf Zuruf — und die eigentliche
Einmaligkeit sitzt eine Ebene tiefer, bei der Stimmberechtigung je Wahlgang.

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

### Papier und Urne ergeben zusammen das Ergebnis

Ein Wahlgang kann **beides** sein: Wer ein Gerät hat, stimmt digital ab, wer keines will, bekommt
einen Zettel. Die Doppelausgabe ist ausgeschlossen — wer eine digitale Berechtigung hat, bekommt
keinen Zettel, und umgekehrt (`handout.ts`, `voting.ts`). Damit sind es zwei getrennte Stapel, die
am Ende addiert werden müssen.

**Gespeichert wird nur die Handauszählung; die geschlossene Urne kommt beim Lesen hinzu**
(`getResult` in `src/main/services/results.ts`). Das ist bewusst die Leseseite und nicht die
Schreibseite: Beim Speichern addiert, würde die Urne bei jeder Korrektur des Papieranteils erneut
aufschlagen — ein zweiter Klick auf „Speichern" hätte das Ergebnis verfälscht. So ist die Rechnung
unabhängig davon, wie oft sie ausgeführt wird, und beide Teile bleiben getrennt nachvollziehbar:
`getPapierergebnis` liefert die Zettel, `getResult` die Summe.

Die Erfassungsmaske zeigt an, dass eine geschlossene Urne vorliegt und mit wie vielen Stimmen. Was
dort eingetragen wird, ist immer der von Hand gezählte Anteil.

Eine **laufende** Abstimmung wird nicht mitgezählt. Eine Zwischensumme ist kein Ergebnis, und sie
gehört nicht in eine Feststellung.

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

- **Der Hauptrechner hält den privaten Schlüssel — sofern man ihn lässt.** In der einfachen
  Betriebsart entsteht er dort; wer den Rechner vollständig kontrolliert, kann dann zusätzliche
  Unterschriften erzeugen, und die Bilanz macht das sichtbar, ohne es zu verhindern. Mit
  `signer: 'committee'` entsteht er stattdessen auf dem Gerät des Wahlausschusses und verlässt es
  nie (M3). Die einfache Betriebsart bleibt die Voreinstellung: Sie braucht ein Gerät weniger, und
  wer sie wählt, soll wissen, worauf er verzichtet — die Oberfläche sagt es an der Stelle, an der
  entschieden wird.
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

## Wie es umgesetzt wurde

|                                    | Wo                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Rechenwerk der Blindsignatur       | `src/shared/blindsignatur.ts` — BigInt, damit dieselbe Rechnung auf dem Telefon und im Hauptprozess läuft |
| Wahldienst, Urne, Auszählung       | `src/main/services/voting.ts`                                                                             |
| Akkreditierung, Anwesenheit, Pässe | `src/main/services/participants.ts`                                                                       |
| Karten und Bändchen                | `src/main/services/cards.ts`                                                                              |
| Ausgabe der Stimmzettel            | `src/main/services/handout.ts`                                                                            |
| Seite auf dem Teilnehmergerät      | `src/renderer/src/wahl-main.tsx`                                                                          |
| Brücke ohne Anmeldung              | `src/main/wahl-bruecke.ts` — drei Funktionen, mehr ist von außen nicht erreichbar                         |
| Papier und Urne zusammenrechnen    | `mitUrneZusammengefuehrt` in `voting.ts`, angewendet von `getResult` in `results.ts`                      |

**Die Prüfsumme kommt von außen herein.** Das Rechenwerk hasht nicht selbst; im Hauptprozess liefert
`node:crypto` sie, im Browser `crypto.subtle`. Eine eigene SHA-256-Implementierung wäre die Art Rad,
die man nicht neu erfindet.

**Die Trennung ist geprüft, nicht behauptet.** Eine Prüfung hält die Spalten von `voting_rights` und
`cast_ballots` namentlich fest: Außer dem Wahlgang haben sie nichts gemeinsam, und `participant_id`
bleibt in der Urne leer — außer bei einer namentlichen Abstimmung, wo die Zuordnung der Zweck ist.

## Meilensteine

|          | Inhalt                                                                                                                                                          | Warum in dieser Reihenfolge                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** ✓ | Akkreditierung: Mitglieder, Anwesenheit, Kommen und Gehen, Beschlussfähigkeit, Voting Pass als gedruckter QR-Code, Karten und Bändchen, Ausgabe der Stimmzettel | Fundament. `eligible_voters` ist heute **eine getippte Zahl am Ereignis** — beim vierten Wahlgang sind andere Leute im Saal als beim ersten. Verbessert sofort die Papierwahl, ganz ohne digitale Stimme. |
| **M1** ✓ | Offene und namentliche Abstimmungen digital                                                                                                                     | Kein Wahlgeheimnis, also ohne Blindsignaturen. Erprobt Netz, Pass, Oberfläche und Bilanz unter echten Bedingungen — 500 Geräte im WLAN sind ein Problem für sich.                                         |
| **M2** ✓ | Geheime Wahl: Blindsignaturen, Kabinenrolle in Votura Saal, gedrucktes Urnenverzeichnis                                                                         | Erst jetzt, mit erprobter Infrastruktur, der Teil mit der höchsten Fallhöhe.                                                                                                                              |
| **M3** ✓ | Hybride Wahlgänge, Berechtigungsseite auf eigenem Gerät (Vier-Augen-Prinzip)                                                                                    | Setzt M2 voraus.                                                                                                                                                                                          |

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

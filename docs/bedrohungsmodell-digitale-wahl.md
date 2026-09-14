# Bedrohungsmodell der digitalen Stimmabgabe

- **Stand:** 2026-09-14 (Umsetzung nachgetragen)
- **Gegenstand:** die in ADR-0006 beschriebene und inzwischen umgesetzte digitale Stimmabgabe
- **Zweck:** festhalten, wogegen das Verfahren schützt, wogegen nicht, und woran das jeweils hängt

Dieses Dokument ist keine Rechtsberatung und keine Sicherheitszertifizierung. Es ist die Grundlage
für beides.

## 1. Was geschützt werden muss

| Schutzgut               | Bedeutet                                                         | Verletzt, wenn                                                                           |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Wahlgeheimnis**       | Niemand kann feststellen, wie eine bestimmte Person gestimmt hat | jemand Stimme und Person verbinden kann — auch nachträglich, auch mit Verwaltungsrechten |
| **Integrität**          | Das Ergebnis entspricht den abgegebenen Stimmen                  | Stimmen verändert, hinzugefügt oder unterschlagen werden                                 |
| **Gleichheit**          | Eine Person, eine Stimme                                         | jemand mehrfach oder unberechtigt abstimmt                                               |
| **Verfügbarkeit**       | Jeder Stimmberechtigte kann abstimmen                            | Geräte, Netz oder Server ausfallen                                                       |
| **Nachvollziehbarkeit** | Das Ergebnis ist im Nachhinein überprüfbar                       | nur der Rechner „weiß", was herausgekommen ist                                           |
| **Freiheit**            | Niemand wird bei der Abgabe beobachtet oder unter Druck gesetzt  | die Stimme sichtbar abgegeben oder nachgewiesen werden kann                              |

Die ersten fünf sind technische Fragen. Die sechste ist überwiegend eine Frage des Raums — und
deshalb der Grund, warum es Wahlkabinen gibt.

## 2. Wer als Angreifer gedacht wird

|                            | Kann                                                                           | Will                                                       |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Teilnehmer**             | eigenes Gerät vollständig kontrollieren, im WLAN mitlesen, Pässe fotografieren | mehrfach abstimmen, fremde Stimme abgeben, Ergebnis stören |
| **Beobachter im Saal**     | zusehen, Druck ausüben                                                         | erfahren, wie jemand gestimmt hat                          |
| **Netzbetreiber**          | WLAN-Controller, Adressen, Zeitpunkte                                          | Stimme einer Person zuordnen                               |
| **Mitleser im Saal**       | Laptop im selben WLAN, mitgeschnittener Verkehr                                | Stimmen **im Klartext** mitlesen                           |
| **Wahlleitung am Rechner** | alles auf dem Hauptrechner                                                     | Ergebnis verändern, Stimmen zuordnen                       |
| **Späterer Auswerter**     | Datenbank und Sicherungen nach der Versammlung                                 | rekonstruieren, wer wie gestimmt hat                       |

Der vierte ist der unbequeme Fall, und er ist nicht theoretisch: Der Vorsitzende, der die Wahl
seines Nachfolgers organisiert, bedient denselben Rechner.

## 3. Angriffe und was dagegen steht

### 3.1 Stimme einer Person zuordnen

| Weg                                                     | Gegenmaßnahme                                                                                           | Rest                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Berechtigung und Urne nebeneinanderlegen                | Blindsignatur: die Berechtigungsseite sieht die Seriennummer nie                                        | —                                           |
| Reihenfolge vergleichen („Dritter Pass, dritte Stimme") | Urne mischt beim Schließen, speichert keine Eingangsreihenfolge, Zeitstempel nur auf den Wahlgang genau | —                                           |
| Absenderadresse mitschreiben                            | Urne speichert keine Herkunft                                                                           | **wer das Netz betreibt, sieht Zeitpunkte** |
| Gerätekennung, Browser-Fingerabdruck                    | nichts davon wird gespeichert                                                                           | —                                           |
| Sicherung nachträglich auswerten                        | in der Sicherung steht dasselbe wie im Betrieb — die Verbindung existiert nirgends                      | —                                           |

**Der verbleibende Weg ist das Netz.** Wenn dasselbe Telefon erst die Unterschrift holt und dann die
Stimme abgibt, verbindet die Adresse beide Vorgänge — nicht in Votura, aber im Zugangspunkt. Dagegen
hilft technisch wenig und räumlich viel: In der Wahlkabine gehört das Gerät nicht zur Person.

Deshalb: **Für geheime Wahlen ist der Kabinenbetrieb die Empfehlung, nicht nur eine Möglichkeit.**
Wer eigene Geräte zulässt, sollte wissen, worauf er verzichtet.

### 3.1a Die Stimme unterwegs mitlesen

**Der schwerste Befund dieses Dokuments, und er wurde zu spät gefunden.**

Die Blindsignatur schützt davor, dass die _Wahlleitung_ Tabellen
nebeneinanderlegt. Sie schützt nicht davor, dass jemand mit einem Laptop im
Saal mitliest. Die frühere Fassung dieses Modells behandelte den Netzbetreiber
und Zeitpunkte — den Mitleser und den **Inhalt** behandelte sie nicht.

| Weg                                | Warum er funktioniert                                                                                                          | Gegenmaßnahme                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Unverschlüsseltes HTTP im Saalnetz | Stimme und Absenderadresse stehen nebeneinander im Klartext                                                                    | **Verschlüsselte Übertragung**                                           |
| WPA2 mit gemeinsamem Passwort      | Alle Teilnehmer kennen denselben Schlüssel; wer den Verbindungsaufbau eines anderen mitschneidet, entschlüsselt dessen Verkehr | WPA3 (eigener Schlüssel je Gerät) oder Geräte-Isolierung am Zugangspunkt |
| Offenes WLAN                       | jeder liest alles                                                                                                              | kommt für eine Abstimmung nicht in Frage                                 |

**Was verschlüsselte Übertragung leistet und was nicht.** Gegen das
**Mitlesen** hilft sie vollständig — auch mit einem selbst ausgestellten
Zertifikat, denn ein passiver Mitleser kann nichts entschlüsseln. Gegen einen
**aktiven** Angreifer, der sich dazwischenschaltet, hilft sie nur, wenn das
Gerät das Zertifikat wiedererkennt. Für **Wahlkabinen** ist das lösbar: Sie
gehören der Veranstaltung, und ihr Zertifikat lässt sich fest hinterlegen. Für
**mitgebrachte Telefone** ist es das nicht — dort erscheint eine Warnung, und
wer Menschen beibringt, solche Warnungen wegzuklicken, hat den Gewinn wieder
verspielt.

Daraus folgt dieselbe Empfehlung wie aus 3.1, nur schärfer: **Für geheime
Wahlen gehören Wahlkabinen dazu.** Eigene Geräte bleiben für offene und
namentliche Abstimmungen richtig — dort gibt es kein Wahlgeheimnis, das ein
Mitleser brechen könnte.

### 3.2 Mehrfach oder unberechtigt abstimmen

| Weg                                      | Gegenmaßnahme                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pass zweimal verwenden                   | je Pass und Wahlgang genau eine Unterschrift                                                                         |
| Unterschrift zweimal einlösen            | jede Seriennummer wird genau einmal angenommen                                                                       |
| Fremden Pass fotografieren und verwenden | Pass wird bei der Akkreditierung gegen Ausweis ausgegeben; Sperrung möglich; **bei eigenen Geräten bleibt ein Rest** |
| Seriennummer erfinden                    | ohne gültige Unterschrift nimmt die Urne nichts an                                                                   |
| Unterschrift fälschen                    | RSA; Schlüssel je Wahlgang, öffentlicher Teil vorher veröffentlicht                                                  |

Der Passdiebstahl ist der schwächste Punkt bei eigenen Geräten: Ein QR-Code lässt sich über die
Schulter fotografieren. Gegenmaßnahmen: Ausgabe erst im Saal, Sperrmöglichkeit, und — die
wirksamste — die Kabine, in der der Pass gescannt und sofort verbraucht wird.

### 3.3 Ergebnis verändern

| Weg                             | Gegenmaßnahme                                                          | Rest                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Stimmen in der Datenbank ändern | gedruckte Urnenliste; wer nachzählt, merkt es                          | nur, wenn jemand nachzählt                                                            |
| Zusätzliche Stimmen einlegen    | Bilanz: angenommene Stimmen ≤ ausgegebene Unterschriften               | nur in der einfachen Betriebsart; beim Wahlausschuss auf eigenem Gerät ausgeschlossen |
| Stimmen unterschlagen           | ausgegebene Unterschriften laufen öffentlich mit; eine Lücke fällt auf | Teilnehmer müssen hinsehen                                                            |
| Schlüssel austauschen           | öffentlicher Teil wird vor Öffnung angezeigt und gedruckt              | —                                                                                     |
| Auszählung fälschen             | die Liste ist gedruckt und von Hand nachzählbar                        | —                                                                                     |
| Papierauszählung verschwindet   | Urne wird beim Lesen addiert, nie beim Speichern; die Zeile trägt nur den Papieranteil | —                                                                     |

**Der offene Punkt ist der private Schlüssel auf dem Hauptrechner.** Wer ihn kontrolliert, kann
gültige Unterschriften erzeugen und die Urne füllen. Die Bilanz macht das sichtbar — aber nur, wenn
die Zahl der ausgegebenen Unterschriften selbst vertrauenswürdig ist, und die stammt vom selben
Rechner.

Das ist die bauartbedingte Grenze einer Ein-Rechner-Lösung, und sie ist **auflösbar**: Mit
`signer: 'committee'` entsteht der Schlüssel auf dem Gerät des Wahlausschusses und verlässt es nie.
Der Hauptrechner sammelt dann nur verblendete Werte in einer Warteschlange; unterschreiben kann er
nicht. Der Ausschuss zählt unabhängig mit, und in der Urne dürfen nie mehr Stimmen liegen, als er
unterschrieben hat.

Das ist der Kern des Vier-Augen-Prinzips: **nicht, dass der Hauptrechner nichts kann, sondern dass
jemand anderes nachrechnet.** Wer die einfache Betriebsart wählt, verzichtet darauf — und die
Oberfläche sagt es an der Stelle, an der entschieden wird.

Ein Rest bleibt auch dann: Läuft das Ausschussgerät nicht, kann niemand mehr eine
Stimmberechtigung bekommen. Der Schlüssel lebt in der geöffneten Seite; wird sie geschlossen, ist
er weg und der Wahlgang muss neu vorbereitet werden. Das ist der Preis dafür, dass er nirgends
sonst liegt — und es steht auf dem Gerät.

**Der hybride Wahlgang war die gefährlichste Stelle dieser Zeile**, und zwar ohne Angreifer: Die
Übernahme der digitalen Urne hat das eingetragene Papierergebnis überschrieben. Ein Teil der
Stimmen wäre lautlos verschwunden — kein Fehler, keine Warnung, nur eine kleinere Zahl. Gespeichert
wird deshalb ausschließlich die Handauszählung, addiert wird erst beim Lesen (`getResult`), und die
Erfassungsmaske sagt, dass eine geschlossene Urne dazukommt. Eine Prüfung hält beides fest: dass
die Summe stimmt und dass mehrfaches Speichern sie nicht verändert.

### 3.4 Beobachtung und Druck

| Weg                                                | Gegenmaßnahme                                               | Rest                                          |
| -------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| „Zeig mir, wen du gewählt hast" während der Abgabe | Wahlkabine                                                  | **bei eigenen Geräten am Platz nicht lösbar** |
| Nachträglicher Nachweis verlangen                  | das Gerät vergisst die Seriennummer; es gibt keine Quittung | —                                             |
| Fremdes Gerät verlangen und selbst abstimmen       | Kabine, Ausgabe des Passes gegen Ausweis                    | Rest                                          |

Die fehlende Quittung ist hier kein Mangel, sondern die Gegenmaßnahme: Was man nicht nachweisen
kann, kann man nicht erzwingen.

### 3.5 Verfügbarkeit

| Weg                                  | Gegenmaßnahme                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| WLAN überlastet                      | Netzplanung gehört zur Veranstaltung; offene Abstimmungen (M1) erproben die Last vor der ersten geheimen Wahl |
| Hauptrechner fällt aus               | wie heute: Sicherung, und der Wahlgang kann jederzeit auf Papier umgestellt werden                            |
| Teilnehmer ohne Gerät oder ohne Akku | Wahlkabinen sind Pflichtbestandteil, nicht Zubehör                                                            |
| Störsender, Netzangriff              | Papier bleibt der Rückfallweg — deshalb wird es nicht abgeschafft                                             |

Dass die Papierwahl vollständig erhalten bleibt, ist auch eine Sicherheitsmaßnahme: Es gibt immer
einen Weg, der ohne Strom und Funk auskommt.

## 4. Was nicht gespeichert wird

Zusammen mit einer Stimme wird nie gespeichert:

- Name, Mitgliedsnummer, Voting-Pass-Kennung
- IP- oder MAC-Adresse, Gerätekennung, Browser-Merkmale
- Zeitpunkt genauer als der Wahlgang
- Eingangsreihenfolge

Das Audit protokolliert die **Verwaltungsvorgänge** (Wahlgang geöffnet, geschlossen, Anzahl
ausgegebener Berechtigungen, Ergebnis festgestellt), nicht die Stimmabgaben.

## 5. Offene Fragen

Vor einem produktiven Einsatz zu klären — von Menschen, nicht von diesem Dokument:

1. **Zulässigkeit.** Ob eine elektronische Stimmabgabe in der konkreten Gliederung erlaubt ist,
   hängt an Satzung, Wahlordnung, Geschäftsordnung und Beschlusslage. Die einschlägigen
   Vorschriften des Parteiengesetzes sind am aktuellen Wortlaut zu prüfen; das Parteienrecht wurde
   zuletzt mehrfach geändert.
2. **Bestätigungserfordernis.** In verwandten Regelungen müssen elektronisch gefasste Beschlüsse
   nachträglich in Textform bestätigt werden. Ob das hier greift, ist zu klären.
3. **Datenschutz-Folgenabschätzung.** Anwesenheit und Stimmberechtigung sind personenbezogene
   Daten; bei Parteien liegt zudem die Frage besonderer Kategorien nahe.
4. **Unabhängige Prüfung.** Vor dem ersten geheimen Wahlgang gehören Kryptografie und
   Implementierung von außen geprüft. Das Verfahren ist bekannt und nachrechenbar — dass es richtig
   umgesetzt ist, muss jemand anderes feststellen als der, der es gebaut hat.
5. **Aufbewahrung.** Wie lange die gedruckte Urnenliste und die Bilanz aufzubewahren sind, richtet
   sich nach der jeweiligen Ordnung.

## 5a. Was die Umsetzung inzwischen hält

Die Maßnahmen dieses Dokuments sind gebaut. Was davon geprüft ist und wo:

| Aussage                                                       | Geprüft durch                                                                                                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Die signierende Seite erfährt nichts                          | `tests/blindsignatur.test.ts` — verblendeter Wert und Blindsignatur haben mit Seriennummer und fertiger Signatur nichts gemein; zweimal dieselbe Nummer ergibt zwei verschiedene Anfragen |
| Eine Signatur gilt nur für ihre Seriennummer                  | ebenda — fremde Nummern, erfundene Signaturen, fremdes Schlüsselpaar und die entarteten Werte 0, 1 und n werden abgewiesen                                                                |
| Berechtigung und Urne haben nichts gemeinsam                  | `tests/wahl.test.ts` — die Spalten beider Tabellen werden namentlich festgehalten                                                                                                         |
| In der Urne steht keine Person                                | ebenda, auch bei **offener** Abstimmung                                                                                                                                                   |
| Die Betriebsart entscheidet, nicht der Absender               | ebenda — eine mitgeschickte Personenkennung wird verworfen, wo sie nicht hingehört                                                                                                        |
| Der private Schlüssel verschwindet beim Schließen             | ebenda                                                                                                                                                                                    |
| Nur wer im Saal ist, darf abstimmen                           | `tests/akkreditierung.test.ts` — auch mit gültigem gedrucktem Pass                                                                                                                        |
| Je Wahlgang eine Berechtigung, je Stimmzettel eine Stimme     | `tests/wahl.test.ts`                                                                                                                                                                      |
| Niemand bekommt Papier **und** digital                        | `tests/wahl.test.ts` — beide Seiten prüfen die jeweils andere                                                                                                                             |
| Der Schlüssel liegt beim Ausschuss nicht auf dem Hauptrechner | ebenda — und ohne gemeldeten Prüfschlüssel lässt sich nicht eröffnen                                                                                                                      |
| Der Prüfschlüssel lässt sich nicht austauschen                | ebenda — er wird genau einmal angenommen                                                                                                                                                  |
| In der Warteschlange steht nur Verblendetes                   | ebenda — die Spalten werden namentlich festgehalten                                                                                                                                       |
| Papier und Urne ergeben zusammen das Ergebnis                 | ebenda — und mehrfaches Speichern verändert die Summe nicht                                                                                                                               |
| Eine laufende Abstimmung wird nicht mitgezählt                | ebenda — eine Zwischensumme ist kein Ergebnis                                                                                                                                             |

**Was dabei nicht geprüft ist und nicht geprüft werden kann:** ob die Umsetzung der Kryptografie
frei von Fehlern ist. Prüfungen zeigen, dass sie das Erwartete tut — nicht, dass sie nichts anderes
tut. Das bleibt Punkt 4 der offenen Fragen.

## 6. Warum der Quelltext der Urne offen bleiben sollte

Eine Urne, deren Verfahren niemand prüfen kann, ist bei einer Wahl genau das, was man nicht will.
Die Entscheidung des Bundesverfassungsgerichts von 2009 zur Öffentlichkeit der Wahl bindet
innerparteiliche Wahlen nicht — aber ihr Gedanke trifft zu, und der erste Kritiker im Saal wird sie
zitieren.

Alles, was die Stimme berührt — Tokenverfahren, Blindsignatur, Urne, Auszählung und die Werkzeuge
zum Nachrechnen —, sollte einsehbar und nachprüfbar sein. Das ist kein Verzicht, sondern die
Voraussetzung dafür, dass jemand dem Ergebnis glaubt.

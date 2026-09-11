# Präsentationen für Votura bauen

Zwischen zwei Wahlgängen wird auf einer Versammlung geredet — Rechenschaftsbericht,
Kandidatenvorstellung, Ausblick. Votura zeigt dafür einen eigenen Foliensatz auf demselben
Beamer und in derselben Netzwerkansicht wie die Wahlansicht; ein Klick bringt den Wahlgang
zurück.

Dieses Dokument beschreibt, wie eine solche Datei aufgebaut sein muss.

Eine vollständige, lauffähige Vorlage liegt bei: **[beispiel-praesentation.html](beispiel-praesentation.html)**.
Sie lässt sich herunterladen, im Browser öffnen und als Ausgangspunkt nehmen.

---

## PowerPoint und andere Programme: der Weg über PDF

Neben HTML-Foliensätzen nimmt Votura **PDF-Dokumente** an. Das ist der Weg für alles, was in
PowerPoint, Impress, Keynote oder Canva entsteht:

> **Datei → Exportieren → PDF/XPS-Dokument erstellen** (PowerPoint)
> **Datei → Exportieren als → Direktes Exportieren als PDF** (LibreOffice Impress)

Die PDF-Datei wird dann wie ein Foliensatz eingespeist. Votura zeichnet die Seiten selbst —
ohne Werkzeugleiste, ohne Blätterleiste, nur die Folie. Seitenzahl, Vortragssteuerung,
Netzwerkansicht und Beamer verhalten sich genau wie bei HTML.

**Was dabei erhalten bleibt:** Layout, Schriften, Bilder, Diagramme, Farben — PowerPoints
PDF-Export bettet alles ein. Das Ergebnis sieht auf jedem Rechner gleich aus, auch ohne
installiertes Office.

**Was verloren geht:** Animationen, Folienübergänge, eingebettete Videos und automatische
Abläufe. Die überstehen keine Umwandlung, gleich welche. Wer sie braucht, baut den Foliensatz
als HTML (siehe unten) — dort ist jede Animation möglich, die ein Browser kann.

**Warum nicht `.pptx` direkt?** Eine PowerPoint-Datei ist ein Archiv voller XML mit Verweisen auf
Schriften, Layouts, Diagramme und SmartArt. Es gibt Bibliotheken, die das im Browser nachbauen —
mit der Treue von „meistens ungefähr". Genau die Begründung, mit der auch MKV und MOV bei den
Videos ausgeschlossen sind: *läuft manchmal* ist im Saal wertlos. Der PDF-Export von PowerPoint
ist dagegen originalgetreu, weil ihn PowerPoint selbst macht.

**Format der Seiten:** Am besten im Seitenverhältnis des Beamers anlegen, meist 16:9. Ein
4:3-Dokument bekommt links und rechts schwarze Balken — es wird nie beschnitten, denn am Rand
einer Folie steht im Zweifel etwas Wichtiges.

Der Rest dieses Dokuments beschreibt den **HTML-Weg** — für alle, die einen Foliensatz selbst
bauen oder aus einer Vorlage erzeugen.

---

## Die kurze Fassung

1. **Eine einzige HTML-Datei.** Schriften, Bilder und Skript stecken darin. Höchstens 50 MB.
   (Oder ein PDF — dann entfallen die Punkte 2 und 3, siehe oben.)
2. **Auf Nachrichten hören:** `{ votura: 'votura', type: 'goto', slide }` → diese Folie zeigen.
3. **Zurückmelden:** `{ votura: 'votura', type: 'state', slide, slideCount }` an `parent`.

Ohne Punkt 2 bleibt der Foliensatz auf der ersten Folie stehen. Ohne Punkt 3 weiß Votura
nicht, wie viele Folien es gibt — die Vortragssteuerung zählt dann über das Ende hinaus.

---

## 1. Eine Datei, die alles mitbringt

Erwartet wird **eine** Datei mit der Endung `.html` oder `.htm`. Sie wird beim Einspeisen
kopiert, nicht verknüpft: Der Stick, von dem sie kam, ist im Saal längst wieder in der Tasche.

Alles, was die Folien brauchen, muss darin stehen:

| | |
|---|---|
| Schriften | als `@font-face` mit `data:`-URI, oder verbreitete Systemschriften mit Ersatzkette |
| Bilder | als `data:`-URI (`<img src="data:image/png;base64,…">`) oder als Inline-SVG |
| Stile | in einem `<style>`-Block |
| Steuerung | in einem `<script>`-Block |

**Nichts wird nachgeladen.** Der Rahmen, in dem die Präsentation läuft, hat kein `connect-src`
und keinen Netzzugang — ein `fetch`, ein `<link href="https://…">` oder eine Google-Schriftart
schlagen fehl, stillschweigend. Das ist kein Versehen, sondern Absicht: Votura arbeitet
vollständig offline, und im Saal ist selten Netz. Eine Schriftart, die auf dem Vorführrechner
fehlt, verschiebt außerdem das ganze Bild.

Der Inhalt des `<title>`-Elements wird beim Einspeisen als Name in der Bibliothek übernommen.
Er lässt sich dort jederzeit ändern.

---

## 2. Folienwechsel entgegennehmen

Votura schickt der Präsentation eine Nachricht, wenn geblättert werden soll:

```js
window.addEventListener('message', (ereignis) => {
  const nachricht = ereignis.data
  if (!nachricht || nachricht.votura !== 'votura' || nachricht.type !== 'goto') return
  if (typeof nachricht.slide !== 'number') return
  zeige(nachricht.slide) // 1-basiert: die erste Folie ist 1, nicht 0
})
```

Das Feld `votura` ist die Absenderkennung. Ohne die Prüfung darauf würde jede fremde Nachricht
im Fenster als Folienwechsel gelesen.

Die Foliennummer ist **1-basiert** — wie in der Anzeige, nicht wie im Array.

---

## 3. Den eigenen Stand zurückmelden

Nach jedem Wechsel meldet die Präsentation, wo sie steht und wie viele Folien sie hat:

```js
parent.postMessage(
  {
    votura: 'votura',
    type: 'state',
    slide: aktuell,        // 1-basiert
    slideCount: folien.length,
    slideTitle: 'Das Jahr in Zahlen' // optional, erscheint in der Vortragssteuerung
  },
  '*'
)
```

Diese Meldung ist **nicht optional**. Die Folienzahl steht nirgends im Dokument — sie ergibt
sich erst, wenn dessen Skript gelaufen ist. Erst durch die Meldung weiß Votura, wann der
Vortrag zu Ende ist, und erst dann zeigt die Vortragssteuerung `4 / 10` statt `4 / ?`.

Gemeldet wird auch **einmal beim Laden**, damit der Stand von Anfang an stimmt.

Das Ziel `'*'` ist richtig so: Der Rahmen hat eine undurchsichtige Herkunft, eine genauere
Angabe gäbe es gar nicht. Unbedenklich, weil die Nachricht nichts Schützenswertes enthält.

---

## 4. Größe und Format

Die Präsentation bekommt das **Beamerfenster** als Fläche — häufig 1920 × 1080, bei einem
Fenster auf einem einzelnen Bildschirm auch weniger. Sie sollte sich danach richten, statt
feste Pixelmaße zu setzen:

```css
h1 { font-size: 7vh; }     /* wächst mit der Höhe */
.folie { padding: 8vh 10vw; }
```

`vh` und `vw` sind hier zuverlässiger als `px`: Dieselbe Datei sieht auf dem Vorführrechner,
auf dem Beamer und in der Vortragssteuerung gleich aus.

Die Vortragssteuerung zeigt zwei Vorschauen — die laufende Folie und die nächste. Beide
rechnen mit derselben Fläche wie der Beamer und werden nur im Maßstab verkleinert. Was dort
zu sehen ist, steht also wirklich gleich an der Wand.

---

## 5. Was im Rahmen nicht geht

Die Präsentation bringt fremdes JavaScript mit — das ist ihr Wesen, sie animiert und blättert.
Ausgeführt wird sie deshalb in einem abgeschotteten Rahmen ohne gemeinsame Herkunft. Daraus
folgt:

- **Kein Zugriff auf Votura.** Weder auf Wahldaten noch auf die Oberfläche noch auf den
  Projektionszustand. `window.parent` ist unerreichbar, der einzige Weg hinaus ist
  `postMessage`.
- **Kein `localStorage`, kein `sessionStorage`.** Der Zugriff wirft eine Ausnahme. Wer den
  Stand merken will, hält ihn in einer Variablen.
- **Kein Netz.** Kein `fetch`, kein `XMLHttpRequest`, keine WebSockets, keine externen
  Ressourcen.
- **Keine Formularziele, keine Navigation weg von der Datei.**

Erlaubt sind: Skripte (auch inline und `eval`), Stile, Bilder und Medien als `data:` oder
`blob:`, Schriften als `data:`.

---

## 6. Eigene Bedienelemente

Der Beispiel-Foliensatz hört zusätzlich auf Pfeiltasten, damit er sich am Schreibtisch auch
ohne Votura durchblättern lässt. Das ist sinnvoll zum Vorbereiten.

Auf dem Beamer greifen diese Tasten nicht — dort blättert die Vortragssteuerung, und ein Klick
in die Vorschau wird abgefangen. Eigene Schaltflächen im Foliensatz bleiben also folgenlos,
stören aber auch nicht. Wer sie nicht auf der Wand sehen will, blendet sie aus, sobald eine
`goto`-Nachricht eintrifft — dann läuft die Präsentation erkennbar unter Votura.

---

## 7. Einspeisen und abspielen

1. **Beamer** in der Seitenleiste öffnen, Karte **Präsentationen**.
2. **HTML-Präsentation einspeisen** — Dateidialog, die Datei wird in den Datenordner kopiert.
3. **Auf den Beamer** neben dem gewünschten Eintrag. Die Vortragssteuerung öffnet sich mit.
4. Blättern mit **← →**, Leertaste, Bild auf/ab, Pos1/Ende — oder mit den Schaltflächen.
5. Zurück zur Wahl: in der Beamersteuerung eine andere Ansicht wählen.

Die Vortragssteuerung ist ein eigenes Fenster und lässt sich auf den Laptop der vortragenden
Person schieben. Sie zeigt die laufende Folie, die nächste, die Position, die Uhrzeit und die
Zeit seit Beginn des Vortrags. Wahlgänge lassen sich von dort aus **nicht** bedienen — die
Methoden dafür fehlen in diesem Fenster schlicht.

---

## Prüfliste vor der Versammlung

- [ ] Die Datei im Browser geöffnet: Alles zu sehen, ohne Netz?
- [ ] Einmal eingespeist und auf den Beamer geholt: Zeigt die Vortragssteuerung die richtige
      Folienzahl — also `1 / n` statt `1 / ?`?
- [ ] Vor- und Zurückblättern über die Schaltflächen geprüft?
- [ ] Die letzte Folie erreicht: Bleibt die Steuerung dort stehen?
- [ ] Auf dem Vorführrechner angesehen, nicht nur auf dem eigenen?

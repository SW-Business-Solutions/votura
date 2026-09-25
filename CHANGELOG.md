# Änderungen

Was sich von Fassung zu Fassung geändert hat — in der Sprache derer, die damit
eine Versammlung durchführen, nicht in der Sprache des Quelltextes.

## 1.6.2 — Die Kamera, die nicht wollte

### Behoben

- **Die OBSBOT Tail Air ließ sich nicht steuern.** Das Bild stand an der Wand, die Knöpfe standen
  in der Bedienung, und beim Drücken passierte nichts — ohne Fehlermeldung, ohne Hinweis. Der
  Grund lag in einer Zeile: Votura hatte für dieses Modell **rohes** VISCA hinterlegt, die Kamera
  versteht aber nur die **gekapselte** Form, Sonys Umschlag mit Länge und Laufnummer. Ein Paket
  ohne Umschlag verwirft sie wortlos.

  Am Gerät nachgemessen statt aus einem Datenblatt abgeschrieben: roh keine Antwort auf Schwenk,
  Stopp und Zoomfrage; gekapselt ein „angenommen" und ein „ausgeführt" auf jeden Befehl. Die
  Zeile ist berichtigt, und ein Test hält sie fest.

- **Das Einrichten klopft die Bauart jetzt selbst ab.** „Steuerung einrichten" neben einer
  gefundenen Bildquelle legte die Kamera bisher mit der häufigsten Spielart an; gefragt wurde erst,
  wenn jemand zusätzlich auf „Bauart erkennen" drückte. Das ging meistens gut — und wenn nicht,
  war das Ergebnis dasselbe Schweigen wie oben.

  Das war schon immer falsch herum gedacht: Votura klopft die Adresse mit einer Frage ab, die
  nichts verstellt, und **kann** die Spielart erkennen. Jetzt tut es das gleich beim Einrichten,
  mit einem Klick, und schreibt hin, was geantwortet hat. Eine Voreinstellung, die rät, gibt es an
  dieser Stelle nicht mehr.

## 1.6.1 — Näher am Mikrofon

Drei Nachträge zu dem, was 1.6.0 in den Saal gebracht hat — keiner davon groß, alle drei an
Stellen, an denen es sonst gehakt hätte.

### Untertitel hören jetzt dort zu, wo gesprochen wird

Untertitel sind nur so gut wie das Mikrofon, das sie hört — und der Rechner, an dem die
Versammlung geführt wird, steht selten dort, wo gesprochen wird. Meist hinten im Saal, oft im
Nebenraum. Von dort kommt vom Rednerpult vor allem **Hall** an, und den erkennt kein Modell.

Unter „Im Saal" ist deshalb jetzt zu wählen, **wer zuhört**: der **Hauptrechner** wie bisher —
oder das **Pult**. Das ist das Prompterfenster, und das kann auf einem Saalgerät am Rednerpult
stehen: auf dem Rückblickschirm, den der Redner ohnehin vor sich hat, oder auf einem Gerät am
Mischpult, wo das Saalmikrofon anliegt. Es ist derselbe Weg, den der Prompter längst geht — er
hört seit jeher am Pult mit, um dem Redner zu folgen. Neu ist nur, dass dabei auch der Untertitel
abfällt.

**Das bringt mehr als jedes größere Sprachmodell.** Ein sauberes Signal vom Pult schlägt ein
besseres Modell an einem halligen Mikrofon, und zwar deutlich.

Dazu drei Dinge, die dabei gelten:

- **Erkannt wird auf dem Gerät, das zuhört.** Was es weitergibt, sind zwei Zeilen Text — kein Ton
  verlässt das Gerät, und aufgezeichnet wird auch hier nichts.
- **Immer nur eines.** Steht die Quelle auf „Pult", hört der Hauptrechner nicht mehr mit. Zwei
  Geräte schrieben zwei Untertitelspuren übereinander.
- **Über das Netz nur mit Freigabe.** Läuft das Pult auf einem Saalgerät, braucht es dafür
  „Bedienung am Pult" — denselben Schalter, der dem Pult das Weiterblättern erlaubt.

### Einblendungen für einen Livestream

Wer die Versammlung überträgt, nimmt das Kamerabild direkt: NDI bedient mehrere Empfänger
gleichzeitig, die Bildmischung holt sich dieselbe Quelle wie der Saal. Was dabei bisher fehlte,
waren die **Einblendungen** — Votura zeichnet Bauchbinde, Rednerreihe und Untertitel auf seine
eigene Fläche und nicht in den NDI-Strom hinein.

Die Netzansicht trägt jetzt einen Zusatz: **`?ueberlagerung=1`** zeigt genau diese drei Dinge auf
**durchsichtigem** Grund, sonst nichts. In OBS oder vMix kommt sie als Browser-Quelle über das
Kamerabild, und der Stream trägt dieselben Einblendungen wie die Wand — aus derselben Quelle, ohne
dass jemand etwas zweimal tippt. Die Adresse steht in der Beamersteuerung unter **Ausgabe & Netz**.

Sie hält sich dabei an die Schalter der Bedienung: Wer im Saal die Bauchbinde ausschaltet, weil
gerade niemand aufgerufen ist, hat sie auch im Stream nicht. Sonst behauptete die Übertragung etwas,
das der Saal nicht sieht.

**Alles andere ging schon vorher** — Tagesordnung, Ergebnis, Kandidatenliste, Pause: Dieselbe
Netzadresse **ohne** den Zusatz zeigt sie vollständig und lässt sich genauso einbinden. Nur das
Kamerabild fehlt dort, und das holt die Bildmischung ohnehin direkt.

### Kleinschreibung, mit zwei Ausnahmen

Die Erkennung liefert alles klein und ohne Satzzeichen; deutsche Rechtschreibung daraus
zurückzugewinnen hieße, Substantive zu erraten, und das ginge daneben. „Das Essen war gut" gegen
„wir wollen gleich essen" ist ohne Satzbau nicht zu trennen, und eine Regel, die rät, schriebe an
der Wand Wörter groß, die klein gehören — das sähe schlechter aus als Kleinschreibung, weil es
nach Absicht aussieht.

Groß werden deshalb nur der **Satzanfang** und die **Namen, die Votura kennt** — aufgerufene
Person, Bewerber, Verband, Veranstaltungstitel. Das ist Nachschlagen, kein Raten.

## 1.6.0 — Der Saal und das Verfahren

Diese Fassung hat zwei Hälften.

Die eine ist **der Saal**: Votura zeigt Kamerabilder und weiß dabei als Einziges, **wer** da vorne
steht — daraus wird eine Bauchbinde, die stimmt, ohne dass jemand sie tippt. Es steuert die Kameras,
und es blendet **Untertitel** ein, damit niemand die Debatte am Gehör verpasst.

Die andere ist **das Verfahren**: Ein **Antragsbuch** mit Änderungsanträgen, Übernahme,
Abstimmungsreihenfolge und Synopse — und aus jedem Antrag wird mit einem Klick eine Abstimmung,
wenn das Handzeichen nicht eindeutig auszuzählen ist. Dazu die **Quotenprüfung**, die eine
anfechtbare Liste meldet, **bevor** das Ergebnis feststeht, statt eine Woche danach.

Und eine Berichtigung, die längst fällig war: Die Redezeit startet jetzt, wenn sie starten soll —
und nicht schon, wenn der Name auf dem Beamer erscheint.

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

### Ein Bild aus dem Saal

Eine neu gewählte Kamera zeigt zunächst **nur ihr Bild**. Das war einmal umgekehrt: Bauchbinde und
Rednerreihe kamen von selbst mit, weil eine Vorstellung der häufigste Anlass ist. Wer aber einen
Blick in den Saal zeigen wollte, bekam damit den Namen der Person über das Bild, die zuletzt
gesprochen hat — und musste zwei Schalter umlegen, bevor das Bild sauber war. Etwas einzublenden
ist eine Entscheidung; ein Name, der von selbst erscheint, ist eine Überraschung.

Und weil eine Vorstellung einen Ansichtswechsel überlebt, sagt die Bedienung jetzt, **wen die
Bauchbinde nennen würde** — man entdeckt es nicht erst an der Wand.

### Die nächsten Redner über dem Kamerabild

Dieselbe Reihe, die die Vorstellung an der Wand zeigt, lässt sich auch über das Kamerabild legen —
unten rechts, gegenüber der Bauchbinde, einer je Zeile. Auf einer Versammlung mit zwölf Bewerbern
ist das die Auskunft, nach der im Saal am häufigsten gefragt wird: Wer kommt nach mir?

Getrennt von der Bauchbinde schaltbar, denn der Name dessen, der spricht, gehört fast immer ins
Bild; die Reihe dahinter nicht immer — bei einem Grußwort gibt es keine.

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

Zum **Einrichten** einer Position gibt es ein Steuerkreuz: Kamera hinstellen, wo sie stehen soll,
dann „Hier ablegen". Das ist kein Bedienpult für den Saal — wer live schwenken will, hat ein Pult
mit einem Knüppel, und das kann es besser als jede Maus. Drücken und halten bewegt, Loslassen hält
an, und nach fünf Sekunden hält sie ohnehin: Eine Kamera, die weiterdreht, weil ein Halt ausblieb,
ist im Saal ein Ärgernis.

**Auch für Kameras ohne eigenen Positionsspeicher.** Der Regelfall ist, dass die Kamera sich ihre
Positionen selbst merkt — das geht schneller und überlebt einen Wechsel des Rechners. Kann sie das
nicht, führt Votura die Positionen: Es fragt die Kamera nach ihrer Stellung, legt die Zahlen in die
Datenbank und schickt sie ihr später zurück. Umzuschalten mit **Positionen liegen: in Votura**.

Antwortet die Kamera dabei nicht oder unverständlich, gibt es einen Fehler statt einer geratenen
Zahl. Eine erfundene Stellung führte die Kamera später zuverlässig an den falschen Ort — mitten in
der Versammlung.

Und die Einstellungsseite zeigt jetzt oben, **was im Netz gefunden wurde**. Das ist nicht nur
Auskunft: Eine Kamera, die ihr Bild sendet, verrät dabei ihre Adresse — genau die, die die
Steuerung braucht. „Steuerung einrichten" legt den Eintrag fertig ausgefüllt an.

### Positionen während der Versammlung

Die Positionen einer Kamera stehen jetzt auch in der Bedienung, direkt unter ihrem Bild: „Pult",
„Präsidium", „Saal" als Knöpfe. „Zeig mal den Saal" ist ein Griff während der Versammlung, kein
Einrichten davor — dafür in die Einstellungen zu wechseln, wäre einer zu viel. Sie erscheinen nur,
wenn zu dem laufenden Bild eine Steuerung eingerichtet ist.

### Untertitel im Saal

Was gesprochen wird, steht mitlesbar an der Wand — zwei Zeilen, unten, dort, wo das Auge
Untertitel sucht.

**Zuerst für die, die schlecht hören.** Eine Mitgliederversammlung ist der Ort, an dem über Ämter
und Anträge entschieden wird; wer den Wortbeitrag nicht versteht, kann nicht mitentscheiden. Das
ist kein Komfort, sondern die Bedingung dafür, dass Teilhabe nicht am Gehör scheitert. Und dann
für alle anderen: In einem halligen Saal mit einer mäßigen Anlage liest jeder mit.

Erkannt wird mit **demselben Sprachmodell**, mit dem der Prompter schon bisher dem Redner nach
Gehör folgt — dieselbe Aufnahme, dieselbe Rechnung, nur ein anderes Ergebnis. Neue Technik kommt
dafür kaum hinzu; der heikle Teil, der beides trägt, steht seither an **einer** Stelle statt an
zwei.

Was dabei zu wissen ist:

- **Aufgezeichnet wird nichts.** Der Ton geht in die Erkennung und ist danach weg. Der Text steht
  an der Wand, solange er dort steht — er wird nicht abgelegt, nicht protokolliert, nicht
  exportiert. Ein Wortprotokoll wäre etwas anderes, und etwas, das eine Versammlung ausdrücklich
  beschließen müsste.
- **Je Bühne schaltbar.** Die Saalwand liest mit, der Rückblickschirm am Pult nicht — der Redner
  braucht nicht zu lesen, was er gerade selbst sagt.
- **In jeder Ansicht.** Untertitel hängen an keinem Modus: Gesprochen wird vor der Tagesordnung
  genauso wie vor einem Kamerabild. Über dem Kamerabild rücken sie nach oben, damit sie Bauchbinde
  und Rednerreihe nicht überdecken.
- **Der Zwischenstand ist blasser.** Die Erkennung meldet erst, was sie zu hören glaubt, und
  berichtigt sich danach. Beides gleich auszuzeichnen hieße, eine Sicherheit zu behaupten, die noch
  nicht da ist.
- **Nach einem Neustart aus.** Wie der Modus: Ein Mikrofon, das sich nach einem Absturz von selbst
  wieder einschaltet, wäre eine Entscheidung, die der Rechner nicht zu treffen hat.
- **Bleibt nicht stehen.** Wird das Fenster am Hauptrechner geschlossen oder neu geladen, räumt
  eine Wache im Hauptprozess die Wand. Ein leeres Band sagt „nichts verstanden"; ein
  stehengebliebenes behauptet etwas Falsches.

**Ehrlich zur Güte:** Der Prompter braucht nur ein paar halbwegs erkannte Wörter, um sich in einem
Text wiederzufinden, der schon dasteht. Untertitel haben diesen Text nicht — sie zeigen jeden
Irrtum der Erkennung. Das kleine mitgelieferte Modell reicht für den Prompter; für Untertitel lohnt
ein größeres, und genau dafür lässt sich in den Einstellungen eines hinterlegen.

### Sprachmodelle nachladen

Bisher hieß die einzige Antwort auf „das Modell versteht mich schlecht": Gehen Sie auf die Webseite
des Anbieters, suchen Sie das richtige Archiv heraus, laden Sie es herunter, kommen Sie zurück und
hinterlegen Sie es. Drei dieser vier Schritte kann ein Programm selbst tun.

Unter **Einstellungen → Prompter** steht deshalb jetzt eine Liste bekannter Modelle mit einem
Knopf daneben. Drei Einträge, keine Suchaufgabe: zwei kleine deutsche und ein englisches für Gäste.

Das bricht **nicht** mit dem Grundsatz, dass Votura offline läuft:

- Geladen wird **nur auf Klick**. Nie beim Start, nie im Hintergrund, nie von selbst.
- Geladen wird **nur aus dieser Liste**. Der Ladeweg nimmt einen Dateinamen entgegen und schlägt
  ihn nach — keine Adresse. Eine Adresse als Argument wäre eine offene Tür.
- Geprüft wird **vor dem Tausch**: Größe und, wo hinterlegt, SHA-256. Bricht die Leitung nach
  vierzig von fünfzig Megabyte ab, bleibt das vorhandene Modell unangetastet.
- Im **Prüfpfad** steht hinterher, woher das Modell kam und welche Prüfsumme die Datei tatsächlich
  hatte.

Jeder Eintrag trägt eine **Prüfsumme** — nachgerechnet an dem, was der Server ausliefert, nicht
abgeschrieben. Die Liste zeigt an, was geprüft wird; käme je einer ohne Prüfsumme dazu, stünde dort
„nur Größe". Eine erfundene wäre schlimmer als keine: Sie behauptete eine Sicherheit, die es nicht
gibt.

**Kein großes Modell — und das ist die unangenehme Erkenntnis dieser Fassung.** Das große deutsche
Modell mit zwei Gigabyte stand kurz auf der Liste, empfohlen für Untertitel. Es lädt sauber
herunter, es wird geprüft, es wird hinterlegt — und dann bleibt die Wand leer: Die Erkennung läuft
in WebAssembly und packt das Archiv in einen einzigen Speicherblock aus, der so groß nicht wird
(„Array buffer allocation failed"). Ein Knopf, der zwei Gigabyte lädt und danach zuverlässig nichts
tut, ist schlimmer als kein Knopf. Der Eintrag ist wieder verschwunden, und eine Schranke im
Quelltext hält fest, dass dort nichts Größeres hineingehört, ohne dass es jemand ausprobiert hat.

Für Untertitel heißt das: Es bleibt bei dem, was ein kleines Modell hergibt — verständlich, aber
nicht wörtlich. Mehr als jeder Modellwechsel bringt ein **Mikrofon am Pult statt eines im Raum**.

### Antragsverwaltung

„Antrag" war in Votura bisher eine **Abstimmungsart**: ein Wahlgang mit einem Beschlusstext auf dem
Stimmzettel. Das genügt für eine einzelne Sachfrage. Eine Versammlung, auf der wirklich Anträge
behandelt werden, sieht anders aus — und dafür gibt es jetzt unter **Anträge** ein Antragsbuch.

- **Nummer und Antragsteller.** Beides steht später im Protokoll, und der Antragsteller ist es, der
  übernehmen und zurückziehen kann.
- **Änderungsanträge** hängen an ihrem Hauptantrag. Über sie wird **zuerst** abgestimmt — der
  Hauptantrag kommt zuletzt, in der Fassung, die er nach den Änderungen hat.
- **Übernahme.** Nimmt der Antragsteller einen Änderungsantrag an, wird darüber nicht abgestimmt;
  sein Text gehört zum Hauptantrag. Er verschwindet aus der Abstimmungsreihenfolge und erscheint im
  Beschlusstext.
- **Beschlusstext.** Was am Ende beschlossen wurde, setzt Votura zusammen: der Antragstext plus die
  übernommenen und angenommenen Änderungen, jede einzeln benannt. Im Archiv liegt er als
  `antraege.json` bei.

Drei Entscheidungen, die dahinterstehen:

**Die Reihenfolge wird gesetzt, nicht gerechnet.** Welcher Änderungsantrag „weitergehend" ist, ist
eine Wertung der Versammlungsleitung — zwei Anträge können sich in verschiedene Richtungen weiter
vom Original entfernen. Votura schlägt den Eingang vor und lässt umordnen; ein Programm, das hier
selbst sortierte, träfe unsichtbar eine anfechtbare Entscheidung.

**Texte werden nicht ineinander verschmolzen.** Das ginge nur mit einer Vermutung darüber, welche
Stelle ein Änderungsantrag meint — und eine falsch geratene Stelle wäre ein verfälschter Beschluss.
Sie stehen untereinander, benannt und zurückverfolgbar.

**Zurückziehen und Erledigen verlangen einen Vermerk.** „Erledigt" heißt fast immer: Ein
weitergehender Änderungsantrag wurde angenommen. Ohne diesen Satz stünde im Protokoll ein Antrag,
über den nie abgestimmt wurde, und niemand wüsste mehr, warum.

**Synopse.** Bei Anträgen, die einen bestehenden Text ändern, gehört der bisherige Wortlaut daneben
— eine Satzungsänderung ohne ihn ist für die Versammlung nur die halbe Auskunft: Man liest, was
künftig gelten soll, und weiß nicht, was sich ändert.

An der Wand stehen dann zwei Spalten: links **Geltende Fassung**, rechts **beantragt**. Bei einem
Änderungsantrag entsprechend links der Hauptantrag, rechts die Änderung — das ist die Frage, über
die abgestimmt wird. Gleich breit und in derselben Schrift: Sobald eine Spalte größer wirkt, liest
der Saal sie als die wichtigere, und das wäre eine Wertung, die niemand getroffen hat.

**Zusammengeführt wird nichts.** Eine echte Gegenüberstellung Zeile für Zeile müsste erkennen,
welche Stelle ein Änderungsantrag meint. Das geht nur mit einer Vermutung — und eine falsch
geratene Stelle wäre ein verfälschter Beschluss. Es stehen deshalb zwei vollständige Texte
nebeneinander, jeder für sich lesbar.

Fehlt die geltende Fassung, gibt es keine Synopse und keinen Knopf dafür. Eine Gegenüberstellung
mit einer leeren Spalte wäre schlechter als keine.

**Und wenn das Handzeichen nicht reicht.** Den Fall kennt jede Versammlungsleitung: Zwei Reihen
heben, eine halb, und niemand mag das Ergebnis verkünden. Dann muss es schnell gehen — und der Weg
„Wahlgang anlegen, Titel abtippen, Antragstext einfügen, Verfahren wählen" ist in diesem Moment zu
lang.

**Abstimmen lassen** legt mit einem Klick einen Wahlgang als Sachabstimmung an: Bezeichnung und
Wortlaut aus dem Antrag, Ja / Nein / Enthaltung als Verfahren — und springt gleich dorthin. Von da
an läuft alles wie bei jeder anderen Abstimmung: gedruckte Stimmzettel oder digital, Auszählung,
Vier-Augen-Prinzip, Prüfpfad.

Übernommen wird beim Hauptantrag der **Beschlusstext**, also samt übernommener Änderungen — über
den wird abgestimmt, nicht über die eingereichte Fassung. Ein zweiter Wahlgang zum selben Antrag
wird abgelehnt: Zwei Abstimmungen über dieselbe Sache sind fast immer ein Versehen, und wenn nicht,
gehören sie ausdrücklich als Wiederholung angelegt. Über übernommene, zurückgezogene und erledigte
Anträge wird gar nicht erst abgestimmt.

Im Prüfpfad steht, **über welchen Wortlaut** abgestimmt wurde. Der Antragstext lässt sich danach
noch ändern, der Beschluss nicht mehr.

**Und auf den Beamer.** Ein Antragsbuch, das nicht an die Wand kommt, wäre ein halbes: Worüber
abgestimmt wird, muss im Saal lesbar sein. Auf der Antragsseite stehen dafür zwei Knöpfe, und der
Unterschied ist wichtig — **Wortlaut** zeigt den eingereichten Text, **mit Änderungen** den, über
den am Ende abgestimmt wird. Während der Debatte gilt der erste, bei der Schlussabstimmung der
zweite; ein einziger Knopf müsste raten, welcher gemeint ist.

An der Wand stehen Nummer, Titel und Antragsteller über dem Text — ein Wortlaut ohne Nummer ist für
jeden, der den Saal betritt, ein Zettel ohne Absender. Darunter: **„Abstimmung 1 von 2"**. Das sagt
dem Saal, wo er sich befindet, und der Versammlungsleitung, was noch kommt.

Lange Anträge werden in **Seiten** umbrochen — an Absatzgrenzen, solange der Absatz auf eine Seite
passt. Ein Umbruch mitten in einer Aufzählung liest sich wie ein anderer Antrag. Umbrochen wird
zentral und nicht in der Ansicht: Sonst hieße „Seite 2 von 3" auf jeder Wand etwas anderes.

Jeder Schritt — eingereicht, geändert, übernommen, umgeordnet, erledigt — geht in den Prüfpfad. Ein
Antrag ist kein Datensatz, sondern ein Vorgang; wer später fragt, was beschlossen wurde, fragt nach
diesem Weg und nicht nach dem Endstand.

### Quotenprüfung bei Listenwahlen

Viele Satzungen — bei Parteien fast alle — binden die Gültigkeit einer gewählten Liste an eine
Quote: mindestens die Hälfte Frauen, abwechselnde Besetzung der Plätze, ein Platz für die
Jugendorganisation. Wird sie verfehlt, ist die Wahl **anfechtbar** — und das fällt in aller Regel
erst auf, wenn die Versammlung längst zu Ende ist.

Votura kennt die Rangfolge und die Zahl der Plätze und rechnet die Quote deshalb nach,
**bevor** das Ergebnis festgestellt wird. Eine Minute vor dem Verkünden ist die Frage noch lösbar;
eine Woche danach nicht mehr.

Eingerichtet wird sie beim Wahlgang unter **Quote**, zwei Arten stehen zur Wahl:

- **Mindestanteil** — „mindestens die Hälfte der Plätze". Gerechnet wird **aufgerundet**: Bei fünf
  Plätzen sind es drei, nicht zweieinhalb.
- **Abwechselnd** (Reißverschluss) — ungerade Plätze für die Anspruchsgruppe. Verfehlte Plätze
  werden **einzeln** genannt: „Platz 3 und Platz 5", nicht „irgendwo in der Liste".

Drei Entscheidungen, die dahinterstehen:

**Das Merkmal ist ein freies Feld, kein Geschlecht.** Quoten richten sich je nach Satzung nach
Geschlecht, Gliederung, Alter oder Zugehörigkeit zu einer Arbeitsgemeinschaft. Eine feste Auswahl
hätte die anderen Fälle ausgeschlossen — und eine Angabe erzwungen, die nicht jede Versammlung
erheben will. Die Zuordnung eines Bewerbers ist freiwillig und erscheint nie auf dem Stimmzettel.

**Ohne Angaben wird nicht geprüft, sondern gesagt, dass nicht geprüft werden kann.** Ein „Quote
erfüllt" auf Grundlage fehlender Zuordnungen wäre die gefährlichste Auskunft, die dieses Programm
geben könnte: Sie sähe aus wie eine Prüfung und wäre keine.

**Votura hält nichts auf.** Was eine verfehlte Quote bedeutet — Wiederholung, Öffnung der Plätze,
Nachwahl oder nichts, weil niemand aus der Anspruchsgruppe angetreten ist —, steht in der Satzung
und gehört der Versammlungsleitung. Ein Programm, das die Feststellung verweigerte, hätte sich an
ihre Stelle gesetzt. Es warnt rechtzeitig, und der Befund geht beim Bestätigen **in den Prüfpfad**:
Eine Warnung, die weggeklickt wurde, ist hinterher nicht mehr auffindbar — und hinterher ist genau
der Zeitpunkt, an dem jemand fragt.

### Die Redezeit startet, wenn sie starten soll

Bisher lief die Uhr ab dem Augenblick, in dem jemand den Namen auf den Beamer legte. Das war
falsch herum: Ein Aufruf ist keine Ansage, dass jetzt gesprochen wird. Wer aufgerufen wird, steht
auf und geht nach vorn — und diese Zeit ging von seiner Redezeit ab.

Jetzt zeigt der Beamer **Name und zugestandene Zeit**, und die Uhr wartet. Losgeschickt wird sie
mit **Starten**. Das gilt auch für *Nächster*: Der rückt die Reihe weiter, startet aber nichts.

Drei Zustände, drei Wörter in der Bedienung: **Starten** für die Uhr, die noch nie lief,
**Anhalten** für die laufende, **Weiter** für die angehaltene. Und sichtbar unterschieden werden
sie auch an der Wand — eine ruhende Uhr wird gedimmt, damit ein Halt zu sehen ist; eine, die noch
gar nicht lief, nicht: Sie ist nicht unterbrochen, sondern bereit.

Am Pult gilt dasselbe: Der Lauf des Manuskripts beginnt mit dem Start der Redezeit, nicht mit dem
Aufruf.

### Nutzungsbedingungen — zum ersten Mal

Votura wird ab dieser Fassung unter **[Nutzungsbedingungen](NUTZUNGSBEDINGUNGEN.md)** weitergegeben.
Sie liegen jedem Paket bei und werden beim Installieren zur Zustimmung vorgelegt.

Der Anlass ist die mitgelieferte NDI-Laufzeit: Deren Lizenz verlangt in §3d, dass die Weitergabe
„under the terms of a license agreement" geschieht, und dass dieses Abkommen acht bestimmte
Klauseln enthält. Eine Datei im Programmordner ist keine Vereinbarung — eine Seite, auf der jemand
zustimmt, ist eine.

Was darüber hinausgeht, ist knapp gehalten und sagt vor allem, was erlaubt ist: **kostenlos laden,
betreiben und weitergeben**, von wem auch immer, auf beliebig vielen Rechnern, ohne Anmeldung. Nicht
erlaubt ist, das Programm zu verändern, es zu verkaufen oder vorkonfigurierte Geräte damit zu
verkaufen. Für den **Quelltext** ändert sich nichts: alle Rechte vorbehalten.

Ein Punkt steht dort, der kein Kleingedrucktes ist: **Die Verantwortung für die Wahl bleibt bei der
Versammlung.** Votura ist ein Werkzeug; ob ein Wahlgang gültig ist, entscheidet die Satzung und die
Versammlungsleitung.

### Behoben

- **Das Kamerabild brauchte Sekunden, bis es an der Wand stand.** Die Suche kennt die Adresse, unter
  der eine Kamera sendet — gab sie aber nicht an den Empfänger weiter, der daraufhin selbst noch
  einmal suchte. Gemessen, im Wechsel und wiederholt: **4017 Millisekunden ohne die Adresse, 14 mit
  ihr.** Sie wandert jetzt mit. Solange noch kein Bild gekommen ist, steht „verbindet …“ im Bild
  und nicht „kein Bild“ — das eine schickt niemanden zur Kamera, wo nichts zu suchen ist.
- **Die Kameraliste fing bei jedem Blick von vorn an.** Beim Verlassen der Karte wurde die Suche
  sofort abgeschaltet und alles Gefundene weggeworfen. Dahinter stand die Sorge, NDI dürfe im Saal
  nicht dauernd laufen — die gilt aber dem **Videostrom** mit seinen über hundert Megabit je
  Sekunde, nicht der Suche, die ein paar Pakete verschickt. Die Suche läuft jetzt eine Minute nach,
  und einmal gefundene Kameras bleiben in der Liste stehen.

- **Jeder Wechsel der Ansicht setzte die Redezeit zurück.** Wer während einer
  laufenden Redezeit kurz die Tagesordnung, die Kandidatenliste oder das Kamerabild zeigte und
  danach zurückschaltete, hatte denselben Menschen vor sich — und schenkte ihm mit dem Rückweg
  stillschweigend seine volle Zeit noch einmal. Der Grund stand als Absicht im Programm: Die
  Vorstellung überlebte einen Ansichtswechsel nicht. Das war falsch. **Dass da vorne jemand steht
  und spricht, hat nichts damit zu tun, was gerade an der Wand hängt** — die Uhr gehört zu der
  Person. Sie läuft jetzt weiter, eine angehaltene bleibt angehalten, und die Reihe der nächsten
  Redner bleibt stehen. Beendet wird eine Vorstellung ausdrücklich (**Beenden**) oder dadurch, dass
  jemand anderes aufgerufen wird; ein Neustart räumt ohnehin auf. Wer dieselbe Person neu beginnen
  lassen will, sagt es mit **Zeit neu**; eine geänderte Redezeit zählt ohnehin als Entscheidung.
- **Im Kameramodus ließ sich die Redezeit nicht mehr anfassen.** Die Bauchbinde zeigte eine
  laufende Uhr, aber Anhalten, Zeit geben und „Nächster“ waren gesperrt — sie fragten nach der
  Ansicht statt nach dem Redner. Jetzt gelten die Griffe, solange jemand aufgerufen ist, und die
  Bedienung zeigt sie auch dann.

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

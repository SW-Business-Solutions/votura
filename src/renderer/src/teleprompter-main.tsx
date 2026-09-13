/**
 * Der Teleprompter.
 *
 * Zwei Bezugswege, dieselbe Ansicht:
 * - im Fenster am Hauptrechner über die Preload-Brücke,
 * - im Browser eines Geräts am Pult über `/prompter` und Server-Sent-Events.
 *
 * ## Warum die Uhr den Lauf bestimmt
 *
 * Die Stelle im Text ergibt sich aus `position + verstrichene Zeit × Tempo`.
 * Jedes Gerät rechnet sie selbst aus — auch eines, das erst mitten in der
 * Rede dazukommt. Ein Zähler, der Befehle verschickt, verlöre genau dort den
 * Anschluss.
 *
 * ## Warum in Zeilenhöhen gemessen wird
 *
 * Ein Telefon am Pult, ein Tablet im Spiegel und der Bildschirm der
 * Wahlleitung haben verschiedene Flächen und verschiedene Schriftgrößen. In
 * Pixeln gemessen stünde jedes woanders. In Zeilenhöhen stehen alle an
 * derselben Stelle im Text.
 */
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { ApiMethod, ApiParams, ApiResult } from "@shared/ipc";
import {
  blockGewicht,
  prompterAmEnde,
  prompterPosition,
  PROMPTER_VORGABE,
  redeBloecke,
  SCHRIFT_MAX,
  SCHRIFT_MIN,
  TEMPO_MAX,
  TEMPO_MIN,
  type PrompterViewState,
  type RedeBlock,
} from "@shared/speech";
import { HAUPTBUEHNE, type ProjectionState } from "@shared/projection";
import {
  presentationKind,
  presentationPath,
  presentationUrl,
} from "@shared/presentation";
import { FolienVorschau } from "./prompter/FolienVorschau";
import "./styles/teleprompter.css";

interface TeleprompterBridge {
  invoke<M extends ApiMethod>(
    method: M,
    ...args: ApiParams<M>
  ): Promise<ApiResult<M>>;
  onViewChange(callback: (state: PrompterViewState) => void): () => void;
  /** Der Projektionszustand — nur zum Anzeigen der laufenden Folien. */
  onProjectionChange(
    callback: (nachricht: { buehne: number; state: ProjectionState }) => void,
  ): () => void;
  beamerSize(
    callback: (size: { width: number; height: number }) => void,
  ): () => void;
}

declare global {
  interface Window {
    teleprompter?: TeleprompterBridge;
  }
}

/** Im Netz gibt es keine Brücke — dann läuft alles über den Server. */
async function rufeUeberNetz<M extends ApiMethod>(
  method: M,
  ...args: ApiParams<M>
): Promise<ApiResult<M>> {
  const antwort = await fetch("/api/remote/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  const body = (await antwort.json()) as {
    ok: boolean;
    data?: unknown;
    error?: string;
  };
  if (!body.ok) throw new Error(body.error ?? "Der Aufruf ist fehlgeschlagen.");
  return body.data as ApiResult<M>;
}

function useView(): {
  view: PrompterViewState;
  getrennt: boolean;
  imFenster: boolean;
} {
  const [view, setView] = useState<PrompterViewState>(PROMPTER_VORGABE);
  const [getrennt, setGetrennt] = useState(false);
  const imFenster = Boolean(window.teleprompter);

  useEffect(() => {
    const bridge = window.teleprompter;
    if (bridge) {
      void bridge.invoke("prompter.view").then(setView);
      return bridge.onViewChange(setView);
    }

    let quelle: EventSource | null = null;
    let erneut: number | undefined;
    let bekannteKennung: string | null = null;

    const verbinde = (): void => {
      quelle = new EventSource("/api/prompter/stream");
      quelle.onmessage = (nachricht) => {
        setGetrennt(false);
        const naechster = JSON.parse(nachricht.data) as PrompterViewState;
        /* Nach einem Neustart der Anwendung läuft diese Seite womöglich mit
           altem Programmstand — dann lädt sie sich einmalig selbst neu. */
        if (naechster.serverInstanceId) {
          if (
            bekannteKennung &&
            bekannteKennung !== naechster.serverInstanceId
          ) {
            window.location.reload();
            return;
          }
          bekannteKennung = naechster.serverInstanceId;
        }
        setView(naechster);
      };
      quelle.onerror = () => {
        setGetrennt(true);
        quelle?.close();
        erneut = window.setTimeout(verbinde, 3000);
      };
    };
    verbinde();

    return () => {
      if (erneut) window.clearTimeout(erneut);
      quelle?.close();
    };
  }, []);

  return { view, getrennt, imFenster };
}

/**
 * Was gerade an der Wand steht — nur für die Vortragsansicht.
 *
 * Im Fenster über die Brücke, im Netz über denselben rein lesenden Strom, den
 * auch die Beameransicht benutzt. Abonniert wird erst, wenn die Vortragsansicht
 * eingeschaltet ist: Solange der Text läuft, geht es niemanden etwas an, was
 * auf dem Beamer passiert.
 */
function useProjektion(aktiv: boolean): Record<number, ProjectionState> {
  const [zustaende, setZustaende] = useState<Record<number, ProjectionState>>(
    {},
  );

  useEffect(() => {
    if (!aktiv) return;
    const bridge = window.teleprompter;
    if (bridge) {
      void bridge
        .invoke("projection.buehnen")
        .then(async (buehnen) => {
          const paare = await Promise.all(
            buehnen.map(
              async (stage) =>
                [
                  stage.id,
                  await bridge.invoke("projection.state", stage.id),
                ] as const,
            ),
          );
          setZustaende(Object.fromEntries(paare));
        })
        .catch(() => undefined);
      return bridge.onProjectionChange(({ buehne, state }) =>
        setZustaende((current) => ({ ...current, [buehne]: state })),
      );
    }

    /* Im Netz: der Strom der Hauptbühne genügt — dort liegt der Foliensatz
       im Regelfall, und mehr Leitungen kosten nur. */
    const quelle = new EventSource(
      `/api/projection/stream?buehne=${HAUPTBUEHNE}`,
    );
    quelle.onmessage = (nachricht) =>
      setZustaende({
        [HAUPTBUEHNE]: JSON.parse(nachricht.data) as ProjectionState,
      });
    return () => quelle.close();
  }, [aktiv]);

  return zustaende;
}

/** Restzeit als m:ss — dieselbe Darstellung wie auf dem Beamer. */
function restzeit(
  until: string | undefined,
  jetzt: number,
): string | undefined {
  if (!until) return undefined;
  const sekunden = Math.max(0, Math.round((Date.parse(until) - jetzt) / 1000));
  return `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, "0")}`;
}

function Block({ block }: { block: RedeBlock }): React.JSX.Element {
  switch (block.art) {
    case "ueberschrift":
      return (
        <p className={`tp-ueberschrift ebene-${block.ebene ?? 1}`}>
          {block.text}
        </p>
      );
    case "punkt":
      return (
        <p className="tp-punkt">
          <span aria-hidden="true">•</span> {block.text}
        </p>
      );
    case "zitat":
      return <p className="tp-zitat">{block.text}</p>;
    case "pause":
      return <p className="tp-pause" aria-hidden="true" />;
    default:
      return <p className="tp-absatz">{block.text}</p>;
  }
}

function TeleprompterApp(): React.JSX.Element {
  const { view, getrennt, imFenster } = useView();
  const [jetzt, setJetzt] = useState(() => Date.now());
  const [meldung, setMeldung] = useState<string | undefined>();
  const flaeche = useRef<HTMLDivElement>(null);
  /*
   * Oberkante und Höhe jedes Blocks.
   *
   * Gerechnet wird in Wörtern, gerollt in Bildpunkten. Die Brücke zwischen
   * beidem ist diese Messung: Sie sagt, wo der Block mit dem gesuchten Wort
   * steht und wie hoch er ist — der Rest ist eine Interpolation innerhalb des
   * Blocks. Auf jedem Gerät ergibt derselbe Wortindex so dieselbe Textstelle,
   * auch wenn der Absatz dort über doppelt so viele Zeilen läuft.
   */
  const [masse, setMasse] = useState<{ oben: number; hoehe: number }[]>([]);
  const [beamer, setBeamer] = useState({ width: 1920, height: 1080 });

  /* 20 Bilder je Sekunde reichen für ruhiges Rollen und lassen den Rechner in
     Frieden; der Text bewegt sich langsamer, als das Auge folgt. */
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, []);

  const bloecke = useMemo(
    () => redeBloecke(view.speech?.markdown ?? ""),
    [view.speech?.markdown],
  );
  const vortrag = view.ansicht === "vortrag";
  const projektionen = useProjektion(vortrag);

  useEffect(() => {
    const bridge = window.teleprompter;
    if (!bridge) return;
    return bridge.beamerSize(setBeamer);
  }, []);

  /*
   * Ein Fehlschlag wird gezeigt, nicht verschluckt.
   *
   * Ein stiller Abfang hat hier schon einmal einen Knopf tot aussehen lassen,
   * ohne dass jemand merkte, warum. Am Pult genügt eine kurze Meldung in der
   * Leiste — sie geht von selbst wieder weg und verdeckt den Text nicht.
   */
  const rufe = useCallback(
    async <M extends ApiMethod>(
      method: M,
      ...args: ApiParams<M>
    ): Promise<void> => {
      try {
        if (window.teleprompter)
          await window.teleprompter.invoke(method, ...args);
        else await rufeUeberNetz(method, ...args);
        setMeldung(undefined);
      } catch (fehler) {
        setMeldung(fehler instanceof Error ? fehler.message : String(fehler));
        window.setTimeout(() => setMeldung(undefined), 6000);
      }
    },
    [],
  );

  /* Die Schriftgröße hängt an der Höhe der Fläche, nicht an einer festen
     Punktzahl: Derselbe Text soll auf dem Telefon und auf dem Pultmonitor
     gleich viele Zeilen haben. */
  const schriftGroesse = `${view.schrift}vh`;

  useEffect(() => {
    const element = flaeche.current;
    if (!element) return;
    const messen = (): void => {
      const absaetze = [...element.querySelectorAll<HTMLElement>("p")];
      setMasse(
        absaetze.map((absatz) => ({
          oben: absatz.offsetTop,
          hoehe: absatz.offsetHeight,
        })),
      );
    };
    messen();
    /* Fenstergröße, Schrift und Textbreite ändern den Umbruch — dann muss neu
       gemessen werden, sonst zeigt die Lesezeile auf die falsche Stelle. */
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    return () => beobachter.disconnect();
  }, [view.schrift, view.breite, bloecke]);

  const stelle = prompterPosition(view, jetzt);
  const amEnde = prompterAmEnde(view, jetzt);

  /* Wortindex → Bildpunkt: den Block suchen, in dem das Wort liegt, und
     innerhalb des Blocks anteilig weiterrücken. */
  const versatz = ((): number => {
    if (masse.length === 0) return 0;
    let gezaehlt = 0;
    for (let index = 0; index < bloecke.length; index++) {
      const gewicht = blockGewicht(bloecke[index]);
      const mass = masse[index];
      if (!mass) break;
      if (stelle < gezaehlt + gewicht) {
        const anteil = (stelle - gezaehlt) / gewicht;
        return mass.oben + anteil * mass.hoehe;
      }
      gezaehlt += gewicht;
    }
    const letzte = masse[masse.length - 1];
    return letzte.oben + letzte.hoehe;
  })();

  useEffect(() => {
    /* Ist die Bedienung am Pult abgeschaltet, tun auch die Tasten nichts —
       sonst wäre die fehlende Leiste nur eine Kulisse. */
    if (!view.bedienbar) return;
    function taste(event: KeyboardEvent): void {
      switch (event.key) {
        case " ":
        case "Enter":
          event.preventDefault();
          void rufe("prompter.setRunning", !view.running);
          break;
        case "ArrowDown":
        case "PageDown":
          event.preventDefault();
          void rufe("prompter.nudge", event.key === "PageDown" ? 8 : 1);
          break;
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          void rufe("prompter.nudge", event.key === "PageUp" ? -8 : -1);
          break;
        case "Home":
          event.preventDefault();
          void rufe("prompter.setPosition", 0);
          break;
        case "+":
          event.preventDefault();
          void rufe("prompter.setTempo", Math.min(TEMPO_MAX, view.tempo + 10));
          break;
        case "-":
          event.preventDefault();
          void rufe("prompter.setTempo", Math.max(TEMPO_MIN, view.tempo - 10));
          break;
        case "m":
        case "M":
          event.preventDefault();
          void rufe("prompter.setDarstellung", {
            spiegel: { ...view.spiegel, horizontal: !view.spiegel.horizontal },
          });
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [rufe, view.running, view.tempo, view.spiegel, view.bedienbar]);

  const rest = restzeit(view.until, jetzt);

  /*
   * Vortragsansicht: dieselbe Folie wie an der Wand, daneben die nächste.
   *
   * Wer frei spricht, braucht kein Manuskript, sondern den Blick auf das, was
   * das Publikum gerade sieht — und auf das, was gleich kommt.
   */
  if (vortrag) {
    const buehne =
      Object.keys(projektionen)
        .map(Number)
        .sort((a, b) => a - b)
        .find(
          (id) =>
            projektionen[id]?.mode === "presentation" &&
            projektionen[id]?.presentation,
        ) ?? HAUPTBUEHNE;
    const laufend = projektionen[buehne]?.presentation;
    const art = laufend ? presentationKind(laufend) : "html";
    const quelle = laufend
      ? imFenster
        ? presentationUrl(laufend.id, art)
        : presentationPath(laufend.id, art, buehne)
      : undefined;
    const folie = laufend?.slide ?? 1;
    const letzte = laufend?.slideCount ? folie >= laufend.slideCount : false;

    return (
      <div className="tp tp-vortrag">
        {laufend && quelle ? (
          <div className="tp-folien">
            <section>
              <h2>Auf dem Beamer</h2>
              <FolienVorschau
                presentationId={laufend.id}
                quelle={quelle}
                art={art}
                slide={folie}
                beamer={beamer}
                gross
              />
            </section>
            <section>
              <h2>Als Nächstes</h2>
              {letzte ? (
                <div className="tp-ende-folie">Letzte Folie</div>
              ) : (
                <FolienVorschau
                  presentationId={laufend.id}
                  quelle={quelle}
                  art={art}
                  slide={folie + 1}
                  beamer={beamer}
                />
              )}
            </section>
          </div>
        ) : (
          <div className="tp-leer">
            <h1>Gerade läuft keine Präsentation</h1>
            <p>
              Sobald ein Foliensatz auf einer Bühne liegt, erscheint er hier.
            </p>
          </div>
        )}
        <div className="tp-leiste">
          <span className="tp-stand">
            <strong>{folie}</strong>
            <span> / {laufend?.slideCount ?? "?"}</span>
          </span>
          {view.bedienbar && view.speech && (
            <button
              type="button"
              onClick={() => void rufe("prompter.setAnsicht", "rede")}
            >
              Zum Redetext
            </button>
          )}
          {meldung && <span className="tp-getrennt">{meldung}</span>}
          {view.zeigeUhr && rest && <span className="tp-uhr">{rest}</span>}
          {getrennt && (
            <span className="tp-getrennt">Verbindung unterbrochen</span>
          )}
        </div>
      </div>
    );
  }

  if (!view.speech) {
    return (
      <div className="tp-leer">
        <h1>Keine Rede auf dem Prompter</h1>
        <p>
          Im Hauptfenster unter <strong>Prompter</strong> eine Rede auswählen
          und auf
          <strong> Auf den Prompter</strong> schalten. Dieses Fenster folgt dann
          von selbst.
        </p>
        {getrennt && <p className="tp-getrennt">Verbindung unterbrochen</p>}
      </div>
    );
  }

  const spiegelung = [
    view.spiegel.horizontal ? "scaleX(-1)" : "",
    view.spiegel.vertikal ? "scaleY(-1)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="tp">
      <div
        className="tp-spiegel"
        style={{ transform: spiegelung || undefined, fontSize: schriftGroesse }}
      >
        {/* Die Lesezeile: Wer den Blick hebt, findet die Stelle daran wieder. */}
        <div
          className="tp-leselinie"
          style={{ top: `${view.leselinie}%` }}
          aria-hidden="true"
        />
        <div
          className="tp-lauf"
          ref={flaeche}
          style={{
            width: `${view.breite}%`,
            /* Waagerecht über die Verschiebung mitten setzen — ein fester
               Rand aus dem Stylesheet passte nur zu einer Breite. */
            transform: `translate(-50%, calc(${view.leselinie}vh - ${versatz}px))`,
          }}
        >
          {bloecke.map((block, index) => (
            <Block key={index} block={block} />
          ))}
          {/* Am Ende Luft, damit der letzte Satz die Lesezeile erreicht. */}
          <div style={{ height: "60vh" }} aria-hidden="true" />
        </div>
      </div>

      <div className="tp-leiste">
        {view.bedienbar && (
          <>
            <button
              type="button"
              className={view.running ? "tp-halt" : "tp-los"}
              onClick={() => void rufe("prompter.setRunning", !view.running)}
            >
              {/* Am Ende sagt der Knopf, was er tut: von vorn. Sonst sähe es aus,
              als sei er kaputt — er zählt ja nicht weiter. */}
              {view.running ? "Anhalten" : amEnde ? "Von vorn" : "Starten"}
            </button>
            <button
              type="button"
              onClick={() => void rufe("prompter.nudge", -4)}
              aria-label="Zurück"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => void rufe("prompter.nudge", 4)}
              aria-label="Vor"
            >
              ▼
            </button>
            <label>
              Tempo
              <input
                type="range"
                min={TEMPO_MIN}
                max={TEMPO_MAX}
                step={5}
                value={view.tempo}
                onChange={(event) =>
                  void rufe("prompter.setTempo", Number(event.target.value))
                }
              />
              <span className="tp-wert">{view.tempo}</span>
            </label>
            <label>
              Schrift
              <input
                type="range"
                min={SCHRIFT_MIN}
                max={SCHRIFT_MAX}
                step={0.5}
                value={view.schrift}
                onChange={(event) =>
                  void rufe("prompter.setDarstellung", {
                    schrift: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              type="button"
              className={view.spiegel.horizontal ? "aktiv" : ""}
              title="Für den Prompterspiegel seitenverkehrt"
              onClick={() =>
                void rufe("prompter.setDarstellung", {
                  spiegel: {
                    ...view.spiegel,
                    horizontal: !view.spiegel.horizontal,
                  },
                })
              }
            >
              Spiegel
            </button>
            <button
              type="button"
              className={view.spiegel.vertikal ? "aktiv" : ""}
              title="Wenn das Gerät über Kopf hängt"
              onClick={() =>
                void rufe("prompter.setDarstellung", {
                  spiegel: {
                    ...view.spiegel,
                    vertikal: !view.spiegel.vertikal,
                  },
                })
              }
            >
              Über Kopf
            </button>
            <button
              type="button"
              title="Statt des Textes die laufenden Folien zeigen"
              onClick={() => void rufe("prompter.setAnsicht", "vortrag")}
            >
              Folien
            </button>
          </>
        )}
        {amEnde && <span className="tp-ende">Ende der Rede</span>}
        {meldung && <span className="tp-getrennt">{meldung}</span>}
        {view.zeigeUhr && rest && <span className="tp-uhr">{rest}</span>}
        {getrennt && (
          <span className="tp-getrennt">Verbindung unterbrochen</span>
        )}
        {!imFenster && !getrennt && (
          <span className="tp-netz">Netzansicht</span>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <TeleprompterApp />
  </StrictMode>,
);

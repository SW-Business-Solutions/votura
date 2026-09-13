/**
 * Vortragssteuerung — was die vortragende Person vor sich hat.
 *
 * Links die Folie, die das Publikum gerade sieht; rechts die, die als
 * Nächstes kommt. Darunter Position, Uhrzeit und die Zeit seit Beginn des
 * Vortrags.
 *
 * ## Warum zwei Rahmen dieselbe Datei laden
 *
 * Beide Vorschauen sind eigene `<iframe>` auf dasselbe Dokument — der eine
 * steht auf der aktuellen Folie, der andere eine weiter. Das kostet ein
 * zweites Mal Ladezeit, dafür ist die Vorschau **echt**: Sie zeigt genau das,
 * was gleich an der Wand steht, samt Schriften, Bildern und Umbrüchen. Ein
 * nachgebautes Miniaturbild wäre schneller und gelegentlich falsch — und
 * falsch ist hier schlimmer als langsam.
 *
 * ## Warum dieses Fenster die Tastatur bekommt
 *
 * Es ist ein eigenes Fenster und keine Seite im Hauptfenster. Dort sind die
 * Pfeiltasten längst vergeben — sie bewegen sich durch Kandidatenlisten. Hier
 * gehören sie dem Vortrag, und das Fenster nimmt sie, sobald es vorn liegt.
 */
import { StrictMode, useCallback, useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { presentationKind, presentationUrl } from '@shared/presentation'
import { FolienVorschau } from './prompter/FolienVorschau'
import {
  BUEHNE_VORGABE,
  EMPTY_PROJECTION_STATE,
  HAUPTBUEHNE,
  type Buehne,
  type ProjectionState
} from '@shared/projection'
import './styles/prompter.css'

interface PrompterBridge {
  getInitialState(stage?: number): Promise<ProjectionState>
  getStages(): Promise<{ buehnen: Buehne[]; zustaende: Record<number, ProjectionState> }>
  onStateChange(callback: (nachricht: { buehne: number; state: ProjectionState }) => void): () => void
  goto(slide: number, stage?: number | number[]): void
  setStage(stage: number): void
  report(slide: number, slideCount: number, stage?: number | number[]): void
  onBeamerSize(callback: (size: { width: number; height: number }) => void): () => void
}

declare global {
  interface Window {
    prompter?: PrompterBridge
  }
}

function Uhr(): JSX.Element {
  const [jetzt, setJetzt] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span>{jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
}

/** Zeit seit dem Aufruf der Präsentation — nicht seit dem Programmstart. */
function Stoppuhr({ seit }: { seit: number }): JSX.Element {
  const [jetzt, setJetzt] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const sekunden = Math.max(0, Math.floor((jetzt - seit) / 1000))
  const min = Math.floor(sekunden / 60)
  const sek = sekunden % 60
  return (
    <span>
      {String(min).padStart(2, '0')}:{String(sek).padStart(2, '0')}
    </span>
  )
}

/**
 * Auf welchen Bühnen läuft ein Foliensatz?
 *
 * Die Vortragssteuerung soll niemand einstellen müssen: Wird eine
 * Präsentation aufgerufen, folgt sie ihr — und zwar **allen** Wänden, die sie
 * zeigen. Läuft derselbe Foliensatz auf zwei Bühnen, muss ein Tastendruck
 * beide weiterschalten; sonst stehen sie nach der ersten Folie auseinander.
 */
function buehnenMitFoliensatz(
  zustaende: Record<number, ProjectionState>,
  buehnen: Buehne[]
): number[] {
  const mitFolien = buehnen
    .map((stage) => stage.id)
    .sort((a, b) => a - b)
    .filter((id) => zustaende[id]?.mode === 'presentation' && zustaende[id]?.presentation)
  /*
   * Nur Bühnen mit **demselben** Dokument.
   *
   * Liegen zwei verschiedene Foliensätze auf zwei Wänden, wäre eine
   * gemeinsame Foliennummer sinnlos: Folie 7 des einen hat mit Folie 7 des
   * anderen nichts zu tun. Dann bleibt es bei der ersten, und die Auswahl im
   * Fuß entscheidet über den Rest.
   */
  const erste = mitFolien[0]
  if (erste === undefined) return []
  const dokument = zustaende[erste]?.presentation?.id
  return mitFolien.filter((id) => zustaende[id]?.presentation?.id === dokument)
}

function PrompterApp(): JSX.Element {
  const [buehnen, setBuehnen] = useState<Buehne[]>([{ ...BUEHNE_VORGABE }])
  const [zustaende, setZustaende] = useState<Record<number, ProjectionState>>({})
  /*
   * Von Hand gewählt schlägt automatisch — aber nur, solange dort etwas läuft.
   * `null` heißt „alle, auf denen der Foliensatz liegt".
   */
  const [gewaehlt, setGewaehlt] = useState<number | null>(null)
  const [seit, setSeit] = useState(() => Date.now())
  /* Bis der Hauptprozess die wirkliche Größe meldet, gilt das gängige
     Beamerformat — so steht nie ein leerer Kasten da. */
  const [beamer, setBeamer] = useState({ width: 1920, height: 1080 })

  useEffect(() => {
    const bridge = window.prompter
    if (!bridge) return
    void bridge.getStages().then((schnappschuss) => {
      setBuehnen(schnappschuss.buehnen)
      setZustaende(schnappschuss.zustaende)
    })
    const abState = bridge.onStateChange(({ buehne: id, state: neu }) =>
      setZustaende((current) => ({ ...current, [id]: neu }))
    )
    const abGroesse = bridge.onBeamerSize(setBeamer)
    return () => {
      abState()
      abGroesse()
    }
  }, [])

  const laufende = buehnenMitFoliensatz(zustaende, buehnen)
  /* Worauf geblättert wird: die eine gewählte Bühne, sonst alle laufenden. */
  const ziel =
    gewaehlt !== null && zustaende[gewaehlt]?.mode === 'presentation'
      ? [gewaehlt]
      : laufende.length > 0
        ? laufende
        : [gewaehlt ?? HAUPTBUEHNE]
  const buehne = ziel[0]
  const state = zustaende[buehne] ?? EMPTY_PROJECTION_STATE

  /* Der Hauptprozess misst die Größe des Beamerfensters dieser Bühne. */
  useEffect(() => {
    window.prompter?.setStage(buehne)
  }, [buehne])

  /*
   * Was der Foliensatz über sich meldet, an den Hauptprozess geben.
   *
   * Ohne diesen Weg bliebe die Gesamtzahl unbekannt, und die Steuerung zählte
   * über das Ende des Vortrags hinaus weiter.
   */
  const zielSchluessel = ziel.join(',')
  const melde = useCallback(
    (folie: number, anzahl: number) => {
      window.prompter?.report(folie, anzahl, zielSchluessel.split(',').map(Number))
    },
    [zielSchluessel]
  )

  const praesentation = state.presentation
  const folie = praesentation?.slide ?? 1
  const anzahl = praesentation?.slideCount
  const laeuft = state.mode === 'presentation' && Boolean(praesentation)

  /* Die Stoppuhr beginnt, wenn eine andere Präsentation aufgerufen wird. */
  useEffect(() => {
    if (praesentation?.id) setSeit(Date.now())
  }, [praesentation?.id])

  const springe = useCallback(
    (folie: number) => {
      if (!laeuft) return
      const grenze = anzahl ?? Number.MAX_SAFE_INTEGER
      window.prompter?.goto(
        Math.max(1, Math.min(folie, grenze)),
        zielSchluessel.split(',').map(Number)
      )
    },
    [laeuft, anzahl, zielSchluessel]
  )

  const weiter = useCallback(() => springe(folie + 1), [springe, folie])
  const zurueck = useCallback(() => springe(folie - 1), [springe, folie])

  useEffect(() => {
    function taste(event: KeyboardEvent): void {
      /* In einem Eingabefeld gehören die Tasten dem Feld. */
      const ziel = event.target as HTMLElement | null
      if (ziel && /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName)) return

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          event.preventDefault()
          weiter()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          event.preventDefault()
          zurueck()
          break
        case 'Home':
          event.preventDefault()
          springe(1)
          break
        case 'End':
          event.preventDefault()
          if (anzahl) springe(anzahl)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [weiter, zurueck, springe, anzahl])

  if (!laeuft) {
    return (
      <div className="prompter-leer">
        <h1>Keine Präsentation auf dem Beamer</h1>
        <p>
          Im Hauptfenster unter <strong>Beamer</strong> eine Präsentation auswählen und auf
          <strong> Präsentation</strong> umschalten. Dieses Fenster folgt dann von selbst.
        </p>
      </div>
    )
  }

  const letzte = anzahl ? folie >= anzahl : false

  return (
    <div className="prompter">
      <div className="prompter-buehne">
        <section className="prompter-jetzt">
          <h2>Auf dem Beamer</h2>
          <FolienVorschau
            presentationId={praesentation!.id}
            quelle={presentationUrl(praesentation!.id, presentationKind(praesentation!))}
            art={presentationKind(praesentation!)}
            slide={folie}
            beamer={beamer}
            onReport={melde}
            gross
          />
        </section>
        <section className="prompter-naechste">
          <h2>Als Nächstes</h2>
          {letzte ? (
            <div className="prompter-ende">Letzte Folie</div>
          ) : (
            <FolienVorschau
              presentationId={praesentation!.id}
              quelle={presentationUrl(praesentation!.id, presentationKind(praesentation!))}
              art={presentationKind(praesentation!)}
              slide={folie + 1}
              beamer={beamer}
            />
          )}
        </section>
      </div>

      <footer className="prompter-leiste">
        <div className="prompter-stand">
          <strong>{folie}</strong>
          <span> / {anzahl ?? '?'}</span>
          <em>{praesentation?.title}</em>
          {/* Nur zeigen, wenn es überhaupt etwas zu wählen gibt — bei einer
              Bühne wäre die Auswahl eine Frage ohne Antwortmöglichkeit. */}
          {buehnen.length > 1 && (
            <select
              className="prompter-buehnenwahl"
              value={gewaehlt === null ? 'alle' : String(gewaehlt)}
              title="Welche Bühnen diese Steuerung blättert"
              onChange={(event) =>
                setGewaehlt(event.target.value === 'alle' ? null : Number(event.target.value))
              }
            >
              {/* Vorgabe: alle Wände, auf denen der Foliensatz liegt. Nur so
                  bleiben zwei Beamer beim Blättern beieinander. */}
              <option value="alle">
                {laufende.length > 1
                  ? `Alle ${laufende.length} mit Foliensatz`
                  : 'Alle mit Foliensatz'}
              </option>
              {buehnen.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  nur {stage.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="prompter-zeiten">
          <span title="Uhrzeit">
            <Uhr />
          </span>
          <span title="Seit Beginn der Präsentation">
            ⏱ <Stoppuhr seit={seit} />
          </span>
        </div>

        <div className="prompter-knoepfe">
          <button type="button" onClick={zurueck} disabled={folie <= 1} aria-label="Vorige Folie">
            ←
          </button>
          <button type="button" onClick={weiter} disabled={letzte} aria-label="Nächste Folie">
            →
          </button>
        </div>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PrompterApp />
  </StrictMode>
)

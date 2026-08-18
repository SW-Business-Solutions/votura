/**
 * Beameransicht — dieselbe Komponente für Vollbild (Audience) und Vorschau im
 * Operator (Beamer §37), damit es keine Layoutabweichung geben kann.
 *
 * Es werden ausschließlich Projektions-DTOs dargestellt: keine IDs, keine
 * Hashes, keine Batch-Nummern, keine administrativen Angaben (Beamer §38).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { formatDateDe } from '@shared/format'
import {
  DEFAULT_PROJECTION_THEME,
  FINAL_DECISION_LABELS,
  paginateCandidates,
  projectionColumns,
  projectionPageSize,
  projectionResultColumns,
  projectionResultPageCount,
  projectionResultPageSize,
  type ProjectionCandidate,
  type ProjectionState
} from '@shared/projection'

/** Zeilen je Spalte, bevor die Tagesordnung auf mehrere Seiten wechselt. */
const AGENDA_PAGE_SIZE = 16
/** Ab dieser Anzahl wird zweispaltig gesetzt, damit die Schrift groß bleibt. */
const AGENDA_TWO_COLUMNS_FROM = 10

export interface ProjectionScreenProps {
  state: ProjectionState
  preview?: boolean
  /** Warnhinweis, wenn die Verbindung zur Quelle abgerissen ist. */
  disconnected?: boolean
}

/** Grenzen der automatischen Anpassung: nie unter die Hälfte, nie über das Anderthalbfache. */
const FIT_MIN = 0.5
const FIT_MAX = 1.5
/** Ab diesem Füllgrad gilt das Bild als gut ausgenutzt. */
const FIT_TARGET = 0.92

/**
 * Passt den Bildinhalt an die tatsächlich verfügbare Höhe an.
 *
 * Die Größen im Beamerbild sind auf die Bildhöhe gerechnet — diese Rechnung
 * trifft aber nie jede Kombination aus Namenslänge, Schriftskalierung,
 * Erläuterungstext und Fenstergröße. Deshalb wird nach dem Zeichnen gemessen:
 * Passt der Inhalt nicht, wird er verkleinert; bleibt viel Platz frei (etwa
 * eine Feststellung mit zwei Namen), wird er vergrößert, damit das Bild nicht
 * halb leer bleibt.
 */
function useFitToBody(trigger: unknown): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = ref.current
    const body = box?.parentElement
    if (!box || !body) return

    let frame = 0
    let scale = 1
    let steps = 0
    // Einmal eingeschlagene Richtung beibehalten – sonst könnte die Anzeige
    // zwischen zwei Größen hin- und herspringen, wenn ein Name umbricht.
    let direction: 'none' | 'up' | 'down' = 'none'

    /** Verfügbare Höhe ohne Innenabstand des Bildbereichs. */
    const available = (): number => {
      const style = getComputedStyle(body)
      return body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    }

    const apply = (value: number): void => {
      scale = value
      box.style.setProperty('--fit', String(value))
    }

    /*
     * Bricht ein Name auf zwei Zeilen um? Beim Vergrößern wächst die Schrift,
     * die Spaltenbreite aber nur begrenzt mit — ein umgebrochener Name ist das
     * sichere Zeichen, einen Schritt zu weit gegangen zu sein.
     */
    const umbruch = (): boolean =>
      Array.from(box.querySelectorAll<HTMLElement>('.projection-candidate .name')).some(
        (element) => element.getClientRects().length > 1
      )

    const adjust = (): void => {
      if (steps++ > 40) return
      const platz = available()
      // scrollHeight ist die natürliche Höhe – auch dann, wenn die Box selbst
      // schon auf die Bildhöhe begrenzt ist.
      const gebraucht = box.scrollHeight
      const zuBreit = umbruch()

      // Beim Wachsen einen Schritt zurück, sobald es nicht mehr aufgeht.
      if (direction === 'up' && (gebraucht > platz + 1 || zuBreit)) {
        apply(Math.max(FIT_MIN, scale - 0.04))
        return
      }

      if (gebraucht > platz + 1 && scale > FIT_MIN && direction !== 'up') {
        direction = 'down'
        apply(Math.max(FIT_MIN, scale - 0.04))
        frame = requestAnimationFrame(adjust)
        return
      }
      if (!zuBreit && gebraucht < platz * FIT_TARGET && scale < FIT_MAX && direction !== 'down') {
        direction = 'up'
        apply(Math.min(FIT_MAX, scale + 0.04))
        frame = requestAnimationFrame(adjust)
      }
    }

    const restart = (): void => {
      cancelAnimationFrame(frame)
      steps = 0
      direction = 'none'
      apply(1)
      frame = requestAnimationFrame(adjust)
    }

    restart()
    // Bildschirmwechsel, Fenstergröße, Vollbild: neu ausmessen.
    const observer = new ResizeObserver(restart)
    observer.observe(body)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [trigger])

  return ref
}

export function ProjectionScreen({ state, preview, disconnected }: ProjectionScreenProps): JSX.Element {
  const theme = state.theme ?? DEFAULT_PROJECTION_THEME
  // Jede Inhaltsänderung stößt eine neue Messung an.
  const fitRef = useFitToBody(
    `${state.mode}|${state.candidatePage}|${state.updatedAt}|${state.agenda?.view ?? ''}`
  )
  // Farben als CSS-Variablen: Fenster und Netzwerkansicht sehen damit identisch aus.
  const style = {
    '--projection-bg': theme.background,
    '--projection-surface': theme.surface,
    '--projection-text': theme.text,
    '--projection-muted': theme.muted,
    '--projection-primary': theme.primary,
    '--projection-success': theme.success,
    '--projection-warning': theme.warning,
    '--projection-danger': theme.danger,
    '--projection-logo-size': `${theme.logoSizePercent}cqh`,
    '--projection-logo-opacity': String(theme.logoOpacity),
    // --s-base ist die eingestellte Skalierung, --s die tatsächlich benutzte:
    // im Inhaltsbereich wird sie mit dem gemessenen Faktor --fit verrechnet.
    '--s-base': String(theme.fontScale),
    '--s': String(theme.fontScale),
    '--safe': `${theme.safeAreaPercent}%`,
    '--heading-transform': theme.uppercaseHeadings ? 'uppercase' : 'none'
  } as CSSProperties

  const showLogo = Boolean(theme.logo) && theme.logoPosition !== 'hidden'
  const inCorner =
    theme.logoPosition === 'corner_top_left' ||
    theme.logoPosition === 'corner_top_right' ||
    theme.logoPosition === 'corner_bottom_right'
  // Bei freier Mitteilung und Pause ist der Wahlgangbezug meist störend; er
  // lässt sich aber ausdrücklich einblenden.
  const showRoundContext =
    state.mode === 'custom_message' || state.mode === 'break' || state.mode === 'welcome'
      ? Boolean(state.message?.showRoundContext)
      : true

  return (
    <div
      className={`projection-root${preview ? ' preview' : ''}${theme.transitions ? '' : ' no-transitions'}`}
      style={style}
    >
      {disconnected && <div className="projection-offline">Verbindung unterbrochen</div>}

      {showLogo && theme.logoPosition === 'watermark' && (
        <img className="projection-logo watermark" src={theme.logo} alt="" />
      )}
      {showLogo && inCorner && (
        <img
          className={`projection-logo corner ${theme.logoPosition}`}
          src={theme.logo}
          alt=""
        />
      )}

      <header className="projection-head">
        {showLogo && theme.logoPosition === 'header_left' ? (
          <img className="projection-logo header" src={theme.logo} alt="" />
        ) : (
          <span>{theme.showOrganization ? state.event.organization : ''}</span>
        )}

        {showLogo && theme.logoPosition === 'header_center' ? (
          <img className="projection-logo header center" src={theme.logo} alt="" />
        ) : (
          <span>{theme.showEventTitle ? state.event.title : ''}</span>
        )}

        <span>
          {theme.showEventDate && state.event.date ? formatDateDe(state.event.date) : ''}
          {theme.showClock && theme.showEventDate && state.event.date ? ' · ' : ''}
          {theme.showClock && <Clock />}
        </span>
      </header>

      <main className="projection-body">
        {/* Der Inhalt wird gemessen und notfalls verkleinert – siehe useFitToBody. */}
        <div className="projection-fit" ref={fitRef}>
          {renderMode(state)}
        </div>
      </main>

      <footer className="projection-foot">
        <span>
          {showRoundContext && state.round && theme.showRoundLabel
            ? `WAHLGANG ${state.round.roundLabel}`
            : ''}
        </span>
        <span>
          {showRoundContext && state.round && theme.showRoundCode ? `WG: ${state.round.roundCode}` : ''}
        </span>
      </footer>
    </div>
  )
}

function renderMode(state: ProjectionState): JSX.Element {
  switch (state.mode) {
    case 'welcome':
      return (
        <>
          <div className="projection-title">{state.event.title || 'Versammlung'}</div>
          <div className="projection-status primary">HERZLICH WILLKOMMEN</div>
          <div className="projection-note">{state.event.organization}</div>
        </>
      )

    case 'agenda': {
      const allItems = state.agenda?.items ?? []
      // Zwei gleichberechtigte Darstellungen, die ausschließlich über die
      // gewählte Ansicht entschieden werden — die Gesamtansicht fällt nie
      // stillschweigend auf die Einzelansicht zurück.
      if (state.agenda?.view === 'focus') {
        return (
          <div className="projection-agenda">
            <div className="projection-round-label">TAGESORDNUNG</div>
            {state.agenda?.top && <div className="projection-title">{state.agenda.top}</div>}
            <div className="projection-note">Aktuell</div>
            <div className="current">{state.agenda?.current ?? '–'}</div>
            {state.agenda?.next && (
              <>
                <div className="projection-note">Danach</div>
                <div>{state.agenda.next}</div>
              </>
            )}
          </div>
        )
      }
      /*
       * Vollständige Tagesordnung. Damit auch lange Listen sauber aufs Bild
       * passen: ab zwölf Punkten zweispaltig, ab 40 seitenweise, und die
       * Schriftgröße richtet sich nach der Zeilenzahl je Spalte — so wird das
       * Layout nie überlaufen, sondern höchstens kleiner.
       */
      const columns = allItems.length > AGENDA_TWO_COLUMNS_FROM ? 2 : 1
      // Seiten gleichmäßig füllen, statt die letzte halb leer zu lassen.
      const pages = Math.max(1, Math.ceil(allItems.length / (AGENDA_PAGE_SIZE * columns)))
      const perPage = Math.ceil(allItems.length / pages)
      const page = pages > 1 ? state.candidatePage % pages : 0
      const items = pages > 1 ? allItems.slice(page * perPage, page * perPage + perPage) : allItems
      const rows = Math.ceil(items.length / columns)
      const offset = page * perPage

      return (
        <>
          <div className="projection-round-label">TAGESORDNUNG</div>
          <div
            className={`projection-agenda-list cols-${columns}`}
            style={{ ['--agenda-rows' as string]: String(Math.max(rows, 1)) }}
          >
            {items.map((item, index) => (
              <div
                key={`${item.title}-${offset + index}`}
                className={`projection-agenda-item${item.current ? ' current' : ''}${item.done ? ' done' : ''}`}
              >
                <span className="label">{item.label ?? offset + index + 1}</span>
                <span className="title">{item.title}</span>
                {item.current && <span className="marker">AKTUELL</span>}
                {item.done && !item.current && <span className="marker">erledigt</span>}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="projection-page-indicator">
              Punkte {offset + 1}–{offset + items.length} von {allItems.length}
            </div>
          )}
        </>
      )
    }

    case 'upcoming_round':
      return (
        <>
          <div className="projection-round-label">ALS NÄCHSTES</div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          {isMotion(state) ? <MotionBody state={state} /> : <RoundFacts state={state} />}
          <div className="projection-note">
            {isMotion(state) ? 'Die Abstimmung beginnt in Kürze.' : 'Der Wahlgang beginnt in Kürze.'}
          </div>
        </>
      )

    case 'candidate_presentation':
      if (isMotion(state)) return <MotionView state={state} heading="ABSTIMMUNG" />
      return (
        <>
          <div className="projection-round-label">
            {state.round?.banner ? state.round.banner : 'KANDIDATEN'}
          </div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          <CandidateList state={state} />
          <RoundFacts state={state} />
          <PageIndicator state={state} />
        </>
      )

    case 'round_ready':
      return (
        <>
          <div className="projection-round-label">WAHLGANG {state.round?.roundLabel}</div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          <RoundFacts state={state} />
          <div className="projection-status primary">GLEICH GEHT ES LOS</div>
          <div className="projection-note">Der Wahlgang wird von der Wahlleitung eröffnet.</div>
        </>
      )

    case 'round_open':
      return (
        <>
          <div className="projection-round-label">WAHLGANG {state.round?.roundLabel}</div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          <div className="projection-status primary">WAHL LÄUFT</div>
          <RoundFacts state={state} />
          <div className="projection-note">
            Bitte geben Sie Ihren gekennzeichneten Stimmzettel in die Wahlurne.
          </div>
        </>
      )

    case 'round_closed':
      return (
        <>
          <div className="projection-round-label">WAHLGANG {state.round?.roundLabel}</div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          <div className="projection-status warning">STIMMABGABE BEENDET</div>
          <div className="projection-note">Die Auszählung beginnt.</div>
        </>
      )

    case 'counting':
      return (
        <>
          <div className="projection-round-label">WAHLGANG {state.round?.roundLabel}</div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          <div className="projection-status warning">AUSZÄHLUNG LÄUFT</div>
          <div className="projection-note">Bitte einen Moment Geduld.</div>
        </>
      )

    case 'result':
      return <ResultView state={state} />

    case 'runoff_announced':
      return (
        <>
          <div className="projection-round-label">WAHLGANG {state.round?.roundLabel}</div>
          <div className="projection-title">{state.round?.title ?? ''}</div>
          <div className="projection-status warning">ES FOLGT EINE STICHWAHL</div>
          <CandidateList state={state} />
        </>
      )

    case 'break':
      return (
        <>
          <div className="projection-status primary">{state.message?.title || 'KURZE PAUSE'}</div>
          {state.breakUntil && <BreakCountdown until={state.breakUntil} />}
          <div className="projection-note">
            {state.message?.body || 'Die Versammlung wird in Kürze fortgesetzt.'}
          </div>
        </>
      )

    case 'custom_message':
      return (
        <>
          <div className="projection-message-title">{state.message?.title ?? ''}</div>
          {state.message?.body && <div className="projection-message-body">{state.message.body}</div>}
        </>
      )

    case 'session_finished':
      return (
        <>
          <div className="projection-title">{state.event.title}</div>
          <div className="projection-status success">VIELEN DANK</div>
          <div className="projection-note">Die Versammlung ist beendet.</div>
        </>
      )

    default:
      return <div className="projection-status">–</div>
  }
}

/** Uhrzeit in der Kopfzeile (optional). */
function Clock(): JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <>
      {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')} Uhr
    </>
  )
}

/** Sachabstimmungen zeigen den Beschlusstext, keine Kandidatenzahlen. */
function isMotion(state: ProjectionState): boolean {
  const procedure = state.round?.procedure
  if (!procedure) return false
  return (
    procedure === 'yes_no_abstain' ||
    procedure === 'single_choice_motion' ||
    procedure === 'multiple_choice_motion' ||
    procedure === 'alternative_choice' ||
    procedure === 'open_vote'
  )
}

function MotionBody({ state }: { state: ProjectionState }): JSX.Element {
  const round = state.round
  const options = round?.candidates ?? []
  return (
    <>
      {round?.motionText && <div className="projection-motion">{round.motionText}</div>}
      {options.length > 0 ? (
        <div className={`projection-candidates cols-${projectionColumns(options.length)}`}>
          {options.map((option) => (
            <CandidateRow key={option.id} candidate={option} />
          ))}
        </div>
      ) : (
        <div className="projection-options">
          <span>JA</span>
          <span>NEIN</span>
          <span>ENTHALTUNG</span>
        </div>
      )}
      {round?.instructions && <div className="projection-note">{round.instructions}</div>}
    </>
  )
}

function MotionView({ state, heading }: { state: ProjectionState; heading: string }): JSX.Element {
  return (
    <>
      <div className="projection-round-label">{state.round?.banner || heading}</div>
      <div className="projection-title">{state.round?.title ?? ''}</div>
      <MotionBody state={state} />
    </>
  )
}

/** Countdown einer Pause (Beamer §42) – nur dort, nie bei laufender Wahl. */
function BreakCountdown({ until }: { until: string }): JSX.Element {
  const [remaining, setRemaining] = useState(() => Date.parse(until) - Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(Date.parse(until) - Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [until])

  if (remaining <= 0) {
    return <div className="projection-title">Es geht gleich weiter.</div>
  }
  const totalSeconds = Math.floor(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return (
    <div className="projection-countdown">
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  )
}

function RoundFacts({ state }: { state: ProjectionState }): JSX.Element | null {
  const round = state.round
  if (!round) return null
  return (
    <div className="projection-meta">
      {round.seatStart !== undefined && round.seatEnd !== undefined && (
        <span>
          Listenplätze <strong>{`${round.seatStart}–${round.seatEnd}`}</strong>
        </span>
      )}
      <span>
        <strong>{round.seats}</strong> {round.seats === 1 ? 'Position' : 'Positionen'}
      </span>
      {/* Ohne Bewerber (etwa bei Blanko-Stimmzetteln) ist die Zahl 0 keine
          sinnvolle Aussage – dann bleibt die Angabe weg. */}
      {round.candidateCount > 0 && (
        <span>
          <strong>{round.candidateCount}</strong> {round.candidateCount === 1 ? 'Kandidat' : 'Kandidaten'}
        </span>
      )}
      <span>
        {round.maxVotes === null ? (
          <>
            <strong>ohne</strong> feste Stimmenhöchstzahl
          </>
        ) : (
          <>
            maximal <strong>{round.maxVotes}</strong> {round.maxVotes === 1 ? 'Stimme' : 'Stimmen'}
          </>
        )}
      </span>
      <span>{round.procedureLabel}</span>
    </div>
  )
}

function CandidateList({ state }: { state: ProjectionState }): JSX.Element | null {
  const round = state.round
  if (!round || round.candidates.length === 0) return null

  // Spalten und Seitengröße richten sich nach der Gesamtzahl, damit alle
  // Seiten gleich aussehen und die Seitenangabe dazu passt.
  const columns = projectionColumns(round.candidates.length)
  const page = paginateCandidates(round.candidates, state.candidatePage)
  const rows = Math.max(1, Math.ceil(page.length / columns))

  return (
    <div
      className={`projection-candidates cols-${columns}`}
      style={{ ['--rows' as string]: String(rows) }}
    >
      {page.map((candidate) => (
        <CandidateRow key={candidate.id} candidate={candidate} />
      ))}
    </div>
  )
}

function CandidateRow({ candidate }: { candidate: ProjectionCandidate }): JSX.Element {
  const statusClass =
    candidate.resultStatus === 'elected' ? 'elected' : candidate.resultStatus === 'runoff' ? 'runoff' : ''
  return (
    <div className={`projection-candidate ${statusClass}`}>
      {candidate.ballotNumber !== undefined && (
        <span className="number">{String(candidate.ballotNumber).padStart(2, '0')}</span>
      )}
      <span className="name">{candidate.displayName}</span>
      {candidate.votes !== undefined && <span className="votes">{candidate.votes}</span>}
      {candidate.votes === undefined && candidate.yes !== undefined && (
        <span className="votes">
          {candidate.yes} / {candidate.no ?? 0}
        </span>
      )}
      {candidate.resultStatus === 'elected' && <span className="status">GEWÄHLT</span>}
      {candidate.resultStatus === 'runoff' && <span className="status">STICHWAHL</span>}
    </div>
  )
}

function PageIndicator({ state }: { state: ProjectionState }): JSX.Element | null {
  if (state.candidatePageCount <= 1 || !state.round) return null
  // Dieselbe Seitengröße wie die Darstellung – sonst weicht die Angabe von der
  // tatsächlich gezeigten Menge ab.
  const size = projectionPageSize(state.round.candidates.length)
  const from = state.candidatePage * size + 1
  const to = Math.min(state.round.candidates.length, from + size - 1)
  return (
    <div className="projection-page-indicator">
      Kandidaten {from}–{to} von {state.round.candidates.length}
    </div>
  )
}

function ResultView({ state }: { state: ProjectionState }): JSX.Element {
  const result = state.result
  if (!result) {
    return (
      <>
        <div className="projection-status warning">AUSZÄHLUNG LÄUFT</div>
        <div className="projection-note">Das Ergebnis wird nach der Feststellung angezeigt.</div>
      </>
    )
  }

  const decision = result.finalDecision ? FINAL_DECISION_LABELS[result.finalDecision] : ''
  const decisionClass =
    result.finalDecision === 'elected' || result.finalDecision === 'accepted'
      ? 'success'
      : result.finalDecision === 'runoff' || result.finalDecision === 'tie'
        ? 'warning'
        : result.finalDecision === 'not_elected' || result.finalDecision === 'rejected'
          ? 'danger'
          : 'primary'

  // Ohne Auszählung steht der Wortlaut der Feststellung im Mittelpunkt.
  if (result.declared) {
    return (
      <>
        <div className="projection-round-label">ERGEBNIS</div>
        <div className="projection-title">{state.round?.title ?? ''}</div>
        <div className={`projection-status ${decisionClass}`}>{result.declaration || decision}</div>
        {result.finalMessage && <div className="projection-note">{result.finalMessage}</div>}
        <div className="projection-note">Ohne Auszählung festgestellt.</div>
      </>
    )
  }

  const showGlobal = result.yes !== undefined || result.no !== undefined || result.abstentions !== undefined

  return (
    <>
      <div className="projection-round-label">WAHLERGEBNIS</div>
      <div className="projection-title">{state.round?.title ?? ''}</div>

      {/* Ja/Nein/Enthaltung stehen nebeneinander – untereinander wirkten sie
          wie weitere Bewerber der Ergebnisliste. */}
      {showGlobal && (
        <div className="projection-result-figures">
          {result.yes !== undefined && <ResultFigure label="JA" value={result.yes} tone="success" />}
          {result.no !== undefined && <ResultFigure label="NEIN" value={result.no} tone="danger" />}
          {result.abstentions !== undefined && (
            <ResultFigure label="ENTHALTUNG" value={result.abstentions} />
          )}
        </div>
      )}

      <ResultList candidates={result.candidates ?? []} page={state.candidatePage} />

      {/* Kompakt, weil im Ergebnisbild noch Liste, Kennzahlen und Bilanz stehen. */}
      {decision && <div className={`projection-status compact ${decisionClass}`}>{decision}</div>}
      {result.finalMessage && <div className="projection-note">{result.finalMessage}</div>}

      <div className="projection-note">
        Abgegebene Stimmzettel: {result.ballotsCast ?? '–'} &middot; gültig: {result.validBallots ?? '–'} &middot;
        ungültig: {result.invalidBallots ?? '–'}
      </div>
    </>
  )
}

/** Eine Kennzahl der Gesamtabstimmung: Beschriftung über der Zahl. */
function ResultFigure({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone?: 'success' | 'danger'
}): JSX.Element {
  return (
    <div className={`projection-result-figure${tone ? ` ${tone}` : ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  )
}

/**
 * Ergebnisliste mit eigener Seiteneinteilung: höchstens zwei Spalten, damit
 * Name, Stimmenzahl und Feststellung nebeneinander lesbar bleiben, und die
 * Einträge gleichmäßig auf die Seiten verteilt.
 */
function ResultList({
  candidates,
  page
}: {
  candidates: ProjectionCandidate[]
  page: number
}): JSX.Element | null {
  if (candidates.length === 0) return null

  const columns = projectionResultColumns(candidates.length)
  const pageCount = projectionResultPageCount(candidates.length)
  const pageSize = projectionResultPageSize(candidates.length)
  const current = pageCount > 1 ? page % pageCount : 0
  const shown = paginateCandidates(candidates, current, pageSize)
  const rows = Math.max(1, Math.ceil(shown.length / columns))
  const from = current * pageSize + 1

  return (
    <>
      <div
        className={`projection-candidates result cols-${columns}`}
        style={{ ['--rows' as string]: String(rows) }}
      >
        {shown.map((candidate) => (
          <CandidateRow key={candidate.id} candidate={candidate} />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="projection-page-indicator">
          Ergebnis {from}–{from + shown.length - 1} von {candidates.length}
        </div>
      )}
    </>
  )
}

/**
 * Beamer-Steuerung (Beamer §23–§26, §33–§36, §81).
 * Die Wahlleitung sieht jederzeit, was öffentlich angezeigt wird.
 */
import { useEffect, useState } from 'react'
import type { NetworkProjectionStatus } from '@shared/ipc'
import {
  ALLE_BUEHNEN,
  BUEHNEN_MAX,
  HAUPTBUEHNE,
  PROJECTION_MODE_LABELS,
  REDNER_VORSCHAU,
  REDNER_VORSCHAU_MAX,
  type Buehne,
  type ProjectionHistoryEntry,
  type ProjectionMode
} from '@shared/projection'
import { formatTimeDe } from '@shared/format'
import { api } from '../../lib/api'
import { ProjectionScreen } from '../../projection/ProjectionScreen'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'
import { PresentationLibrary } from '../components/PresentationLibrary'
import { VideoLibrary } from '../components/VideoLibrary'

const MODE_BUTTONS: { mode: ProjectionMode; label: string; needsRound?: boolean }[] = [
  { mode: 'welcome', label: 'Willkommen' },
  { mode: 'upcoming_round', label: 'Nächster Wahlgang', needsRound: true },
  { mode: 'candidate_presentation', label: 'Kandidaten anzeigen', needsRound: true },
  { mode: 'round_ready', label: 'Wahlgang bereit', needsRound: true },
  { mode: 'round_open', label: 'Wahl eröffnet', needsRound: true },
  { mode: 'round_closed', label: 'Wahl beendet', needsRound: true },
  { mode: 'counting', label: 'Auszählung', needsRound: true },
  { mode: 'result', label: 'Ergebnis anzeigen', needsRound: true },
  { mode: 'runoff_announced', label: 'Stichwahl ankuendigen', needsRound: true },
  { mode: 'agenda', label: 'Tagesordnung (gesamt)' },
  { mode: 'break', label: 'Pause' },
  { mode: 'session_finished', label: 'Versammlung beendet' }
]

/**
 * Die Bereiche der rechten Spalte.
 *
 * Sie standen früher untereinander; mit Präsentationen und Videos wurde die
 * Seite so lang, dass die Vorschau — das Wichtigste — beim Scrollen aus dem
 * Bild lief. Was man während einer Versammlung selten braucht, liegt jetzt
 * hinter einem Reiter, statt den Weg zu verstellen.
 */
const BEREICHE = [
  { id: 'inhalte', label: 'Inhalte' },
  { id: 'medien', label: 'Präsentation & Video' },
  { id: 'ausgabe', label: 'Ausgabe & Netz' },
  { id: 'verlauf', label: 'Verlauf' }
] as const
type Bereich = (typeof BEREICHE)[number]['id']

export function BeamerPage(): React.JSX.Element {
  const app = useApp()
  const buehne = app.buehne
  const projection = app.projection
  const audience = app.audience

  const [roundId, setRoundId] = useState<string>(projection.round?.id ?? '')
  const [messageTitle, setMessageTitle] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [agenda, setAgenda] = useState({ top: '', current: '', next: '' })
  const [history, setHistory] = useState<ProjectionHistoryEntry[]>([])
  const [network, setNetwork] = useState<NetworkProjectionStatus | null>(null)
  // Vorgabe: vollständiges Ergebnis inklusive der nicht gewählten Bewerber.
  const [showAll, setShowAll] = useState(true)
  const [showRoundContext, setShowRoundContext] = useState(false)
  const [breakMinutes, setBreakMinutes] = useState(10)
  const [rednerName, setRednerName] = useState('')
  /*
   * Die Bewerber des Bezugswahlgangs.
   *
   * Sie stehen schon in der Anwendung — sie abzutippen wäre Arbeit ohne
   * Zweck, und ein Tippfehler stünde groß an der Wand.
   */
  const [bewerber, setBewerber] = useState<{ id: string; name: string }[]>([])
  const [rednerZusatz, setRednerZusatz] = useState('')
  const [redezeit, setRedezeit] = useState(3)
  /* Wie viele der Folgenden der Beamer zeigt. */
  const [vorschau, setVorschau] = useState(REDNER_VORSCHAU)

  useEffect(() => {
    if (!roundId) {
      setBewerber([])
      return
    }
    let verworfen = false
    void api('round.detail', roundId)
      .then((detail) => {
        if (verworfen) return
        setBewerber(
          detail.candidates
            .filter((kandidat) => !kandidat.withdrawn)
            .map((kandidat) => ({ id: kandidat.id, name: kandidat.displayName }))
        )
      })
      .catch(() => setBewerber([]))
    return () => {
      verworfen = true
    }
  }, [roundId])
  const [pausenart, setPausenart] = useState<'dauer' | 'uhrzeit'>('dauer')
  /* Vorschlag: die nächste halbe Stunde — das ist die häufigste Ansage. */
  const [breakUntil, setBreakUntil] = useState(() => {
    const ziel = new Date(Date.now() + 15 * 60_000)
    ziel.setMinutes(ziel.getMinutes() > 30 ? 60 : 30, 0, 0)
    return `${String(ziel.getHours()).padStart(2, '0')}:${String(ziel.getMinutes()).padStart(2, '0')}`
  })
  const [breakNote, setBreakNote] = useState('')

  useEffect(() => {
    void api('projection.history').then(setHistory).catch(app.reportError)
    void api('projection.network').then(setNetwork).catch(app.reportError)
  }, [projection.updatedAt])

  useEffect(() => {
    if (projection.round?.id) setRoundId(projection.round.id)
  }, [projection.round?.id])

  const setMode = async (mode: ProjectionMode, extra?: Record<string, unknown>): Promise<void> => {
    try {
      await api(
        'projection.setMode',
        {
          mode,
          roundId: roundId || undefined,
          showAll,
          ...(extra ?? {})
        },
        buehne
      )
    } catch (error) {
      app.reportError(error)
    }
  }

  const [bereich, setBereich] = useState<Bereich>('inhalte')

  /**
   * Bühnen speichern und die Oberfläche nachziehen.
   *
   * Es gibt nur diesen einen Weg — Anlegen, Umbenennen und Abbauen schicken
   * dieselbe vollständige Liste. Eine Bühne, die nur halb angelegt ist, kann
   * es damit nicht geben.
   */
  const speichereBuehnen = async (liste: Buehne[]): Promise<void> => {
    try {
      await api('projection.saveBuehnen', liste)
      await app.refreshBuehnen()
    } catch (error) {
      app.reportError(error)
    }
  }

  const buehneAnlegen = (): void => {
    /* Die kleinste freie Nummer — sie steht später in der Netzadresse. */
    const frei = Array.from({ length: BUEHNEN_MAX }, (_, index) => index + 1).find(
      (nummer) => !app.buehnen.some((stage) => stage.id === nummer)
    )
    if (!frei) return
    void speichereBuehnen([
      ...app.buehnen,
      { id: frei, name: `Bühne ${frei}`, followsRound: false }
    ]).then(() => app.setBuehne(frei))
  }

  const aktuelleBuehne = app.buehnen.find((stage) => stage.id === buehne)
  const master = buehne === ALLE_BUEHNEN
  /*
   * Was gerade läuft — beim Master nur, wenn es überall dasselbe ist.
   *
   * Sonst stünde ein Knopf hervorgehoben da, obwohl zwei von drei Wänden
   * etwas anderes zeigen. „Nichts hervorgehoben" ist die ehrlichere Angabe.
   */
  const gemeinsamerModus = master
    ? app.buehnen.every(
        (stage) => (app.projektionen[stage.id]?.mode ?? projection.mode) === projection.mode
      )
      ? projection.mode
      : undefined
    : projection.mode

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Beamer</h1>
          <div className="subtitle">
            Öffentliche Anzeige – read-only. Ergebnisse erscheinen erst nach ausdrücklicher Bestätigung.
          </div>
        </div>
        <div className="row">
          {master ? (
            (() => {
              const offen = app.buehnen.filter((stage) => app.beamerfenster[stage.id]?.open).length
              return (
                <span className={`badge ${offen > 0 ? 'ok' : 'warn'}`}>
                  {offen} von {app.buehnen.length} Beamerfenstern offen
                </span>
              )
            })()
          ) : (
            <span className={`badge ${audience?.open ? 'ok' : 'warn'}`}>
              {audience?.open ? 'Beamerfenster aktiv' : 'Beamerfenster nicht aktiv'}
            </span>
          )}
          <span className="badge accent">
            {gemeinsamerModus ? PROJECTION_MODE_LABELS[gemeinsamerModus] : 'Bühnen zeigen Verschiedenes'}
          </span>
        </div>
      </div>

      {/*
        * Die Bühnen als Reiter.
        *
        * Alles darunter — Vorschau, Anzeige, Präsentation, Video, Pause —
        * bezieht sich auf die hier gewählte Bühne. Es gibt keine zweite
        * Stelle, an der man die Bühne einstellt, und keinen Regler, der
        * versehentlich die falsche Wand trifft.
        */}
      <div className="buehnen-leiste">
        <div className="segmented">
          {/* Der Master ganz links: dieselben Knöpfe, aber auf allen Wänden
              zugleich. „Pause" oder „Versammlung beendet" gehören überall
              hin — dafür soll niemand drei Reiter durchklicken. */}
          {app.buehnen.length > 1 && (
            <button
              className={master ? 'active' : ''}
              onClick={() => app.setBuehne(ALLE_BUEHNEN)}
              title="Schaltet alle Bühnen gleichzeitig"
            >
              Alle
            </button>
          )}
          {app.buehnen.map((stage) => (
            <button
              key={stage.id}
              className={stage.id === buehne ? 'active' : ''}
              onClick={() => app.setBuehne(stage.id)}
              title={
                app.projektionen[stage.id]
                  ? PROJECTION_MODE_LABELS[app.projektionen[stage.id].mode]
                  : undefined
              }
            >
              {stage.name}
              {/* Der Punkt sagt: Auf dieser Bühne steht ein Fenster offen. */}
              {app.buehnen.length > 1 && (
                <span
                  className={`buehnen-punkt${app.beamerfenster[stage.id]?.open ? ' an' : ''}`}
                  title={app.beamerfenster[stage.id]?.open ? 'Fenster offen' : 'Kein Fenster'}
                />
              )}
            </button>
          ))}
        </div>
        {app.buehnen.length < BUEHNEN_MAX && app.can('system.manage') && (
          <button className="mini" onClick={buehneAnlegen} title="Eine weitere Anzeigefläche anlegen">
            + Bühne
          </button>
        )}
        {master && (
          <span className="hint">Jede Schaltung unten trifft alle Bühnen gleichzeitig.</span>
        )}
      </div>

      <div className="grid cols-2">
        <div className="beamer-spalte-fest">
          <Card title={master ? 'Alle Bühnen' : 'Aktuelle Anzeige'}>
            {master ? (
              /* Beim Master zählt der Überblick: jede Wand einmal klein,
                 statt einer großen, die für alle stehen soll. */
              <div className="buehnen-vorschauen">
                {app.buehnen.map((stage) => (
                  <div key={stage.id} className="buehnen-vorschau">
                    <div className="preview-frame">
                      <ProjectionScreen
                        state={app.projektionen[stage.id] ?? projection}
                        preview
                      />
                    </div>
                    <div className="buehnen-vorschau-marke">
                      <button className="mini" onClick={() => app.setBuehne(stage.id)}>
                        {stage.name}
                      </button>
                      <span className="hint">
                        {PROJECTION_MODE_LABELS[
                          (app.projektionen[stage.id] ?? projection).mode
                        ]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="preview-frame">
                <ProjectionScreen state={projection} preview />
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <Checkbox
                checked={projection.locked}
                onChange={(value) => void api('projection.setLocked', value, buehne).catch(app.reportError)}
                label="Beamer sperren"
              />
            </div>
            {/* Was die Sperre bewirkt, gehört unter die Sperre — sonst sieht
                sie neben „Automatisch weiter: aus" wie dasselbe aus. */}
            <div className="hint" style={{ marginTop: -4 }}>
              Hält alles an: den Wechsel der Ansicht aus dem Wahlgangstatus{' '}
              <strong>und</strong> das Weiterblättern. Von Hand geht beides weiter.
            </div>
            {projection.candidatePageCount > 1 && (
              /*
               * Eine Zeile, eine Fluchtlinie.
               *
               * Vorher standen Seitenzahl und Takt in zwei Zeilen mit
               * unterschiedlich breiten Beschriftungen und Knöpfen in voller
               * Größe — nichts fluchtete, und die Blätterknöpfe wirkten
               * wichtiger als die Vorschau darüber.
               */
              <div className="beamer-blaettern">
                <span className="beamer-blaettern-marke">
                  Seite {projection.candidatePage + 1} von {projection.candidatePageCount}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="mini"
                    aria-label="Vorige Seite"
                    onClick={() =>
                      void api(
                        'projection.setCandidatePage',
                        Math.max(0, projection.candidatePage - 1),
                        buehne
                      ).catch(app.reportError)
                    }
                  >
                    ‹
                  </button>
                  <button
                    className="mini"
                    aria-label="Nächste Seite"
                    onClick={() =>
                      void api(
                        'projection.setCandidatePage',
                        projection.candidatePage + 1,
                        buehne
                      ).catch(app.reportError)
                    }
                  >
                    ›
                  </button>
                </div>
                <span className="beamer-blaettern-marke" title="Nur das Blättern in dieser Ansicht">
                  Wechsel alle
                </span>
                <div className="segmented klein">
                  {[0, 8, 15, 30].map((takt) => (
                    <button
                      key={takt}
                      className={projection.candidatePageIntervalSeconds === takt ? 'active' : ''}
                      disabled={projection.locked}
                      onClick={() =>
                        void api('projection.setCandidatePageInterval', takt, buehne).catch(
                          app.reportError
                        )
                      }
                    >
                      {takt === 0 ? 'aus' : `${takt} s`}
                    </button>
                  ))}
                </div>
                {projection.locked && <span className="hint">gesperrt</span>}
              </div>
            )}
          </Card>

          <Card title="Anzeige steuern">
            <Field label="Bezugswahlgang">
              <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
                <option value="">– keiner –</option>
                {app.rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.roundLabel} – {round.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid cols-2">
              {MODE_BUTTONS.map((entry) => (
                <button
                  key={entry.mode}
                  className={
                    gemeinsamerModus === entry.mode &&
                    (entry.mode !== 'agenda' || projection.agenda?.view === 'full')
                      ? 'primary'
                      : ''
                  }
                  disabled={entry.needsRound && !roundId}
                  onClick={() =>
                    void setMode(entry.mode, entry.mode === 'agenda' ? { agendaView: 'full' } : undefined)
                  }
                >
                  {entry.label}
                </button>
              ))}
              <button
                className={
                  projection.mode === 'agenda' && projection.agenda?.view === 'focus' ? 'primary' : ''
                }
                onClick={() => void setMode('agenda', { agendaView: 'focus' })}
              >
                Tagesordnung (aktueller Punkt)
              </button>
            </div>
            <Checkbox
              checked={showAll}
              onChange={(value) => {
                setShowAll(value)
                if (projection.mode === 'result') void setMode('result', { showAll: value })
              }}
              label="Vollständiges Ergebnis anzeigen – auch nicht gewählte Bewerber mit Stimmenzahl"
            />
          </Card>
        </div>

        <div>
          <div className="tabs">
            {BEREICHE.map((eintrag) => (
              <button
                key={eintrag.id}
                className={`tab${bereich === eintrag.id ? ' active' : ''}`}
                onClick={() => setBereich(eintrag.id)}
              >
                {eintrag.label}
              </button>
            ))}
          </div>

          {bereich === 'ausgabe' && aktuelleBuehne && !master && (
          <Card title={`Bühne „${aktuelleBuehne.name}"`}>
            <Field label="Name">
              <input
                value={aktuelleBuehne.name}
                disabled={!app.can('system.manage')}
                onChange={(event) =>
                  void speichereBuehnen(
                    app.buehnen.map((stage) =>
                      stage.id === buehne ? { ...stage, name: event.target.value } : stage
                    )
                  )
                }
              />
            </Field>
            {/* Der Ablauf einer Wahl darf nicht auf jeder Wand landen: Wer
                die Rednerliste stehen lassen will, nimmt diesen Haken weg. */}
            <Checkbox
              checked={aktuelleBuehne.followsRound}
              disabled={!app.can('system.manage')}
              onChange={(value) =>
                void speichereBuehnen(
                  app.buehnen.map((stage) =>
                    stage.id === buehne ? { ...stage, followsRound: value } : stage
                  )
                )
              }
              label="Folgt automatisch dem Wahlgang"
            />
            <div className="hint">
              Ohne Haken bleibt diese Bühne stehen, bis sie von Hand umgeschaltet wird — für eine
              Rednerliste oder ein Standbild neben dem Wahlgeschehen.
            </div>
            {buehne !== HAUPTBUEHNE && app.can('system.manage') && (
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="danger"
                  onClick={() => {
                    void speichereBuehnen(app.buehnen.filter((stage) => stage.id !== buehne))
                    app.setBuehne(HAUPTBUEHNE)
                  }}
                >
                  Bühne abbauen
                </button>
              </div>
            )}
          </Card>
          )}

          {bereich === 'ausgabe' && (
          <Card title="Ausgabegerät">
            {audience?.singleDisplay && (
              <div className="notice warn">
                Es ist nur ein Bildschirm erkannt. Das Beamerfenster oeffnet dann im Fenstermodus, damit Sie
                weiterarbeiten können.
              </div>
            )}
            <div className="row">
              {(audience?.displays ?? []).map((display) => (
                <button
                  key={display.id}
                  className={display.current ? 'primary' : ''}
                  onClick={() => void api('projection.openAudience', display.id, buehne).catch(app.reportError)}
                >
                  {display.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => void api('projection.openAudience', undefined, buehne).catch(app.reportError)}>
                Beamerfenster öffnen
              </button>
              <button onClick={() => void api('projection.closeAudience', buehne).catch(app.reportError)}>
                Schließen
              </button>
              <button
                onClick={async () => {
                  await api('projection.demo', true, buehne).catch(app.reportError)
                  app.notify('info', 'Demomodus aktiv – Testdaten für die Beamerpruefung.')
                }}
              >
                Demomodus
              </button>
            </div>
          </Card>
          )}

          {bereich === 'inhalte' && (
          <>
          <Card title="Freie Mitteilung">
            <Field label="Titel">
              <input value={messageTitle} onChange={(e) => setMessageTitle(e.target.value)} />
            </Field>
            <Field label="Text (optional)">
              <input value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
            </Field>
            <Checkbox
              checked={showRoundContext}
              onChange={setShowRoundContext}
              label="Wahlgang und Kennung in der Fußzeile anzeigen"
            />
            <button
              disabled={!messageTitle.trim()}
              onClick={() =>
                void setMode('custom_message', {
                  message: { title: messageTitle, body: messageBody || undefined, showRoundContext }
                })
              }
            >
              Anzeigen
            </button>
          </Card>

          {/*
            * Vorstellung mit Redezeit.
            *
            * Auf einer Versammlung stellen sich Bewerber nacheinander vor, oft
            * mit begrenzter Zeit. Ohne Anzeige weiß weder der Saal noch die
            * sprechende Person, wie viel noch bleibt — und die Erinnerung
            * daran wird zur unangenehmen Unterbrechung.
            */}
          <Card title="Vorstellung mit Redezeit">
            <div className="row">
              <div style={{ flex: 1 }}>
                {bewerber.length > 0 ? (
                  <Field label="Wer spricht" hint="Bewerber des Bezugswahlgangs">
                    <select
                      value={bewerber.some((b) => b.name === rednerName) ? rednerName : ''}
                      onChange={(e) => setRednerName(e.target.value)}
                    >
                      <option value="">– auswählen –</option>
                      {bewerber.map((eintrag) => (
                        <option key={eintrag.id} value={eintrag.name}>
                          {eintrag.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field
                    label="Wer spricht"
                    hint="Ohne Bezugswahlgang gibt es keine Namensliste."
                  >
                    <input
                      value={rednerName}
                      onChange={(e) => setRednerName(e.target.value)}
                      placeholder="Name"
                    />
                  </Field>
                )}
              </div>
              <div style={{ width: 130 }}>
                <Field label="Redezeit (Min.)" hint="0 = ohne Uhr">
                  <NumberInput value={redezeit} min={0} max={120} onChange={setRedezeit} />
                </Field>
              </div>
              <div style={{ width: 150 }}>
                <Field label="Nächste zeigen" hint="0 = keine Vorschau">
                  <NumberInput
                    value={vorschau}
                    min={0}
                    max={REDNER_VORSCHAU_MAX}
                    onChange={setVorschau}
                  />
                </Field>
              </div>
            </div>
            {bewerber.length > 0 && (
              /* Nicht jede Vorstellung ist die eines Bewerbers — ein Gast, ein
                 Bericht, eine Grußbotschaft stehen in keiner Kandidatenliste. */
              <Field label="Oder freier Name" hint="Überschreibt die Auswahl.">
                <input
                  value={bewerber.some((b) => b.name === rednerName) ? '' : rednerName}
                  onChange={(e) => setRednerName(e.target.value)}
                  placeholder="Gast, Bericht, Grußwort …"
                />
              </Field>
            )}
            <Field label="Zusatz (optional)">
              <input
                value={rednerZusatz}
                onChange={(e) => setRednerZusatz(e.target.value)}
                placeholder="Bewerbung um den Vorsitz"
              />
            </Field>
            <div className="row">
              <button
                className="primary"
                disabled={!rednerName.trim()}
                onClick={() => {
                  /*
                   * Die Reihe ergibt sich von selbst: Vorgestellt wird in der
                   * Reihenfolge des Stimmzettels, und die steht in der
                   * Kandidatenliste. Niemand muss eine Warteliste pflegen.
                   */
                  const stelle = bewerber.findIndex((b) => b.name === rednerName.trim())
                  const folgende =
                    stelle >= 0 ? bewerber.slice(stelle + 1).map((b) => b.name) : []
                  void setMode('speaker', {
                    speaker: {
                      name: rednerName.trim(),
                      note: rednerZusatz.trim() || undefined,
                      seconds: redezeit > 0 ? redezeit * 60 : undefined,
                      upcoming: folgende,
                      upcomingShown: vorschau
                    }
                  })
                }}
              >
                Vorstellung anzeigen
              </button>
            </div>
            {projection.mode === 'speaker' && projection.speaker && (
              <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
                <span className="hint">Läuft: {projection.speaker.name}</span>
                <button
                  className="primary"
                  disabled={(projection.speaker.upcoming ?? []).length === 0}
                  title={
                    (projection.speaker.upcoming ?? [])[0]
                      ? `Weiter zu ${(projection.speaker.upcoming ?? [])[0]}`
                      : 'Niemand mehr in der Reihe'
                  }
                  onClick={() => void api('projection.nextSpeaker', buehne).catch(app.reportError)}
                >
                  Nächster{' '}
                  {(projection.speaker.upcoming ?? [])[0]
                    ? `— ${(projection.speaker.upcoming ?? [])[0]}`
                    : ''}
                </button>
                <button
                  onClick={() =>
                    void api(
                      'projection.setSpeakerPaused',
                      projection.speaker?.pausedSecondsLeft === undefined,
                      buehne
                    ).catch(app.reportError)
                  }
                  disabled={!projection.speaker.until && projection.speaker.pausedSecondsLeft === undefined}
                >
                  {projection.speaker.pausedSecondsLeft === undefined ? 'Anhalten' : 'Weiter'}
                </button>
                {/* Grob und fein: Eine Minute ist der übliche Zuruf, zehn
                    Sekunden reichen fürs Nachjustieren kurz vor Schluss. */}
                {[
                  ['+1 Min.', 60],
                  ['−1 Min.', -60],
                  ['+10 s', 10],
                  ['−10 s', -10]
                ].map(([beschriftung, sekunden]) => (
                  <button
                    key={beschriftung}
                    onClick={() =>
                      void api('projection.addSpeakerSeconds', sekunden as number, buehne).catch(
                        app.reportError
                      )
                    }
                  >
                    {beschriftung}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Pause">
            {/* Zwei Wege zum selben Ziel: „noch 15 Minuten" ist beim spontanen
                Unterbrechen bequemer, „weiter um 12:30" bei einer geplanten
                Pause — und nur die Uhrzeit steht auch dann noch richtig, wenn
                zwischen Ansage und Anzeigen ein paar Minuten vergehen. */}
            <div className="row" style={{ marginBottom: 8 }}>
              <div className="segmented">
                <button
                  className={pausenart === 'dauer' ? 'active' : ''}
                  onClick={() => setPausenart('dauer')}
                >
                  Dauer
                </button>
                <button
                  className={pausenart === 'uhrzeit' ? 'active' : ''}
                  onClick={() => setPausenart('uhrzeit')}
                >
                  Bis Uhrzeit
                </button>
              </div>
            </div>
            <div className="row">
              <div style={{ width: 170 }}>
                {pausenart === 'dauer' ? (
                  <Field label="Dauer (Minuten)" hint="0 = ohne Countdown">
                    <NumberInput value={breakMinutes} min={0} max={240} onChange={setBreakMinutes} />
                  </Field>
                ) : (
                  <Field label="Weiter um" hint="Nach der Uhr dieses Rechners.">
                    <input
                      type="time"
                      value={breakUntil}
                      onChange={(e) => setBreakUntil(e.target.value)}
                    />
                  </Field>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Hinweistext (optional)">
                  <input
                    value={breakNote}
                    onChange={(e) => setBreakNote(e.target.value)}
                    placeholder="Die Versammlung wird in Kürze fortgesetzt."
                  />
                </Field>
              </div>
            </div>
            <button
              className="primary"
              onClick={() =>
                void setMode('break', {
                  breakMinutes:
                    pausenart === 'dauer' && breakMinutes > 0 ? breakMinutes : undefined,
                  breakUntilTime: pausenart === 'uhrzeit' && breakUntil ? breakUntil : undefined,
                  message: {
                    title: 'KURZE PAUSE',
                    body: breakNote || undefined,
                    showRoundContext
                  }
                })
              }
            >
              Pause anzeigen
            </button>
            <div className="hint">
              Der Countdown ist nur für Pausen gedacht. Für die Stimmabgabe wird bewusst keine Uhr angezeigt,
              solange die Wahlleitung kein Ende beschlossen hat.
            </div>
          </Card>

          <Card title="Tagesordnung">
            <Field label="Tagesordnungspunkt">
              <input value={agenda.top} onChange={(e) => setAgenda({ ...agenda, top: e.target.value })} />
            </Field>
            <div className="row">
              <div style={{ flex: 1 }}>
                <Field label="Aktuell">
                  <input value={agenda.current} onChange={(e) => setAgenda({ ...agenda, current: e.target.value })} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Danach">
                  <input value={agenda.next} onChange={(e) => setAgenda({ ...agenda, next: e.target.value })} />
                </Field>
              </div>
            </div>
            <button onClick={() => void setMode('agenda', { agenda })}>Tagesordnung anzeigen</button>
          </Card>

          </>
          )}

          {bereich === 'medien' && (
          <>
            <PresentationLibrary />
            <VideoLibrary />
          </>
          )}

          {bereich === 'ausgabe' && (
          <Card title="Beamer im Netzwerk">
            {network ? (
              <NetworkSection status={network} onChange={setNetwork} />
            ) : (
              <p className="hint">Wird geladen …</p>
            )}
          </Card>
          )}

          {bereich === 'verlauf' && (
          <Card title="Verlauf">
            <div className="scroll-box" style={{ maxHeight: 220 }}>
              <table>
                <tbody>
                  {history.map((entry, index) => (
                    <tr key={index}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatTimeDe(entry.timestamp)}</td>
                      <td>{entry.label}</td>
                      <td>{entry.roundLabel ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          )}
        </div>
      </div>
    </>
  )
}

function NetworkSection({
  status,
  onChange
}: {
  status: NetworkProjectionStatus
  onChange: (status: NetworkProjectionStatus) => void
}): React.JSX.Element {
  const app = useApp()
  const [enabled, setEnabled] = useState(status.enabled)
  const [port, setPort] = useState(status.port)
  const [token, setToken] = useState(status.token)
  const [lanWide, setLanWide] = useState(status.bindAddress !== '127.0.0.1')
  const [allowRemoteOperator, setAllowRemoteOperator] = useState(status.allowRemoteOperator)

  const save = async (): Promise<void> => {
    try {
      const next = await api('projection.setNetwork', {
        enabled,
        port,
        bindAddress: lanWide ? '0.0.0.0' : '127.0.0.1',
        token,
        allowRemoteOperator
      })
      onChange(next)
      app.notify(next.running ? 'ok' : 'info', next.running ? 'Netzwerkansicht läuft.' : 'Netzwerkansicht deaktiviert.')
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      <p className="hint">
        Zeigt dieselbe Beameransicht im Browser eines anderen Geräts im Veranstaltungsnetz an – ausschließlich
        lesend, ohne Bedienelemente. Standardmäßig deaktiviert; nur in einem abgeschotteten lokalen Netz
        verwenden.
      </p>
      <Checkbox checked={enabled} onChange={setEnabled} label="Netzwerkansicht aktivieren" />
      <div className="row">
        <div style={{ width: 140 }}>
          <Field label="Port">
            <NumberInput value={port} min={1024} max={65535} onChange={setPort} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Zugriffstoken" hint="Leer = ohne Token (nur in vollständig abgeschotteten Netzen).">
            <input value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
        </div>
      </div>
      <Checkbox
        checked={lanWide}
        onChange={setLanWide}
        label="Im gesamten lokalen Netz erreichbar (sonst nur auf diesem Rechner)"
      />

      <h3>Bedienung von einem zweiten Gerät</h3>
      <p className="hint">
        Zusätzlich zur Beameransicht kann die vollständige Bedienoberfläche im Browser eines anderen Geräts
        geöffnet werden — unter der Adresse mit dem Zusatz <span className="mono">/operator</span>. Dort ist eine
        Anmeldung mit einem lokalen Konto nötig; es gelten dieselben Rollen und Rechte, und jede Aktion landet
        mit dem jeweiligen Benutzer im Audit-Trail. Systemdialoge (Ordnerwahl, Backup-Ziel) bleiben dem
        Hauptrechner vorbehalten.
      </p>
      <Checkbox
        checked={allowRemoteOperator}
        onChange={setAllowRemoteOperator}
        label="Anmeldung und Bedienung über das Netz erlauben"
      />
      {allowRemoteOperator && (
        <div className="notice warn">
          Nur in einem abgeschotteten Veranstaltungsnetz verwenden. Die Verbindung ist unverschlüsselt (HTTP);
          über ein fremdes oder offenes WLAN darf sie nicht laufen.
        </div>
      )}

      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Übernehmen
        </button>
        <button
          onClick={() => setToken(Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6))}
        >
          Token erzeugen
        </button>
      </div>
      {status.running && status.urls.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <label>Beameransicht</label>
          {status.urls.map((url) => (
            <div key={url} className="mono">
              {url}
            </div>
          ))}
          {/*
            * Eine Adresse je Bühne.
            *
            * Ein Gerät im Saal wählt seine Bühne über die Adresse — `/b/2`
            * neben dem zweiten Beamer, und es zeigt bis zum Schluss genau
            * das, was dort hingehört.
            */}
          {app.buehnen.length > 1 && (
            <>
              <label style={{ marginTop: 10 }}>Einzelne Bühnen</label>
              {app.buehnen.map((stage) => (
                <div key={`b-${stage.id}`} className="mono">
                  {status.urls[0].split('?')[0].replace(/\/$/, '')}/b/{stage.id}
                  {status.token ? `?t=${status.token}` : ''} — {stage.name}
                </div>
              ))}
            </>
          )}
          {status.allowRemoteOperator && (
            <>
              <label style={{ marginTop: 10 }}>Bedienung (Anmeldung erforderlich)</label>
              {status.urls.map((url) => (
                <div key={`op-${url}`} className="mono">
                  {url.split('?')[0].replace(/\/$/, '')}/operator
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {status.error && <div className="notice error">{status.error}</div>}
    </>
  )
}

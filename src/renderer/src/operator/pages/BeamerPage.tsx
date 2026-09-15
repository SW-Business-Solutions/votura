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
import { KameraLibrary } from '../components/KameraLibrary'
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
  { mode: 'runoff_announced', label: 'Stichwahl ankündigen', needsRound: true },
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
/** Die Adresse ohne Suchteil — Grundlage für alle abgeleiteten Adressen. */
function netzBasis(status: NetworkProjectionStatus): string {
  return (status.urls[0] ?? '').split('?')[0].replace(/\/$/, '')
}

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
        ziel
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
    void speichereBuehnen([...app.buehnen, { id: frei, name: `Bühne ${frei}`, followsRound: false }]).then(
      () => app.setBuehne(frei)
    )
  }

  const aktuelleBuehne = app.buehnen.find((stage) => stage.id === buehne)
  const master = buehne === ALLE_BUEHNEN
  /* Worauf ein Knopf wirkt — siehe `ziel` im gemeinsamen Zustand. */
  const ziel = app.ziel
  /*
   * Was gerade läuft — beim Master nur, wenn es überall dasselbe ist.
   *
   * Sonst stünde ein Knopf hervorgehoben da, obwohl zwei von drei Wänden
   * etwas anderes zeigen. „Nichts hervorgehoben" ist die ehrlichere Angabe.
   */
  const betroffeneBuehnen = master
    ? app.buehnen.filter((stage) => app.auswahl.length === 0 || app.auswahl.includes(stage.id))
    : app.buehnen.filter((stage) => stage.id === buehne)
  const gemeinsamerModus = betroffeneBuehnen.every(
    (stage) => (app.projektionen[stage.id]?.mode ?? projection.mode) === projection.mode
  )
    ? projection.mode
    : undefined

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
              const offen = betroffeneBuehnen.filter((stage) => app.beamerfenster[stage.id]?.open).length
              return (
                <span className={`badge ${offen > 0 ? 'ok' : 'warn'}`}>
                  {offen} von {betroffeneBuehnen.length} Beamerfenstern offen
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
          <span className="hint">
            {app.auswahl.length === 0
              ? 'Jede Schaltung unten trifft alle Bühnen gleichzeitig.'
              : `Jede Schaltung trifft die ${app.auswahl.length} angehakten Bühnen.`}
          </span>
        )}
      </div>

      <div className="grid cols-2">
        <div className="beamer-spalte-fest">
          <Card title={master ? 'Alle Bühnen' : 'Aktuelle Anzeige'}>
            {master ? (
              /* Beim Master zählt der Überblick: jede Wand einmal klein,
                 statt einer großen, die für alle stehen soll. */
              <>
                <div className="buehnen-vorschauen">
                  {app.buehnen.map((stage) => {
                    const angehakt = app.auswahl.includes(stage.id)
                    /* Ohne Auswahl gilt „alle" — dann ist auch alles hell. */
                    const betroffen = app.auswahl.length === 0 || angehakt
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        className={`buehnen-vorschau${angehakt ? ' gewaehlt' : ''}${
                          betroffen ? '' : ' beiseite'
                        }`}
                        aria-pressed={angehakt}
                        title={
                          angehakt
                            ? `${stage.name} aus der Auswahl nehmen`
                            : `Nur ${stage.name} und weitere angehakte schalten`
                        }
                        onClick={() => app.toggleAuswahl(stage.id)}
                      >
                        <div className="preview-frame">
                          <ProjectionScreen state={app.projektionen[stage.id] ?? projection} preview />
                        </div>
                        <div className="buehnen-vorschau-marke">
                          <span className="buehnen-vorschau-name">
                            <span className={`buehnen-haken${angehakt ? ' an' : ''}`} aria-hidden="true">
                              {angehakt ? '✓' : ''}
                            </span>
                            {stage.name}
                          </span>
                          <span className="hint">
                            {PROJECTION_MODE_LABELS[(app.projektionen[stage.id] ?? projection).mode]}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="buehnen-auswahl-zeile">
                  <span className="hint">
                    {app.auswahl.length === 0
                      ? 'Nichts angehakt — es gilt für alle Bühnen.'
                      : `Es gilt für ${app.auswahl.length} von ${app.buehnen.length} Bühnen.`}
                  </span>
                  {app.auswahl.length > 0 && (
                    <button className="mini" onClick={() => app.setAuswahl([])}>
                      Auswahl aufheben
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="preview-frame">
                <ProjectionScreen state={projection} preview />
              </div>
            )}
            <div className="row mt-3">
              <Checkbox
                checked={projection.locked}
                onChange={(value) => void api('projection.setLocked', value, ziel).catch(app.reportError)}
                label="Beamer sperren"
              />
            </div>
            {/* Was die Sperre bewirkt, gehört unter die Sperre — sonst sieht
                sie neben „Automatisch weiter: aus" wie dasselbe aus. */}
            <div className="hint">
              Hält alles an: den Wechsel der Ansicht aus dem Wahlgangstatus <strong>und</strong> das
              Weiterblättern. Von Hand geht beides weiter.
            </div>
            {/*
              Ein Antrag blättert über seine eigenen Seiten.

              Er hat keine Kandidatenliste, sondern einen Text — die
              Seitenzahl hängt am Wortlaut und steht deshalb im Antrag selbst.
              Zwei Seitenzähler nebeneinander zeigten irgendwann Verschiedenes;
              deshalb eine eigene Zeile statt eines gemeinsamen Knopfs.
            */}
            {projection.mode === 'antrag' && (projection.antrag?.seiten.length ?? 0) > 1 && (
              <div className="beamer-blaettern">
                <span className="beamer-blaettern-marke">
                  Seite {(projection.antrag?.seite ?? 0) + 1} von {projection.antrag?.seiten.length}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="mini"
                    aria-label="Vorige Seite des Antrags"
                    disabled={(projection.antrag?.seite ?? 0) === 0}
                    onClick={() =>
                      void api(
                        'projection.setMode',
                        { mode: 'antrag', antrag: { seite: (projection.antrag?.seite ?? 0) - 1 } },
                        ziel
                      ).catch(app.reportError)
                    }
                  >
                    ‹
                  </button>
                  <button
                    className="mini"
                    aria-label="Nächste Seite des Antrags"
                    disabled={
                      (projection.antrag?.seite ?? 0) >= (projection.antrag?.seiten.length ?? 1) - 1
                    }
                    onClick={() =>
                      void api(
                        'projection.setMode',
                        { mode: 'antrag', antrag: { seite: (projection.antrag?.seite ?? 0) + 1 } },
                        ziel
                      ).catch(app.reportError)
                    }
                  >
                    ›
                  </button>
                </div>
              </div>
            )}

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
                        ziel
                      ).catch(app.reportError)
                    }
                  >
                    ‹
                  </button>
                  <button
                    className="mini"
                    aria-label="Nächste Seite"
                    onClick={() =>
                      void api('projection.setCandidatePage', projection.candidatePage + 1, ziel).catch(
                        app.reportError
                      )
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
                        void api('projection.setCandidatePageInterval', takt, ziel).catch(app.reportError)
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
            <div className="grid beamer-modi">
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
            {/*
             * Der Haken gehört zu einem einzigen dieser Knöpfe.
             *
             * Zwischen zwölf gleichrangigen Schaltflächen stand er wie eine
             * allgemeine Einstellung da und war doch nur für „Ergebnis
             * anzeigen" gedacht. Eingerückt unter der Reihe, mit dem Bezug
             * im Text, ist er das, was er ist: eine Beigabe zum Ergebnis.
             */}
            <div className="beamer-nebenschalter">
              <span className="beamer-nebenschalter-marke">Zum Ergebnis</span>
              <Checkbox
                checked={showAll}
                onChange={(value) => {
                  setShowAll(value)
                  if (projection.mode === 'result') void setMode('result', { showAll: value })
                }}
                label="Vollständig anzeigen – auch nicht gewählte Bewerber mit Stimmenzahl"
              />
            </div>
            {/*
             * Untertitel hängen an keiner Ansicht.
             *
             * Gesprochen wird vor der Tagesordnung genauso wie vor einem
             * Kamerabild — deshalb steht der Schalter hier unter der
             * Ansichtsreihe und nicht bei den Kameras. Erkannt wird dabei am
             * Hauptrechner; die Wände bekommen nur den fertigen Text.
             */}
            <div className="beamer-nebenschalter">
              <span className="beamer-nebenschalter-marke">Im Saal</span>
              <Checkbox
                checked={Boolean(projection.untertitel)}
                onChange={(value) => void api('untertitel.setAn', value, app.ziel).catch(app.reportError)}
                label="Untertitel – was gesprochen wird, mitlesbar an der Wand"
              />
              {projection.untertitel && (
                <p className="hint">
                  Das Mikrofon dieses Rechners hört mit. Aufgezeichnet wird nichts — der Text steht
                  an der Wand und sonst nirgends. Wie gut er stimmt, hängt am hinterlegten
                  Sprachmodell.
                </p>
              )}
            </div>
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
                <div className="row mt-3">
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
                    onClick={() =>
                      void api('projection.openAudience', display.id, ziel).catch(app.reportError)
                    }
                  >
                    {display.label}
                  </button>
                ))}
              </div>
              <div className="row mt-3">
                <button
                  className="primary"
                  onClick={() => void api('projection.openAudience', undefined, ziel).catch(app.reportError)}
                >
                  Beamerfenster öffnen
                </button>
                <button onClick={() => void api('projection.closeAudience', ziel).catch(app.reportError)}>
                  Schließen
                </button>
                <button
                  onClick={async () => {
                    await api('projection.demo', true, ziel).catch(app.reportError)
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
                  <div className="col">
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
                      <Field label="Wer spricht" hint="Ohne Bezugswahlgang gibt es keine Namensliste.">
                        <input
                          value={rednerName}
                          onChange={(e) => setRednerName(e.target.value)}
                          placeholder="Name"
                        />
                      </Field>
                    )}
                  </div>
                  <div className="col-mittel">
                    <Field label="Redezeit (Min.)" hint="0 = ohne Uhr">
                      <NumberInput value={redezeit} min={0} max={120} onChange={setRedezeit} />
                    </Field>
                  </div>
                  <div className="col-mittel">
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
                      const folgende = stelle >= 0 ? bewerber.slice(stelle + 1).map((b) => b.name) : []
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
                {/*
                  Die Griffe gehören zum **Redner**, nicht zur Ansicht.
                  Vorher standen sie nur im Modus „Vorstellung“ — wer auf das
                  Kamerabild schaltete, sah die Uhr in der Bauchbinde laufen
                  und konnte sie nicht mehr anhalten.

                  Drei Zeilen statt einer Reihe: Wer spricht, was als Nächstes
                  geschieht, und wie die Uhr nachjustiert wird. Acht Knöpfe
                  nebeneinander umbrachen zu einem Haufen, in dem „Beenden“
                  neben „+10 s“ gleich laut war.
                */}
                {projection.speaker && (
                  <div className="redezeit-lauf">
                    <div className="redezeit-wer">
                      {projection.speaker.ungestartet ? 'Aufgerufen: ' : 'Läuft: '}
                      <strong>{projection.speaker.name}</strong>
                      {projection.speaker.ungestartet && ' — die Uhr wartet auf den Start'}
                      {projection.mode !== 'speaker' && ' — im Bild'}
                    </div>

                    <div className="row">
                      <button
                        /* Solange die Uhr noch nicht läuft, ist „Starten" der
                           Hauptgriff und nicht „Nächster". */
                        className={projection.speaker.ungestartet ? '' : 'primary'}
                        disabled={(projection.speaker.upcoming ?? []).length === 0}
                        title={
                          (projection.speaker.upcoming ?? [])[0]
                            ? `Weiter zu ${(projection.speaker.upcoming ?? [])[0]}`
                            : 'Niemand mehr in der Reihe'
                        }
                        onClick={() => void api('projection.nextSpeaker', ziel).catch(app.reportError)}
                      >
                        Nächster{' '}
                        {(projection.speaker.upcoming ?? [])[0]
                          ? `— ${(projection.speaker.upcoming ?? [])[0]}`
                          : ''}
                      </button>
                      <button
                        className={projection.speaker.ungestartet ? 'primary' : ''}
                        onClick={() =>
                          void api(
                            'projection.setSpeakerPaused',
                            projection.speaker?.pausedSecondsLeft === undefined,
                            ziel
                          ).catch(app.reportError)
                        }
                        disabled={
                          !projection.speaker.until &&
                          projection.speaker.pausedSecondsLeft === undefined
                        }
                      >
                        {/*
                          Drei Zustände, drei Wörter. „Starten" ist etwas
                          anderes als „Weiter": Das eine schickt die Uhr zum
                          ersten Mal los, das andere nimmt eine Zwischenfrage
                          zurück.
                        */}
                        {projection.speaker.ungestartet
                          ? '▶ Starten'
                          : projection.speaker.pausedSecondsLeft === undefined
                            ? 'Anhalten'
                            : 'Weiter'}
                      </button>
                    </div>

                    <div className="row">
                      {/*
                        Grob und fein, und in der Reihenfolge einer Waage:
                        Abziehen links, Draufgeben rechts. Vorher standen sie
                        als +1, −1, +10, −10 durcheinander — man musste lesen,
                        statt zu zielen.
                      */}
                      <div className="zeitschritte">
                        {[
                          ['−1 Min.', -60],
                          ['−10 s', -10],
                          ['+10 s', 10],
                          ['+1 Min.', 60]
                        ].map(([beschriftung, sekunden]) => (
                          <button
                            key={beschriftung}
                            onClick={() =>
                              void api('projection.addSpeakerSeconds', sekunden as number, ziel).catch(
                                app.reportError
                              )
                            }
                          >
                            {beschriftung}
                          </button>
                        ))}
                      </div>

                      <div className="spacer" />

                      {/*
                        Zwei Griffe, die selten gebraucht werden und deshalb
                        zurückhaltend aussehen: Der Neubeginn der Uhr — nötig,
                        seit dieselbe Person beim Hin- und Herschalten ihre
                        behält — und das Ende der Vorstellung, nötig, seit sie
                        einen Ansichtswechsel überlebt.
                      */}
                      <button
                        className="ghost"
                        title="Die Redezeit dieser Person von vorn beginnen lassen."
                        onClick={() =>
                          void setMode('speaker', {
                            speaker: {
                              name: projection.speaker?.name ?? '',
                              note: projection.speaker?.note,
                              seconds: projection.speaker?.totalSeconds,
                              upcoming: projection.speaker?.upcoming,
                              upcomingShown: projection.speaker?.upcomingShown,
                              uhrNeu: true
                            }
                          })
                        }
                        disabled={!projection.speaker.totalSeconds}
                      >
                        Zeit neu
                      </button>
                      <button
                        className="ghost danger"
                        title="Die laufende Vorstellung beenden. Die Uhr ist damit weg."
                        onClick={() => void api('projection.endSpeaker', ziel).catch(app.reportError)}
                      >
                        Beenden
                      </button>
                    </div>
                  </div>
                )}
              </Card>

              <Card title="Pause">
                {/* Zwei Wege zum selben Ziel: „noch 15 Minuten" ist beim spontanen
                Unterbrechen bequemer, „weiter um 12:30" bei einer geplanten
                Pause — und nur die Uhrzeit steht auch dann noch richtig, wenn
                zwischen Ansage und Anzeigen ein paar Minuten vergehen. */}
                <div className="row mb-2">
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
                  <div className="col-mittel">
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
                  <div className="col">
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
                      breakMinutes: pausenart === 'dauer' && breakMinutes > 0 ? breakMinutes : undefined,
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
                  Der Countdown ist nur für Pausen gedacht. Für die Stimmabgabe wird bewusst keine Uhr
                  angezeigt, solange die Wahlleitung kein Ende beschlossen hat.
                </div>
              </Card>

              <Card title="Tagesordnung">
                <Field label="Tagesordnungspunkt">
                  <input value={agenda.top} onChange={(e) => setAgenda({ ...agenda, top: e.target.value })} />
                </Field>
                <div className="row">
                  <div className="col">
                    <Field label="Aktuell">
                      <input
                        value={agenda.current}
                        onChange={(e) => setAgenda({ ...agenda, current: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="col">
                    <Field label="Danach">
                      <input
                        value={agenda.next}
                        onChange={(e) => setAgenda({ ...agenda, next: e.target.value })}
                      />
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
              <KameraLibrary />
            </>
          )}

          {bereich === 'ausgabe' && (
            /*
             * Hier stehen nur noch die Adressen.
             *
             * Port, Token und Freigaben stellt man einmal ein, bevor die
             * Versammlung beginnt — das gehört in die Einstellungen. Was während
             * der Versammlung gebraucht wird, ist die Adresse zum Ablesen und
             * Weitersagen.
             */
            <Card title="Beamer im Netzwerk">
              {!network || !network.running ? (
                <p className="hint">
                  Die Netzwerkansicht läuft nicht. Einschalten unter <strong>Einstellungen → Beamer</strong>.
                </p>
              ) : (
                <>
                  <label>Beameransicht</label>
                  {network.urls.map((url) => (
                    <div key={url} className="mono">
                      {url}
                    </div>
                  ))}
                  {app.buehnen.length > 1 && (
                    <>
                      <label className="mt-3">Einzelne Bühnen</label>
                      {app.buehnen.map((stage) => (
                        <div key={`b-${stage.id}`} className="mono">
                          {netzBasis(network)}/b/{stage.id}
                          {network.token ? `?t=${network.token}` : ''} — {stage.name}
                        </div>
                      ))}
                    </>
                  )}
                  {/*
                    Die Überlagerung für einen Livestream.

                    Sie steht hier und nicht in den Einstellungen, weil sie
                    eine Adresse ist wie die anderen auch — und weil sie nur
                    dort etwas nützt, wo jemand die Adressen abschreibt.
                  */}
                  <label className="mt-3">Überlagerung für OBS / vMix</label>
                  <div className="mono">
                    {netzBasis(network)}/?buehne={buehne === ALLE_BUEHNEN ? HAUPTBUEHNE : buehne}&amp;ueberlagerung=1
                    {network.token ? `&t=${network.token}` : ''}
                  </div>
                  <div className="hint">
                    Nur Bauchbinde, Rednerreihe und Untertitel auf durchsichtigem Grund — als
                    Browser-Quelle über das Kamerabild gelegt. Das Kamerabild selbst holt die
                    Bildmischung direkt über NDI; diese Seite zeigt es nicht.
                  </div>

                  <label className="mt-3">Prompter am Pult</label>
                  <div className="mono">
                    {netzBasis(network)}/prompter{network.token ? `?t=${network.token}` : ''}
                  </div>
                  {network.allowRemoteOperator && (
                    <>
                      <label className="mt-3">Bedienung (Anmeldung erforderlich)</label>
                      <div className="mono">{netzBasis(network)}/operator</div>
                    </>
                  )}
                  <div className="hint mt-3">
                    Port, Token und Freigaben: <strong>Einstellungen → Beamer</strong>.
                  </div>
                </>
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
                        <td className="zeitstempel">{formatTimeDe(entry.timestamp)}</td>
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

/** Erscheinungsbild der Beameransicht: Farben und Logo (Beamer §40, §68). */
import { useEffect, useState } from 'react'
import {
  DEFAULT_PROJECTION_THEME,
  LOGO_POSITIONS,
  LOGO_POSITION_LABELS,
  type ProjectionCandidate,
  type ProjectionState,
  type ProjectionTheme
} from '@shared/projection'
import { api } from '../../lib/api'
import { ProjectionScreen } from '../../projection/ProjectionScreen'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

const COLOR_FIELDS: { key: keyof ProjectionTheme; label: string; hint?: string }[] = [
  { key: 'background', label: 'Hintergrund' },
  { key: 'text', label: 'Schrift' },
  { key: 'muted', label: 'Nebentext', hint: 'Kopf- und Fußzeile' },
  { key: 'primary', label: 'Hervorhebung', hint: 'z. B. „WAHL LÄUFT"' },
  { key: 'success', label: 'Erfolg', hint: 'z. B. „GEWÄHLT"' },
  { key: 'warning', label: 'Warnung', hint: 'z. B. „AUSZÄHLUNG LÄUFT"' },
  { key: 'danger', label: 'Ablehnung', hint: 'z. B. „NICHT GEWÄHLT"' },
  { key: 'surface', label: 'Flaechen' }
]

const PRESETS: { name: string; theme: Partial<ProjectionTheme> }[] = [
  { name: 'Dunkel (Standard)', theme: DEFAULT_PROJECTION_THEME },
  {
    name: 'Hell',
    theme: {
      background: '#ffffff',
      surface: '#f2f4f7',
      text: '#101418',
      muted: '#5b6874',
      primary: '#0b5cd5',
      success: '#1a7f37',
      warning: '#9a6700',
      danger: '#cf222e'
    }
  },
  {
    name: 'Blau',
    theme: {
      background: '#0a1a2f',
      surface: '#12294a',
      text: '#f4f8ff',
      muted: '#9dbbdd',
      primary: '#4da3ff',
      success: '#3fc27a',
      warning: '#ffc247',
      danger: '#ff7a6b'
    }
  }
]

/**
 * Ein Ergebnis, an dem sich alle Farben zeigen: Gewählte in Erfolgsfarbe,
 * Nichtgewählte in Ablehnung, Zahlen in Hervorhebung, Kopf- und Fußzeile im
 * Nebenton.
 */
const BEISPIEL_KANDIDATEN: ProjectionCandidate[] = [
  { id: 'a', ballotNumber: 1, displayName: 'Anna Beckmann', votes: 64, elected: true },
  { id: 'b', ballotNumber: 2, displayName: 'Jonas Kröger', votes: 41, elected: false },
  { id: 'c', ballotNumber: 3, displayName: 'Miriam Sander', votes: 12, elected: false }
]

const BEISPIEL: Pick<ProjectionState, 'mode' | 'round' | 'result'> = {
  mode: 'result',
  round: {
    id: 'beispiel',
    roundNumber: 1,
    roundLabel: 'Wahlgang 01',
    roundCode: 'BEISPIEL-WG01',
    title: 'Wahl des Vorsitzes',
    procedure: 'single_multiple_candidates',
    procedureLabel: 'Einzelwahl – mehrere Kandidaten',
    seats: 1,
    maxVotes: 1,
    candidates: BEISPIEL_KANDIDATEN,
    candidateCount: BEISPIEL_KANDIDATEN.length,
    status: 'completed'
  },
  result: {
    status: 'confirmed',
    ballotsCast: 119,
    validBallots: 117,
    invalidBallots: 2,
    candidates: BEISPIEL_KANDIDATEN,
    showAll: true,
    finalMessage: 'Erforderliche Mehrheit im ersten Wahlgang erreicht'
  }
}

export function ProjectionDesign(): React.JSX.Element {
  const app = useApp()
  const [theme, setTheme] = useState<ProjectionTheme>(
    app.settings?.projectionTheme ?? DEFAULT_PROJECTION_THEME
  )
  const [busy, setBusy] = useState(false)

  /*
   * Woran sich Farben beurteilen lassen.
   *
   * Läuft gerade ein Foliensatz oder ein Film, zeigt die Beameransicht ein
   * fremdes Dokument oder ein Videobild — von den eingestellten Farben ist
   * dort nichts zu sehen, und die Vorschau wirkt kaputt. Dann tritt ein
   * Beispielergebnis an seine Stelle: Es kommt in jeder Versammlung vor und
   * enthält alle sechs Farben auf einmal.
   */
  const zeigtBeispiel = app.projection.mode === 'presentation' || app.projection.mode === 'video'
  const vorschauZustand = zeigtBeispiel ? { ...app.projection, ...BEISPIEL } : app.projection

  useEffect(() => {
    if (app.settings?.projectionTheme) setTheme(app.settings.projectionTheme)
  }, [app.settings?.projectionTheme])

  const save = async (next: ProjectionTheme): Promise<void> => {
    setBusy(true)
    try {
      const saved = await api('projection.setTheme', next)
      setTheme(saved)
      await app.refreshSettings()
      app.notify('ok', 'Beamer-Erscheinungsbild übernommen.')
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  const chooseLogo = async (): Promise<void> => {
    try {
      const dataUrl = await api('system.chooseImage', 'Logo für die Beameransicht wählen')
      if (dataUrl) setTheme({ ...theme, logo: dataUrl })
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <div className="grid cols-2">
      <div>
        <Card title="Farben">
          <div className="row">
            {PRESETS.map((preset) => (
              <button key={preset.name} onClick={() => setTheme({ ...theme, ...preset.theme })}>
                {preset.name}
              </button>
            ))}
          </div>
          <div className="grid cols-2 mt-3">
            {COLOR_FIELDS.map((entry) => (
              <Field key={entry.key} label={entry.label} hint={entry.hint}>
                <div className="row">
                  <input
                    type="color"
                    value={String(theme[entry.key] ?? '#000000')}
                    onChange={(e) => setTheme({ ...theme, [entry.key]: e.target.value })}
                    style={{ width: 64, padding: 4, height: 42 }}
                  />
                  <input
                    value={String(theme[entry.key] ?? '')}
                    onChange={(e) => setTheme({ ...theme, [entry.key]: e.target.value })}
                    className="col"
                  />
                </div>
              </Field>
            ))}
          </div>
          <div className="hint">
            Der Status wird nie allein über Farbe vermittelt — es steht immer zusätzlich Text dort. Bitte auf
            ausreichenden Kontrast achten, damit die Anzeige auch aus der letzten Reihe lesbar bleibt.
          </div>
        </Card>

        <Card title="Logo">
          <div className="row">
            <button onClick={() => void chooseLogo()}>Bilddatei wählen …</button>
            {theme.logo && (
              <button className="ghost" onClick={() => setTheme({ ...theme, logo: '' })}>
                Logo entfernen
              </button>
            )}
          </div>
          <div className="hint">
            Das Bild wird in die Konfiguration eingebettet (PNG, JPEG, GIF, WebP oder SVG, maximal 1,5 MB). Es
            wird nichts aus dem Netz nachgeladen; die Netzwerkansicht zeigt dasselbe Logo.
          </div>
          {theme.logo && (
            <div style={{ marginTop: 10, background: theme.background, padding: 12, borderRadius: 8 }}>
              <img src={theme.logo} alt="Logo-Vorschau" style={{ maxHeight: 80, maxWidth: '100%' }} />
            </div>
          )}
          <div className="row mt-3">
            <div className="col">
              <Field label="Platzierung">
                <select
                  value={theme.logoPosition}
                  onChange={(e) =>
                    setTheme({ ...theme, logoPosition: e.target.value as ProjectionTheme['logoPosition'] })
                  }
                >
                  {LOGO_POSITIONS.map((position) => (
                    <option key={position} value={position}>
                      {LOGO_POSITION_LABELS[position]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="col-mittel">
              <Field label="Höhe (% der Bildhöhe)">
                <NumberInput
                  value={theme.logoSizePercent}
                  min={3}
                  max={60}
                  onChange={(value) => setTheme({ ...theme, logoSizePercent: value })}
                />
              </Field>
            </div>
            <div className="col-mittel">
              <Field label="Deckkraft (%)" hint="Für das Wasserzeichen niedrig wählen.">
                <NumberInput
                  value={Math.round(theme.logoOpacity * 100)}
                  min={5}
                  max={100}
                  onChange={(value) => setTheme({ ...theme, logoOpacity: Math.max(5, value) / 100 })}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Anzeigeoptionen">
          <h3>Kopfzeile</h3>
          <Checkbox
            checked={theme.showOrganization}
            onChange={(value) => setTheme({ ...theme, showOrganization: value })}
            label="Organisation anzeigen (entfällt, wenn dort das Logo steht)"
          />
          <Checkbox
            checked={theme.showEventTitle}
            onChange={(value) => setTheme({ ...theme, showEventTitle: value })}
            label="Veranstaltungstitel anzeigen"
          />
          <Checkbox
            checked={theme.showEventDate}
            onChange={(value) => setTheme({ ...theme, showEventDate: value })}
            label="Datum anzeigen"
          />
          <Checkbox
            checked={theme.showClock}
            onChange={(value) => setTheme({ ...theme, showClock: value })}
            label="Uhrzeit anzeigen"
          />

          <h3>Fußzeile</h3>
          <Checkbox
            checked={theme.showRoundLabel}
            onChange={(value) => setTheme({ ...theme, showRoundLabel: value })}
            label="Wahlgangnummer anzeigen"
          />
          <Checkbox
            checked={theme.showRoundCode}
            onChange={(value) => setTheme({ ...theme, showRoundCode: value })}
            label="Wahlgangkennung anzeigen"
          />

          <h3>Darstellung</h3>
          <div className="row">
            <div className="col-breit">
              <Field label="Schriftgröße (%)" hint="Wirkt auf die gesamte Anzeige.">
                <NumberInput
                  value={Math.round(theme.fontScale * 100)}
                  min={70}
                  max={150}
                  onChange={(value) => setTheme({ ...theme, fontScale: Math.max(70, value) / 100 })}
                />
              </Field>
            </div>
            <div className="col-breit">
              <Field label="Randabstand (%)" hint="Gegen Overscan bei Projektoren.">
                <NumberInput
                  value={theme.safeAreaPercent}
                  min={0}
                  max={15}
                  onChange={(value) => setTheme({ ...theme, safeAreaPercent: value })}
                />
              </Field>
            </div>
          </div>
          <Checkbox
            checked={theme.uppercaseHeadings}
            onChange={(value) => setTheme({ ...theme, uppercaseHeadings: value })}
            label="Kopfzeile in Großbuchstaben"
          />
          <Checkbox
            checked={theme.transitions}
            onChange={(value) => setTheme({ ...theme, transitions: value })}
            label="Sanfte Einblendung beim Wechsel"
          />
        </Card>

        <div className="row">
          <button className="primary big" disabled={busy} onClick={() => void save(theme)}>
            Übernehmen
          </button>
          <button disabled={busy} onClick={() => void save(DEFAULT_PROJECTION_THEME)}>
            Auf Standard zurücksetzen
          </button>
        </div>
      </div>

      <Card title="Vorschau">
        <div className="preview-frame">
          <ProjectionScreen state={{ ...vorschauZustand, theme }} preview />
        </div>
        <div className="hint mt-3">
          {zeigtBeispiel
            ? 'Auf dem Beamer läuft gerade ein Foliensatz oder ein Film — daran lassen sich die Farben nicht beurteilen. Gezeigt wird deshalb ein Beispielergebnis.'
            : 'Die Vorschau zeigt den aktuellen Beamerinhalt mit den gewählten Farben.'}{' '}
          Sie wird erst nach „Übernehmen“ auf dem Beamer wirksam.
        </div>
      </Card>
    </div>
  )
}

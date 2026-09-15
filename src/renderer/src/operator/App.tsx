/** Rahmen der Operator-Oberfläche: Navigation, Tastatur, Meldungen. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { useApp } from './state'
import { AgendaPage } from './pages/AgendaPage'
import { AntraegePage } from './pages/AntraegePage'
import { AkkreditierungPage } from './pages/AkkreditierungPage'
import { AusgabePage } from './pages/AusgabePage'
import { DigitaleWahlPage } from './pages/DigitaleWahlPage'
import { AuditPage } from './pages/AuditPage'
import { BeamerPage } from './pages/BeamerPage'
import { PrompterPage } from './pages/PrompterPage'
import { DashboardPage } from './pages/DashboardPage'
import { EventPage } from './pages/EventPage'
import { LoginPage } from './pages/LoginPage'
import { PreflightPage } from './pages/PreflightPage'
import { RoundDetailPage } from './pages/RoundDetailPage'
import { RoundWizardPage } from './pages/RoundWizardPage'
import { SettingsPage } from './pages/SettingsPage'
import { SetupPage } from './pages/SetupPage'
import { RecoveryDialog } from './pages/RecoveryDialog'
import logo from '../assets/logo.svg'
import logoHell from '../assets/logo-dunkelmodus.svg'

export type Route =
  | { name: 'dashboard' }
  | { name: 'event' }
  | { name: 'agenda' }
  | { name: 'antraege' }
  | { name: 'akkreditierung' }
  | { name: 'ausgabe' }
  | { name: 'digitalewahl' }
  | { name: 'round-new' }
  | { name: 'round'; id: string; tab?: string }
  | { name: 'beamer' }
  | { name: 'prompter' }
  | { name: 'audit' }
  | { name: 'preflight' }
  | { name: 'settings' }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [name, param, tab] = raw.split('/')
  switch (name) {
    case 'event':
      return { name: 'event' }
    case 'agenda':
      return { name: 'agenda' }
    case 'antraege':
      return { name: 'antraege' }
    case 'akkreditierung':
      return { name: 'akkreditierung' }
    case 'ausgabe':
      return { name: 'ausgabe' }
    case 'digitalewahl':
      return { name: 'digitalewahl' }
    case 'round':
      return param === 'new' ? { name: 'round-new' } : { name: 'round', id: param, tab }
    case 'beamer':
      return { name: 'beamer' }
    case 'prompter':
      return { name: 'prompter' }
    case 'audit':
      return { name: 'audit' }
    case 'preflight':
      return { name: 'preflight' }
    case 'settings':
      return { name: 'settings' }
    default:
      return { name: 'dashboard' }
  }
}

/**
 * Die Navigation als Beschreibung, nicht als Abschrift.
 *
 * Vorher stand jeder Eintrag zweimal da — einmal als Knopf, einmal in der
 * Route. Hier steht er einmal, und die Reihenfolge ist die des Abends.
 */
const GRUPPEN: {
  titel: string
  punkte: { label: string; ziel: string; route: Route['name']; hint?: string }[]
}[] = [
  {
    titel: 'Versammlung',
    punkte: [
      { label: 'Übersicht', ziel: 'dashboard', route: 'dashboard' },
      { label: 'Veranstaltung', ziel: 'event', route: 'event' },
      { label: 'Tagesordnung', ziel: 'agenda', route: 'agenda', hint: 'Strg+T' },
      /* Anträge stehen bei der Versammlung, nicht bei den Wahlgängen: Ein
         Antrag wird eingereicht, bevor jemand weiß, ob darüber abgestimmt
         wird — und viele erreichen nie einen Wahlgang. */
      { label: 'Anträge', ziel: 'antraege', route: 'antraege' }
    ]
  },
  {
    titel: 'Einlass',
    punkte: [
      { label: 'Akkreditierung', ziel: 'akkreditierung', route: 'akkreditierung' },
      { label: 'Stimmzettel ausgeben', ziel: 'ausgabe', route: 'ausgabe' }
    ]
  },
  {
    titel: 'Wahlgänge',
    punkte: [
      { label: 'Neuer Wahlgang', ziel: 'round/new', route: 'round-new', hint: 'Strg+N' },
      /* Die digitale Abstimmung gehört zu einem Wahlgang, nicht neben ihn —
         im Wahlgang selbst ist sie ein Reiter, hier der Weg von außen. */
      { label: 'Digitale Abstimmung', ziel: 'digitalewahl', route: 'digitalewahl' }
    ]
  },
  {
    titel: 'Anzeige',
    punkte: [
      { label: 'Beamer', ziel: 'beamer', route: 'beamer', hint: 'Strg+B' },
      { label: 'Prompter', ziel: 'prompter', route: 'prompter', hint: 'Strg+P' }
    ]
  },
  {
    titel: 'Verwaltung',
    punkte: [
      { label: 'Audit-Trail', ziel: 'audit', route: 'audit' },
      { label: 'Systemcheck', ziel: 'preflight', route: 'preflight' },
      { label: 'Einstellungen', ziel: 'settings', route: 'settings' }
    ]
  }
]

/**
 * Eine Gruppe in der Navigation — zuklappbar.
 *
 * Die Überschrift ordnet und ist zugleich der Griff. Zugeklappt bleibt sie
 * es über Neustarts hinweg: Wer den Prompter nie benutzt, soll ihn nicht
 * jeden Abend wegscrollen müssen.
 */
function NavGruppe({
  titel,
  offen,
  aufKlappen,
  children
}: {
  titel: string
  offen: boolean
  aufKlappen: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="nav-gruppe-block">
      <button className="nav-gruppe" onClick={aufKlappen} aria-expanded={offen}>
        <span className={`nav-pfeil${offen ? ' offen' : ''}`}>›</span>
        {titel}
      </button>
      {offen && children}
    </div>
  )
}

export function navigate(path: string): void {
  window.location.hash = `#/${path.replace(/^\/+/, '')}`
}

export function App(): React.JSX.Element {
  const app = useApp()
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const handler = (): void => setRoute(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Tastaturkuerzel (§40). Kein Kürzel löst ohne Bestätigung einen Druck aus.
  useEffect(() => {
    const handler = (keyEvent: KeyboardEvent): void => {
      if (!keyEvent.ctrlKey || keyEvent.repeat) return
      if (keyEvent.key.toLowerCase() === 'n') {
        keyEvent.preventDefault()
        navigate('round/new')
      }
      if (keyEvent.key.toLowerCase() === 'b') {
        keyEvent.preventDefault()
        navigate('beamer')
      }
      if (keyEvent.key.toLowerCase() === 't') {
        keyEvent.preventDefault()
        navigate('agenda')
      }
      if (keyEvent.key.toLowerCase() === 'p') {
        keyEvent.preventDefault()
        navigate('prompter')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  /* Welche Gruppen zugeklappt sind — überdauert den Neustart. */
  const [offeneGruppen, setOffeneGruppen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('wz-nav') ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })

  const klappen = useCallback((titel: string) => {
    setOffeneGruppen((bisher) => {
      const naechste = { ...bisher, [titel]: bisher[titel] === false }
      try {
        localStorage.setItem('wz-nav', JSON.stringify(naechste))
      } catch {
        /* Ohne Gedächtnis ist es unbequem, aber nicht kaputt. */
      }
      return naechste
    })
  }, [])

  const logout = useCallback(async () => {
    await api('auth.logout')
    await app.refreshAll()
  }, [app])

  if (!app.ready) {
    return <div className="center-screen">Anwendung wird geladen …</div>
  }
  if (app.setup?.needsSetup) {
    return <SetupPage />
  }
  if (!app.session) {
    return <LoginPage />
  }

  const activeRound = app.rounds.find((round) => round.status !== 'completed' && round.status !== 'cancelled')

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          {/* Zwei Fassungen der Wortmarke: die dunkelblaue Vorlage wäre auf
              dunklem Grund nicht lesbar. Welche erscheint, entscheidet das
              Design (siehe app.css). */}
          <img className="brand-logo hell" src={logoHell} alt="Votura" />
          <img className="brand-logo dunkel" src={logo} alt="Votura" />
          <small>Software für die Mitgliederversammlung</small>
        </div>

        {/*
          **Die Navigation erzählt den Abend — und trägt inzwischen viel.**

          Sie steht in der Reihenfolge, in der ein Abend abläuft: vorbereiten,
          einlassen, abstimmen, anzeigen. Verwaltung zuletzt, denn die braucht
          man selten und nie in Eile.

          Mit den zuletzt dazugekommenen Funktionen wurde die Spalte zu lang:
          zwölf Einträge, fünf Überschriften und dazu die Wahlgänge. Deshalb
          lassen sich Gruppen zuklappen, und was zugeklappt war, ist es beim
          nächsten Start wieder — wer den Prompter nie benutzt, soll ihn nicht
          jeden Abend wegscrollen müssen.
        */}
        {GRUPPEN.map((gruppe) => (
          <NavGruppe
            key={gruppe.titel}
            titel={gruppe.titel}
            offen={offeneGruppen[gruppe.titel] !== false}
            aufKlappen={() => klappen(gruppe.titel)}
          >
            {gruppe.punkte.map((punkt) => (
              <NavItem
                key={punkt.ziel}
                label={punkt.label}
                active={route.name === punkt.route}
                onClick={() => navigate(punkt.ziel)}
                hint={punkt.hint}
              />
            ))}
            {gruppe.titel === 'Wahlgänge' && app.rounds.length > 0 && (
              <div className="nav-section">
                {app.rounds.map((round) => (
                  <button
                    key={round.id}
                    className={`nav-round${route.name === 'round' && route.id === round.id ? ' active' : ''}${
                      round.status === 'completed' || round.status === 'cancelled' ? ' done' : ''
                    }`}
                    onClick={() => navigate(`round/${round.id}`)}
                    title={round.title}
                  >
                    <span className="nav-round-label">
                      {round.sequentialNumber > 0 ? round.roundLabel : '–'}
                    </span>
                    <span className="nav-round-title">{round.title}</span>
                    {round.id === activeRound?.id && <span className="nav-round-dot" title="aktuell" />}
                  </button>
                ))}
              </div>
            )}
          </NavGruppe>
        ))}
        <div className="sidebar-footer">
          <div>
            <strong>{app.session.user.displayName}</strong>
            <br />
            {app.session.user.role}
          </div>
          <button className="ghost" onClick={app.toggleTheme}>
            {app.theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
          </button>
          <button className="ghost" onClick={() => void logout()}>
            Abmelden
          </button>
          <div>Version {app.setup?.version}</div>
        </div>
      </nav>

      <main className="main">
        {app.notices.map((notice) => (
          <div
            key={notice.id}
            className={`notice ${notice.level === 'ok' ? 'ok' : notice.level === 'error' ? 'error' : notice.level === 'warning' ? 'warn' : ''}`}
            role="status"
          >
            <span>{notice.message}</span>
            {/* Sichtbar, nicht bloß möglich: Dass die ganze Fläche klickbar
                war, wusste niemand — und Fehler blieben deshalb stehen. */}
            <button
              className="notice-zu"
              title="Meldung schließen"
              aria-label="Meldung schließen"
              onClick={() => app.dismissNotice(notice.id)}
            >
              ×
            </button>
          </div>
        ))}

        <RecoveryDialog />

        {route.name === 'dashboard' && <DashboardPage />}
        {route.name === 'event' && <EventPage />}
        {route.name === 'agenda' && <AgendaPage />}
        {route.name === 'antraege' && <AntraegePage />}
        {route.name === 'akkreditierung' && <AkkreditierungPage />}
        {route.name === 'ausgabe' && <AusgabePage />}
        {route.name === 'digitalewahl' && <DigitaleWahlPage />}
        {route.name === 'round-new' && <RoundWizardPage />}
        {route.name === 'round' && <RoundDetailPage roundId={route.id} tab={route.tab} />}
        {route.name === 'beamer' && <BeamerPage />}
        {route.name === 'prompter' && <PrompterPage />}
        {route.name === 'audit' && <AuditPage />}
        {route.name === 'preflight' && <PreflightPage />}
        {route.name === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

function NavItem({
  label,
  active,
  onClick,
  hint
}: {
  label: string
  active: boolean
  onClick: () => void
  hint?: string
}): React.JSX.Element {
  return (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {hint && <span className="badge">{hint}</span>}
    </button>
  )
}

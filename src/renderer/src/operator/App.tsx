/** Rahmen der Operator-Oberfläche: Navigation, Tastatur, Meldungen. */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useApp } from './state'
import { AgendaPage } from './pages/AgendaPage'
import { AuditPage } from './pages/AuditPage'
import { BeamerPage } from './pages/BeamerPage'
import { DashboardPage } from './pages/DashboardPage'
import { EventPage } from './pages/EventPage'
import { LoginPage } from './pages/LoginPage'
import { PreflightPage } from './pages/PreflightPage'
import { RoundDetailPage } from './pages/RoundDetailPage'
import { RoundWizardPage } from './pages/RoundWizardPage'
import { SettingsPage } from './pages/SettingsPage'
import { SetupPage } from './pages/SetupPage'
import { RecoveryDialog } from './pages/RecoveryDialog'

export type Route =
  | { name: 'dashboard' }
  | { name: 'event' }
  | { name: 'agenda' }
  | { name: 'round-new' }
  | { name: 'round'; id: string; tab?: string }
  | { name: 'beamer' }
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
    case 'round':
      return param === 'new' ? { name: 'round-new' } : { name: 'round', id: param, tab }
    case 'beamer':
      return { name: 'beamer' }
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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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

  const activeRound = app.rounds.find(
    (round) => round.status !== 'completed' && round.status !== 'cancelled'
  )

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          Votura
          <small>Wahlgang- und Stimmzettelverwaltung</small>
        </div>

        <NavItem label="Übersicht" active={route.name === 'dashboard'} onClick={() => navigate('dashboard')} />
        <NavItem label="Veranstaltung" active={route.name === 'event'} onClick={() => navigate('event')} />
        <NavItem
          label="Tagesordnung"
          active={route.name === 'agenda'}
          onClick={() => navigate('agenda')}
          hint="Strg+T"
        />
        <NavItem
          label="Neuer Wahlgang"
          active={route.name === 'round-new'}
          onClick={() => navigate('round/new')}
          hint="Strg+N"
        />

        {app.rounds.length > 0 && (
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
        <NavItem label="Beamer" active={route.name === 'beamer'} onClick={() => navigate('beamer')} hint="Strg+B" />
        <NavItem label="Audit-Trail" active={route.name === 'audit'} onClick={() => navigate('audit')} />
        <NavItem label="Systemcheck" active={route.name === 'preflight'} onClick={() => navigate('preflight')} />
        <NavItem label="Einstellungen" active={route.name === 'settings'} onClick={() => navigate('settings')} />

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
            onClick={() => app.dismissNotice(notice.id)}
            role="status"
          >
            {notice.message}
          </div>
        ))}

        <RecoveryDialog />

        {route.name === 'dashboard' && <DashboardPage />}
        {route.name === 'event' && <EventPage />}
        {route.name === 'agenda' && <AgendaPage />}
        {route.name === 'round-new' && <RoundWizardPage />}
        {route.name === 'round' && <RoundDetailPage roundId={route.id} tab={route.tab} />}
        {route.name === 'beamer' && <BeamerPage />}
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

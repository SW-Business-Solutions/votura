/** Gemeinsamer Zustand der Operator-Oberfläche: Sitzung, Veranstaltung, Meldungen. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { SystemSettings } from '@shared/config'
import type { SetupState } from '@shared/ipc'
import { EMPTY_PROJECTION_STATE, type AudienceWindowState, type ProjectionState } from '@shared/projection'
import type {
  ElectionEvent,
  Permission,
  PrintProgress,
  RoundSummary,
  Session,
  UUID
} from '@shared/types'
import { api, bridge, errorMessage } from '../lib/api'

export interface Notice {
  id: number
  level: 'info' | 'warning' | 'error' | 'ok'
  message: string
}

interface AppState {
  ready: boolean
  setup: SetupState | null
  session: Session | null
  settings: SystemSettings | null
  event: ElectionEvent | null
  rounds: RoundSummary[]
  projection: ProjectionState
  audience: AudienceWindowState | null
  printProgress: PrintProgress | null
  notices: Notice[]
  theme: 'dark' | 'light'
  can(permission: Permission): boolean
  notify(level: Notice['level'], message: string): void
  dismissNotice(id: number): void
  reportError(error: unknown): void
  refreshAll(): Promise<void>
  refreshRounds(): Promise<void>
  refreshSettings(): Promise<void>
  setActiveEvent(eventId: UUID | null): Promise<void>
  toggleTheme(): void
  clearPrintProgress(): void
}

const AppStateContext = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [event, setEvent] = useState<ElectionEvent | null>(null)
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [projection, setProjection] = useState<ProjectionState>(EMPTY_PROJECTION_STATE)
  const [audience, setAudience] = useState<AudienceWindowState | null>(null)
  const [printProgress, setPrintProgress] = useState<PrintProgress | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('wz-theme') as 'dark' | 'light') ?? 'dark'
  )
  const noticeId = useRef(1)

  const notify = useCallback((level: Notice['level'], message: string) => {
    const id = noticeId.current++
    setNotices((current) => {
      // Dieselbe Meldung nicht mehrfach übereinander stapeln.
      if (current.some((notice) => notice.message === message && notice.level === level)) return current
      return [...current, { id, level, message }]
    })
    if (level === 'ok' || level === 'info') {
      window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 6000)
    }
  }, [])

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [])

  const reportError = useCallback(
    (error: unknown) => {
      notify('error', errorMessage(error))
    },
    [notify]
  )

  const refreshRounds = useCallback(async () => {
    if (!event) {
      setRounds([])
      return
    }
    try {
      setRounds(await api('round.list', event.id))
    } catch (error) {
      reportError(error)
    }
  }, [event, reportError])

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api('system.settings'))
    } catch (error) {
      reportError(error)
    }
  }, [reportError])

  const refreshAll = useCallback(async () => {
    try {
      const [setupState, currentSession] = await Promise.all([api('system.setupState'), api('auth.session')])
      setSetup(setupState)
      setSession(currentSession)
      if (currentSession) {
        const [currentEvent, currentSettings, projectionState, audienceState] = await Promise.all([
          api('event.active'),
          api('system.settings'),
          api('projection.state'),
          api('projection.audienceState')
        ])
        setEvent(currentEvent)
        setSettings(currentSettings)
        setProjection(projectionState)
        setAudience(audienceState)
      } else {
        setEvent(null)
        setRounds([])
      }
    } catch (error) {
      reportError(error)
    } finally {
      setReady(true)
    }
  }, [reportError])

  const setActiveEvent = useCallback(
    async (eventId: UUID | null) => {
      if (!eventId) {
        setEvent(null)
        setRounds([])
        return
      }
      try {
        setEvent(await api('event.activate', eventId))
      } catch (error) {
        reportError(error)
      }
    },
    [reportError]
  )

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    void refreshRounds()
  }, [refreshRounds])

  useEffect(() => {
    const offProgress = bridge.onPrintProgress(setPrintProgress)
    const offProjection = bridge.onProjectionState(setProjection)
    const offAudience = bridge.onAudienceState(setAudience)
    const offSession = bridge.onSessionChanged((next) => {
      setSession(next)
      if (!next) notify('warning', 'Die Sitzung wurde beendet. Bitte erneut anmelden.')
    })
    const offNotice = bridge.onNotice((notice) => notify(notice.level, notice.message))
    return () => {
      offProgress()
      offProjection()
      offAudience()
      offSession()
      offNotice()
    }
  }, [notify])

  // Sitzung bei Aktivität verlaengern (§56).
  useEffect(() => {
    if (!session) return
    const touch = (): void => {
      void api('auth.touch').catch(() => undefined)
    }
    const timer = window.setInterval(touch, 60_000)
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
    }
  }, [session])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('wz-theme', theme)
  }, [theme])

  const value = useMemo<AppState>(
    () => ({
      ready,
      setup,
      session,
      settings,
      event,
      rounds,
      projection,
      audience,
      printProgress,
      notices,
      theme,
      can: (permission) => session?.permissions.includes(permission) ?? false,
      notify,
      dismissNotice,
      reportError,
      refreshAll,
      refreshRounds,
      refreshSettings,
      setActiveEvent,
      toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
      clearPrintProgress: () => setPrintProgress(null)
    }),
    [
      ready,
      setup,
      session,
      settings,
      event,
      rounds,
      projection,
      audience,
      printProgress,
      notices,
      theme,
      notify,
      dismissNotice,
      reportError,
      refreshAll,
      refreshRounds,
      refreshSettings,
      setActiveEvent
    ]
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useApp(): AppState {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('AppStateProvider fehlt.')
  return context
}

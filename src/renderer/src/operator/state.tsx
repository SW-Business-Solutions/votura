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
import { PROMPTER_VORGABE, type PrompterViewState } from '@shared/speech'
import {
  ALLE_BUEHNEN,
  BUEHNE_VORGABE,
  EMPTY_PROJECTION_STATE,
  HAUPTBUEHNE,
  type AudienceWindowState,
  type Buehne,
  type Buehnenwahl,
  type ProjectionState
} from '@shared/projection'
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
  /**
   * Die Bühnen und die Bühne, die die Bedienung gerade bearbeitet.
   *
   * `projection` und `audience` zeigen immer auf diese eine Bühne — jede
   * Ansicht, die Folien, Videos oder Ansagen schaltet, trifft damit
   * automatisch die richtige, ohne die Bühne selbst zu kennen.
   */
  buehnen: Buehne[]
  /** Die bearbeitete Bühne, oder `ALLE_BUEHNEN` für den Master. */
  buehne: number
  setBuehne(id: number): void
  /**
   * Im Master angehakte Bühnen.
   *
   * Leer heißt „alle" — wer nichts anhakt, meint die ganze Versammlung.
   * Außerhalb des Masters bedeutungslos.
   */
  auswahl: number[]
  toggleAuswahl(id: number): void
  setAuswahl(ids: number[]): void
  /**
   * Worauf eine Schaltung wirkt — die eine Bühne, alle, oder die angehakten.
   *
   * Jede Ansicht, die etwas auf den Beamer bringt, reicht diesen Wert weiter
   * und muss die Unterscheidung nicht kennen.
   */
  ziel: Buehnenwahl
  refreshBuehnen(): Promise<void>
  projection: ProjectionState
  projektionen: Record<number, ProjectionState>
  audience: AudienceWindowState | null
  /** Der Stand des Teleprompters — eigener Weg, nicht der Projektionszustand. */
  prompter: PrompterViewState
  beamerfenster: Record<number, AudienceWindowState>
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
  const [buehnen, setBuehnen] = useState<Buehne[]>([{ ...BUEHNE_VORGABE }])
  const [buehne, setBuehne] = useState<number>(HAUPTBUEHNE)
  const [auswahl, setAuswahl] = useState<number[]>([])
  const [projektionen, setProjektionen] = useState<Record<number, ProjectionState>>({})
  const [audiences, setAudiences] = useState<Record<number, AudienceWindowState>>({})
  const [prompter, setPrompter] = useState<PrompterViewState>(PROMPTER_VORGABE)
  /* Der Master hat keinen eigenen Zustand — gezeigt wird die Hauptbühne. */
  /*
   * Die Bühne, deren Zustand die Bedienung anzeigt.
   *
   * Dieselbe Regel wie im Hauptprozess (`bezugsbuehne`): Ist die Hauptbühne
   * betroffen, gilt sie; sonst die erste angehakte. Sonst zeigte die Vorschau
   * eine Wand, die von der nächsten Schaltung gar nicht getroffen wird.
   */
  const bezug =
    buehne !== ALLE_BUEHNEN
      ? buehne
      : auswahl.length === 0 || auswahl.includes(HAUPTBUEHNE)
        ? HAUPTBUEHNE
        : auswahl[0]
  const ziel: Buehnenwahl =
    buehne === ALLE_BUEHNEN ? (auswahl.length > 0 ? auswahl : ALLE_BUEHNEN) : buehne
  const projection = projektionen[bezug] ?? EMPTY_PROJECTION_STATE
  const audience = audiences[bezug] ?? null
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
        const [currentEvent, currentSettings, stages] = await Promise.all([
          api('event.active'),
          api('system.settings'),
          api('projection.buehnen')
        ])
        setEvent(currentEvent)
        setSettings(currentSettings)
        setBuehnen(stages)
        void api('prompter.view').then(setPrompter).catch(() => undefined)
        /* Jede Bühne einmal vollständig holen — danach kommen nur noch
           Wechsel über das Ereignis herein. */
        const zustaende = await Promise.all(
          stages.map(async (stage) => ({
            id: stage.id,
            state: await api('projection.state', stage.id),
            audience: await api('projection.audienceState', stage.id)
          }))
        )
        setProjektionen(Object.fromEntries(zustaende.map((z) => [z.id, z.state])))
        setAudiences(Object.fromEntries(zustaende.map((z) => [z.id, z.audience])))
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

  const refreshBuehnen = useCallback(async () => {
    try {
      const stages = await api('projection.buehnen')
      setBuehnen(stages)
      /* Wurde die bearbeitete Bühne abgebaut, springt die Bedienung zurück
         auf die Hauptbühne, statt ins Leere zu zeigen. */
      setBuehne((current) =>
        current === ALLE_BUEHNEN || stages.some((stage) => stage.id === current)
          ? current
          : HAUPTBUEHNE
      )
    } catch (error) {
      reportError(error)
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
    const offProjection = bridge.onProjectionState(({ buehne: id, state }) => {
      setProjektionen((current) => ({ ...current, [id]: state }))
      /* Meldet sich eine Bühne, die diese Oberfläche nicht kennt, hat jemand
         anders sie angelegt — etwa von einem zweiten Gerät im Netz. */
      setBuehnen((current) => {
        if (!current.some((stage) => stage.id === id)) void refreshBuehnen()
        return current
      })
    })
    const offAudience = bridge.onAudienceState((state) =>
      setAudiences((current) => ({ ...current, [state.buehne]: state }))
    )
    const offPrompter = bridge.onPrompterView(setPrompter)
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
      offPrompter()
    }
  }, [notify, refreshBuehnen])

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
      buehnen,
      buehne,
      setBuehne,
      auswahl,
      setAuswahl,
      ziel,
      toggleAuswahl: (id) =>
        setAuswahl((current) =>
          current.includes(id) ? current.filter((eintrag) => eintrag !== id) : [...current, id]
        ),
      refreshBuehnen,
      projection,
      projektionen,
      audience,
      prompter,
      beamerfenster: audiences,
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
      buehnen,
      buehne,
      auswahl,
      ziel,
      refreshBuehnen,
      projection,
      projektionen,
      audience,
      audiences,
      prompter,
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

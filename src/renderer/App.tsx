import React, { Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/store'
import { TitleBar, Sidebar, Splash, CommandPalette, ShortcutsOverlay, useGlobalShortcuts, useViewport, NAV } from '@/components/Shell'
import { Toasts, Skeleton } from '@/components/ui'
import { Onboarding, WhatsNew } from '@/components/Onboarding'
import { UpdateCard } from '@/components/UpdateCard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import BackgroundLayer from '@/components/BackgroundLayer'
import { pageVariants, useMotionPrefs } from '@/lib/motion'
import Dashboard from '@/pages/Dashboard'
import Notes from '@/pages/Notes'
import Projects from '@/pages/Projects'
import Tasks from '@/pages/Tasks'

// Perf: everything except the four core productivity pages is code-split, so
// the initial bundle stays small and first paint is fast (less to parse, less
// startup RAM). Pages load on first navigation behind a skeleton fallback.
const AiPage = React.lazy(() => import('@/pages/Ai'))
const Files = React.lazy(() => import('@/pages/Files'))
const Editor = React.lazy(() => import('@/pages/Editor'))
const Downloads = React.lazy(() => import('@/pages/Downloads'))
const Compress = React.lazy(() => import('@/pages/Compress'))
const Images = React.lazy(() => import('@/pages/Images'))
const Video = React.lazy(() => import('@/pages/Video'))
const Vault = React.lazy(() => import('@/pages/Vault'))
const Network = React.lazy(() => import('@/pages/Network'))
const Resources = React.lazy(() => import('@/pages/Resources'))
const TaskManager = React.lazy(() => import('@/pages/TaskManager'))
const Screenshot = React.lazy(() => import('@/pages/Screenshot'))
const Shortcuts = React.lazy(() => import('@/pages/Shortcuts'))
const Settings = React.lazy(() => import('@/pages/Settings'))
const About = React.lazy(() => import('@/pages/About'))

const PAGES: Record<string, React.ComponentType> = { dashboard: Dashboard, notes: Notes, projects: Projects, tasks: Tasks, ai: AiPage, files: Files, editor: Editor, downloads: Downloads, compress: Compress, images: Images, video: Video, vault: Vault, network: Network, resources: Resources, taskManager: TaskManager, screenshot: Screenshot, shortcuts: Shortcuts, settings: Settings, about: About }

/** Position of a page in the sidebar NAV order. Pages outside NAV sort last, so known→unknown reads as forward and unknown→known as backward. */
const navIndex = (id: string): number => {
  const i = NAV.findIndex((n) => n.id === id)
  return i === -1 ? NAV.length : i
}

/** Fires a desktop notification + toast once per task when its reminder time arrives. */
function useReminders() {
  const { t } = useTranslation()
  const ready = useApp((s) => s.ready)
  const fired = useRef(new Set<string>())
  useEffect(() => {
    if (!ready) return
    const { toast } = useApp.getState()
    const ensurePermission = async () => {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) return
        // Only prompt when the user actually has reminders — never on a cold first launch.
        const hasReminders = useApp.getState().tasks.some((k) => k.reminderAt && k.status !== 'done')
        if (hasReminders && Notification.permission === 'default') {
          const r = await Notification.requestPermission().catch(() => 'denied')
          if (r !== 'granted') toast(t('tasks.reminder'), 'warning')
        }
      } catch { /* Notifications are optional; app should continue without them. */ }
    }
    void ensurePermission()

    const check = () => {
      if (document.hidden) return
      const { tasks, navigate } = useApp.getState()
      const now = Date.now()
      // Bound memory in long sessions: drop old keys once the set grows.
      if (fired.current.size > 500) {
        const keep = new Set<string>()
        for (const k of tasks) if (k.reminderAt && k.reminderAt > now - 86400000) keep.add(`${k.id}:${k.reminderAt}`)
        fired.current = keep
      }
      for (const k of tasks) {
        if (k.status === 'done' || !k.reminderAt || k.reminderAt > now) continue
        const key = `${k.id}:${k.reminderAt}`
        if (fired.current.has(key)) continue
        fired.current.add(key)
        toast(`${t('tasks.reminder')}: ${k.title}`, 'warning', { action: { label: t('common.open'), run: () => navigate('tasks', { open: k.id }) } })
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification('DragonHub', { body: `${t('tasks.reminderBody')}: ${k.title}` })
            n.onclick = () => { window.dh.window.show?.(); navigate('tasks', { open: k.id }) }
          }
        } catch { /* notifications are best-effort only */ }
      }
    }
    check()
    const i = setInterval(check, 30000)
    // Reminders that fell due while hidden: run once when returning to view.
    const onVis = () => { if (!document.hidden) check() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(i)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ready, t])
}

function PageFallback() {
  return (
    <div className="space-y-4 animate-fade-in" aria-busy="true">
      <div className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-xl" /><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></div></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      <Skeleton className="h-64" />
    </div>
  )
}

export default function App() {
  const ready = useApp((s) => s.ready)
  const page = useApp((s) => s.page)
  const init = useApp((s) => s.init)
  const { t } = useTranslation()
  const { reduced, off, k } = useMotionPrefs()
  const viewport = useViewport()
  const [drawer, setDrawer] = useState(false)
  useGlobalShortcuts()
  useReminders()
  useEffect(() => { init() }, [init])
  useEffect(() => { if (viewport !== 'mobile') setDrawer(false) }, [viewport])
  const Page = PAGES[page] || Dashboard
  // Direction-aware transition. Stale-ref compare during render: only refs are
  // touched, so it is safe. `dirRef` persists the last direction, so extra
  // renders (e.g. StrictMode) can never flip the animation.
  const prevPage = useRef(page)
  const dirRef = useRef<1 | -1>(1)
  if (prevPage.current !== page) {
    dirRef.current = navIndex(page) >= navIndex(prevPage.current) ? 1 : -1
    prevPage.current = page
  }
  // RTL mirrors the travel axis so forward still reads as forward in Arabic.
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  const dir: 1 | -1 = rtl ? (dirRef.current === 1 ? -1 : 1) : dirRef.current
  const v = pageVariants(reduced, k, dir)

  return (
    <MotionConfig reducedMotion={off ? 'always' : 'user'} transition={off ? { duration: 0 } : undefined}>
      <div className="app-root h-screen w-screen overflow-hidden bg-surface-50 text-surface-900 relative">
        <a href="#main" className="sr-only-focusable fixed top-2 start-2 z-[300] btn-primary">{t('a11y.skip')}</a>
        <div className="app-bg" aria-hidden />
        <BackgroundLayer />
        <div className="aurora fixed inset-0 pointer-events-none" />
        <div className="bg-detail" aria-hidden />
        <AnimatePresence>{!ready && <Splash key="splash" />}</AnimatePresence>
        {ready && (
          <div className="relative flex flex-col h-full">
            <TitleBar onMenu={viewport === 'mobile' ? () => setDrawer(true) : undefined} />
            <div className="flex flex-1 min-h-0">
              <Sidebar viewport={viewport} drawerOpen={drawer} onCloseDrawer={() => setDrawer(false)} />
              <main id="main" className="workspace-main flex-1 min-w-0 min-h-0 relative" tabIndex={-1}>
                {/* Crossfade, never wait-then-swap: the incoming page mounts
                    immediately and paints over the outgoing one, so a stalled
                    exit animation can never leave the workspace blank. */}
                <AnimatePresence initial={false}>
                  <motion.div key={page} className="absolute inset-0 overflow-y-auto px-3 pb-3 pt-1 sm:px-5 sm:pb-5 lg:px-6" variants={v} initial="initial" animate="enter" exit="exit">
                    <div className="min-h-full h-full max-w-[1600px] mx-auto">
                      <ErrorBoundary scope="page" resetKey={page}>
                        <Suspense fallback={<PageFallback />}><Page /></Suspense>
                      </ErrorBoundary>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </main>
            </div>
            <CommandPalette />
            <ShortcutsOverlay />
            <Onboarding />
            <WhatsNew />
            <UpdateCard floating />
            <Toasts />
          </div>
        )}
      </div>
    </MotionConfig>
  )
}

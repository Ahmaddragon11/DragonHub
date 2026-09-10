import React, { Suspense, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useApp } from '@/store'
import { TitleBar, Sidebar, Splash, CommandPalette, useGlobalShortcuts } from '@/components/Shell'
import { Toasts } from '@/components/ui'
import Dashboard from '@/pages/Dashboard'
import Notes from '@/pages/Notes'
import Projects from '@/pages/Projects'
import Tasks from '@/pages/Tasks'
import Files from '@/pages/Files'
import Shortcuts from '@/pages/Shortcuts'
import Settings from '@/pages/Settings'
import About from '@/pages/About'

// Perf: heavy pages are code-split so the initial bundle stays small and the
// app paints fast (less to read/parse on HDD, less startup RAM). They load on
// first navigation behind the Suspense fallback below.
const Editor = React.lazy(() => import('@/pages/Editor'))
const Downloads = React.lazy(() => import('@/pages/Downloads'))
const Compress = React.lazy(() => import('@/pages/Compress'))
const Images = React.lazy(() => import('@/pages/Images'))
const Video = React.lazy(() => import('@/pages/Video'))
const Vault = React.lazy(() => import('@/pages/Vault'))
const Network = React.lazy(() => import('@/pages/Network'))
const Resources = React.lazy(() => import('@/pages/Resources'))

const PAGES: Record<string, React.ComponentType> = { dashboard: Dashboard, notes: Notes, projects: Projects, tasks: Tasks, files: Files, editor: Editor, downloads: Downloads, compress: Compress, images: Images, video: Video, vault: Vault, network: Network, resources: Resources, shortcuts: Shortcuts, settings: Settings, about: About }

/** Fires a desktop notification + toast once per task when its reminder time arrives. */
function useReminders() {
  const { t } = useTranslation()
  const { tasks, navigate, toast } = useApp()
  const fired = useRef(new Set<string>())
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  useEffect(() => {
    const ensurePermission = async () => {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) return
        if (Notification.permission === 'default') {
          const r = await Notification.requestPermission().catch(() => 'denied')
          if (r !== 'granted') {
            toast(t('tasks.reminder'), 'warning')
          }
        }
      } catch {
        // Notifications are optional; app should continue without them.
      }
    }
    void ensurePermission()

    const check = () => {
      const now = Date.now()
      // Bound memory in long sessions: drop old keys once the set grows.
      if (fired.current.size > 500) {
        const keep = new Set<string>()
        for (const k of tasksRef.current) {
          if (k.reminderAt && k.reminderAt > now - 86400000) keep.add(`${k.id}:${k.reminderAt}`)
        }
        fired.current = keep
      }
      for (const k of tasksRef.current) {
        if (k.status === 'done' || !k.reminderAt || k.reminderAt > now) continue
        const key = `${k.id}:${k.reminderAt}`
        if (fired.current.has(key)) continue
        fired.current.add(key)
        toast(`${t('tasks.reminder')}: ${k.title}`, 'warning')
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification('DragonHub', { body: `${t('tasks.reminderBody')}: ${k.title}` })
            n.onclick = () => navigate('tasks', { open: k.id })
          }
        } catch {
          // notifications are best-effort only
        }
      }
    }
    check()
    const i = setInterval(check, 30000)
    return () => clearInterval(i)
  }, [navigate, toast, t])
}

export default function App() {
  const { ready, page, init, settings } = useApp()
  useGlobalShortcuts()
  useReminders()
  useEffect(() => { init() }, [])
  const Page = PAGES[page] || Dashboard
  const anim = settings.animations !== 'off'
  const animFull = settings.animations === 'full'
  const speed = Math.min(2, Math.max(0.5, Number(settings.animationSpeed) || 1))

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface-50 text-surface-900 relative">
      {anim && <div className="aurora fixed inset-0 pointer-events-none" />}
      <AnimatePresence>{!ready && <Splash key="splash" />}</AnimatePresence>
      {ready && (
        <div className="relative flex flex-col h-full">
          <TitleBar />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <main className="flex-1 min-w-0 min-h-0 relative">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={page} className="absolute inset-0 overflow-y-auto p-4 lg:p-6" initial={anim ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} exit={anim ? { opacity: 0, y: -8 } : undefined} transition={{ duration: (animFull ? 0.22 : 0.15) / speed, ease: [0.22, 1, 0.36, 1] }}>
                  <div className="min-h-full max-w-[1600px] mx-auto"><Suspense fallback={<div className="h-full flex items-center justify-center"><div className="splash-ring w-10 h-10" /></div>}><Page /></Suspense></div>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
          <CommandPalette />
          <Toasts />
        </div>
      )}
    </div>
  )
}

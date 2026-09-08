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
import Downloads from '@/pages/Downloads'
import Compress from '@/pages/Compress'
import Images from '@/pages/Images'
import Video from '@/pages/Video'
import Vault from '@/pages/Vault'
import Network from '@/pages/Network'
import Shortcuts from '@/pages/Shortcuts'
import Settings from '@/pages/Settings'
import About from '@/pages/About'

const Editor = React.lazy(() => import('@/pages/Editor'))

const PAGES: Record<string, React.ComponentType> = { dashboard: Dashboard, notes: Notes, projects: Projects, tasks: Tasks, files: Files, editor: Editor, downloads: Downloads, compress: Compress, images: Images, video: Video, vault: Vault, network: Network, shortcuts: Shortcuts, settings: Settings, about: About }

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

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface-50 text-surface-900 relative">
      <div className="aurora fixed inset-0 pointer-events-none" />
      <AnimatePresence>{!ready && <Splash key="splash" />}</AnimatePresence>
      {ready && (
        <div className="relative flex flex-col h-full">
          <TitleBar />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <main className="flex-1 min-w-0 min-h-0 relative">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={page} className="absolute inset-0 overflow-y-auto p-4 lg:p-6" initial={anim ? { opacity: 0, y: 12, scale: 0.995 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} exit={anim ? { opacity: 0, y: -8 } : undefined} transition={{ duration: 0.28 / settings.animationSpeed, ease: [0.22, 1, 0.36, 1] }}>
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

import { create } from 'zustand'
import { invoke } from '@/lib/api'
import i18n from '@/i18n'
import { DEFAULT_SETTINGS, type AppSettings, type Note, type Project, type Task, type DownloadItem } from '@shared/types'

export type PageId = 'dashboard' | 'notes' | 'projects' | 'tasks' | 'files' | 'editor' | 'downloads' | 'network' | 'compress' | 'images' | 'video' | 'vault' | 'shortcuts' | 'settings' | 'about'

export interface Toast { id: string; type: 'success' | 'error' | 'info' | 'warning'; text: string }

interface AppState {
  ready: boolean
  page: PageId
  pageParams: Record<string, unknown>
  settings: AppSettings
  systemTheme: 'dark' | 'light'
  toasts: Toast[]
  paletteOpen: boolean
  windowMaximized: boolean
  notes: Note[]
  projects: Project[]
  tasks: Task[]
  downloads: DownloadItem[]
  init: () => Promise<void>
  navigate: (p: PageId, params?: Record<string, unknown>) => void
  setSettings: (patch: Partial<AppSettings>) => Promise<void>
  resetSettings: () => Promise<void>
  toast: (text: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void
  setPalette: (open: boolean) => void
  saveNotes: (n: Note[]) => void
  saveProjects: (p: Project[]) => void
  saveTasks: (t: Task[]) => void
  setDownloads: (d: DownloadItem[]) => void
  updateDownload: (d: DownloadItem) => void
}

function applyTheme(s: AppSettings, sys: 'dark' | 'light') {
  const html = document.documentElement
  const theme = s.theme === 'system' ? sys : s.theme
  html.classList.toggle('dark', theme === 'dark')
  html.classList.toggle('light', theme === 'light')
  html.dataset.accent = s.accent
  html.dataset.anim = s.animations
  html.dataset.glass = s.glassEffect ? 'on' : 'off'
  html.style.setProperty('--anim-speed', String(s.animationSpeed))
  html.style.setProperty('--font-scale', String(s.fontScale))
  html.dir = s.language === 'ar' ? 'rtl' : 'ltr'
  html.lang = s.language
  document.body.classList.toggle('compact', s.compactMode)
  if (i18n.language !== s.language) i18n.changeLanguage(s.language)
}

const timers: Record<string, ReturnType<typeof setTimeout>> = {}
const pending: Record<string, unknown> = {}
function persist(key: string, value: unknown) {
  pending[key] = value
  clearTimeout(timers[key])
  timers[key] = setTimeout(() => {
    delete pending[key]
    invoke('data:set', key, value).catch(() => {})
  }, 250)
}
/** Best-effort synchronous flush of debounced writes (page hide / app close). */
function flushPersist() {
  for (const [key, timer] of Object.entries(timers)) {
    clearTimeout(timer)
    const value = pending[key]
    delete pending[key]
    if (value !== undefined) invoke('data:set', key, value).catch(() => {})
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPersist)
  window.addEventListener('beforeunload', flushPersist)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist() })
}

export const useApp = create<AppState>((set, get) => ({
  ready: false, page: 'dashboard', pageParams: {}, settings: DEFAULT_SETTINGS, systemTheme: 'dark', toasts: [], paletteOpen: false, windowMaximized: false,
  notes: [], projects: [], tasks: [], downloads: [],

  init: async () => {
    try {
      const [settings, sys, notes, projects, tasks, downloads, maximized] = await Promise.all([
        invoke<AppSettings>('settings:get'), invoke<'dark' | 'light'>('app:systemTheme'),
        invoke<Note[]>('data:get', 'notes', []), invoke<Project[]>('data:get', 'projects', []), invoke<Task[]>('data:get', 'tasks', []),
        invoke<DownloadItem[]>('dl:list'), window.dh.window.isMaximized(),
      ])
      applyTheme(settings, sys)
      set({ settings, systemTheme: sys, notes, projects, tasks, downloads, windowMaximized: maximized, page: (settings.startPage as PageId) || 'dashboard' })
      window.dh.on('theme:system', (t) => { set({ systemTheme: t as 'dark' | 'light' }); applyTheme(get().settings, t as 'dark' | 'light') })
      window.dh.on('downloads:update', (d) => get().updateDownload(d as DownloadItem))
      window.dh.on('window:state', (s: any) => { if ('maximized' in s) set({ windowMaximized: s.maximized }) })
    } catch {
      // Start with safe defaults even if the main process is unreachable —
      // never hang on the splash screen.
      applyTheme(get().settings, 'dark')
      get().toast('Failed to load data — running with defaults', 'error')
    }
    const s = get().settings
    await new Promise((r) => setTimeout(r, s.animations === 'off' ? 100 : 2200 / s.animationSpeed))
    set({ ready: true })
  },
  navigate: (page, params = {}) => set({ page, pageParams: params, paletteOpen: false }),
  setSettings: async (patch) => {
    const next = await invoke<AppSettings>('settings:set', patch)
    applyTheme(next, get().systemTheme)
    set({ settings: next })
    if ('launchAtStartup' in patch) invoke('app:setLoginItem', !!patch.launchAtStartup).catch(() => {})
  },
  resetSettings: async () => { const next = await invoke<AppSettings>('settings:reset'); applyTheme(next, get().systemTheme); set({ settings: next }) },
  toast: (text, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, type, text }] }))
    setTimeout(() => get().dismissToast(id), 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPalette: (open) => set({ paletteOpen: open }),
  saveNotes: (notes) => { set({ notes }); persist('notes', notes) },
  saveProjects: (projects) => { set({ projects }); persist('projects', projects) },
  saveTasks: (tasks) => { set({ tasks }); persist('tasks', tasks) },
  setDownloads: (downloads) => set({ downloads }),
  updateDownload: (d) => set((s) => {
    const i = s.downloads.findIndex((x) => x.id === d.id)
    if (i === -1) return { downloads: [d, ...s.downloads] }
    const next = [...s.downloads]; next[i] = d; return { downloads: next }
  }),
}))

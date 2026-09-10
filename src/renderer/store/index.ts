import { create } from 'zustand'
import { invoke } from '@/lib/api'
import i18n from '@/i18n'
import { DEFAULT_SETTINGS, type AppSettings, type Note, type Project, type Task, type DownloadItem } from '@shared/types'

export type PageId = 'dashboard' | 'notes' | 'projects' | 'tasks' | 'files' | 'editor' | 'downloads' | 'network' | 'resources' | 'compress' | 'images' | 'video' | 'vault' | 'shortcuts' | 'settings' | 'about'

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
  reloadCollections: () => Promise<void>
  setDownloads: (d: DownloadItem[]) => void
  updateDownload: (d: DownloadItem) => void
  consumeParams: () => Record<string, unknown>
  clearPageParams: () => void
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
    delete timers[key]
    const v = pending[key]
    delete pending[key]
    if (v !== undefined) invoke('data:set', key, v).catch(() => {})
  }, 250)
}
/** Best-effort synchronous flush of debounced writes (page hide / app close). */
function flushPersist() {
  for (const [key, timer] of Object.entries(timers)) {
    clearTimeout(timer)
    delete timers[key]
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

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

let initStarted = false

export const useApp = create<AppState>((set, get) => ({
  ready: false, page: 'dashboard', pageParams: {}, settings: DEFAULT_SETTINGS, systemTheme: 'dark', toasts: [], paletteOpen: false, windowMaximized: false,
  notes: [], projects: [], tasks: [], downloads: [],

  init: async () => {
    if (initStarted) return
    initStarted = true
    try {
      // allSettled: one failing channel (e.g. dl:list) must never wipe the
      // other collections — each falls back to its own safe default, and
      // saves stay disabled until ready (see saveNotes/saveProjects/saveTasks).
      const [rSettings, rSys, rNotes, rProjects, rTasks, rDownloads, rMax] = await Promise.allSettled([
        invoke<AppSettings>('settings:get'), invoke<'dark' | 'light'>('app:systemTheme'),
        invoke<Note[]>('data:get', 'notes', []), invoke<Project[]>('data:get', 'projects', []), invoke<Task[]>('data:get', 'tasks', []),
        invoke<DownloadItem[]>('dl:list'), window.dh.window.isMaximized(),
      ])
      const val = <T,>(r: PromiseSettledResult<T>, fb: T): T => (r.status === 'fulfilled' ? r.value : fb)
      const settings = val(rSettings, get().settings)
      const sys = val(rSys, 'dark' as 'dark' | 'light')
      const notes = val(rNotes, [] as Note[])
      const projects = val(rProjects, [] as Project[])
      const tasks = val(rTasks, [] as Task[])
      const downloads = val(rDownloads, [] as DownloadItem[])
      const maximized = val(rMax, false)
      applyTheme(settings, sys)
      const validPages: PageId[] = ['dashboard', 'notes', 'projects', 'tasks', 'files', 'editor', 'downloads', 'network', 'resources', 'compress', 'images', 'video', 'vault', 'shortcuts', 'settings', 'about']
      const startPage = validPages.includes(settings.startPage as PageId) ? (settings.startPage as PageId) : 'dashboard'
      set({ settings, systemTheme: sys, notes, projects, tasks, downloads, windowMaximized: maximized, page: startPage })
      window.dh.on('theme:system', (t) => { set({ systemTheme: t as 'dark' | 'light' }); applyTheme(get().settings, t as 'dark' | 'light') })
      window.dh.on('downloads:update', (d) => get().updateDownload(d as DownloadItem))
      window.dh.on('window:state', (s: any) => { if (s && 'maximized' in s) set({ windowMaximized: s.maximized }) })
      if ([rSettings, rNotes, rProjects, rTasks].some((r) => r.status === 'rejected')) {
        get().toast(i18n.t('app.loadFailed'), 'error')
      }
    } catch {
      // Start with safe defaults even if the main process is unreachable —
      // never hang on the splash screen.
      applyTheme(get().settings, 'dark')
      get().toast(i18n.t('app.loadFailed'), 'error')
    }
    const s = get().settings
    const speed = Math.min(2, Math.max(0.5, Number(s.animationSpeed) || 1))
    await new Promise((r) => setTimeout(r, s.animations === 'off' ? 100 : Math.min(3000, 2200 / speed)))
    set({ ready: true })
  },
  navigate: (page, params = {}) => set({ page, pageParams: params, paletteOpen: false }),
  consumeParams: () => { const p = get().pageParams; if (Object.keys(p).length) set({ pageParams: {} }); return p },
  clearPageParams: () => { if (Object.keys(get().pageParams).length) set({ pageParams: {} }) },
  setSettings: async (patch) => {
    const next = await invoke<AppSettings>('settings:set', patch)
    applyTheme(next, get().systemTheme)
    set({ settings: next })
    if ('launchAtStartup' in patch) invoke('app:setLoginItem', !!patch.launchAtStartup).catch(() => {})
  },
  resetSettings: async () => { const next = await invoke<AppSettings>('settings:reset'); applyTheme(next, get().systemTheme); set({ settings: next }) },
  toast: (text, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, type, text }] }))
    const timer = setTimeout(() => get().dismissToast(id), 3500)
    toastTimers.set(id, timer)
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id)
    if (timer) { clearTimeout(timer); toastTimers.delete(id) }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  setPalette: (open) => set({ paletteOpen: open }),
  saveNotes: (notes) => { if (!get().ready) return; set({ notes }); persist('notes', notes) },
  saveProjects: (projects) => { if (!get().ready) return; set({ projects }); persist('projects', projects) },
  saveTasks: (tasks) => { if (!get().ready) return; set({ tasks }); persist('tasks', tasks) },
  reloadCollections: async () => {
    const [notes, projects, tasks, downloads] = await Promise.all([
      invoke<Note[]>('data:get', 'notes', []),
      invoke<Project[]>('data:get', 'projects', []),
      invoke<Task[]>('data:get', 'tasks', []),
      invoke<DownloadItem[]>('dl:list'),
    ])
    set({ notes, projects, tasks, downloads })
  },
  setDownloads: (downloads) => set({ downloads }),
  updateDownload: (d) => set((s) => {
    const i = s.downloads.findIndex((x) => x.id === d.id)
    if (i === -1) return { downloads: [d, ...s.downloads] }
    const next = [...s.downloads]; next[i] = d; return { downloads: next }
  }),
}))

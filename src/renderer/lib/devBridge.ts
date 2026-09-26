/**
 * DEV-ONLY in-browser stand-in for the Electron preload bridge (`window.dh`).
 *
 * Loaded from main.tsx exclusively when `import.meta.env.DEV` is true AND the
 * real bridge is missing (i.e. `npm run dev:web` in a normal browser). It keeps
 * data in localStorage so UI work, screenshots and visual QA can happen without
 * Electron. Production bundles never include this module (dead-code eliminated).
 */
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

const LS = 'dh:dev:'
const read = <T,>(k: string, fb: T): T => {
  try { const r = localStorage.getItem(LS + k); return r ? (JSON.parse(r) as T) : fb } catch { return fb }
}
const write = (k: string, v: unknown) => { try { localStorage.setItem(LS + k, JSON.stringify(v)) } catch { /* quota */ } }

const now = Date.now()
const H = 3600_000
function seed() {
  if (localStorage.getItem(LS + 'seeded')) return
  write('seeded', true)
  write('settings', { ...DEFAULT_SETTINGS, language: 'en' })
  write('notes', [
    { id: 'n1', title: 'Launch checklist', content: '# Launch\n\n- [x] Design tokens\n- [ ] Motion pass\n- [ ] Release notes\n\n> Ship small, ship often.', tags: ['release', 'work'], color: '#8b5cf6', pinned: true, archived: false, favorite: true, createdAt: now - 72 * H, updatedAt: now - 2 * H },
    { id: 'n2', title: 'Reading list', content: 'Refactoring UI\nThe Design of Everyday Things\nAbout Face', tags: ['personal'], color: '#10b981', pinned: false, archived: false, favorite: false, createdAt: now - 200 * H, updatedAt: now - 30 * H },
    { id: 'n3', title: 'Meeting notes — sync', content: 'Discussed **roadmap** and the new command palette.', tags: ['work'], color: '#3b82f6', pinned: false, archived: false, favorite: false, createdAt: now - 20 * H, updatedAt: now - 5 * H },
  ])
  write('projects', [
    { id: 'p1', name: 'DragonHub 2.0', description: 'Premium redesign', status: 'active', priority: 5, tags: ['design'], color: '#8b5cf6', links: [], milestones: [{ id: 'm1', title: 'Design system', done: true }, { id: 'm2', title: 'Palette v2', done: false }], notes: '', progress: 55, createdAt: now - 400 * H, updatedAt: now - 3 * H },
    { id: 'p2', name: 'Portfolio site', description: '', status: 'planning', priority: 3, tags: [], color: '#f59e0b', links: [], milestones: [], notes: '', progress: 15, createdAt: now - 100 * H, updatedAt: now - 50 * H },
  ])
  write('tasks', [
    { id: 't1', title: 'Polish command palette', description: '', status: 'in_progress', priority: 'high', tags: ['ui'], projectId: 'p1', dueDate: now + 5 * H, subtasks: [{ id: 's1', title: 'Fuzzy search', done: true }, { id: 's2', title: 'Recents', done: false }], createdAt: now - 10 * H, updatedAt: now - H, order: 1 },
    { id: 't2', title: 'Write release notes', description: '', status: 'todo', priority: 'medium', tags: [], projectId: 'p1', dueDate: now + 30 * H, subtasks: [], createdAt: now - 8 * H, updatedAt: now - 8 * H, order: 2 },
    { id: 't3', title: 'Renew domain', description: '', status: 'todo', priority: 'urgent', tags: ['admin'], dueDate: now - 4 * H, subtasks: [], createdAt: now - 50 * H, updatedAt: now - 50 * H, order: 3 },
    { id: 't4', title: 'Review accessibility audit', description: '', status: 'review', priority: 'low', tags: [], subtasks: [], createdAt: now - 60 * H, updatedAt: now - 20 * H, order: 4 },
    { id: 't5', title: 'Set up CI cache', description: '', status: 'done', priority: 'medium', tags: [], subtasks: [], createdAt: now - 90 * H, updatedAt: now - 26 * H, completedAt: now - 26 * H, order: 5 },
  ])
}

type Handler = (...args: any[]) => unknown
const handlers: Record<string, Handler> = {
  'settings:get': () => ({ ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>('settings', {}) }),
  'settings:set': (patch: Partial<AppSettings>) => { const next = { ...DEFAULT_SETTINGS, ...read('settings', {}), ...patch }; write('settings', next); return next },
  'settings:reset': () => { write('settings', DEFAULT_SETTINGS); return DEFAULT_SETTINGS },
  'data:get': (k: string, fb: unknown) => read(k, fb),
  'data:set': (k: string, v: unknown) => { write(k, v); return true },
  'app:systemTheme': () => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  'app:system': () => ({ cpus: 8, cpuModel: 'Dev CPU @ 3.2GHz', totalMem: 16 * 2 ** 30, freeMem: 7 * 2 ** 30, uptime: 51234, platform: 'browser', release: 'dev', arch: 'x64' }),
  'app:version': () => 'dev',
  'dl:list': () => [],
  'vault:isUnlocked': () => false,
  'vault:meta': () => ({ initialized: false }),
  'dialog:confirm': (msg: string) => window.confirm(msg),
  'fs:special': () => ({ home: '/home/dev', desktop: '/home/dev/Desktop', documents: '/home/dev/Documents', downloads: '/home/dev/Downloads', pictures: '/home/dev/Pictures', videos: '/home/dev/Videos', music: '/home/dev/Music' }),
  'fs:list': () => [],
  'fs:drives': () => [],
  'clipboard:write': (s: string) => navigator.clipboard?.writeText(s).catch(() => {}),
}

export function installDevBridge() {
  if ((window as any).dh) return
  seed()
  const invoke = async (channel: string, ...args: unknown[]) => {
    const h = handlers[channel]
    if (h) return h(...args)
    // Unknown channels resolve to null so pages render their empty states.
    return null
  }
  ;(window as any).dh = {
    invoke,
    on: () => () => {},
    platform: 'web',
    toFileUrl: (p: string) => p,
    window: { minimize: invoke, maximize: invoke, close: invoke, fullscreen: invoke, isMaximized: async () => false, show: invoke, quit: invoke },
  }
}

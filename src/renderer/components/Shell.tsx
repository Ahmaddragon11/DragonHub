import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import {
  LayoutDashboard, StickyNote, Lightbulb, CheckSquare, FolderOpen, Code2, Download, Archive, Image, Clapperboard, ShieldCheck,
  Keyboard, Settings, Info, Minus, Square, X, Copy, Search, ChevronsLeft, ChevronsRight, ChevronDown, Sun, Moon, Languages, Send, Wifi, Gauge,
  ArrowLeft, ArrowRight, Menu, CornerDownLeft, History, PanelLeft, Monitor, CircleHelp, FileText,
} from 'lucide-react'
import { useApp, type PageId, type RecentKind } from '@/store'
import { cn, relTime } from '@/lib/utils'
import { invoke } from '@/lib/api'
import { fuzzyMatch, highlightParts } from '@/lib/fuzzy'
import { spring, useMotionPrefs, dialogVariants } from '@/lib/motion'
import { Kbd, Tooltip, useFocusTrap } from '@/components/ui'
import { APP_VERSION, DEVELOPER } from '@shared/types'

export type NavGroup = 'main' | 'productivity' | 'files' | 'media' | 'security' | 'system'

export const NAV: { id: PageId; icon: React.ReactNode; group: NavGroup }[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={18} />, group: 'main' },
  { id: 'notes', icon: <StickyNote size={18} />, group: 'productivity' },
  { id: 'projects', icon: <Lightbulb size={18} />, group: 'productivity' },
  { id: 'tasks', icon: <CheckSquare size={18} />, group: 'productivity' },
  { id: 'files', icon: <FolderOpen size={18} />, group: 'files' },
  { id: 'editor', icon: <Code2 size={18} />, group: 'files' },
  { id: 'downloads', icon: <Download size={18} />, group: 'files' },
  { id: 'network', icon: <Wifi size={18} />, group: 'files' },
  { id: 'resources', icon: <Gauge size={18} />, group: 'files' },
  { id: 'compress', icon: <Archive size={18} />, group: 'files' },
  { id: 'images', icon: <Image size={18} />, group: 'media' },
  { id: 'video', icon: <Clapperboard size={18} />, group: 'media' },
  { id: 'vault', icon: <ShieldCheck size={18} />, group: 'security' },
  { id: 'shortcuts', icon: <Keyboard size={18} />, group: 'system' },
  { id: 'settings', icon: <Settings size={18} />, group: 'system' },
  { id: 'about', icon: <Info size={18} />, group: 'system' },
]

const GROUP_ORDER: NavGroup[] = ['main', 'productivity', 'files', 'media', 'security', 'system']
const EXPANDED_W = 228
const COLLAPSED_W = 64
/** Below this width the sidebar auto-collapses to icons; below MOBILE it becomes a drawer. */
const NARROW = 1120
const MOBILE = 768

const cycleThemeValue = (t: string) => (t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark') as 'dark' | 'light' | 'system'

/** Viewport width bucket, updated on resize (rAF-throttled, no re-render unless bucket changes). */
export function useViewport() {
  const get = () => (typeof window === 'undefined' ? 'wide' : window.innerWidth < MOBILE ? 'mobile' : window.innerWidth < NARROW ? 'narrow' : 'wide')
  const [vp, setVp] = useState<'mobile' | 'narrow' | 'wide'>(get)
  useEffect(() => {
    let raf = 0
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setVp(get())) }
    window.addEventListener('resize', on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on) }
  }, [])
  return vp
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <img src="./icon.png" width={size} height={size} alt="DragonHub" draggable={false}
      style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.24)), objectFit: 'cover' }} />
  )
}

/* =================================================================== TitleBar */
export function TitleBar({ onMenu }: { onMenu?: () => void }) {
  const { windowMaximized, setPalette, goBack, goForward, canBack, canFwd, page } = useApp(useShallow((s) => ({
    windowMaximized: s.windowMaximized, setPalette: s.setPalette, goBack: s.goBack, goForward: s.goForward,
    canBack: s.backStack.length > 0, canFwd: s.fwdStack.length > 0, page: s.page,
  })))
  const { t } = useTranslation()
  const rtl = useApp((s) => s.settings.language === 'ar')
  const BackIcon = rtl ? ArrowRight : ArrowLeft
  const FwdIcon = rtl ? ArrowLeft : ArrowRight
  return (
    <div className="drag flex items-center h-11 ps-2 gap-2 select-none shrink-0 relative z-20">
      <div className="no-drag flex items-center gap-0.5">
        {onMenu && <button className="btn-icon" aria-label={t('side.menu')} onClick={onMenu}><Menu size={17} /></button>}
        <Tooltip label={t('common.back')} shortcut="Alt+←"><button className="btn-icon p-1.5" aria-label={t('common.back')} disabled={!canBack} onClick={goBack}><BackIcon size={15} /></button></Tooltip>
        <Tooltip label={t('common.forward')} shortcut="Alt+→"><button className="btn-icon p-1.5" aria-label={t('common.forward')} disabled={!canFwd} onClick={goForward}><FwdIcon size={15} /></button></Tooltip>
      </div>
      <span className="hidden sm:block text-[13px] font-medium text-surface-600 truncate min-w-0 max-w-[180px]">{t(`nav.${page}`)}</span>
      <button className="no-drag group mx-auto flex items-center gap-2 rounded-[10px] bg-surface-200/70 hover:bg-surface-200 ring-1 ring-inset ring-[color:var(--hairline)] ps-3 pe-1.5 h-7 text-xs text-surface-500 transition-colors flex-1 min-w-0 max-w-[440px]"
        onClick={() => setPalette(true)} aria-label={t('palette.placeholder')} aria-keyshortcuts="Control+K">
        <Search size={13} className="shrink-0 group-hover:text-surface-700 transition-colors" /><span className="flex-1 text-start truncate">{t('palette.placeholder')}</span><Kbd keys={['Ctrl', 'K']} className="hidden sm:inline-flex" />
      </button>
      <div className="no-drag flex items-center self-stretch">
        <button className="btn-icon rounded-none h-full w-11 hover:bg-surface-200" aria-label="Minimize" onClick={() => window.dh.window.minimize()}><Minus size={15} /></button>
        <button className="btn-icon rounded-none h-full w-11 hover:bg-surface-200" aria-label="Maximize" onClick={() => window.dh.window.maximize()}>{windowMaximized ? <Copy size={12} className="rotate-180" /> : <Square size={12} />}</button>
        <button className="btn-icon rounded-none h-full w-11 hover:!bg-rose-500 hover:!text-white" aria-label={t('common.close')} onClick={() => window.dh.window.close()}><X size={16} /></button>
      </div>
    </div>
  )
}

/* ==================================================================== Sidebar */
export function Sidebar({ viewport, drawerOpen, onCloseDrawer }: { viewport: 'mobile' | 'narrow' | 'wide'; drawerOpen: boolean; onCloseDrawer: () => void }) {
  const { page, navigate, setSettings, userCollapsed, theme, language, systemTheme, openTasks, activeDl } = useApp(useShallow((s) => ({
    page: s.page, navigate: s.navigate, setSettings: s.setSettings, userCollapsed: s.settings.sidebarCollapsed,
    theme: s.settings.theme, language: s.settings.language, systemTheme: s.systemTheme,
    openTasks: s.tasks.reduce((n, x) => n + (x.status !== 'done' ? 1 : 0), 0),
    activeDl: s.downloads.reduce((n, d) => n + (d.status === 'downloading' || d.status === 'queued' ? 1 : 0), 0),
  })))
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const mobile = viewport === 'mobile'
  const collapsed = mobile ? false : userCollapsed || viewport === 'narrow'
  const isRtl = language === 'ar'
  const darkNow = theme === 'dark' || (theme === 'system' && systemTheme === 'dark')
  const badgeOf = (id: PageId): number => (id === 'tasks' ? openTasks : id === 'downloads' ? activeDl : 0)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try { const raw = localStorage.getItem('dh:sidebarGroups'); return raw ? (JSON.parse(raw) as Record<string, boolean>) : {} } catch { return {} }
  })
  useEffect(() => { try { localStorage.setItem('dh:sidebarGroups', JSON.stringify(collapsedGroups)) } catch { /* ignore */ } }, [collapsedGroups])
  const toggleGroup = (g: NavGroup) => setCollapsedGroups((p) => ({ ...p, [g]: !p[g] }))
  const go = (id: PageId) => { navigate(id); if (mobile) onCloseDrawer() }
  const CollapseIcon = collapsed ? (isRtl ? ChevronsLeft : ChevronsRight) : (isRtl ? ChevronsRight : ChevronsLeft)
  const ThemeIcon = theme === 'system' ? Monitor : darkNow ? Sun : Moon

  const body = (
    <aside aria-label={t('side.menu')}
      style={{ width: collapsed ? COLLAPSED_W : EXPANDED_W }}
      className={cn('flex flex-col overflow-hidden shrink-0 relative z-10 transition-[width] duration-200 ease-out',
        mobile ? 'h-full surface-raised rounded-none rounded-e-2xl' : 'glass rounded-2xl m-2 mt-0 me-0')}>
      <div className={cn('flex items-center gap-2 px-3 pt-3 pb-2 shrink-0', collapsed && 'justify-center px-0')}>
        <Logo size={24} />
        {!collapsed && <span className="text-sm font-semibold tracking-tight gradient-text truncate flex-1">DragonHub</span>}
        {mobile && <button className="btn-icon" aria-label={t('common.close')} onClick={onCloseDrawer}><X size={16} /></button>}
      </div>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 min-h-0">
        {GROUP_ORDER.map((g, gi) => {
          const items = NAV.filter((n) => n.group === g)
          const groupCollapsed = !collapsed && !!collapsedGroups[g] && !items.some((n) => n.id === page)
          return (
            <div key={g} className={cn(gi > 0 && 'mt-2')}>
              {collapsed ? (gi > 0 && <div className="divider my-2 mx-auto w-6" />) : g !== 'main' && (
                <button type="button" onClick={() => toggleGroup(g)} aria-expanded={!groupCollapsed}
                  className="group w-full flex items-center justify-between px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-surface-500 hover:text-surface-700 rounded-md">
                  <span className="truncate">{t(`side.${g}`)}</span>
                  <ChevronDown size={12} className={cn('shrink-0 opacity-0 group-hover:opacity-70 transition-[transform,opacity] duration-200', groupCollapsed && '-rotate-90 rtl:rotate-90 opacity-70')} />
                </button>
              )}
              <AnimatePresence initial={false}>
                {!groupCollapsed && (
                  <motion.div key="items" initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduced ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="space-y-px overflow-hidden">
                    {items.map((n) => {
                      const active = page === n.id
                      const badge = badgeOf(n.id)
                      const btn = (
                        <button key={n.id} onClick={() => go(n.id)} aria-current={active ? 'page' : undefined} aria-label={collapsed ? t(`nav.${n.id}`) : undefined}
                          className={cn('relative w-full flex items-center gap-2.5 rounded-[10px] h-9 text-[13px] group transition-colors duration-150',
                            collapsed ? 'justify-center px-0' : 'px-2.5',
                            active ? 'text-surface-950 font-medium' : 'text-surface-600 hover:text-surface-900 hover:bg-surface-200/70')}>
                          {active && (
                            <motion.span layoutId={reduced ? undefined : 'nav-pill'} transition={spring.snappy}
                              className="absolute inset-0 rounded-[10px] bg-surface-100 dark:bg-surface-300/70 shadow-e1 ring-1 ring-inset ring-[color:var(--hairline)]">
                              <span className="absolute start-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />
                            </motion.span>
                          )}
                          <span className={cn('relative z-10 shrink-0 transition-colors', active ? 'text-accent' : 'text-surface-500 group-hover:text-surface-800')}>{n.icon}</span>
                          {!collapsed && <span className="relative z-10 truncate flex-1 text-start">{t(`nav.${n.id}`)}</span>}
                          {badge > 0 && (collapsed
                            ? <span className="absolute top-1 end-1.5 z-10 h-2 w-2 rounded-full bg-accent ring-2 ring-surface-100" aria-label={String(badge)} />
                            : <motion.span key={badge} initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy}
                                className="relative z-10 text-[10.5px] tabular-nums font-semibold rounded-md px-1.5 min-w-[20px] h-5 grid place-items-center bg-surface-200 text-surface-600 dark:bg-surface-400/40">{badge > 99 ? '99+' : badge}</motion.span>)}
                        </button>
                      )
                      return collapsed ? <Tooltip key={n.id} label={t(`nav.${n.id}`)} side={isRtl ? 'left' : 'right'}>{btn}</Tooltip> : btn
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </nav>
      <footer className={cn('p-2 border-t border-[color:var(--hairline)] shrink-0 flex items-center gap-0.5', collapsed && 'flex-col')}>
        <Tooltip label={`${t('palette.theme')} · ${t(`settings.${theme}`)}`} shortcut="Ctrl+Shift+D" side={collapsed ? (isRtl ? 'left' : 'right') : 'top'}>
          <button className="btn-icon" aria-label={t('palette.theme')} onClick={() => setSettings({ theme: cycleThemeValue(theme) })}><ThemeIcon size={16} /></button>
        </Tooltip>
        <Tooltip label={t('palette.lang')} shortcut="Ctrl+Shift+L" side={collapsed ? (isRtl ? 'left' : 'right') : 'top'}>
          <button className="btn-icon" aria-label={t('palette.lang')} onClick={() => setSettings({ language: language === 'ar' ? 'en' : 'ar' })}><Languages size={16} /></button>
        </Tooltip>
        <Tooltip label={t('about.contact')} side={collapsed ? (isRtl ? 'left' : 'right') : 'top'}>
          <button className="btn-icon hover:!text-sky-500" aria-label={t('about.contact')} onClick={() => invoke('app:openTelegram')}><Send size={15} /></button>
        </Tooltip>
        {!mobile && (
          <Tooltip label={collapsed ? t('side.expand') : t('side.collapse')} shortcut="Ctrl+B" side={collapsed ? (isRtl ? 'left' : 'right') : 'top'}>
            <button className={cn('btn-icon', !collapsed && 'ms-auto')} aria-label={collapsed ? t('side.expand') : t('side.collapse')} aria-expanded={!collapsed}
              disabled={viewport === 'narrow'} onClick={() => setSettings({ sidebarCollapsed: !userCollapsed })}><CollapseIcon size={16} /></button>
          </Tooltip>
        )}
      </footer>
    </aside>
  )

  if (!mobile) return body
  return (
    <AnimatePresence>
      {drawerOpen && (
        <motion.div className="fixed inset-0 z-[80] flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onCloseDrawer} aria-hidden />
          <motion.div className="relative h-full" initial={{ x: isRtl ? 240 : -240 }} animate={{ x: 0 }} exit={{ x: isRtl ? 240 : -240 }} transition={spring.soft}>{body}</motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ===================================================================== Splash */
export function Splash() {
  const { t } = useTranslation()
  return (
    <motion.div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-surface-50 overflow-hidden" exit={{ opacity: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}>
      <div className="aurora" />
      <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} className="relative">
        <span className="splash-ring absolute inset-0 rounded-[1.6rem] border border-accent/40" />
        <div className="relative p-4 rounded-[1.6rem] surface-raised"><Logo size={60} /></div>
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="mt-6 text-2xl font-semibold tracking-tight">DragonHub</motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.22, duration: 0.4 }} className="mt-1 text-surface-500 text-[13px]">{t('app.tagline')}</motion.p>
      <div className="mt-6 h-[3px] w-40 rounded-full bg-surface-200 overflow-hidden">
        <motion.div className="h-full w-1/3 rounded-full bg-accent" initial={{ x: '-100%' }} animate={{ x: '300%' }} transition={{ repeat: Infinity, duration: 1.1, ease: [0.65, 0, 0.35, 1] }} />
      </div>
      <p className="absolute bottom-6 text-[11px] text-surface-500">{t('app.by')} {DEVELOPER} · v{APP_VERSION}</p>
    </motion.div>
  )
}

/* ============================================================ Command palette */
interface Cmd {
  id: string
  label: string
  sub?: string
  icon: React.ReactNode
  group: string
  keywords?: string
  shortcut?: string
  run: () => void
  score?: number
  hits?: number[]
}

const KIND_ICON: Record<RecentKind, React.ReactNode> = { note: <FileText size={16} />, task: <CheckSquare size={16} />, project: <Lightbulb size={16} /> }
const KIND_PAGE: Record<RecentKind, PageId> = { note: 'notes', task: 'tasks', project: 'projects' }

export function CommandPalette() {
  const s = useApp(useShallow((st) => ({
    open: st.paletteOpen, setPalette: st.setPalette, navigate: st.navigate, setSettings: st.setSettings, setShortcuts: st.setShortcuts,
    theme: st.settings.theme, language: st.settings.language, sidebarCollapsed: st.settings.sidebarCollapsed,
    notes: st.notes, tasks: st.tasks, projects: st.projects, recents: st.recents, touchRecent: st.touchRecent, goBack: st.goBack,
  })))
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const dq = React.useDeferredValue(q)
  const listRef = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  useFocusTrap(surface, s.open)

  const openEntity = (kind: RecentKind, id: string) => { s.touchRecent(kind, id); s.navigate(KIND_PAGE[kind], { open: id }) }

  const baseCmds = useMemo<Cmd[]>(() => {
    const nav = t('palette.navigate'), act = t('palette.actions')
    return [
      ...NAV.map((n, i) => ({ id: `nav:${n.id}`, label: t(`nav.${n.id}`), icon: n.icon, group: nav, keywords: n.id, shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined, run: () => s.navigate(n.id) })),
      { id: 'new-note', label: t('dashboard.newNote'), icon: <StickyNote size={16} />, group: act, keywords: 'create add note', shortcut: 'Ctrl+N', run: () => s.navigate('notes', { create: true }) },
      { id: 'new-task', label: t('dashboard.newTask'), icon: <CheckSquare size={16} />, group: act, keywords: 'create add todo task', run: () => s.navigate('tasks', { create: true }) },
      { id: 'new-project', label: t('dashboard.newProject'), icon: <Lightbulb size={16} />, group: act, keywords: 'create add idea project', run: () => s.navigate('projects', { create: true }) },
      { id: 'new-download', label: t('dashboard.newDownload'), icon: <Download size={16} />, group: act, keywords: 'url youtube download', run: () => s.navigate('downloads', { focus: true }) },
      { id: 'open-vault', label: t('dashboard.openVault'), icon: <ShieldCheck size={16} />, group: act, keywords: 'password secret', run: () => s.navigate('vault') },
      { id: 'theme', label: t('palette.theme'), sub: t(`settings.${cycleThemeValue(s.theme)}`), icon: <Sun size={16} />, group: act, keywords: 'dark light mode appearance', shortcut: 'Ctrl+Shift+D', run: () => s.setSettings({ theme: cycleThemeValue(s.theme) }) },
      { id: 'lang', label: t('palette.lang'), sub: s.language === 'ar' ? 'English' : 'العربية', icon: <Languages size={16} />, group: act, keywords: 'language arabic english', shortcut: 'Ctrl+Shift+L', run: () => s.setSettings({ language: s.language === 'ar' ? 'en' : 'ar' }) },
      { id: 'sidebar', label: t('palette.toggleSidebar'), icon: <PanelLeft size={16} />, group: act, keywords: 'sidebar collapse expand', shortcut: 'Ctrl+B', run: () => s.setSettings({ sidebarCollapsed: !s.sidebarCollapsed }) },
      { id: 'shortcuts', label: t('palette.showShortcuts'), icon: <CircleHelp size={16} />, group: act, keywords: 'keyboard help keys', shortcut: '?', run: () => s.setShortcuts(true) },
      { id: 'back', label: t('common.back'), icon: <ArrowLeft size={16} />, group: act, keywords: 'previous history', shortcut: 'Alt+←', run: () => s.goBack() },
      { id: 'tg', label: 'Telegram @ahmaddragon', icon: <Send size={16} />, group: act, keywords: 'contact support', run: () => invoke('app:openTelegram') },
    ]
  }, [t, s.theme, s.language, s.sidebarCollapsed, s.navigate, s.setSettings, s.setShortcuts, s.goBack])

  const results = useMemo<{ group: string; items: Cmd[] }[]>(() => {
    const query = dq.trim()
    if (!query) {
      const recentItems: Cmd[] = []
      for (const r of s.recents) {
        const ent = r.kind === 'note' ? s.notes.find((n) => n.id === r.id) : r.kind === 'task' ? s.tasks.find((x) => x.id === r.id) : s.projects.find((p) => p.id === r.id)
        if (!ent) continue
        const label = ('title' in ent ? ent.title : (ent as any).name) || t('common.untitled')
        recentItems.push({ id: `recent:${r.kind}:${r.id}`, label, sub: `${t(`palette.kind.${r.kind}`)} · ${relTime(r.at, s.language)}`, icon: KIND_ICON[r.kind], group: t('palette.recent'), run: () => openEntity(r.kind, r.id) })
        if (recentItems.length >= 5) break
      }
      const act = baseCmds.filter((c) => ['new-note', 'new-task', 'new-project', 'theme', 'shortcuts'].includes(c.id))
      const out = [] as { group: string; items: Cmd[] }[]
      if (recentItems.length) out.push({ group: t('palette.recent'), items: recentItems })
      out.push({ group: t('palette.actions'), items: act })
      out.push({ group: t('palette.navigate'), items: baseCmds.filter((c) => c.id.startsWith('nav:')) })
      return out
    }
    const score = (c: Cmd) => {
      const a = fuzzyMatch(query, c.label)
      const b = c.keywords ? fuzzyMatch(query, c.keywords) : null
      if (!a && !b) return null
      return { ...c, score: Math.max(a?.score ?? -Infinity, (b?.score ?? -Infinity) - 50), hits: a?.indices ?? [] }
    }
    const take = (arr: (Cmd | null)[], n: number) => (arr.filter(Boolean) as Cmd[]).sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, n)
    const cmds = take(baseCmds.map(score), 8)
    const ql = query.toLowerCase()
    const entity = <T,>(list: T[], kind: RecentKind, title: (x: T) => string, body: (x: T) => string, id: (x: T) => string, sub: (x: T) => string) =>
      take(list.map((x) => {
        const ti = title(x) || t('common.untitled')
        const m = fuzzyMatch(query, ti)
        const inBody = !m && body(x).toLowerCase().includes(ql)
        if (!m && !inBody) return null
        return { id: `${kind}:${id(x)}`, label: ti, sub: sub(x), icon: KIND_ICON[kind], group: t(`palette.kind.${kind}s`), score: m ? m.score : 5, hits: m?.indices ?? [], run: () => openEntity(kind, id(x)) } as Cmd
      }), 5)
    const notes = entity(s.notes.filter((n) => !n.archived), 'note', (n) => n.title, (n) => n.content + ' ' + n.tags.join(' '), (n) => n.id, (n) => relTime(n.updatedAt, s.language))
    const tasks = entity(s.tasks, 'task', (k) => k.title, (k) => k.description + ' ' + k.tags.join(' '), (k) => k.id, (k) => t(`tasks.status.${k.status}`))
    const projects = entity(s.projects, 'project', (p) => p.name, (p) => p.description, (p) => p.id, (p) => t(`projects.status.${p.status}`))
    // Groups are ordered by their best hit, so the strongest match is always first.
    const best = (g: Cmd[]) => g[0]?.score ?? -Infinity
    return [
      { group: t('palette.commands'), items: cmds },
      { group: t('palette.kind.notes'), items: notes },
      { group: t('palette.kind.tasks'), items: tasks },
      { group: t('palette.kind.projects'), items: projects },
    ].filter((g) => g.items.length).sort((a, b) => best(b.items) - best(a.items))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, baseCmds, s.notes, s.tasks, s.projects, s.recents, s.language, t])

  const flat = useMemo(() => results.flatMap((g) => g.items), [results])
  useEffect(() => { setIdx(0) }, [dq, s.open])
  useEffect(() => { if (!s.open) setQ('') }, [s.open])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])
  const run = (c?: Cmd) => { if (!c) return; s.setPalette(false); c.run() }

  let counter = -1
  return (
    <AnimatePresence>
      {s.open && (
        <motion.div className="fixed inset-0 z-[120] flex items-start justify-center px-3 pb-4 pt-[9vh] sm:pt-[13vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.14 }}
          onMouseDown={(e) => e.target === e.currentTarget && s.setPalette(false)}>
          <div aria-hidden className="fixed inset-0 -z-10 bg-black/40 backdrop-blur-[2px]" />
          <motion.div ref={surface} variants={dialogVariants(reduced)} initial="initial" animate="enter" exit="exit"
            role="dialog" aria-modal="true" aria-label={t('palette.placeholder')}
            className="surface-raised w-full max-w-[620px] overflow-hidden flex flex-col max-h-[min(72vh,560px)]">
            <div className="flex items-center gap-3 px-4 h-[52px] border-b border-[color:var(--hairline)] shrink-0">
              <Search size={17} className="text-surface-500 shrink-0" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('palette.placeholder')} className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-surface-500"
                role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={flat[idx] ? `pal-${idx}` : undefined} aria-autocomplete="list"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % Math.max(1, flat.length)) }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + flat.length) % Math.max(1, flat.length)) }
                  else if (e.key === 'Enter') { e.preventDefault(); run(flat[idx]) }
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (q) setQ(''); else s.setPalette(false) }
                }} />
              {q && <button className="btn-icon p-1" aria-label={t('common.clear')} onClick={() => setQ('')}><X size={14} /></button>}
            </div>
            <div ref={listRef} id="palette-list" role="listbox" className="overflow-y-auto min-h-0 p-1.5 flex-1">
              {flat.length === 0 && (
                <div className="py-10 text-center">
                  <Search size={22} className="mx-auto text-surface-400" />
                  <p className="text-sm text-surface-600 mt-2">{t('palette.noMatch')}</p>
                  <p className="text-xs text-surface-500 mt-0.5">“{q}”</p>
                </div>
              )}
              {results.map((g) => (
                <div key={g.group} role="group" aria-label={g.group} className="mb-1">
                  <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-surface-500 flex items-center gap-1.5">
                    {g.group === t('palette.recent') && <History size={11} />}{g.group}
                  </div>
                  {g.items.map((c) => {
                    counter++
                    const i = counter
                    const active = i === idx
                    return (
                      <div key={c.id} id={`pal-${i}`} data-idx={i} role="option" aria-selected={active}
                        onMouseMove={() => { if (idx !== i) setIdx(i) }} onClick={() => run(c)}
                        className={cn('relative flex items-center gap-3 px-2.5 h-10 rounded-lg text-[13.5px] cursor-pointer', active ? 'text-surface-950' : 'text-surface-700')}>
                        {active && <motion.span layoutId={reduced ? undefined : 'pal-hl'} transition={{ type: 'spring', stiffness: 700, damping: 45 }} className="absolute inset-0 rounded-lg bg-surface-200" />}
                        <span className={cn('relative shrink-0', active ? 'text-accent' : 'text-surface-500')}>{c.icon}</span>
                        <span className="relative flex-1 min-w-0 truncate">
                          {highlightParts(c.label, c.hits ?? []).map((p, j) => p.hit ? <mark key={j} className="bg-transparent text-accent font-semibold">{p.s}</mark> : <React.Fragment key={j}>{p.s}</React.Fragment>)}
                          {c.sub && <span className="ms-2 text-xs text-surface-500">{c.sub}</span>}
                        </span>
                        {c.shortcut && <Kbd keys={c.shortcut} className="relative shrink-0 opacity-80" />}
                        {active && !c.shortcut && <CornerDownLeft size={14} className="relative text-surface-500 shrink-0" />}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 px-4 h-9 border-t border-[color:var(--hairline)] text-[11px] text-surface-500 shrink-0 bg-surface-200/30">
              <span className="flex items-center gap-1.5"><Kbd keys="↑" /><Kbd keys="↓" />{t('palette.hintNav')}</span>
              <span className="flex items-center gap-1.5"><Kbd keys="↵" />{t('palette.hintRun')}</span>
              <span className="flex items-center gap-1.5"><Kbd keys="Esc" />{t('common.close')}</span>
              <span className="ms-auto hidden sm:block">{t('palette.hintSearch')}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* =========================================================== Shortcuts overlay */
export const APP_SHORTCUTS: { group: string; items: { keys: string; label: string }[] }[] = [
  { group: 'shortcutsOverlay.general', items: [
    { keys: 'Ctrl+K', label: 'shortcutsOverlay.palette' },
    { keys: '?', label: 'shortcutsOverlay.help' },
    { keys: 'Ctrl+,', label: 'shortcutsOverlay.settings' },
    { keys: 'Ctrl+Shift+D', label: 'palette.theme' },
    { keys: 'Ctrl+Shift+L', label: 'palette.lang' },
    { keys: 'F11', label: 'shortcutsOverlay.fullscreen' },
  ] },
  { group: 'shortcutsOverlay.navigation', items: [
    { keys: 'Ctrl+1…9', label: 'shortcutsOverlay.jump' },
    { keys: 'Alt+←', label: 'common.back' },
    { keys: 'Alt+→', label: 'common.forward' },
    { keys: 'Ctrl+B', label: 'palette.toggleSidebar' },
  ] },
  { group: 'shortcutsOverlay.create', items: [
    { keys: 'Ctrl+N', label: 'shortcutsOverlay.newHere' },
    { keys: '/', label: 'shortcutsOverlay.focusSearch' },
    { keys: 'Esc', label: 'shortcutsOverlay.dismiss' },
  ] },
  { group: 'shortcutsOverlay.editor', items: [
    { keys: 'Ctrl+S', label: 'editor.save' },
    { keys: 'Ctrl+F', label: 'editor.find' },
    { keys: 'Ctrl+W', label: 'shortcutsOverlay.closeTab' },
  ] },
]

export function ShortcutsOverlay() {
  const { open, setShortcuts, navigate } = useApp(useShallow((s) => ({ open: s.shortcutsOpen, setShortcuts: s.setShortcuts, navigate: s.navigate })))
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const surface = useRef<HTMLDivElement>(null)
  useFocusTrap(surface, open)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setShortcuts(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, setShortcuts])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[120] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}
          onMouseDown={(e) => e.target === e.currentTarget && setShortcuts(false)}>
          <div aria-hidden className="fixed inset-0 -z-10 bg-black/40 backdrop-blur-[2px]" />
          <motion.div ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('shortcutsOverlay.title')} variants={dialogVariants(reduced)} initial="initial" animate="enter" exit="exit"
            className="surface-raised w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col outline-none">
            <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--hairline)]">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center h-9 w-9 rounded-xl bg-accent/12 text-accent"><Keyboard size={18} /></span>
                <div><h3 className="text-[15px] font-semibold tracking-tight">{t('shortcutsOverlay.title')}</h3><p className="text-xs text-surface-500">{t('shortcutsOverlay.subtitle')}</p></div>
              </div>
              <button className="btn-icon" aria-label={t('common.close')} onClick={() => setShortcuts(false)}><X size={17} /></button>
            </header>
            <div className="p-5 grid sm:grid-cols-2 gap-x-8 gap-y-5 overflow-y-auto">
              {APP_SHORTCUTS.map((g) => (
                <section key={g.group}>
                  <h4 className="label mb-2">{t(g.group)}</h4>
                  <ul className="space-y-0.5">
                    {g.items.map((it) => (
                      <li key={it.keys} className="flex items-center justify-between gap-3 py-1.5 text-[13px] border-b border-[color:var(--hairline)] last:border-0">
                        <span className="text-surface-700">{t(it.label)}</span><Kbd keys={it.keys === 'Ctrl+1…9' ? ['Ctrl', '1…9'] : it.keys} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="px-5 py-3 border-t border-[color:var(--hairline)] flex justify-between items-center text-xs text-surface-500 bg-surface-200/30">
              <span>{t('shortcutsOverlay.more')}</span>
              <button className="btn-sm btn-soft" onClick={() => { setShortcuts(false); navigate('shortcuts') }}>{t('nav.shortcuts')}</button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ============================================================ Global shortcuts */
export function useGlobalShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const st = useApp.getState()
      // Never hijack keystrokes while the user is typing (inputs, textareas,
      // selects, contentEditable, Monaco) — except the palette toggle itself.
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('.monaco-editor'))
      const c = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (c && key === 'k') { e.preventDefault(); st.setPalette(!st.paletteOpen); return }
      if (e.key === 'Escape') { if (st.paletteOpen) st.setPalette(false); if (st.shortcutsOpen) st.setShortcuts(false); return }
      if (e.altKey && !c && e.key === 'ArrowLeft') { e.preventDefault(); (document.dir === 'rtl' ? st.goForward : st.goBack)(); return }
      if (e.altKey && !c && e.key === 'ArrowRight') { e.preventDefault(); (document.dir === 'rtl' ? st.goBack : st.goForward)(); return }
      if (c && e.key === '/') { e.preventDefault(); st.setShortcuts(!st.shortcutsOpen); return }
      if (typing) return
      if (!c && !e.altKey && e.key === '?') { e.preventDefault(); st.setShortcuts(!st.shortcutsOpen); return }
      // "/" focuses the page's primary search field (first [data-search] or search input).
      if (!c && !e.altKey && e.key === '/') {
        const main = document.querySelector('main')
        const field = main?.querySelector<HTMLInputElement>('input[data-search], input[type=search], input[placeholder*="…"]')
        if (field) { e.preventDefault(); field.focus(); field.select() }
        return
      }
      // Context-aware New: creates in the current section (editor keeps its own handler).
      if (c && !e.shiftKey && key === 'n' && !e.altKey) {
        if (st.page === 'editor') return
        e.preventDefault()
        if (st.page === 'tasks') st.navigate('tasks', { create: true })
        else if (st.page === 'projects') st.navigate('projects', { create: true })
        else st.navigate('notes', { create: true })
        return
      }
      if (c && e.shiftKey && key === 'd') { e.preventDefault(); st.setSettings({ theme: cycleThemeValue(st.settings.theme) }) }
      if (c && e.shiftKey && key === 'l') { e.preventDefault(); st.setSettings({ language: st.settings.language === 'ar' ? 'en' : 'ar' }) }
      if (c && e.key === ',') { e.preventDefault(); st.navigate('settings') }
      if (c && key === 'b' && !e.shiftKey) { e.preventDefault(); st.setSettings({ sidebarCollapsed: !st.settings.sidebarCollapsed }) }
      if (c && /^[1-9]$/.test(e.key) && !e.shiftKey) { const n = NAV[Number(e.key) - 1]; if (n) { e.preventDefault(); st.navigate(n.id) } }
      if (e.key === 'F11') { e.preventDefault(); window.dh.window.fullscreen() }
    }
    // Mouse back/forward buttons (4/5) navigate history like a browser.
    const m = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); useApp.getState().goBack() }
      if (e.button === 4) { e.preventDefault(); useApp.getState().goForward() }
    }
    window.addEventListener('keydown', h)
    window.addEventListener('mouseup', m)
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('mouseup', m) }
  }, [])
}

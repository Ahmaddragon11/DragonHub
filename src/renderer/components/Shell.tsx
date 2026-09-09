import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, StickyNote, Lightbulb, CheckSquare, FolderOpen, Code2, Download, Archive, Image, Clapperboard, ShieldCheck,
  Keyboard, Settings, Info, Minus, Square, X, Copy, Search, ChevronsLeft, ChevronsRight, Sun, Moon, Languages, Send, Command, Wifi, Gauge,
} from 'lucide-react'
import { useApp, type PageId } from '@/store'
import { cn } from '@/lib/utils'
import { invoke } from '@/lib/api'
import { APP_VERSION, DEVELOPER } from '@shared/types'

export type NavGroup = 'main' | 'productivity' | 'files' | 'media' | 'security' | 'system'

export const NAV: { id: PageId; icon: React.ReactNode; group: NavGroup }[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={19} />, group: 'main' },
  { id: 'notes', icon: <StickyNote size={19} />, group: 'productivity' },
  { id: 'projects', icon: <Lightbulb size={19} />, group: 'productivity' },
  { id: 'tasks', icon: <CheckSquare size={19} />, group: 'productivity' },
  { id: 'files', icon: <FolderOpen size={19} />, group: 'files' },
  { id: 'editor', icon: <Code2 size={19} />, group: 'files' },
  { id: 'downloads', icon: <Download size={19} />, group: 'files' },
  { id: 'network', icon: <Wifi size={19} />, group: 'files' },
  { id: 'resources', icon: <Gauge size={19} />, group: 'files' },
  { id: 'compress', icon: <Archive size={19} />, group: 'files' },
  { id: 'images', icon: <Image size={19} />, group: 'media' },
  { id: 'video', icon: <Clapperboard size={19} />, group: 'media' },
  { id: 'vault', icon: <ShieldCheck size={19} />, group: 'security' },
  { id: 'shortcuts', icon: <Keyboard size={19} />, group: 'system' },
  { id: 'settings', icon: <Settings size={19} />, group: 'system' },
  { id: 'about', icon: <Info size={19} />, group: 'system' },
]

const GROUP_ORDER: NavGroup[] = ['main', 'productivity', 'files', 'media', 'security', 'system']
const EXPANDED_W = 232
const COLLAPSED_W = 76

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="./icon.png"
      width={size}
      height={size}
      alt="DragonHub"
      draggable={false}
      style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.22)), objectFit: 'cover' }}
    />
  )
}

export function TitleBar() {
  const { windowMaximized, setPalette } = useApp()
  const { t } = useTranslation()
  return (
    <div className="drag flex items-center h-10 px-3 gap-3 select-none shrink-0 relative z-20">
      <div className="flex items-center gap-2 text-sm font-semibold"><Logo size={20} /><span className="gradient-text">DragonHub</span></div>
      <button className="no-drag mx-auto flex items-center gap-2 rounded-lg bg-surface-200/60 hover:bg-surface-200 px-3 py-1 text-xs text-surface-600 transition-all w-80 max-w-[40vw]" onClick={() => setPalette(true)}>
        <Search size={13} /><span className="flex-1 text-start truncate">{t('palette.placeholder')}</span><kbd className="kbd">Ctrl K</kbd>
      </button>
      <div className="no-drag flex items-center">
        <button className="btn-icon rounded-none h-10 w-11 hover:bg-surface-200" onClick={() => window.dh.window.minimize()}><Minus size={15} /></button>
        <button className="btn-icon rounded-none h-10 w-11 hover:bg-surface-200" onClick={() => window.dh.window.maximize()}>{windowMaximized ? <Copy size={13} className="rotate-180" /> : <Square size={13} />}</button>
        <button className="btn-icon rounded-none h-10 w-11 hover:bg-rose-500 hover:text-white" onClick={() => window.dh.window.close()}><X size={16} /></button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { page, navigate, settings, setSettings, systemTheme, tasks, downloads } = useApp()
  const { t } = useTranslation()
  const collapsed = settings.sidebarCollapsed
  const anim = settings.animations !== 'off'
  const isRtl = settings.language === 'ar'
  // 3-state theme cycle that respects an explicit 'system' choice.
  const cycleTheme = () => setSettings({ theme: settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark' })
  const darkNow = settings.theme === 'dark' || (settings.theme === 'system' && systemTheme === 'dark')
  const toggleCollapsed = () => setSettings({ sidebarCollapsed: !collapsed })
  const openTasks = tasks.filter((x) => x.status !== 'done').length
  const activeDl = downloads.filter((d) => d.status === 'downloading' || d.status === 'queued').length
  const badgeOf = (id: PageId): number => (id === 'tasks' ? openTasks : id === 'downloads' ? activeDl : 0)
  // Collapse chevron always points toward the edge it will move to:
  // expanded -> points outward (to collapse), collapsed -> points inward (to expand).
  const CollapseIcon = collapsed
    ? (isRtl ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />)
    : (isRtl ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />)

  return (
    <aside
      aria-expanded={!collapsed}
      style={{ width: collapsed ? COLLAPSED_W : EXPANDED_W, transitionDuration: anim ? undefined : '0ms' }}
      className="glass rounded-2xl m-2 me-0 flex flex-col overflow-hidden shrink-0 relative z-10 transition-[width] duration-200 ease-out"
    >
      {/* Header: brand + collapse toggle fixed in place */}
      <div className={cn('flex items-center gap-2 px-3 pt-3 pb-2 shrink-0', collapsed ? 'flex-col' : 'flex-row')}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Logo size={22} />
          {!collapsed && <span className="text-sm font-bold gradient-text truncate">DragonHub</span>}
        </div>
        <button
          className="btn-icon shrink-0 border border-surface-300/60 rounded-xl"
          title={collapsed ? t('side.expand') : t('side.collapse')}
          aria-label={collapsed ? t('side.expand') : t('side.collapse')}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          {CollapseIcon}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 space-y-3 min-h-0">
        {GROUP_ORDER.map((g) => {
          const items = NAV.filter((n) => n.group === g)
          if (items.length === 0) return null
          return (
            <div key={g}>
              {collapsed ? (
                <div className="divider my-1.5" />
              ) : (
                <p className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-surface-500 select-none">{t(`side.${g}`)}</p>
              )}
              <div className="space-y-0.5">
                {items.map((n) => {
                  const active = page === n.id
                  const badge = badgeOf(n.id)
                  return (
                    <button
                      key={n.id}
                      onClick={() => navigate(n.id)}
                      title={t(`nav.${n.id}`)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative w-full flex items-center gap-3 rounded-xl py-2.5 text-sm group',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        anim && 'transition-all duration-200',
                        active ? 'text-accent-fg' : 'text-surface-700 hover:bg-surface-200 hover:text-surface-900',
                      )}
                    >
                      {active && (settings.animations === 'full'
                        ? <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-accent shadow-glow" transition={{ type: 'tween', duration: 0.18 }} />
                        : <span className="absolute inset-0 rounded-xl bg-accent shadow-glow" />)}
                      <span className={cn('relative z-10 shrink-0', anim && 'transition-transform duration-200 group-hover:scale-110')}>{n.icon}</span>
                      {!collapsed && <span className="relative z-10 truncate flex-1 text-start">{t(`nav.${n.id}`)}</span>}
                      {!collapsed && badge > 0 && (
                        <span className={cn('relative z-10 text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center', active ? 'bg-white/25 text-accent-fg' : 'bg-accent/15 text-accent')}>
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                      {collapsed && badge > 0 && (
                        <span className="absolute top-1 end-1 z-10 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-fg text-[9px] font-bold flex items-center justify-center">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>
      <footer className="p-2 border-t border-surface-300/60 space-y-1 shrink-0">
        <button className={cn('w-full flex items-center gap-3 rounded-xl py-2 text-xs text-sky-500 hover:bg-sky-500/10', collapsed ? 'justify-center px-0' : 'px-3')} onClick={() => invoke('app:openTelegram')} title={t('about.contact')}>
          <Send size={16} className="shrink-0" />{!collapsed && <span className="truncate">@ahmaddragon</span>}
        </button>
        <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
          <button className="btn-icon flex-1 w-full" title={t('palette.theme')} onClick={cycleTheme}>{darkNow ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="btn-icon flex-1 w-full" title={t('palette.lang')} onClick={() => setSettings({ language: settings.language === 'ar' ? 'en' : 'ar' })}><Languages size={16} /></button>
        </div>
        {!collapsed && <p className="text-center text-[10px] text-surface-500 pt-1">{t('app.by')} <span className="font-semibold text-surface-700">{DEVELOPER}</span></p>}
      </footer>
    </aside>
  )
}

export function Splash() {
  const { t } = useTranslation()
  return (
    <motion.div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-surface-50 overflow-hidden" exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <div className="aurora" />
      <div className="relative">
        {[0, 1, 2].map((i) => <span key={i} className="splash-ring absolute inset-0 rounded-full border-2 border-accent/60" style={{ animationDelay: `${i * 0.7}s` }} />)}
        <motion.div initial={{ scale: 0, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.1 }} className="relative p-6 rounded-[2rem] glass shadow-glow animate-pulse-glow"><Logo size={72} /></motion.div>
      </div>
      <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.9 }} className="mt-10 text-4xl font-black gradient-text tracking-tight">DragonHub</motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.8 }} className="mt-2 text-surface-600 text-sm">{t('app.tagline')}</motion.p>
      <motion.div initial={{ width: 0 }} animate={{ width: 220 }} transition={{ delay: 0.8, duration: 1.4, ease: 'easeInOut' }} className="mt-8 h-1 rounded-full bg-accent shadow-glow" />
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }} className="absolute bottom-8 text-[11px] text-surface-500">{t('app.by')} {DEVELOPER} • v{APP_VERSION}</motion.p>
    </motion.div>
  )
}

export function CommandPalette() {
  const { paletteOpen, setPalette, navigate, settings, setSettings } = useApp()
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const cmds = useMemo(() => [
    ...NAV.map((n) => ({ id: n.id, label: t(`nav.${n.id}`), icon: n.icon, group: t('palette.navigate'), run: () => navigate(n.id) })),
    { id: 'new-note', label: t('dashboard.newNote'), icon: <StickyNote size={18} />, group: t('palette.actions'), run: () => navigate('notes', { create: true }) },
    { id: 'new-task', label: t('dashboard.newTask'), icon: <CheckSquare size={18} />, group: t('palette.actions'), run: () => navigate('tasks', { create: true }) },
    { id: 'new-project', label: t('dashboard.newProject'), icon: <Lightbulb size={18} />, group: t('palette.actions'), run: () => navigate('projects', { create: true }) },
    { id: 'new-download', label: t('dashboard.newDownload'), icon: <Download size={18} />, group: t('palette.actions'), run: () => navigate('downloads', { focus: true }) },
    { id: 'open-vault', label: t('dashboard.openVault'), icon: <ShieldCheck size={18} />, group: t('palette.actions'), run: () => navigate('vault') },
    { id: 'theme', label: t('palette.theme'), icon: <Sun size={18} />, group: t('palette.actions'), run: () => setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'lang', label: t('palette.lang'), icon: <Languages size={18} />, group: t('palette.actions'), run: () => setSettings({ language: settings.language === 'ar' ? 'en' : 'ar' }) },
    { id: 'tg', label: 'Telegram @ahmaddragon', icon: <Send size={18} />, group: t('palette.actions'), run: () => invoke('app:openTelegram') },
  ], [t, settings, navigate, setSettings])
  const filtered = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
  useEffect(() => { setIdx(0) }, [q, paletteOpen])
  useEffect(() => { if (!paletteOpen) setQ('') }, [paletteOpen])
  if (!paletteOpen) return null
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <motion.div initial={{ opacity: 0, y: -20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-300/60"><Command size={18} className="text-accent" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('palette.placeholder')} className="flex-1 bg-transparent outline-none text-sm"
            onKeyDown={(e) => { if (e.key === 'ArrowDown') setIdx((i) => Math.min(filtered.length - 1, i + 1)); if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1)); if (e.key === 'Enter' && filtered[idx]) { filtered[idx].run(); setPalette(false) } if (e.key === 'Escape') setPalette(false) }} />
        </div>
        <div className="max-h-80 overflow-auto p-2">
          {filtered.length === 0 && <p className="text-sm text-surface-500 p-4 text-center">{t('palette.noMatch')}</p>}
          {filtered.map((c, i) => (
            <button key={c.id} onMouseEnter={() => setIdx(i)} onClick={() => { c.run(); setPalette(false) }} className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-start transition-colors', i === idx ? 'bg-accent text-accent-fg' : 'hover:bg-surface-200')}>
              <span>{c.icon}</span><span className="flex-1">{c.label}</span><span className={cn('text-[10px]', i === idx ? 'opacity-80' : 'text-surface-500')}>{c.group}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

export function useGlobalShortcuts() {
  const { setPalette, navigate, settings, setSettings, page } = useApp()
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Never hijack keystrokes while the user is typing (inputs, textareas,
      // selects, contentEditable, Monaco) — except the palette toggle itself.
      const el = e.target as HTMLElement | null
      const typing = !!el && (
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
        el.isContentEditable || !!el.closest?.('.monaco-editor')
      )
      const c = e.ctrlKey || e.metaKey
      if (c && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return }
      if (e.key === 'Escape') { setPalette(false); return }
      if (typing) return
      // Context-aware New: creates in the current section (editor keeps its own handler).
      if (c && !e.shiftKey && e.key.toLowerCase() === 'n' && !e.altKey) {
        const pg = useApp.getState().page
        if (pg === 'editor') return
        e.preventDefault()
        if (pg === 'tasks') navigate('tasks', { create: true })
        else if (pg === 'projects') navigate('projects', { create: true })
        else navigate('notes', { create: true })
        return
      }
      if (c && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) }
      if (c && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setSettings({ language: settings.language === 'ar' ? 'en' : 'ar' }) }
      if (c && e.key === ',') { e.preventDefault(); navigate('settings') }
      if (c && e.key === 'b') { e.preventDefault(); setSettings({ sidebarCollapsed: !settings.sidebarCollapsed }) }
      if (c && /^[1-9]$/.test(e.key) && !e.shiftKey) { const n = NAV[Number(e.key) - 1]; if (n) { e.preventDefault(); navigate(n.id) } }
      if (e.key === 'F11') { e.preventDefault(); window.dh.window.fullscreen() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setPalette, navigate, settings, setSettings, page])
}

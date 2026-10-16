import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import {
  StickyNote, CheckSquare, Lightbulb, Download, Code2, ShieldCheck, Cpu, MemoryStick, Clock,
  ArrowUpRight, CalendarClock, Sparkles, FileText, Plus, Command, Rocket,
  CheckCircle2, Circle, X,
} from 'lucide-react'
import { useApp, type RecentKind } from '@/store'
import { Progress, Kbd, Ring } from '@/components/ui'
import FocusTimer from '@/components/FocusTimer'
import { GlowButton, FlyIcon, glowSelf, type GlowTone } from '@/components/Glow'
import { invoke } from '@/lib/api'
import { cn, formatBytes, formatDuration, relTime } from '@/lib/utils'
import { isDueToday, isOverdue, moveTask } from '@/lib/tasks'
import { ease, revealItem, revealSequence, useMotionPrefs } from '@/lib/motion'

interface SysInfo { cpus: number; cpuModel: string; totalMem: number; freeMem: number; uptime: number; platform: string; release: string; arch: string }

const greetingKey = (h: number) => (h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening')

const GS_KEY = 'dh:homeGetStartedDismissed'

/** Card section with consistent header + optional "view all" affordance. */
function Panel({ icon, title, subtitle, action, children, className }: { icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const { reduced, k } = useMotionPrefs()
  return (
    <motion.section variants={revealItem(reduced, k)} className={cn('card p-4 sm:p-5 flex flex-col min-w-0', className)}>
      <header className="flex items-start justify-between gap-3 mb-3 px-0.5">
        <div className="min-w-0">
          <h2 className="section-title">{icon}{title}</h2>
          {subtitle && <p className="text-[11.5px] text-surface-500 mt-1 truncate">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </motion.section>
  )
}

function ViewAll({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return <button className="btn-sm btn-ghost text-surface-500 -me-1.5 shrink-0" onClick={onClick}>{t('dashboard.viewAll')}<ArrowUpRight size={13} className="rtl:-scale-x-100" /></button>
}

/** Empty state with an icon, hint and a call-to-action that creates content. */
function EmptyHint({ icon, text, hint, cta, onClick }: { icon: React.ReactNode; text: string; hint?: string; cta: string; onClick: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
      <span className="grid place-items-center h-12 w-12 rounded-2xl bg-surface-200/70 text-surface-500 mb-3 ring-1 ring-inset ring-[color:var(--hairline)]">{icon}</span>
      <p className="text-[13px] font-medium text-surface-700">{text}</p>
      {hint && <p className="text-[11.5px] text-surface-500 mt-1 max-w-[240px]">{hint}</p>}
      <button className="btn-sm btn-soft mt-3" onClick={onClick}><Plus size={13} />{cta}</button>
    </div>
  )
}

/** Isolated live clock so the seconds tick without re-rendering the dashboard. */
function LiveClock({ lang, lowPower }: { lang: string; lowPower: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), lowPower ? 30000 : 1000)
    return () => clearInterval(i)
  }, [lowPower])
  const time = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', lowPower ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
  return <span className="tabular-nums font-medium text-surface-700" dir="ltr">{time}</span>
}

interface GsStep { key: string; label: string; hint: string; done: boolean; onClick: () => void }

/** New-user checklist: shown only while the workspace is (nearly) empty. */
function GettingStarted({ steps, done, total, onDismiss }: { steps: GsStep[]; done: number; total: number; onDismiss: () => void }) {
  const { t } = useTranslation()
  const pct = Math.round((done / total) * 100)
  return (
    <section aria-label={t('dashboard.getStarted.title')} className="dashboard-hero relative isolate overflow-hidden p-4 sm:p-5">
      <span aria-hidden className="pointer-events-none absolute -top-16 -end-10 h-40 w-40 rounded-full bg-accent/12 blur-3xl animate-float" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 start-1/3 h-36 w-36 rounded-full bg-accent-soft/10 blur-3xl animate-float" style={{ animationDelay: '-3s' }} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/20"><Rocket size={18} /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">{t('dashboard.getStarted.title')}</h2>
            <p className="text-xs text-surface-600 mt-0.5">{t('dashboard.getStarted.subtitle')}</p>
          </div>
        </div>
        <button className="btn-icon shrink-0" aria-label={t('dashboard.getStarted.dismiss')} onClick={onDismiss}><X size={15} /></button>
      </div>
      <div className="relative mt-4 flex items-center gap-3">
        <Progress value={pct} />
        <span className="text-[11px] tabular-nums text-surface-500 shrink-0">{t('dashboard.getStarted.progress', { done, total })}</span>
      </div>
      <ul className="relative mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {steps.map((s) => (
          <li key={s.key}>
            <button onClick={s.onClick} className={cn('group w-full h-full flex items-center gap-3 rounded-xl border p-3 text-start transition-colors duration-150', s.done ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-[color:var(--hairline)] hover:border-accent/40 hover:bg-surface-200/50')}>
              <span className={cn('shrink-0 transition-colors', s.done ? 'text-emerald-500' : 'text-surface-400 group-hover:text-accent')}>{s.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}</span>
              <span className="min-w-0">
                <span className={cn('block text-[13px] font-medium truncate', s.done && 'text-surface-500 line-through')}>{s.label}</span>
                <span className="block text-[11px] text-surface-500 truncate">{s.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const { reduced, k } = useMotionPrefs()
  const { notes, tasks, projects, downloads, navigate, lang, recents, touchRecent, saveTasks, lowPower } = useApp(useShallow((s) => ({
    notes: s.notes, tasks: s.tasks, projects: s.projects, downloads: s.downloads, navigate: s.navigate, lang: s.settings.language, recents: s.recents, touchRecent: s.touchRecent, saveTasks: s.saveTasks, lowPower: s.settings.lowPowerMode,
  })))
  const [sys, setSys] = useState<SysInfo | null>(null)
  const [vaultCount, setVaultCount] = useState<number | null>(null)
  const [paletteSeen, setPaletteSeen] = useState(false)
  const [gsDismissed, setGsDismissed] = useState(() => { try { return localStorage.getItem(GS_KEY) === '1' } catch { return false } })
  useEffect(() => {
    let alive = true
    const load = () => {
      if (!alive || document.hidden) return
      invoke<SysInfo>('app:system').then((s) => { if (alive && s) setSys(s) }).catch(() => {})
    }
    load()
    const i = setInterval(load, 15000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    invoke<boolean>('vault:isUnlocked').then((u) => { if (u && alive) invoke<unknown[]>('vault:list').then((l) => setVaultCount(l.length)).catch(() => {}) }).catch(() => {})
    return () => { alive = false; clearInterval(i); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const now = new Date()
  const activeNotes = useMemo(() => notes.filter((n) => !n.archived), [notes])
  const allProjects = useMemo(() => projects.filter((p) => p.status !== 'archived'), [projects])
  const openTasks = useMemo(() => tasks.filter((x) => x.status !== 'done'), [tasks])
  const overdue = useMemo(() => openTasks.filter((k) => isOverdue(k)).sort((a, b) => a.dueDate! - b.dueDate!), [openTasks])
  const today = useMemo(() => openTasks.filter((k) => isDueToday(k) && !isOverdue(k)).sort((a, b) => a.dueDate! - b.dueDate!), [openTasks])
  const upcoming = useMemo(() => openTasks.filter((k) => k.dueDate && !isOverdue(k) && !isDueToday(k)).sort((a, b) => a.dueDate! - b.dueDate!).slice(0, 4), [openTasks])
  const doneToday = useMemo(() => { const sod = new Date().setHours(0, 0, 0, 0); return tasks.filter((k) => k.status === 'done' && (k.completedAt ?? 0) >= sod).length }, [tasks])
  const agenda = [...overdue, ...today]
  const dayTotal = agenda.length + doneToday
  const dayPct = dayTotal ? Math.round((doneToday / dayTotal) * 100) : 0

  const recentNotes = useMemo(() => [...activeNotes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [activeNotes])
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active' || p.status === 'planning').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [projects])
  const activeDl = useMemo(() => downloads.filter((d) => d.status === 'downloading' || d.status === 'queued'), [downloads])
  const jumpBack = useMemo(() => recents.map((r) => {
    const e = r.kind === 'note' ? notes.find((n) => n.id === r.id) : r.kind === 'task' ? tasks.find((x) => x.id === r.id) : projects.find((p) => p.id === r.id)
    if (!e) return null
    return { ...r, label: ('title' in e ? e.title : e.name) || t('common.untitled') }
  }).filter(Boolean).slice(0, 4) as { kind: RecentKind; id: string; at: number; label: string }[], [recents, notes, tasks, projects, t])

  const openEntity = (kind: RecentKind, id: string) => { touchRecent(kind, id); navigate(kind === 'note' ? 'notes' : kind === 'task' ? 'tasks' : 'projects', { open: id }) }
  const complete = (id: string) => saveTasks(moveTask(useApp.getState().tasks, id, 'done').list)

  // New-user detection: hide the checklist as soon as there is real content.
  const contentCount = activeNotes.length + tasks.length + allProjects.length
  const isNew = contentCount < 3
  const gsSteps: GsStep[] = useMemo(() => [
    { key: 'note', label: t('dashboard.getStarted.stepNote'), hint: t('dashboard.getStarted.stepNoteHint'), done: activeNotes.length > 0, onClick: () => navigate('notes', { create: true }) },
    { key: 'task', label: t('dashboard.getStarted.stepTask'), hint: t('dashboard.getStarted.stepTaskHint'), done: tasks.length > 0, onClick: () => navigate('tasks', { create: true }) },
    { key: 'project', label: t('dashboard.getStarted.stepProject'), hint: t('dashboard.getStarted.stepProjectHint'), done: allProjects.length > 0, onClick: () => navigate('projects', { create: true }) },
    { key: 'palette', label: t('dashboard.getStarted.stepPalette'), hint: t('dashboard.getStarted.stepPaletteHint'), done: paletteSeen, onClick: () => { setPaletteSeen(true); useApp.getState().setPalette(true) } },
  ], [t, activeNotes.length, tasks.length, allProjects.length, paletteSeen, navigate])
  const gsDone = gsSteps.filter((s) => s.done).length
  const dismissGs = () => { setGsDismissed(true); try { localStorage.setItem(GS_KEY, '1') } catch { /* ignore quota */ } }

  const dateLabel = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)
  const stats = [
    { label: t('dashboard.notesCount'), value: activeNotes.length, icon: <StickyNote size={17} />, page: 'notes' as const },
    { label: t('dashboard.tasksCount'), value: openTasks.length, icon: <CheckSquare size={17} />, page: 'tasks' as const, alert: overdue.length },
    { label: t('dashboard.projectsCount'), value: allProjects.length, icon: <Lightbulb size={17} />, page: 'projects' as const },
    { label: t('dashboard.vaultCount'), value: vaultCount ?? '—', icon: <ShieldCheck size={17} />, page: 'vault' as const, locked: vaultCount === null },
  ]
  const quick: { l: string; i: React.ReactNode; go: () => void; k?: string; tone: GlowTone }[] = [
    { l: t('dashboard.newNote'), i: <StickyNote size={16} />, go: () => navigate('notes', { create: true }), k: 'Ctrl+N', tone: 'amber' },
    { l: t('dashboard.newTask'), i: <CheckSquare size={16} />, go: () => navigate('tasks', { create: true }), tone: 'accent' },
    { l: t('dashboard.newProject'), i: <Lightbulb size={16} />, go: () => navigate('projects', { create: true }), tone: 'emerald' },
    { l: t('dashboard.newDownload'), i: <Download size={16} />, go: () => navigate('downloads', { focus: true }), tone: 'cyan' },
    { l: t('dashboard.openEditor'), i: <Code2 size={16} />, go: () => navigate('editor'), tone: 'violet' },
    { l: t('dashboard.openVault'), i: <ShieldCheck size={16} />, go: () => navigate('vault'), tone: 'amber' },
  ]

  const memPct = sys ? ((sys.totalMem - sys.freeMem) / sys.totalMem) * 100 : 0

  return (
    <motion.div className="dashboard pb-4" variants={revealSequence(reduced, k)} initial="initial" animate="enter">
      <motion.header variants={revealItem(reduced, k)} className="dashboard-hero relative isolate overflow-hidden flex flex-wrap items-center justify-between gap-6 mb-5 px-5 py-6 sm:px-7 sm:py-7">
        <span aria-hidden className="pointer-events-none absolute -top-16 -end-10 h-48 w-48 rounded-full bg-accent/12 blur-3xl animate-float" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 start-1/3 h-44 w-44 rounded-full bg-accent-soft/10 blur-3xl animate-float" style={{ animationDelay: '-3s' }} />
        <div className="min-w-0 flex-1 relative z-10">
          <p className="inline-flex items-center gap-2 text-xs font-medium text-accent">{<Sparkles size={14} />}{dateLabel}</p>
          <div className="flex items-center gap-2 mt-1.5 text-[12px] text-surface-500">
            <Clock size={12} className="shrink-0" />
            <LiveClock lang={lang} lowPower={lowPower} />
          </div>
          <h1 className="text-[clamp(1.65rem,3vw,2.35rem)] font-semibold tracking-tight leading-tight mt-2">{t(`dashboard.greeting.${greetingKey(now.getHours())}`)}</h1>
          <p className="text-sm text-surface-600 mt-2 max-w-xl">
            {agenda.length === 0 && doneToday === 0 ? t('dashboard.dayClear') : t('dashboard.daySummary', { open: agenda.length, done: doneToday })}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 mt-5">
            <GlowButton tone="accent" onClick={() => navigate('notes', { create: true })} className="btn-primary"><Plus size={15} />{t('dashboard.newNote')}</GlowButton>
            <button onClick={() => useApp.getState().setPalette(true)} className="btn-outline text-surface-600">
              <Command size={14} />{t('dashboard.quickFind')}<Kbd keys={['Ctrl', 'K']} className="hidden sm:inline-flex" />
            </button>
          </div>
        </div>
        <div className="hidden md:flex items-center justify-center shrink-0 relative z-10">
          <Ring value={dayPct} size={104} stroke={8}>
            <span className="text-[22px] font-semibold tracking-tight tabular-nums leading-none">{dayPct}%</span>
            <span className="text-[10px] text-surface-500 mt-1">{t('dashboard.todayProgress')}</span>
          </Ring>
        </div>
      </motion.header>

      {isNew && !gsDismissed && (
        <motion.div variants={revealItem(reduced, k)} className="mb-5">
          <GettingStarted steps={gsSteps} done={gsDone} total={gsSteps.length} onDismiss={dismissGs} />
        </motion.div>
      )}

      <motion.section variants={revealItem(reduced, k)} aria-label={t('dashboard.stats')} className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((s) => (
          <button key={s.label} onClick={() => navigate(s.page)} aria-label={`${s.label}: ${s.value}`}
            className={cn('card card-interactive dashboard-stat p-4 sm:p-5 text-start group relative overflow-hidden', s.alert ? 'ring-1 ring-rose-500/40' : undefined)}>
            <span aria-hidden className={cn('pointer-events-none absolute -end-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300', s.alert ? 'bg-rose-500/20' : 'bg-accent/20')} />
            <div className="relative flex items-center justify-between gap-2 text-surface-600">
              <span className={cn('dashboard-stat-icon grid place-items-center h-10 w-10 rounded-xl', s.alert ? 'bg-rose-500/12 text-rose-500' : 'bg-accent/10 text-accent')}>{s.icon}</span>
              <ArrowUpRight size={16} className="text-surface-400 group-hover:text-accent transition-colors rtl:-scale-x-100" />
            </div>
            <div className="relative mt-4 flex items-baseline gap-2 flex-wrap">
              <span className="text-[30px] font-semibold tracking-tight tabular-nums leading-none">{s.value}</span>
              {!!s.alert && <span className="badge bg-rose-500/12 text-rose-500"><span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />{t('dashboard.overdueN', { count: s.alert })}</span>}
              {s.locked && <span className="text-[11px] text-surface-500">{t('vault.locked')}</span>}
            </div>
            <span className="relative block mt-2 text-xs font-medium text-surface-500">{s.label}</span>
          </button>
        ))}
      </motion.section>

      <motion.section variants={revealItem(reduced, k)} className="mt-6" aria-label={t('dashboard.quickActions')}>
        <h2 className="label mb-3 px-1">{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {quick.map((q) => (
            <button key={q.l} onClick={q.go} {...glowSelf(q.tone, cn('card card-interactive dashboard-action flex items-center gap-3 px-3 py-3 text-[13px] font-medium text-surface-700 hover:text-surface-950 group text-start min-w-0 fly-host'), { paused: true })}>
              <span className="grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-fg transition-colors duration-200"><FlyIcon>{q.i}</FlyIcon></span>
              <span className="truncate flex-1">{q.l}</span>
              {q.k && <Kbd keys={q.k} className="hidden xl:inline-flex opacity-0 group-hover:opacity-100 transition-opacity" />}
            </button>
          ))}
        </div>
      </motion.section>

      <motion.div variants={revealItem(reduced, k)} className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-6">
        {/* Today agenda */}
        <Panel className="lg:col-span-2 min-h-[280px]" icon={<CalendarClock size={15} />} title={t('dashboard.today')}
          action={<div className="flex items-center gap-3">{dayTotal > 0 && <div className="hidden sm:flex items-center gap-2 w-36"><Progress value={dayPct} tone="success" /><span className="text-[11px] tabular-nums text-surface-500">{dayPct}%</span></div>}<ViewAll onClick={() => navigate('tasks')} /></div>}>
          {agenda.length === 0 && upcoming.length === 0 ? (
            <EmptyHint icon={<CheckSquare size={20} />} text={t('dashboard.nothingDue')} hint={t('tasks.emptyHint')} cta={t('dashboard.newTask')} onClick={() => navigate('tasks', { create: true })} />
          ) : (
            <ul className="divide-y divide-[color:var(--hairline)]">
              {agenda.slice(0, 6).map((k) => {
                const late = isOverdue(k)
                return (
                  <motion.li key={k.id} layout exit={{ opacity: 0 }} className="group flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-surface-200/50 transition-colors">
                    <button aria-label={t('common.done')} onClick={() => complete(k.id)} className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-surface-400 hover:border-emerald-500 hover:bg-emerald-500/15 transition-colors" />
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', late ? 'bg-rose-500' : 'bg-accent')} aria-hidden />
                    <button className="flex-1 min-w-0 text-start" onClick={() => openEntity('task', k.id)}>
                      <span className="block text-[13.5px] truncate group-hover:text-surface-950">{k.title}</span>
                    </button>
                    <span className={cn('text-[11.5px] tabular-nums shrink-0', late ? 'text-rose-500 font-medium' : 'text-surface-500')}>
                      {late ? t('tasks.overdue') + ' · ' : ''}{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(k.dueDate!)}
                    </span>
                  </motion.li>
                )
              })}
              {upcoming.length > 0 && (
                <li className="pt-3 pb-1 px-1"><span className="label">{t('dashboard.upcoming')}</span></li>
              )}
              {upcoming.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-surface-200/50 transition-colors">
                  <span className="h-[18px] w-[18px] shrink-0 grid place-items-center"><span className="h-1.5 w-1.5 rounded-full bg-surface-400" /></span>
                  <button className="flex-1 min-w-0 text-start text-[13.5px] text-surface-700 hover:text-surface-950 truncate" onClick={() => openEntity('task', k.id)}>{k.title}</button>
                  <span className="text-[11.5px] text-surface-500 shrink-0">{relTime(k.dueDate!, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <FocusTimer />
      </motion.div>

      <motion.div variants={revealItem(reduced, k)} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
        <Panel icon={<Sparkles size={15} />} title={jumpBack.length ? t('dashboard.jumpBack') : t('dashboard.recentNotes')} action={<ViewAll onClick={() => navigate('notes')} />}>
          {jumpBack.length > 0 ? (
            <ul className="space-y-0.5">
              {jumpBack.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  <button onClick={() => openEntity(r.kind, r.id)} className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-200/70 transition-colors text-start">
                    <span className="text-surface-500">{r.kind === 'note' ? <FileText size={15} /> : r.kind === 'task' ? <CheckSquare size={15} /> : <Lightbulb size={15} />}</span>
                    <span className="flex-1 min-w-0 truncate text-[13.5px]">{r.label}</span>
                    <span className="text-[11px] text-surface-500 shrink-0">{relTime(r.at, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : recentNotes.length === 0 ? (
            <EmptyHint icon={<FileText size={20} />} text={t('common.empty')} hint={t('dashboard.getStarted.stepNoteHint')} cta={t('dashboard.newNote')} onClick={() => navigate('notes', { create: true })} />
          ) : (
            <ul className="space-y-0.5">
              {recentNotes.map((n) => (
                <li key={n.id}>
                  <button onClick={() => openEntity('note', n.id)} className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-200/70 transition-colors text-start">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: n.color }} />
                    <span className="flex-1 min-w-0 truncate text-[13.5px]">{n.title || t('common.untitled')}</span>
                    <span className="text-[11px] text-surface-500 shrink-0">{relTime(n.updatedAt, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={<Lightbulb size={15} />} title={t('dashboard.activeProjects')} action={<ViewAll onClick={() => navigate('projects')} />}>
          {activeProjects.length === 0 ? (
            <EmptyHint icon={<Lightbulb size={20} />} text={t('common.empty')} hint={t('projects.noProjects')} cta={t('dashboard.newProject')} onClick={() => navigate('projects', { create: true })} />
          ) : (
            <ul className="space-y-1">
              {activeProjects.map((p) => (
                <li key={p.id}>
                  <button onClick={() => openEntity('project', p.id)} className="w-full text-start rounded-lg px-2 py-2 hover:bg-surface-200/70 transition-colors">
                    <div className="flex items-center justify-between gap-2 text-[13.5px] mb-1.5">
                      <span className="flex items-center gap-2 min-w-0"><span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} /><span className="truncate">{p.name}</span></span>
                      <span className="text-surface-500 text-[11px] tabular-nums">{p.progress}%</span>
                    </div>
                    <Progress value={p.progress} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-3 md:col-span-2 xl:col-span-1">
          {activeDl.length > 0 && (
            <Panel icon={<Download size={15} />} title={t('dashboard.activeDownloads')} action={<ViewAll onClick={() => navigate('downloads')} />}>
              <div className="space-y-3">
                {activeDl.slice(0, 3).map((d) => {
                  const downloading = d.status === 'downloading'
                  const dlPct = d.size ? (d.received / d.size) * 100 : 0
                  return (
                    <div key={d.id} className="rounded-xl border border-[color:var(--hairline)] p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={cn('grid place-items-center h-7 w-7 rounded-lg shrink-0', downloading ? 'bg-accent/12 text-accent' : 'bg-surface-200 text-surface-500')}><Download size={13} /></span>
                        <span className="flex-1 min-w-0 truncate text-[13px]">{d.filename || d.url}</span>
                        <span className={cn('badge shrink-0', downloading ? 'bg-accent/12 text-accent' : 'bg-surface-200 text-surface-500')}>
                          {downloading && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />}
                          {t(`downloads.status.${d.status}`)}
                        </span>
                      </div>
                      <Progress value={dlPct} />
                      <div className="flex items-center justify-between mt-1.5 text-[11px] text-surface-500 tabular-nums">
                        <span>{formatBytes(d.received, 0)} / {d.size ? formatBytes(d.size, 0) : '—'}</span>
                        <span>{formatBytes(d.speed)}/s</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}
          <Panel icon={<Cpu size={15} />} title={t('dashboard.system')} action={<ViewAll onClick={() => navigate('resources')} />}>
            {!sys ? (
              <div className="space-y-2 px-1"><div className="shimmer h-10" /><div className="shimmer h-2" /></div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: ease.out }} className="px-0.5">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[[<Cpu size={14} key="c" />, t('dashboard.cpu'), `${sys.cpus} ${t('dashboard.cores')}`], [<MemoryStick size={14} key="m" />, t('dashboard.memory'), `${formatBytes(sys.totalMem - sys.freeMem, 0)} / ${formatBytes(sys.totalMem, 0)}`], [<Clock size={14} key="u" />, t('dashboard.uptime'), formatDuration(sys.uptime)]].map(([ic, l, v]) => (
                    <div key={String(l)} className="rounded-lg bg-surface-200/60 px-2 py-2.5 min-w-0">
                      <dt className="flex items-center justify-center gap-1 text-[11px] text-surface-500">{ic}{l}</dt>
                      <dd className="text-[13px] font-semibold tabular-nums mt-0.5 truncate">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3"><Progress value={memPct} tone={memPct > 90 ? 'danger' : undefined} /></div>
                <p className="text-[11px] text-surface-500 mt-2 truncate">{sys.cpuModel} · {sys.platform} {sys.release} {sys.arch}</p>
              </motion.div>
            )}
          </Panel>
        </div>
      </motion.div>
    </motion.div>
  )
}

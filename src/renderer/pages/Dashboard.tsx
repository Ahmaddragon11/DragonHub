import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { StickyNote, CheckSquare, Lightbulb, Download, Code2, ShieldCheck, Cpu, MemoryStick, Clock, ArrowUpRight, CalendarClock, AlertCircle, Sparkles, FileText, Plus, Command } from 'lucide-react'
import { useApp, type RecentKind } from '@/store'
import { Progress, Kbd } from '@/components/ui'
import FocusTimer from '@/components/FocusTimer'
import { invoke } from '@/lib/api'
import { cn, formatBytes, formatDuration, relTime } from '@/lib/utils'
import { isDueToday, isOverdue, moveTask } from '@/lib/tasks'
import { ease, revealItem, revealSequence, useMotionPrefs } from '@/lib/motion'

interface SysInfo { cpus: number; cpuModel: string; totalMem: number; freeMem: number; uptime: number; platform: string; release: string; arch: string }

const greetingKey = (h: number) => (h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening')

/** Card section with consistent header + optional "view all" affordance. */
function Panel({ icon, title, action, children, className }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const { reduced, k } = useMotionPrefs()
  return (
    <motion.section variants={revealItem(reduced, k)} className={cn('card p-4 flex flex-col min-w-0', className)}>
      <header className="flex items-center justify-between gap-2 mb-2 px-1">
        <h2 className="section-title">{icon}{title}</h2>
        {action}
      </header>
      {children}
    </motion.section>
  )
}

function ViewAll({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return <button className="btn-sm btn-ghost text-surface-500 -me-1.5" onClick={onClick}>{t('dashboard.viewAll')}<ArrowUpRight size={13} className="rtl:-scale-x-100" /></button>
}

function MiniEmpty({ text, cta, onClick }: { text: string; cta: string; onClick: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
      <p className="text-xs text-surface-500">{text}</p>
      <button className="btn-sm btn-soft mt-2" onClick={onClick}><Plus size={13} />{cta}</button>
    </div>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const { reduced, k } = useMotionPrefs()
  const { notes, tasks, projects, downloads, navigate, lang, recents, touchRecent, saveTasks } = useApp(useShallow((s) => ({
    notes: s.notes, tasks: s.tasks, projects: s.projects, downloads: s.downloads, navigate: s.navigate, lang: s.settings.language, recents: s.recents, touchRecent: s.touchRecent, saveTasks: s.saveTasks,
  })))
  const [sys, setSys] = useState<SysInfo | null>(null)
  const [vaultCount, setVaultCount] = useState<number | null>(null)
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
  const openTasks = useMemo(() => tasks.filter((x) => x.status !== 'done'), [tasks])
  const overdue = useMemo(() => openTasks.filter((k) => isOverdue(k)).sort((a, b) => a.dueDate! - b.dueDate!), [openTasks])
  const today = useMemo(() => openTasks.filter((k) => isDueToday(k) && !isOverdue(k)).sort((a, b) => a.dueDate! - b.dueDate!), [openTasks])
  const upcoming = useMemo(() => openTasks.filter((k) => k.dueDate && !isOverdue(k) && !isDueToday(k)).sort((a, b) => a.dueDate! - b.dueDate!).slice(0, 4), [openTasks])
  const doneToday = useMemo(() => { const sod = new Date().setHours(0, 0, 0, 0); return tasks.filter((k) => k.status === 'done' && (k.completedAt ?? 0) >= sod).length }, [tasks])
  const agenda = [...overdue, ...today]
  const dayTotal = agenda.length + doneToday
  const dayPct = dayTotal ? Math.round((doneToday / dayTotal) * 100) : 0

  const recentNotes = useMemo(() => [...notes].filter((n) => !n.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [notes])
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active' || p.status === 'planning').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [projects])
  const activeDl = useMemo(() => downloads.filter((d) => d.status === 'downloading' || d.status === 'queued'), [downloads])
  const jumpBack = useMemo(() => recents.map((r) => {
    const e = r.kind === 'note' ? notes.find((n) => n.id === r.id) : r.kind === 'task' ? tasks.find((x) => x.id === r.id) : projects.find((p) => p.id === r.id)
    if (!e) return null
    return { ...r, label: ('title' in e ? e.title : e.name) || t('common.untitled') }
  }).filter(Boolean).slice(0, 4) as { kind: RecentKind; id: string; at: number; label: string }[], [recents, notes, tasks, projects, t])

  const openEntity = (kind: RecentKind, id: string) => { touchRecent(kind, id); navigate(kind === 'note' ? 'notes' : kind === 'task' ? 'tasks' : 'projects', { open: id }) }
  const complete = (id: string) => saveTasks(moveTask(useApp.getState().tasks, id, 'done').list)

  const dateLabel = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)
  const stats = [
    { label: t('dashboard.notesCount'), value: notes.filter((n) => !n.archived).length, icon: <StickyNote size={16} />, page: 'notes' as const },
    { label: t('dashboard.tasksCount'), value: openTasks.length, icon: <CheckSquare size={16} />, page: 'tasks' as const, alert: overdue.length },
    { label: t('dashboard.projectsCount'), value: projects.filter((p) => p.status !== 'archived').length, icon: <Lightbulb size={16} />, page: 'projects' as const },
    { label: t('dashboard.vaultCount'), value: vaultCount ?? '—', icon: <ShieldCheck size={16} />, page: 'vault' as const, locked: vaultCount === null },
  ]
  const quick = [
    { l: t('dashboard.newNote'), i: <StickyNote size={16} />, go: () => navigate('notes', { create: true }), k: 'Ctrl+N' },
    { l: t('dashboard.newTask'), i: <CheckSquare size={16} />, go: () => navigate('tasks', { create: true }) },
    { l: t('dashboard.newProject'), i: <Lightbulb size={16} />, go: () => navigate('projects', { create: true }) },
    { l: t('dashboard.newDownload'), i: <Download size={16} />, go: () => navigate('downloads', { focus: true }) },
    { l: t('dashboard.openEditor'), i: <Code2 size={16} />, go: () => navigate('editor') },
    { l: t('dashboard.openVault'), i: <ShieldCheck size={16} />, go: () => navigate('vault') },
  ]

  const memPct = sys ? ((sys.totalMem - sys.freeMem) / sys.totalMem) * 100 : 0

  return (
    <motion.div className="dashboard pb-4" variants={revealSequence(reduced, k)} initial="initial" animate="enter">
      <motion.header variants={revealItem(reduced, k)} className="dashboard-hero relative isolate overflow-hidden flex flex-wrap items-center justify-between gap-5 mb-5 px-5 py-6 sm:px-7 sm:py-7">
        <div className="min-w-0 relative z-10">
          <p className="inline-flex items-center gap-2 text-xs font-medium text-accent"><Sparkles size={14} />{dateLabel}</p>
          <h1 className="text-[clamp(1.65rem,3vw,2.35rem)] font-semibold tracking-tight leading-tight mt-2">{t(`dashboard.greeting.${greetingKey(now.getHours())}`)}</h1>
          <p className="text-sm text-surface-600 mt-2 max-w-xl">
            {agenda.length === 0 && doneToday === 0 ? t('dashboard.dayClear') : t('dashboard.daySummary', { open: agenda.length, done: doneToday })}
          </p>
        </div>
        <button onClick={() => useApp.getState().setPalette(true)} className="btn-outline relative z-10 text-surface-600">
          <Command size={14} />{t('dashboard.quickFind')}<Kbd keys={['Ctrl', 'K']} className="hidden sm:inline-flex" />
        </button>
      </motion.header>

      <motion.section variants={revealItem(reduced, k)} aria-label={t('dashboard.stats')} className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <button key={s.label} onClick={() => navigate(s.page)} className="card card-interactive dashboard-stat p-4 sm:p-5 text-start group" style={{ '--stat-index': i } as React.CSSProperties}>
            <div className="flex items-center justify-between gap-2 text-surface-600">
              <span className="dashboard-stat-icon grid place-items-center h-9 w-9 rounded-xl bg-accent/10 text-accent">{s.icon}</span>
              <ArrowUpRight size={15} className="text-surface-400 group-hover:text-accent transition-colors rtl:-scale-x-100" />
            </div>
            <div className="mt-4 flex items-baseline gap-2 flex-wrap">
              <span className="text-[30px] font-semibold tracking-tight tabular-nums leading-none">{s.value}</span>
              {!!s.alert && <span className="badge bg-rose-500/12 text-rose-500"><AlertCircle size={10} />{t('dashboard.overdueN', { count: s.alert })}</span>}
              {s.locked && <span className="text-[11px] text-surface-500">{t('vault.locked')}</span>}
            </div>
            <span className="block mt-2 text-xs font-medium text-surface-500">{s.label}</span>
          </button>
        ))}
      </motion.section>

      <motion.section variants={revealItem(reduced, k)} className="mt-6" aria-label={t('dashboard.quickActions')}>
        <h2 className="label mb-3 px-1">{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {quick.map((q) => (
            <button key={q.l} onClick={q.go} className="card card-interactive dashboard-action flex items-center gap-3 px-3 py-3 text-[13px] font-medium text-surface-700 hover:text-surface-950 group text-start min-w-0">
              <span className="grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-fg transition-colors duration-200">{q.i}</span>
              <span className="truncate">{q.l}</span>
            </button>
          ))}
        </div>
      </motion.section>

      <motion.div variants={revealItem(reduced, k)} className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-6">
        {/* Today agenda */}
        <Panel className="lg:col-span-2 min-h-[260px]" icon={<CalendarClock size={15} />} title={t('dashboard.today')}
          action={<div className="flex items-center gap-3">{dayTotal > 0 && <div className="hidden sm:flex items-center gap-2 w-36"><Progress value={dayPct} tone="success" /><span className="text-[11px] tabular-nums text-surface-500">{dayPct}%</span></div>}<ViewAll onClick={() => navigate('tasks')} /></div>}>
          {agenda.length === 0 && upcoming.length === 0 ? (
            <MiniEmpty text={t('dashboard.nothingDue')} cta={t('dashboard.newTask')} onClick={() => navigate('tasks', { create: true })} />
          ) : (
            <ul className="divide-y divide-[color:var(--hairline)]">
              {agenda.slice(0, 6).map((k) => (
                <motion.li key={k.id} layout exit={{ opacity: 0 }} className="group flex items-center gap-3 px-1 py-2">
                  <button aria-label={t('common.done')} onClick={() => complete(k.id)} className="h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-surface-400 hover:border-emerald-500 hover:bg-emerald-500/15 transition-colors" />
                  <button className="flex-1 min-w-0 text-start" onClick={() => openEntity('task', k.id)}>
                    <span className="block text-[13.5px] truncate group-hover:text-surface-950">{k.title}</span>
                  </button>
                  <span className={cn('text-[11.5px] tabular-nums shrink-0', isOverdue(k) ? 'text-rose-500 font-medium' : 'text-surface-500')}>
                    {isOverdue(k) ? t('tasks.overdue') + ' · ' : ''}{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(k.dueDate!)}
                  </span>
                </motion.li>
              ))}
              {upcoming.length > 0 && (
                <li className="pt-3 pb-1 px-1"><span className="label">{t('dashboard.upcoming')}</span></li>
              )}
              {upcoming.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-1 py-2">
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
            <MiniEmpty text={t('common.empty')} cta={t('dashboard.newNote')} onClick={() => navigate('notes', { create: true })} />
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
            <MiniEmpty text={t('common.empty')} cta={t('dashboard.newProject')} onClick={() => navigate('projects', { create: true })} />
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
              <div className="space-y-3 px-1 pb-1">
                {activeDl.slice(0, 3).map((d) => (
                  <div key={d.id}>
                    <div className="flex justify-between gap-2 text-xs mb-1.5"><span className="truncate">{d.filename || d.url}</span><span className="text-surface-500 tabular-nums shrink-0">{formatBytes(d.speed)}/s</span></div>
                    <Progress value={d.size ? (d.received / d.size) * 100 : 0} />
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <Panel icon={<Cpu size={15} />} title={t('dashboard.system')} action={<ViewAll onClick={() => navigate('resources')} />}>
            {!sys ? (
              <div className="space-y-2 px-1"><div className="shimmer h-10" /><div className="shimmer h-2" /></div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: ease.out }} className="px-1">
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

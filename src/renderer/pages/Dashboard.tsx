import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, StickyNote, CheckSquare, Lightbulb, Download, Plus, Code2, ShieldCheck, Cpu, MemoryStick, Clock, Send } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Progress } from '@/components/ui'
import { invoke } from '@/lib/api'
import { formatBytes, formatDuration, relTime } from '@/lib/utils'
import { DEVELOPER } from '@shared/types'

export default function Dashboard() {
  const { t } = useTranslation()
  const { notes, tasks, projects, downloads, navigate, settings } = useApp()
  const [sys, setSys] = useState<any>(null)
  const [vaultCount, setVaultCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (!alive || document.hidden) return
      invoke('app:system').then((s) => { if (alive) setSys(s) }).catch(() => {})
    }
    load()
    const i = setInterval(load, 15000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    invoke<boolean>('vault:isUnlocked').then((u) => { if (u && alive) invoke<any[]>('vault:list').then((l) => setVaultCount(l.length)).catch(() => {}) }).catch(() => {})
    return () => { alive = false; clearInterval(i); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  const openTasks = useMemo(() => tasks.filter((x) => x.status !== 'done'), [tasks])
  const upcoming = useMemo(() => [...openTasks].filter((x) => x.dueDate).sort((a, b) => a.dueDate! - b.dueDate!).slice(0, 6), [openTasks])
  const recentNotes = useMemo(() => [...notes].filter((n) => !n.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [notes])
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active' || p.status === 'planning').slice(0, 5), [projects])
  const activeDl = useMemo(() => downloads.filter((d) => d.status === 'downloading' || d.status === 'queued'), [downloads])
  const hour = new Date().getHours()
  const stats = [
    { label: t('dashboard.notesCount'), value: notes.length, icon: <StickyNote size={20} />, page: 'notes' as const, color: 'from-violet-500 to-fuchsia-500' },
    { label: t('dashboard.tasksCount'), value: openTasks.length, icon: <CheckSquare size={20} />, page: 'tasks' as const, color: 'from-emerald-500 to-teal-500' },
    { label: t('dashboard.projectsCount'), value: projects.length, icon: <Lightbulb size={20} />, page: 'projects' as const, color: 'from-amber-500 to-orange-500' },
    { label: t('dashboard.vaultCount'), value: vaultCount ?? '🔒', icon: <ShieldCheck size={20} />, page: 'vault' as const, color: 'from-sky-500 to-blue-600' },
  ]
  const quick = [
    { l: t('dashboard.newNote'), i: <StickyNote size={18} />, go: () => navigate('notes', { create: true }) },
    { l: t('dashboard.newTask'), i: <CheckSquare size={18} />, go: () => navigate('tasks', { create: true }) },
    { l: t('dashboard.newProject'), i: <Lightbulb size={18} />, go: () => navigate('projects', { create: true }) },
    { l: t('dashboard.newDownload'), i: <Download size={18} />, go: () => navigate('downloads', { focus: true }) },
    { l: t('dashboard.openEditor'), i: <Code2 size={18} />, go: () => navigate('editor') },
    { l: t('dashboard.openVault'), i: <ShieldCheck size={18} />, go: () => navigate('vault') },
  ]
  return (
    <div className="page-enter">
      <PageHeader icon={<LayoutDashboard size={22} />} title={`${t('dashboard.welcome')} ${hour < 12 ? '☀️' : hour < 18 ? '🌤️' : '🌙'}`} subtitle={t('dashboard.subtitle')}>
        <button className="btn-soft" onClick={() => invoke('app:openTelegram')}><Send size={15} /> {DEVELOPER}</button>
      </PageHeader>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 stagger">
        {stats.map((s) => (
          <button key={s.label} onClick={() => navigate(s.page)} className="card p-5 text-start relative overflow-hidden group hover:-translate-y-1 transition-all duration-500">
            <div className={`absolute -end-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${s.color} opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-700 [contain:paint]`} />
            <div className={`inline-flex p-2.5 rounded-xl bg-gradient-to-br ${s.color} text-white shadow-lg`}>{s.icon}</div>
            <p className="mt-4 text-3xl font-black">{s.value}</p>
            <p className="text-xs text-surface-600">{s.label}</p>
          </button>
        ))}
      </div>

      <section className="card p-5 mt-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus size={16} className="text-accent" />{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 stagger">
          {quick.map((q) => <button key={q.l} onClick={q.go} className="btn-soft flex-col py-4 gap-2 h-auto text-xs"><span className="text-accent">{q.i}</span>{q.l}</button>)}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-4 mt-4 stagger">
        <section className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><StickyNote size={16} className="text-accent" />{t('dashboard.recentNotes')}</h2>
          <div className="space-y-2">
            {recentNotes.length === 0 && (
              <div className="text-center py-2">
                <p className="text-sm text-surface-500">{t('common.empty')}</p>
                <button className="btn-soft mt-2 text-xs" onClick={() => navigate('notes', { create: true })}>{t('dashboard.newNote')}</button>
              </div>
            )}
            {recentNotes.map((n) => (
              <button key={n.id} onClick={() => navigate('notes', { open: n.id })} className="w-full text-start rounded-xl p-3 hover:bg-surface-200 transition-colors flex gap-3 items-start">
                <span className="mt-1 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: n.color }} />
                <div className="min-w-0"><p className="text-sm font-medium truncate">{n.title || t('common.untitled')}</p><p className="text-[11px] text-surface-500">{relTime(n.updatedAt, settings.language)}</p></div>
              </button>
            ))}
          </div>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><CheckSquare size={16} className="text-accent" />{t('dashboard.upcomingTasks')}</h2>
          <div className="space-y-2">
            {upcoming.length === 0 && (
              <div className="text-center py-2">
                <p className="text-sm text-surface-500">{t('common.empty')}</p>
                <button className="btn-soft mt-2 text-xs" onClick={() => navigate('tasks', { create: true })}>{t('dashboard.newTask')}</button>
              </div>
            )}
            {upcoming.map((x) => {
              const overdue = x.dueDate! < Date.now()
              return (
                <button key={x.id} onClick={() => navigate('tasks', { open: x.id })} className="w-full text-start rounded-xl p-3 hover:bg-surface-200 transition-colors">
                  <p className="text-sm font-medium truncate">{x.title}</p>
                  <p className={`text-[11px] ${overdue ? 'text-rose-500' : 'text-surface-500'}`}>{relTime(x.dueDate!, settings.language)} • {t(`tasks.priority.${x.priority}`)}</p>
                </button>
              )
            })}
          </div>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Lightbulb size={16} className="text-accent" />{t('dashboard.activeProjects')}</h2>
          <div className="space-y-3">
            {activeProjects.length === 0 && (
              <div className="text-center py-2">
                <p className="text-sm text-surface-500">{t('common.empty')}</p>
                <button className="btn-soft mt-2 text-xs" onClick={() => navigate('projects', { create: true })}>{t('dashboard.newProject')}</button>
              </div>
            )}
            {activeProjects.map((p) => (
              <button key={p.id} onClick={() => navigate('projects', { open: p.id })} className="w-full text-start rounded-xl p-3 hover:bg-surface-200 transition-colors">
                <div className="flex justify-between text-sm mb-1.5"><span className="font-medium truncate">{p.name}</span><span className="text-surface-500 text-xs">{p.progress}%</span></div>
                <Progress value={p.progress} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4 stagger">
        {activeDl.length > 0 && (
          <section className="card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Download size={16} className="text-accent" />{t('dashboard.activeDownloads')}
              <button className="ms-auto text-xs text-accent hover:underline" onClick={() => navigate('downloads')}>{t('dashboard.viewAll')}</button>
            </h2>
            {activeDl.slice(0, 4).map((d) => (
              <div key={d.id} className="mb-3">
                <div className="flex justify-between text-xs mb-1"><span className="truncate">{d.filename || d.url}</span><span className="text-surface-500">{formatBytes(d.speed)}/s</span></div>
                <Progress value={d.size ? (d.received / d.size) * 100 : 0} />
              </div>
            ))}
          </section>
        )}
        {sys && (
          <section className="card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Cpu size={16} className="text-accent" />{t('dashboard.system')}</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-surface-200/60 p-3"><Cpu size={18} className="mx-auto text-accent" /><p className="text-xs mt-1 text-surface-600">{t('dashboard.cpu')}</p><p className="text-sm font-semibold">{sys.cpus} {t('dashboard.cores')}</p></div>
              <div className="rounded-xl bg-surface-200/60 p-3"><MemoryStick size={18} className="mx-auto text-accent" /><p className="text-xs mt-1 text-surface-600">{t('dashboard.memory')}</p><p className="text-sm font-semibold">{formatBytes(sys.totalMem - sys.freeMem, 0)} / {formatBytes(sys.totalMem, 0)}</p></div>
              <div className="rounded-xl bg-surface-200/60 p-3"><Clock size={18} className="mx-auto text-accent" /><p className="text-xs mt-1 text-surface-600">{t('dashboard.uptime')}</p><p className="text-sm font-semibold">{formatDuration(sys.uptime)}</p></div>
            </div>
            <Progress value={((sys.totalMem - sys.freeMem) / sys.totalMem) * 100} />
            <p className="text-[11px] text-surface-500 mt-2 truncate">{sys.cpuModel} • {sys.platform} {sys.release} {sys.arch}</p>
          </section>
        )}
      </div>
    </div>
  )
}

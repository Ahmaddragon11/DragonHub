import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, Plus, Trash2, CheckCircle2, Circle, X, Calendar, LayoutGrid, List, AlertCircle, Search } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty, Modal, TagInput, Field } from '@/components/ui'
import { uid, cn, relTime } from '@/lib/utils'
import { invoke } from '@/lib/api'
import type { Task, TaskStatus, TaskPriority } from '@shared/types'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']
const PRIOS: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const PRIO_COLOR: Record<TaskPriority, string> = { low: 'bg-sky-500/15 text-sky-500', medium: 'bg-amber-500/15 text-amber-500', high: 'bg-orange-500/15 text-orange-500', urgent: 'bg-rose-500/15 text-rose-500' }
const PRIO_DOT: Record<TaskPriority, string> = { low: 'bg-sky-500', medium: 'bg-amber-500', high: 'bg-orange-500', urgent: 'bg-rose-500' }

/** Convert timestamp -> datetime-local string using the date's own offset (DST-safe). */
function toLocalInput(ts: number): string {
  const d = new Date(ts)
  return new Date(ts - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const TaskCard = React.memo(function TaskCard({ k, projectName, lang, onOpen, onToggle }: {
  k: Task; projectName?: string; lang: string; onOpen: (k: Task) => void; onToggle: (id: string) => void
}) {
  const late = k.status !== 'done' && k.dueDate && k.dueDate < Date.now()
  const subDone = k.subtasks.filter((s) => s.done).length
  const { t } = useTranslation()
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', k.id)} onClick={() => onOpen(k)} onKeyDown={(e) => { if ((e.target as HTMLElement).closest?.('button, input, select, textarea, a')) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(k) } }} role="button" tabIndex={0} aria-label={k.title} title={t('tasks.dragHint')} className={cn('card p-3 cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-glow transition-all duration-400', k.status === 'done' && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <button onClick={(e) => { e.stopPropagation(); onToggle(k.id) }} className="mt-0.5 shrink-0" aria-label={t('common.done')}>{k.status === 'done' ? <CheckCircle2 size={17} className="text-emerald-500" /> : <Circle size={17} className="text-surface-500 hover:text-accent" />}</button>
        <div className="flex-1 min-w-0"><p className={cn('text-sm font-medium', k.status === 'done' && 'line-through')}>{k.title}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <span className={cn('badge', PRIO_COLOR[k.priority])}>{t(`tasks.priority.${k.priority}`)}</span>
            {k.dueDate && <span className={cn('badge', late ? 'bg-rose-500/15 text-rose-500' : 'bg-surface-200 text-surface-700')}><Calendar size={10} />{relTime(k.dueDate, lang)}</span>}
            {k.subtasks.length > 0 && <span className="badge bg-surface-200 text-surface-700">{subDone}/{k.subtasks.length}</span>}
            {projectName && <span className="badge bg-accent/15 text-accent truncate max-w-[100px]">{projectName}</span>}
          </div>
        </div>
      </div>
    </div>
  )
})

export default function Tasks() {
  const { t } = useTranslation()
  const { tasks, saveTasks, projects, pageParams, consumeParams, toast, settings } = useApp()
  const [edit, setEdit] = useState<Task | null>(null)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [showDone, setShowDone] = useState(true)
  const [quick, setQuick] = useState('')
  const [sub, setSub] = useState('')
  const [q, setQ] = useState('')
  const [prio, setPrio] = useState<'all' | TaskPriority>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const blank = useCallback((title = ''): Task => {
    const list = useApp.getState().tasks
    const maxOrder = list.reduce((m, k) => Math.max(m, Number(k.order) || 0), 0)
    return { id: uid(), title, description: '', status: 'todo', priority: 'medium', tags: [], subtasks: [], createdAt: Date.now(), updatedAt: Date.now(), order: maxOrder + 1 }
  }, [])

  // Consume navigation params exactly once: opening from Dashboard/palette/reminders
  // must not overwrite an in-progress draft, and must retry `open` once tasks load.
  const consumedParams = useRef<string | null>(null)
  useEffect(() => {
    if (!pageParams.create && !pageParams.open) return
    const key = JSON.stringify(pageParams)
    if (consumedParams.current === key) return
    if (pageParams.open) {
      const x = tasks.find((k) => k.id === pageParams.open)
      if (!x) return // tasks not loaded yet — retry when they arrive
      if (!edit) setEdit(x)
      consumedParams.current = key
      consumeParams()
      return
    }
    if (pageParams.create) {
      if (!edit) setEdit(blank())
      consumedParams.current = key
      consumeParams()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParams, tasks])

  const save = () => {
    if (!edit || !edit.title.trim()) return
    const list = useApp.getState().tasks
    const x = { ...edit, title: edit.title.trim(), updatedAt: Date.now(), completedAt: edit.status === 'done' ? edit.completedAt || Date.now() : undefined }
    saveTasks(list.some((k) => k.id === x.id) ? list.map((k) => (k.id === x.id ? x : k)) : [...list, x]); setEdit(null); toast(t('toast.saved'))
  }
  const remove = async (id: string) => {
    if (settings.confirmDelete && !(await invoke('dialog:confirm', t('common.confirmDelete')))) return
    const list = useApp.getState().tasks
    saveTasks(list.filter((k) => k.id !== id)); setEdit(null); toast(t('toast.deleted'), 'info')
  }
  const move = useCallback((id: string, status: TaskStatus) => {
    const list = useApp.getState().tasks
    const k = list.find((x) => x.id === id)
    if (!k) return
    // Recurring tasks: complete THIS occurrence, then spawn the NEXT one as a
    // fresh task so history (completedAt, subtask state) is never lost.
    if (status === 'done' && k.recurring && k.dueDate) {
      const d = new Date(k.dueDate)
      if (k.recurring === 'daily') d.setDate(d.getDate() + 1)
      if (k.recurring === 'weekly') d.setDate(d.getDate() + 7)
      if (k.recurring === 'monthly') {
        // Clamp to end of target month (Jan 31 -> Feb 28, not Mar 3).
        const day = d.getDate()
        d.setDate(1)
        d.setMonth(d.getMonth() + 1)
        d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
      }
      const nextOccurrence: Task = {
        ...k, id: uid(), status: 'todo', dueDate: d.getTime(),
        reminderAt: k.reminderAt ? k.reminderAt + (d.getTime() - k.dueDate) : undefined,
        subtasks: k.subtasks.map((s) => ({ ...s, id: uid(), done: false })),
        createdAt: Date.now(), updatedAt: Date.now(), completedAt: undefined,
      }
      useApp.getState().saveTasks(list.map((x) => (x.id === id ? { ...x, status, updatedAt: Date.now(), completedAt: Date.now() } : x)).concat(nextOccurrence))
      useApp.getState().toast(t('toast.saved'))
      return
    }
    useApp.getState().saveTasks(list.map((x) => (x.id === id ? { ...x, status, updatedAt: Date.now(), completedAt: status === 'done' ? Date.now() : undefined } : x)))
  }, [t])
  const toggle = useCallback((id: string) => {
    const k = useApp.getState().tasks.find((x) => x.id === id)
    if (k) move(id, k.status === 'done' ? 'todo' : 'done')
  }, [move])
  const openCard = useCallback((k: Task) => setEdit(k), [])

  const projectNameOf = useCallback((id?: string) => projects.find((p) => p.id === id)?.name, [projects])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.filter((k) => {
      if (!showDone && k.status === 'done') return false
      if (prio !== 'all' && k.priority !== prio) return false
      if (overdueOnly && !(k.status !== 'done' && k.dueDate && k.dueDate < Date.now())) return false
      if (needle && !((k.title + ' ' + (k.description || '') + ' ' + k.tags.join(' ')).toLowerCase().includes(needle))) return false
      return true
    })
  }, [tasks, q, prio, overdueOnly, showDone])
  const grouped = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, filtered.filter((k) => k.status === s).sort((a, b) => PRIOS.indexOf(b.priority) - PRIOS.indexOf(a.priority) || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))])), [filtered])
  const listSorted = useMemo(() => [...filtered].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)), [filtered])
  const overdue = useMemo(() => tasks.filter((k) => k.status !== 'done' && k.dueDate && k.dueDate < Date.now()).length, [tasks])
  const openCount = useMemo(() => tasks.filter((k) => k.status !== 'done').length, [tasks])

  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<CheckSquare size={22} />} title={t('tasks.title')} subtitle={`${openCount} ${t('dashboard.tasksCount').toLowerCase()}${overdue ? ` • ${overdue} ${t('tasks.overdue').toLowerCase()}` : ''}`}>
        <div className="flex rounded-lg bg-surface-200 p-0.5"><button onClick={() => setView('kanban')} className={cn('p-1.5 rounded-md', view === 'kanban' && 'bg-accent text-accent-fg')} title={t('tasks.kanban')} aria-label={t('tasks.kanban')} aria-pressed={view === 'kanban'}><LayoutGrid size={15} /></button><button onClick={() => setView('list')} className={cn('p-1.5 rounded-md', view === 'list' && 'bg-accent text-accent-fg')} title={t('tasks.listView')} aria-label={t('tasks.listView')} aria-pressed={view === 'list'}><List size={15} /></button></div>
        <button className="btn-primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('tasks.newTask')}</button>
      </PageHeader>
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) { saveTasks([...tasks, blank(quick.trim())]); setQuick(''); toast(t('toast.created')) } }}>
        <input className="input flex-1 min-w-0" placeholder={`${t('tasks.newTask')}… (Enter)`} value={quick} onChange={(e) => setQuick(e.target.value)} /><button className="btn-soft shrink-0" type="submit" aria-label={t('common.add')}><Plus size={16} /></button>
      </form>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px]"><Search size={14} className="absolute start-3 top-2.5 text-surface-500" /><input className="input ps-9 py-1.5 text-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="select w-auto py-1.5 text-xs" value={prio} onChange={(e) => setPrio(e.target.value as any)} aria-label={t('common.priority')}>
          <option value="all">{t('common.all')}</option>{PRIOS.map((p) => <option key={p} value={p}>{t(`tasks.priority.${p}`)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-surface-600 cursor-pointer"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="accent-[rgb(var(--accent))]" />{t('tasks.overdue')}</label>
        <label className="flex items-center gap-1.5 text-xs text-surface-600 cursor-pointer"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-[rgb(var(--accent))]" />{t('tasks.showCompleted')}</label>
      </div>
      {tasks.length === 0 ? <Empty icon={<CheckSquare size={40} />} text={t('common.empty')} action={<button className="btn-primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('tasks.newTask')}</button>} /> : view === 'kanban' ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 overflow-auto pb-1">
          {STATUSES.map((s) => (
            <div key={s} className="flex flex-col rounded-2xl bg-surface-100/50 border border-surface-300/40 min-h-0 min-w-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s) }}>
              <div className="flex items-center gap-2 p-3 text-sm font-semibold">{t(`tasks.status.${s}`)}<span className="ms-auto badge bg-surface-200 text-surface-700">{grouped[s].length}</span></div>
              <div className="flex-1 overflow-auto p-2 space-y-2">{grouped[s].map((k) => <TaskCard key={k.id} k={k} projectName={projectNameOf(k.projectId)} lang={settings.language} onOpen={openCard} onToggle={toggle} />)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto space-y-2">
          {listSorted.length === 0 && (
            <div className="text-center p-6">
              <p className="text-xs text-surface-500">{t('common.noResults')}</p>
              <button className="btn-soft mt-2 text-xs" onClick={() => { setQ(''); setPrio('all'); setOverdueOnly(false); setShowDone(true) }}>{t('common.clear')}</button>
            </div>
          )}
          {listSorted.map((k) => <TaskCard key={k.id} k={k} projectName={projectNameOf(k.projectId)} lang={settings.language} onOpen={openCard} onToggle={toggle} />)}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit && tasks.some((x) => x.id === edit.id) ? t('common.edit') : t('tasks.newTask')} wide>
        {edit && (
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <Field label={t('common.title')}><input autoFocus className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
              <Field label={t('common.description')}><textarea className="input min-h-[90px]" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('common.status')}><select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as TaskStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{t(`tasks.status.${s}`)}</option>)}</select></Field>
                <Field label={t('common.priority')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', PRIO_DOT[edit.priority])} />
                    <select className="select flex-1 min-w-0" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value as TaskPriority })}>{PRIOS.map((p) => <option key={p} value={p}>{t(`tasks.priority.${p}`)}</option>)}</select>
                  </div>
                </Field>
                <Field label={t('common.dueDate')}><input type="datetime-local" className="input" value={edit.dueDate ? toLocalInput(edit.dueDate) : ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
                <Field label={t('tasks.recurring')}><select className="select" value={edit.recurring || ''} onChange={(e) => setEdit({ ...edit, recurring: (e.target.value || undefined) as any })}><option value="">{t('tasks.none')}</option><option value="daily">{t('tasks.daily')}</option><option value="weekly">{t('tasks.weekly')}</option><option value="monthly">{t('tasks.monthly')}</option></select></Field>
                <Field label={t('tasks.reminder')} className="col-span-2"><input type="datetime-local" className="input" value={edit.reminderAt ? toLocalInput(edit.reminderAt) : ''} onChange={(e) => setEdit({ ...edit, reminderAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
              </div>
              <Field label={t('tasks.project')}><select className="select" value={edit.projectId || ''} onChange={(e) => setEdit({ ...edit, projectId: e.target.value || undefined })}><option value="">{t('tasks.noProject')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label={t('common.tags')}><TagInput tags={edit.tags} onChange={(tags) => setEdit({ ...edit, tags })} /></Field>
            </div>
            <div><span className="label">{t('tasks.subtasks')}</span>
              <div className="space-y-1 mt-1.5 max-h-44 overflow-y-auto">{edit.subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-surface-200/60 px-2 py-1.5 text-sm">
                  <button className="shrink-0" title={t('common.done')} aria-label={t('common.done')} onClick={() => setEdit({ ...edit, subtasks: edit.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}>{s.done ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-surface-500" />}</button>
                  <span className={cn('flex-1 min-w-0 break-words', s.done && 'line-through text-surface-500')}>{s.title}</span><button className="shrink-0" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setEdit({ ...edit, subtasks: edit.subtasks.filter((x) => x.id !== s.id) })}><X size={13} /></button>
                </div>))}
                <input className="input" placeholder={t('tasks.addSubtask')} value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { e.preventDefault(); setEdit({ ...edit, subtasks: [...edit.subtasks, { id: uid(), title: sub.trim(), done: false }] }); setSub('') } }} />
              </div>
              {edit.dueDate && edit.dueDate < Date.now() && edit.status !== 'done' && <p className="flex items-center gap-1 text-xs text-rose-500 mt-3"><AlertCircle size={13} />{t('tasks.overdue')}</p>}
            </div>
            <div className="md:col-span-2 flex justify-between gap-2 flex-wrap pt-2">
              {tasks.some((x) => x.id === edit.id) ? <button className="btn-danger" onClick={() => remove(edit.id)}><Trash2 size={15} />{t('common.delete')}</button> : <span />}
              <div className="flex gap-2"><button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button className="btn-primary" onClick={save} disabled={!edit.title.trim()}>{t('common.save')}</button></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

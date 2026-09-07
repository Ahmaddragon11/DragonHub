import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, Plus, Trash2, CheckCircle2, Circle, X, Calendar, LayoutGrid, List, AlertCircle } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty, Modal, TagInput, Field } from '@/components/ui'
import { uid, cn, relTime } from '@/lib/utils'
import { invoke } from '@/lib/api'
import type { Task, TaskStatus, TaskPriority } from '@shared/types'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']
const PRIOS: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const PRIO_COLOR: Record<TaskPriority, string> = { low: 'bg-sky-500/15 text-sky-500', medium: 'bg-amber-500/15 text-amber-500', high: 'bg-orange-500/15 text-orange-500', urgent: 'bg-rose-500/15 text-rose-500' }

export default function Tasks() {
  const { t } = useTranslation()
  const { tasks, saveTasks, projects, pageParams, toast, settings } = useApp()
  const [edit, setEdit] = useState<Task | null>(null)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [showDone, setShowDone] = useState(true)
  const [quick, setQuick] = useState('')
  const [sub, setSub] = useState('')

  const blank = (title = ''): Task => ({ id: uid(), title, description: '', status: 'todo', priority: 'medium', tags: [], subtasks: [], createdAt: Date.now(), updatedAt: Date.now(), order: tasks.length })
  useEffect(() => { if (pageParams.create) setEdit(blank()); if (pageParams.open) { const x = tasks.find((k) => k.id === pageParams.open); if (x) setEdit(x) } }, [pageParams])

  const save = () => {
    if (!edit || !edit.title.trim()) return
    const x = { ...edit, updatedAt: Date.now(), completedAt: edit.status === 'done' ? edit.completedAt || Date.now() : undefined }
    saveTasks(tasks.some((k) => k.id === x.id) ? tasks.map((k) => (k.id === x.id ? x : k)) : [...tasks, x]); setEdit(null); toast(t('toast.saved'))
  }
  const remove = async (id: string) => {
    if (settings.confirmDelete && !(await invoke('dialog:confirm', t('common.confirmDelete')))) return
    saveTasks(tasks.filter((k) => k.id !== id)); setEdit(null); toast(t('toast.deleted'), 'info')
  }
  const move = (id: string, status: TaskStatus) => {
    const k = tasks.find((x) => x.id === id)
    if (!k) return
    // Recurring tasks: complete THIS occurrence, then spawn the NEXT one as a
    // fresh task so history (completedAt, subtask state) is never lost.
    if (status === 'done' && k.recurring && k.dueDate) {
      const d = new Date(k.dueDate)
      if (k.recurring === 'daily') d.setDate(d.getDate() + 1)
      if (k.recurring === 'weekly') d.setDate(d.getDate() + 7)
      if (k.recurring === 'monthly') d.setMonth(d.getMonth() + 1)
      const nextOccurrence: Task = {
        ...k, id: uid(), status: 'todo', dueDate: d.getTime(),
        reminderAt: k.reminderAt ? k.reminderAt + (d.getTime() - k.dueDate) : undefined,
        subtasks: k.subtasks.map((s) => ({ ...s, id: uid(), done: false })),
        createdAt: Date.now(), updatedAt: Date.now(), completedAt: undefined,
      }
      saveTasks(tasks.map((x) => (x.id === id ? { ...x, status, updatedAt: Date.now(), completedAt: Date.now() } : x)).concat(nextOccurrence))
      toast(t('toast.saved'))
      return
    }
    saveTasks(tasks.map((x) => (x.id === id ? { ...x, status, updatedAt: Date.now(), completedAt: status === 'done' ? Date.now() : undefined } : x)))
  }
  const toggle = (id: string) => { const k = tasks.find((x) => x.id === id); if (k) move(id, k.status === 'done' ? 'todo' : 'done') }
  const grouped = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, tasks.filter((k) => k.status === s).sort((a, b) => PRIOS.indexOf(b.priority) - PRIOS.indexOf(a.priority) || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))])), [tasks])
  const overdue = tasks.filter((k) => k.status !== 'done' && k.dueDate && k.dueDate < Date.now()).length

  const Card = ({ k }: { k: Task }) => {
    const late = k.status !== 'done' && k.dueDate && k.dueDate < Date.now()
    const subDone = k.subtasks.filter((s) => s.done).length
    return (
      <div draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', k.id)} onClick={() => setEdit(k)} className={cn('card p-3 cursor-pointer hover:-translate-y-0.5 hover:shadow-glow transition-all duration-400', k.status === 'done' && 'opacity-60')}>
        <div className="flex items-start gap-2">
          <button onClick={(e) => { e.stopPropagation(); toggle(k.id) }} className="mt-0.5 shrink-0">{k.status === 'done' ? <CheckCircle2 size={17} className="text-emerald-500" /> : <Circle size={17} className="text-surface-500 hover:text-accent" />}</button>
          <div className="flex-1 min-w-0"><p className={cn('text-sm font-medium', k.status === 'done' && 'line-through')}>{k.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className={cn('badge', PRIO_COLOR[k.priority])}>{t(`tasks.priority.${k.priority}`)}</span>
              {k.dueDate && <span className={cn('badge', late ? 'bg-rose-500/15 text-rose-500' : 'bg-surface-200 text-surface-700')}><Calendar size={10} />{relTime(k.dueDate, settings.language)}</span>}
              {k.subtasks.length > 0 && <span className="badge bg-surface-200 text-surface-700">{subDone}/{k.subtasks.length}</span>}
              {k.projectId && <span className="badge bg-accent/15 text-accent truncate max-w-[100px]">{projects.find((p) => p.id === k.projectId)?.name}</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<CheckSquare size={22} />} title={t('tasks.title')} subtitle={`${tasks.filter((k) => k.status !== 'done').length} ${t('dashboard.tasksCount').toLowerCase()}${overdue ? ` • ${overdue} ${t('tasks.overdue').toLowerCase()}` : ''}`}>
        <div className="flex rounded-lg bg-surface-200 p-0.5"><button onClick={() => setView('kanban')} className={cn('p-1.5 rounded-md', view === 'kanban' && 'bg-accent text-accent-fg')}><LayoutGrid size={15} /></button><button onClick={() => setView('list')} className={cn('p-1.5 rounded-md', view === 'list' && 'bg-accent text-accent-fg')}><List size={15} /></button></div>
        <button className="btn-primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('tasks.newTask')}</button>
      </PageHeader>
      <form className="flex gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) { saveTasks([...tasks, blank(quick.trim())]); setQuick(''); toast(t('toast.created')) } }}>
        <input className="input" placeholder={`${t('tasks.newTask')}… (Enter)`} value={quick} onChange={(e) => setQuick(e.target.value)} /><button className="btn-soft shrink-0" type="submit"><Plus size={16} /></button>
      </form>
      {tasks.length === 0 ? <Empty icon={<CheckSquare size={40} />} text={t('common.empty')} /> : view === 'kanban' ? (
        <div className="flex-1 min-h-0 grid grid-cols-4 gap-3 stagger overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <div key={s} className="flex flex-col rounded-2xl bg-surface-100/50 border border-surface-300/40 min-h-0 min-w-[220px]" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); move(e.dataTransfer.getData('text/plain'), s) }}>
              <div className="flex items-center gap-2 p-3 text-sm font-semibold">{t(`tasks.status.${s}`)}<span className="ms-auto badge bg-surface-200 text-surface-700">{grouped[s].length}</span></div>
              <div className="flex-1 overflow-auto p-2 space-y-2">{grouped[s].map((k) => <Card key={k.id} k={k} />)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto space-y-2 stagger">
          <label className="flex items-center gap-2 text-xs text-surface-600 px-1"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-[rgb(var(--accent))]" />{t('tasks.showCompleted')}</label>
          {[...tasks].filter((k) => showDone || k.status !== 'done').sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)).map((k) => <Card key={k.id} k={k} />)}
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
                <Field label={t('common.priority')}><select className="select" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value as TaskPriority })}>{PRIOS.map((p) => <option key={p} value={p}>{t(`tasks.priority.${p}`)}</option>)}</select></Field>
                <Field label={t('common.dueDate')}><input type="datetime-local" className="input" value={edit.dueDate ? new Date(edit.dueDate - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
                <Field label={t('tasks.recurring')}><select className="select" value={edit.recurring || ''} onChange={(e) => setEdit({ ...edit, recurring: (e.target.value || undefined) as any })}><option value="">{t('tasks.none')}</option><option value="daily">{t('tasks.daily')}</option><option value="weekly">{t('tasks.weekly')}</option><option value="monthly">{t('tasks.monthly')}</option></select></Field>
                <Field label={t('tasks.reminder')}><input type="datetime-local" className="input col-span-2" value={edit.reminderAt ? new Date(edit.reminderAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => setEdit({ ...edit, reminderAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
              </div>
              <Field label={t('tasks.project')}><select className="select" value={edit.projectId || ''} onChange={(e) => setEdit({ ...edit, projectId: e.target.value || undefined })}><option value="">{t('tasks.noProject')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label={t('common.tags')}><TagInput tags={edit.tags} onChange={(tags) => setEdit({ ...edit, tags })} /></Field>
            </div>
            <div><span className="label">{t('tasks.subtasks')}</span>
              <div className="space-y-1 mt-1.5">{edit.subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-surface-200/60 px-2 py-1.5 text-sm">
                  <button onClick={() => setEdit({ ...edit, subtasks: edit.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}>{s.done ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-surface-500" />}</button>
                  <span className={cn('flex-1', s.done && 'line-through text-surface-500')}>{s.title}</span><button onClick={() => setEdit({ ...edit, subtasks: edit.subtasks.filter((x) => x.id !== s.id) })}><X size={13} /></button>
                </div>))}
                <input className="input" placeholder={t('tasks.addSubtask')} value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { e.preventDefault(); setEdit({ ...edit, subtasks: [...edit.subtasks, { id: uid(), title: sub.trim(), done: false }] }); setSub('') } }} />
              </div>
              {edit.dueDate && edit.dueDate < Date.now() && edit.status !== 'done' && <p className="flex items-center gap-1 text-xs text-rose-500 mt-3"><AlertCircle size={13} />{t('tasks.overdue')}</p>}
            </div>
            <div className="md:col-span-2 flex justify-between pt-2">
              {tasks.some((x) => x.id === edit.id) ? <button className="btn-danger" onClick={() => remove(edit.id)}><Trash2 size={15} />{t('common.delete')}</button> : <span />}
              <div className="flex gap-2"><button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button className="btn-primary" onClick={save} disabled={!edit.title.trim()}>{t('common.save')}</button></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

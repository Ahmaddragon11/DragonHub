import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { CheckSquare, Plus, Trash2, Check, X, Calendar, LayoutGrid, List, AlertCircle, Search, Repeat, Flag, Hash, Sparkles, ListChecks } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty, Modal, TagInput, Field, Segmented, Tooltip } from '@/components/ui'
import { uid, cn, relTime } from '@/lib/utils'
import { moveTask, parseQuickAdd, isOverdue, PRIORITIES } from '@/lib/tasks'
import { deleteWithUndo } from '@/lib/undo'
import { spring, useMotionPrefs } from '@/lib/motion'
import type { Task, TaskStatus, TaskPriority } from '@shared/types'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']
const PRIO_TONE: Record<TaskPriority, string> = { low: 'text-sky-500 bg-sky-500/12', medium: 'text-amber-500 bg-amber-500/12', high: 'text-orange-500 bg-orange-500/12', urgent: 'text-rose-500 bg-rose-500/12' }
const PRIO_DOT: Record<TaskPriority, string> = { low: 'bg-sky-500', medium: 'bg-amber-500', high: 'bg-orange-500', urgent: 'bg-rose-500' }
const STATUS_DOT: Record<TaskStatus, string> = { todo: 'bg-surface-500', in_progress: 'bg-sky-500', review: 'bg-violet-500', done: 'bg-emerald-500' }

/** Convert timestamp -> datetime-local string using the date's own offset (DST-safe). */
function toLocalInput(ts: number): string {
  const d = new Date(ts)
  return new Date(ts - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** Animated completion checkbox: stroke draws in, ring pops. */
function CheckButton({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle() }} aria-label={label} aria-pressed={done}
      className={cn('relative mt-[1px] grid place-items-center h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] transition-colors duration-200',
        done ? 'bg-emerald-500 border-emerald-500' : 'border-surface-400 hover:border-accent hover:bg-accent/10')}>
      <AnimatePresence initial={false}>
        {done && (
          <motion.svg key="c" viewBox="0 0 24 24" className="h-3 w-3 text-white" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.snappy}>
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }} />
          </motion.svg>
        )}
      </AnimatePresence>
    </button>
  )
}

const TaskCard = React.memo(React.forwardRef<HTMLDivElement, {
  k: Task; projectName?: string; lang: string; onOpen: (k: Task) => void; onToggle: (id: string) => void; dense?: boolean
}>(function TaskCard({ k, projectName, lang, onOpen, onToggle, dense }, ref) {
  const late = isOverdue(k)
  const subDone = k.subtasks.filter((s) => s.done).length
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const [dragging, setDragging] = useState(false)
  return (
    <motion.div ref={ref} layout={reduced ? false : 'position'} layoutId={reduced ? undefined : `task-${k.id}`} transition={spring.layout}
      initial={false} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
      draggable onDragStartCapture={(e: React.DragEvent) => { e.dataTransfer.setData('text/plain', k.id); e.dataTransfer.effectAllowed = 'move'; setDragging(true) }} onDragEndCapture={() => setDragging(false)}
      onClick={() => onOpen(k)} onKeyDown={(e) => { if ((e.target as HTMLElement).closest?.('button, input, select, textarea, a')) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(k) } }}
      role="button" tabIndex={0} aria-label={k.title}
      className={cn('group card card-interactive p-3 cursor-grab active:cursor-grabbing', k.status === 'done' && 'opacity-60', dragging && 'opacity-40 ring-2 ring-accent/40')}>
      <div className="flex items-start gap-2.5">
        <CheckButton done={k.status === 'done'} onToggle={() => onToggle(k.id)} label={t('common.done')} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-[13.5px] font-medium leading-snug break-words transition-colors', k.status === 'done' && 'line-through text-surface-500')}>{k.title}</p>
          {!dense && k.description && <p className="text-xs text-surface-500 line-clamp-1 mt-0.5">{k.description}</p>}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className={cn('badge', PRIO_TONE[k.priority])}><Flag size={10} />{t(`tasks.priority.${k.priority}`)}</span>
            {k.dueDate && <span className={cn('badge', late ? 'bg-rose-500/12 text-rose-500' : 'bg-surface-200 text-surface-600')}><Calendar size={10} />{relTime(k.dueDate, lang)}</span>}
            {k.recurring && <span className="badge bg-surface-200 text-surface-600" title={t(`tasks.${k.recurring}`)}><Repeat size={10} /></span>}
            {k.subtasks.length > 0 && <span className={cn('badge', subDone === k.subtasks.length ? 'bg-emerald-500/12 text-emerald-500' : 'bg-surface-200 text-surface-600')}><ListChecks size={10} />{subDone}/{k.subtasks.length}</span>}
            {projectName && <span className="badge bg-accent/12 text-accent truncate max-w-[120px]">{projectName}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  )
}))

export default function Tasks() {
  const { t } = useTranslation()
  const { tasks, saveTasks, projects, pageParams, consumeParams, toast, lang, touchRecent } = useApp(useShallow((s) => ({
    tasks: s.tasks, saveTasks: s.saveTasks, projects: s.projects, pageParams: s.pageParams, consumeParams: s.consumeParams, toast: s.toast, lang: s.settings.language, touchRecent: s.touchRecent,
  })))
  const [edit, setEdit] = useState<Task | null>(null)
  const [view, setView] = useState<'kanban' | 'list'>(() => (localStorage.getItem('dh:tasksView') as 'kanban' | 'list') || 'kanban')
  const [showDone, setShowDone] = useState(true)
  const [quick, setQuick] = useState('')
  const [sub, setSub] = useState('')
  const [q, setQ] = useState('')
  const [prio, setPrio] = useState<'all' | TaskPriority>('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [dropCol, setDropCol] = useState<TaskStatus | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)
  useEffect(() => { try { localStorage.setItem('dh:tasksView', view) } catch { /* ignore */ } }, [view])

  const parsed = useMemo(() => parseQuickAdd(quick), [quick])

  const blank = useCallback((title = ''): Task => {
    const list = useApp.getState().tasks
    const maxOrder = list.reduce((m, k) => Math.max(m, Number(k.order) || 0), 0)
    return { id: uid(), title, description: '', status: 'todo', priority: 'medium', tags: [], subtasks: [], createdAt: Date.now(), updatedAt: Date.now(), order: maxOrder + 1 }
  }, [])

  const open = useCallback((k: Task) => { setEdit(k); touchRecent('task', k.id) }, [touchRecent])

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
      if (!edit) open(x)
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
    const exists = list.some((k) => k.id === edit.id)
    const x = { ...edit, title: edit.title.trim(), updatedAt: Date.now(), completedAt: edit.status === 'done' ? edit.completedAt || Date.now() : undefined }
    saveTasks(exists ? list.map((k) => (k.id === x.id ? x : k)) : [...list, x]); setEdit(null); toast(exists ? t('toast.saved') : t('toast.created'))
  }
  const remove = async (id: string) => { if (await deleteWithUndo('tasks', id)) setEdit(null) }
  const move = useCallback((id: string, status: TaskStatus) => {
    const st = useApp.getState()
    const { list, spawned } = moveTask(st.tasks, id, status)
    st.saveTasks(list)
    if (spawned) st.toast(t('tasks.nextOccurrence', { when: relTime(spawned.dueDate!, st.settings.language) }), 'info')
  }, [t])
  const toggle = useCallback((id: string) => {
    const k = useApp.getState().tasks.find((x) => x.id === id)
    if (k) move(id, k.status === 'done' ? 'todo' : 'done')
  }, [move])

  const quickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed.title) return
    const task = { ...blank(parsed.title), priority: parsed.priority ?? 'medium', tags: parsed.tags, dueDate: parsed.dueDate }
    saveTasks([...useApp.getState().tasks, task]); setQuick('')
    toast(t('toast.created'), 'success', { action: { label: t('common.open'), run: () => open(task) } })
  }

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.filter((k) => {
      if (!showDone && k.status === 'done') return false
      if (prio !== 'all' && k.priority !== prio) return false
      if (overdueOnly && !isOverdue(k)) return false
      if (needle && !((k.title + ' ' + (k.description || '') + ' ' + k.tags.join(' ')).toLowerCase().includes(needle))) return false
      return true
    })
  }, [tasks, q, prio, overdueOnly, showDone])
  const grouped = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, filtered.filter((k) => k.status === s).sort((a, b) => PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))])) as Record<TaskStatus, Task[]>, [filtered])
  const listSorted = useMemo(() => [...filtered].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)), [filtered])
  const overdue = useMemo(() => tasks.filter((k) => isOverdue(k)).length, [tasks])
  const openCount = useMemo(() => tasks.filter((k) => k.status !== 'done').length, [tasks])
  const filtersActive = !!q || prio !== 'all' || overdueOnly || !showDone
  const clearFilters = () => { setQ(''); setPrio('all'); setOverdueOnly(false); setShowDone(true) }
  const editExists = !!edit && tasks.some((x) => x.id === edit.id)

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={<CheckSquare />} title={t('tasks.title')} subtitle={`${t('tasks.openCount', { count: openCount })}${overdue ? ` · ${t('tasks.overdueCount', { count: overdue })}` : ''}`}>
        <Segmented value={view} onChange={setView} label={t('common.view')} options={[{ value: 'kanban', label: '', icon: <LayoutGrid size={14} />, title: t('tasks.kanban') }, { value: 'list', label: '', icon: <List size={14} />, title: t('tasks.listView') }]} />
        <button className="btn-primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('tasks.newTask')}</button>
      </PageHeader>

      {/* Smart quick-add: natural-language parsing with live token preview */}
      <form className="card mb-3 p-1.5 ps-3 flex items-center gap-2 focus-within:ring-2 focus-within:ring-accent/25 transition-shadow" onSubmit={quickAdd}>
        <Sparkles size={15} className="text-accent shrink-0" />
        <input ref={quickRef} className="flex-1 min-w-0 bg-transparent outline-none text-sm py-1.5 placeholder:text-surface-500" aria-label={t('tasks.quickAdd')}
          placeholder={t('tasks.quickAddPlaceholder')} value={quick} onChange={(e) => setQuick(e.target.value)} />
        <AnimatePresence initial={false}>
          {parsed.tokens.length > 0 && (
            <motion.div initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="hidden md:flex items-center gap-1 shrink-0">
              {parsed.priority && <span className={cn('badge', PRIO_TONE[parsed.priority])}><Flag size={10} />{t(`tasks.priority.${parsed.priority}`)}</span>}
              {parsed.dueDate && <span className="badge bg-surface-200 text-surface-700"><Calendar size={10} />{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(parsed.dueDate)}</span>}
              {parsed.tags.map((tg) => <span key={tg} className="badge bg-accent/12 text-accent"><Hash size={10} />{tg}</span>)}
            </motion.div>
          )}
        </AnimatePresence>
        <button className="btn-primary btn-sm shrink-0" type="submit" disabled={!parsed.title} aria-label={t('common.add')}><Plus size={14} /><span className="hidden sm:inline">{t('common.add')}</span></button>
      </form>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm"><Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" /><input data-search className="input ps-9 py-1.5 text-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} /></div>
        <Segmented size="sm" value={prio} onChange={setPrio} label={t('common.priority')} options={[{ value: 'all', label: t('common.all') }, ...PRIORITIES.map((p) => ({ value: p, label: t(`tasks.priority.${p}`), icon: <span className={cn('h-1.5 w-1.5 rounded-full', PRIO_DOT[p])} /> }))]} />
        <button type="button" onClick={() => setOverdueOnly((v) => !v)} aria-pressed={overdueOnly} className={cn('btn-sm btn', overdueOnly ? 'bg-rose-500/12 text-rose-500' : 'btn-ghost')}><AlertCircle size={13} />{t('tasks.overdue')}{overdue > 0 && <span className="tabular-nums opacity-70">{overdue}</span>}</button>
        <button type="button" onClick={() => setShowDone((v) => !v)} aria-pressed={showDone} className={cn('btn-sm btn', showDone ? 'btn-ghost' : 'bg-accent/12 text-accent')}><Check size={13} />{showDone ? t('tasks.hideCompleted') : t('tasks.showCompleted')}</button>
        <AnimatePresence>{filtersActive && <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="btn-sm btn-ghost text-surface-500" onClick={clearFilters}><X size={13} />{t('common.clear')}</motion.button>}</AnimatePresence>
      </div>

      {tasks.length === 0 ? (
        <Empty icon={<CheckSquare size={28} />} text={t('tasks.emptyTitle')} hint={t('tasks.emptyHint')} action={<button className="btn-primary" onClick={() => quickRef.current?.focus()}><Plus size={16} />{t('tasks.newTask')}</button>} />
      ) : view === 'kanban' ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 overflow-auto pb-1">
          {STATUSES.map((s) => (
            <section key={s} aria-label={t(`tasks.status.${s}`)}
              className={cn('flex flex-col rounded-2xl min-h-[160px] min-w-0 transition-[background-color,box-shadow] duration-150 surface-sunken', dropCol === s && 'ring-2 ring-accent/50 bg-accent/5')}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropCol !== s) setDropCol(s) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol(null) }}
              onDrop={(e) => { e.preventDefault(); setDropCol(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s) }}>
              <header className="flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] font-semibold">
                <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} />{t(`tasks.status.${s}`)}
                <span className="ms-auto text-[11px] tabular-nums font-medium text-surface-500">{grouped[s].length}</span>
                {s === 'todo' && <Tooltip label={t('tasks.newTask')}><button className="btn-icon p-1" aria-label={t('tasks.newTask')} onClick={() => setEdit(blank())}><Plus size={14} /></button></Tooltip>}
              </header>
              <div className="flex-1 overflow-auto px-2 pb-2 space-y-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {grouped[s].map((k) => <TaskCard key={k.id} k={k} projectName={k.projectId ? projectName.get(k.projectId) : undefined} lang={lang} onOpen={open} onToggle={toggle} dense />)}
                </AnimatePresence>
                {grouped[s].length === 0 && <div className="h-16 rounded-xl border border-dashed border-surface-300 grid place-items-center text-[11px] text-surface-500">{t('tasks.dropHere')}</div>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto space-y-2 max-w-4xl w-full">
          {listSorted.length === 0 && <Empty icon={<Search size={24} />} text={t('common.noResults')} action={<button className="btn-soft btn-sm" onClick={clearFilters}>{t('common.clear')}</button>} />}
          <AnimatePresence initial={false} mode="popLayout">
            {listSorted.map((k) => <TaskCard key={k.id} k={k} projectName={k.projectId ? projectName.get(k.projectId) : undefined} lang={lang} onOpen={open} onToggle={toggle} />)}
          </AnimatePresence>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={editExists ? t('tasks.editTask') : t('tasks.newTask')} wide
        footer={edit && (
          <>
            {editExists && <button className="btn-danger me-auto" onClick={() => remove(edit.id)}><Trash2 size={15} />{t('common.delete')}</button>}
            <button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={save} disabled={!edit.title.trim()}>{t('common.save')}<span className="kbd !bg-white/15 !text-inherit !border-transparent">↵</span></button>
          </>
        )}>
        {edit && (
          <div className="grid md:grid-cols-[1fr_280px] gap-6">
            <div className="space-y-4">
              <input autoFocus className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-surface-400" placeholder={t('common.title')} aria-label={t('common.title')} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
              <Field label={t('common.description')}><textarea className="input min-h-[96px] resize-y" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
              <div>
                <div className="flex items-center justify-between mb-1.5"><span className="label">{t('tasks.subtasks')}</span>{edit.subtasks.length > 0 && <span className="text-[11px] tabular-nums text-surface-500">{edit.subtasks.filter((x) => x.done).length}/{edit.subtasks.length}</span>}</div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  <AnimatePresence initial={false}>
                    {edit.subtasks.map((s) => (
                      <motion.div key={s.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                        <div className="group flex items-center gap-2.5 rounded-lg hover:bg-surface-200/60 px-2 py-1.5 text-sm">
                          <CheckButton done={s.done} label={t('common.done')} onToggle={() => setEdit({ ...edit, subtasks: edit.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })} />
                          <span className={cn('flex-1 min-w-0 break-words', s.done && 'line-through text-surface-500')}>{s.title}</span>
                          <button className="btn-icon p-1 opacity-0 group-hover:opacity-100 focus:opacity-100" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setEdit({ ...edit, subtasks: edit.subtasks.filter((x) => x.id !== s.id) })}><X size={13} /></button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                <input className="input mt-1.5" placeholder={`+ ${t('tasks.addSubtask')}`} value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { e.preventDefault(); setEdit({ ...edit, subtasks: [...edit.subtasks, { id: uid(), title: sub.trim(), done: false }] }); setSub('') } }} />
              </div>
            </div>
            <aside className="space-y-4 md:border-s md:ps-6 border-[color:var(--hairline)]">
              <Field label={t('common.status')}><select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as TaskStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{t(`tasks.status.${s}`)}</option>)}</select></Field>
              <div className="space-y-1.5"><span className="label">{t('common.priority')}</span>
                <Segmented size="sm" value={edit.priority} onChange={(priority) => setEdit({ ...edit, priority })} label={t('common.priority')} className="w-full" options={PRIORITIES.map((p) => ({ value: p, label: t(`tasks.priority.${p}`), icon: <span className={cn('h-1.5 w-1.5 rounded-full', PRIO_DOT[p])} /> }))} />
              </div>
              <Field label={t('common.dueDate')}><input type="datetime-local" className="input" value={edit.dueDate ? toLocalInput(edit.dueDate) : ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
              <Field label={t('tasks.reminder')}><input type="datetime-local" className="input" value={edit.reminderAt ? toLocalInput(edit.reminderAt) : ''} onChange={(e) => setEdit({ ...edit, reminderAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
              <Field label={t('tasks.recurring')}><select className="select" value={edit.recurring || ''} onChange={(e) => setEdit({ ...edit, recurring: (e.target.value || undefined) as Task['recurring'] })}><option value="">{t('tasks.none')}</option><option value="daily">{t('tasks.daily')}</option><option value="weekly">{t('tasks.weekly')}</option><option value="monthly">{t('tasks.monthly')}</option></select></Field>
              <Field label={t('tasks.project')}><select className="select" value={edit.projectId || ''} onChange={(e) => setEdit({ ...edit, projectId: e.target.value || undefined })}><option value="">{t('tasks.noProject')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label={t('common.tags')}><TagInput tags={edit.tags} onChange={(tags) => setEdit({ ...edit, tags })} /></Field>
              {isOverdue(edit) && <p className="flex items-center gap-1.5 text-xs text-rose-500"><AlertCircle size={13} />{t('tasks.overdue')}</p>}
            </aside>
          </div>
        )}
      </Modal>
    </div>
  )
}

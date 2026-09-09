import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lightbulb, Plus, Trash2, Link2, Flag, CheckCircle2, Circle, X, ExternalLink, LayoutGrid, List, Search } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty, Modal, TagInput, ColorPicker, Progress, Field } from '@/components/ui'
import { uid, COLORS, cn, relTime } from '@/lib/utils'
import { invoke } from '@/lib/api'
import type { Project, ProjectStatus } from '@shared/types'

const STATUSES: ProjectStatus[] = ['idea', 'planning', 'active', 'paused', 'done', 'archived']
const STATUS_COLOR: Record<ProjectStatus, string> = { idea: 'bg-violet-500', planning: 'bg-sky-500', active: 'bg-emerald-500', paused: 'bg-amber-500', done: 'bg-teal-500', archived: 'bg-surface-500' }

function toLocalDate(ts: number): string {
  const d = new Date(ts)
  return new Date(ts - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const ProjectCard = React.memo(function ProjectCard({ p, linkedCount, lang, onOpen, onDrag }: {
  p: Project; linkedCount: number; lang: string; onOpen: (p: Project) => void; onDrag: (e: React.DragEvent, id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <button draggable onDragStart={(e) => onDrag(e, p.id)} onClick={() => onOpen(p)} className="card p-3.5 w-full text-start hover:-translate-y-0.5 hover:shadow-glow transition-all duration-400 border-t-[3px]" style={{ borderTopColor: p.color }}>
      <div className="flex items-start justify-between gap-2"><p className="font-medium text-sm">{p.name}</p><span className="flex">{Array.from({ length: p.priority }).map((_, i) => <Flag key={i} size={10} className="text-amber-500 fill-amber-500" />)}</span></div>
      {p.description && <p className="text-xs text-surface-600 line-clamp-2 mt-1">{p.description}</p>}
      <div className="mt-3"><Progress value={p.progress} /></div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-surface-500"><span>{p.milestones.filter((m) => m.done).length}/{p.milestones.length} • {t('projects.tasksLinked', { count: linkedCount })}</span><span>{relTime(p.updatedAt, lang)}</span></div>
      {p.dueDate && p.status !== 'done' && p.dueDate < Date.now() && <p className="text-[10px] text-rose-500 mt-1">{t('tasks.overdue')}</p>}
      {p.tags.length > 0 && <div className="flex gap-1 flex-wrap mt-2">{p.tags.slice(0, 3).map((tg) => <span key={tg} className="badge bg-surface-200 text-surface-700">#{tg}</span>)}</div>}
    </button>
  )
})

export default function Projects() {
  const { t } = useTranslation()
  const { projects, saveProjects, tasks, pageParams, consumeParams, toast, settings } = useApp()
  const [edit, setEdit] = useState<Project | null>(null)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [q, setQ] = useState('')
  const [ms, setMs] = useState(''); const [linkL, setLinkL] = useState(''); const [linkU, setLinkU] = useState('')

  const blank = useCallback((): Project => ({ id: uid(), name: '', description: '', status: 'idea', priority: 3, tags: [], color: COLORS[4], links: [], milestones: [], notes: '', progress: 0, createdAt: Date.now(), updatedAt: Date.now() }), [])
  const consumedParams = useRef<string | null>(null)
  useEffect(() => {
    if (!pageParams.create && !pageParams.open) return
    const key = JSON.stringify(pageParams)
    if (consumedParams.current === key) return
    if (pageParams.open) {
      const p = projects.find((x) => x.id === pageParams.open)
      if (!p) return
      if (!edit) setEdit(p)
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
  }, [pageParams, projects])

  const save = () => {
    if (!edit || !edit.name.trim()) return
    const done = edit.milestones.filter((m) => m.done).length
    const progress = edit.milestones.length ? Math.round((done / edit.milestones.length) * 100) : edit.progress
    const p = { ...edit, progress, updatedAt: Date.now() }
    saveProjects(projects.some((x) => x.id === p.id) ? projects.map((x) => (x.id === p.id ? p : x)) : [p, ...projects])
    setEdit(null); toast(t('toast.saved'))
  }
  const remove = async (id: string) => {
    if (settings.confirmDelete && !(await invoke('dialog:confirm', t('common.confirmDelete')))) return
    saveProjects(projects.filter((p) => p.id !== id)); setEdit(null); toast(t('toast.deleted'), 'info')
  }
  const move = useCallback((id: string, status: ProjectStatus) => {
    const list = useApp.getState().projects
    if (!list.some((p) => p.id === id)) return
    useApp.getState().saveProjects(list.map((p) => (p.id === id ? { ...p, status, updatedAt: Date.now() } : p)))
  }, [])
  const openCard = useCallback((p: Project) => setEdit(p), [])
  const onDrag = useCallback((e: React.DragEvent, id: string) => { e.dataTransfer.setData('text/plain', id) }, [])
  const filteredProjects = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter((p) => ((p.name + ' ' + (p.description || '') + ' ' + p.tags.join(' ')).toLowerCase().includes(needle)))
  }, [projects, q])
  const countsByProject = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of tasks) m.set(x.projectId || '', (m.get(x.projectId || '') || 0) + 1)
    return m
  }, [tasks])
  const grouped = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, filteredProjects.filter((p) => p.status === s).sort((a, b) => a.priority - b.priority)])), [filteredProjects])
  const listSorted = useMemo(() => [...filteredProjects].sort((a, b) => b.updatedAt - a.updatedAt), [filteredProjects])

  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<Lightbulb size={22} />} title={t('projects.title')} subtitle={t('common.items', { count: filteredProjects.length })}>
        <div className="flex rounded-lg bg-surface-200 p-0.5">
          <button onClick={() => setView('board')} className={cn('p-1.5 rounded-md', view === 'board' && 'bg-accent text-accent-fg')} title={t('projects.board')} aria-label={t('projects.board')} aria-pressed={view === 'board'}><LayoutGrid size={15} /></button>
          <button onClick={() => setView('list')} className={cn('p-1.5 rounded-md', view === 'list' && 'bg-accent text-accent-fg')} title={t('projects.listView')} aria-label={t('projects.listView')} aria-pressed={view === 'list'}><List size={15} /></button>
        </div>
        <button className="btn-primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('projects.newProject')}</button>
      </PageHeader>
      <div className="relative mb-4 max-w-md"><Search size={14} className="absolute start-3 top-2.5 text-surface-500" /><input className="input ps-9 py-1.5 text-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {projects.length === 0 ? <Empty icon={<Lightbulb size={40} />} text={t('projects.noProjects')} action={<button className="btn-primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('projects.newProject')}</button>} /> :
        filteredProjects.length === 0 ? <p className="text-xs text-surface-500 text-center p-6">{t('common.noResults')}</p> :
        view === 'board' ? (
          <div className="flex-1 min-h-0 overflow-x-auto"><div className="flex gap-3 h-full min-w-max">
            {STATUSES.map((s) => (
              <div key={s} className="w-64 flex flex-col rounded-2xl bg-surface-100/50 border border-surface-300/40 min-h-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s) }}>
                <div className="flex items-center gap-2 p-3 text-sm font-semibold"><span className={cn('h-2.5 w-2.5 rounded-full', STATUS_COLOR[s])} />{t(`projects.status.${s}`)}<span className="ms-auto text-xs text-surface-500">{grouped[s].length}</span></div>
                <div className="flex-1 overflow-auto p-2 space-y-2">{grouped[s].map((p) => <ProjectCard key={p.id} p={p} linkedCount={countsByProject.get(p.id) || 0} lang={settings.language} onOpen={openCard} onDrag={onDrag} />)}</div>
              </div>
            ))}
          </div></div>
        ) : (
          <div className="card overflow-auto">
            {listSorted.length === 0 && <p className="text-xs text-surface-500 text-center p-6">{t('common.noResults')}</p>}
            {listSorted.map((p) => (
              <button key={p.id} onClick={() => setEdit(p)} className="w-full flex items-center gap-4 px-4 py-3 border-b border-surface-300/40 hover:bg-surface-200/60 text-start">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ background: p.color }} /><span className="flex-1 font-medium text-sm truncate">{p.name}</span>
                <span className={cn('badge text-white', STATUS_COLOR[p.status])}>{t(`projects.status.${p.status}`)}</span><div className="w-32"><Progress value={p.progress} /></div><span className="text-xs text-surface-500 w-24 text-end">{relTime(p.updatedAt, settings.language)}</span>
              </button>
            ))}
          </div>
        )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit && projects.some((x) => x.id === edit.id) ? t('common.edit') : t('projects.newProject')} wide>
        {edit && (
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <Field label={t('common.name')}><input autoFocus className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && edit.name.trim() && save()} /></Field>
              <Field label={t('common.description')}><textarea className="input min-h-[80px]" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('common.status')}><select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as ProjectStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{t(`projects.status.${s}`)}</option>)}</select></Field>
                <Field label={t('projects.priority')}><select className="select" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) as any })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select></Field>
              </div>
              <Field label={t('common.dueDate')}><input type="date" className="input" value={edit.dueDate ? toLocalDate(edit.dueDate) : ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value ? new Date(e.target.value + 'T12:00:00').getTime() : undefined })} /></Field>
              <Field label={t('common.color')}><ColorPicker value={edit.color} onChange={(c) => setEdit({ ...edit, color: c })} colors={COLORS} /></Field>
              <Field label={t('common.tags')}><TagInput tags={edit.tags} onChange={(tags) => setEdit({ ...edit, tags })} /></Field>
              {edit.milestones.length === 0 && <Field label={t('common.progress')}><input type="range" min={0} max={100} value={edit.progress} onChange={(e) => setEdit({ ...edit, progress: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" /></Field>}
            </div>
            <div className="space-y-4">
              <div><span className="label">{t('projects.milestones')}</span>
                <div className="space-y-1 mt-1.5">{edit.milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-lg bg-surface-200/60 px-2 py-1.5 text-sm">
                    <button onClick={() => setEdit({ ...edit, milestones: edit.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) })}>{m.done ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-surface-500" />}</button>
                    <span className={cn('flex-1', m.done && 'line-through text-surface-500')}>{m.title}</span><button onClick={() => setEdit({ ...edit, milestones: edit.milestones.filter((x) => x.id !== m.id) })}><X size={13} /></button>
                  </div>))}
                  <div className="flex gap-2"><input className="input" placeholder={t('projects.addMilestone')} value={ms} onChange={(e) => setMs(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ms.trim()) { setEdit({ ...edit, milestones: [...edit.milestones, { id: uid(), title: ms.trim(), done: false }] }); setMs('') } }} /></div>
                </div>
              </div>
              <div><span className="label">{t('projects.links')}</span>
                <div className="space-y-1 mt-1.5">{edit.links.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-surface-200/60 px-2 py-1.5 text-sm"><Link2 size={14} className="text-accent" /><span className="flex-1 truncate">{l.label}</span>
                    <button className="btn-icon p-1" onClick={() => invoke('app:openExternal', l.url)}><ExternalLink size={13} /></button><button onClick={() => setEdit({ ...edit, links: edit.links.filter((_, j) => j !== i) })}><X size={13} /></button></div>))}
                  <div className="flex gap-2"><input className="input" placeholder={t('common.name')} value={linkL} onChange={(e) => setLinkL(e.target.value)} /><input className="input" placeholder="https://" value={linkU} onChange={(e) => setLinkU(e.target.value)} />
                    <button className="btn-soft shrink-0" onClick={() => { if (/^https?:\/\//.test(linkU)) { setEdit({ ...edit, links: [...edit.links, { label: linkL || linkU, url: linkU }] }); setLinkL(''); setLinkU('') } }}><Plus size={14} /></button></div>
                </div>
              </div>
              <Field label={t('projects.notes')}><textarea className="input min-h-[100px] font-mono text-xs" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            </div>
            <div className="md:col-span-2 flex justify-between pt-2">
              {projects.some((x) => x.id === edit.id) ? <button className="btn-danger" onClick={() => remove(edit.id)}><Trash2 size={15} />{t('common.delete')}</button> : <span />}
              <div className="flex gap-2"><button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button className="btn-primary" onClick={save} disabled={!edit.name.trim()}>{t('common.save')}</button></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StickyNote, Plus, Pin, PinOff, Archive, ArchiveRestore, Star, Trash2, Search, Eye, Pencil, Columns, Download, Tag } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty, TagInput, ColorPicker } from '@/components/ui'
import { uid, COLORS, cn, relTime, stripPath } from '@/lib/utils'
import { renderMarkdown } from '@/lib/markdown'
import { invoke } from '@/lib/api'
import type { Note } from '@shared/types'

export default function Notes() {
  const { t } = useTranslation()
  const { notes, saveNotes, pageParams, toast, settings } = useApp()
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // Perf: defer the expensive full-text filter so typing stays smooth with
  // many/large notes; the list catches up right after.
  const dq = React.useDeferredValue(q)
  const [filter, setFilter] = useState<'all' | 'pinned' | 'favorites' | 'archived'>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [sort, setSort] = useState<'updated' | 'created' | 'title'>('updated')

  const create = () => {
    const n: Note = { id: uid(), title: '', content: '', tags: [], color: COLORS[0], pinned: false, archived: false, favorite: false, createdAt: Date.now(), updatedAt: Date.now() }
    saveNotes([n, ...notes]); setSel(n.id); setFilter('all')
  }
  // Consume navigation params exactly once (StrictMode double-mounts effects,
  // which previously created two empty notes for a single "new note" action).
  const consumedParams = useRef<string | null>(null)
  useEffect(() => {
    const key = JSON.stringify(pageParams)
    if (consumedParams.current === key) return
    consumedParams.current = key
    if (pageParams.create) create()
    if (pageParams.open && notes.some((n) => n.id === pageParams.open)) setSel(pageParams.open as string)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParams, notes])

  const update = (id: string, patch: Partial<Note>) => saveNotes(notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)))
  const remove = async (id: string) => {
    if (settings.confirmDelete && !(await invoke('dialog:confirm', t('common.confirmDelete'), t('common.irreversible')))) return
    saveNotes(notes.filter((n) => n.id !== id)); if (sel === id) setSel(null); toast(t('notes.noteDeleted'), 'info')
  }
  const allTags = useMemo(() => Array.from(new Set(notes.flatMap((n) => n.tags))).sort(), [notes])
  const list = useMemo(() => notes
    .filter((n) => (filter === 'archived' ? n.archived : !n.archived))
    .filter((n) => (filter === 'pinned' ? n.pinned : filter === 'favorites' ? n.favorite : true))
    .filter((n) => !tagFilter || n.tags.includes(tagFilter))
    .filter((n) => !q || (n.title + ' ' + n.content + ' ' + n.tags.join(' ')).toLowerCase().includes(dq.toLowerCase()))
    .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt)),
  [notes, filter, tagFilter, q, dq, sort])
  const cur = notes.find((n) => n.id === sel)
  // Avoid re-rendering markdown on every unrelated keystroke/parent render.
  const mdHtml = useMemo(() => (cur ? renderMarkdown(cur.content) : ''), [cur?.id, cur?.content])
  const exportMd = async () => {
    if (!cur) return
    const p = await invoke<string | null>('dialog:save', { defaultPath: (cur.title || 'note') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (p) {
      const frontmatter = `---\ntitle: ${JSON.stringify(cur.title)}\ntags: [${cur.tags.map((tg) => JSON.stringify(tg)).join(', ')}]\nupdated: ${new Date(cur.updatedAt).toISOString()}\n---\n\n`
      await invoke('fs:writeText', p, `${frontmatter}# ${cur.title}\n\n${cur.content}`)
      toast(`${t('toast.saved')}: ${stripPath(p)}`)
    }
  }
  const words = cur ? cur.content.trim().split(/\s+/).filter(Boolean).length : 0
  const openExtSafe = (raw: string) => {
    const url = (raw || '').trim()
    if (!/^https?:\/\//i.test(url) || /^(javascript|file|data):/i.test(url)) {
      toast(t('common.blockedUrl'), 'error')
      return
    }
    invoke('app:openExternal', url).catch((e: unknown) => toast(e instanceof Error ? e.message : t('toast.error'), 'error'))
  }
  const handleExtNav = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a[data-ext]') as HTMLAnchorElement | null
    if (!a) return
    // Never navigate inside Electron (incl. middle-click / Ctrl+click): open externally only.
    e.preventDefault()
    e.stopPropagation()
    openExtSafe(a.href || a.getAttribute('href') || '')
  }

  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<StickyNote size={22} />} title={t('notes.title')} subtitle={t('common.items', { count: notes.length })}>
        <select className="select w-auto text-xs" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label={t('common.sortBy')}>
          <option value="updated">{t('notes.sortUpdated')}</option><option value="created">{t('notes.sortCreated')}</option><option value="title">{t('notes.sortTitle')}</option>
        </select>
        <button className="btn-primary" onClick={create}><Plus size={16} />{t('notes.newNote')}</button>
      </PageHeader>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <aside className="card flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 space-y-2 border-b border-surface-300/60">
            <div className="relative"><Search size={14} className="absolute start-3 top-2.5 text-surface-500" /><input className="input ps-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="flex gap-1 text-xs flex-wrap">
              {(['all', 'pinned', 'favorites', 'archived'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={cn('flex-1 rounded-lg py-1 transition-colors', filter === f ? 'bg-accent text-accent-fg' : 'hover:bg-surface-200')}>{t(f === 'all' ? 'common.all' : `common.${f}`)}</button>)}
            </div>
            {allTags.length > 0 && <div className="flex gap-1 flex-wrap max-h-24 overflow-y-auto">{allTags.map((tg) => <button key={tg} onClick={() => setTagFilter(tagFilter === tg ? null : tg)} className={cn('badge cursor-pointer', tagFilter === tg ? 'bg-accent text-accent-fg' : 'bg-surface-200 text-surface-700')}><Tag size={10} />{tg}</button>)}</div>}
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1 stagger">
            {list.length === 0 && (
              <div className="text-center p-6">
                <p className="text-xs text-surface-500">{t('common.noResults')}</p>
                {(q || filter !== 'all' || tagFilter) && <button className="btn-soft mt-2 text-xs" onClick={() => { setQ(''); setFilter('all'); setTagFilter(null) }}>{t('common.clear')}</button>}
              </div>
            )}
            {list.map((n) => (
              <button key={n.id} onClick={() => setSel(n.id)} className={cn('w-full text-start rounded-xl p-3 transition-all duration-300 border-s-[3px]', sel === n.id ? 'bg-surface-200 shadow-card' : 'hover:bg-surface-200/60')} style={{ borderColor: n.color }}>
                <div className="flex items-center gap-1.5">{n.pinned && <Pin size={11} className="text-accent" />}{n.favorite && <Star size={11} className="text-amber-500 fill-amber-500" />}<span className="text-sm font-medium truncate flex-1">{n.title || t('common.untitled')}</span></div>
                <p className="text-xs text-surface-600 line-clamp-2 mt-0.5">{n.content.slice(0, 120) || '…'}</p>
                <p className="text-[10px] text-surface-500 mt-1">{relTime(n.updatedAt, settings.language)}</p>
              </button>
            ))}
          </div>
        </aside>
        <section className="card flex flex-col min-h-0 overflow-hidden">
          {!cur ? <Empty icon={<StickyNote size={40} />} text={t('common.empty')} action={<button className="btn-primary" onClick={create}><Plus size={16} />{t('notes.newNote')}</button>} /> : (
            <>
              <div className="flex items-center gap-2 p-3 border-b border-surface-300/60 flex-wrap">
                <input className="flex-1 bg-transparent text-lg font-semibold outline-none min-w-[200px]" placeholder={t('notes.placeholderTitle')} value={cur.title} onChange={(e) => update(cur.id, { title: e.target.value })} />
                <div className="flex items-center rounded-lg bg-surface-200 p-0.5">
                  {([['edit', <Pencil size={14} />], ['split', <Columns size={14} />], ['preview', <Eye size={14} />]] as const).map(([m, ic]) => <button key={m} title={t(`notes.${m}Mode`)} aria-label={t(`notes.${m}Mode`)} aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('p-1.5 rounded-md transition-colors', mode === m ? 'bg-accent text-accent-fg' : 'hover:bg-surface-300')}>{ic}</button>)}
                </div>
                <button className="btn-icon" title={cur.pinned ? t('notes.unpin') : t('notes.pin')} aria-label={cur.pinned ? t('notes.unpin') : t('notes.pin')} onClick={() => update(cur.id, { pinned: !cur.pinned })}>{cur.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
                <button className="btn-icon" title={t('notes.favorite')} aria-label={t('notes.favorite')} onClick={() => update(cur.id, { favorite: !cur.favorite })}><Star size={16} className={cur.favorite ? 'fill-amber-500 text-amber-500' : ''} /></button>
                <button className="btn-icon" title={cur.archived ? t('notes.unarchive') : t('notes.archive')} aria-label={cur.archived ? t('notes.unarchive') : t('notes.archive')} onClick={() => update(cur.id, { archived: !cur.archived })}>{cur.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
                <button className="btn-icon" title={t('notes.exportMd')} aria-label={t('notes.exportMd')} onClick={exportMd}><Download size={16} /></button>
                <button className="btn-icon hover:text-rose-500" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => remove(cur.id)}><Trash2 size={16} /></button>
              </div>
              <div className="flex items-center gap-3 px-3 py-2 border-b border-surface-300/60 flex-wrap">
                <ColorPicker value={cur.color} onChange={(c) => update(cur.id, { color: c })} colors={COLORS} />
                <div className="flex-1 min-w-[160px]"><TagInput tags={cur.tags} onChange={(tags) => update(cur.id, { tags })} placeholder={t('notes.addTag')} /></div>
              </div>
              <div className={cn('flex-1 min-h-0 grid overflow-auto', mode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
                {mode !== 'preview' && <textarea className="h-full w-full resize-none bg-transparent p-4 outline-none font-mono text-sm leading-6 selectable" placeholder={t('notes.placeholderBody')} value={cur.content} onChange={(e) => update(cur.id, { content: e.target.value })} spellCheck />}
                {mode !== 'edit' && <div className={cn('h-full overflow-auto p-4 prose-dh selectable', mode === 'split' && 'border-s border-surface-300/60')} dangerouslySetInnerHTML={{ __html: mdHtml }} onClick={handleExtNav} onAuxClick={handleExtNav} />}
              </div>
              <footer className="flex items-center gap-4 px-4 py-1.5 border-t border-surface-300/60 text-[11px] text-surface-500 flex-wrap">
                <span>{t('notes.wordCount', { count: words })}</span><span>{t('notes.chars', { count: cur.content.length })}</span><span className="ms-auto">{relTime(cur.updatedAt, settings.language)}</span>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

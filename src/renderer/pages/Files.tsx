import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Folder, File, FileText, FileImage, FileVideo, FileAudio, FileArchive, FileCode, ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Home, Monitor, Download, Image as ImgIcon, Film, Music, HardDrive, Plus, Search, LayoutGrid, List, Eye, EyeOff, Copy, Scissors, Clipboard, Trash2, Pencil, Info, ExternalLink, Hash, Archive, Code2, Star, Columns } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, ContextMenu, Modal, Field, Empty } from '@/components/ui'
import { invoke, toFileUrl } from '@/lib/api'
import { formatBytes, formatDate, cn, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, ARCHIVE_EXT, TEXT_EXT, extToLang } from '@/lib/utils'
import type { FileEntry, DriveInfo } from '@shared/types'

/** Client-side name guard: mirrors main safePath + blocks traversal/reserved/ADS. */
function validName(n: string): boolean {
  const t = n.trim()
  if (!t || t.length > 255 || t === '.' || t === '..') return false
  // Block traversal sequences anywhere (a..b, ../, ..\, etc.).
  if (t.includes('..')) return false
  // Block / \ : * ? " < > | (colon also blocks ADS "name:stream").
  if (!/^[^\\/:\*\?"<>\|]+$/.test(t)) return false
  // Windows reserved names incl. with extension (CON, CON.txt, NUL, COM1, ...).
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\..*)?$/i.test(t)) return false
  if (/[. ]$/.test(t)) return false
  return true
}

function iconFor(e: FileEntry, size = 18) {
  if (e.isDirectory) return <Folder size={size} className="text-amber-400 fill-amber-400/30" />
  if (IMAGE_EXT.has(e.ext)) return <FileImage size={size} className="text-pink-500" />
  if (VIDEO_EXT.has(e.ext)) return <FileVideo size={size} className="text-violet-500" />
  if (AUDIO_EXT.has(e.ext)) return <FileAudio size={size} className="text-emerald-500" />
  if (ARCHIVE_EXT.has(e.ext)) return <FileArchive size={size} className="text-orange-500" />
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'html', 'css', 'json', 'xml', 'sh', 'bat', 'ps1'].includes(e.ext)) return <FileCode size={size} className="text-sky-500" />
  if (TEXT_EXT.has(e.ext)) return <FileText size={size} className="text-surface-600" />
  return <File size={size} className="text-surface-500" />
}

type Clip = { op: 'copy' | 'cut'; paths: string[] } | null
let clipboardState: Clip = null

function Pane({ initial, active, onActivate, onOpenIn, onPathChange }: { initial: string; active: boolean; onActivate: () => void; onOpenIn: (kind: 'editor' | 'images' | 'video' | 'compress', p: string) => void; onPathChange?: (p: string) => void }) {
  const { t } = useTranslation()
  const { settings, setSettings, toast } = useApp()
  const [path, setPath] = useState(initial)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [hist, setHist] = useState<string[]>([initial]); const [hi, setHi] = useState(0)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [q, setQ] = useState('')
  const [ctx, setCtx] = useState<{ x: number; y: number; e?: FileEntry } | null>(null)
  const [loading, setLoading] = useState(false)
  const [renaming, setRenaming] = useState<FileEntry | null>(null); const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null)
  const [props, setProps] = useState<{ e: FileEntry; size?: any; hash?: string } | null>(null)
  const [preview, setPreview] = useState<{ e: FileEntry; text?: string } | null>(null)
  const [sort, setSort] = useState<{ k: 'name' | 'size' | 'modified' | 'ext'; d: 1 | -1 }>({ k: 'name', d: 1 })
  const pathInput = useRef<HTMLInputElement>(null)
  const [pathEdit, setPathEdit] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async (p = path) => {
    const id = ++loadSeq.current
    setLoading(true)
    try {
      const ents = await invoke<FileEntry[]>('fs:list', p, settings.showHiddenFiles)
      // Race guard: a slow stale response must never overwrite a newer folder.
      if (loadSeq.current !== id) return
      setEntries(ents); setSel(new Set())
    } catch (e: any) { if (loadSeq.current === id) toast(e.message, 'error') } finally { if (loadSeq.current === id) setLoading(false) }
  }, [path, settings.showHiddenFiles, toast])
  useEffect(() => { load() }, [path, settings.showHiddenFiles])
  // Report the live path upward so the parent's "add favorite" uses the folder
  // actually shown — not the pane's initial root.
  useEffect(() => { onPathChange?.(path) }, [path, onPathChange])

  const go = (p: string, push = true) => {
    setPath(p); setQ('')
    if (push) {
      const base = [...hist.slice(0, hi + 1), p]
      // Cap history at 50 entries (drop oldest).
      const h = base.length > 50 ? base.slice(base.length - 50) : base
      setHist(h); setHi(h.length - 1)
    }
  }
  const back = () => { if (hi > 0) { setHi(hi - 1); go(hist[hi - 1], false) } }
  const fwd = () => { if (hi < hist.length - 1) { setHi(hi + 1); go(hist[hi + 1], false) } }
  const up = async () => { const i = await invoke<{ dir: string }>('fs:pathInfo', path); if (i.dir !== path) go(i.dir) }

  const openEntry = async (e: FileEntry) => {
    if (e.isDirectory) return go(e.path)
    // Text/code files open in the built-in editor only when small enough to fit
    // memory safely; huge logs fall back to the system viewer instead of OOMing.
    if (TEXT_EXT.has(e.ext)) {
      if (e.size <= 20 * 1024 * 1024) return onOpenIn('editor', e.path)
      toast(t('files.tooLargeEditor'), 'warning')
      return invoke('fs:open', e.path).catch((er) => toast(er.message, 'error'))
    }
    if (IMAGE_EXT.has(e.ext)) return onOpenIn('images', e.path)
    if (VIDEO_EXT.has(e.ext) || AUDIO_EXT.has(e.ext)) return onOpenIn('video', e.path)
    if (ARCHIVE_EXT.has(e.ext)) return onOpenIn('compress', e.path)
    invoke('fs:open', e.path).catch((er) => toast(er.message, 'error'))
  }

  const selected = entries.filter((e) => sel.has(e.path))
  const doCopy = (cut = false) => { clipboardState = { op: cut ? 'cut' : 'copy', paths: selected.map((e) => e.path) }; toast(`${selected.length} ${cut ? t('common.cut') : t('common.copy')}`, 'info') }
  const doPaste = async () => {
    if (!clipboardState) return
    for (const src of clipboardState.paths) {
      try {
        const info = await invoke<{ base: string }>('fs:pathInfo', src)
        const dest = await invoke<string>('fs:join', path, info.base)
        // Same-path copy/move guard + pre-existence check with overwrite confirm.
        if (dest === src) continue
        try {
          if (await invoke<boolean>('fs:exists', dest)) {
            if (!(await invoke<boolean>('dialog:confirm', t('files.overwriteConfirm'), dest))) continue
          }
        } catch { /* exists check best-effort — let main enforce */ }
        try { await invoke(clipboardState.op === 'cut' ? 'fs:move' : 'fs:copy', src, dest) } catch (e: any) { toast(e.message, 'error') }
      } catch (e: any) { toast(e instanceof Error ? e.message : t('toast.error'), 'error') }
    }
    if (clipboardState.op === 'cut') clipboardState = null
    load(); toast(t('common.done'))
  }
  const doDelete = async (permanent = false) => {
    if (!selected.length) return
    if (settings.confirmDelete && !(await invoke('dialog:confirm', t('common.confirmDelete'), selected.map((e) => e.name).join('\n')))) return
    for (const e of selected) { try { await invoke('fs:remove', e.path, settings.useRecycleBin && !permanent) } catch (er: any) { toast(er.message, 'error') } }
    load(); toast(t('toast.deleted'), 'info')
  }
  const doRename = async () => {
    if (!renaming || !newName.trim()) return
    if (!validName(newName)) { toast(t('files.invalidName'), 'error'); return }
    const dest = await invoke<string>('fs:join', path, newName.trim())
    if (dest !== renaming.path) {
      try {
        if (await invoke<boolean>('fs:exists', dest)) {
          if (!(await invoke<boolean>('dialog:confirm', t('files.overwriteConfirm'), dest))) return
        }
      } catch { /* best-effort */ }
    }
    try { await invoke('fs:rename', renaming.path, dest); load(); toast(t('toast.updated')) } catch (e: any) { toast(e.message, 'error') }
    setRenaming(null)
  }
  const doCreate = async () => {
    if (!creating || !newName.trim()) return
    if (!validName(newName)) { toast(t('files.invalidName'), 'error'); return }
    const p = await invoke<string>('fs:join', path, newName.trim())
    try {
      if (await invoke<boolean>('fs:exists', p)) { toast(t('files.overwriteConfirm'), 'error'); return }
    } catch { /* best-effort */ }
    try { await invoke(creating === 'folder' ? 'fs:mkdir' : 'fs:createFile', p); load(); toast(t('toast.created')) } catch (e: any) { toast(e.message, 'error') }
    setCreating(null); setNewName('')
  }
  const showProps = async (e: FileEntry) => {
    setProps({ e })
    if (e.isDirectory) invoke('fs:folderSize', e.path).then((size) => setProps((p) => (p && p.e.path === e.path ? { ...p, size } : p))).catch(() => {})
  }
  const doPreview = async (e: FileEntry) => {
    if (e.isDirectory) return
    if (TEXT_EXT.has(e.ext) && e.size < 2 * 1024 * 1024) { const text = await invoke<string>('fs:readText', e.path).catch(() => ''); setPreview({ e, text }) }
    else setPreview({ e })
  }

  const list = useMemo(() => entries.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const v = sort.k === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort.k === 'size' ? a.size - b.size : sort.k === 'ext' ? a.ext.localeCompare(b.ext) : a.modified - b.modified
    return v * sort.d
  }), [entries, q, sort])

  const crumbs = path.split(/[\\/]/).filter(Boolean)
  const isWinPane = typeof window !== 'undefined' && (window.dh?.platform === 'win32')
  // Preserve the filesystem root: '/' on POSIX, '\\server\share' UNC, '' + drive fix on Windows.
  const rootPrefix = path.startsWith('/') ? '/' : path.startsWith('\\\\') ? '\\\\' : ''
  const crumbGo = (i: number) => {
    const joined = crumbs.slice(0, i + 1).join(isWinPane ? '\\' : '/')
    go(rootPrefix + joined + (i === 0 && isWinPane && !rootPrefix ? '\\' : ''))
  }
  const ctxItems = ctx?.e ? [
    { label: t('common.open'), icon: <ExternalLink size={14} />, onClick: () => openEntry(ctx.e!) },
    ...(!ctx.e.isDirectory ? [{ label: t('files.openWith'), icon: <ExternalLink size={14} />, onClick: () => invoke('fs:open', ctx.e!.path) }] : []),
    ...(!ctx.e.isDirectory && TEXT_EXT.has(ctx.e.ext) ? [{ label: t('files.editInEditor'), icon: <Code2 size={14} />, onClick: () => onOpenIn('editor', ctx.e!.path) }] : []),
    ...(IMAGE_EXT.has(ctx.e.ext) ? [{ label: t('files.editImage'), icon: <ImgIcon size={14} />, onClick: () => onOpenIn('images', ctx.e!.path) }] : []),
    ...(VIDEO_EXT.has(ctx.e.ext) || AUDIO_EXT.has(ctx.e.ext) ? [{ label: t('files.editVideo'), icon: <Film size={14} />, onClick: () => onOpenIn('video', ctx.e!.path) }] : []),
    { label: t('common.preview'), icon: <Eye size={14} />, onClick: () => doPreview(ctx.e!) },
    { sep: true, label: '' },
    { label: t('common.copy'), icon: <Copy size={14} />, onClick: () => doCopy(false) },
    { label: t('common.cut'), icon: <Scissors size={14} />, onClick: () => doCopy(true) },
    { label: t('common.rename'), icon: <Pencil size={14} />, onClick: () => { setRenaming(ctx.e!); setNewName(ctx.e!.name) } },
    { label: t('files.copyPath'), icon: <Clipboard size={14} />, onClick: () => invoke('clipboard:write', ctx.e!.path).then(() => toast(t('toast.copied'))) },
    { label: t('files.showInExplorer'), icon: <FolderOpen size={14} />, onClick: () => invoke('fs:showInFolder', ctx.e!.path) },
    { sep: true, label: '' },
    { label: ARCHIVE_EXT.has(ctx.e.ext) ? t('files.extractHere') : t('files.compressHere'), icon: <Archive size={14} />, onClick: () => onOpenIn('compress', ctx.e!.path) },
    ...(!ctx.e.isDirectory ? [{ label: t('files.hash'), icon: <Hash size={14} />, onClick: async () => { const target = ctx.e!; const h = await invoke<string>('fs:hash', target.path, 'sha256'); setProps((p) => (p && p.e.path === target.path ? { e: target, hash: h } : p)) } }] : []),
    { label: t('files.properties'), icon: <Info size={14} />, onClick: () => showProps(ctx.e!) },
    { sep: true, label: '' },
    { label: settings.useRecycleBin ? t('files.moveToTrash') : t('common.delete'), icon: <Trash2 size={14} />, onClick: () => doDelete(false), danger: true },
    { label: t('files.deletePermanently'), icon: <Trash2 size={14} />, onClick: () => doDelete(true), danger: true },
  ] : [
    { label: t('files.newFolder'), icon: <Plus size={14} />, onClick: () => { setCreating('folder'); setNewName('') } },
    { label: t('files.newFile'), icon: <Plus size={14} />, onClick: () => { setCreating('file'); setNewName('') } },
    { label: t('files.pasteHere'), icon: <Clipboard size={14} />, onClick: doPaste },
    { sep: true, label: '' },
    { label: t('files.selectAll'), onClick: () => setSel(new Set(entries.map((e) => e.path))) },
    { label: t('common.refresh'), icon: <RefreshCw size={14} />, onClick: () => load() },
    { label: t('files.showInExplorer'), icon: <FolderOpen size={14} />, onClick: () => invoke('fs:open', path) },
  ]

  const onKey = (e: React.KeyboardEvent) => {
    // Never hijack typing inside the search box (Delete/Ctrl+A/Ctrl+C must edit text).
    if ((e.target as HTMLElement).closest?.('input,textarea,select')) return
    if (e.key === 'Delete') doDelete(e.shiftKey)
    if (e.key === 'F2' && selected[0]) { setRenaming(selected[0]); setNewName(selected[0].name) }
    if (e.key === 'F5') load()
    if (e.key === 'Backspace') up()
    if (e.ctrlKey && !e.shiftKey && e.key === 'c') doCopy(false)
    if (e.ctrlKey && !e.shiftKey && e.key === 'x') doCopy(true)
    if (e.ctrlKey && !e.shiftKey && e.key === 'v') doPaste()
    if (e.ctrlKey && e.key === 'a') { e.preventDefault(); setSel(new Set(entries.map((x) => x.path))) }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setCreating('folder'); setNewName('') }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setPathEdit(path) }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); invoke('clipboard:write', selected[0]?.path || path).then(() => toast(t('toast.copied'))) }
    if (e.key === 'Enter' && selected[0]) openEntry(selected[0])
    if (e.altKey && e.key === 'ArrowLeft') back()
    if (e.altKey && e.key === 'ArrowRight') fwd()
    if (e.altKey && e.key === 'ArrowUp') up()
    if (e.key === ' ' && selected[0]) { e.preventDefault(); doPreview(selected[0]) }
  }

  return (
    <div tabIndex={0} onKeyDown={onKey} onMouseDown={onActivate} className={cn('card flex flex-col min-h-0 overflow-hidden outline-none transition-shadow duration-300', active && 'ring-1 ring-accent/50')}>
      <div className="flex items-center gap-1 p-2 border-b border-surface-300/60">
        <button className="btn-icon" title={t('common.back')} aria-label={t('common.back')} onClick={back} disabled={hi === 0}><ArrowLeft size={16} className="rtl:rotate-180" /></button>
        <button className="btn-icon" title={t('common.forward')} aria-label={t('common.forward')} onClick={fwd} disabled={hi >= hist.length - 1}><ArrowRight size={16} className="rtl:rotate-180" /></button>
        <button className="btn-icon" title={t('common.up')} aria-label={t('common.up')} onClick={up}><ArrowUp size={16} /></button>
        <button className="btn-icon" title={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => load()}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        {pathEdit !== null ? (
          <input ref={pathInput} autoFocus className="input flex-1 py-1 font-mono text-xs" dir="ltr" value={pathEdit} onChange={(e) => setPathEdit(e.target.value)} onBlur={() => setPathEdit(null)} onKeyDown={(e) => { if (e.key === 'Enter') { go(pathEdit); setPathEdit(null) } if (e.key === 'Escape') setPathEdit(null) }} />
        ) : (
          <div className="flex-1 flex items-center gap-0.5 overflow-hidden rounded-lg bg-surface-200/60 px-2 py-1 text-xs cursor-text" dir="ltr" onClick={() => setPathEdit(path)}>
            {crumbs.map((c, i) => <React.Fragment key={i}><button className="hover:text-accent px-1 rounded truncate max-w-[140px]" onClick={(e) => { e.stopPropagation(); crumbGo(i) }}>{c}</button>{i < crumbs.length - 1 && <span className="text-surface-500">›</span>}</React.Fragment>)}
          </div>
        )}
        <div className="relative w-40 shrink-0"><Search size={13} className="absolute start-2.5 top-2 text-surface-500" /><input className="input ps-8 py-1 text-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn-icon" title={t('common.view')} aria-label={t('common.view')} onClick={() => setView(view === 'list' ? 'grid' : 'list')}>{view === 'list' ? <LayoutGrid size={15} /> : <List size={15} />}</button>
        <button className="btn-icon" title={t('files.hidden')} onClick={() => setSettings({ showHiddenFiles: !settings.showHiddenFiles })}>{settings.showHiddenFiles ? <Eye size={15} /> : <EyeOff size={15} />}</button>
      </div>
      <div className="flex-1 overflow-auto" onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }) }} onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()) }}>
        {view === 'list' ? (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-100 text-[11px] text-surface-600 uppercase tracking-wide">
              <tr>{([['name', t('common.name')], ['ext', t('common.type')], ['size', t('common.size')], ['modified', t('common.modified')]] as const).map(([k, l]) => <th key={k} className={cn('text-start px-3 py-2 cursor-pointer hover:text-accent select-none', k === 'size' && 'text-end w-24', k === 'ext' && 'w-20', k === 'modified' && 'w-44')} onClick={() => setSort((s) => ({ k, d: s.k === k ? (s.d * -1) as 1 | -1 : 1 }))}>{l}{sort.k === k && (sort.d === 1 ? ' ↑' : ' ↓')}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.path} onClick={(ev) => { const n = new Set(ev.ctrlKey ? sel : []); n.has(e.path) ? n.delete(e.path) : n.add(e.path); setSel(n) }} onDoubleClick={() => openEntry(e)} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (!sel.has(e.path)) setSel(new Set([e.path])); setCtx({ x: ev.clientX, y: ev.clientY, e }) }}
                  className={cn('cursor-default transition-colors', sel.has(e.path) ? 'bg-accent/20' : 'hover:bg-surface-200/60', e.isHidden && 'opacity-50')}>
                  <td className="px-3 py-1.5 flex items-center gap-2 truncate">{iconFor(e)}<span className="truncate">{e.name}</span></td>
                  <td className="px-3 py-1.5 text-xs text-surface-500 uppercase">{e.isDirectory ? '' : e.ext}</td>
                  <td className="px-3 py-1.5 text-xs text-surface-600 text-end font-mono">{e.isDirectory ? '—' : formatBytes(e.size)}</td>
                  <td className="px-3 py-1.5 text-xs text-surface-600">{formatDate(e.modified, settings.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 p-3">
            {list.map((e) => (
              <button key={e.path} onClick={(ev) => { const n = new Set(ev.ctrlKey ? sel : []); n.has(e.path) ? n.delete(e.path) : n.add(e.path); setSel(n) }} onDoubleClick={() => openEntry(e)} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); setSel(new Set([e.path])); setCtx({ x: ev.clientX, y: ev.clientY, e }) }}
                className={cn('flex flex-col items-center gap-2 rounded-xl p-3 transition-all duration-300', sel.has(e.path) ? 'bg-accent/20' : 'hover:bg-surface-200/60')}>
                {IMAGE_EXT.has(e.ext) && e.size < 15e6 ? <img src={toFileUrl(e.path)} className="h-12 w-12 object-cover rounded-lg" loading="lazy" decoding="async" /> : <span className="h-12 flex items-center">{iconFor(e, 36)}</span>}
                <span className="text-xs truncate w-full text-center">{e.name}</span>
              </button>
            ))}
          </div>
        )}
        {list.length === 0 && !loading && <Empty icon={<FolderOpen size={40} />} text={t('common.empty')} action={<div className="flex gap-2"><button className="btn-soft" onClick={() => { setCreating('folder'); setNewName('') }}><Plus size={15} />{t('files.newFolder')}</button><button className="btn-soft" onClick={() => { setCreating('file'); setNewName('') }}><Plus size={15} />{t('files.newFile')}</button></div>} />}
      </div>
      <footer className="flex items-center gap-3 px-3 py-1.5 border-t border-surface-300/60 text-[11px] text-surface-500">
        <span>{t('common.items', { count: entries.length })}</span>{sel.size > 0 && <span>• {t('common.selected', { count: sel.size })} ({formatBytes(selected.reduce((a, e) => a + e.size, 0))})</span>}
        {clipboardState && <span className="ms-auto">📋 {clipboardState.paths.length}</span>}
      </footer>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems as any} onClose={() => setCtx(null)} />}
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title={t('common.rename')}><input autoFocus className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doRename()} onFocus={(e) => e.target.select()} /><div className="flex justify-end gap-2 mt-4"><button className="btn-ghost" onClick={() => setRenaming(null)}>{t('common.cancel')}</button><button className="btn-primary" onClick={doRename}>{t('common.rename')}</button></div></Modal>
      <Modal open={!!creating} onClose={() => setCreating(null)} title={creating === 'folder' ? t('files.newFolder') : t('files.newFile')}><input autoFocus className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doCreate()} placeholder={t('common.name')} /><div className="flex justify-end gap-2 mt-4"><button className="btn-ghost" onClick={() => setCreating(null)}>{t('common.cancel')}</button><button className="btn-primary" onClick={doCreate}>{t('common.create')}</button></div></Modal>
      <Modal open={!!props} onClose={() => setProps(null)} title={t('files.properties')}>
        {props && <div className="space-y-2 text-sm selectable">
          <div className="flex items-center gap-3 mb-4">{iconFor(props.e, 40)}<div><p className="font-semibold">{props.e.name}</p><p className="text-xs text-surface-500 font-mono break-all" dir="ltr">{props.e.path}</p></div></div>
          <Field label={t('common.size')}><p>{props.e.isDirectory ? (props.size ? `${formatBytes(props.size.size)} • ${t('files.filesFolders', { files: props.size.files, folders: props.size.folders })}` : t('files.calculating')) : `${formatBytes(props.e.size)} (${props.e.size.toLocaleString()} B)`}</p></Field>
          <Field label={t('common.modified')}><p>{formatDate(props.e.modified, settings.language)}</p></Field>
          <Field label={t('common.created')}><p>{formatDate(props.e.created, settings.language)}</p></Field>
          {props.hash && <Field label="SHA-256"><p className="font-mono text-xs break-all" dir="ltr">{props.hash}</p></Field>}
          {!props.e.isDirectory && !props.hash && <div className="flex gap-2 flex-wrap">{(['md5', 'sha1', 'sha256', 'sha512'] as const).map((a) => <button key={a} className="btn-soft text-xs" onClick={async () => setProps({ ...props, hash: `${a.toUpperCase()}: ` + (await invoke<string>('fs:hash', props.e.path, a)) })}>{a.toUpperCase()}</button>)}</div>}
        </div>}
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.e.name} wide>
        {preview && (IMAGE_EXT.has(preview.e.ext) ? <img src={toFileUrl(preview.e.path)} className="max-h-[70vh] mx-auto rounded-xl" /> : VIDEO_EXT.has(preview.e.ext) ? <video src={toFileUrl(preview.e.path)} controls preload="metadata" className="max-h-[70vh] w-full rounded-xl" /> : AUDIO_EXT.has(preview.e.ext) ? <audio src={toFileUrl(preview.e.path)} controls preload="metadata" className="w-full" /> : preview.text !== undefined ? <pre className="text-xs font-mono max-h-[70vh] overflow-auto selectable whitespace-pre-wrap" dir="ltr">{preview.text.slice(0, 20000)}{preview.text.length > 20000 ? '\n… (truncated)' : ''}</pre> : <p className="text-center text-surface-500 p-10">{t('files.noPreview')}</p>)}
      </Modal>
    </div>
  )
}

export default function Files() {
  const { t } = useTranslation()
  const { navigate, pageParams } = useApp()
  const [special, setSpecial] = useState<Record<string, string> | null>(null)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [dual, setDual] = useState(false)
  const [active, setActive] = useState<0 | 1>(0)
  const [roots, setRoots] = useState<[string, string] | null>(null)
  const [favs, setFavs] = useState<string[]>([])
  const [key, setKey] = useState(0)
  // Live paths of the two panes (they navigate internally); favorites use these.
  const liveRef = useRef<[string, string]>(['', ''])
  const [loadError, setLoadError] = useState(false)
  const loadRoots = useCallback(() => {
    setLoadError(false)
    Promise.all([invoke<Record<string, string>>('fs:special'), invoke<DriveInfo[]>('fs:drives'), invoke<string[]>('data:get', 'fileFavorites', [])]).then(([s, d, f]) => {
      setSpecial(s); setDrives(d); setFavs(f); setRoots([(pageParams.path as string) || s.home, s.documents])
    }).catch(() => setLoadError(true))
  }, [pageParams.path])
  useEffect(() => { loadRoots() }, [loadRoots])
  const goTo = (p: string) => { setRoots((r) => { const n: [string, string] = r ? [...r] as any : [p, p]; n[active] = p; return n }); setKey((k) => k + 1) }
  // Deep-link while mounted (e.g. "show in folder" twice): first mount consumes
  // pageParams.path via the loader above; later navigations re-target the pane.
  const paramsSeen = useRef(false)
  useEffect(() => {
    if (!paramsSeen.current) { paramsSeen.current = true; return }
    const p = pageParams.path as string | undefined
    if (p && roots) goTo(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParams])
  const onOpenIn = (kind: 'editor' | 'images' | 'video' | 'compress', p: string) => navigate(kind, { path: p })
  const qa = special ? [['home', special.home, <Home size={15} />], ['desktop', special.desktop, <Monitor size={15} />], ['documents', special.documents, <FileText size={15} />], ['downloads', special.downloads, <Download size={15} />], ['pictures', special.pictures, <ImgIcon size={15} />], ['videos', special.videos, <Film size={15} />], ['music', special.music, <Music size={15} />]] as const : []
  if (!roots) return loadError ? <Empty icon={<FolderOpen size={40} />} text={t('app.loadFailed')} action={<button className="btn-primary" onClick={loadRoots}><RefreshCw size={15} />{t('common.retry')}</button>} /> : <Empty icon={<RefreshCw size={40} className="animate-spin" />} text={t('common.loading')} />
  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<FolderOpen size={22} />} title={t('files.title')}>
        <button className={cn('btn-soft', dual && 'bg-accent text-accent-fg')} onClick={() => setDual(!dual)}><Columns size={15} />{t('files.dualPane')}</button>
      </PageHeader>
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(150px,200px)_minmax(0,1fr)] gap-3">
        <aside className="card p-2 overflow-auto space-y-3 min-w-0">
          <div><p className="label px-2 mb-1">{t('files.quickAccess')}</p>{qa.map(([k, p, ic]) => <button key={k} onClick={() => goTo(p)} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-200 transition-colors"><span className="text-accent">{ic}</span>{t(`files.${k}`)}</button>)}</div>
          {favs.length > 0 && <div><p className="label px-2 mb-1">{t('common.favorites')}</p>{favs.map((f) => <button key={f} onClick={() => goTo(f)} onContextMenu={(e) => { e.preventDefault(); const n = favs.filter((x) => x !== f); setFavs(n); invoke('data:set', 'fileFavorites', n) }} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-200 truncate"><Star size={14} className="text-amber-500 shrink-0" /><span className="truncate">{f.split(/[\\/]/).filter(Boolean).pop()}</span></button>)}</div>}
          <div><p className="label px-2 mb-1">{t('files.drives')}</p>{drives.map((d) => <button key={d.path} onClick={() => goTo(d.path)} className="w-full rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-200 transition-colors text-start">
            <div className="flex items-center gap-2.5"><HardDrive size={15} className="text-accent" /><span className="truncate">{d.label} ({d.path.replace(/\\$/, '')})</span></div>
            {d.total && <><div className="progress h-1 mt-1.5"><div style={{ width: `${((d.total - (d.free || 0)) / d.total) * 100}%` }} /></div><p className="text-[10px] text-surface-500 mt-0.5">{formatBytes(d.free || 0, 0)} free of {formatBytes(d.total, 0)}</p></>}
          </button>)}</div>
          <button className="btn-soft w-full text-xs" onClick={() => { const p = liveRef.current[active] || roots[active]; if (!favs.includes(p)) { const n = [...favs, p]; setFavs(n); invoke('data:set', 'fileFavorites', n) } }}><Star size={13} />{t('common.add')} {t('common.favorites')}</button>
        </aside>
        <div className={cn('grid gap-3 min-h-0 min-w-0', dual ? 'grid-cols-1 2xl:grid-cols-2' : 'grid-cols-1')}>
          <Pane key={`a${key}${roots[0]}`} initial={roots[0]} active={!dual || active === 0} onActivate={() => setActive(0)} onOpenIn={onOpenIn} onPathChange={(p) => { liveRef.current[0] = p }} />
          {dual && <Pane key={`b${key}${roots[1]}`} initial={roots[1]} active={active === 1} onActivate={() => setActive(1)} onOpenIn={onOpenIn} onPathChange={(p) => { liveRef.current[1] = p }} />}
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MonacoEditor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { Code2, FolderOpen, Plus, Save, X, WrapText, Map as MapIcon, Search } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty } from '@/components/ui'
import { invoke } from '@/lib/api'
import { cn, extToLang, stripPath, uid } from '@/lib/utils'

// Bundle monaco locally (no CDN) for offline + CSP compliance
// @ts-ignore
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
// @ts-ignore
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
// @ts-ignore
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
// @ts-ignore
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
// @ts-ignore
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
;(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}
loader.config({ monaco })

interface Tab { id: string; path?: string; name: string; content: string; saved: string; language: string; savedMtime?: number; conflict?: boolean }
const LANGS = ['plaintext', 'javascript', 'typescript', 'json', 'html', 'css', 'scss', 'markdown', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'sql', 'shell', 'powershell', 'bat', 'yaml', 'xml', 'ini', 'dart', 'kotlin', 'swift', 'lua', 'r', 'perl', 'dockerfile', 'graphql']

const SESSION_KEY = 'dh-editor-tabs-v1'
interface StashedTab { path?: string; name: string; language: string; content?: string }
function stashTabs(tabs: Tab[]) {
  try {
    // Persist only the tab list + small untitled buffers (cap 1MB total) so the
    // session survives page switches and restarts without bloating storage.
    let budget = 1024 * 1024
    const stashed: StashedTab[] = tabs.slice(0, 32).map((tb) => {
      const s: StashedTab = { path: tb.path, name: tb.name, language: tb.language }
      if (!tb.path && tb.content && tb.content.length <= budget) { s.content = tb.content; budget -= tb.content.length }
      return s
    })
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(stashed))
  } catch { /* storage full/blocked — session restore is best-effort */ }
}
function readStash(): StashedTab[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.name === 'string').slice(0, 32) : []
  } catch { return [] }
}

export default function Editor() {
  const { t } = useTranslation()
  const { settings, setSettings, pageParams, toast } = useApp()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [cur, setCur] = useState<string | null>(null)
  const [pos, setPos] = useState({ l: 1, c: 1 })
  const [restored, setRestored] = useState(false)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const tab = tabs.find((x) => x.id === cur)

  const tabsRef = useRef<Tab[]>([])
  tabsRef.current = tabs

  // Restore previous session once (file tabs are re-read from disk so external
  // edits are never masked by a stale buffer). Oversized files are skipped.
  useEffect(() => {
    if (restored) return
    setRestored(true)
    const stashed = readStash()
    if (!stashed.length) return
    ;(async () => {
      const next: Tab[] = []
      for (const s of stashed) {
        if (s.path) {
          try {
            const st = await invoke<{ size: number; modified: number }>('fs:stat', s.path)
            if (st.size > 20 * 1024 * 1024) continue
            const content = await invoke<string>('fs:readText', s.path)
            next.push({ id: uid(), path: s.path, name: stripPath(s.path), content, saved: content, savedMtime: st.modified, language: extToLang(s.path.split('.').pop() || '') })
          } catch { /* file moved/deleted — skip */ }
        } else if (s.content) {
          next.push({ id: uid(), name: s.name, content: s.content, saved: s.content, language: s.language })
        }
      }
      if (next.length) { setTabs(next); setCur(next[0].id) }
    })()
  }, [restored])

  // Stash the tab list whenever it changes (debounced: typing fires per keystroke).
  useEffect(() => {
    const i = setTimeout(() => stashTabs(tabsRef.current), 500)
    return () => clearTimeout(i)
  }, [tabs])

  // Auto-save dirty tabs that have a file path (skips untitled tabs).
  // External edits win: if mtime moved under us, autosave pauses for that tab
  // and warns once instead of silently clobbering (manual Save still works).
  const conflictWarned = useRef(new Set<string>())
  useEffect(() => {
    const sec = settings.autoSaveIntervalSec
    if (!sec || sec <= 0) return
    const i = setInterval(async () => {
      if (document.hidden) return
      for (const tb of tabsRef.current) {
        if (!tb.path || tb.content === tb.saved || tb.conflict) continue
        try {
          const st = await invoke<{ modified: number }>('fs:stat', tb.path)
          if (tb.savedMtime !== undefined && st.modified !== tb.savedMtime) {
            setTabs((s) => s.map((x) => (x.id === tb.id ? { ...x, conflict: true } : x)))
            if (!conflictWarned.current.has(tb.id)) {
              conflictWarned.current.add(tb.id)
              toast(t('editor.externalChange', { name: tb.name }), 'warning')
            }
            continue
          }
          await invoke('fs:writeText', tb.path, tb.content)
          const fresh = await invoke<{ modified: number }>('fs:stat', tb.path).catch(() => null)
          setTabs((s) => s.map((x) => (x.id === tb.id ? { ...x, saved: tb.content, savedMtime: fresh?.modified ?? x.savedMtime, conflict: false } : x)))
        } catch { /* retry next tick */ }
      }
    }, sec * 1000)
    return () => clearInterval(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoSaveIntervalSec])

  const openPath = async (p: string) => {
    const ex = tabsRef.current.find((x) => x.path === p); if (ex) return setCur(ex.id)
    try {
      const st = await invoke<{ size: number; modified: number }>('fs:stat', p)
      if (st.size > 20 * 1024 * 1024) { toast(t('files.tooLargeEditor'), 'warning'); return }
      const content = await invoke<string>('fs:readText', p)
      const name = stripPath(p)
      const tb: Tab = { id: uid(), path: p, name, content, saved: content, savedMtime: st.modified, language: extToLang(name.split('.').pop() || '') }
      conflictWarned.current.delete(tb.id)
      setTabs((s) => [...s, tb]); setCur(tb.id)
    } catch (e: any) { toast(e.message, 'error') }
  }
  const openedParam = useRef<string | null>(null)
  useEffect(() => {
    const p = pageParams.path as string | undefined
    if (p) {
      if (openedParam.current !== `${p}` || !tabsRef.current.some((x) => x.path === p)) {
        openedParam.current = `${p}`
        openPath(p)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParams])

  const openDialog = async () => {
    const ps = await invoke<string[]>('dialog:openFile', { multi: true })
    // Cap multi-open: each file spins IO + a Monaco model.
    for (const p of ps.slice(0, 10)) await openPath(p)
  }
  const newTab = () => {
    // uid-based names can never collide after closing tabs (count-based names could).
    const tb: Tab = { id: uid(), name: `untitled-${uid().slice(0, 6)}.txt`, content: '', saved: '', language: 'plaintext' }
    setTabs((s) => [...s, tb]); setCur(tb.id)
  }
  const save = async (as = false) => {
    if (!tab) return
    let p = tab.path
    if (!p || as) { p = (await invoke<string | null>('dialog:save', { defaultPath: tab.name })) || undefined; if (!p) return }
    try {
      await invoke('fs:writeText', p, tab.content)
      const fresh = await invoke<{ modified: number }>('fs:stat', p).catch(() => null)
      conflictWarned.current.delete(tab.id)
      setTabs((s) => s.map((x) => (x.id === tab.id ? { ...x, path: p, name: stripPath(p!), saved: x.content, savedMtime: fresh?.modified ?? x.savedMtime, conflict: false, language: extToLang(p!.split('.').pop() || '') } : x)))
      toast(t('toast.saved'))
    } catch (e: any) { toast(e.message, 'error') }
  }
  const close = async (id: string) => {
    const tb = tabsRef.current.find((x) => x.id === id)
    if (tb && tb.content !== tb.saved && !(await invoke('dialog:confirm', t('editor.unsaved'), tb.name))) return
    conflictWarned.current.delete(id)
    const rest = tabsRef.current.filter((x) => x.id !== id); setTabs(rest); if (cur === id) setCur(rest[rest.length - 1]?.id ?? null)
  }
  // Stable keyboard shortcuts: refs avoid re-subscribing on every keystroke.
  const saveRef = useRef(save); saveRef.current = save
  const miscRef = useRef({ openDialog, newTab, close, tabs, cur })
  miscRef.current = { openDialog, newTab, close, tabs, cur }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const { tabs: tl, cur: c } = miscRef.current
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveRef.current(e.shiftKey) }
      if (e.ctrlKey && e.key === 'o') { e.preventDefault(); miscRef.current.openDialog() }
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); miscRef.current.newTab() }
      if (e.ctrlKey && e.key === 'w' && c) { e.preventDefault(); miscRef.current.close(c) }
      if (e.ctrlKey && e.key === 'Tab' && tl.length > 1) { e.preventDefault(); const i = tl.findIndex((x) => x.id === c); setCur(tl[(i + 1) % tl.length].id) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  // Theme follows the app setting (reactive) instead of a one-time DOM read.
  const isDark = settings.theme === 'system'
    ? (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
    : settings.theme === 'dark'
  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<Code2 size={22} />} title={t('editor.title')} subtitle={tab?.path}>
        <button className="btn-soft" onClick={newTab}><Plus size={15} />{t('editor.newFile')}</button>
        <button className="btn-soft" onClick={openDialog}><FolderOpen size={15} />{t('editor.openFile')}</button>
        <button className="btn-primary" onClick={() => save()} disabled={!tab}><Save size={15} />{t('editor.save')}</button>
      </PageHeader>
      <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex items-center border-b border-surface-300/60 overflow-x-auto shrink-0">
          {tabs.map((x) => (
            <div key={x.id} onClick={() => setCur(x.id)} onAuxClick={(e) => e.button === 1 && close(x.id)} className={cn('group flex items-center gap-2 px-3 py-2 text-xs border-e border-surface-300/40 cursor-pointer shrink-0 transition-colors', cur === x.id ? 'bg-surface-200 text-surface-900 border-b-2 border-b-accent' : 'text-surface-600 hover:bg-surface-200/50')}>
              <span className={cn(x.content !== x.saved && 'italic')}>{x.name}</span>{x.content !== x.saved && <span className="h-2 w-2 rounded-full bg-accent" />}{x.conflict && <span className="text-[10px] text-amber-500">⚠</span>}
              <button className="opacity-60 hover:opacity-100 focus-visible:opacity-100 hover:text-rose-500" aria-label={t('common.close')} onClick={(e) => { e.stopPropagation(); close(x.id) }}><X size={13} /></button>
            </div>
          ))}
        </div>
        {!tab ? <Empty icon={<Code2 size={40} />} text={t('editor.noFile')} action={<div className="flex gap-2"><button className="btn-primary" onClick={newTab}><Plus size={15} />{t('editor.newFile')}</button><button className="btn-soft" onClick={openDialog}><FolderOpen size={15} />{t('editor.openFile')}</button></div>} /> : (
          <>
            <div className="flex-1 min-h-0" dir="ltr">
              <MonacoEditor key={tab.id} height="100%" language={tab.language} value={tab.content} theme={isDark ? 'vs-dark' : 'light'}
                onChange={(v) => setTabs((s) => s.map((x) => (x.id === tab.id ? { ...x, content: v ?? '' } : x)))}
                onMount={(ed) => { edRef.current = ed; ed.onDidChangeCursorPosition((e) => setPos({ l: e.position.lineNumber, c: e.position.column })) }}
                options={{ fontSize: settings.editorFontSize, wordWrap: settings.editorWordWrap ? 'on' : 'off', minimap: { enabled: settings.editorMinimap }, tabSize: settings.editorTabSize, fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace', fontLigatures: false, smoothScrolling: false, cursorBlinking: 'blink', cursorSmoothCaretAnimation: 'off', renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, automaticLayout: true, padding: { top: 12 }, scrollBeyondLastLine: false, formatOnPaste: true }} />
            </div>
            <footer className="flex items-center gap-3 px-3 py-1 border-t border-surface-300/60 text-[11px] text-surface-600 shrink-0">
              <span>{t('editor.line')} {pos.l}, {t('editor.col')} {pos.c}</span><span>{t('notes.chars', { count: tab.content.length })}</span>
              <span className="ms-auto flex items-center gap-2">
                <button className="btn-icon p-1" title={t('editor.find')} onClick={() => edRef.current?.getAction('actions.find')?.run()}><Search size={13} /></button>
                <button className={cn('btn-icon p-1', settings.editorWordWrap && 'text-accent')} title={t('editor.wordWrap')} onClick={() => setSettings({ editorWordWrap: !settings.editorWordWrap })}><WrapText size={13} /></button>
                <button className={cn('btn-icon p-1', settings.editorMinimap && 'text-accent')} title={t('editor.minimap')} onClick={() => setSettings({ editorMinimap: !settings.editorMinimap })}><MapIcon size={13} /></button>
                <button className="hover:text-accent" onClick={() => edRef.current?.getAction('editor.action.formatDocument')?.run()}>{t('editor.format')}</button>
                <select className="bg-transparent outline-none cursor-pointer" value={tab.language} onChange={(e) => setTabs((s) => s.map((x) => (x.id === tab.id ? { ...x, language: e.target.value } : x)))}>{LANGS.map((l) => <option key={l} value={l}>{l}</option>)}</select>
                <select className="bg-transparent outline-none cursor-pointer" value={settings.editorFontSize} onChange={(e) => setSettings({ editorFontSize: Number(e.target.value) })}>{[11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((n) => <option key={n} value={n}>{n}px</option>)}</select>
              </span>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

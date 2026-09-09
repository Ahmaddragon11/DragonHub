import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, FilePlus, FolderPlus, X, Lock, Package, FolderOpen, ShieldCheck, Loader2, FileArchive, Folder, File } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Progress, Field, Toggle } from '@/components/ui'
import { invoke, on } from '@/lib/api'
import { formatBytes, stripPath, uid, cn, ARCHIVE_EXT } from '@/lib/utils'
import type { ArchiveFormat, ArchiveEntry, JobProgress } from '@shared/types'

const FORMATS: { f: ArchiveFormat; ext: string; enc: boolean }[] = [{ f: 'zip', ext: 'zip', enc: true }, { f: '7z', ext: '7z', enc: true }, { f: 'tar', ext: 'tar', enc: false }, { f: 'gzip', ext: 'tar.gz', enc: false }, { f: 'bzip2', ext: 'tar.bz2', enc: false }, { f: 'xz', ext: 'tar.xz', enc: false }]

export default function Compress() {
  const { t } = useTranslation()
  const { pageParams, toast } = useApp()
  const [tab, setTab] = useState<'compress' | 'extract' | 'browse'>('compress')
  const [inputs, setInputs] = useState<string[]>([])
  const [format, setFormat] = useState<ArchiveFormat>('zip')
  const [level, setLevel] = useState<0 | 1 | 3 | 5 | 7 | 9>(5)
  const [pw, setPw] = useState('')
  const [solid, setSolid] = useState(true)
  const [split, setSplit] = useState(0)
  const [delAfter, setDelAfter] = useState(false)
  const [outName, setOutName] = useState('archive')
  const [outDir, setOutDir] = useState('')
  const [archive, setArchive] = useState('')
  const [dest, setDest] = useState('')
  const [xpw, setXpw] = useState('')
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null)
  const [job, setJob] = useState<JobProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)

  useEffect(() => on('job:progress', (p: any) => { if (p && typeof p.id === 'string' && (p.id.startsWith('zip-') || p.id === 'c' || p.id === 'x')) setJob(p) }), [])
  // Consume the incoming path once: later navigations with a new path re-apply,
  // but unrelated param changes must not clobber the user's inputs.
  const consumedPath = useRef<string | null>(null)
  useEffect(() => {
    const p = pageParams.path as string | undefined
    if (!p || consumedPath.current === p) return
    consumedPath.current = p
    const ext = p.split('.').pop()?.toLowerCase() || ''
    if (ARCHIVE_EXT.has(ext)) { setArchive(p); setTab('extract'); invoke<{ dir: string; name: string }>('fs:pathInfo', p).then((i) => setDest(`${i.dir}${window.dh.platform === 'win32' ? '\\' : '/'}${i.name}`)) }
    else { setInputs([p]); setTab('compress'); invoke<{ dir: string; name: string }>('fs:pathInfo', p).then((i) => { setOutDir(i.dir); setOutName(i.name) }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageParams])

  const addFiles = async () => { const ps = await invoke<string[]>('dialog:openFile', { multi: true }); if (ps.length) { setInputs((s) => Array.from(new Set([...s, ...ps]))); if (!outDir) invoke<{ dir: string; name: string }>('fs:pathInfo', ps[0]).then((i) => { setOutDir(i.dir); if (outName === 'archive') setOutName(i.name) }) } }
  const addFolder = async () => { const p = await invoke<string | null>('dialog:openFolder'); if (p) { setInputs((s) => Array.from(new Set([...s, p]))); if (!outDir) invoke<{ dir: string; base: string }>('fs:pathInfo', p).then((i) => { setOutDir(i.dir); setOutName(i.base) }) } }
  const fmtInfo = FORMATS.find((x) => x.f === format)!

  const doCompress = async () => {
    if (!inputs.length || !outDir) return
    setBusy(true); setJob({ id: 'c', percent: 0, done: false })
    try {
      const out = await invoke<string>('fs:join', outDir, `${outName}.${fmtInfo.ext}`)
      const id = 'zip-' + uid()
      const res = await invoke<string>('zip:compressJob', id, inputs, out, { format, level, password: fmtInfo.enc && pw ? pw : undefined, solid, splitSizeMB: split || undefined, deleteAfter: delAfter })
      toast(`${t('compress.done')}: ${stripPath(res)}`)
    } catch (e: any) { toast(e.message, 'error') } finally { setBusy(false); setJob(null) }
  }
  const pickArchive = async () => { const ps = await invoke<string[]>('dialog:openFile', { filters: [{ name: 'Archives', extensions: [...ARCHIVE_EXT] }] }); if (ps[0]) { setArchive(ps[0]); setEntries(null); setTestResult(null); const i = await invoke<{ dir: string; name: string }>('fs:pathInfo', ps[0]); setDest(`${i.dir}${window.dh.platform === 'win32' ? '\\' : '/'}${i.name}`) } }
  const doExtract = async () => {
    if (!archive || !dest) return
    setBusy(true); setJob({ id: 'x', percent: 0, done: false })
    try { await invoke('zip:extract', 'zip-' + uid(), archive, dest, xpw || undefined); toast(t('compress.extracted')) } catch (e: any) { toast(e.message, 'error') } finally { setBusy(false); setJob(null) }
  }
  const doList = async () => { if (!archive) return; setBusy(true); try { setEntries(await invoke<ArchiveEntry[]>('zip:list', archive, xpw || undefined)); setTab('browse') } catch (e: any) { toast(e.message, 'error') } finally { setBusy(false) } }
  const doTest = async () => { if (!archive) return; setBusy(true); try { const ok = await invoke<boolean>('zip:test', archive, xpw || undefined); setTestResult(ok); toast(ok ? t('compress.valid') : t('compress.invalid'), ok ? 'success' : 'error') } finally { setBusy(false) } }
  const totalSize = entries?.reduce((a, e) => a + e.size, 0) ?? 0, totalPacked = entries?.reduce((a, e) => a + e.packed, 0) ?? 0

  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<Archive size={22} />} title={t('compress.title')} subtitle="7-Zip engine • ZIP / 7z / TAR / GZIP / BZIP2 / XZ • AES-256">
        <div className="flex rounded-lg bg-surface-200 p-0.5">{(['compress', 'extract', 'browse'] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={cn('px-3 py-1.5 rounded-md text-xs transition-colors', tab === k && 'bg-accent text-accent-fg')}>{t(`compress.${k}Tab`)}</button>)}</div>
      </PageHeader>
      {job && !job.done && <div className="card p-4 mb-4 animate-slide-up"><div className="flex items-center gap-3 mb-2 text-sm"><Loader2 size={16} className="animate-spin text-accent" /><span className="flex-1 truncate">{job.message || t('common.processing')}</span><span className="font-mono text-xs">{Math.round(job.percent)}%</span></div><Progress value={job.percent} /></div>}

      {tab === 'compress' && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-4 flex-1 min-h-0">
          <section className="card flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-surface-300/60"><button className="btn-soft" onClick={addFiles}><FilePlus size={15} />{t('compress.addFiles')}</button><button className="btn-soft" onClick={addFolder}><FolderPlus size={15} />{t('compress.addFolder')}</button><span className="ms-auto text-xs text-surface-500">{t('common.items', { count: inputs.length })}</span><button className="btn-ghost text-xs" onClick={() => setInputs([])} disabled={!inputs.length}>{t('compress.clear')}</button></div>
            <div className="flex-1 overflow-auto p-2 space-y-1 stagger" onDragOver={(e) => e.preventDefault()}>
              {inputs.length === 0 && <p className="text-center text-sm text-surface-500 p-10">{t('compress.addFiles')} / {t('compress.addFolder')}</p>}
              {inputs.map((p) => <div key={p} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-surface-200/50 text-sm"><Package size={15} className="text-accent shrink-0" /><span className="flex-1 truncate font-mono text-xs" dir="ltr">{p}</span><button onClick={() => setInputs((s) => s.filter((x) => x !== p))} className="hover:text-rose-500"><X size={14} /></button></div>)}
            </div>
          </section>
          <aside className="card p-4 space-y-4 overflow-auto">
            <Field label={t('compress.format')}><div className="grid grid-cols-3 gap-1.5">{FORMATS.map((f) => <button key={f.f} onClick={() => setFormat(f.f)} className={cn('rounded-lg py-2 text-xs font-mono transition-all', format === f.f ? 'bg-accent text-accent-fg shadow-glow' : 'bg-surface-200 hover:bg-surface-300')}>.{f.ext}</button>)}</div></Field>
            <Field label={`${t('compress.level')}: ${t(`compress.levels.${level}`)}`}><input type="range" min={0} max={5} value={[0, 1, 3, 5, 7, 9].indexOf(level)} onChange={(e) => setLevel([0, 1, 3, 5, 7, 9][Number(e.target.value)] as any)} className="w-full accent-[rgb(var(--accent))]" /></Field>
            {fmtInfo.enc && <Field label={t('compress.password')}><div className="relative"><Lock size={14} className="absolute start-3 top-3 text-surface-500" /><input type="password" className="input ps-9" value={pw} onChange={(e) => setPw(e.target.value)} /></div></Field>}
            {format === '7z' && <Toggle on={solid} onChange={setSolid} label={t('compress.solid')} />}
            <Field label={t('compress.split')}><input type="number" min={0} className="input" value={split || ''} placeholder="0" onChange={(e) => setSplit(Number(e.target.value))} /></Field>
            <Toggle on={delAfter} onChange={setDelAfter} label={t('compress.deleteAfter')} />
            <div className="divider" />
            <Field label={t('compress.outputName')}><div className="flex items-center gap-1"><input className="input" value={outName} onChange={(e) => setOutName(e.target.value)} /><span className="text-xs font-mono text-surface-500 shrink-0">.{fmtInfo.ext}</span></div></Field>
            <Field label={t('compress.destination')}><div className="flex gap-1"><input className="input font-mono text-xs" dir="ltr" value={outDir} onChange={(e) => setOutDir(e.target.value)} /><button className="btn-soft shrink-0" onClick={async () => { const d = await invoke<string | null>('dialog:openFolder'); if (d) setOutDir(d) }}><FolderOpen size={15} /></button></div></Field>
            <button className="btn-primary w-full py-3" onClick={doCompress} disabled={busy || !inputs.length || !outDir || !outName}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}{t('compress.compressBtn')}</button>
          </aside>
        </div>
      )}

      {tab === 'extract' && (
        <div className="card p-6 max-w-2xl mx-auto w-full space-y-4">
          <Field label={t('compress.archiveFile')}><div className="flex gap-2"><input className="input font-mono text-xs" dir="ltr" value={archive} onChange={(e) => setArchive(e.target.value)} /><button className="btn-soft shrink-0" onClick={pickArchive}><FileArchive size={15} />{t('common.browse')}</button></div></Field>
          <Field label={t('compress.destination')}><div className="flex gap-2"><input className="input font-mono text-xs" dir="ltr" value={dest} onChange={(e) => setDest(e.target.value)} /><button className="btn-soft shrink-0" onClick={async () => { const d = await invoke<string | null>('dialog:openFolder'); if (d) setDest(d) }}><FolderOpen size={15} /></button></div></Field>
          <Field label={`${t('compress.password')} (${t('common.optional')})`}><input type="password" className="input" value={xpw} onChange={(e) => setXpw(e.target.value)} /></Field>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary flex-1 py-3" onClick={doExtract} disabled={busy || !archive || !dest}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}{t('compress.extractBtn')}</button>
            <button className="btn-soft" onClick={doList} disabled={busy || !archive}><FolderOpen size={15} />{t('compress.browseTab')}</button>
            <button className={cn('btn-soft', testResult === true && 'text-emerald-500', testResult === false && 'text-rose-500')} onClick={doTest} disabled={busy || !archive}><ShieldCheck size={15} />{t('compress.test')}</button>
          </div>
        </div>
      )}

      {tab === 'browse' && (
        <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 p-3 border-b border-surface-300/60 text-xs"><button className="btn-soft" onClick={pickArchive}><FileArchive size={15} />{t('common.open')}</button><span className="font-mono truncate flex-1" dir="ltr">{archive}</span>{entries && <span className="text-surface-500">{t('compress.entries', { count: entries.length })} • {formatBytes(totalSize)} → {formatBytes(totalPacked)} ({t('compress.ratio')} {totalSize ? Math.round((totalPacked / totalSize) * 100) : 0}%)</span>}{archive && !entries && <button className="btn-primary" onClick={doList} disabled={busy}>{t('compress.browseTab')}</button>}</div>
          <div className="flex-1 overflow-auto">
            {entries ? <table className="w-full text-sm"><thead className="sticky top-0 bg-surface-100/95 text-[11px] uppercase text-surface-600"><tr><th className="text-start px-3 py-2">{t('common.name')}</th><th className="text-end px-3 py-2 w-28">{t('common.size')}</th><th className="text-end px-3 py-2 w-28">Packed</th><th className="text-start px-3 py-2 w-44">{t('common.modified')}</th></tr></thead>
              <tbody>{entries.map((e, i) => <tr key={i} className="hover:bg-surface-200/60"><td className="px-3 py-1.5 flex items-center gap-2 font-mono text-xs" dir="ltr">{e.isDirectory ? <Folder size={14} className="text-amber-400" /> : <File size={14} className="text-surface-500" />}{e.name}</td><td className="px-3 py-1.5 text-end text-xs font-mono">{e.isDirectory ? '—' : formatBytes(e.size)}</td><td className="px-3 py-1.5 text-end text-xs font-mono">{e.isDirectory ? '—' : formatBytes(e.packed)}</td><td className="px-3 py-1.5 text-xs text-surface-500">{e.modified?.slice(0, 19).replace('T', ' ')}</td></tr>)}</tbody></table>
              : <p className="text-center text-sm text-surface-500 p-10">{t('compress.archiveFile')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

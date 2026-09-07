import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Link, Play, Pause, X, Trash2, FolderOpen, ExternalLink, RotateCcw, Eraser, Youtube, Music, Loader2, FolderInput } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Empty, Progress } from '@/components/ui'
import { invoke, on } from '@/lib/api'
import { formatBytes, formatDuration, cn } from '@/lib/utils'
import type { DownloadItem } from '@shared/types'

export default function Downloads() {
  const { t } = useTranslation()
  const { downloads, setDownloads, settings, setSettings, toast } = useApp()
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<'direct' | 'media'>('direct')
  const [segments, setSegments] = useState(settings.downloadSegments)
  const [audioOnly, setAudioOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<any>(null)
  const [fmt, setFmt] = useState('')
  const [ytStatus, setYtStatus] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all')

  useEffect(() => on('downloads:ytdlp-status', (s: any) => setYtStatus(s.status === 'installing' ? t('downloads.ytdlpInstalling') : null)), [])
  const valid = /^https?:\/\/\S+$/i.test(url.trim())
  useEffect(() => { if (/youtu\.?be|vimeo|tiktok|twitter|x\.com|instagram|facebook|twitch|soundcloud|dailymotion|reddit/i.test(url)) setKind('media') }, [url])

  const add = async () => {
    if (!valid) return toast(t('downloads.invalidUrl'), 'error')
    setBusy(true)
    try {
      if (kind === 'direct') await invoke('dl:add', url.trim(), { segments })
      else await invoke('dl:mediaDownload', url.trim(), { audioOnly, format: fmt || undefined })
      setUrl(''); setInfo(null); setFmt(''); toast(t('toast.created'))
    } catch (e: any) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const fetchInfo = async () => { if (!valid) return; setBusy(true); try { setInfo(await invoke('dl:mediaInfo', url.trim())) } catch (e: any) { toast(e.message, 'error') } finally { setBusy(false) } }
  const act = async (ch: string, ...a: unknown[]) => { try { await invoke(ch, ...a); setDownloads(await invoke<DownloadItem[]>('dl:list')) } catch (e: any) { toast(e.message, 'error') } }
  const chooseDir = async () => { const d = await invoke<string | null>('dialog:openFolder'); if (d) setSettings({ downloadDir: d }) }
  const isActive = (d: DownloadItem) => ['downloading', 'queued', 'paused'].includes(d.status)
  const matches = (d: DownloadItem, f: typeof filter) => f === 'all' || (f === 'active' ? isActive(d) : f === 'completed' ? d.status === 'completed' : ['error', 'cancelled'].includes(d.status))
  const list = downloads.filter((d) => matches(d, filter))
  const totalSpeed = downloads.filter((d) => d.status === 'downloading').reduce((a, d) => a + d.speed, 0)
  const STATUS_C: Record<string, string> = { queued: 'text-surface-500', downloading: 'text-accent', paused: 'text-amber-500', completed: 'text-emerald-500', error: 'text-rose-500', cancelled: 'text-surface-500' }

  return (
    <div className="page-enter h-full flex flex-col">
      <PageHeader icon={<Download size={22} />} title={t('downloads.title')} subtitle={totalSpeed ? `↓ ${formatBytes(totalSpeed)}/s` : undefined}>
        <button className="btn-soft" onClick={chooseDir} title={settings.downloadDir}><FolderInput size={15} />{t('downloads.folder')}</button>
        <button className="btn-soft" onClick={() => invoke('fs:open', settings.downloadDir)}><FolderOpen size={15} /></button>
        <button className="btn-ghost" onClick={() => act('dl:clearFinished')}><Eraser size={15} />{t('downloads.clearFinished')}</button>
      </PageHeader>
      <section className="card p-4 mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1"><Link size={15} className="absolute start-3 top-3 text-surface-500" /><input dir="ltr" className="input ps-9 py-2.5" placeholder={t('downloads.addUrl')} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></div>
          {kind === 'media' && <button className="btn-soft" onClick={fetchInfo} disabled={!valid || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Youtube size={15} />}{t('downloads.fetchInfo')}</button>}
          <button className="btn-primary px-6" onClick={add} disabled={!valid || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{t('downloads.add')}</button>
        </div>
        <div className="flex items-center gap-4 mt-3 flex-wrap text-sm">
          <div className="flex rounded-lg bg-surface-200 p-0.5"><button onClick={() => setKind('direct')} className={cn('px-3 py-1 rounded-md text-xs transition-colors', kind === 'direct' && 'bg-accent text-accent-fg')}>{t('downloads.direct')}</button><button onClick={() => setKind('media')} className={cn('px-3 py-1 rounded-md text-xs transition-colors', kind === 'media' && 'bg-accent text-accent-fg')}>{t('downloads.media')}</button></div>
          {kind === 'direct' ? <label className="flex items-center gap-2 text-xs">{t('downloads.segments')}<select className="select w-auto py-1 text-xs" value={segments} onChange={(e) => setSegments(Number(e.target.value))}>{[1, 2, 4, 8, 16, 32].map((n) => <option key={n}>{n}</option>)}</select></label>
            : <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} className="accent-[rgb(var(--accent))]" /><Music size={13} />{t('downloads.audioOnly')}</label>}
          {ytStatus && <span className="text-xs text-amber-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{ytStatus}</span>}
          <span className="ms-auto text-[11px] text-surface-500 font-mono truncate max-w-xs" dir="ltr">{settings.downloadDir}</span>
        </div>
        {info && (
          <div className="mt-3 flex gap-3 rounded-xl bg-surface-200/60 p-3 animate-slide-up">
            {info.thumbnail && <img src={info.thumbnail} className="h-20 w-36 object-cover rounded-lg" />}
            <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{info.title}</p><p className="text-xs text-surface-500">{info.uploader} • {formatDuration(info.duration)}</p>
              {!audioOnly && <select className="select mt-2 text-xs py-1" value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="">{t('downloads.bestQuality')}</option>{[...info.formats].reverse().filter((f: any) => f.vcodec !== 'none').map((f: any) => <option key={f.id} value={f.acodec === 'none' ? `${f.id}+ba` : f.id}>{f.res} {f.note || ''} .{f.ext} {f.filesize ? formatBytes(f.filesize) : ''}</option>)}</select>}
            </div>
          </div>
        )}
      </section>
      <div className="flex gap-1 mb-3 text-xs">{(['all', 'active', 'completed', 'failed'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={cn('px-3 py-1.5 rounded-lg transition-colors', filter === f ? 'bg-accent text-accent-fg' : 'bg-surface-200 hover:bg-surface-300')}>{t(f === 'all' ? 'common.all' : `downloads.${f}`)} ({downloads.filter((d) => matches(d, f)).length})</button>)}</div>
      <div className="flex-1 min-h-0 overflow-auto space-y-2 stagger">
        {list.length === 0 && <Empty icon={<Download size={40} />} text={t('downloads.noDownloads')} />}
        {list.map((d) => {
          const pct = d.kind === 'media' ? d.received : d.size ? (d.received / d.size) * 100 : 0
          return (
            <div key={d.id} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-surface-200 text-accent">{d.kind === 'media' ? <Youtube size={18} /> : <Download size={18} />}</span>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate" title={d.savePath}>{d.filename || d.url}</p><p className="text-[11px] text-surface-500 truncate" dir="ltr">{d.url}</p></div>
                <div className="text-end text-xs shrink-0">
                  <p className={cn('font-semibold', STATUS_C[d.status])}>{t(`downloads.status.${d.status}`)}{d.status === 'downloading' && d.kind === 'direct' && d.supportsRange && d.segments > 1 && <span className="text-surface-500 font-normal"> ×{d.segments}</span>}</p>
                  <p className="text-surface-500 font-mono">{d.status === 'downloading' ? `${formatBytes(d.speed)}/s • ${formatDuration(d.eta)}` : d.kind === 'media' ? '' : `${formatBytes(d.received)}${d.size ? ` / ${formatBytes(d.size)}` : ''}`}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {d.status === 'downloading' && d.kind === 'direct' && <button className="btn-icon" onClick={() => act('dl:pause', d.id)}><Pause size={15} /></button>}
                  {(d.status === 'paused' || d.status === 'queued') && d.kind === 'direct' && <button className="btn-icon" onClick={() => act('dl:resume', d.id)}><Play size={15} /></button>}
                  {(d.status === 'error' || d.status === 'cancelled') && d.kind === 'direct' && <button className="btn-icon" onClick={() => act('dl:resume', d.id)}><RotateCcw size={15} /></button>}
                  {isActive(d) && <button className="btn-icon hover:text-rose-500" onClick={() => act('dl:cancel', d.id)}><X size={15} /></button>}
                  {d.status === 'completed' && <><button className="btn-icon" title={t('downloads.openFile')} onClick={() => invoke('fs:open', d.savePath)}><ExternalLink size={15} /></button><button className="btn-icon" title={t('downloads.openFolder')} onClick={() => invoke('fs:showInFolder', d.savePath)}><FolderOpen size={15} /></button></>}
                  <button className="btn-icon hover:text-rose-500" title={t('common.delete')} onClick={(e) => act('dl:remove', d.id, e.shiftKey)}><Trash2 size={15} /></button>
                </div>
              </div>
              {isActive(d) && <div className="mt-3 flex items-center gap-3"><Progress value={pct} /><span className="text-xs font-mono w-12 text-end">{pct.toFixed(0)}%</span></div>}
              {d.error && <p className="text-xs text-rose-500 mt-2">{d.error}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

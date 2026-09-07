import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, FolderOpen, Loader2, Play, Camera, Square, Zap, Music, VolumeX, Film, Info } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Progress, Field, Toggle, Slider, Empty } from '@/components/ui'
import { invoke, on, toFileUrl } from '@/lib/api'
import { formatBytes, formatDuration, uid, cn, VIDEO_EXT, AUDIO_EXT } from '@/lib/utils'
import type { MediaInfo, VideoOp, JobProgress } from '@shared/types'

type Fmt = NonNullable<VideoOp['format']>
const VFMT: Fmt[] = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'gif']
const AFMT: Fmt[] = ['mp3', 'aac', 'wav', 'flac', 'ogg']
const PRESETS: VideoOp['preset'][] = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']

export default function Video() {
  const { t } = useTranslation()
  const { pageParams, toast } = useApp()
  const vid = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [isAudio, setIsAudio] = useState(false)
  const [start, setStart] = useState(0); const [end, setEnd] = useState(0)
  const [w, setW] = useState(''); const [h, setH] = useState('')
  const [format, setFormat] = useState<Fmt>('mp4')
  const [vcodec, setVcodec] = useState<VideoOp['videoCodec']>('libx264'); const [acodec, setAcodec] = useState<VideoOp['audioCodec']>('aac')
  const [crf, setCrf] = useState(23); const [preset, setPreset] = useState<VideoOp['preset']>('medium')
  const [fps, setFps] = useState(''); const [speed, setSpeed] = useState(1); const [volume, setVolume] = useState(1)
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0); const [mute, setMute] = useState(false); const [extract, setExtract] = useState(false)

  useEffect(() => on<JobProgress>('job:progress', (p) => {
    if (!p.id.startsWith('vid-')) return
    setProgress(p)
    if (p.done) { setJobId(null); if (p.error) toast(p.error, 'error'); else toast(t('common.done'), 'success') }
  }), [])
  useEffect(() => { if (pageParams?.path) load(String(pageParams.path)) }, [pageParams?.path])

  const load = async (p: string) => {
    setSrc(p); setProgress(null)
    const ext = p.split('.').pop()?.toLowerCase() || ''
    const audio = AUDIO_EXT.has(ext); setIsAudio(audio)
    if (audio) { setFormat('mp3'); setExtract(true) } else { setFormat('mp4'); setExtract(false) }
    try { const i = await invoke('video:info', p); setInfo(i); setStart(0); setEnd(Math.floor(i.duration || 0)); setW(String(i.width || '')); setH(String(i.height || '')) } catch (e: any) { toast(String(e.message || e), 'error') }
  }
  const openFile = async () => {
    const r = await invoke('dialog:openFile', { filters: [{ name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT] }] })
    if (r?.[0]) load(r[0])
  }
  const run = async () => {
    if (!src) return
    const pi = await invoke('fs:pathInfo', src)
    const out = await invoke('dialog:save', { defaultPath: `${pi.dir}${pi.sep}${pi.name}-out.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (!out) return
    const id = 'vid-' + uid(); setJobId(id); setProgress({ id, percent: 0, done: false })
    const op: VideoOp = {
      input: src, output: out, format,
      trim: info && (start > 0 || end < Math.floor(info.duration)) ? { start, end } : undefined,
      resize: !isAudio && (w || h) && (+w !== info?.width || +h !== info?.height) ? { width: w ? +w : undefined, height: h ? +h : undefined } : undefined,
      videoCodec: isAudio || AFMT.includes(format) ? undefined : vcodec, audioCodec: mute ? 'none' : acodec, crf, preset,
      fps: fps ? +fps : undefined, speed: speed !== 1 ? speed : undefined, volume: volume !== 1 ? volume : undefined,
      rotate: rotate || undefined, mute: mute || undefined, extractAudio: extract || AFMT.includes(format) || undefined,
    }
    try { await invoke('video:process', id, op) } catch (e: any) { toast(String(e.message || e), 'error'); setJobId(null) }
  }
  const cancel = async () => { if (jobId) { await invoke('video:cancel', jobId); setJobId(null); setProgress(null) } }
  const capture = async () => {
    if (!src) return
    const at = vid.current?.currentTime ?? 0
    const pi = await invoke('fs:pathInfo', src)
    const out = await invoke('dialog:save', { defaultPath: `${pi.dir}${pi.sep}${pi.name}-frame-${Math.floor(at)}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (!out) return
    try {
      const data = await invoke('video:thumb', src, at)
      const b64 = String(data).split(',')[1]
      await invoke('fs:writeText', out, b64, 'base64')
      toast(t('common.done'), 'success')
    } catch (e: any) { toast(String(e.message || e), 'error') }
  }
  const applyPreset = (p: string) => {
    setMute(false); setExtract(false); setRotate(0); setSpeed(1)
    if (p === 'h264') { setFormat('mp4'); setVcodec('libx264'); setAcodec('aac'); setCrf(23); setPreset('medium') }
    if (p === 'hevc') { setFormat('mp4'); setVcodec('libx265'); setAcodec('aac'); setCrf(28); setPreset('medium') }
    if (p === 'web') { setFormat('webm'); setVcodec('libvpx-vp9'); setAcodec('libopus'); setCrf(31) }
    if (p === 'gif') { setFormat('gif'); setFps('12'); setW('480'); setH('') }
    if (p === 'mp3') { setFormat('mp3'); setExtract(true); setAcodec('libmp3lame') }
    if (p === 'mute') { setFormat('mp4'); setVcodec('copy'); setMute(true) }
  }

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('video.title')} icon={<Clapperboard />}>
        <button className="btn-primary" onClick={openFile}><FolderOpen size={16} /> {t('video.open')}</button>
      </PageHeader>
      <div className="flex flex-1 min-h-0 gap-4 p-4">
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="card flex-1 flex items-center justify-center overflow-hidden bg-black/60 relative">
            {!src ? <Empty icon={<Film size={48} />} text={t('video.noMedia')} action={<button className="btn-primary" onClick={openFile}>{t('video.open')}</button>} />
              : isAudio ? <div className="flex flex-col items-center gap-6 p-8"><Music size={80} className="text-accent animate-float" /><audio src={toFileUrl(src)} controls className="w-96" /></div>
              : <video ref={vid} src={toFileUrl(src)} controls className="max-w-full max-h-full" style={{ transform: `rotate(${rotate}deg)` }} />}
          </div>
          {info && (
            <div className="card p-3 grid grid-cols-6 gap-3 text-xs">
              <div><div className="opacity-50">{t('video.duration')}</div><div className="font-semibold">{formatDuration(info.duration)}</div></div>
              <div><div className="opacity-50">{t('common.size')}</div><div className="font-semibold">{formatBytes(info.size)}</div></div>
              <div><div className="opacity-50">{t('video.bitrate')}</div><div className="font-semibold">{Math.round(info.bitrate / 1000)} kb/s</div></div>
              {info.width && <div><div className="opacity-50">{t('video.resize')}</div><div className="font-semibold">{info.width}×{info.height} @{info.fps?.toFixed(0)}fps</div></div>}
              <div className="col-span-2"><div className="opacity-50">{t('video.codecs')}</div><div className="font-semibold truncate">{[info.videoCodec, info.audioCodec].filter(Boolean).join(' / ')}</div></div>
            </div>
          )}
          <div className="card p-3">
            <div className="label mb-2 flex items-center gap-1"><Zap size={12} /> {t('video.presets')}</div>
            <div className="flex flex-wrap gap-2">
              {[['h264', t('video.presetCompress')], ['hevc', t('video.presetHevc')], ['web', t('video.presetWeb')], ['gif', t('video.presetGif')], ['mp3', t('video.presetMp3')], ['mute', t('video.presetMute')]].map(([k, l]) => (
                <button key={k} className="btn-soft text-xs" onClick={() => applyPreset(k)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="w-80 shrink-0 card overflow-y-auto p-4 space-y-4">
          <section>
            <h3 className="label mb-2">{t('video.trim')}</h3>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('video.start')}><input className="input" type="number" min={0} value={start} onChange={(e) => setStart(+e.target.value)} /></Field>
              <Field label={t('video.end')}><input className="input" type="number" min={0} value={end} onChange={(e) => setEnd(+e.target.value)} /></Field>
            </div>
          </section>
          {!isAudio && (
            <section>
              <h3 className="label mb-2">{t('video.resize')}</h3>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="W" value={w} onChange={(e) => setW(e.target.value.replace(/\D/g, ''))} />
                <input className="input" placeholder="H" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="flex gap-1 mt-2">{[['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']].map(([v, l]) => <button key={v} className="btn-ghost text-xs" onClick={() => { setH(v); setW('') }}>{l}</button>)}</div>
            </section>
          )}
          <div className="divider" />
          <Field label={t('video.format')}>
            <select className="select" value={format} onChange={(e) => setFormat(e.target.value as Fmt)}>
              {!isAudio && <optgroup label="Video">{VFMT.map((f) => <option key={f}>{f}</option>)}</optgroup>}
              <optgroup label="Audio">{AFMT.map((f) => <option key={f}>{f}</option>)}</optgroup>
            </select>
          </Field>
          {!isAudio && !AFMT.includes(format) && format !== 'gif' && (
            <>
              <Field label={t('video.codec')}><select className="select" value={vcodec} onChange={(e) => setVcodec(e.target.value as any)}>{['libx264', 'libx265', 'libvpx-vp9', 'copy'].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label={t('video.crf')}><Slider value={crf} min={0} max={51} step={1} onChange={setCrf} /></Field>
              <Field label={t('video.preset')}><select className="select" value={preset} onChange={(e) => setPreset(e.target.value as any)}>{PRESETS.map((p) => <option key={p}>{p}</option>)}</select></Field>
              <Field label={t('video.fps')}><input className="input" value={fps} onChange={(e) => setFps(e.target.value.replace(/\D/g, ''))} placeholder="—" /></Field>
              <Field label={t('video.rotate')}><div className="flex gap-1">{([0, 90, 180, 270] as const).map((r) => <button key={r} className={cn('btn flex-1 text-xs', rotate === r && 'bg-accent/20 text-accent')} onClick={() => setRotate(r)}>{r}°</button>)}</div></Field>
            </>
          )}
          <Field label={t('video.audioCodec')}><select className="select" value={acodec} disabled={mute} onChange={(e) => setAcodec(e.target.value as any)}>{['aac', 'libmp3lame', 'libopus', 'copy'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label={t('video.speed')}><Slider value={speed} min={0.25} max={4} step={0.25} onChange={setSpeed} suffix="x" /></Field>
          <Field label={t('video.volume')}><Slider value={volume} min={0} max={3} step={0.1} onChange={setVolume} suffix="x" /></Field>
          {!isAudio && <><Toggle on={mute} onChange={setMute} label={t('video.mute')} /><Toggle on={extract} onChange={(v) => { setExtract(v); if (v) setFormat('mp3') }} label={t('video.extractAudio')} /></>}
          <div className="divider" />
          {progress && !progress.done && <div><Progress value={progress.percent} /><div className="text-xs opacity-60 mt-1 truncate">{Math.round(progress.percent)}% {progress.message}</div></div>}
          <div className="flex gap-2">
            {jobId ? <button className="btn-danger flex-1" onClick={cancel}><Square size={14} /> {t('video.cancel')}</button>
              : <button className="btn-primary flex-1" disabled={!src} onClick={run}><Play size={14} /> {t('video.process')}</button>}
            {!isAudio && <button className="btn-soft" disabled={!src || !!jobId} onClick={capture} title={t('video.thumbnail')}><Camera size={14} /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image as ImageIcon, FolderOpen, RotateCw, FlipVertical, FlipHorizontal, Download, Loader2, Layers, X, Info, Maximize2 } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Progress, Field, Toggle, Slider, Empty } from '@/components/ui'
import { invoke, on, toFileUrl } from '@/lib/api'
import { formatBytes, stripPath, uid, cn, IMAGE_EXT } from '@/lib/utils'
import type { ImageOp, JobProgress } from '@shared/types'

type Fmt = NonNullable<ImageOp['format']>
const FORMATS: Fmt[] = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff']

export default function Images() {
  const { t } = useTranslation()
  const { pageParams, toast } = useApp()
  const [tab, setTab] = useState<'edit' | 'batch'>('edit')
  const [src, setSrc] = useState<string | null>(null)
  const [info, setInfo] = useState<any>(null)
  const [preview, setPreview] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  // op state
  const [w, setW] = useState<string>(''); const [h, setH] = useState<string>('')
  const [fit, setFit] = useState<'cover' | 'contain' | 'fill' | 'inside' | 'outside'>('inside')
  const [rotate, setRotate] = useState(0); const [flip, setFlip] = useState(false); const [flop, setFlop] = useState(false)
  const [gray, setGray] = useState(false); const [blur, setBlur] = useState(0); const [sharpen, setSharpen] = useState(false)
  const [bright, setBright] = useState(1); const [sat, setSat] = useState(1); const [hue, setHue] = useState(0)
  const [format, setFormat] = useState<Fmt>('webp'); const [quality, setQuality] = useState(85)
  const [wm, setWm] = useState(''); const [strip, setStrip] = useState(true)
  // batch
  const [batch, setBatch] = useState<string[]>([]); const [bFmt, setBFmt] = useState<Fmt>('webp'); const [bQ, setBQ] = useState(85); const [bW, setBW] = useState('')
  const [bDone, setBDone] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const batchCancel = React.useRef(false)

  // Debounced live-filter preview: slider drags must not recompute GPU filters at 60Hz.
  const [debF, setDebF] = useState({ bright, sat, hue, blur })
  useEffect(() => {
    const i = setTimeout(() => setDebF({ bright, sat, hue, blur }), 120)
    return () => clearTimeout(i)
  }, [bright, sat, hue, blur])
  useEffect(() => () => { batchCancel.current = true }, [])

  useEffect(() => on<JobProgress>('job:progress', (p) => { if (p.id.startsWith('img-')) setProgress(p) }), [])
  useEffect(() => { if (pageParams?.path) load(String(pageParams.path)) }, [pageParams?.path])
  useEffect(() => {
    if (!fullscreen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fullscreen])

  const load = async (p: string) => {
    setSrc(p); setPreview(toFileUrl(p) + '?v=' + Date.now())
    try { const i = await invoke('img:info', p); setInfo(i); setW(String(i.width ?? '')); setH(String(i.height ?? '')) } catch (e: any) { toast(String(e.message || e), 'error') }
  }
  const openFile = async () => {
    const r = await invoke('dialog:openFile', { filters: [{ name: 'Images', extensions: [...IMAGE_EXT] }] })
    if (r?.[0]) load(r[0])
  }
  const buildOp = (input: string, output: string): ImageOp => ({
    input, output,
    resize: w || h ? { width: w ? +w : undefined, height: h ? +h : undefined, fit } : undefined,
    rotate: rotate || undefined, flip: flip || undefined, flop: flop || undefined,
    grayscale: gray || undefined, blur: blur || undefined, sharpen: sharpen || undefined,
    brightness: bright !== 1 ? bright : undefined, saturation: sat !== 1 ? sat : undefined, hue: hue || undefined,
    format, quality, watermarkText: wm || undefined, removeMetadata: strip,
  })
  const exportImg = async () => {
    if (!src) return
    const pi = await invoke('fs:pathInfo', src)
    const ext = format === 'jpeg' ? 'jpg' : format
    const out = await invoke('dialog:save', { defaultPath: `${pi.dir}${pi.sep}${pi.name}-edited.${ext}`, filters: [{ name: format.toUpperCase(), extensions: [ext] }] })
    if (!out) return
    setBusy(true); setProgress(null)
    try { await invoke('img:process', 'img-' + uid(), buildOp(src, out)); toast(t('common.done'), 'success') } catch (e: any) { toast(String(e.message || e), 'error') } finally { setBusy(false) }
  }
  const addBatch = async () => {
    const r = await invoke('dialog:openFile', { multi: true, filters: [{ name: 'Images', extensions: [...IMAGE_EXT] }] })
    if (r?.length) setBatch((b) => Array.from(new Set([...b, ...r])))
  }
  const convertAll = async () => {
    if (!batch.length) return
    const dir = await invoke('dialog:openFolder')
    if (!dir) return
    batchCancel.current = false
    setBusy(true); setBDone(0)
    const ext = bFmt === 'jpeg' ? 'jpg' : bFmt
    for (const f of batch) {
      if (batchCancel.current) break
      try {
        const pi = await invoke('fs:pathInfo', f)
        await invoke('img:process', 'img-b-' + uid(), { input: f, output: `${dir}${pi.sep}${pi.name}.${ext}`, format: bFmt, quality: bQ, resize: bW ? { width: +bW, fit: 'inside' } : undefined, removeMetadata: true } as ImageOp)
      } catch (e: any) { if (!batchCancel.current) toast(`${stripPath(f)}: ${e.message || e}`, 'error') }
      setBDone((d) => d + 1)
    }
    setBusy(false); toast(batchCancel.current ? t('common.cancelAction') : t('common.done'), batchCancel.current ? 'info' : 'success')
  }
  const filterStyle: React.CSSProperties = {
    filter: `${gray ? 'grayscale(1) ' : ''}blur(${debF.blur / 4}px) brightness(${debF.bright}) saturate(${debF.sat}) hue-rotate(${debF.hue}deg)`,
    transform: `rotate(${rotate}deg) scaleX(${flop ? -1 : 1}) scaleY(${flip ? -1 : 1})`, transition: 'transform .3s', willChange: 'filter',
  }

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('images.title')} icon={<ImageIcon />}>
        <div className="flex gap-1 p-1 rounded-xl bg-surface-200">
          <button className={cn('btn-ghost text-sm', tab === 'edit' && 'bg-surface-300')} onClick={() => setTab('edit')}>{t('images.open')}</button>
          <button className={cn('btn-ghost text-sm', tab === 'batch' && 'bg-surface-300')} onClick={() => setTab('batch')}><Layers size={14} /> {t('images.batch')}</button>
        </div>
        {tab === 'edit' && <button className="btn-primary" onClick={openFile}><FolderOpen size={16} /> {t('images.open')}</button>}
      </PageHeader>

      {tab === 'edit' ? (
        <div className="flex flex-1 min-h-0 gap-4 p-4">
          <div className="flex-1 card flex items-center justify-center overflow-hidden relative bg-[radial-gradient(circle_at_center,rgba(255,255,255,.04),transparent)]">
            {src ? <img src={preview} alt="" style={filterStyle} className="max-w-full max-h-full object-contain drop-shadow-2xl" /> : <Empty icon={<ImageIcon size={48} />} text={t('images.noImage')} action={<button className="btn-primary" onClick={openFile}>{t('images.open')}</button>} />}
            {src && (
              <button className="btn-icon absolute top-3 end-3 glass" onClick={() => setFullscreen(true)} title={t('images.fullscreen')} aria-label={t('images.fullscreen')}><Maximize2 size={16} /></button>
            )}
            {info && (
              <div className="absolute bottom-3 start-3 glass rounded-xl px-3 py-2 text-xs flex items-center gap-3">
                <Info size={14} className="text-accent" /> <span>{info.width}×{info.height}</span><span className="opacity-60">{info.format?.toUpperCase()}</span><span className="opacity-60">{formatBytes(info.size || 0)}</span>
              </div>
            )}
          </div>
          <div className="w-80 shrink-0 card overflow-y-auto p-4 space-y-4">
            <section>
              <h3 className="label mb-2">{t('images.resize')}</h3>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('images.width')}><input className="input" value={w} onChange={(e) => setW(e.target.value.replace(/\D/g, ''))} /></Field>
                <Field label={t('images.height')}><input className="input" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ''))} /></Field>
              </div>
              <Field label={t('images.fit')}><select className="select" value={fit} onChange={(e) => setFit(e.target.value as any)}>{['inside', 'cover', 'contain', 'fill', 'outside'].map((f) => <option key={f}>{f}</option>)}</select></Field>
            </section>
            <div className="divider" />
            <section className="flex gap-2">
              <button className="btn flex-1" onClick={() => setRotate((r) => (r + 90) % 360)}><RotateCw size={14} /> {rotate}°</button>
              <button className={cn('btn', flip && 'bg-accent/20 text-accent')} onClick={() => setFlip(!flip)}><FlipVertical size={14} /></button>
              <button className={cn('btn', flop && 'bg-accent/20 text-accent')} onClick={() => setFlop(!flop)}><FlipHorizontal size={14} /></button>
            </section>
            <div className="divider" />
            <section className="space-y-3">
              <h3 className="label">{t('images.filters')}</h3>
              <Toggle on={gray} onChange={setGray} label={t('images.grayscale')} />
              <Toggle on={sharpen} onChange={setSharpen} label={t('images.sharpen')} />
              <Field label={t('images.blur')}><Slider value={blur} min={0} max={50} step={1} onChange={setBlur} /></Field>
              <Field label={t('images.brightness')}><Slider value={bright} min={0.2} max={3} step={0.05} onChange={setBright} /></Field>
              <Field label={t('images.saturation')}><Slider value={sat} min={0} max={3} step={0.05} onChange={setSat} /></Field>
              <Field label={t('images.hue')}><Slider value={hue} min={0} max={360} step={5} onChange={setHue} suffix="°" /></Field>
            </section>
            <div className="divider" />
            <section className="space-y-3">
              <Field label={t('images.format')}><select className="select" value={format} onChange={(e) => setFormat(e.target.value as Fmt)}>{FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Field>
              <Field label={t('images.quality')}><Slider value={quality} min={1} max={100} step={1} onChange={setQuality} suffix="%" /></Field>
              <Field label={t('images.watermark')}><input className="input" value={wm} onChange={(e) => setWm(e.target.value)} placeholder="© AHMADDRAGON" /></Field>
              <Toggle on={strip} onChange={setStrip} label={t('images.removeMetadata')} />
            </section>
            {progress && !progress.done && <Progress value={progress.percent} />}
            <button className="btn-primary w-full" disabled={!src || busy} onClick={exportImg}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} {t('images.exportBtn')}</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 p-4 grid grid-cols-3 gap-4 min-h-0">
          <div className="col-span-2 card p-3 overflow-y-auto">
            <div className="flex gap-2 mb-3">
              <button className="btn" onClick={addBatch}><FolderOpen size={14} /> {t('images.addImages')}</button>
              <button className="btn-ghost" onClick={() => setBatch([])}><X size={14} /> {t('common.clear')}</button>
              <span className="ms-auto text-sm opacity-60">{batch.length}</span>
            </div>
            {batch.length === 0 ? <Empty icon={<Layers size={40} />} text={t('images.addImages')} /> : (
              <div className="grid grid-cols-4 gap-2 stagger">
                {batch.map((f) => (
                  <div key={f} className="relative group rounded-xl overflow-hidden bg-surface-200 aspect-square">
                    <img src={toFileUrl(f)} className="w-full h-full object-cover" alt="" loading="lazy" decoding="async" />
                    <div className="absolute inset-x-0 bottom-0 p-1 text-[10px] truncate bg-black/50 text-white">{stripPath(f)}</div>
                    <button className="absolute top-1 end-1 btn-icon bg-black/60 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setBatch((b) => b.filter((x) => x !== f))}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-4 space-y-3">
            <Field label={t('images.format')}><select className="select" value={bFmt} onChange={(e) => setBFmt(e.target.value as Fmt)}>{FORMATS.map((f) => <option key={f}>{f}</option>)}</select></Field>
            <Field label={t('images.quality')}><Slider value={bQ} min={1} max={100} step={1} onChange={setBQ} suffix="%" /></Field>
            <Field label={t('images.width') + ' (max)'}><input className="input" value={bW} onChange={(e) => setBW(e.target.value.replace(/\D/g, ''))} placeholder="—" /></Field>
            {busy && <Progress value={(bDone / Math.max(1, batch.length)) * 100} />}
            <button className="btn-primary w-full" disabled={!batch.length || busy} onClick={convertAll}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} {t('images.convertAll')}</button>
            {busy && <button className="btn-ghost w-full" onClick={() => { batchCancel.current = true }}>{t('common.cancelAction')}</button>}
          </div>
        </div>
      )}
      {fullscreen && src && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4" onClick={() => setFullscreen(false)} role="dialog" aria-modal="true" aria-label={t('images.fullscreen')}>
          <button className="btn-icon absolute top-4 end-4 bg-white/10 text-white hover:bg-white/20" onClick={() => setFullscreen(false)} title={t('images.exitFullscreen')} aria-label={t('images.exitFullscreen')} autoFocus><X size={18} /></button>
          <img src={preview} alt="" style={filterStyle} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings as SettingsIcon, Palette, Globe, Download, Folder, Code, Shield, Database, Eye, FolderOpen,
  RotateCcw, Upload, Save, Search, BatteryLow, Sparkles, Wifi, DownloadCloud, Bot, Ban, ShieldCheck, Radar, ListChecks, Gauge,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { PageHeader, Toggle, Field, Slider } from '@/components/ui'
import { invoke, on, toFileUrl, errorMessage } from '@/lib/api'
import { cn, IMAGE_EXT } from '@/lib/utils'
import { NAV } from '@/components/Shell'
import { BG_PRESET_IDS } from '@/components/BackgroundLayer'
import type { AccentColor, AppSettings, AiConfig, NetConfig, NetLive } from '@shared/types'

const ACCENTS: { id: AccentColor; c: string }[] = [
  { id: 'violet', c: '#8b5cf6' }, { id: 'blue', c: '#3b82f6' }, { id: 'emerald', c: '#10b981' }, { id: 'rose', c: '#f43f5e' }, { id: 'amber', c: '#f59e0b' }, { id: 'cyan', c: '#06b6d4' }, { id: 'orange', c: '#f97316' },
]

type GroupId = 'look' | 'device' | 'content' | 'secure'

function Section({ id, icon, title, children }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} data-section={id} className="card p-5 scroll-mt-4">
      <h3 className="font-semibold mb-4 flex items-center gap-2 text-accent">{icon} {title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

// Section metadata for the grouped index + search (order matches the render below).
const SECTIONS: { id: string; icon: React.ReactNode; titleKey: string; group: GroupId; keywords: string }[] = [
  { id: 'appearance', icon: <Palette size={16} />, titleKey: 'settings.appearance', group: 'look', keywords: 'theme accent color animations motion glass font scale language compact appearance dark light background wallpaper خلفية مظهر سمة' },
  { id: 'backgrounds', icon: <Sparkles size={16} />, titleKey: 'settings.backgroundsSec', group: 'look', keywords: 'backgrounds animated presets aurora starfield wallpaper خلفيات متحركة شفق نجوم' },
  { id: 'performance', icon: <BatteryLow size={16} />, titleKey: 'settings.performance', group: 'look', keywords: 'low power battery gpu saver performance animations ambient glow quality eco جودة اقتصادي بطارية أداء' },
  { id: 'general', icon: <Globe size={16} />, titleKey: 'settings.general', group: 'device', keywords: 'start page tray startup shortcuts updates language general عام' },
  { id: 'networkSec', icon: <Wifi size={16} />, titleKey: 'settings.networkSec', group: 'device', keywords: 'network quota cap block plan monitoring speed wifi شبكة باقة حظر' },
  { id: 'updatesSec', icon: <DownloadCloud size={16} />, titleKey: 'settings.updatesSec', group: 'device', keywords: 'updates versions releases downgrade install نسخ إصدارات تحديث تنزيل قديمة' },
  { id: 'downloads', icon: <Download size={16} />, titleKey: 'settings.downloads', group: 'content', keywords: 'download folder parallel segments connections' },
  { id: 'filesSec', icon: <Folder size={16} />, titleKey: 'settings.filesSec', group: 'content', keywords: 'confirm delete recycle bin hidden files files' },
  { id: 'editorSec', icon: <Code size={16} />, titleKey: 'settings.editorSec', group: 'content', keywords: 'editor font size tab wrap minimap autosave code' },
  { id: 'aiSec', icon: <Bot size={16} />, titleKey: 'settings.aiSec', group: 'content', keywords: 'ai assistant provider api key chat ذكاء مساعد مزود مفتاح دردشة' },
  { id: 'vaultSec', icon: <Shield size={16} />, titleKey: 'settings.vaultSec', group: 'secure', keywords: 'vault autolock clipboard secret password' },
  { id: 'data', icon: <Database size={16} />, titleKey: 'settings.data', group: 'secure', keywords: 'export import backup reset data' },
  { id: 'privacy', icon: <Eye size={16} />, titleKey: 'settings.privacy', group: 'secure', keywords: 'telemetry privacy' },
]
const GROUPS: GroupId[] = ['look', 'device', 'content', 'secure']

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="flex gap-1 p-1 rounded-xl bg-surface-200 w-fit max-w-full flex-wrap">{options.map(([v, l]) => <button key={v} className={cn('btn-ghost text-sm', value === v && 'bg-surface-300 text-accent')} onClick={() => onChange(v)}>{l}</button>)}</div>
}

/** Median frame time over ~1.5s of rAF samples (first frames skipped as warm-up).
 *  Median resists one-off hitches better than the mean. */
function measureMedianFrameMs(): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = []
    let frames = 0
    let last = performance.now()
    const start = last
    const tick = (now: number) => {
      const dt = now - last
      last = now
      frames++
      if (frames > 10) samples.push(dt)
      if (frames > 106 || now - start > 2200) {
        samples.sort((a, b) => a - b)
        resolve(samples[Math.floor(samples.length / 2)] ?? 16.7)
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** Slider that previews instantly but commits to main (IPC + disk) debounced:
 *  dragging no longer spams settings:set dozens of times per second. */
function DSlider({ value, min, max, step, onCommit }: { value: number; min: number; max: number; step?: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setV(value), [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return <Slider value={v} min={min} max={max} step={step} onChange={(n) => { setV(n); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => onCommit(n), 300) }} />
}

/** Live network summary + quick controls embedded in Settings. */
function NetworkSettingsSection() {
  const { t } = useTranslation()
  const { toast, navigate } = useApp(useShallow((s) => ({ toast: s.toast, navigate: s.navigate })))
  const [cfg, setCfg] = useState<NetConfig | null>(null)
  const [live, setLive] = useState<NetLive | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    invoke<NetConfig>('net:getConfig').then((c) => { if (alive) setCfg(c) }).catch(() => {})
    invoke<NetLive>('net:live').then((l) => { if (alive) setLive(l) }).catch(() => {})
    const off = on<NetLive>('net:update', (l) => { if (alive && l) setLive(l) })
    void invoke('net:setActivity', true).catch(() => {})
    return () => { alive = false; off(); void invoke('net:setActivity', false).catch(() => {}) }
  }, [])

  const patchLimits = async (patch: Partial<NetConfig['limits']>) => {
    if (!cfg) return
    const prev = cfg
    const next = { ...cfg, limits: { ...cfg.limits, ...patch } }
    setCfg(next)
    try {
      const updated = await invoke<NetConfig>('net:setLimits', next.limits)
      setCfg(updated)
    } catch (e) {
      setCfg(prev)
      toast(errorMessage(e, t('toast.error')), 'error')
    }
  }

  const toggleBlock = async () => {
    if (!live) return
    setBusy(true)
    try {
      const r = await invoke<{ blocked: boolean; needsAdmin: boolean }>('net:setBlocked', !live.blocked)
      setLive({ ...live, blocked: r.blocked, needsAdmin: r.needsAdmin })
      if (r.needsAdmin && !r.blocked) toast(t('net.needsAdmin'), 'error')
      else toast(r.blocked ? t('net.blocked') : t('net.unblocked'))
    } catch (e) {
      toast(errorMessage(e, t('toast.error')), 'error')
    } finally { setBusy(false) }
  }

  const openTab = (tab: 'plan' | 'limits' | 'tools') => {
    try { localStorage.setItem('dh-net-tab', tab) } catch { /* quota */ }
    navigate('network')
  }

  const usedToday = live ? live.todayDownMB + live.todayUpMB : null
  const cap = cfg?.limits.dailyCapMB ?? null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="rounded-xl bg-surface-200/60 px-3 py-2.5 min-w-0">
          <p className="text-[11px] text-surface-500">{t('net.today')}</p>
          <p className="text-[14px] font-semibold tabular-nums mt-0.5 truncate">{usedToday != null ? `${usedToday.toFixed(1)} MB` : '—'}</p>
        </div>
        <div className="rounded-xl bg-surface-200/60 px-3 py-2.5 min-w-0">
          <p className="text-[11px] text-surface-500">{t('net.dailyCap')}</p>
          <p className="text-[14px] font-semibold tabular-nums mt-0.5 truncate">{cap ? `${cap} MB` : t('settings.off')}</p>
        </div>
        <div className="rounded-xl bg-surface-200/60 px-3 py-2.5 min-w-0 col-span-2 sm:col-span-1">
          <p className="text-[11px] text-surface-500">{t('net.plan')}</p>
          <p className="text-[14px] font-semibold mt-0.5 truncate">{cfg?.plan?.name || '—'}</p>
        </div>
      </div>

      <Toggle on={!!cfg?.limits.monitoringEnabled} onChange={(v) => void patchLimits({ monitoringEnabled: v })} label={t('net.monitoring')} />
      <Toggle on={!!cfg?.limits.blockOnCap} onChange={(v) => void patchLimits({ blockOnCap: v })} label={t('net.blockOnCap')} disabled={!cfg} />
      <Toggle on={!!cfg?.limits.restoreAtMidnight} onChange={(v) => void patchLimits({ restoreAtMidnight: v })} label={t('net.restoreMidnight')} disabled={!cfg} />

      <div className="flex flex-wrap items-center gap-2">
        <button className={cn('btn-sm', live?.blocked ? 'btn-primary' : 'btn-danger')} onClick={() => void toggleBlock()} disabled={busy || !live}>
          {live?.blocked ? <ShieldCheck size={13} /> : <Ban size={13} />}
          {live?.blocked ? t('net.unblock') : t('net.blockNow')}
        </button>
        <button className="btn-sm btn-soft" onClick={() => openTab('plan')}><ListChecks size={13} />{t('settings.netOpenPlan')}</button>
        <button className="btn-sm btn-soft" onClick={() => openTab('limits')}><Ban size={13} />{t('settings.netOpenLimits')}</button>
        <button className="btn-sm btn-soft" onClick={() => openTab('tools')}><Radar size={13} />{t('settings.netOpenTools')}</button>
      </div>
      {live?.needsAdmin && <p className="text-xs text-amber-500">{t('net.needsAdmin')}</p>}
    </div>
  )
}

/** AI quick controls embedded in Settings (full management lives on the AI page). */
function AiSettingsSection() {
  const { t } = useTranslation()
  const { toast, navigate } = useApp(useShallow((s) => ({ toast: s.toast, navigate: s.navigate })))
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [providers, setProviders] = useState(0)

  useEffect(() => {
    let alive = true
    invoke<{ config: AiConfig; providers: unknown[] }>('ai:getConfig')
      .then((c) => { if (alive) { setCfg(c.config); setProviders(c.providers.length) } })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const save = async (patch: Partial<AiConfig>) => {
    const prev = cfg
    if (cfg) setCfg({ ...cfg, ...patch })
    try {
      const res = await invoke<{ config: AiConfig }>('ai:setConfig', patch)
      setCfg(res.config)
    } catch (e) {
      if (prev) setCfg(prev)
      toast(errorMessage(e, t('toast.error')), 'error')
    }
  }

  return (
    <div className="space-y-4">
      <Toggle on={!!cfg?.enabled} onChange={(v) => void save({ enabled: v })} label={t('ai.enable')} />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-sm btn-primary" onClick={() => navigate('ai')}><Bot size={13} />{t('settings.openAi')}</button>
        <span className="badge bg-surface-200 text-surface-600">{t('ai.activeProvider')}: {providers || 0}</span>
      </div>
      <p className="text-xs opacity-60 leading-relaxed">{t('settings.manageAi')}</p>
    </div>
  )
}

export default function Settings() {
  const { t } = useTranslation()
  const { settings: s, setSettings, resetSettings, reloadCollections, toast, navigate } = useApp(useShallow((st) => ({ settings: st.settings, setSettings: st.setSettings, resetSettings: st.resetSettings, reloadCollections: st.reloadCollections, toast: st.toast, navigate: st.navigate })))
  const set = (p: Partial<AppSettings>) => setSettings(p)
  const [q, setQ] = useState('')
  const [active, setActive] = useState('appearance')
  const [bench, setBench] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pick the highest quality level this machine actually sustains: >26ms/frame
  // → eco, >18 → balanced, otherwise keep high (ultra stays an explicit choice).
  const runBenchmark = async () => {
    setBench(true)
    try {
      const median = await measureMedianFrameMs()
      const level: AppSettings['performanceLevel'] = median > 26 ? 'eco' : median > 18 ? 'balanced' : 'high'
      set({ performanceLevel: level })
      const label = t(`settings.level${level[0].toUpperCase()}${level.slice(1)}`)
      toast(t('settings.benchResult', { level: label, ms: median.toFixed(1) }))
    } finally { setBench(false) }
  }

  // Search filters which sections are visible; when searching we show all matches
  // in a single column and dim the sticky index highlight logic.
  const query = q.trim().toLowerCase()
  const match = (id: string) => {
    if (!query) return true
    const sec = SECTIONS.find((x) => x.id === id)
    return !!sec && (t(sec.titleKey).toLowerCase().includes(query) || sec.keywords.includes(query))
  }

  // Scroll spy: highlight the index entry for the section nearest the top.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const measure = () => {
      const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-section]'))
      let best = nodes[0]?.dataset.section ?? 'appearance'
      for (const n of nodes) {
        if (n.getBoundingClientRect().top - 80 <= 0) best = n.dataset.section ?? best
      }
      setActive(best)
    }
    // rAF-throttled: scroll events fire far faster than frames, and each
    // measure() walks every section doing layout reads.
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure() }) }
    el.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [query])

  const chooseBackground = async () => {
    try {
      const ps = await invoke<string[]>('dialog:openFile', { filters: [{ name: 'Images', extensions: [...IMAGE_EXT] }] })
      if (ps[0]) set({ backgroundImage: ps[0] })
    } catch (e) {
      toast(errorMessage(e, t('toast.error')), 'error')
    }
  }

  const jump = (id: string) => {
    const el = document.getElementById(`settings-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('settings.title')} icon={<SettingsIcon />} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4" ref={scrollRef}>
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-4">
          {/* Sticky section index + search (hidden on very narrow screens) */}
          <aside className="hidden md:block md:w-56 shrink-0">
            <div className="sticky top-4 space-y-3">
              <div className="relative">
                <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
                <input className="input ps-8 py-1.5 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('settings.search')} aria-label={t('settings.search')} />
              </div>
              <nav className="space-y-2" aria-label={t('settings.title')}>
                {GROUPS.map((g) => {
                  const items = SECTIONS.filter((sec) => sec.group === g && match(sec.id))
                  if (items.length === 0) return null
                  return (
                    <div key={g}>
                      <p className="px-2.5 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-surface-500">{t(`settings.groups.${g}`)}</p>
                      <div className="space-y-0.5">
                        {items.map((sec) => (
                          <button key={sec.id} onClick={() => jump(sec.id)} aria-current={active === sec.id && !query ? 'true' : undefined}
                            className={cn('w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-start transition-colors', active === sec.id && !query ? 'bg-accent/12 text-accent font-medium' : 'text-surface-600 hover:bg-surface-200/70')}>
                            <span className="shrink-0">{sec.icon}</span>
                            <span className="truncate">{t(sec.titleKey)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </nav>
            </div>
          </aside>
          {/* Mobile search box */}
          <div className="md:hidden">
            <div className="relative">
              <Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
              <input className="input ps-8 py-1.5 text-xs w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('settings.search')} aria-label={t('settings.search')} />
            </div>
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-1 gap-4 stagger">
            {match('appearance') && <Section id="appearance" icon={<Palette size={16} />} title={t('settings.appearance')}>
            <Field label={t('settings.theme')}><Seg value={s.theme} options={[['dark', t('settings.dark')], ['light', t('settings.light')], ['system', t('settings.system')]]} onChange={(theme) => set({ theme })} /></Field>
            <Field label={t('settings.accent')}>
              <div className="flex gap-2 flex-wrap">{ACCENTS.map((a) => <button key={a.id} onClick={() => set({ accent: a.id })} className={cn('w-8 h-8 rounded-full transition-transform hover:scale-110 ring-offset-2 ring-offset-surface-100', s.accent === a.id && 'ring-2 ring-white scale-110')} style={{ background: a.c }} />)}</div>
            </Field>
            <Field label={t('settings.animations')}><Seg value={s.animations} options={[['full', t('settings.full')], ['reduced', t('settings.reduced')], ['off', t('settings.off')]]} onChange={(animations) => set({ animations })} /></Field>
            <Field label={`${t('settings.animSpeed')}: ${s.animationSpeed}x`}><DSlider value={s.animationSpeed} min={0.5} max={2} step={0.1} onCommit={(animationSpeed) => set({ animationSpeed })} /></Field>
            <Field label={`${t('settings.fontScale')}: ${Math.round(s.fontScale * 100)}%`}><DSlider value={s.fontScale} min={0.8} max={1.4} step={0.05} onCommit={(fontScale) => set({ fontScale })} /></Field>
            <Toggle on={s.compactMode} onChange={(compactMode) => set({ compactMode })} label={t('settings.compact')} />
            <Toggle on={s.glassEffect} onChange={(glassEffect) => set({ glassEffect })} label={t('settings.glass')} />
            <Field label={t('settings.backgroundImage')} hint={t('settings.backgroundImageHint')}>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-soft" onClick={chooseBackground}><FolderOpen size={14} /> {t('settings.chooseImage')}</button>
                {s.backgroundImage && (
                  <>
                    <img src={toFileUrl(s.backgroundImage)} alt="" className="w-12 h-12 rounded-lg object-cover ring-1 ring-inset ring-[rgb(var(--surface-300))]" />
                    <button className="btn-ghost text-sm" onClick={() => set({ backgroundImage: '' })}>{t('settings.clearImage')}</button>
                  </>
                )}
              </div>
            </Field>
            <Field label={`${t('settings.backgroundBlur')}: ${s.backgroundBlur}px`}><DSlider value={s.backgroundBlur} min={0} max={30} step={1} onCommit={(backgroundBlur) => set({ backgroundBlur })} /></Field>
            <Field label={`${t('settings.backgroundDim')}: ${Math.round(s.backgroundDim)}%`}><DSlider value={s.backgroundDim} min={0} max={90} step={1} onCommit={(backgroundDim) => set({ backgroundDim })} /></Field>
            <Toggle on={s.ambientGlow} onChange={(ambientGlow) => set({ ambientGlow })} label={t('settings.ambientGlow')} description={t('settings.ambientGlowDesc')} />
          </Section>}

          {match('backgrounds') && <Section id="backgrounds" icon={<Sparkles size={16} />} title={t('settings.backgroundsSec')}>
            <Field label={t('settings.bgPreset')}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button type="button" onClick={() => set({ backgroundPreset: '' })} aria-pressed={!s.backgroundPreset}
                  className={cn('h-16 rounded-xl border text-xs font-medium grid place-items-center transition-colors', !s.backgroundPreset ? 'border-accent bg-accent/10 text-accent' : 'border-[color:var(--hairline)] text-surface-600 hover:border-accent/40')}>
                  {t('settings.bgNone')}
                </button>
                {BG_PRESET_IDS.map((id) => (
                  <button key={id} type="button" onClick={() => set({ backgroundPreset: id })} aria-pressed={s.backgroundPreset === id}
                    className={cn('relative h-16 rounded-xl border overflow-hidden text-xs font-medium transition-colors', s.backgroundPreset === id ? 'border-accent text-accent' : 'border-[color:var(--hairline)] text-surface-600 hover:border-accent/40')}>
                    <span aria-hidden className="absolute inset-0 opacity-60" style={{ background: PRESET_SWATCH[id] }} />
                    <span className="relative drop-shadow-sm">{t(`settings.bgPresets.${id}`)}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`${t('settings.bgSpeed')}: ${s.backgroundPresetSpeed}x`}><DSlider value={s.backgroundPresetSpeed} min={0.5} max={2} step={0.1} onCommit={(backgroundPresetSpeed) => set({ backgroundPresetSpeed })} /></Field>
            {s.lowPowerMode && <p className="text-xs text-amber-500">{t('settings.lowPowerDesc')}</p>}
          </Section>}

          {match('performance') && <Section id="performance" icon={<BatteryLow size={16} />} title={t('settings.performance')}>
            <Toggle on={s.lowPowerMode} onChange={(lowPowerMode) => set({ lowPowerMode })} label={t('settings.lowPower')} description={t('settings.lowPowerDesc')} />
            <Toggle on={s.performanceAuto} onChange={(performanceAuto) => set({ performanceAuto })} label={t('settings.performanceAuto')} description={t('settings.performanceAutoDesc')} />
            <Field label={t('settings.performanceLevel')}>
              <Seg value={s.performanceLevel} options={[['eco', t('settings.levelEco')], ['balanced', t('settings.levelBalanced')], ['high', t('settings.levelHigh')], ['ultra', t('settings.levelUltra')]]} onChange={(performanceLevel) => set({ performanceLevel })} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-sm btn-soft" onClick={() => void runBenchmark()} disabled={bench}>
                <Gauge size={13} className={bench ? 'animate-pulse' : ''} />
                {bench ? t('settings.benchmarkBusy') : t('settings.benchmark')}
              </button>
            </div>
            <p className="text-xs opacity-60 leading-relaxed">{t('settings.performanceHint')}</p>
          </Section>}

          {match('general') && <Section id="general" icon={<Globe size={16} />} title={t('settings.general')}>
            <Field label={t('settings.language')}><Seg value={s.language} options={[['ar', 'العربية'], ['en', 'English']]} onChange={(language) => set({ language })} /></Field>
            <Field label={t('settings.startPage')}>
              <select className="select" value={s.startPage} onChange={(e) => set({ startPage: e.target.value })}>{NAV.map((n) => <option key={n.id} value={n.id}>{t(`nav.${n.id}`)}</option>)}</select>
            </Field>
            <Toggle on={s.minimizeToTray} onChange={(minimizeToTray) => set({ minimizeToTray })} label={t('settings.minimizeTray')} />
            <Toggle on={s.launchAtStartup} onChange={(launchAtStartup) => set({ launchAtStartup })} label={t('settings.launchStartup')} />
            <Toggle on={s.globalShortcutsEnabled} onChange={(globalShortcutsEnabled) => set({ globalShortcutsEnabled })} label={t('settings.globalShortcuts')} description={t('settings.globalShortcutsDesc')} />
            <Toggle on={s.hardwareAcceleration} onChange={(hardwareAcceleration) => { set({ hardwareAcceleration }); toast(t('settings.restartNeeded'), 'info') }} label={t('settings.hwAccel')} />
          </Section>}

          {match('networkSec') && <Section id="networkSec" icon={<Wifi size={16} />} title={t('settings.networkSec')}>
            <NetworkSettingsSection />
          </Section>}

          {match('updatesSec') && <Section id="updatesSec" icon={<DownloadCloud size={16} />} title={t('settings.updatesSec')}>
            <Toggle on={s.checkUpdates} onChange={(checkUpdates) => set({ checkUpdates })} label={t('settings.checkUpdates')} />
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-sm btn-primary" onClick={() => navigate('about')}><DownloadCloud size={13} />{t('settings.versionsManage')}</button>
            </div>
            <p className="text-xs opacity-60 leading-relaxed">{t('settings.versionsHint')}</p>
          </Section>}

          {match('downloads') && <Section id="downloads" icon={<Download size={16} />} title={t('settings.downloads')}>
            <Field label={t('settings.downloadDir')}>
              <div className="flex gap-2 min-w-0"><input className="input flex-1 min-w-0 font-mono text-xs" readOnly value={s.downloadDir} /><button className="btn shrink-0" onClick={async () => { const d = await invoke('dialog:openFolder'); if (d) set({ downloadDir: d }) }}><FolderOpen size={14} /></button></div>
            </Field>
            <Field label={`${t('settings.parallel')}: ${s.maxParallelDownloads}`}><DSlider value={s.maxParallelDownloads} min={1} max={10} step={1} onCommit={(maxParallelDownloads) => set({ maxParallelDownloads })} /></Field>
            <Field label={`${t('settings.segments')}: ${s.downloadSegments}`}><DSlider value={s.downloadSegments} min={1} max={32} step={1} onCommit={(downloadSegments) => set({ downloadSegments })} /></Field>
          </Section>}

          {match('filesSec') && <Section id="filesSec" icon={<Folder size={16} />} title={t('settings.filesSec')}>
            <Toggle on={s.confirmDelete} onChange={(confirmDelete) => set({ confirmDelete })} label={t('settings.confirmDelete')} />
            <Toggle on={s.useRecycleBin} onChange={(useRecycleBin) => set({ useRecycleBin })} label={t('settings.recycle')} />
            <Toggle on={s.showHiddenFiles} onChange={(showHiddenFiles) => set({ showHiddenFiles })} label={t('settings.showHidden')} />
          </Section>}

          {match('editorSec') && <Section id="editorSec" icon={<Code size={16} />} title={t('settings.editorSec')}>
            <Field label={`${t('settings.editorFont')}: ${s.editorFontSize}px`}><DSlider value={s.editorFontSize} min={10} max={28} step={1} onCommit={(editorFontSize) => set({ editorFontSize })} /></Field>
            <Field label={t('settings.tabSize')}><Seg value={String(s.editorTabSize) as '2' | '4' | '8'} options={[['2', '2'], ['4', '4'], ['8', '8']]} onChange={(v) => set({ editorTabSize: +v })} /></Field>
            <Toggle on={s.editorWordWrap} onChange={(editorWordWrap) => set({ editorWordWrap })} label={t('settings.wordWrap')} />
            <Toggle on={s.editorMinimap} onChange={(editorMinimap) => set({ editorMinimap })} label={t('settings.minimap')} />
            <Field label={`${t('settings.autoSave')}: ${s.autoSaveIntervalSec}s`}><DSlider value={s.autoSaveIntervalSec} min={0} max={120} step={5} onCommit={(autoSaveIntervalSec) => set({ autoSaveIntervalSec })} /></Field>
          </Section>}

          {match('aiSec') && <Section id="aiSec" icon={<Bot size={16} />} title={t('settings.aiSec')}>
            <AiSettingsSection />
          </Section>}

          {match('vaultSec') && <Section id="vaultSec" icon={<Shield size={16} />} title={t('settings.vaultSec')}>
            <Field label={`${t('settings.autoLock')}: ${s.vaultAutoLockMin}`}><DSlider value={s.vaultAutoLockMin} min={0} max={60} step={1} onCommit={(vaultAutoLockMin) => set({ vaultAutoLockMin })} /></Field>
            <Field label={`${t('settings.clearClip')}: ${s.vaultClearClipboardSec}`}><DSlider value={s.vaultClearClipboardSec} min={5} max={120} step={5} onCommit={(vaultClearClipboardSec) => set({ vaultClearClipboardSec })} /></Field>
          </Section>}

          {match('data') && <Section id="data" icon={<Database size={16} />} title={t('settings.data')}>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={async () => { try { const r = await invoke('data:exportAll'); if (r) toast(`${t('settings.exported')} ${r}`) } catch (e) { toast(errorMessage(e), 'error') } }}><Save size={14} /> {t('settings.exportData')}</button>
              <button className="btn" onClick={async () => { try { const r = await invoke('data:importAll'); if (r) { await reloadCollections(); toast(t('settings.imported')) } } catch (e) { toast(errorMessage(e), 'error') } }}><Upload size={14} /> {t('settings.importData')}</button>
              <button className="btn" onClick={() => invoke('app:openUserData')}><FolderOpen size={14} /> {t('settings.openData')}</button>
              <button className="btn-danger" onClick={async () => { if (await invoke('dialog:confirm', t('settings.resetAll'), '')) { await resetSettings(); toast(t('common.done')) } }}><RotateCcw size={14} /> {t('settings.resetAll')}</button>
            </div>
          </Section>}

          {match('privacy') && <Section id="privacy" icon={<Eye size={16} />} title={t('settings.privacy')}>
            <div className="flex items-center gap-3">
              <Toggle on={false} disabled onChange={() => {}} label={t('settings.telemetry')} />
              <span className="badge bg-emerald-500/15 text-emerald-500 shrink-0">{t('settings.off')}</span>
            </div>
            <p className="text-xs opacity-60">{t('settings.telemetryDesc')}</p>
          </Section>}
        </div>
        </div>
      </div>
    </div>
  )
}

/** Tiny static gradient swatches so the preset grid previews each look cheaply. */
const PRESET_SWATCH: Record<string, string> = {
  aurora: 'linear-gradient(135deg, #0ea5e9, #22c55e, #a855f7)',
  'ocean-waves': 'linear-gradient(135deg, #0c4a6e, #0ea5e9, #22d3ee)',
  starfield: 'radial-gradient(circle at 30% 30%, #e2e8f0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, #e2e8f0 1px, transparent 1.5px), linear-gradient(135deg, #020617, #1e1b4b)',
  'mesh-gradient': 'linear-gradient(135deg, #f472b6, #a78bfa 40%, #22d3ee 70%, #34d399)',
  'liquid-blobs': 'radial-gradient(circle at 25% 35%, #f59e0b, transparent 55%), radial-gradient(circle at 75% 65%, #ef4444, transparent 55%), linear-gradient(135deg, #1e1b4b, #0f172a)',
  'neon-grid': 'repeating-linear-gradient(90deg, rgb(34 211 238 / 0.5) 0 1px, transparent 1px 12px), repeating-linear-gradient(0deg, rgb(217 70 239 / 0.5) 0 1px, transparent 1px 12px), linear-gradient(135deg, #020617, #111827)',
  'sunset-flow': 'linear-gradient(135deg, #fb923c, #f43f5e 50%, #7c3aed)',
  ember: 'radial-gradient(circle at 50% 80%, #f97316, transparent 60%), radial-gradient(circle at 30% 60%, #dc2626, transparent 50%), linear-gradient(135deg, #0c0a09, #1c1917)',
}

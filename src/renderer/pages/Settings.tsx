import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Palette, Globe, Download, Folder, Code, Shield, Database, Eye, FolderOpen, RotateCcw, Upload, Save } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Toggle, Field, Slider } from '@/components/ui'
import { invoke } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NAV } from '@/components/Shell'
import type { AccentColor, AppSettings } from '@shared/types'

const ACCENTS: { id: AccentColor; c: string }[] = [
  { id: 'violet', c: '#8b5cf6' }, { id: 'blue', c: '#3b82f6' }, { id: 'emerald', c: '#10b981' }, { id: 'rose', c: '#f43f5e' }, { id: 'amber', c: '#f59e0b' }, { id: 'cyan', c: '#06b6d4' }, { id: 'orange', c: '#f97316' },
]

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2 text-accent">{icon} {title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="flex gap-1 p-1 rounded-xl bg-surface-200 w-fit">{options.map(([v, l]) => <button key={v} className={cn('btn-ghost text-sm', value === v && 'bg-surface-300 text-accent')} onClick={() => onChange(v)}>{l}</button>)}</div>
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

export default function Settings() {
  const { t } = useTranslation()
  const { settings: s, setSettings, resetSettings, reloadCollections, toast } = useApp()
  const set = (p: Partial<AppSettings>) => setSettings(p)

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('settings.title')} icon={<SettingsIcon />} />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 stagger">
          <Section icon={<Palette size={16} />} title={t('settings.appearance')}>
            <Field label={t('settings.theme')}><Seg value={s.theme} options={[['dark', t('settings.dark')], ['light', t('settings.light')], ['system', t('settings.system')]]} onChange={(theme) => set({ theme })} /></Field>
            <Field label={t('settings.accent')}>
              <div className="flex gap-2">{ACCENTS.map((a) => <button key={a.id} onClick={() => set({ accent: a.id })} className={cn('w-8 h-8 rounded-full transition-transform hover:scale-110 ring-offset-2 ring-offset-surface-100', s.accent === a.id && 'ring-2 ring-white scale-110')} style={{ background: a.c }} />)}</div>
            </Field>
            <Field label={t('settings.animations')}><Seg value={s.animations} options={[['full', t('settings.full')], ['reduced', t('settings.reduced')], ['off', t('settings.off')]]} onChange={(animations) => set({ animations })} /></Field>
            <Field label={`${t('settings.animSpeed')}: ${s.animationSpeed}x`}><DSlider value={s.animationSpeed} min={0.5} max={2} step={0.1} onCommit={(animationSpeed) => set({ animationSpeed })} /></Field>
            <Field label={`${t('settings.fontScale')}: ${Math.round(s.fontScale * 100)}%`}><DSlider value={s.fontScale} min={0.8} max={1.4} step={0.05} onCommit={(fontScale) => set({ fontScale })} /></Field>
            <Toggle on={s.compactMode} onChange={(compactMode) => set({ compactMode })} label={t('settings.compact')} />
            <Toggle on={s.glassEffect} onChange={(glassEffect) => set({ glassEffect })} label={t('settings.glass')} />
          </Section>

          <Section icon={<Globe size={16} />} title={t('settings.general')}>
            <Field label={t('settings.language')}><Seg value={s.language} options={[['ar', 'العربية'], ['en', 'English']]} onChange={(language) => set({ language })} /></Field>
            <Field label={t('settings.startPage')}>
              <select className="select" value={s.startPage} onChange={(e) => set({ startPage: e.target.value })}>{NAV.map((n) => <option key={n.id} value={n.id}>{t(`nav.${n.id}`)}</option>)}</select>
            </Field>
            <Toggle on={s.minimizeToTray} onChange={(minimizeToTray) => set({ minimizeToTray })} label={t('settings.minimizeTray')} />
            <Toggle on={s.launchAtStartup} onChange={(launchAtStartup) => set({ launchAtStartup })} label={t('settings.launchStartup')} />
            <Toggle on={s.hardwareAcceleration} onChange={(hardwareAcceleration) => { set({ hardwareAcceleration }); toast(t('settings.restartNeeded'), 'info') }} label={t('settings.hwAccel')} />
          </Section>

          <Section icon={<Download size={16} />} title={t('settings.downloads')}>
            <Field label={t('settings.downloadDir')}>
              <div className="flex gap-2"><input className="input flex-1 font-mono text-xs" readOnly value={s.downloadDir} /><button className="btn" onClick={async () => { const d = await invoke('dialog:openFolder'); if (d) set({ downloadDir: d }) }}><FolderOpen size={14} /></button></div>
            </Field>
            <Field label={`${t('settings.parallel')}: ${s.maxParallelDownloads}`}><DSlider value={s.maxParallelDownloads} min={1} max={10} step={1} onCommit={(maxParallelDownloads) => set({ maxParallelDownloads })} /></Field>
            <Field label={`${t('settings.segments')}: ${s.downloadSegments}`}><DSlider value={s.downloadSegments} min={1} max={32} step={1} onCommit={(downloadSegments) => set({ downloadSegments })} /></Field>
          </Section>

          <Section icon={<Folder size={16} />} title={t('settings.filesSec')}>
            <Toggle on={s.confirmDelete} onChange={(confirmDelete) => set({ confirmDelete })} label={t('settings.confirmDelete')} />
            <Toggle on={s.useRecycleBin} onChange={(useRecycleBin) => set({ useRecycleBin })} label={t('settings.recycle')} />
            <Toggle on={s.showHiddenFiles} onChange={(showHiddenFiles) => set({ showHiddenFiles })} label={t('settings.showHidden')} />
          </Section>

          <Section icon={<Code size={16} />} title={t('settings.editorSec')}>
            <Field label={`${t('settings.editorFont')}: ${s.editorFontSize}px`}><DSlider value={s.editorFontSize} min={10} max={28} step={1} onCommit={(editorFontSize) => set({ editorFontSize })} /></Field>
            <Field label={t('settings.tabSize')}><Seg value={String(s.editorTabSize) as '2' | '4' | '8'} options={[['2', '2'], ['4', '4'], ['8', '8']]} onChange={(v) => set({ editorTabSize: +v })} /></Field>
            <Toggle on={s.editorWordWrap} onChange={(editorWordWrap) => set({ editorWordWrap })} label={t('settings.wordWrap')} />
            <Toggle on={s.editorMinimap} onChange={(editorMinimap) => set({ editorMinimap })} label={t('settings.minimap')} />
            <Field label={`${t('settings.autoSave')}: ${s.autoSaveIntervalSec}s`}><DSlider value={s.autoSaveIntervalSec} min={0} max={120} step={5} onCommit={(autoSaveIntervalSec) => set({ autoSaveIntervalSec })} /></Field>
          </Section>

          <Section icon={<Shield size={16} />} title={t('settings.vaultSec')}>
            <Field label={`${t('settings.autoLock')}: ${s.vaultAutoLockMin}`}><DSlider value={s.vaultAutoLockMin} min={0} max={60} step={1} onCommit={(vaultAutoLockMin) => set({ vaultAutoLockMin })} /></Field>
            <Field label={`${t('settings.clearClip')}: ${s.vaultClearClipboardSec}`}><DSlider value={s.vaultClearClipboardSec} min={5} max={120} step={5} onCommit={(vaultClearClipboardSec) => set({ vaultClearClipboardSec })} /></Field>
          </Section>

          <Section icon={<Database size={16} />} title={t('settings.data')}>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={async () => { try { const r = await invoke('data:exportAll'); if (r) toast(`${t('settings.exported')} ${r}`) } catch (e: any) { toast(e.message, 'error') } }}><Save size={14} /> {t('settings.exportData')}</button>
              <button className="btn" onClick={async () => { try { const r = await invoke('data:importAll'); if (r) { await reloadCollections(); toast(t('settings.imported')) } } catch (e: any) { toast(e.message, 'error') } }}><Upload size={14} /> {t('settings.importData')}</button>
              <button className="btn" onClick={() => invoke('app:openUserData')}><FolderOpen size={14} /> {t('settings.openData')}</button>
              <button className="btn-danger" onClick={async () => { if (await invoke('dialog:confirm', t('settings.resetAll'), '')) { await resetSettings(); toast(t('common.done')) } }}><RotateCcw size={14} /> {t('settings.resetAll')}</button>
            </div>
          </Section>

          <Section icon={<Eye size={16} />} title={t('settings.privacy')}>
            <div className="flex items-center gap-3">
              <span className="toggle" data-on="false" role="switch" aria-checked="false" aria-label={t('settings.telemetry')} />
              <span className="text-sm">{t('settings.telemetry')}</span>
              <span className="badge bg-emerald-500/15 text-emerald-500">{t('settings.off')}</span>
            </div>
            <p className="text-xs opacity-60">{t('settings.telemetryDesc')}</p>
          </Section>
        </div>
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Languages, Palette, Sparkles, Rocket, ChevronRight, ChevronLeft, StickyNote, CheckSquare,
  Lightbulb, FolderOpen, ShieldCheck, Zap, Check,
} from 'lucide-react'
import { Modal } from '@/components/ui'
import { useApp } from '@/store'
import { Logo } from '@/components/Shell'
import { APP_VERSION, CHANGELOG, type AccentColor, type Language, type Theme } from '@shared/types'
import { cn } from '@/lib/utils'
import { ease, spring, useMotionPrefs } from '@/lib/motion'

const THEMES: { id: Theme; labelKey: string }[] = [
  { id: 'dark', labelKey: 'onboarding.themeDark' },
  { id: 'light', labelKey: 'onboarding.themeLight' },
  { id: 'system', labelKey: 'onboarding.themeSystem' },
]
const ACCENTS: { id: AccentColor; c: string }[] = [
  { id: 'violet', c: '#8b5cf6' }, { id: 'blue', c: '#3b82f6' }, { id: 'emerald', c: '#10b981' },
  { id: 'rose', c: '#f43f5e' }, { id: 'amber', c: '#f59e0b' }, { id: 'cyan', c: '#06b6d4' }, { id: 'orange', c: '#f97316' },
]
const accentHex = (id: AccentColor) => ACCENTS.find((a) => a.id === id)?.c ?? '#8b5cf6'
const FEATURES = [
  { icon: <StickyNote size={20} />, key: 'notes' },
  { icon: <CheckSquare size={20} />, key: 'tasks' },
  { icon: <Lightbulb size={20} />, key: 'projects' },
  { icon: <FolderOpen size={20} />, key: 'files' },
  { icon: <ShieldCheck size={20} />, key: 'vault' },
  { icon: <Zap size={20} />, key: 'resources' },
]
type ChangeType = 'added' | 'changed' | 'fixed' | 'security'
const CHANGE_META: Record<ChangeType, { icon: React.ReactNode; text: string; dot: string }> = {
  added: { icon: <Sparkles size={13} />, text: 'text-emerald-500', dot: 'bg-emerald-400' },
  changed: { icon: <Zap size={13} />, text: 'text-blue-500', dot: 'bg-blue-400' },
  fixed: { icon: <Rocket size={13} />, text: 'text-amber-500', dot: 'bg-amber-400' },
  security: { icon: <ShieldCheck size={13} />, text: 'text-violet-500', dot: 'bg-violet-400' },
}

/** Miniature UI preview so theme choice is visual, not just a label. */
function ThemeSwatch({ theme, accent }: { theme: Theme; accent: string }) {
  const dark = theme === 'dark'
  const bg = theme === 'system' ? 'linear-gradient(90deg,#12141c 0 50%,#f5f6fa 50% 100%)' : dark ? '#12141c' : '#f5f6fa'
  const bar = dark || theme === 'system' ? '#2a2e3d' : '#e6e8ef'
  return (
    <span className="block relative h-14 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-[color:var(--hairline)]" style={{ background: bg }}>
      <span className="absolute inset-x-2 top-2 h-2 rounded-full" style={{ background: bar }} />
      <span className="absolute start-2 top-6 h-1.5 w-8 rounded-full" style={{ background: accent }} />
      <span className="absolute start-2 top-9 h-1.5 w-12 rounded-full" style={{ background: bar }} />
      <span className="absolute end-2 top-2 h-2 w-2 rounded-full" style={{ background: accent }} />
    </span>
  )
}

/** First-run wizard: language → theme/accent → feature tour. Never shown again once dismissed. */
export function Onboarding() {
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const { onboardingOpen, settings, setSettings, dismissWhatsNew, navigate } = useApp()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  if (!onboardingOpen) return null

  const set = (p: Parameters<typeof setSettings>[0]) => setSettings(p)
  const done = () => {
    // Persist the chosen language/theme immediately, then record the version so
    // this wizard never reappears; onboarding counts as "seen".
    setSettings({ language: settings.language, theme: settings.theme, accent: settings.accent })
    dismissWhatsNew()
    navigate('dashboard')
  }
  const go = (n: number) => { if (n === step) return; setDir(n > step ? 1 : -1); setStep(n) }
  const axis = (settings.language === 'ar' ? -1 : 1) * dir
  const STEPS = [t('onboarding.step1'), t('onboarding.step2'), t('onboarding.step3')]

  return (
    <Modal open={onboardingOpen} onClose={done} wide
      title={step === 0 ? t('onboarding.welcomeTitle') : step === 1 ? t('onboarding.lookTitle') : t('onboarding.tourTitle')}
      description={step === 2 ? t('onboarding.readyDesc') : t('onboarding.subtitle')}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          {step > 0 && <button className="btn-ghost" onClick={() => go(step - 1)}><ChevronLeft size={15} className="rtl:-scale-x-100" />{t('common.back')}</button>}
          {step < 2
            ? <button className="btn-primary" onClick={() => go(step + 1)}>{t('common.forward')}<ChevronRight size={15} className="rtl:-scale-x-100" /></button>
            : <button className="btn-primary" onClick={done}><Rocket size={15} />{t('onboarding.start')}</button>}
        </div>
      }>
      {/* Animated step indicator */}
      <div className="flex items-center gap-2 mb-5" role="group" aria-label={t('onboarding.subtitle')}>
        {STEPS.map((label, i) => {
          const active = i === step
          const complete = i < step
          return (
            <React.Fragment key={i}>
              <button type="button" aria-current={active ? 'step' : undefined} onClick={() => go(i)}
                className={cn('relative flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium transition-colors', active ? 'text-accent' : complete ? 'text-surface-700' : 'text-surface-500 hover:text-surface-700')}>
                {active && <motion.span layoutId="ob-step" className="absolute inset-0 rounded-full bg-accent/12 ring-1 ring-inset ring-accent/30" transition={spring.snappy} />}
                <span className={cn('relative z-10 grid place-items-center h-5 w-5 rounded-full text-[10.5px] font-semibold transition-colors', active || complete ? 'bg-accent text-accent-fg' : 'bg-surface-200 text-surface-500')}>
                  {complete ? <Check size={12} /> : i + 1}
                </span>
                <span className="relative z-10 hidden sm:inline">{label}</span>
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className={cn('h-px flex-1 min-w-3 rounded-full transition-colors', complete ? 'bg-accent' : 'bg-surface-300')} />}
            </React.Fragment>
          )
        })}
      </div>

      <AnimatePresence mode="wait" custom={axis} initial={false}>
        <motion.div key={step} custom={axis}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 34 }),
            center: { opacity: 1, x: 0 },
            exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : -d * 34 }),
          }}
          initial="enter" animate="center" exit="exit"
          transition={{ duration: reduced ? 0 : 0.26, ease: ease.out }}>
          {step === 0 && (
            <div className="space-y-5">
              <div className="dashboard-hero relative isolate overflow-hidden px-5 py-7 text-center">
                <span aria-hidden className="pointer-events-none absolute -top-14 -end-8 h-40 w-40 rounded-full bg-accent/14 blur-3xl animate-float" />
                <span aria-hidden className="pointer-events-none absolute -bottom-16 start-1/4 h-36 w-36 rounded-full bg-accent-soft/12 blur-3xl animate-float" style={{ animationDelay: '-3s' }} />
                <div className="relative flex flex-col items-center gap-3">
                  <span className="relative">
                    <span aria-hidden className="splash-ring absolute inset-0 rounded-2xl border border-accent/40" />
                    <span className="relative grid place-items-center p-3 rounded-2xl surface-raised"><Logo size={44} /></span>
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t('onboarding.eyebrow')}</p>
                    <h2 className="text-xl font-semibold tracking-tight mt-1">{t('onboarding.welcomeTitle')}</h2>
                    <p className="text-sm text-surface-600 mt-1.5 max-w-md mx-auto">{t('onboarding.welcomeDesc')}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['ar', 'en'] as Language[]).map((l) => {
                  const on = settings.language === l
                  return (
                    <button key={l} onClick={() => set({ language: l })}
                      className={cn('relative flex items-center gap-3 rounded-xl border p-4 transition-colors text-start', on ? 'border-accent bg-accent/10' : 'border-surface-300 hover:bg-surface-200/60')}>
                      <Languages size={20} className={on ? 'text-accent' : 'text-surface-500'} />
                      <div className="min-w-0 flex-1"><p className="font-medium text-sm">{l === 'ar' ? 'العربية' : 'English'}</p><p className="text-xs text-surface-500">{l === 'ar' ? 'من اليمين إلى اليسار' : 'Left to right'}</p></div>
                      {on && <Check size={16} className="text-accent shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium mb-2.5 flex items-center gap-2"><Palette size={16} className="text-accent" />{t('onboarding.theme')}</p>
                <div className="grid grid-cols-3 gap-2.5">
                  {THEMES.map((th) => {
                    const on = settings.theme === th.id
                    return (
                      <button key={th.id} onClick={() => set({ theme: th.id })}
                        className={cn('rounded-xl border p-2.5 transition-colors', on ? 'border-accent bg-accent/10' : 'border-surface-300 hover:bg-surface-200/60')}>
                        <ThemeSwatch theme={th.id} accent={accentHex(settings.accent)} />
                        <span className={cn('mt-2 flex items-center justify-center gap-1 text-[12.5px] font-medium', on ? 'text-accent' : 'text-surface-600')}>{on && <Check size={12} />}{t(th.labelKey)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2.5">{t('onboarding.accent')}</p>
                <div className="flex gap-2.5 flex-wrap">
                  {ACCENTS.map((a) => {
                    const on = settings.accent === a.id
                    return (
                      <button key={a.id} onClick={() => set({ accent: a.id })} aria-label={a.id} aria-pressed={on}
                        className={cn('relative grid place-items-center h-9 w-9 rounded-full transition-transform hover:scale-110', on && 'ring-2 ring-offset-2 ring-offset-surface-100 scale-110')} style={{ background: a.c }}>
                        {on && <Check size={15} className="text-white drop-shadow" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {FEATURES.map((f, i) => (
                  <motion.div key={f.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    className="rounded-xl border border-surface-300 p-4 flex flex-col items-center text-center gap-2">
                    <span className="grid place-items-center h-11 w-11 rounded-xl bg-accent/12 text-accent">{f.icon}</span>
                    <p className="text-sm font-medium">{t(`onboarding.feature.${f.key}`)}</p>
                  </motion.div>
                ))}
              </div>
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring.soft}
                className="relative isolate overflow-hidden rounded-2xl border border-accent/30 bg-accent/10 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-accent text-accent-fg"><Rocket size={18} /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{t('onboarding.readyTitle')}</p>
                    <p className="text-xs text-surface-600">{t('onboarding.readyDesc')}</p>
                  </div>
                </div>
                <p className="label mt-3 mb-1.5">{t('onboarding.summaryTitle')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-surface-200/80 text-surface-600"><Languages size={11} />{settings.language === 'ar' ? 'العربية' : 'English'}</span>
                  <span className="badge bg-surface-200/80 text-surface-600"><Palette size={11} />{t(`onboarding.${settings.theme === 'dark' ? 'themeDark' : settings.theme === 'light' ? 'themeLight' : 'themeSystem'}`)}</span>
                  <span className="badge bg-surface-200/80 text-surface-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: accentHex(settings.accent) }} />{t('onboarding.accent')}</span>
                </div>
              </motion.div>
              <p className="text-center text-xs text-surface-500 flex items-center justify-center gap-1.5"><Sparkles size={13} />{t('onboarding.paletteHint')}</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  )
}


/** Shown once after an update: lists the running version's highlights (offline). */
export function WhatsNew() {
  const { t } = useTranslation()
  const { whatsNewOpen, dismissWhatsNew } = useApp()
  if (!whatsNewOpen) return null
  // The running version's own entry is always in CHANGELOG (built-in, offline).
  const entry = CHANGELOG.find((e) => e.version === APP_VERSION)
  const changes = entry?.changes ?? []
  const groups = (['added', 'changed', 'fixed', 'security'] as ChangeType[])
    .map((type) => ({ type, items: changes.filter((c) => c.type === type) }))
    .filter((g) => g.items.length > 0)
  return (
    <Modal open={whatsNewOpen} onClose={dismissWhatsNew} wide
      title={`${t('about.whatsNewTitle')} — v${APP_VERSION}`}
      description={t('about.whatsNewHighlights')}
      footer={<div className="flex items-center justify-between w-full">
        <button className="btn-ghost text-xs" onClick={() => { dismissWhatsNew(); useApp.getState().navigate('about') }}>{t('about.viewFullChangelog')}</button>
        <button className="btn-primary" onClick={dismissWhatsNew}><Rocket size={15} />{t('onboarding.start')}</button>
      </div>}>
      <div className="dashboard-hero relative isolate overflow-hidden mb-4 flex items-center gap-4 px-5 py-5">
        <span aria-hidden className="pointer-events-none absolute -top-14 -end-8 h-40 w-40 rounded-full bg-accent/14 blur-3xl animate-float" />
        <span className="relative grid place-items-center h-14 w-14 shrink-0 rounded-2xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/20"><Rocket size={24} /></span>
        <div className="relative min-w-0">
          <span className="badge bg-accent/12 text-accent"><Sparkles size={11} />{t('about.whatsNewBadge')}</span>
          <p className="text-lg font-semibold tracking-tight mt-1">DragonHub v{APP_VERSION}</p>
          <p className="text-xs text-surface-500">{entry?.date}{entry?.date ? ' · ' : ''}{t('about.whatsNewCount', { count: changes.length })}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {groups.map((g) => {
          const meta = CHANGE_META[g.type]
          return (
            <section key={g.type} className="rounded-xl border border-[color:var(--hairline)] p-3.5">
              <h4 className={cn('flex items-center gap-2 text-[12px] font-semibold mb-2', meta.text)}>
                {meta.icon}{t(`about.changeType.${g.type}`)}
                <span className="badge bg-surface-200/80 text-surface-500">{g.items.length}</span>
              </h4>
              <ul className="space-y-2">
                {g.items.map((c, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-surface-700">
                    <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', meta.dot)} />
                    <span className="min-w-0 break-words">{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}

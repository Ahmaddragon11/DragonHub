import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Languages, Palette, Sparkles, Rocket, ChevronRight, ChevronLeft, StickyNote, CheckSquare, Lightbulb, FolderOpen, ShieldCheck, Zap } from 'lucide-react'
import { Modal } from '@/components/ui'
import { useApp } from '@/store'
import { Logo } from '@/components/Shell'
import { APP_VERSION, CHANGELOG, type AccentColor, type Language, type Theme } from '@shared/types'
import { cn } from '@/lib/utils'

const THEMES: { id: Theme; labelKey: string }[] = [
  { id: 'dark', labelKey: 'onboarding.themeDark' },
  { id: 'light', labelKey: 'onboarding.themeLight' },
  { id: 'system', labelKey: 'onboarding.themeSystem' },
]
const ACCENTS: { id: AccentColor; c: string }[] = [
  { id: 'violet', c: '#8b5cf6' }, { id: 'blue', c: '#3b82f6' }, { id: 'emerald', c: '#10b981' },
  { id: 'rose', c: '#f43f5e' }, { id: 'amber', c: '#f59e0b' }, { id: 'cyan', c: '#06b6d4' }, { id: 'orange', c: '#f97316' },
]
const FEATURES = [
  { icon: <StickyNote size={20} />, key: 'notes' },
  { icon: <CheckSquare size={20} />, key: 'tasks' },
  { icon: <Lightbulb size={20} />, key: 'projects' },
  { icon: <FolderOpen size={20} />, key: 'files' },
  { icon: <ShieldCheck size={20} />, key: 'vault' },
  { icon: <Zap size={20} />, key: 'resources' },
]
type ChangeType = 'added' | 'changed' | 'fixed' | 'security'
const CHANGE_ICON: Record<ChangeType, React.ReactNode> = {
  added: <Sparkles size={12} className="text-emerald-400 shrink-0" />,
  changed: <Zap size={12} className="text-blue-400 shrink-0" />,
  fixed: <Rocket size={12} className="text-amber-400 shrink-0" />,
  security: <ShieldCheck size={12} className="text-violet-400 shrink-0" />,
}
/** First-run wizard: language → theme/accent → feature tour. Never shown again once dismissed. */
export function Onboarding() {
  const { t } = useTranslation()
  const { onboardingOpen, setOnboardingOpen, settings, setSettings, dismissWhatsNew, navigate } = useApp()
  const [step, setStep] = useState(0)
  if (!onboardingOpen) return null

  const set = (p: Parameters<typeof setSettings>[0]) => setSettings(p)
  const done = () => {
    // Persist the chosen language/theme immediately, then record the version so
    // this wizard never reappears; onboarding counts as "seen".
    setSettings({ language: settings.language, theme: settings.theme, accent: settings.accent })
    dismissWhatsNew()
    navigate('dashboard')
  }

  return (
    <Modal open={onboardingOpen} onClose={done} wide
      title={step === 0 ? t('onboarding.welcomeTitle') : step === 1 ? t('onboarding.lookTitle') : t('onboarding.tourTitle')}
      description={t('onboarding.subtitle')}
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className={cn('h-1.5 w-6 rounded-full transition-colors', i <= step ? 'bg-accent' : 'bg-surface-300')} />)}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}><ChevronLeft size={15} className="rtl:-scale-x-100" />{t('common.back')}</button>}
            {step < 2
              ? <button className="btn-primary" onClick={() => setStep(step + 1)}>{t('common.forward')}<ChevronRight size={15} className="rtl:-scale-x-100" /></button>
              : <button className="btn-primary" onClick={done}><Rocket size={15} />{t('onboarding.start')}</button>}
          </div>
        </div>
      }>
      {step === 0 && (
        <div className="space-y-5">
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Logo size={56} />
            <p className="text-sm text-surface-600 max-w-md">{t('onboarding.welcomeDesc')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['ar', 'en'] as Language[]).map((l) => (
              <button key={l} onClick={() => set({ language: l })}
                className={cn('flex items-center gap-3 rounded-xl border p-4 transition-colors text-start', settings.language === l ? 'border-accent bg-accent/10' : 'border-surface-300 hover:bg-surface-200/60')}>
                <Languages size={20} className={settings.language === l ? 'text-accent' : 'text-surface-500'} />
                <div><p className="font-medium text-sm">{l === 'ar' ? 'العربية' : 'English'}</p><p className="text-xs text-surface-500">{l === 'ar' ? 'من اليمين إلى اليسار' : 'Left to right'}</p></div>
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium mb-2 flex items-center gap-2"><Palette size={16} className="text-accent" />{t('onboarding.theme')}</p>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((th) => (
                <button key={th.id} onClick={() => set({ theme: th.id })}
                  className={cn('rounded-lg border p-3 text-sm transition-colors', settings.theme === th.id ? 'border-accent bg-accent/10 text-accent' : 'border-surface-300 hover:bg-surface-200/60')}>
                  {t(th.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">{t('onboarding.accent')}</p>
            <div className="flex gap-2.5 flex-wrap">
              {ACCENTS.map((a) => (
                <button key={a.id} onClick={() => set({ accent: a.id })} aria-label={a.id}
                  className={cn('h-9 w-9 rounded-full transition-transform hover:scale-110', settings.accent === a.id && 'ring-2 ring-offset-2 ring-offset-surface-100 scale-110')} style={{ background: a.c }} />
              ))}
            </div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {FEATURES.map((f, i) => (
            <motion.div key={f.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-surface-300 p-4 flex flex-col items-center text-center gap-2">
              <span className="grid place-items-center h-11 w-11 rounded-xl bg-accent/12 text-accent">{f.icon}</span>
              <p className="text-sm font-medium">{t(`onboarding.feature.${f.key}`)}</p>
            </motion.div>
          ))}
          <p className="col-span-full text-center text-xs text-surface-500 flex items-center justify-center gap-1.5 pt-1"><Sparkles size={13} />{t('onboarding.tourHint')}</p>
        </div>
      )}
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
  return (
    <Modal open={whatsNewOpen} onClose={dismissWhatsNew}
      title={`${t('about.whatsNewTitle')} — v${APP_VERSION}`}
      description={t('about.whatsNewDesc')}
      footer={<div className="flex items-center justify-between w-full">
        <button className="btn-ghost text-xs" onClick={() => { dismissWhatsNew(); useApp.getState().navigate('about') }}>{t('about.viewFullChangelog')}</button>
        <button className="btn-primary" onClick={dismissWhatsNew}><Rocket size={15} />{t('onboarding.start')}</button>
      </div>}>
      <ul className="space-y-2.5">
        {(entry?.changes ?? []).map((c, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
            <span className="mt-0.5" aria-hidden>{CHANGE_ICON[c.type]}</span>
            <span className="min-w-0 break-words">{c.text}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}


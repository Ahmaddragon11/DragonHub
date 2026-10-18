import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Send, Square, Plus, Settings2, Trash2, KeyRound, RefreshCw, Plug, Sparkles,
  AlertTriangle, Check, MessageSquarePlus, User, PanelRightClose,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useApp } from '@/store'
import { PageHeader, Field, Toggle, Slider, Empty, Kbd } from '@/components/ui'
import { GlowButton } from '@/components/Glow'
import { invoke, on, errorMessage } from '@/lib/api'
import { renderMarkdown } from '@/lib/markdown'
import { cn, uid } from '@/lib/utils'
import { spring, useMotionPrefs } from '@/lib/motion'
import type { AiChatMessage, AiConfig, AiPresetId, AiProviderPublic } from '@shared/types'

interface AiPreset { preset: AiPresetId; name: string; baseUrl: string; local: boolean; needsKey: boolean }
interface AiPublicConfig { config: AiConfig; providers: AiProviderPublic[]; presets: AiPreset[]; encryptionAvailable: boolean }
interface ChatMsg { id: string; role: 'user' | 'assistant'; content: string; tools?: string[]; error?: boolean }
interface Streaming { requestId: string; text: string; tools: string[] }

const CHAT_KEY = 'dh:aiChat'
const MAX_STORED = 80

/** Memoized settings pane — its props never change while a reply streams, so
 *  delta re-renders skip the whole provider/tool configuration tree. */
const SettingsPane = memo(function SettingsPane({ cfg, adding, onSetCfg, onAdding, onSaveConfig, onClear }: {
  cfg: AiPublicConfig | null
  adding: boolean
  onSetCfg: (c: AiPublicConfig) => void
  onAdding: (v: boolean) => void
  onSaveConfig: (p: Partial<AiConfig>) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="w-[348px] h-full overflow-y-auto p-4 space-y-5">
      <section>
        <h3 className="label mb-2">{t('ai.activeProvider')}</h3>
        <div className="space-y-2">
          {cfg?.providers.map((p) => (
            <ProviderCard key={p.id} provider={p} presets={cfg.presets} active={p.id === cfg.config.activeProviderId} onChanged={onSetCfg} />
          ))}
          {adding && cfg ? (
            <div className="rounded-xl border border-accent/30 bg-surface-200/40 p-3">
              <ProviderForm presets={cfg.presets} onDone={(next) => { onSetCfg(next); onAdding(false) }} onCancel={() => onAdding(false)} />
            </div>
          ) : (
            <button className="btn-sm btn-soft w-full justify-center" onClick={() => onAdding(true)}><Plus size={13} />{t('ai.add')}</button>
          )}
          <p className="text-[11px] text-surface-500">{t('ai.apiKeyHint')}</p>
        </div>
      </section>

      <section>
        <h3 className="label mb-2">{t('ai.settings')}</h3>
        <div className="space-y-3">
          <Slider label={t('ai.temperature')} value={cfg?.config.temperature ?? 0.7} min={0} max={2} step={0.1} onChange={(v) => onSaveConfig({ temperature: v })} />
          <Slider label={t('ai.maxTokens')} value={cfg?.config.maxTokens ?? 2048} min={256} max={8192} step={256} suffix="tok" onChange={(v) => onSaveConfig({ maxTokens: v })} />
          <Field label={t('ai.systemPrompt')}>
            <textarea className="input w-full resize-none" rows={3} maxLength={8000} placeholder={t('ai.systemPromptPlaceholder')}
              value={cfg?.config.systemPrompt ?? ''} onChange={(e) => onSaveConfig({ systemPrompt: e.target.value })} />
          </Field>
        </div>
      </section>

      <section>
        <h3 className="label mb-2">{t('ai.tools')}</h3>
        <div className="space-y-1.5">
          <Toggle on={!!cfg?.config.allowNavigation} onChange={(v) => onSaveConfig({ allowNavigation: v })} label={t('ai.toolNavigation')} />
          <Toggle on={!!cfg?.config.allowNotesTasks} onChange={(v) => onSaveConfig({ allowNotesTasks: v })} label={t('ai.toolNotes')} />
          <Toggle on={!!cfg?.config.confirmDestructive} onChange={(v) => onSaveConfig({ confirmDestructive: v })} label={t('ai.toolDestructive')} />
          <Toggle on={!!cfg?.config.allowFileRead} onChange={(v) => onSaveConfig({ allowFileRead: v })} label={t('ai.toolFiles')} />
          <Toggle on={!!cfg?.config.allowSystemStats} onChange={(v) => onSaveConfig({ allowSystemStats: v })} label={t('ai.toolStats')} />
        </div>
      </section>

      <button className="btn-sm btn-ghost text-surface-500 w-full justify-center" onClick={onClear}>
        <Trash2 size={13} />{t('ai.clear')}
      </button>
    </div>
  )
})

/** Memoized chat bubble: markdown is only re-parsed when its message changes,
  * so streaming deltas never re-render the whole history. */
const MessageBubble = memo(function MessageBubble({ msg, reduced }: { msg: ChatMsg; reduced: boolean }) {
  const { t } = useTranslation()
  const knownTools = ['navigate', 'create_note', 'create_task', 'list_items', 'update_task_status', 'system_stats', 'read_file']
  const toolName = (tool: string) => (knownTools.includes(tool) ? t(`ai.toolsNames.${tool}`) : tool)
  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
      <span className={cn('grid place-items-center h-8 w-8 shrink-0 rounded-xl mt-0.5', msg.role === 'user' ? 'bg-surface-200 text-surface-600' : 'bg-accent/12 text-accent')}>
        {msg.role === 'user' ? <User size={15} /> : <Bot size={15} />}
      </span>
      <div className={cn('min-w-0 flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}>
        {!!msg.tools?.length && (
          <div className="flex flex-wrap gap-1.5">
            {msg.tools.map((tool, i) => <span key={`${tool}-${i}`} className="ai-tool-chip"><Sparkles size={10} />{t('ai.usedTool', { tool: toolName(tool) })}</span>)}
          </div>
        )}
        <div className={cn('ai-bubble', msg.role === 'user' ? 'ai-bubble-user' : 'ai-bubble-assistant', msg.error && '!bg-rose-500/10 !border-rose-500/30 text-rose-500')}>
          {msg.role === 'assistant'
            ? <div className="prose-dh" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            : msg.content}
        </div>
      </div>
    </motion.div>
  )
})

function loadChat(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is ChatMsg => !!m && typeof m === 'object' &&
      ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant') &&
      typeof (m as ChatMsg).content === 'string').slice(-MAX_STORED)
  } catch { return [] }
}

/** Provider editor form — shared by first-run setup and the settings pane. */
function ProviderForm({ presets, editing, onDone, onCancel }: {
  presets: AiPreset[]
  editing?: AiProviderPublic | null
  onDone: (cfg: AiPublicConfig) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useApp(useShallow((s) => ({ toast: s.toast })))
  const [preset, setPreset] = useState<AiPresetId>(editing?.preset ?? 'openai')
  const [name, setName] = useState(editing?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? presets.find((p) => p.preset === 'openai')?.baseUrl ?? '')
  const [model, setModel] = useState(editing?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const presetMeta = presets.find((p) => p.preset === preset)
  const pickPreset = (id: AiPresetId) => {
    setPreset(id)
    const meta = presets.find((p) => p.preset === id)
    if (meta && !editing) {
      setBaseUrl(meta.baseUrl)
      setName(meta.name)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      const cfg = await invoke<AiPublicConfig>('ai:upsertProvider', {
        id: editing?.id, preset, name: name || presetMeta?.name, baseUrl, model, apiKey: apiKey || undefined,
      })
      onDone(cfg)
      toast(t('toast.saved'))
    } catch (e) {
      toast(errorMessage(e, t('toast.error')), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <Field label={t('ai.preset')}>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.preset} type="button" onClick={() => pickPreset(p.preset)}
              className={cn('btn-sm border', preset === p.preset ? 'border-accent bg-accent/10 text-accent' : 'border-[color:var(--hairline)] text-surface-600 hover:border-accent/40')}>
              {p.name}{p.local && <span className="text-[10px] opacity-70">({t('ai.local')})</span>}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('ai.providerName')}>
          <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={presetMeta?.name} maxLength={48} />
        </Field>
        <Field label={t('ai.model')} hint={presetMeta && !presetMeta.needsKey ? 'llama3, qwen2.5…' : 'gpt-4o-mini…'}>
          <input className="input w-full" dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" maxLength={128} />
        </Field>
      </div>
      <Field label={t('ai.baseUrl')}>
        <input className="input w-full" dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" maxLength={512} />
      </Field>
      <Field label={t('ai.apiKey')} hint={t('ai.apiKeyHint')}>
        <input className="input w-full" dir="ltr" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={editing?.hasKey ? t('ai.keySet') : 'sk-…'} autoComplete="off" maxLength={4096} />
      </Field>
      <div className="flex items-center gap-2 pt-1">
        <GlowButton tone="accent" className="btn-primary" onClick={save} disabled={busy || !model.trim() || !baseUrl.trim()}>
          <Check size={14} />{editing ? t('ai.save') : t('ai.add')}
        </GlowButton>
        {onCancel && <button className="btn-ghost" onClick={onCancel}>{t('ai.cancel')}</button>}
      </div>
    </div>
  )
}

function ProviderCard({ provider, presets, active, onChanged }: { provider: AiProviderPublic; presets: AiPreset[]; active: boolean; onChanged: (cfg: AiPublicConfig) => void }) {
  const { t } = useTranslation()
  const { toast } = useApp(useShallow((s) => ({ toast: s.toast })))
  const [editing, setEditing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<string[] | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)

  const apply = (cfg: AiPublicConfig) => onChanged(cfg)
  const setActive = async () => {
    try { apply(await invoke<AiPublicConfig>('ai:setConfig', { activeProviderId: provider.id })) }
    catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
  }
  const test = async () => {
    setTesting(true)
    try {
      const res = await invoke<{ models: number }>('ai:test', provider.id)
      toast(t('ai.testOk', { count: res.models }))
    } catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
    finally { setTesting(false) }
  }
  const fetchModels = async () => {
    setTesting(true)
    try {
      const list = await invoke<string[]>('ai:listModels', provider.id)
      setModels(list)
      if (list.length === 0) toast(t('toast.error'), 'error')
    } catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
    finally { setTesting(false) }
  }
  const saveKey = async () => {
    try {
      apply(await invoke<AiPublicConfig>('ai:setKey', provider.id, keyInput))
      setKeyInput(''); setShowKey(false)
      toast(t('toast.saved'))
    } catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
  }
  const remove = async () => {
    try {
      if (!await invoke<boolean>('dialog:confirm', t('ai.deleteConfirm'), t('ai.confirmDelete', { name: provider.name }))) return
      apply(await invoke<AiPublicConfig>('ai:deleteProvider', provider.id))
    } catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
  }
  const pickModel = async (model: string) => {
    try { apply(await invoke<AiPublicConfig>('ai:upsertProvider', { id: provider.id, preset: provider.preset, name: provider.name, baseUrl: provider.baseUrl, model })) }
    catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-accent/30 bg-surface-200/40 p-3">
        <ProviderForm presets={presets} editing={provider} onDone={(cfg) => { apply(cfg); setEditing(false) }} onCancel={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <div className={cn('rounded-xl border p-3 transition-colors', active ? 'border-accent/40 bg-accent/5' : 'border-[color:var(--hairline)] hover:border-accent/30')}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={setActive} aria-pressed={active} title={t('ai.activeProvider')}
          className={cn('h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors', active ? 'border-accent bg-accent' : 'border-surface-400 hover:border-accent')} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium truncate">{provider.name} {active && <span className="text-[10px] text-accent">● {t('ai.activeProvider')}</span>}</p>
          <p className="text-[11px] text-surface-500 truncate" dir="ltr">{provider.model} · {provider.baseUrl}</p>
        </div>
        <span className={cn('badge shrink-0', provider.hasKey ? 'bg-emerald-500/12 text-emerald-500' : 'bg-surface-200 text-surface-500')}>
          {provider.hasKey ? t('ai.keySet') : t('ai.keyMissing')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <button className="btn-sm btn-soft" onClick={test} disabled={testing}><Plug size={12} />{testing ? t('ai.testing') : t('ai.test')}</button>
        <button className="btn-sm btn-soft" onClick={fetchModels} disabled={testing}><RefreshCw size={12} className={testing ? 'animate-spin' : undefined} />{t('ai.models')}</button>
        <button className="btn-sm btn-ghost" onClick={() => setShowKey((v) => !v)}><KeyRound size={12} />{t('ai.changeKey')}</button>
        <button className="btn-sm btn-ghost" onClick={() => setEditing(true)}><Settings2 size={12} /></button>
        <button className="btn-sm btn-ghost hover:!text-rose-500 ms-auto" onClick={remove}><Trash2 size={12} /></button>
      </div>
      {showKey && (
        <div className="flex items-center gap-1.5 mt-2">
          <input className="input flex-1" dir="ltr" type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-…" autoComplete="off" />
          <button className="btn-sm btn-primary" onClick={saveKey} disabled={!keyInput.trim()}><Check size={12} />{t('ai.save')}</button>
        </div>
      )}
      {models && models.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] text-surface-500 mb-1">{t('ai.modelsFound', { count: models.length })}</p>
          <div className="max-h-36 overflow-y-auto rounded-lg border border-[color:var(--hairline)] divide-y divide-[color:var(--hairline)]">
            {models.map((m) => (
              <button key={m} onClick={() => pickModel(m)} className={cn('w-full text-start px-2.5 py-1.5 text-[12px] font-mono truncate hover:bg-surface-200/70', m === provider.model && 'text-accent')} dir="ltr">{m}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Ai() {
  const { t } = useTranslation()
  const { reduced } = useMotionPrefs()
  const { toast, lang } = useApp(useShallow((s) => ({ toast: s.toast, lang: s.settings.language })))
  const [cfg, setCfg] = useState<AiPublicConfig | null>(null)
  const [loadError, setLoadError] = useState('')
  const [messages, setMessages] = useState<ChatMsg[]>(loadChat)
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [input, setInput] = useState('')
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('dh:aiPanel') !== '0')
  const [adding, setAdding] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamingRef = useRef<Streaming | null>(null)
  streamingRef.current = streaming

  const load = useCallback(async () => {
    try {
      setCfg(await invoke<AiPublicConfig>('ai:getConfig'))
      setLoadError('')
    } catch (e) { setLoadError(errorMessage(e, t('toast.error'))) }
  }, [t])

  useEffect(() => { void load() }, [load])

  // Persist the conversation (bounded) so a restart keeps the thread.
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-MAX_STORED))) } catch { /* quota */ }
  }, [messages])
  useEffect(() => { try { localStorage.setItem('dh:aiPanel', panelOpen ? '1' : '0') } catch { /* quota */ } }, [panelOpen])

  // Streaming events: delta text, tool chips, done/error finalization.
  // Deltas accumulate in a ref and flush once per animation frame — a fast
  // provider can emit hundreds of chunks per second, and re-rendering the whole
  // thread per chunk is what made this page feel frozen while streaming.
  const pendingDelta = useRef('')
  const deltaRaf = useRef(0)
  const flushDelta = useCallback(() => {
    deltaRaf.current = 0
    const add = pendingDelta.current
    if (!add) return
    pendingDelta.current = ''
    setStreaming((s) => (s ? { ...s, text: s.text + add } : s))
  }, [])
  const takePending = useCallback(() => {
    if (deltaRaf.current) { cancelAnimationFrame(deltaRaf.current); deltaRaf.current = 0 }
    const add = pendingDelta.current
    pendingDelta.current = ''
    return add
  }, [])
  useEffect(() => {
    const offDelta = on<{ requestId: string; text: string }>('ai:delta', (ev) => {
      if (!ev || ev.requestId !== streamingRef.current?.requestId) return
      pendingDelta.current += ev.text
      if (!deltaRaf.current) deltaRaf.current = requestAnimationFrame(flushDelta)
    })
    const offTool = on<{ requestId: string; tool: string }>('ai:tool', (ev) => {
      if (!ev || ev.requestId !== streamingRef.current?.requestId) return
      setStreaming((s) => (s && s.requestId === ev.requestId && !s.tools.includes(ev.tool) ? { ...s, tools: [...s.tools, ev.tool] } : s))
    })
    const offDone = on<{ requestId: string }>('ai:done', (ev) => {
      const cur = streamingRef.current
      if (!ev || !cur || ev.requestId !== cur.requestId) return
      const text = cur.text + takePending()
      setMessages((m) => (text.trim() ? [...m, { id: cur.requestId, role: 'assistant', content: text, tools: cur.tools }] : m))
      setStreaming(null)
    })
    const offErr = on<{ requestId: string; message: string }>('ai:error', (ev) => {
      const cur = streamingRef.current
      if (!ev || !cur || ev.requestId !== cur.requestId) return
      const text = cur.text + takePending()
      if (text.trim()) setMessages((m) => [...m, { id: cur.requestId, role: 'assistant', content: text, tools: cur.tools }])
      setMessages((m) => [...m, { id: `${cur.requestId}-err`, role: 'assistant', content: t('ai.error', { message: ev.message }), error: true }])
      setStreaming(null)
    })
    return () => { offDelta(); offTool(); offDone(); offErr(); if (deltaRaf.current) cancelAnimationFrame(deltaRaf.current) }
  }, [t, flushDelta, takePending])

  // Abort any in-flight stream when leaving the page.
  useEffect(() => {
    return () => {
      const cur = streamingRef.current
      if (cur) void invoke('ai:abort', cur.requestId).catch(() => {})
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming?.text])

  const activeProvider = useMemo(() => cfg?.providers.find((p) => p.id === cfg.config.activeProviderId) ?? null, [cfg])
  const disabled = !!cfg && !cfg.config.enabled
  const ready = !!cfg && cfg.providers.length > 0 && !disabled

  const send = async () => {
    const text = input.trim()
    if (!text || streaming || !ready) return
    const userMsg: ChatMsg = { id: uid(), role: 'user', content: text }
    const turns: AiChatMessage[] = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, userMsg])
    setInput('')
    const requestId = uid()
    setStreaming({ requestId, text: '', tools: [] })
    const defaultPrompt = lang === 'ar'
      ? 'أنت «ذكاء DragonHub»، المساعد المدمج في تطبيق DragonHub لسطح المكتب. أجب بلغة المستخدم، واستخدم الأدوات عندما يطلب المستخدم إجراءً داخل التطبيق.'
      : ''
    try {
      await invoke('ai:chat', requestId, turns, cfg?.config.systemPrompt || defaultPrompt)
    } catch (e) {
      setStreaming(null)
      toast(errorMessage(e, t('toast.error')), 'error')
    }
  }

  const stop = () => {
    if (streaming) void invoke('ai:abort', streaming.requestId).catch(() => {})
  }

  const saveConfig = useCallback(async (patch: Partial<AiConfig>) => {
    try { setCfg(await invoke<AiPublicConfig>('ai:setConfig', patch)) }
    catch (e) { toast(errorMessage(e, t('toast.error')), 'error') }
  }, [toast, t])

  const clearChat = useCallback(() => {
    setMessages([])
    toast(t('ai.cleared'))
  }, [toast, t])

  const toolName = (tool: string) => {
    const known = ['navigate', 'create_note', 'create_task', 'list_items', 'update_task_status', 'system_stats', 'read_file']
    return known.includes(tool) ? t(`ai.toolsNames.${tool}`) : tool
  }

  return (
    <div className="page-enter h-full flex flex-col min-h-0">
      <PageHeader title={t('ai.title')} icon={<Bot />} subtitle={t('ai.subtitle')}>
        {cfg && cfg.providers.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-[color:var(--hairline)] bg-surface-200/50 px-3 py-1">
            <span className={cn('ai-provider-dot', !ready && 'opacity-40')} />
            <span className="text-xs text-surface-600 max-w-[180px] truncate">{activeProvider ? `${activeProvider.name} · ${activeProvider.model}` : t('ai.noProvider')}</span>
          </div>
        )}
        <Toggle on={!!cfg?.config.enabled} onChange={(v) => saveConfig({ enabled: v })} label={t('ai.enable')} />
        <button className="btn-icon" aria-label={t('ai.newChat')} title={t('ai.newChat')} onClick={() => { setMessages([]); setStreaming(null) }}><MessageSquarePlus size={16} /></button>
        <button className={cn('btn-icon', panelOpen && 'text-accent')} aria-label={t('ai.settings')} aria-pressed={panelOpen} onClick={() => setPanelOpen((v) => !v)}><PanelRightClose size={16} className="rtl:-scale-x-100" /></button>
      </PageHeader>

      <div className="flex-1 min-h-0 flex">
        {/* Chat column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div ref={scrollRef} className="ai-scroll flex-1 overflow-y-auto px-4 sm:px-6 py-5" aria-label={t('ai.a11y.region')}>
            <div className="max-w-3xl mx-auto space-y-4">
              {loadError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
                  <AlertTriangle size={16} />{loadError}
                  <button className="btn-sm btn-ghost ms-auto" onClick={() => void load()}><RefreshCw size={12} />{t('common.retry')}</button>
                </div>
              )}

              {cfg && cfg.providers.length === 0 && (
                <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card card-edge-beam p-6 sm:p-8" data-edge-tone="prism">
                  <div className="card-edge-content">
                    <div className="flex items-center gap-3 mb-5">
                      <span className="grid place-items-center h-11 w-11 rounded-2xl bg-accent/12 text-accent"><Sparkles size={20} /></span>
                      <div>
                        <h2 className="text-[16px] font-semibold tracking-tight">{t('ai.setupTitle')}</h2>
                        <p className="text-xs text-surface-500 mt-0.5">{t('ai.setupDesc')}</p>
                      </div>
                    </div>
                    <ProviderForm presets={cfg.presets} onDone={(next) => { setCfg(next); toast(t('toast.saved')) }} />
                  </div>
                </motion.div>
              )}

              {disabled && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={16} />{t('ai.disabled')}
                </div>
              )}

              {ready && messages.length === 0 && !streaming && (
                <Empty icon={<Bot size={38} />} text={t('ai.empty')} hint={t('ai.emptyHint')} />
              )}

              <AnimatePresence initial={false}>
                {messages.map((m) => <MessageBubble key={m.id} msg={m} reduced={reduced} />)}
              </AnimatePresence>

              {streaming && (
                <div className="flex gap-3">
                  <span className="grid place-items-center h-8 w-8 shrink-0 rounded-xl mt-0.5 bg-accent/12 text-accent"><Bot size={15} /></span>
                  <div className="min-w-0 flex flex-col gap-1 items-start">
                    {streaming.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {streaming.tools.map((tool, i) => <span key={`${tool}-${i}`} className="ai-tool-chip"><Sparkles size={10} />{toolName(tool)}</span>)}
                      </div>
                    )}
                    <div className="ai-bubble ai-bubble-assistant">
                      {streaming.text
                        ? <div className="prose-dh" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming.text) }} />
                        : <span className="ai-typing" aria-label={t('ai.thinking')}><span /><span /><span /></span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 px-4 sm:px-6 pb-4 pt-2">
            <div className="max-w-3xl mx-auto">
              <div className="ai-composer rounded-[var(--r-lg)] bg-surface-100 border border-[color:var(--hairline)] shadow-e1">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
                  }}
                  rows={1}
                  placeholder={ready ? t('ai.placeholder') : t('ai.noProvider')}
                  aria-label={t('ai.a11y.input')}
                  disabled={!ready}
                  className="w-full resize-none bg-transparent outline-none px-4 pt-3 pb-2 text-[13.5px] placeholder:text-surface-500 max-h-40"
                  style={{ minHeight: 44 }}
                />
                <div className="flex items-center gap-2 px-3 pb-2.5">
                  <span className="text-[10.5px] text-surface-500 hidden sm:flex items-center gap-1"><Kbd keys="↵" />{t('ai.send')} · <Kbd keys={['Shift', '↵']} /></span>
                  <span className="flex-1" />
                  {streaming ? (
                    <button className="btn-sm btn-outline text-rose-500 border-rose-500/40" onClick={stop}><Square size={12} />{t('ai.stop')}</button>
                  ) : (
                    <GlowButton tone="accent" className="btn-primary btn-sm" onClick={() => void send()} disabled={!ready || !input.trim()}>
                      <Send size={13} className="rtl:-scale-x-100" />{t('ai.send')}
                    </GlowButton>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Settings pane */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.aside
              initial={reduced ? false : { width: 0, opacity: 0 }} animate={{ width: 348, opacity: 1 }} exit={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              transition={spring.soft}
              className="shrink-0 border-s border-[color:var(--hairline)] bg-surface-100/60 overflow-hidden">
              <SettingsPane cfg={cfg} adding={adding} onSetCfg={setCfg} onAdding={setAdding} onSaveConfig={saveConfig} onClear={clearChat} />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

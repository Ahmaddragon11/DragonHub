import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, ShieldCheck, Lock, Unlock, Plus, Search, Copy, Eye, EyeOff, Star, Trash2, Pencil, KeyRound, Wand2, Download, Upload, Globe, X } from 'lucide-react'
import { useApp } from '@/store'
import { PageHeader, Modal, Field, Toggle, Slider, TagInput, Empty } from '@/components/ui'
import { invoke, on } from '@/lib/api'
import { uid, cn, relTime } from '@/lib/utils'
import type { VaultItem, VaultItemType, VaultMeta } from '@shared/types'

const TYPES: VaultItemType[] = ['password', 'token', 'api_key', 'note', 'card', 'ssh']
const TYPE_COLOR: Record<VaultItemType, string> = { password: 'bg-violet-500', token: 'bg-cyan-500', api_key: 'bg-amber-500', note: 'bg-emerald-500', card: 'bg-rose-500', ssh: 'bg-blue-500' }

function StrengthBar({ pw }: { pw: string }) {
  const { t } = useTranslation()
  const [s, setS] = useState<{ score: number; entropy: number } | null>(null)
  useEffect(() => { if (!pw) { setS(null); return } invoke('vault:strength', pw).then(setS).catch(() => {}) }, [pw])
  if (!s) return null
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-emerald-400']
  const labels = t('vault.strength', { returnObjects: true }) as string[]
  return (
    <div className="mt-1">
      <div className="flex gap-1">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={cn('h-1 flex-1 rounded-full transition-all', i <= s.score ? colors[s.score] : 'bg-surface-300')} />)}</div>
      <div className="text-[11px] opacity-60 mt-1">{labels[s.score]} • {Math.round(s.entropy)} bits</div>
    </div>
  )
}

function Generator({ onUse }: { onUse: (pw: string) => void }) {
  const { t } = useTranslation()
  const [opts, setOpts] = useState({ length: 20, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: false })
  const [pw, setPw] = useState('')
  const gen = () => invoke('vault:generate', opts).then(setPw).catch(() => {})
  useEffect(() => { gen() }, [JSON.stringify(opts)])
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className="input font-mono flex-1" readOnly value={pw} />
        <button className="btn" onClick={gen}><Wand2 size={14} /></button>
        <button className="btn-primary" onClick={() => onUse(pw)}>{t('common.copy')}</button>
      </div>
      <StrengthBar pw={pw} />
      <Field label={`${t('vault.length')}: ${opts.length}`}><Slider value={opts.length} min={6} max={64} step={1} onChange={(v) => setOpts({ ...opts, length: v })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Toggle on={opts.upper} onChange={(v) => setOpts({ ...opts, upper: v })} label={t('vault.upper')} />
        <Toggle on={opts.lower} onChange={(v) => setOpts({ ...opts, lower: v })} label={t('vault.lower')} />
        <Toggle on={opts.digits} onChange={(v) => setOpts({ ...opts, digits: v })} label={t('vault.digits')} />
        <Toggle on={opts.symbols} onChange={(v) => setOpts({ ...opts, symbols: v })} label={t('vault.symbols')} />
        <Toggle on={opts.excludeAmbiguous} onChange={(v) => setOpts({ ...opts, excludeAmbiguous: v })} label={t('vault.ambiguous')} />
      </div>
    </div>
  )
}

function Row({ label, value, secret, revealed, onReveal, onCopy, onOpen, mono }: { label: string; value: string; secret?: boolean; revealed?: boolean; onReveal?: () => void; onCopy?: (v: string) => void; onOpen?: () => void; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="w-32 text-xs opacity-50 shrink-0">{label}</div>
      <div className={cn('flex-1 min-w-0 truncate text-sm', (mono || secret) && 'font-mono')}>{secret && !revealed ? '••••••••••••' : value}</div>
      {secret && <button className="btn-icon" onClick={onReveal}>{revealed ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
      {onOpen && <button className="btn-icon" onClick={onOpen}><Globe size={14} /></button>}
      {onCopy && <button className="btn-icon" onClick={() => onCopy(value)}><Copy size={14} /></button>}
    </div>
  )
}

export default function Vault() {
  const { t, i18n } = useTranslation()
  const { toast, settings } = useApp()
  const [meta, setMeta] = useState<VaultMeta | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState('')
  const [items, setItems] = useState<VaultItem[]>([])
  const [q, setQ] = useState(''); const [typeF, setTypeF] = useState<VaultItemType | 'all'>('all')
  const [sel, setSel] = useState<VaultItem | null>(null)
  const [edit, setEdit] = useState<VaultItem | null>(null)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [genOpen, setGenOpen] = useState(false)
  const [chOpen, setChOpen] = useState(false); const [oldPw, setOldPw] = useState(''); const [newPw, setNewPw] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  // Never leave plaintext secrets in state longer than needed.
  const closeEdit = () => { setEdit(null); setShowSecret(false) }
  const closeChangePw = () => { setChOpen(false); setOldPw(''); setNewPw(''); setErr('') }

  const refresh = async () => { setMeta(await invoke('vault:meta')); const u = await invoke('vault:isUnlocked'); setUnlocked(u); if (u) setItems(await invoke('vault:list')) }
  useEffect(() => { refresh() }, [])
  useEffect(() => on('vault:locked', () => { setUnlocked(false); setItems([]); setSel(null); setEdit(null); setReveal({}) }), [])
  useEffect(() => {
    if (!unlocked) return
    let last = 0
    const h = () => { const now = Date.now(); if (now - last > 15000) { last = now; invoke('vault:touch').catch(() => {}) } }
    window.addEventListener('mousemove', h); window.addEventListener('keydown', h)
    return () => { window.removeEventListener('mousemove', h); window.removeEventListener('keydown', h) }
  }, [unlocked])

  const setup = async () => {
    setErr('')
    if (pw.length < 8) return setErr(t('vault.tooShort'))
    if (pw !== pw2) return setErr(t('vault.mismatch'))
    try { await invoke('vault:init', pw); setPw(''); setPw2(''); await refresh() } catch (e: any) { setErr(String(e.message || e)) }
  }
  const unlock = async () => { setErr(''); try { await invoke('vault:unlock', pw); setPw(''); await refresh() } catch (e: any) { setErr(String(e.message || e)) } }
  const lock = async () => { await invoke('vault:lock'); setUnlocked(false); setItems([]); setSel(null); closeEdit(); setReveal({}); setPw(''); setPw2(''); setErr('') }
  const copy = async (text: string) => { await invoke('clipboard:write', text, settings.vaultClearClipboardSec); toast(t('vault.copiedClear', { s: settings.vaultClearClipboardSec }), 'success') }
  const save = async () => {
    if (!edit || !edit.title.trim()) return
    const it = { ...edit, updatedAt: Date.now() }
    await invoke('vault:upsert', it); setEdit(null); setSel(it); setItems(await invoke('vault:list')); toast(t('toast.saved'))
  }
  const del = async (it: VaultItem) => {
    if (!(await invoke('dialog:confirm', t('common.confirmDelete'), it.title))) return
    await invoke('vault:remove', it.id); setSel(null); setItems(await invoke('vault:list')); toast(t('toast.deleted'))
  }
  const fav = async (it: VaultItem) => { const n = { ...it, favorite: !it.favorite }; await invoke('vault:upsert', n); setItems(await invoke('vault:list')); if (sel?.id === it.id) setSel(n) }
  const changePw = async () => {
    setErr('')
    if (newPw.length < 8) return setErr(t('vault.tooShort'))
    try { await invoke('vault:changePassword', oldPw, newPw); setChOpen(false); setOldPw(''); setNewPw(''); toast(t('toast.updated')) } catch (e: any) { setErr(String(e.message || e)) }
  }
  const doImport = async () => { try { await invoke('vault:import'); await refresh(); toast(t('common.done')) } catch (e: any) { if (e?.message) toast(e.message, 'error') } }
  const newItem = (type: VaultItemType = 'password'): VaultItem => ({ id: uid(), type, title: '', secret: '', tags: [], fields: [], favorite: false, createdAt: Date.now(), updatedAt: Date.now() })

  const filtered = useMemo(() => items.filter((i) => (typeF === 'all' || i.type === typeF) && (!q || [i.title, i.username, i.url, ...i.tags].join(' ').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt), [items, q, typeF])
  const types = t('vault.types', { returnObjects: true }) as Record<string, string>

  if (!meta || !meta.initialized || !unlocked) {
    const isSetup = !!meta && !meta.initialized
    return (
      <div className="h-full flex items-center justify-center page-enter">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card p-8 w-[420px] text-center">
          <motion.div animate={{ rotate: [0, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 4 }} className="mx-auto w-20 h-20 rounded-3xl bg-accent/15 text-accent flex items-center justify-center mb-4 shadow-glow">
            {isSetup ? <Shield size={40} /> : <Lock size={40} />}
          </motion.div>
          <h2 className="text-xl font-bold mb-1">{isSetup ? t('vault.setup') : t('vault.locked')}</h2>
          <p className="text-sm opacity-60 mb-5">{isSetup ? t('vault.setupDesc') : t('vault.enterPassword')}</p>
          <form onSubmit={(e) => { e.preventDefault(); isSetup ? setup() : unlock() }} className="space-y-3 text-start">
            <input type="password" className="input" autoFocus placeholder={t('vault.masterPassword')} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={isSetup ? 'new-password' : 'current-password'} />
            {isSetup && <><StrengthBar pw={pw} /><input type="password" className="input" placeholder={t('vault.confirmPassword')} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></>}
            {err && <div className="text-sm text-red-400">{err}</div>}
            <button type="submit" className="btn-primary w-full">{isSetup ? <><ShieldCheck size={16} /> {t('vault.create')}</> : <><Unlock size={16} /> {t('vault.unlock')}</>}</button>
          </form>
          {!isSetup && <button className="btn-ghost text-xs mt-3" onClick={doImport}><Upload size={12} /> {t('vault.importBackup')}</button>}
          <div className="text-[11px] opacity-40 mt-4">{t('vault.security')}</div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('vault.title')} icon={<ShieldCheck />} subtitle={t('vault.security')}>
        <button className="btn" onClick={() => setGenOpen(true)}><Wand2 size={14} /> {t('vault.generator')}</button>
        <button className="btn" title={t('vault.changePassword')} onClick={() => setChOpen(true)}><KeyRound size={14} /></button>
        <button className="btn" title={t('vault.exportBackup')} onClick={async () => { try { const r = await invoke('vault:export'); if (r) toast(t('common.done')) } catch (e: any) { toast(e.message, 'error') } }}><Download size={14} /></button>
        <button className="btn" title={t('vault.importBackup')} onClick={doImport}><Upload size={14} /></button>
        <button className="btn" onClick={lock}><Lock size={14} /> {t('vault.lock')}</button>
        <button className="btn-primary" onClick={() => setEdit(newItem())}><Plus size={16} /> {t('vault.newItem')}</button>
      </PageHeader>
      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-e border-surface-300 flex flex-col">
          <div className="p-3 space-y-2">
            <div className="relative"><Search size={14} className="absolute start-3 top-3 opacity-50" /><input className="input ps-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="flex flex-wrap gap-1">
              <button className={cn('badge cursor-pointer', typeF === 'all' ? 'bg-accent text-white' : 'bg-surface-200 text-surface-700')} onClick={() => setTypeF('all')}>{t('common.all')}</button>
              {TYPES.map((ty) => <button key={ty} className={cn('badge cursor-pointer', typeF === ty ? 'bg-accent text-white' : 'bg-surface-200 text-surface-700')} onClick={() => setTypeF(ty)}>{types[ty]}</button>)}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1 stagger">
            {filtered.length === 0 && <Empty icon={<Shield size={32} />} text={t('common.empty')} />}
            {filtered.map((it) => (
              <button key={it.id} onClick={() => setSel(it)} className={cn('w-full text-start p-3 rounded-xl flex items-center gap-3 hover:bg-surface-200 transition', sel?.id === it.id && 'bg-surface-200 ring-1 ring-accent/40')}>
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0', TYPE_COLOR[it.type])}>{it.title.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1"><div className="font-medium truncate flex items-center gap-1">{it.favorite && <Star size={11} className="text-amber-400 fill-amber-400" />}{it.title}</div><div className="text-xs opacity-50 truncate">{it.username || it.url || types[it.type]}</div></div>
              </button>
            ))}
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {sel ? (
              <motion.div key={sel.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="max-w-2xl mx-auto space-y-4">
                <div className="flex items-center gap-4">
                  <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold', TYPE_COLOR[sel.type])}>{sel.title.slice(0, 2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0"><h2 className="text-xl font-bold truncate">{sel.title}</h2><div className="text-xs opacity-50">{types[sel.type]} • {relTime(sel.updatedAt, i18n.language)}</div></div>
                  <button className="btn-icon" onClick={() => fav(sel)}><Star size={16} className={sel.favorite ? 'text-amber-400 fill-amber-400' : ''} /></button>
                  <button className="btn-icon" onClick={() => setEdit({ ...sel })}><Pencil size={16} /></button>
                  <button className="btn-icon text-red-400" onClick={() => del(sel)}><Trash2 size={16} /></button>
                </div>
                <div className="card divide-y divide-surface-300">
                  {sel.username && <Row label={t('vault.username')} value={sel.username} onCopy={copy} />}
                  <Row label={t('vault.secret')} value={sel.secret} secret revealed={!!reveal[sel.id]} onReveal={() => setReveal((r) => ({ ...r, [sel.id]: !r[sel.id] }))} onCopy={copy} mono />
                  {sel.url && <Row label={t('vault.url')} value={sel.url} onCopy={copy} onOpen={() => invoke('app:openExternal', sel.url)} />}
                  {sel.fields.map((f, i) => <Row key={i} label={f.label} value={f.value} secret={f.hidden} revealed={!!reveal[sel.id + i]} onReveal={() => setReveal((r) => ({ ...r, [sel.id + i]: !r[sel.id + i] }))} onCopy={copy} />)}
                  {sel.expiresAt && <Row label={t('vault.expires')} value={new Date(sel.expiresAt).toLocaleDateString()} />}
                </div>
                {sel.notes && <div className="card p-4 text-sm whitespace-pre-wrap">{sel.notes}</div>}
                {sel.tags.length > 0 && <div className="flex gap-1 flex-wrap">{sel.tags.map((tg) => <span key={tg} className="badge bg-surface-200 text-surface-700">{tg}</span>)}</div>}
              </motion.div>
            ) : <Empty icon={<ShieldCheck size={48} />} text={t('vault.title')} action={<button className="btn-primary" onClick={() => setEdit(newItem())}><Plus size={14} /> {t('vault.newItem')}</button>} />}
          </AnimatePresence>
        </main>
      </div>

      <Modal open={!!edit} onClose={closeEdit} title={edit?.title || t('vault.newItem')} wide>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.type')}><select className="select" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as VaultItemType })}>{TYPES.map((ty) => <option key={ty} value={ty}>{types[ty]}</option>)}</select></Field>
            <Field label={t('common.title')}><input className="input" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label={t('vault.username')}><input className="input" value={edit.username || ''} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label={t('vault.url')}><input className="input" value={edit.url || ''} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://" /></Field>
            <div className="col-span-2">
              <Field label={t('vault.secret')}>
                <div className="flex gap-2">
                  {edit.type === 'note' || edit.type === 'ssh' ? <textarea className="input font-mono min-h-[100px] flex-1" value={edit.secret} onChange={(e) => setEdit({ ...edit, secret: e.target.value })} autoComplete="off" spellCheck={false} />
                    : (
                      <>
                        <input type={showSecret ? 'text' : 'password'} className="input font-mono flex-1" value={edit.secret} onChange={(e) => setEdit({ ...edit, secret: e.target.value })} autoComplete="new-password" spellCheck={false} />
                        <button className="btn" title={showSecret ? t('vault.hide') : t('vault.show')} onClick={() => setShowSecret((v) => !v)}>{showSecret ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                      </>
                    )}
                  <button className="btn" onClick={async () => setEdit({ ...edit, secret: await invoke('vault:generate', { length: 20, upper: true, lower: true, digits: true, symbols: true }) })}><Wand2 size={14} /></button>
                </div>
                {edit.type === 'password' && <StrengthBar pw={edit.secret} />}
              </Field>
            </div>
            <Field label={t('vault.expires')}><input type="date" className="input" value={edit.expiresAt ? new Date(edit.expiresAt).toISOString().slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, expiresAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></Field>
            <Field label={t('common.tags')}><TagInput tags={edit.tags} onChange={(tags) => setEdit({ ...edit, tags })} /></Field>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1"><span className="label">{t('vault.customFields')}</span><button className="btn-ghost text-xs" onClick={() => setEdit({ ...edit, fields: [...edit.fields, { label: '', value: '', hidden: false }] })}><Plus size={12} /> {t('vault.addField')}</button></div>
              {edit.fields.map((f, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input className="input w-1/3" placeholder={t('common.name')} value={f.label} onChange={(e) => { const fs = [...edit.fields]; fs[i] = { ...f, label: e.target.value }; setEdit({ ...edit, fields: fs }) }} />
                  <input className="input flex-1 font-mono" value={f.value} onChange={(e) => { const fs = [...edit.fields]; fs[i] = { ...f, value: e.target.value }; setEdit({ ...edit, fields: fs }) }} />
                  <button className={cn('btn-icon', f.hidden && 'text-accent')} onClick={() => { const fs = [...edit.fields]; fs[i] = { ...f, hidden: !f.hidden }; setEdit({ ...edit, fields: fs }) }}>{f.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button className="btn-icon text-red-400" onClick={() => setEdit({ ...edit, fields: edit.fields.filter((_, j) => j !== i) })}><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="col-span-2"><Field label={t('vault.notes')}><textarea className="input min-h-[70px]" value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
            <div className="col-span-2 flex justify-end gap-2"><button className="btn" onClick={closeEdit}>{t('common.cancel')}</button><button className="btn-primary" onClick={save}>{t('common.save')}</button></div>
          </div>
        )}
      </Modal>
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title={t('vault.generator')}>
        <Generator onUse={(p) => {
          // Fill the open item form when one is being edited; otherwise copy.
          if (edit) { setEdit({ ...edit, secret: p }); toast(t('toast.copied')); }
          else copy(p)
          setGenOpen(false)
        }} />
      </Modal>
      <Modal open={chOpen} onClose={closeChangePw} title={t('vault.changePassword')}>
        <div className="space-y-3">
          <Field label={t('vault.currentPassword')}><input type="password" className="input" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" /></Field>
          <Field label={t('vault.newPassword')}><input type="password" className="input" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /><StrengthBar pw={newPw} /></Field>
          {err && <div className="text-sm text-red-400">{err}</div>}
          <button className="btn-primary w-full" onClick={changePw}>{t('common.save')}</button>
        </div>
      </Modal>
    </div>
  )
}

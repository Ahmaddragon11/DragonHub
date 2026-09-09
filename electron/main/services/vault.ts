import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { VaultItem, VaultMeta } from '../../../src/shared/types'

/**
 * Vault security model:
 *  - Master password -> PBKDF2-HMAC-SHA512 (600,000 iterations, 32-byte salt) -> 256-bit key
 *  - Data encrypted with AES-256-GCM (12-byte IV, 16-byte auth tag) - authenticated encryption
 *  - Key kept in memory only while unlocked; wiped on lock / auto-lock / app exit
 *  - Master password never stored; verifier = encrypt("dragonhub-verifier") to validate key
 *  - Vault file written atomically; every save uses a fresh IV
 */

const ITERATIONS = 600_000
const VERIFIER_PLAINTEXT = 'dragonhub-vault-verifier-v1'

const vaultDir = () => path.join(app.getPath('userData'), 'vault')
const metaPath = () => path.join(vaultDir(), 'vault.meta.json')
const dataPath = () => path.join(vaultDir(), 'vault.bin')

let key: Buffer | null = null
let cache: VaultItem[] | null = null
let lockTimer: NodeJS.Timeout | null = null
let onLockCb: (() => void) | null = null

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password.normalize('NFKC'), salt, ITERATIONS, 32, 'sha512')
}

function encrypt(k: Buffer, plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]) // iv(12) | tag(16) | ciphertext
}

function decrypt(k: Buffer, blob: Buffer): Buffer {
  if (blob.length < 28) throw new Error('Corrupted vault data')
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const enc = blob.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()])
}

function wipe() {
  if (key) key.fill(0)
  key = null
  cache = null
  if (lockTimer) clearTimeout(lockTimer)
  lockTimer = null
}

export function setOnLock(cb: () => void) { onLockCb = cb }

function scheduleAutoLock(minutes: number) {
  if (lockTimer) clearTimeout(lockTimer)
  lockTimer = null
  if (!Number.isFinite(minutes) || minutes <= 0) return
  lockTimer = setTimeout(() => { wipe(); onLockCb?.() }, Math.min(minutes, 24 * 60) * 60_000)
}

export async function getMeta(): Promise<VaultMeta | null> {
  try {
    return JSON.parse(await fsp.readFile(metaPath(), 'utf8'))
  } catch {
    return null
  }
}

export function isUnlocked() { return key !== null }

/** Passwords are bounded: PBKDF2 on a 100MB string would be a CPU/memory DoS via IPC. */
function assertPassword(pw: unknown, min = 8) {
  if (typeof pw !== 'string' || pw.length < min || pw.length > 256) {
    throw new Error(`Master password must be ${min}..256 characters`)
  }
}

export async function init(password: string): Promise<VaultMeta> {
  if (await getMeta()) throw new Error('Vault already initialized')
  assertPassword(password)
  await fsp.mkdir(vaultDir(), { recursive: true })
  const salt = crypto.randomBytes(32)
  const k = deriveKey(password, salt)
  const verifier = encrypt(k, Buffer.from(VERIFIER_PLAINTEXT))
  const meta: VaultMeta = {
    initialized: true, kdf: 'pbkdf2', iterations: ITERATIONS,
    saltB64: salt.toString('base64'), verifierB64: verifier.toString('base64'), ivB64: '', updatedAt: Date.now(),
  }
  await fsp.writeFile(metaPath(), JSON.stringify(meta), 'utf8')
  key = k
  cache = []
  await saveData()
  return meta
}

export async function unlock(password: string, autoLockMin: number): Promise<VaultItem[]> {
  assertPassword(password, 1)
  const meta = await getMeta()
  if (!meta) throw new Error('Vault not initialized')
  const k = deriveKey(password, Buffer.from(meta.saltB64, 'base64'))
  try {
    const v = decrypt(k, Buffer.from(meta.verifierB64, 'base64')).toString()
    if (v !== VERIFIER_PLAINTEXT) throw new Error()
  } catch {
    k.fill(0)
    // constant-ish delay to slow brute force
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300))
    throw new Error('Incorrect master password')
  }
  key = k
  cache = await loadData()
  scheduleAutoLock(autoLockMin)
  return cache
}

export function lock() { wipe() }

export function touch(autoLockMin: number) { if (key) scheduleAutoLock(autoLockMin) }

async function loadData(): Promise<VaultItem[]> {
  if (!key) throw new Error('Vault locked')
  if (!fs.existsSync(dataPath())) return []
  const blob = await fsp.readFile(dataPath())
  if (blob.length === 0) return []
  return JSON.parse(decrypt(key, blob).toString('utf8'))
}

async function saveData() {
  if (!key || !cache) throw new Error('Vault locked')
  const blob = encrypt(key, Buffer.from(JSON.stringify(cache), 'utf8'))
  const tmp = dataPath() + '.tmp'
  await fsp.writeFile(tmp, blob)
  await fsp.rename(tmp, dataPath())
  const meta = await getMeta()
  if (meta) { meta.updatedAt = Date.now(); await fsp.writeFile(metaPath(), JSON.stringify(meta)) }
}

export function list(): VaultItem[] {
  if (!key || !cache) throw new Error('Vault locked')
  return cache
}

/** Renderer-supplied items are schema-checked: no unbounded strings, no prototype keys. */
function assertVaultItem(item: VaultItem) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid vault item')
  const it = item as unknown as Record<string, unknown>
  if (typeof it.id !== 'string' || !it.id || it.id.length > 128) throw new Error('Invalid vault item id')
  if (typeof it.type !== 'string' || (it.type as string).length > 32) throw new Error('Invalid vault item type')
  for (const k of ['title', 'username', 'secret', 'url', 'notes'] as const) {
    const v = it[k]
    if (v !== undefined && (typeof v !== 'string' || v.length > 64000)) throw new Error(`Vault item field too large: ${k}`)
  }
  const fields = it.fields
  if (fields !== undefined) {
    if (!Array.isArray(fields) || fields.length > 100) throw new Error('Too many custom fields')
    for (const f of fields) {
      if (!f || typeof f !== 'object') throw new Error('Invalid custom field')
      const ff = f as Record<string, unknown>
      if (typeof ff.label !== 'string' || ff.label.length > 256 || typeof ff.value !== 'string' || ff.value.length > 64000) {
        throw new Error('Custom field too large')
      }
    }
  }
}

export async function upsert(item: VaultItem) {
  if (!key || !cache) throw new Error('Vault locked')
  assertVaultItem(item)
  item.updatedAt = Date.now()
  const next = cache.some((x) => x.id === item.id)
    ? cache.map((x) => (x.id === item.id ? item : x))
    : [{ ...item, createdAt: item.createdAt || Date.now() }, ...cache]
  // Bound total vault size so one giant item can't OOM decrypt/unlock.
  if (JSON.stringify(next).length > 5 * 1024 * 1024) throw new Error('Vault too large (max 5MB)')
  cache = next
  await saveData()
  return cache
}

export async function remove(id: string) {
  if (!key || !cache) throw new Error('Vault locked')
  cache = cache.filter((x) => x.id !== id)
  await saveData()
  return cache
}

export async function changePassword(oldPw: string, newPw: string) {
  assertPassword(oldPw, 1)
  assertPassword(newPw)
  const meta = await getMeta()
  if (!meta) throw new Error('Vault not initialized')
  const oldK = deriveKey(oldPw, Buffer.from(meta.saltB64, 'base64'))
  try {
    const v = decrypt(oldK, Buffer.from(meta.verifierB64, 'base64')).toString()
    if (v !== VERIFIER_PLAINTEXT) throw new Error()
  } catch {
    oldK.fill(0)
    throw new Error('Incorrect master password')
  }
  // Resolve current items (works whether locked or unlocked), then wipe the old key.
  const wasUnlocked = key !== null && cache !== null
  const currentItems: VaultItem[] = wasUnlocked ? cache! : await (async () => { key = oldK; try { return await loadData() } finally { key = null } })()
  oldK.fill(0)
  const salt = crypto.randomBytes(32)
  const nk = deriveKey(newPw, salt)
  try {
    // Crash-safe order: back up meta+data, write the NEW data blob first, then meta.
    // A crash between the two steps leaves the old meta+backup intact instead of an
    // unrecoverable new-salt/old-data combination.
    await fsp.mkdir(vaultDir(), { recursive: true })
    const prevMeta = await fsp.readFile(metaPath(), 'utf8').catch(() => null)
    const prevData = await fsp.readFile(dataPath()).catch(() => null)
    if (prevMeta !== null) await fsp.writeFile(metaPath() + '.bak', prevMeta).catch(() => {})
    if (prevData !== null) await fsp.writeFile(dataPath() + '.bak', prevData).catch(() => {})
    const blob = encrypt(nk, Buffer.from(JSON.stringify(currentItems), 'utf8'))
    const tmp = dataPath() + '.tmp'
    await fsp.writeFile(tmp, blob)
    await fsp.rename(tmp, dataPath())
    const next: VaultMeta = {
      ...meta,
      kdf: 'pbkdf2',
      iterations: ITERATIONS,
      saltB64: salt.toString('base64'),
      verifierB64: encrypt(nk, Buffer.from(VERIFIER_PLAINTEXT)).toString('base64'),
      updatedAt: Date.now(),
    }
    await fsp.writeFile(metaPath(), JSON.stringify(next), 'utf8')
    key = nk
    cache = currentItems
    scheduleAutoLock(5)
  } catch (e) {
    nk.fill(0)
    wipe()
    throw e
  }
}

export async function exportEncrypted(dest: string) {
  const meta = await getMeta()
  if (!meta) throw new Error('Vault not initialized')
  const data = fs.existsSync(dataPath()) ? await fsp.readFile(dataPath()) : Buffer.alloc(0)
  const bundle = { meta, data: data.toString('base64'), app: 'DragonHub', v: 1 }
  await fsp.writeFile(dest, JSON.stringify(bundle), 'utf8')
}

const MAX_BACKUP_BYTES = 64 * 1024 * 1024

export async function importEncrypted(src: string) {
  const st = await fsp.stat(src).catch(() => null)
  if (!st || st.size > MAX_BACKUP_BYTES) throw new Error('Invalid vault backup file')
  let bundle: any
  try {
    bundle = JSON.parse(await fsp.readFile(src, 'utf8'))
  } catch {
    throw new Error('Invalid vault backup file')
  }
  if (bundle?.app !== 'DragonHub' || typeof bundle?.meta?.saltB64 !== 'string' || typeof bundle?.meta?.verifierB64 !== 'string') {
    throw new Error('Invalid vault backup file')
  }
  // Refuse bundles that weaken key derivation below what this app produces.
  const iters = Number(bundle.meta.iterations) || 0
  if (bundle.meta.kdf !== 'pbkdf2' || iters < ITERATIONS) throw new Error('Unsupported vault backup (weak key derivation)')
  // Back up the live vault before overwriting so a bad import is recoverable.
  await fsp.mkdir(vaultDir(), { recursive: true })
  const liveMeta = await fsp.readFile(metaPath(), 'utf8').catch(() => null)
  const liveHasData = fs.existsSync(dataPath())
  if (liveMeta !== null) await fsp.writeFile(metaPath() + '.pre-import.bak', liveMeta).catch(() => {})
  if (liveHasData) await fsp.copyFile(dataPath(), dataPath() + '.pre-import.bak').catch(() => {})
  wipe()
  await fsp.writeFile(metaPath(), JSON.stringify(bundle.meta))
  await fsp.writeFile(dataPath(), Buffer.from(String(bundle.data || ''), 'base64'))
}

export function generatePassword(opts: { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean; excludeAmbiguous: boolean }) {
  let pool = ''
  if (opts.lower) pool += 'abcdefghijkmnopqrstuvwxyz' + (opts.excludeAmbiguous ? '' : 'l')
  if (opts.upper) pool += 'ABCDEFGHJKLMNPQRSTUVWXYZ' + (opts.excludeAmbiguous ? '' : 'IO')
  if (opts.digits) pool += '23456789' + (opts.excludeAmbiguous ? '' : '01')
  if (opts.symbols) pool += '!@#$%^&*()-_=+[]{};:,.<>?'
  if (!pool) pool = 'abcdefghijklmnopqrstuvwxyz'
  const len = Math.min(Math.max(opts.length, 4), 128)
  const bytes = crypto.randomBytes(len * 2)
  let out = ''
  for (let i = 0; i < bytes.length && out.length < len; i++) {
    const idx = bytes[i] % pool.length
    out += pool[idx]
  }
  return out
}

export function strength(pw: string): { score: number; entropy: number } {
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33
  const entropy = pw.length * Math.log2(pool || 1)
  const score = entropy < 28 ? 0 : entropy < 36 ? 1 : entropy < 60 ? 2 : entropy < 80 ? 3 : 4
  return { score, entropy: Math.round(entropy) }
}

app.on('before-quit', wipe)

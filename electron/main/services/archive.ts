import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import type { CompressOptions, ArchiveEntry, JobProgress } from '../../../src/shared/types'
import { safePath, assertRemovable } from './files'

async function sevenBin(): Promise<string> {
  const mod = await import('7zip-bin')
  let p = mod.path7za
  // In packaged app, binaries live in app.asar.unpacked
  if (p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked')
  if (process.platform !== 'win32') { try { await fsp.chmod(p, 0o755) } catch { /* */ } }
  return p
}

function progress(win: BrowserWindow | null, p: JobProgress) {
  win?.webContents.send('job:progress', p)
}

const fmtSwitch: Record<string, string> = { zip: 'zip', '7z': '7z', tar: 'tar', gzip: 'gzip', bzip2: 'bzip2', xz: 'xz' }

// ZipSlip / zip-bomb guards applied before every extraction.
const MAX_ARCHIVE_ENTRIES = 200_000
const MAX_ARCHIVE_TOTAL_BYTES = 50 * 1024 * 1024 * 1024 // 50 GiB uncompressed

function assertSafeEntryName(name: string) {
  const n = String(name || '').replace(/\\/g, '/')
  // After normalization there are no backslashes: UNC shows as '//', drives as 'C:...'.
  if (!n || n.startsWith('/') || n.startsWith('//') || /^[a-zA-Z]:/.test(n)) {
    throw new Error(`Blocked unsafe archive entry (absolute path): ${name}`)
  }
  // NTFS alternate data streams (file:stream) must never materialize.
  if (n.includes(':')) {
    throw new Error(`Blocked unsafe archive entry (ADS colon): ${name}`)
  }
  const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
  for (const part of n.split('/')) {
    if (part === '..') throw new Error(`Blocked unsafe archive entry (path traversal): ${name}`)
    if (part.length > 0 && (part.endsWith('.') || part.endsWith(' '))) {
      throw new Error(`Blocked unsafe archive entry (trailing dot/space): ${name}`)
    }
    if (part && RESERVED.test(part)) {
      throw new Error(`Blocked unsafe archive entry (reserved name): ${name}`)
    }
  }
}

/** Reject symlink/hardlink entries using whatever link metadata 7z surfaced
 *  (node-7z list exposes attributes; some versions add link targets). */
function assertNotLinkEntry(e: ArchiveEntry) {
  const raw = e as unknown as Record<string, unknown>
  const attr = String(raw['attributes'] ?? raw['attr'] ?? '')
  const linkTarget = raw['link'] ?? raw['target'] ?? raw['symlink']
  if (typeof linkTarget === 'string' && linkTarget.length > 0) {
    throw new Error(`Blocked unsafe archive entry (link): ${e.name}`)
  }
  if (raw['isSymlink'] === true || raw['isLink'] === true || raw['symlink'] === true) {
    throw new Error(`Blocked unsafe archive entry (link): ${e.name}`)
  }
  // 7z attributes mark links with 'l' (e.g. 'l', 'lrwxrwxrwx'); a lone/short
  // attribute string containing 'l' is treated as a link indicator.
  if (attr && attr.length <= 32 && /(^|[^a-z])l([^a-z]|$)/i.test(attr)) {
    throw new Error(`Blocked unsafe archive entry (link attributes): ${e.name}`)
  }
}

function validateCompressInputs(inputs: string[], opts: CompressOptions) {
  if (!fmtSwitch[opts.format]) throw new Error(`Unsupported archive format: ${opts.format}`)
  const levels = [0, 1, 3, 5, 7, 9]
  if (!levels.includes(opts.level)) throw new Error('Invalid compression level')
  if (opts.splitSizeMB !== undefined && (!Number.isFinite(opts.splitSizeMB) || opts.splitSizeMB < 0 || opts.splitSizeMB > 20_000)) {
    throw new Error('Invalid split size')
  }
  if (opts.password !== undefined && (opts.password.length === 0 || opts.password.length > 512)) {
    throw new Error('Invalid archive password')
  }
  if (!inputs.length) throw new Error('Nothing to compress')
}

export async function compress(win: BrowserWindow | null, jobId: string, inputs: string[], output: string, opts: CompressOptions): Promise<string> {
  const Seven = (await import('node-7z')).default
  const bin = await sevenBin()
  const ins = inputs.map(safePath)
  let out = safePath(output)
  validateCompressInputs(ins, opts)
  // Never silently crush an existing archive: fail EEXIST with a clear error.
  if (fs.existsSync(out)) {
    const e = new Error(`Output already exists (EEXIST): ${out} — choose another name or remove it first`)
    ;(e as NodeJS.ErrnoException).code = 'EEXIST'
    throw e
  }
  const single = ['gzip', 'bzip2', 'xz'].includes(opts.format)
  // gzip/bzip2/xz only compress single files -> wrap in tar first for multiple/dirs
  if (single && (ins.length > 1 || (await fsp.stat(ins[0]).catch(() => null))?.isDirectory())) {
    const tarPath = out.replace(/\.(gz|bz2|xz)$/i, '')
    await new Promise<void>((res, rej) => {
      const s = Seven.add(tarPath, ins, { $bin: bin, archiveType: 'tar', recursive: true, $progress: true })
      s.on('progress', (p: any) => progress(win, { id: jobId, percent: p.percent / 2, done: false, message: 'tar' }))
      s.on('end', () => res()); s.on('error', rej)
    })
    ins.length = 0; ins.push(tarPath)
    opts = { ...opts, deleteAfter: false }
    const result = await compress(win, jobId, [tarPath], out, { ...opts, format: opts.format })
    await fsp.rm(tarPath, { force: true })
    return result
  }

  const options: Record<string, unknown> = {
    $bin: bin,
    archiveType: fmtSwitch[opts.format],
    recursive: true,
    $progress: true,
    method: [`x=${opts.level}`],
  }
  if (opts.password && (opts.format === 'zip' || opts.format === '7z')) {
    options.password = opts.password
    if (opts.format === '7z') (options.method as string[]).push('he=on') // encrypt headers
    if (opts.format === 'zip') (options.method as string[]).push('em=AES256')
  }
  if (opts.format === '7z' && opts.solid === false) (options.method as string[]).push('s=off')
  if (opts.splitSizeMB && opts.splitSizeMB > 0) options.volumes = [`${opts.splitSizeMB}m`]

  await new Promise<void>((res, rej) => {
    const s = Seven.add(out, ins, options as never)
    s.on('progress', (p: any) => progress(win, { id: jobId, percent: p.percent, done: false, message: p.file }))
    s.on('end', () => res())
    s.on('error', (e: any) => rej(e))
  })
  if (opts.deleteAfter) {
    // Only delete sources after verifying the archive exists and is non-empty.
    const st = await fsp.stat(out).catch(() => null)
    if (!st || st.size === 0) throw new Error('Compression produced no output — sources were kept')
    for (const i of ins) {
      assertRemovable(i)
      await fsp.rm(i, { recursive: true, force: true })
    }
  }
  progress(win, { id: jobId, percent: 100, done: true, output: out })
  return out
}

export async function extract(win: BrowserWindow | null, jobId: string, archive: string, dest: string, password?: string): Promise<string> {
  const Seven = (await import('node-7z')).default
  const bin = await sevenBin()
  const a = safePath(archive)
  const d = safePath(dest)
  // Pre-scan the listing: refuse path-traversal entries and obvious zip bombs
  // BEFORE anything is written to disk.
  const entries = await listArchive(a, password)
  validateArchiveEntries(entries)
  await fsp.mkdir(d, { recursive: true })
  await new Promise<void>((res, rej) => {
    // overwrite 'u': auto-rename instead of silently overwriting existing files
    const s = Seven.extractFull(a, d, { $bin: bin, $progress: true, password: password || undefined, overwrite: 'u' } as never)
    s.on('progress', (p: any) => progress(win, { id: jobId, percent: p.percent, done: false, message: p.file }))
    s.on('end', () => res())
    s.on('error', (e: any) => rej(e))
  })
  // Handle .tar.gz double extraction
  const inner = (await fsp.readdir(d)).filter((f) => /\.tar$/i.test(f))
  if (inner.length === 1 && /\.(tgz|tar\.gz|tar\.xz|tar\.bz2)$/i.test(a)) {
    const tarP = path.join(d, inner[0])
    validateArchiveEntries(await listArchive(tarP))
    await new Promise<void>((res, rej) => {
      const s = Seven.extractFull(tarP, d, { $bin: bin } as never)
      s.on('end', () => res()); s.on('error', rej)
    })
    await fsp.rm(tarP, { force: true })
  }
  progress(win, { id: jobId, percent: 100, done: true, output: d })
  return d
}

function validateArchiveEntries(entries: ArchiveEntry[]) {
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Archive blocked: too many entries (${entries.length})`)
  let total = 0
  for (const e of entries) {
    assertSafeEntryName(e.name)
    assertNotLinkEntry(e)
    total += e.size || 0
    if (total > MAX_ARCHIVE_TOTAL_BYTES) throw new Error('Archive blocked: uncompressed size exceeds 50 GiB safety limit')
  }
}

export async function listArchive(archive: string, password?: string): Promise<ArchiveEntry[]> {
  const Seven = (await import('node-7z')).default
  const bin = await sevenBin()
  const a = safePath(archive)
  const entries: ArchiveEntry[] = []
  await new Promise<void>((res, rej) => {
    let rejected = false
    const s = Seven.list(a, { $bin: bin, password: password || undefined } as never)
    // Streaming guard: reject EARLY once the cap is exceeded instead of
    // buffering an unbounded listing in memory (zip-bomb via entry count).
    s.on('data', (e: any) => {
      if (rejected) return
      if (entries.length >= MAX_ARCHIVE_ENTRIES) {
        rejected = true
        rej(new Error(`Archive blocked: too many entries (>${MAX_ARCHIVE_ENTRIES})`))
        return
      }
      entries.push({
        name: e.file, size: Number(e.size) || 0, packed: Number(e.sizeCompressed) || 0, modified: e.datetime ? String(e.datetime) : undefined,
        isDirectory: String(e.attributes || '').startsWith('D'),
      })
      // Carry raw link metadata (if any) for assertNotLinkEntry downstream.
      const last = entries[entries.length - 1] as unknown as Record<string, unknown>
      if (e.attributes !== undefined) last['attributes'] = e.attributes
      if (e.link !== undefined) last['link'] = e.link
    })
    s.on('end', () => { if (!rejected) res() }); s.on('error', (er: unknown) => { if (!rejected) { rejected = true; rej(er) } })
  })
  return entries
}

export async function testArchive(archive: string, password?: string): Promise<boolean> {
  const Seven = (await import('node-7z')).default
  const bin = await sevenBin()
  return new Promise((res) => {
    const s = Seven.test(safePath(archive), { $bin: bin, password: password || undefined } as never)
    s.on('end', () => res(true)); s.on('error', () => res(false))
  })
}

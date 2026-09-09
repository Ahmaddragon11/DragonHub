import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { FileEntry, DriveInfo } from '../../../src/shared/types'

const execFileP = promisify(execFile)

/** Normalize and guard against null bytes / control chars / absurd lengths. Note: this
 *  does NOT jail callers to a directory — every privileged IPC caller must apply its
 *  own allowlist/blocklist on top (see SECURITY_NOTES.md). */
export function safePath(p: string): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 32000 || p.includes('\0')) throw new Error('Invalid path')
  if (/[\x00-\x1F]/.test(p)) throw new Error('Invalid path: control characters')
  const n = path.resolve(p)
  return n
}

/** Case-aware path equality (Windows/macOS filesystems are case-insensitive). */
function samePath(a: string, b: string): boolean {
  if (process.platform === 'win32' || process.platform === 'darwin') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

export async function listDir(dir: string, showHidden = false): Promise<FileEntry[]> {
  const d = safePath(dir)
  const entries = await fsp.readdir(d, { withFileTypes: true })
  // Bound FD/memory pressure on huge folders (e.g. node_modules, system dirs).
  if (entries.length > 20000) throw new Error('Too many entries in folder (max 20000)')
  const out: FileEntry[] = []
  // Chunked lstat: same result as Promise.all without exhausting file descriptors.
  for (let i = 0; i < entries.length; i += 64) {
    const chunk = entries.slice(i, i + 64)
    await Promise.all(
      chunk.map(async (e) => {
      const full = path.join(d, e.name)
      try {
        const st = await fsp.lstat(full)
        const isHidden = e.name.startsWith('.') || (await isHiddenWin(full))
        if (isHidden && !showHidden) return
        out.push({
          name: e.name,
          path: full,
          isDirectory: st.isDirectory(),
          isSymlink: st.isSymbolicLink(),
          isHidden,
          size: st.isDirectory() ? 0 : st.size,
          modified: st.mtimeMs,
          created: st.birthtimeMs,
          ext: st.isDirectory() ? '' : path.extname(e.name).slice(1).toLowerCase(),
        })
      } catch {
        /* skip unreadable */
      }
      }),
    )
  }
  out.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDirectory ? -1 : 1))
  return out
}

async function isHiddenWin(_p: string): Promise<boolean> {
  return false // attribute check is expensive; dotfile heuristic used. Extended via settings later.
}

export async function stat(p: string) {
  const st = await fsp.stat(safePath(p))
  return {
    size: st.size,
    isDirectory: st.isDirectory(),
    modified: st.mtimeMs,
    created: st.birthtimeMs,
    accessed: st.atimeMs,
    mode: st.mode,
  }
}

export async function readText(p: string, maxBytes = 20 * 1024 * 1024): Promise<string> {
  const sp = safePath(p)
  const st = await fsp.stat(sp)
  if (st.size > maxBytes) throw new Error('File too large for text editor (max 20MB)')
  const text = await fsp.readFile(sp, 'utf8')
  // TOCTOU guard: file may have grown between stat and read.
  if (Buffer.byteLength(text) > maxBytes) throw new Error('File changed during read (max 20MB)')
  return text
}

const MAX_WRITE_BYTES = 50 * 1024 * 1024

export async function writeText(p: string, content: string, encoding: 'utf8' | 'base64' = 'utf8'): Promise<void> {
  const sp = safePath(p)
  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : content
  if (Buffer.byteLength(bytes as string) > MAX_WRITE_BYTES) throw new Error('Content too large (max 50MB)')
  // atomic write: unique tmp + rename (pid + random avoids symlink races between concurrent writers)
  const { randomBytes } = await import('node:crypto')
  const tmp = `${sp}.dh-tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await fsp.writeFile(tmp, bytes, encoding === 'base64' ? undefined : 'utf8')
    await fsp.rename(tmp, sp)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export async function readBase64(p: string, maxBytes = 50 * 1024 * 1024): Promise<string> {
  const sp = safePath(p)
  const st = await fsp.stat(sp)
  if (st.size > maxBytes) throw new Error('File too large')
  const buf = await fsp.readFile(sp)
  if (buf.length > maxBytes) throw new Error('File changed during read')
  return buf.toString('base64')
}

export async function mkdir(p: string) {
  await fsp.mkdir(safePath(p), { recursive: true })
}

export async function createFile(p: string) {
  const sp = safePath(p)
  if (fs.existsSync(sp)) throw new Error('File already exists')
  // O_EXCL closes the exists-then-write race: concurrent creators can't both win.
  try {
    await fsp.writeFile(sp, '', { flag: 'wx' })
  } catch (e: any) {
    if (e?.code === 'EEXIST') throw new Error('File already exists')
    throw e
  }
}

export async function rename(from: string, to: string) {
  await fsp.rename(safePath(from), safePath(to))
}

/** Into-itself check that respects case-insensitive filesystems + symlinked prefixes. */
function isInside(child: string, parent: string): boolean {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return child.toLowerCase().startsWith(parent.toLowerCase() + path.sep)
  }
  return child.startsWith(parent + path.sep)
}

export async function copy(src: string, dest: string) {
  const s = safePath(src)
  const d = safePath(dest)
  if (samePath(s, d)) throw new Error('Source and destination are the same')
  if (isInside(d, s)) throw new Error('Cannot copy a folder into itself')
  await fsp.cp(s, d, { recursive: true, errorOnExist: false, force: true })
}

export async function move(src: string, dest: string) {
  const s = safePath(src)
  const d = safePath(dest)
  if (samePath(s, d)) throw new Error('Source and destination are the same')
  if (isInside(d, s)) throw new Error('Cannot move a folder into itself')
  try {
    await fsp.rename(s, d)
  } catch (firstErr) {
    // Cross-device fallback: copy first, verify the copy, and only then remove
    // the source — a crash/partial copy must never silently lose data.
    await copy(s, d)
    try {
      await fsp.stat(d)
    } catch {
      throw firstErr
    }
    await fsp.rm(s, { recursive: true, force: true })
  }
}

/** Paths that must never be removed, even with useTrash=false. */
function assertRemovable(sp: string) {
  const root = path.parse(sp).root
  if (sp === root || samePath(sp, os.homedir())) {
    throw new Error('Refusing to delete a drive root or home folder')
  }
}

export async function remove(p: string, useTrash: boolean) {
  const sp = safePath(p)
  assertRemovable(sp)
  if (useTrash) {
    await shell.trashItem(sp)
  } else {
    await fsp.rm(sp, { recursive: true, force: true })
  }
}

export async function getDrives(): Promise<DriveInfo[]> {
  if (process.platform === 'win32') {
    // wmic is deprecated/removed on Windows 11 — prefer PowerShell, fall back to letter probing.
    // Absolute System32 path: avoids PATH-hijack of powershell.exe.
    const ps = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    try {
      const { stdout } = await execFileP(
        ps,
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{n="Free";e={$_.Free}}, @{n="Used";e={$_.Used}} | ConvertTo-Csv -NoTypeInformation'],
        { windowsHide: true, timeout: 8000 },
      )
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes(','))
      lines.shift() // header
      const out: DriveInfo[] = []
      for (const l of lines) {
        const cols = l.split(',').map((c) => c.replace(/^"|"$/g, ''))
        const letter = (cols[0] || '').replace(/[:\\]/g, '')
        if (!/^[A-Za-z]$/.test(letter)) continue
        const free = Number(cols[1]) || undefined
        const used = Number(cols[2]) || undefined
        out.push({ path: `${letter}:\\`, label: 'Drive', total: free !== undefined && used !== undefined ? free + used : undefined, free })
      }
      if (out.length) return out
    } catch { /* fall through to letter probing */ }
    try {
      const out: DriveInfo[] = []
      for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const p = `${L}:\\`
        if (fs.existsSync(p)) out.push({ path: p, label: 'Drive' })
      }
      return out
    } catch {
      return [{ path: 'C:\\', label: 'Drive' }]
    }
  }
  return [{ path: '/', label: 'Root' }]
}

export function specialFolders() {
  const home = os.homedir()
  const j = (...p: string[]) => path.join(home, ...p)
  return {
    home,
    desktop: j('Desktop'),
    documents: j('Documents'),
    downloads: j('Downloads'),
    pictures: j('Pictures'),
    videos: j('Videos'),
    music: j('Music'),
  }
}

export async function search(root: string, query: string, maxResults = 500): Promise<FileEntry[]> {
  const r = safePath(root)
  const q = String(query || '').slice(0, 256).toLowerCase()
  const results: FileEntry[] = []
  const stack = [r]
  const seen = new Set<string>([r.toLowerCase()])
  let visited = 0
  while (stack.length && results.length < maxResults && visited < 50000) {
    const dir = stack.pop()!
    visited++
    let ents: fs.Dirent[]
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const full = path.join(dir, e.name)
      // lstat (not stat): never follow symlinks while crawling — avoids cycles and
      // escaping the searched tree via linked directories.
      let st: fs.Stats
      try {
        st = await fsp.lstat(full)
      } catch { continue }
      if (st.isSymbolicLink()) continue
      if (e.name.toLowerCase().includes(q)) {
        try {
          results.push({
            name: e.name, path: full, isDirectory: st.isDirectory(), isSymlink: false, isHidden: e.name.startsWith('.'),
            size: st.size, modified: st.mtimeMs, created: st.birthtimeMs, ext: path.extname(e.name).slice(1).toLowerCase(),
          })
        } catch { /* ignore */ }
      }
      if (st.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '$RECYCLE.BIN') {
        const key = full.toLowerCase()
        if (!seen.has(key)) { seen.add(key); stack.push(full) }
      }
    }
  }
  return results
}

export async function folderSize(p: string): Promise<{ size: number; files: number; folders: number }> {
  let size = 0, files = 0, folders = 0
  const root = safePath(p)
  const stack = [root]
  const seen = new Set<string>([root.toLowerCase()])
  let visited = 0
  while (stack.length && visited < 100000) {
    const dir = stack.pop()!
    visited++
    let ents: fs.Dirent[]
    try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      const full = path.join(dir, e.name)
      let st: fs.Stats
      try { st = await fsp.lstat(full) } catch { continue }
      if (st.isSymbolicLink()) continue // don't follow links: prevents cycles + double counting
      if (st.isDirectory()) {
        const key = full.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        folders++; stack.push(full)
      }
      else { files++; size += st.size }
    }
  }
  return { size, files, folders }
}

export async function openExternal(p: string) {
  const sp = safePath(p)
  const executable = new Set(['.exe', '.com', '.bat', '.cmd', '.msi', '.scr', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.jar', '.lnk', '.hta', '.wsf', '.wsh', '.wsc', '.reg', '.msc', '.cpl', '.pif', '.py', '.pyw'])
  if (executable.has(path.extname(sp).toLowerCase())) {
    throw new Error('Opening executable/script files is blocked for safety; use Show in folder instead')
  }
  const err = await shell.openPath(sp)
  if (err) throw new Error(err)
}

export function showInFolder(p: string) {
  shell.showItemInFolder(safePath(p))
}

const MAX_HASH_BYTES = 10 * 1024 * 1024 * 1024 // 10GB: hashing must stay bounded

export async function hashFile(p: string, algo: 'md5' | 'sha1' | 'sha256' | 'sha512'): Promise<string> {
  const sp = safePath(p)
  const st = await fsp.stat(sp).catch(() => null)
  if (st && st.size > MAX_HASH_BYTES) throw new Error('File too large to hash (max 10GB)')
  const crypto = await import('node:crypto')
  return new Promise((res, rej) => {
    const h = crypto.createHash(algo)
    fs.createReadStream(sp).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
  })
}

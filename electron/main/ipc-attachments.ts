import { app, BrowserWindow, dialog, net, protocol } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { h } from './ipc'
import { writeText } from './services/files'

const ATTACH_SCHEME = 'dh-attach'
const ATTACHMENT_FILE_RE = /^[0-9a-f-]+\.(png|jpe?g|gif|webp|avif|bmp)$/i
const ATTACH_REF_RE = /dh-attach:\/\/([0-9a-f-]+\.(?:png|jpe?g|gif|webp|avif|bmp))/gi
const MAX_ATTACH_BYTES = 20 * 1024 * 1024
const MAX_EXPORT_BYTES = 10 * 1024 * 1024

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

type AddAttachmentInput = { name?: unknown; mime?: unknown; bytes?: unknown } | null
type ExportNoteInput = { title?: unknown; markdown?: unknown } | null

function attachmentsDir(): string {
  return path.join(app.getPath('userData'), 'attachments')
}

/** IPC payloads arrive as ArrayBuffer (structured clone) or a typed-array view. */
function toBuffer(bytes: unknown): Buffer | null {
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes))
  if (ArrayBuffer.isView(bytes)) {
    const v = bytes as ArrayBufferView
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  }
  return null
}

function magicMatches(mime: string, b: Buffer): boolean {
  switch (mime) {
    case 'image/png':
      return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'image/gif':
      return b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a')
    case 'image/webp':
      return b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'
    case 'image/avif':
      return b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(b.subarray(8, 32).toString('latin1'))
    case 'image/bmp':
      return b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d
    default:
      return false
  }
}

/** Names come from the URL authority/path; the uuid.ext regex is the traversal guard. */
function attachmentNameFromUrl(raw: string): string | null {
  if (!raw.toLowerCase().startsWith(`${ATTACH_SCHEME}://`)) return null
  const rest = raw
    .slice(ATTACH_SCHEME.length + 3)
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, '')
  let name: string
  try {
    name = decodeURIComponent(rest)
  } catch {
    return null
  }
  return ATTACHMENT_FILE_RE.test(name) ? name : null
}

let protocolRegistered = false
function ensureAttachmentProtocol(): void {
  if (protocolRegistered) return
  let handled = false
  try {
    handled = typeof protocol.isProtocolHandled === 'function' && protocol.isProtocolHandled(ATTACH_SCHEME)
  } catch { /* older Electron without the probe — fall through */ }
  if (!handled) {
    protocol.handle(ATTACH_SCHEME, async (request) => {
      const file = attachmentNameFromUrl(request.url)
      if (!file) return new Response('Bad request', { status: 400 })
      const full = path.join(attachmentsDir(), file)
      try {
        const st = await fsp.stat(full)
        if (!st.isFile()) return new Response('Not found', { status: 404 })
      } catch {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(full).toString())
    })
  }
  protocolRegistered = true
}

export function registerAttachmentHandlers(): void {
  ensureAttachmentProtocol()

  h('notes:addAttachment', async (input: AddAttachmentInput) => {
    const raw = input ?? {}
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : 'image'
    const mime = typeof raw.mime === 'string' ? raw.mime.toLowerCase().split(';')[0].trim() : ''
    const ext = MIME_EXT[mime]
    if (!ext) throw new Error('Unsupported image type')
    const bytes = toBuffer(raw.bytes)
    if (!bytes || bytes.length === 0) throw new Error('Missing image data')
    if (bytes.length > MAX_ATTACH_BYTES) throw new Error('Image too large (max 20MB)')
    if (!magicMatches(mime, bytes)) throw new Error('Image data does not match its declared type')
    const dir = attachmentsDir()
    await fsp.mkdir(dir, { recursive: true })
    const file = `${randomUUID()}.${ext}`
    await fsp.writeFile(path.join(dir, file), bytes)
    return { ref: `${ATTACH_SCHEME}://${file}`, name }
  })

  h('notes:exportNote', async (input: ExportNoteInput) => {
    const raw = input ?? {}
    const title = typeof raw.title === 'string' ? raw.title : ''
    const markdown = typeof raw.markdown === 'string' ? raw.markdown : ''
    if (Buffer.byteLength(markdown) > MAX_EXPORT_BYTES) throw new Error('Note is too large to export (max 10MB)')
    const refs = Array.from(new Set(Array.from(markdown.matchAll(ATTACH_REF_RE), (m) => m[1])))
    const cleaned = Array.from(title, (c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c)).join('')
    const safeTitle = cleaned.replace(/\s+/g, ' ').trim().slice(0, 80) || 'note'
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
    const opts = { defaultPath: `${safeTitle}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] }
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const filePath = r.filePath
    let out = markdown
    let images = 0
    if (refs.length) {
      const filesDirName = `${path.basename(filePath, path.extname(filePath)) || 'note'}_files`
      const filesDir = path.join(path.dirname(filePath), filesDirName)
      await fsp.mkdir(filesDir, { recursive: true })
      const srcDir = attachmentsDir()
      const copied = new Set<string>()
      for (const file of refs) {
        try {
          await fsp.copyFile(path.join(srcDir, file), path.join(filesDir, file))
          copied.add(file)
          images++
        } catch { /* missing attachment: its dh-attach ref stays in the exported file */ }
      }
      const encDir = encodeURI(filesDirName)
      out = markdown.replace(ATTACH_REF_RE, (m, file: string) => (copied.has(file) ? `${encDir}/${file}` : m))
    }
    await writeText(filePath, out)
    return { path: filePath, images }
  })
}

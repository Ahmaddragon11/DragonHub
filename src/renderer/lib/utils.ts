export const uid = () => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
      const b = new Uint8Array(16)
      crypto.getRandomValues(b)
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    }
  } catch { /* fall through to Math.random fallback */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function formatBytes(n: number, d = 1) {
  if (!Number.isFinite(n) || !n || n < 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : d)} ${u[i]}`
}

export function formatDuration(s: number) {
  if (!isFinite(s) || s <= 0) return '--:--'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function formatDate(ts?: number, lang = 'en') {
  if (!ts) return ''
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(ts)
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()
function getRtf(lang: string) {
  const key = lang === 'ar' ? 'ar' : 'en'
  let r = rtfCache.get(key)
  if (!r) { r = new Intl.RelativeTimeFormat(key, { numeric: 'auto' }); rtfCache.set(key, r) }
  return r
}

export function relTime(ts: number, lang = 'en') {
  if (!Number.isFinite(ts)) return ''
  const diff = (ts - Date.now()) / 1000
  const rtf = getRtf(lang)
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return rtf.format(Math.round(diff / (86400 * 30)), 'month')
}

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f43f5e', '#f59e0b', '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#64748b']

export function extToLang(ext: string): string {
  const m: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', jsonc: 'json', html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less', md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
    php: 'php', sql: 'sql', sh: 'shell', bash: 'shell', ps1: 'powershell', bat: 'bat', cmd: 'bat', yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml', toml: 'ini', ini: 'ini', cfg: 'ini',
    dart: 'dart', swift: 'swift', lua: 'lua', r: 'r', pl: 'perl', dockerfile: 'dockerfile', graphql: 'graphql', vue: 'html', txt: 'plaintext', log: 'plaintext', env: 'plaintext',
  }
  return m[String(ext || '').toLowerCase()] || 'plaintext'
}

export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'svg', 'ico'])
export const VIDEO_EXT = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts'])
export const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'])
export const ARCHIVE_EXT = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso'])
export const TEXT_EXT = new Set(['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'sql', 'sh', 'bat', 'ps1', 'yml', 'yaml', 'xml', 'ini', 'toml', 'log', 'env', 'csv', 'svg', 'rb', 'kt', 'dart', 'lua', 'vue', 'cfg', 'gitignore'])

export function stripPath(p: string) {
  return p.split(/[\\/]/).pop() || p
}

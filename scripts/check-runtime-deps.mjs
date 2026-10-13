// Guards against the packaging bug this project shipped once: `sharp` sat in
// devDependencies while `electron/main` imported it at runtime. Vite externalised
// it (see vite.config.ts), electron-builder does not bundle devDependencies, and
// every packaged build died with MODULE_NOT_FOUND on the Images page while a
// plain `npm run dev` looked perfectly healthy.
//
// Rule: anything listed as external in vite.config.ts is resolved from
// node_modules at runtime, therefore it MUST be a production dependency.
// Usage: npm run check:deps
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

const root = process.cwd()
const pkgPath = path.join(root, 'package.json')
const vitePath = path.join(root, 'vite.config.ts')

// `electron` is external by design and stays a devDependency: the packaged app
// gets its runtime from the electron-builder-downloaded binary, not from
// node_modules, so demanding it in `dependencies` would be a false positive.
const ALLOWED_DEV_ONLY = new Map([
  ['electron', 'the Electron runtime is injected by electron-builder into the packaged app, not bundled from node_modules'],
])

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

function readText(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`[check-runtime-deps] Cannot read ${label}: ${path.relative(root, filePath)} not found.`)
    process.exit(1)
  }
  return fs.readFileSync(filePath, 'utf8')
}

const pkg = JSON.parse(readText(pkgPath, 'package.json'))
const viteSource = readText(vitePath, 'vite config')

// --- Minimal scanner: pull every `external: [...]` array out of vite.config.ts ---
// This covers both `build.rollupOptions.external` and vite-plugin-electron's own
// `external` option, since both use the same `external:` key. It is not a JS
// parser, so it deliberately stops at the first unbalanced/odd token instead of
// trying to understand arbitrary expressions.

function skipString(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      i += 2
      let depth = 1
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') depth--
        else if (source[i] === '"' || source[i] === "'" || source[i] === '`') i = skipString(source, i)
        i++
      }
      continue
    }
    if (ch === quote) return i + 1
    i++
  }
  return source.length
}

function findArrayEnd(source, start) {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(source, i) - 1
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i)
      if (newline === -1) return -1
      i = newline
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      if (close === -1) return -1
      i = close + 1
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function extractExternalBodies(source) {
  const bodies = []
  const pattern = /\bexternal\s*:/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    let i = match.index + match[0].length
    while (i < source.length && /\s/.test(source[i])) i++
    if (source[i] !== '[') continue // `external: someVariable` — not statically resolvable
    const end = findArrayEnd(source, i)
    if (end === -1) continue
    bodies.push(source.slice(i + 1, end))
    pattern.lastIndex = end
  }
  return bodies
}

function parseEntries(body) {
  const entries = []
  let depth = 0
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(body, i)
      if (depth === 0) entries.push({ kind: 'string', value: body.slice(i + 1, Math.max(i + 1, end - 1)) })
      i = end
      continue
    }
    // Regex literal such as /^@electron\// — distinguishable from a comment by
    // requiring the next character to be neither '/' nor '*'.
    if (ch === '/' && !['/', '*'].includes(body[i + 1] ?? '')) {
      const end = body.indexOf('/', i + 1)
      if (end === -1) break
      if (depth === 0) {
        const flags = (body.slice(end + 1).match(/^[a-z]*/) || [''])[0]
        entries.push({ kind: 'regex', value: body.slice(i + 1, end), flags })
      }
      i = end + 1
      continue
    }
    if (ch === '/' && (body[i + 1] === '/' || body[i + 1] === '*')) {
      if (body[i + 1] === '/') {
        const newline = body.indexOf('\n', i)
        if (newline === -1) break
        i = newline + 1
      } else {
        const close = body.indexOf('*/', i + 2)
        if (close === -1) break
        i = close + 2
      }
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth--
    i++
  }
  return entries
}

function packageNameOf(specifier) {
  if (builtins.has(specifier)) return null
  if (specifier.startsWith('node:')) return null
  if (specifier.startsWith('.') || specifier.startsWith('/') || path.isAbsolute(specifier)) return null
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) return null
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

const dependencies = new Set(Object.keys(pkg.dependencies || {}))
const devDependencies = new Set(Object.keys(pkg.devDependencies || {}))

const entries = extractExternalBodies(viteSource).flatMap(parseEntries)
if (entries.length === 0) {
  console.error('[check-runtime-deps] No `external` list found in vite.config.ts — the config shape changed and this guard is no longer checking anything.')
  process.exit(1)
}

const offenders = new Map()
const patterns = []
const seen = new Set()
let skipped = 0

for (const entry of entries) {
  if (entry.kind === 'regex') {
    patterns.push(entry)
    continue
  }
  const name = packageNameOf(entry.value)
  if (!name) {
    skipped++
    continue
  }
  seen.add(name)
  if (dependencies.has(name)) continue
  if (ALLOWED_DEV_ONLY.has(name)) continue
  if (!offenders.has(name)) offenders.set(name, entry.value)
}

// A regex external cannot be enumerated, so test it against the manifest
// instead: a pattern that matches a devDependency is the same bug in disguise.
for (const pattern of patterns) {
  let regex
  try {
    regex = new RegExp(pattern.value, pattern.flags)
  } catch {
    console.error(`[check-runtime-deps] Cannot parse external regex /${pattern.value}/${pattern.flags} — fix vite.config.ts or this script.`)
    process.exit(1)
  }
  for (const name of devDependencies) {
    if (regex.test(name) && !dependencies.has(name) && !ALLOWED_DEV_ONLY.has(name)) {
      offenders.set(name, `/${pattern.value}/${pattern.flags}`)
    }
  }
}

const externals = [...seen].sort()

if (offenders.size > 0) {
  console.error('[check-runtime-deps] FAILED — externalised runtime modules are not production dependencies.')
  console.error('')
  for (const [name, specifier] of [...offenders].sort()) {
    console.error(`  ${name}  (external: ${JSON.stringify(specifier)})`)
  }
  console.error('')
  console.error('These modules are listed as external in vite.config.ts, so they are NOT bundled')
  console.error('into dist-electron and must be resolved from node_modules at runtime.')
  console.error('electron-builder only ships `dependencies`, so as devDependencies they are')
  console.error('absent from every packaged build and fail with MODULE_NOT_FOUND on first use.')
  console.error('')
  console.error('Fix: move each package from devDependencies to dependencies,')
  console.error('     or drop it from vite.config.ts if it is bundled after all.')
  process.exit(1)
}

const exempted = externals.filter((name) => ALLOWED_DEV_ONLY.has(name))
const exemptNote = exempted.length > 0 ? ` (${exempted.join(', ')} exempted: devDependency by design)` : ''
const regexNote = patterns.length > 0 ? `, ${patterns.length} regex pattern(s) matched against the manifest` : ''
console.log(
  `check:deps OK — ${externals.length} externalised runtime module(s) are declared in dependencies` +
    `${exemptNote}${regexNote}; ${skipped} built-in/relative specifier(s) ignored.`,
)
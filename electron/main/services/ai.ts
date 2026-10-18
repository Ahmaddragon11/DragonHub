import Store from 'electron-store'
import { safeStorage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataCollections } from './settings'
import { getLiveState } from './netmonitor'
import { getResSnapshot } from './resmonitor'
import { readText } from './files'
import {
  AI_PRESETS, DEFAULT_AI_CONFIG, MAX_AI_MESSAGE_CHARS, MAX_AI_MESSAGES,
  type AiChatMessage, type AiConfig, type AiPresetId, type AiProviderPublic, type Note, type Task,
} from '../../../src/shared/types'

type EventSink = (channel: string, payload: unknown) => void

interface StoredProvider {
  id: string
  preset: AiPresetId
  name: string
  baseUrl: string
  model: string
}

interface AiStore {
  config: AiConfig
  providers: StoredProvider[]
  keys: Record<string, string> // provider id → encrypted API key blob
}

const store = new Store<AiStore>({
  name: 'dragonhub-ai',
  defaults: { config: { ...DEFAULT_AI_CONFIG }, providers: [], keys: {} },
  clearInvalidConfig: true,
})

const PRESET_IDS = new Set<AiPresetId>(AI_PRESETS.map((p) => p.preset))
const NAV_PAGES = new Set(['dashboard', 'notes', 'projects', 'tasks', 'ai', 'files', 'editor', 'downloads', 'network', 'resources', 'taskManager', 'screenshot', 'compress', 'images', 'video', 'vault', 'shortcuts', 'settings', 'about'])
const TASK_STATUSES = new Set(['todo', 'in_progress', 'review', 'done'])
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const MAX_PROVIDERS = 8
const MAX_KEY_CHARS = 4096
const MAX_SYSTEM_PROMPT = 8000
const MAX_TOOL_ROUNDS = 5
const MAX_MODELS = 300
const MAX_READ_BYTES = 256 * 1024
const clamp = (n: number, min: number, max: number, fallback: number): number => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

const activeChats = new Map<string, AbortController>()

/* ------------------------------------------------------------- encryption */
function encryptKey(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `d1:${safeStorage.encryptString(plain).toString('base64')}`
  }
  // DPAPI unavailable (rare; e.g. some Linux setups) — store obscured, never plain.
  return `p0:${Buffer.from(plain, 'utf8').toString('base64')}`
}

function decryptKey(blob: string): string {
  try {
    if (blob.startsWith('d1:')) return safeStorage.decryptString(Buffer.from(blob.slice(3), 'base64'))
    if (blob.startsWith('p0:')) return Buffer.from(blob.slice(3), 'base64').toString('utf8')
  } catch { /* corrupted key blob — treat as missing */ }
  return ''
}

/* -------------------------------------------------------------- validation */
function sanitizeConfig(patch: Partial<AiConfig>): Partial<AiConfig> {
  const out: Partial<AiConfig> = {}
  if (patch.enabled !== undefined) out.enabled = !!patch.enabled
  if (patch.activeProviderId !== undefined) {
    out.activeProviderId = typeof patch.activeProviderId === 'string' && patch.activeProviderId.length <= 64
      ? patch.activeProviderId
      : null
  }
  if (patch.temperature !== undefined) out.temperature = clamp(patch.temperature, 0, 2, DEFAULT_AI_CONFIG.temperature)
  if (patch.maxTokens !== undefined) out.maxTokens = Math.round(clamp(patch.maxTokens, 128, 8192, DEFAULT_AI_CONFIG.maxTokens))
  if (patch.systemPrompt !== undefined && typeof patch.systemPrompt === 'string') {
    out.systemPrompt = patch.systemPrompt.slice(0, MAX_SYSTEM_PROMPT)
  }
  if (patch.allowNavigation !== undefined) out.allowNavigation = !!patch.allowNavigation
  if (patch.allowNotesTasks !== undefined) out.allowNotesTasks = !!patch.allowNotesTasks
  if (patch.confirmDestructive !== undefined) out.confirmDestructive = !!patch.confirmDestructive
  if (patch.allowFileRead !== undefined) out.allowFileRead = !!patch.allowFileRead
  if (patch.allowSystemStats !== undefined) out.allowSystemStats = !!patch.allowSystemStats
  return out
}

/** Normalize + validate an OpenAI-compatible base URL. Plain http is only
 *  allowed for loopback hosts (Ollama/LM Studio); everything else must be TLS. */
function sanitizeBaseUrl(raw: string): string {
  const value = (raw ?? '').trim()
  if (!value || value.length > 512) throw new Error('Provider URL is required')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Provider URL is invalid') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Provider URL must use http(s)')
  if (url.username || url.password) throw new Error('Provider URL must not embed credentials')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (url.protocol === 'http:' && !loopback) throw new Error('Plain http is only allowed for local providers')
  if (host === '169.254.169.254' || host === 'metadata.google.internal' || /^169\.254\./.test(host)) {
    throw new Error('Provider URL host is blocked')
  }
  const cleanPath = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${cleanPath}`
}

function publicProvider(p: StoredProvider, keys: Record<string, string>): AiProviderPublic {
  return { id: p.id, preset: p.preset, name: p.name, baseUrl: p.baseUrl, model: p.model, hasKey: !!keys[p.id] }
}

/* -------------------------------------------------------------------- CRUD */
function readStore(): AiStore {
  const raw = store.store as Partial<AiStore>
  const config = { ...DEFAULT_AI_CONFIG, ...sanitizeConfig(raw.config ?? {}) }
  const providers: StoredProvider[] = Array.isArray(raw.providers)
    ? raw.providers.filter((p): p is StoredProvider =>
        !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string' &&
        typeof p.baseUrl === 'string' && typeof p.model === 'string' && PRESET_IDS.has(p.preset)).slice(0, MAX_PROVIDERS)
    : []
  if (config.activeProviderId && !providers.some((p) => p.id === config.activeProviderId)) {
    config.activeProviderId = providers[0]?.id ?? null
  }
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {}
  return { config, providers, keys }
}

export function getPublicConfig() {
  const { config, providers, keys } = readStore()
  return {
    config,
    providers: providers.map((p) => publicProvider(p, keys)),
    presets: AI_PRESETS,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }
}

export function setConfig(patch: Partial<AiConfig>) {
  const current = readStore()
  const next = { ...current.config, ...sanitizeConfig(patch ?? {}) }
  if (next.activeProviderId && !current.providers.some((p) => p.id === next.activeProviderId)) {
    next.activeProviderId = current.providers[0]?.id ?? null
  }
  store.set('config', next)
  return getPublicConfig()
}

export interface AiProviderInput {
  id?: string
  preset?: AiPresetId
  name?: string
  baseUrl?: string
  model?: string
  apiKey?: string
}

export function upsertProvider(input: AiProviderInput) {
  const current = readStore()
  const preset: AiPresetId = input?.preset && PRESET_IDS.has(input.preset) ? input.preset : 'custom'
  const presetMeta = AI_PRESETS.find((p) => p.preset === preset)!
  const name = (input?.name ?? presetMeta.name).trim().slice(0, 48) || presetMeta.name
  const baseUrl = sanitizeBaseUrl(input?.baseUrl ?? presetMeta.baseUrl)
  const model = (input?.model ?? '').trim().slice(0, 128)
  if (!model) throw new Error('Model name is required')

  const existingIndex = input?.id ? current.providers.findIndex((p) => p.id === input.id) : -1
  const provider: StoredProvider = {
    id: existingIndex >= 0 ? current.providers[existingIndex].id : randomUUID(),
    preset, name, baseUrl, model,
  }
  if (existingIndex >= 0) current.providers[existingIndex] = provider
  else {
    if (current.providers.length >= MAX_PROVIDERS) throw new Error(`At most ${MAX_PROVIDERS} providers are supported`)
    current.providers.push(provider)
  }
  store.set('providers', current.providers)

  if (typeof input?.apiKey === 'string' && input.apiKey.trim()) {
    if (input.apiKey.length > MAX_KEY_CHARS) throw new Error('API key is too long')
    current.keys[provider.id] = encryptKey(input.apiKey.trim())
    store.set('keys', current.keys)
  }
  if (!current.config.activeProviderId) {
    store.set('config', { ...current.config, activeProviderId: provider.id })
  }
  return getPublicConfig()
}

export function deleteProvider(id: string) {
  const current = readStore()
  current.providers = current.providers.filter((p) => p.id !== id)
  delete current.keys[id]
  store.set('providers', current.providers)
  store.set('keys', current.keys)
  if (current.config.activeProviderId === id) {
    store.set('config', { ...current.config, activeProviderId: current.providers[0]?.id ?? null })
  }
  return getPublicConfig()
}

export function setKey(id: string, key: string) {
  const current = readStore()
  if (!current.providers.some((p) => p.id === id)) throw new Error('Provider not found')
  const value = (key ?? '').trim()
  if (value.length > MAX_KEY_CHARS) throw new Error('API key is too long')
  if (value) current.keys[id] = encryptKey(value)
  else delete current.keys[id]
  store.set('keys', current.keys)
  return getPublicConfig()
}

function resolveProvider(id?: string) {
  const { config, providers, keys } = readStore()
  const provider = id ? providers.find((p) => p.id === id) : providers.find((p) => p.id === config.activeProviderId)
  if (!provider) throw new Error('No AI provider is configured')
  const presetMeta = AI_PRESETS.find((p) => p.preset === provider.preset)
  if (presetMeta?.needsKey && !keys[provider.id]) throw new Error(`Add an API key for ${provider.name} first`)
  return { provider, apiKey: keys[provider.id] ? decryptKey(keys[provider.id]) : '', config }
}

/* ----------------------------------------------------------- model listing */
export async function listModels(id?: string): Promise<string[]> {
  const { provider, apiKey } = resolveProvider(id)
  const response = await fetch(`${provider.baseUrl}/models`, {
    headers: {
      accept: 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status} for the model list`)
  const body: unknown = await response.json()
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data
    .map((m) => (m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? (m as { id: string }).id : null))
    .filter((m): m is string => !!m)
    .slice(0, MAX_MODELS)
}

export async function testProvider(id?: string): Promise<{ ok: true; models: number; provider: string }> {
  const { provider } = resolveProvider(id)
  const models = await listModels(provider.id)
  return { ok: true, models: models.length, provider: provider.name }
}

/* ----------------------------------------------------------------- tools */
interface ToolCall { id: string; name: string; args: string }

function toolDefinitions(config: AiConfig) {
  const tools: object[] = []
  if (config.allowNavigation) {
    tools.push({
      type: 'function',
      function: {
        name: 'navigate',
        description: 'Open a DragonHub section in the app for the user.',
        parameters: { type: 'object', properties: { page: { type: 'string', enum: [...NAV_PAGES] } }, required: ['page'] },
      },
    })
  }
  if (config.allowNotesTasks) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'create_note',
          description: 'Create a note in DragonHub.',
          parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_task',
          description: 'Create a task in DragonHub. dueInDays is relative to today.',
          parameters: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, dueInDays: { type: 'number' } }, required: ['title'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_items',
          description: 'List existing notes, tasks or projects so the user can pick one.',
          parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['notes', 'tasks', 'projects'] } }, required: ['kind'] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'update_task_status',
          description: 'Change a task status by its id (get ids from list_items first).',
          parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] } }, required: ['id', 'status'] },
        },
      },
    )
  }
  if (config.allowSystemStats) {
    tools.push({
      type: 'function',
      function: {
        name: 'system_stats',
        description: 'Read live CPU, memory, disk and network usage for this device.',
        parameters: { type: 'object', properties: {} },
      },
    })
  }
  if (config.allowFileRead) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a small text file by absolute path (max 256 KB).',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    })
  }
  return tools
}

function summarizeItems(kind: string): string {
  if (kind === 'notes') {
    const notes = dataCollections.get<Note[]>('notes', []).filter((n) => !n.archived).slice(0, 25)
    return JSON.stringify(notes.map((n) => ({ id: n.id, title: n.title, tags: n.tags, updatedAt: n.updatedAt })))
  }
  if (kind === 'tasks') {
    const tasks = dataCollections.get<Task[]>('tasks', []).slice(0, 25)
    return JSON.stringify(tasks.map((k) => ({ id: k.id, title: k.title, status: k.status, priority: k.priority, dueDate: k.dueDate ?? null })))
  }
  if (kind === 'projects') {
    const projects = dataCollections.get<{ id: string; name: string; status: string; progress: number }[]>('projects', []).slice(0, 25)
    return JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name, status: p.status, progress: p.progress })))
  }
  return JSON.stringify({ error: 'Unknown kind' })
}

async function executeTool(call: ToolCall, config: AiConfig, emit: EventSink): Promise<string> {
  let args: Record<string, unknown> = {}
  try { args = call.args ? JSON.parse(call.args) : {} } catch { return JSON.stringify({ error: 'Tool arguments were not valid JSON' }) }
  emit('ai:tool', { tool: call.name })

  switch (call.name) {
    case 'navigate': {
      if (!config.allowNavigation) return JSON.stringify({ error: 'Navigation is disabled in settings' })
      const page = String(args.page ?? '')
      if (!NAV_PAGES.has(page)) return JSON.stringify({ error: 'Unknown page' })
      emit('ai:navigate', { page })
      return JSON.stringify({ ok: true, page })
    }
    case 'create_note': {
      if (!config.allowNotesTasks) return JSON.stringify({ error: 'Notes/tasks tools are disabled in settings' })
      const title = String(args.title ?? '').trim().slice(0, 200) || 'AI note'
      const content = String(args.content ?? '').slice(0, 20_000)
      const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).map((t) => String(t).slice(0, 24)).slice(0, 8) : ['ai']
      const note: Note = {
        id: randomUUID(), title, content, tags, color: '#8b5cf6', pinned: false, archived: false, favorite: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      }
      const notes = dataCollections.get<Note[]>('notes', [])
      notes.unshift(note)
      dataCollections.set('notes', notes)
      emit('ai:dataChanged', {})
      return JSON.stringify({ ok: true, id: note.id, title })
    }
    case 'create_task': {
      if (!config.allowNotesTasks) return JSON.stringify({ error: 'Notes/tasks tools are disabled in settings' })
      const title = String(args.title ?? '').trim().slice(0, 200) || 'AI task'
      const priority = TASK_PRIORITIES.has(String(args.priority)) ? String(args.priority) as Task['priority'] : 'medium'
      const dueInDays = Number(args.dueInDays)
      const dueDate = Number.isFinite(dueInDays) ? Date.now() + Math.max(0, Math.min(365, dueInDays)) * 86_400_000 : undefined
      const tasks = dataCollections.get<Task[]>('tasks', [])
      const task: Task = {
        id: randomUUID(), title, description: '', status: 'todo', priority, tags: ['ai'],
        dueDate, subtasks: [], createdAt: Date.now(), updatedAt: Date.now(), order: tasks.length,
      }
      tasks.unshift(task)
      dataCollections.set('tasks', tasks)
      emit('ai:dataChanged', {})
      return JSON.stringify({ ok: true, id: task.id, title, dueDate: dueDate ?? null })
    }
    case 'update_task_status': {
      if (!config.allowNotesTasks) return JSON.stringify({ error: 'Notes/tasks tools are disabled in settings' })
      const id = String(args.id ?? '')
      const status = String(args.status ?? '')
      if (!TASK_STATUSES.has(status)) return JSON.stringify({ error: 'Unknown status' })
      const tasks = dataCollections.get<Task[]>('tasks', [])
      const task = tasks.find((k) => k.id === id)
      if (!task) return JSON.stringify({ error: 'Task not found' })
      task.status = status as Task['status']
      task.updatedAt = Date.now()
      if (status === 'done') task.completedAt = Date.now()
      else delete task.completedAt
      dataCollections.set('tasks', tasks)
      emit('ai:dataChanged', {})
      return JSON.stringify({ ok: true, id, status })
    }
    case 'list_items':
      if (!config.allowNotesTasks) return JSON.stringify({ error: 'Notes/tasks tools are disabled in settings' })
      return summarizeItems(String(args.kind ?? 'notes'))
    case 'system_stats': {
      if (!config.allowSystemStats) return JSON.stringify({ error: 'System stats are disabled in settings' })
      const snap = getResSnapshot()
      const net = getLiveState()
      const total = os.totalmem()
      const free = os.freemem()
      const disk = snap?.disks?.[0]
      return JSON.stringify({
        cpuPercent: Math.round(snap?.cpuPercent ?? 0),
        memPercent: Math.round(((total - free) / total) * 100),
        memUsedMB: Math.round((total - free) / 1_048_576),
        memTotalMB: Math.round(total / 1_048_576),
        diskPercent: disk && disk.totalGB > 0 ? Math.round(((disk.totalGB - disk.freeGB) / disk.totalGB) * 100) : null,
        gpuPercent: snap?.gpu?.percent ?? null,
        downMBps: net ? Math.round((net.downSpeedBps / 1_048_576) * 100) / 100 : null,
        upMBps: net ? Math.round((net.upSpeedBps / 1_048_576) * 100) / 100 : null,
        uptimeMin: Math.round(os.uptime() / 60),
        platform: `${os.platform()} ${os.release()}`,
      })
    }
    case 'read_file': {
      if (!config.allowFileRead) return JSON.stringify({ error: 'File reading is disabled in settings' })
      const p = String(args.path ?? '')
      if (!path.isAbsolute(p)) return JSON.stringify({ error: 'An absolute path is required' })
      try {
        const info = await fs.promises.stat(p)
        if (!info.isFile()) return JSON.stringify({ error: 'Not a file' })
        if (info.size > MAX_READ_BYTES) return JSON.stringify({ error: 'File is larger than 256 KB' })
        const text = await readText(p, MAX_READ_BYTES)
        return JSON.stringify({ ok: true, path: p, content: text.slice(0, 16_000) })
      } catch (error: any) {
        return JSON.stringify({ error: error?.message || 'Could not read the file' })
      }
    }
    default:
      return JSON.stringify({ error: 'Unknown tool' })
  }
}

/* --------------------------------------------------------------- streaming */
interface StreamState { content: string; toolCalls: Map<number, ToolCall>; finish: string }

function accumulateDelta(state: StreamState, delta: Record<string, unknown>, onText: (text: string) => void): void {
  const content = delta.content
  if (typeof content === 'string' && content) {
    state.content += content
    onText(content)
  }
  const finish = delta.finish_reason
  if (typeof finish === 'string') state.finish = finish
  const calls = delta.tool_calls
  if (Array.isArray(calls)) {
    for (const raw of calls) {
      if (!raw || typeof raw !== 'object') continue
      const c = raw as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }
      const index = typeof c.index === 'number' ? c.index : 0
      const entry = state.toolCalls.get(index) ?? { id: '', name: '', args: '' }
      if (typeof c.id === 'string' && c.id) entry.id = c.id
      if (c.function && typeof c.function.name === 'string' && c.function.name) entry.name = c.function.name
      if (c.function && typeof c.function.arguments === 'string') entry.args += c.function.arguments
      state.toolCalls.set(index, entry)
    }
  }
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  state: StreamState,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      signal.throwIfAborted()
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let chunk: { choices?: { delta?: Record<string, unknown> }[] }
        try { chunk = JSON.parse(payload) } catch { continue }
        const delta = chunk.choices?.[0]?.delta
        if (delta && typeof delta === 'object') accumulateDelta(state, delta, onText)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export interface ChatResult { status: 'done' | 'aborted' }

/** Stream one chat completion run, including up to MAX_TOOL_ROUNDS tool rounds. */
export async function chat(
  requestId: string,
  rawTurns: unknown,
  rawSystemPrompt: unknown,
  emit: EventSink,
): Promise<ChatResult> {
  if (typeof requestId !== 'string' || !requestId || requestId.length > 64) throw new Error('Invalid request id')
  if (activeChats.has(requestId)) throw new Error('Duplicate request id')

  const { provider, apiKey, config } = resolveProvider()
  if (!config.enabled) throw new Error('The AI assistant is disabled in settings')

  const turns: AiChatMessage[] = (Array.isArray(rawTurns) ? rawTurns : [])
    .filter((m): m is { role: string; content: string } =>
      !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string' &&
      ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant'))
    .slice(-MAX_AI_MESSAGES)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, MAX_AI_MESSAGE_CHARS) }))
  if (turns.length === 0) throw new Error('The conversation is empty')

  const systemPrompt = typeof rawSystemPrompt === 'string' && rawSystemPrompt.trim()
    ? rawSystemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT)
    : 'You are DragonHub AI, the built-in assistant of the DragonHub desktop app. Answer in the language of the user. Use tools when the user asks you to act inside the app.'

  const messages: Record<string, unknown>[] = [{ role: 'system', content: systemPrompt }, ...turns]
  const tools = toolDefinitions(config)
  const controller = new AbortController()
  activeChats.set(requestId, controller)

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const state: StreamState = { content: '', toolCalls: new Map(), finish: '' }
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          stream: true,
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
      })
      if (!response.ok || !response.body) {
        let detail = `HTTP ${response.status}`
        try {
          const text = (await response.text()).slice(0, 400)
          if (text) detail += ` — ${text}`
        } catch { /* body already consumed */ }
        throw new Error(`The provider rejected the request: ${detail}`)
      }

      await consumeSse(
        response.body as unknown as ReadableStream<Uint8Array>,
        state,
        (text) => emit('ai:delta', { requestId, text }),
        controller.signal,
      )

      const toolCalls = [...state.toolCalls.values()].filter((c) => c.name)
      if (toolCalls.length === 0 || round === MAX_TOOL_ROUNDS) break

      messages.push({
        role: 'assistant',
        content: state.content || null,
        tool_calls: toolCalls.map((c) => ({ id: c.id || `call_${randomUUID()}`, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
      })
      for (const call of toolCalls) {
        const result = await executeTool(call, config, emit)
        messages.push({ role: 'tool', tool_call_id: call.id || 'call', content: result })
      }
    }
    emit('ai:done', { requestId, reason: controller.signal.aborted ? 'aborted' : 'stop' })
    return { status: controller.signal.aborted ? 'aborted' : 'done' }
  } catch (error: any) {
    if (controller.signal.aborted) {
      emit('ai:done', { requestId, reason: 'aborted' })
      return { status: 'aborted' }
    }
    emit('ai:error', { requestId, message: error?.message || 'The assistant request failed' })
    return { status: 'done' }
  } finally {
    activeChats.delete(requestId)
  }
}

export function abort(requestId: string): boolean {
  const controller = activeChats.get(requestId)
  if (!controller) return false
  controller.abort()
  activeChats.delete(requestId)
  return true
}

export function stopAllChats(): void {
  for (const controller of activeChats.values()) controller.abort()
  activeChats.clear()
}

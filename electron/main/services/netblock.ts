/**
 * netblock.ts — full-internet kill-switch for DragonHub via Windows Firewall.
 *
 * Standalone service (no imports from other DragonHub services, no new deps).
 * Uses only `execFile('netsh', [...])` with argument arrays — never shell strings.
 *
 * (a) Admin / UAC:
 *     Creating or deleting firewall rules requires Administrator. DragonHub ships
 *     with `requestedExecutionLevel: asInvoker`, so a non-elevated call fails and
 *     `setBlocked()` returns `{ blocked: <actual>, needsAdmin: true }` instead of
 *     succeeding. The UI must then guide the user to relaunch as admin
 *     ("Run as administrator") and retry. This service itself NEVER attempts any
 *     UAC bypass, elevation helper, or scheduled-task trick — fail-closed attempt,
 *     explicit `needsAdmin` signal, nothing more.
 *
 * (b) Persistence:
 *     Firewall rules persist across reboots. A crash while blocked would otherwise
 *     leave the user offline. Hence `cleanupStaleRules()` (delete both rules,
 *     swallow all errors, fail-open by design) must run at app startup, and the
 *     main process must restore connectivity on quit (delete rules / unblock).
 *
 * (c) Blast radius:
 *     The outbound block (`dir=out action=block`, all programs/protocols) stops
 *     browsers, fetch/downloads, and yt-dlp child processes. Localhost / Electron
 *     IPC is unaffected in production because the renderer loads via `file://`
 *     and the app uses no loopback HTTP servers — only Electron IPC + local files.
 */

import { execFile as execFileCb, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Outbound kill-switch rule: blocks all egress (all programs/protocols). */
export const RULE_OUT = 'DragonHub-Block-Out' as const;
/** Inbound companion rule: blocks all ingress while engaged. */
export const RULE_IN = 'DragonHub-Block-In' as const;

export interface SetBlockedResult {
  blocked: boolean;
  needsAdmin: boolean;
}

interface NetshResult {
  stdout: string;
  stderr: string;
}

const NETSH_TIMEOUT_MS = 15000;
const NO_RULES_MATCH = 'No rules match';
const ADMIN_PATTERN = /administrator|elevation|access is denied|0x80070005|0x80070422/i;
const ENABLED_PATTERN = /Enabled:\s*Yes/i;

/** Absolute System32 netsh (no PATH-hijack); bare-name fallback for dev hosts. */
function netshBin(): string {
  const abs = 'C:\\Windows\\System32\\netsh.exe';
  try {
    if (fs.existsSync(abs)) return abs;
  } catch { /* ignore */ }
  try {
    if (process.env.SystemRoot) {
      const cand = path.join(process.env.SystemRoot, 'System32', 'netsh.exe');
      if (fs.existsSync(cand)) return cand;
    }
  } catch { /* ignore */ }
  return 'netsh';
}

/** Defense in depth: rule names are internal constants, but never let a
 *  crafted name smuggle extra netsh tokens (netsh re-splits spaces). */
function assertSafeRuleName(ruleName: string): void {
  if (!/^[A-Za-z0-9-]+$/.test(ruleName)) throw new Error(`Unsafe firewall rule name: ${ruleName}`);
}

/** Run netsh with an argument array (no shell). Rejects with stdout/stderr attached. */
function runNetsh(args: readonly string[]): Promise<NetshResult> {
  return new Promise<NetshResult>((resolve, reject) => {
    execFileCb(netshBin(), [...args], { windowsHide: true, timeout: NETSH_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = error as NodeJS.ErrnoException & {
          stdout?: unknown;
          stderr?: unknown;
        };
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        reject(wrapped);
        return;
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Flatten any execFile failure (message + stdout + stderr + code) into searchable text. */
function toolText(err: unknown): string {
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: unknown;
      stderr?: unknown;
    };
    const parts: string[] = [e.message ?? String(e)];
    if (typeof e.stdout === 'string' && e.stdout.length > 0) parts.push(e.stdout);
    else if (e.stdout !== undefined && e.stdout !== null && typeof e.stdout !== 'string') {
      parts.push(String(e.stdout));
    }
    if (typeof e.stderr === 'string' && e.stderr.length > 0) parts.push(e.stderr);
    else if (e.stderr !== undefined && e.stderr !== null && typeof e.stderr !== 'string') {
      parts.push(String(e.stderr));
    }
    if (e.code !== undefined && e.code !== null) parts.push(`code=${String(e.code)}`);
    return parts.join('\n');
  }
  return String(err ?? '');
}

function toShortError(text: string, fallback: string): Error {
  const trimmed = text.trim().slice(0, 300);
  return new Error(trimmed.length > 0 ? trimmed : fallback);
}

/**
 * True when the named rule exists and is enabled.
 * `show rule` prints "No rules match the specified criteria." when absent
 * (netsh may exit non-zero in that case — treated as "not blocked").
 */
async function hasRule(ruleName: string): Promise<boolean> {
  assertSafeRuleName(ruleName);
  let combined: string;
  try {
    const { stdout, stderr } = await runNetsh([
      'advfirewall',
      'firewall',
      'show',
      'rule',
      `name="${ruleName}"`,
    ]);
    combined = `${stdout}\n${stderr}`;
  } catch (err: unknown) {
    const text = toolText(err);
    if (text.includes(NO_RULES_MATCH)) return false;
    throw toShortError(text, `netsh show rule failed for ${ruleName}`);
  }
  if (combined.includes(NO_RULES_MATCH)) return false;
  // Exact rule-name match: parse "Rule Name:" lines and compare with ===
  // (substring includes() would match e.g. "DragonHub-Block-Out2" or an
  // attacker rule named "x DragonHub-Block-Out x").
  const names: string[] = [];
  for (const line of combined.split(/\r?\n/)) {
    const m = /^\s*Rule Name:\s*(.+?)\s*$/.exec(line);
    if (m) names.push(m[1].trim());
  }
  return names.some((n) => n === ruleName) && ENABLED_PATTERN.test(combined);
}

async function addRule(ruleName: string, dir: 'in' | 'out'): Promise<void> {
  assertSafeRuleName(ruleName);
  try {
    await runNetsh([
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name="${ruleName}"`,
      `dir=${dir}`,
      'action=block',
      'enable=yes',
      'profile=any',
    ]);
  } catch (err: unknown) {
    throw toShortError(toolText(err), `Failed to add firewall rule ${ruleName}`);
  }
}

/** Delete a rule; absent rules ("No rules match") count as success. */
async function deleteRule(ruleName: string): Promise<void> {
  assertSafeRuleName(ruleName);
  try {
    await runNetsh(['advfirewall', 'firewall', 'delete', 'rule', `name="${ruleName}"`]);
  } catch (err: unknown) {
    const text = toolText(err);
    if (text.includes(NO_RULES_MATCH)) return;
    throw toShortError(text, `Failed to delete firewall rule ${ruleName}`);
  }
}

/** True if EITHER kill-switch rule exists (outbound or inbound). */
export async function isBlocked(): Promise<boolean> {
  const [outBlocked, inBlocked] = await Promise.all([hasRule(RULE_OUT), hasRule(RULE_IN)]);
  return outBlocked || inBlocked;
}

/**
 * Idempotently engage (`on=true`) or release (`on=false`) the kill-switch.
 * - Returns early when already in the desired state.
 * - Engaging repairs partial states (e.g. OUT present but IN missing): both
 *   rules are rebuilt from scratch, and a failed IN add rolls back OUT so the
 *   firewall is never left half-applied.
 * - Admin/elevation failures return `{ blocked: <actual state>, needsAdmin: true }`.
 * - All other tool failures throw an Error trimmed to 300 chars.
 */
export async function setBlocked(on: boolean): Promise<SetBlockedResult> {
  const current: boolean = await isBlocked();
  if (current === on) return { blocked: current, needsAdmin: false };

  try {
    if (on) {
      // Start clean so a half-applied previous attempt cannot linger.
      await deleteRule(RULE_OUT).catch(() => {});
      await deleteRule(RULE_IN).catch(() => {});
      await addRule(RULE_OUT, 'out');
      try {
        await addRule(RULE_IN, 'in');
      } catch (e) {
        await deleteRule(RULE_OUT).catch(() => {});
        throw e;
      }
    } else {
      await deleteRule(RULE_OUT);
      await deleteRule(RULE_IN);
    }
  } catch (err: unknown) {
    const text = toolText(err);
    if (ADMIN_PATTERN.test(text)) {
      let actual: boolean = current;
      try {
        actual = await isBlocked();
      } catch {
        // Best-effort re-read failed: fall back to pre-attempt state.
      }
      return { blocked: actual, needsAdmin: true };
    }
    throw toShortError(text, on ? 'Failed to enable network block' : 'Failed to disable network block');
  }

  const blocked: boolean = await isBlocked();
  return { blocked, needsAdmin: false };
}

/**
 * Delete both rules, swallowing ALL errors. Fail-open by design: run at startup
 * so a previous crash can never leave the user offline.
 */
export async function cleanupStaleRules(): Promise<void> {
  try {
    await deleteRule(RULE_OUT);
  } catch {
    // Intentionally swallowed: startup cleanup must never throw.
  }
  try {
    await deleteRule(RULE_IN);
  } catch {
    // Intentionally swallowed: startup cleanup must never throw.
  }
}

/**
 * Synchronous variant for `before-quit`: the async version cannot be awaited
 * there (the process may exit before `netsh delete` runs). Blocks briefly
 * (5s max, typically <300ms) and never throws.
 */
export function cleanupStaleRulesSync(): void {
  for (const name of [RULE_OUT, RULE_IN]) {
    try {
      spawnSync(netshBin(), ['advfirewall', 'firewall', 'delete', 'rule', `name="${name}"`], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore',
      });
    } catch {
      // Intentionally swallowed: quit-time cleanup must never throw.
    }
  }
}

// ---------------------------------------------------------------------------
// Per-application internet block (Network v2 — "block internet for one app").
// Same safety contract as the global kill-switch: netsh only, arg arrays,
// no shell, no elevation attempts. Without admin rights the call reports
// { blocked: <actual>, needsAdmin: true } and fails open.
// Per-app rules are intentionally persistent (user choice) — startup cleanup
// only touches the global RULE_OUT/RULE_IN pair, never per-app rules.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const APP_RULE_PREFIX = 'DragonHub-App-';

export interface AppBlockResult { blocked: boolean; needsAdmin: boolean; exePath: string }

function sanitizeExePath(exePath: unknown): string {
  if (typeof exePath !== 'string') throw new Error('Invalid application path');
  const p = exePath.trim();
  if (!p || p.length > 1024 || p.includes('\0') || p.includes('"')) throw new Error('Invalid application path');
  if (!/^[A-Za-z]:[\\/].*\.exe$/i.test(p)) throw new Error('Only absolute .exe paths can be blocked');
  if (p.includes('..')) throw new Error('Invalid application path');
  return p;
}

function appRuleName(exePath: string): string {
  const base = (exePath.split(/[\\/]/).pop() || 'app').replace(/\.exe$/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
  const hash = createHash('sha1').update(exePath.toLowerCase()).digest('hex').slice(0, 10);
  const name = `${APP_RULE_PREFIX}${base}-${hash}`;
  assertSafeRuleName(name);
  return name;
}

async function addAppRule(ruleName: string, exePath: string): Promise<void> {
  assertSafeRuleName(ruleName);
  try {
    await runNetsh([
      'advfirewall', 'firewall', 'add', 'rule',
      `name="${ruleName}"`, 'dir=out', 'action=block', 'enable=yes', 'profile=any',
      `program="${exePath}"`,
    ]);
  } catch (err: unknown) {
    throw toShortError(toolText(err), `Failed to block ${exePath}`);
  }
}

export async function isAppBlocked(exePath: string): Promise<boolean> {
  const p = sanitizeExePath(exePath);
  return hasRule(appRuleName(p));
}

export async function setAppBlocked(exePath: string, on: boolean): Promise<AppBlockResult> {
  const p = sanitizeExePath(exePath);
  const rule = appRuleName(p);
  let current = false;
  try { current = await hasRule(rule); } catch { current = false; }
  if (current === !!on) return { blocked: current, needsAdmin: false, exePath: p };
  try {
    if (on) {
      await deleteRule(rule).catch(() => {});
      await addAppRule(rule, p);
    } else {
      await deleteRule(rule);
    }
  } catch (err: unknown) {
    const text = toolText(err);
    if (ADMIN_PATTERN.test(text)) {
      let actual = current;
      try { actual = await hasRule(rule); } catch { /* keep pre-attempt state */ }
      return { blocked: actual, needsAdmin: true, exePath: p };
    }
    throw toShortError(text, on ? 'Failed to block application' : 'Failed to unblock application');
  }
  let blocked = !!on;
  try { blocked = await hasRule(rule); } catch { /* trust requested state */ }
  return { blocked, needsAdmin: false, exePath: p };
}

/** Best-effort existence check so the UI can warn about moved/uninstalled apps. */
export function appExeExists(exePath: string): boolean {
  try { return fs.existsSync(sanitizeExePath(exePath)); } catch { return false; }
}

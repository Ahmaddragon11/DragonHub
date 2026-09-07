# Security Review (v1.2.0)

## Boundaries (preserved)
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Renderer has no Node/fs/shell access; all privileged work goes through explicit IPC
  handlers in `electron/main/ipc.ts` bridged by `electron/preload/index.ts`.
- External links open only for `http(s)`/`mailto:` via `shell.openExternal`; renderer
  navigation and `window.open` are blocked/denied.
- Markdown renderer escapes all HTML before inject (`lib/markdown.ts`).

## Fixed in 1.2.0
| # | Issue | Fix |
|---|---|---|
| 1 | ZipSlip + zip bombs on extract | Pre-scan listing; refuse `..`/absolute entries; 200k-entry + 50 GiB caps; `overwrite:'u'` auto-rename |
| 2 | `changePassword` data-loss window (meta written before data) | Data blob first, then meta; `.bak` backups; old key wiped; failure re-locks |
| 3 | Backup import accepted anything (weak KDF, unbounded, wiped live vault first) | 64MB cap, schema check, minimum-iteration enforcement, pre-import backups |
| 4 | SSRF (any http URL incl. 127.0.0.1/169.254.x) | Literal private/loopback/link-local hosts refused |
| 5 | Unbounded media/archive IPC numbers | Clamps + codec/format/preset allow-lists at service boundary |
| 6 | Settings/data stores accepted arbitrary keys/values | `sanitizePatch` + data-key allow-list + 50MB caps + proto guards |
| 7 | Symlink cycles in search/folder-size (`stat` follows links) | `lstat`, skip symlinks, visited-set, iteration caps |
| 8 | Predictable shared temp files | pid+random names, try/finally cleanup |
| 9 | `wmic` dependency (removed on Win11) | PowerShell probe with timeout + letter fallback |
| 10 | Notifications permission denied globally → reminders silent | `notifications` allow-listed; everything else still denied |
| 11 | Secrets lingered in renderer state | Cleared on lock/modal-close; masked inputs; autocomplete hints |
| 12 | Shortcuts fired while typing | Typing-target guard (inputs/textareas/selects/contentEditable/Monaco) |

## Residual risks (accepted, documented)
1. **`dh-file://` has no per-folder jail.** It serves any existing non-directory path to
   the sandboxed renderer. Exploitation requires renderer XSS first, but a jail
   (allow-list download/media dirs + one-time tokens) is recommended next.
2. **Preload exposes a generic `invoke(channel, …)`.** A typed-method-only bridge would
   shrink the reachable surface after an XSS. Mitigated by handler-side validation above.
3. **Full-disk `fs:*` IPC.** Validation is per-service; there is no global block-list for
   system paths (e.g. writing a Startup-folder file after a dialog). A sensitive-path
   confirmation layer in `ipc.ts` is recommended next.
4. **DNS-rebinding SSRF.** The guard covers literal IPs, not DNS that resolves private.
   Downloads carry no credentials/internal headers, which bounds the impact.
5. **Archive passwords via CLI args** are visible to local process listing during the
   operation. OS-user-local exposure; accepted (7-Zip has no stdin-password path here).
6. **JS string immutability.** `key.fill(0)` wipes Buffers, not every string copy the
   runtime made. Documented; keys live only in main memory and are wiped on lock/quit.
7. **No brute-force counter** on vault unlock (400–700ms delay only). OS-local attacker
   model; a counter with escalating delay is recommended next.

## Crypto statement
- KDF: PBKDF2-HMAC-SHA512, 600,000 iterations, 32-byte random salt, NFKC-normalized password.
- Cipher: AES-256-GCM, fresh 12-byte IV per save, blob layout `iv(12)‖tag(16)‖ct`.
- Verifier: encryption of `dragonhub-vault-verifier-v1` under the derived key.
- No recovery path exists by design; the setup screen states this explicitly.

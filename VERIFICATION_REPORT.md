# Test & Verification Report (v1.3.0)

> Constraint: this pass was done **offline** — `node_modules` is not installed, so
> `tsc`, unit tests and `electron-builder` could not run here. The checks below are
> static + contract verification. Run `npm install && npm run typecheck && npm run dist`
> on a connected Windows machine before release; then smoke-test the installer.

## Static verification performed (this machine, no downloads)
- [x] Full-tokenizer bracket-balance scan (strings/templates/regex/comments/JSX-aware,
      validated 100% clean on the pristine tree first) over **all 37 source files** — all pass.
- [x] `package.json` / `package-lock.json` parse as JSON; version bumped to 1.2.0
      in `package.json` + `APP_VERSION` + IPC `app:version` build stamp (all three agree).
- [x] Grep sweeps: no remaining `v1.0.0` references, no `wmic`, no `overwrite: 'a'`,
      no `require('node:fs')`, no count-based `untitled-${tabs.length`, no dead
      `Toggle on={false} onChange={()=>{}}`, no `html.light .aurora` selector.
- [x] i18n parity: new keys (`files.tooLargeEditor`, `about.updatesNote`, retitled
      `about.checkUpdate`) exist in **both** `en.ts` and `ar.ts`.
- [x] Import check: every symbol used by edits (`APP_VERSION` in Shell, `uid` in Tasks,
      `ShieldCheck/Download/Lightbulb/StickyNote/CheckSquare` icons in Shell palette)
      is already imported in that file.
- [x] `downloads` key kept in the data allow-list (download manager persistence intact).

## What must run before release (connected machine)
```
npm install
npm run typecheck     # must pass
npm run build         # renderer + electron bundles
npm run dist          # release/1.3.0: Setup + Portable (win x64) — smoke-test both
```

## Manual journey checklist ( installer smoke test )
1. First launch: splash → dashboard, no hang; restart preserves notes/tasks/projects.
2. Notes: create → type → switch page → back (no duplicate, text kept); export .md has frontmatter.
3. Tasks: create recurring (daily, due) → complete → original DONE + next occurrence TODO.
4. Files: open 25MB .log → system app opens + warning toast; small .txt → editor.
   Copy/move onto itself → clean error. Search a folder with symlink loops → finishes.
5. Editor: open 2 files → switch to Dashboard → back → tabs restored; untitled kept.
6. Downloads: add http file → pause/resume/retry/cancel; restart app mid-download → paused, resumable.
7. Archives: extract traversal test-zip (`../evil.txt`) → refused with error;
   extract over existing files → auto-renamed, nothing overwritten; compress with
   delete-after → sources deleted only after verified output.
8. Images: batch convert incl. one corrupt file → error row, rest succeed.
9. Video: transcode → cancel mid-way → process gone (Task Manager), temp cleaned.
10. Vault: setup → add item → lock → unlock; wrong password → error; change password →
    kill app mid-way (best effort) → vault still opens with old OR new password, never corrupt;
    import bad file → refused, live vault untouched.
11. AR ⇄ EN switch: layout mirrors, no clipped text; dark/light/system all render.
12. Install → upgrade → uninstall on clean Win10 + Win11 VM; portable runs from USB path
    with spaces + Arabic folder names.

## Performance & startup notes
- Splash shows ~2.2s (scaled by animation speed; 100ms when animations off) while
  stores load in parallel; failure falls back to safe defaults instead of hanging.
- Heavy work stays in main (sharp/ffmpeg/7z/downloads) with progress events; renderer
  never blocks on file I/O. Search/folder-size capped (50k/100k iterations) and skip
  symlinks; thumbnails capped (1024px) and served as data URLs (CSP-safe).
- `aurora` background disabled under reduced-motion or `prefers-reduced-motion`;
  page transitions use transform/opacity only.
- Suggested next measurement (connected machine): cold-start timing, 10k-file folder
  listing, 2GB file hash, memory during 4K transcode — record in this file.

## Network verification (v1.3.0 — 2026-09-05, manual, Windows 10/11)

> Scope: passive monitor + kill-switch only. No automated tests here (offline pass);
> run on a real machine with `npm run dev` or the installed build.
1. Speeds idle: open Network page with no downloads → down/up near 0; start a large
   HTTP download (e.g. in Downloads page) → both live speeds rise and fall with it, then settle back.
2. Today totals: note today down/up/total → download a ~100MB file → today down grows
   by ≈ the file size; upload a file / video-call briefly → today up grows.
3. Midnight rollover: set system clock to 23:59, generate light traffic, wait past 00:00 local →
   today resets to ~0 and yesterday's row appears once in the 14-day history (no duplicates after relaunch).
4. Reboot rebase: record today total → reboot → generate traffic → today total continues
   from the pre-reboot value (counter reset is rebased, never negative, history intact).
5. Cap → block (admin): run app as Administrator, set daily cap 0.1GB, download past it →
   whole-PC internet blocks (browser fails), app shows blocked state with reason + time.
6. Midnight auto-restore: while blocked, set clock past 00:00 (or wait) → block removed
   automatically, quota renewed, status returns to monitoring; history carries the over-cap day.
7. Quit-restore: enable restore-on-quit → trigger block → quit app → PC internet works again;
   relaunch → startup cleanup finds no stale `DragonHub*` firewall rules (`netsh advfirewall firewall show rule`).
8. Crash fail-open: trigger block → kill process via Task Manager → relaunch → startup cleanup
   removes the stale block and restores internet without user action.
9. Non-admin behaviour: run app normally (no UAC) with cap exceeded → no half-applied rules;
   clear message that blocking needs Administrator, monitoring/history keep working.
10. Plan math: create plan 70GB / monthly / start today → daily allowance shows ~2.3GB/day;
    weekly 14GB → 2GB/day; custom 10GB / 4 days → 2.5GB/day; progress bar and remaining match.
11. History table: 14-day table renders newest-first, numbers formatted (MB/GB), survives app restart
    (data in `electron-store`); hand-corrupt a `net.*` value → app clamps/resets safely, no crash.
12. RTL + themes: AR ⇄ EN switch mirrors the Network page (progress, table, units) with no clipped
    text; dark/light/system all render; compact mode + reduced-motion respected.

---

## Connected-machine pass (v1.3.0 — 2026-09-07, Linux container, online)

Replaces the "npm install / typecheck / build could not run here" constraint of the earlier pass.
Executed on a connected Linux x64 machine (Node.js v24, npm 11) against the v1.3.0 source archive:

- [x] `npm ci` — 599 packages installed; all pending install scripts approved and executed
      (electron 33.4.11 binary downloaded, esbuild/sharp/ffmpeg/ffprobe platform binaries OK);
      `electron-builder install-app-deps` completed native-dep setup.
- [x] `npm run typecheck` (`tsc --noEmit`) — found exactly **one** error, then fixed:
      `electron/main/services/netmonitor.ts` used `limits?.blockOnCap` but its local tolerant
      `NetLimits` type lacked the key (TS2339). Fix: added `blockOnCap?: unknown` to that
      tolerant type (the read site already compares `=== true`, matching the file's
      "any field may be missing" policy). Re-run: **clean**.
- [x] `npm run build` — renderer (`dist/`: 561 KB index JS + 49 KB CSS + lazy Monaco Editor
      chunk), main bundle (`dist-electron/main/index.js`, 63.9 KB) and preload
      (`dist-electron/preload/index.js`) all built without errors.
- [x] Artifact checks — `node --check` passes on both built Electron bundles; every asset
      referenced by `dist/index.html` resolves over a local HTTP server with byte-exact
      sizes; CSP meta present in built HTML; `blockOnCap` usage audited as consistent
      across shared types, main, ipc, netmonitor and the Network page.
- [ ] `npm run dist` (Windows Setup + Portable) — **still requires Windows**: building win
      targets here needs Wine (absent) and the packaged app must be smoke-tested on
      Win10/11 anyway. Run `npm ci && npm run dist` on Windows and follow the
      journey checklist above.


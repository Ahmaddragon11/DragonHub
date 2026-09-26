# DragonHub — Development Record

Lightweight log of architectural/UX decisions. Keep it short; update per cycle.

## Cycle 1 — v1.5.0 "Premium foundation" (2026-09-26)

### Audit findings (baseline v1.4.5)
| Area | Finding | Severity |
|---|---|---|
| Build | `vite build` OOM-crashed on low-RAM machines (left a 1.7 GB `core` dump in the tree). Cause: gzip size reporting of Monaco chunks. | P0 |
| Resilience | No error boundary — any page exception blanked the whole window. | P0 |
| DX / QA | Renderer could only run inside Electron; no way to iterate on or screenshot UI. | P1 |
| Performance | Every page/shell component subscribed to the **entire** Zustand store (`useApp()`), so each toast, download tick or keystroke re-rendered the sidebar, palette and page. | P1 |
| Performance | Two permanently animating 45vmax blurred blobs (`.aurora`) + perpetual shimmer on brand text = constant GPU compositing for pure decoration. | P1 |
| Data safety | Deletes were irreversible (blocking confirm or nothing). | P1 |
| Dead feature | `FocusTimer` existed but was never rendered; its countdown also drifted under background timer throttling. | P2 |
| UX | Command palette only matched page names (substring); no content search, no recents, no a11y roles. | P2 |
| Visual | Inconsistent radii/shadows, `shadow-glow` everywhere, gradient KPI blobs, emoji greeting, heavy glass on every card. | P2 |
| A11y | Modals had no focus trap / focus restore; context menus not arrow-key navigable; no skip link. | P2 |
| Responsive | Sidebar fixed width at all sizes; no mobile navigation. | P2 |

### Decisions
- **Design tokens in CSS variables** (`styles/index.css`): radius scale `--r-*`, elevation `--shadow-1..3`, `--hairline`, motion `--dur-*` / `--ease-*` scaled by the user's animation speed. Tailwind exposes them (`shadow-e1..e3`). Components are in `@layer components` so utilities can override them.
- **Solid cards, glass only for the shell** — blur is expensive and hurts legibility when stacked.
- **Motion system** (`lib/motion.ts`): shared easings/springs, `useMotionPrefs()` (respects app setting *and* OS reduced-motion), page/dialog variants. Only transform/opacity animate. `MotionConfig` at root disables motion globally when animations are off.
- **Selector-based store access** (`useShallow`) everywhere; global shortcuts read `useApp.getState()` so the listener is registered once.
- **Undo over confirm** (`lib/undo.ts`): optimistic delete + actionable toast, restores at original index. The "Confirm before delete" setting is still honoured.
- **Task domain logic extracted** (`lib/tasks.ts`): recurrence, overdue/today helpers and the natural-language quick-add parser are pure and shared by Tasks + Dashboard.
- **Dev browser bridge** (`lib/devBridge.ts`, `npm run dev:web`): in-memory/localStorage mock of `window.dh`, loaded only when `import.meta.env.DEV` and no real bridge → never ships.

### Delivered
- Error boundaries (root + per page, auto-reset on navigation).
- Command palette v2: fuzzy search across commands, notes, tasks, projects (titles + content), recents, match highlighting, groups ranked by best hit, combobox ARIA, shortcut hints.
- Keyboard shortcuts overlay (`?` / `Ctrl+/`), back/forward navigation history (`Alt+←/→`, mouse buttons 4/5, title-bar arrows), `/` focuses page search.
- Responsive shell: auto icon-rail < 1120 px, slide-in drawer < 768 px, tooltips on the collapsed rail.
- Dashboard redesign: date + time-aware greeting, KPI strip with overdue signal, **Today** agenda (overdue + due today, one-click complete, day progress), Focus timer wired in, "Jump back in" recents.
- Tasks: smart quick-add (`Call Sam tomorrow 3pm !high #work`, Arabic basics too) with live token preview; animated check; drop-target highlighting; layout animations; segmented filters; two-column editor dialog with sticky footer; persisted view mode; toast on recurring spawn.
- UI kit: `Segmented` (shared-element indicator), `Tooltip`, `Kbd`, `Skeleton`, `useFocusTrap`; Modal focus trap + restore + footer slot; actionable toasts with countdown bar; keyboard-navigable context menu; animated tag chips; labelled colour picker.
- Notes/Projects: undoable delete, recents tracking, save indicator.
- Build: `reportCompressedSize: false`; PostCSS config → `.cjs` (removes Node warning); removed `frame-ancestors` from meta CSP (ignored there, logged an error).

### Known limitations / next opportunities
- Notes editor is still a plain textarea (consider CodeMirror-lite w/ markdown shortcuts).
- Settings page could use a left section index + search; Files/Network/Resources pages were only touched for store selectors.
- Palette could index files (recent locations) and vault item titles (when unlocked).
- No automated tests yet; `lib/tasks.ts` and `lib/fuzzy.ts` are pure and ready for Vitest.
- Recents live in `localStorage` (renderer UI state); not included in data export.

### How to verify
```bash
npm run typecheck
npm run dev:web      # browser preview with seeded demo data (port 5174)
npm run dev          # full Electron app
```

# Running spec

### 2026-07-20 — Fix empty-diagram race (Strict Mode + blur save)
- **Decision:** Webview loads via `initialData.elements` (no empty mount + one-shot bootstrap ref); defer `readyToPersist` until API scene settles; extension only autosaves on blur/close when `hasUnsavedWebviewEdits`; persist rejects when memory element count < disk.
- **Rationale:** React Strict Mode remount skipped bootstrap leaving empty canvas; blur persist wrote stale empty memory over agent/script disk writes.

### 2026-07-20 — Defer disk reload during canvas interaction
- **Decision:** Webview defers external `updateScene` loads while pointer is down and rejects stale loads with fewer elements; hosts skip disk push while `hasUnsavedWebviewEdits`; remove 400ms pull polling (file watchers only).
- **Rationale:** `replaceAllElements` during shape drag wiped in-progress `newElement`; moves worked because existing elements already on disk.

### 2026-07-20 — Rust/wry applet is default standalone viewer
- **Decision:** Default terminal popup = Rust applet (`viewer/rust/`, `npm run view --open`). Electron kept as `npm run view:electron --open`.
- **Rationale:** ~10 MB runtime vs ~241 MB Electron; cold start still under 300 ms; user chose Rust after size/latency comparison.

### 2026-07-20 — Rust/wry applet as Electron alternative
- **Decision:** Ship optional Rust applet at `viewer/rust/` (wry + tao), same `viewer/dist/` webview; launch via `npm run view:rust -- <file> --open` after `cargo build --release`.
- **Rationale:** Smaller native binary vs Electron; cold-start benchmark on M4 Pro shows ~291 ms mean vs Electron ~265 ms — JS bundle dominates, so Rust is experimental shell not default.

### 2026-07-20 — Popup is standalone Electron applet
- **Decision:** Terminal popup = separate Electron app (`viewer/applet/`), not Cursor spawn and not a browser tab. `view.mjs --open` launches it; watches diagram file on disk.
- **Rationale:** User needs a distinct desktop window for terminal harnesses, not another Cursor editor tab.

### 2026-07-20 — Popup is slim editor window, not browser
- **Decision:** Terminal popup launches `cursor`/`code --new-window` with `DDD_POPUP_VIEWER=1`; extension hides activity bar, sidebar, status bar, panel — diagram in DDD custom editor only.
- **Rationale:** User wants native extension UX in minimal IDE shell, not a separate browser viewer.

### 2026-07-20 — Terminal popup viewer is opt-in
- **Decision:** Popup viewer never auto-opens; terminal-harness agents ask with a numbered menu before `npm run view --open`. User can persist "do not ask" in metadata Interaction Preferences.
- **Rationale:** Terminal users may prefer JSON-only or already have a viewer; consent matches `.designs/` and new-object menus.

### 2026-07-20 — Popup viewer CLI for terminal harnesses
- **Decision:** `viewer/view.mjs --open` launches Electron applet (`viewer/applet/main.mjs`); renderer bundle in `viewer/dist/`; file watch pushes IPC reload.
- **Rationale:** Dedicated desktop window decoupled from Cursor.

### 2026-07-20 — Terminal harnesses need a design viewer
- **Decision:** Terminal-first agent harnesses (Pi, Claude Code, Hermes, etc.) cannot show `.excalidraw` visually; DDD provides a standalone Electron diagram applet (`npm run view --open`).
- **Rationale:** Diagram-on-disk workflow still works for the agent, but humans need visual feedback; Cursor covers this via the extension; terminal harnesses do not.

### 2026-07-20 — Public repo hygiene
- **Decision:** Ship MIT license, SECURITY.md, THIRD_PARTY_NOTICES, CONTRIBUTING, Dependabot, CI (build + secret pattern scan), PR/issue templates, and `.github/REPOSITORY_SETUP.md` for branch protection checklist on GitHub.
- **Rationale:** Public repo from day one; automate what files can; document manual GitHub security settings.

### 2026-07-20 — Business todo vs tech_side_input
- **Decision:** `project/todo` holds business/GTM items (domain, site, marketplace, outreach). `project/tech_side_input` is agent-only CTO backlog (engineering risk, tech debt, architecture follow-ups)—not marketing or product ops.
- **Rationale:** Separate channels so business planning and engineering concerns don't mix.

### 2026-07-20 — Product name: Design Drive Development (DDD)
- **Decision:** Public brand is **Design Drive Development** (**DDD**); extension id `design-drive-development`, skill `design-drive-development`. Format-neutral positioning (Excalidraw now; Mermaid later).
- **Rationale:** Neutral trademark surface; acronym memorable; “design drives development” matches agent-in-repo workflow.

### 2026-07-20 — Multi-format GTM (Mermaid + Excalidraw)
- **Decision:** Pursue format-agnostic positioning for GTM — support multiple on-disk diagram formats (start Excalidraw; add Mermaid) so ecosystems can co-promote and product stays neutral vs any one trademark.
- **Rationale:** Partnership leverage (each community pushes vs rivals); nominative "works with X" safer than Excalidraw-branded product name; widens TAM (text diagrams + canvas).

### 2026-07-20 — Free pro-tool first; monetization deferred
- **Decision:** Ship everything free (extension + skill + workflows); optimize for installs and word-of-mouth; no paywall or license layer until traction justifies it. On-prem/enterprise later.
- **Rationale:** Growth before revenue; narrow TAM needs maximum adoption to learn if the category sticks.

### 2026-07-19 — Excalidraw file as single source of truth
- **Decision:** `.excalidraw` JSON on disk is the only shared state; extension renders and watches it; Cursor skill reads/writes it and companion `*.metadata.md`.
- **Rationale:** PRD requires no duplicated state, no custom sync protocol, and repository-local collaboration.

### 2026-07-19 — Extension scope is render + watch only
- **Decision:** VS Code/Cursor extension handles open, save, external file watch, and live reload; no AI logic in the extension.
- **Rationale:** Keeps collaboration workflow in the Cursor skill per PRD responsibilities split.

### 2026-07-20 — New object options menu before adding to diagram
- **Decision:** Agent must offer 2–4 numbered representation options and wait for user choice before adding a new service, class, DB, cache, queue, external system, or flow — unless the user fully specified it or said to pick.
- **Rationale:** New design objects have shape, placement, and semantics the user should own; avoids silent wrong abstractions.

### 2026-07-20 — Element-level semantics in diagram JSON
- **Decision:** Agents store per-node/per-edge meaning on elements (`id`, bound label text, `customData`); metadata stays project-wide rules only.
- **Rationale:** Diagram file must be self-describing for selection refs, agent reads, and live reload without opening metadata.

### 2026-07-20 — Extension always auto-saves open diagrams
- **Decision:** Custom editor writes `.excalidraw` to disk on every edit (300ms debounce), on tab blur, and on close — no dirty state, no manual save required.
- **Rationale:** File on disk is source of truth; extension-on means persist is automatic.

### 2026-07-19 — Clear dirty state via workspace.save
- **Decision:** Auto-save and Cmd+S call `vscode.workspace.save()` so Cursor clears the unsaved tab indicator; webview only posts changes when elements/files change.
- **Rationale:** Writing disk directly left the custom editor permanently dirty; selection/pan fired spurious change events.

### 2026-07-19 — Disable Excalidraw web save download in editor
- **Decision:** Hide Excalidraw native Save/Load-to-disk UI; intercept Cmd+S to persist via extension to the open `.excalidraw` file.
- **Rationale:** Webview has no browser file handle — Excalidraw "Save" triggers a download dialog instead of writing the workspace file.

### 2026-07-19 — Ask on request vs saved-state conflict
- **Decision:** Agent and extension stop and ask when a user request incoheres with saved metadata, diagram artifacts, or an existing `.designs/` group — never silently override.
- **Rationale:** Saved constraints, decisions, and components are intentional; contradictions need explicit user choice.

### 2026-07-19 — Components live in `.designs/` branch with consent
- **Decision:** Saved groups go under `.designs/groups/`; extension asks user before creating `.designs` on first save; agent must ask too.
- **Rationale:** Component store stays separate from diagram files until user explicitly approves the branch.

### 2026-07-19 — Design groups use nested sub-json at origin
- **Decision:** Saved groups are `{ type: "excalidraw-group", bounds, group: { type: "excalidraw", elements } }` with `group.elements` normalized to `(0,0)`; insert applies canvas offset only.
- **Rationale:** Components must be reusable fragments with scale/layout preserved, not absolute canvas coordinates.

- **Decision:** Reusable selections save to `designs/groups/<slug>.excalidraw-group.json`; insert via extension command into the active `.excalidraw` file.
- **Rationale:** User wants named reusable diagram pieces in-repo without a separate server or library service.

### 2026-07-19 — Install extension locally for main Cursor window
- **Decision:** Ship `npm run install:local` (vsce package + `cursor --install-extension`) so live reload works outside Extension Development Host only.
- **Rationale:** Editor association and file watching require the extension active in the same window where the diagram is open.

- **Decision:** Workspace `.vscode/settings.json` maps `*.excalidraw` to `design-drive-development.editor` so diagrams open in our extension by default.
- **Rationale:** User should not manually pick Open With on every file; AI live reload requires our editor.

### 2026-07-19 — External reload uses watcher + poll
- **Decision:** Extension reloads on `createFileSystemWatcher`, native `fs.watch`, and a 1s visible-tab poll; webview applies disk changes via `updateScene` to preserve zoom.
- **Rationale:** Agent edits and some save patterns were missed by `fs.watch` alone; pomdtr extension does not provide live AI reload.

- **Decision:** When a diagram has no metadata, copy only `Visual Preferences` from another repo `*.metadata.md` if found; never copy constraints, decisions, or learned preferences.
- **Rationale:** PRD explicitly scopes global/project knowledge out of inherited metadata for MVP.

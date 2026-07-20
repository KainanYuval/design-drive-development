---
name: design-drive-development
description: >-
  Design Drive Development (DDD) — collaborate on in-repo architecture diagrams
  (`.excalidraw`; Mermaid planned) with live extension reload. Reads and writes diagram
  files plus companion `*.metadata.md`, applies visual and interaction preferences, and
  ends design turns with the required accept/reject menu. Use when the user opens or
  edits diagram files, asks to review or change architecture, split services, or update
  system design visually. When adding new diagram objects (service, class, database,
  queue, etc.), offers numbered options for the user to choose before writing the file.
---

# Design Drive Development (DDD)

The diagram file on disk is the single source of truth. Edit it on disk. The DDD extension renders it and reloads on save.

## Workflow

1. Identify the target diagram path (for example `architecture.excalidraw`).
2. Read the `.excalidraw` file from disk.
3. Resolve metadata via [metadata workflow](#metadata-workflow).
4. Run [incoherence checks](#incoherence-checks) against metadata, the diagram, and saved designs.
5. For every **new object** the change would add, run [new object options](#new-object-options) — wait for the user's choice before patching.
6. Patch the diagram JSON — embed [semantic data on elements](#semantic-data-on-elements) for anything relevant to that shape or arrow (prefer minimal edits over full rewrites unless metadata says otherwise).
7. Write the `.excalidraw` file back to disk.
8. Update metadata when you discover stable persistent information.
9. End every design proposal with the [required interaction menu](#required-end-of-turn-interaction).

The extension watches the file and reloads automatically. Do not ask the user to refresh.

## Terminal harness (opt-in applet)

When the user works in a **terminal agent** (Pi, Claude Code, Hermes, etc.) — diagrams are not visible in the terminal. **Ask before opening the diagram applet**; never auto-open.

Full rules: [terminal-harness.md](terminal-harness.md)

Summary:

1. Before the first diagram edit in the session, offer the applet menu unless metadata says `Popup viewer: do not ask`.
2. Only run `npm run view -- <diagram> --open` if the user picks **Yes, open applet now** (or metadata says always open).
3. Respect **No, don't ask again** → save `Popup viewer: do not ask (terminal harness).` in Interaction Preferences.

## Selection references from chat

The user can copy selected diagram elements as a Cursor-style file reference:

`@architecture.excalidraw:120-145 · API Gateway, Auth Service`

Format: `@<relative-path>:<start>-<end> · <names>`

Saved reusable groups live in `.designs/groups/*.excalidraw-group.json` — a separate repo branch from diagram files.

**Before creating the first design:** ask the user whether creating `.designs/` is OK. Only proceed if they agree.

Each file is:

```json
{
  "type": "excalidraw-group",
  "name": "10 balls",
  "bounds": { "x": 0, "y": 0, "width": 570, "height": 48 },
  "group": {
    "type": "excalidraw",
    "version": 2,
    "elements": [],
    "files": {}
  }
}
```

`group.elements` are stored at origin `(0,0)` with relative layout/scale only. Insert applies canvas position at drop time.

When the user pastes this reference:

1. Read only the referenced line range in the `.excalidraw` file.
2. Treat those JSON element objects as the scope of the request.
3. Prefer patching only the referenced elements unless the user asks for broader changes.

## Metadata workflow

Metadata path: `<diagram-basename>.metadata.md` beside the diagram.

Example: `architecture.excalidraw` → `architecture.metadata.md`

### If metadata exists

Read it and follow all sections.

### If metadata does not exist

1. Search the repository for another `*.metadata.md`.
2. If found: create `<diagram-basename>.metadata.md` beside the current diagram and copy **only** the `Visual Preferences` section from the found file.
3. If none found: create a fresh metadata file using the template below.

Do **not** copy constraints, decisions, or learned preferences from other diagrams.

### Metadata template

```markdown
# Architecture Metadata

## Constraints

## Decisions

## Visual Preferences

## Interaction Preferences

- Prefer patches over complete rewrites.
- Never delete user work without confirmation.
- Offer numbered options before adding a new diagram object; wait for the user's choice.

## Learned Preferences
```

### What to store

Store only **project-wide** persistent knowledge in metadata:

- Architecture constraints ("We never use queues.")
- Stable technology decisions that span the whole diagram ("Auth0 authentication.")
- Visual preferences ("Databases are green.")
- Interaction preferences ("Always propose patches.")
- Learned preferences ("User dislikes crossing arrows.")

Per-node or per-edge facts (service name, protocol, engine, owner) belong on **elements** via labels, ids, and `customData` — not duplicated here unless also a global rule.

Do **not** store temporary discussion, reasoning, or one-off requests.

## Incoherence checks

Before writing the diagram, metadata, or a `.designs/` group, compare the **current user request** to **saved state**.

Saved state means:

- Every section in `*.metadata.md` (Constraints, Decisions, Visual Preferences, Interaction Preferences, Learned Preferences, Saved Components)
- What is already on the diagram (labels, topology, elements the user built)
- Existing files under `.designs/groups/`

If the request would contradict, override, or silently replace any saved rule or artifact, **stop and ask first**. Do not patch until the user answers.

### What counts as incoherence

- Request violates a **Constraint** (example: user asks for a queue; metadata says "No queues.")
- Request reverses a **Decision** (example: user asks for Cognito; metadata says "Auth0 authentication.")
- Request breaks **Visual** or **Learned Preferences** (example: user asks for square databases; metadata says "Databases are green cylinders.")
- Request breaks **Interaction Preferences** (example: full rewrite or deleting user work when metadata says to patch or confirm first)
- Request replaces a **Saved Component** or reuses a name for different content (example: save "smily" but file already describes 10 balls)
- New metadata you would write contradicts an existing bullet in the same section

### How to ask

State both sides in one short block, then offer explicit choices. Example:

```
This conflicts with saved metadata:
- Saved: No queues.
- Request: Add RabbitMQ.

How should I proceed?
1. Follow the request — add RabbitMQ and update metadata
2. Keep the saved rule — suggest an alternative without queues
3. Cancel — do nothing
```

Wait for an answer. If they pick **1**, apply the change and update metadata to match. If **2**, stay within saved rules. If **3**, stop.

Use the same pattern for design saves, metadata edits, and diagram edits.

## New object options

When the task would introduce a **new object** on the diagram, **stop and offer options**. Do not write that object to the file until the user picks one.

A **new object** is anything not already represented by an existing element: service, class/module, database, cache, queue, external system, API boundary, arrow/flow, or reusable group instance.

### When to ask

Ask when the user wants something **added** and at least one of these is unset:

- What kind of thing it is (service vs class vs DB vs cache…)
- How to draw it (shape, color, size, placement)
- What to call it (`id`, label, `customData`)
- How it connects to neighbors (protocol, sync/async, which arrows)

### When to skip asking

- User already specified clearly ("Add green PostgreSQL cylinder `users-db` left of Auth Service, HTTPS arrow from Auth").
- User is answering a options menu you just showed (number or "option 2").
- You are only editing or relabeling an **existing** element.
- User explicitly says "just pick one" or "your call".

### What each option should include

Offer **2–4 numbered options**. Each option is concrete enough to implement in one patch:

- **Label** and semantic **`id`**
- **Excalidraw shape** (rectangle, ellipse, diamond, arrow…) matching metadata visual prefs
- **Placement** relative to existing elements
- **Connections** (new arrows, bindings, protocols)
- **`customData`** sketch (`kind`, `role`, `tech`, `engine`, `protocol`, …)

Ground options in `*.metadata.md` (constraints, visual prefs, learned prefs). Mark the option that best fits saved rules as **(Recommended)**.

### How to ask

Use this pattern. Do **not** write the diagram yet.

```
You asked to add [brief restatement].

How should I represent it?

1. (Recommended) [Name] — [shape/style], [placement], [connections], [customData summary]
2. [Alternative A] — …
3. [Alternative B] — …
4. Something else — describe what you want

Reply with a number (or describe option 4).
```

Wait for the answer. Then patch once, embed semantics on the new elements, and end with the [required interaction menu](#required-end-of-turn-interaction).

### Examples by object kind

| Kind | Options might differ on |
|------|-------------------------|
| **Service** | Monolith box vs split microservice; tech in `customData`; cache nearby or not |
| **Class / module** | Standalone rectangle vs nested group; public API surface vs internal |
| **Database** | Engine (PostgreSQL vs …), read replica, green cylinder per metadata |
| **Cache** | Redis ellipse near service vs embedded; sync vs async invalidation arrow |
| **Queue / bus** | Skip if metadata forbids queues; otherwise Kafka/Rabbit + async arrows |
| **External system** | Blue ellipse per metadata; vendor in `customData` |
| **Flow / arrow** | Protocol label, sync vs async, dashed vs solid |

If metadata forbids all viable options (e.g. "No queues" but user asked for a queue), use [incoherence checks](#incoherence-checks) instead of a normal options menu.

## Semantic data on elements

Put meaning **on the elements themselves**, not only in `*.metadata.md`. The diagram must stay readable and machine-usable without opening metadata.

**Before editing:** read each affected element's `id`, bound label text, and `customData`. Treat those as saved semantics — patch them when meaning changes.

### Where semantics live

| Layer | Field | Use for |
|-------|-------|---------|
| Visible | bound `text` / `originalText` | Names users see: service, database, protocol on arrows |
| Stable | element `id` | Kebab-case slug agents and selection refs rely on (`auth-service`, `postgres-primary`, `arrow-gateway-auth`) |
| Structured | `customData` | Extra facts about **this** element only — role, tech, protocol, sync/async, owner, repo path, short notes |

### What goes in `customData`

Use small JSON objects. Prefer consistent keys:

- **Services / boxes:** `kind`, `role`, `tech`, `runtime`, `owner`, `notes`
- **Databases / stores:** `kind`, `engine`, `purpose`
- **Arrows / flows:** `protocol`, `pattern` (`sync` / `async`), `payload`, `notes`
- **External systems:** `kind`, `vendor`, `notes`

Example service:

```json
{
  "id": "auth-service",
  "type": "rectangle",
  "customData": {
    "kind": "service",
    "role": "authentication",
    "tech": "Auth0",
    "notes": "JWT validation at gateway edge"
  }
}
```

Example arrow:

```json
{
  "id": "arrow-gateway-auth",
  "type": "arrow",
  "customData": {
    "protocol": "HTTPS",
    "pattern": "sync",
    "payload": "JWT"
  }
}
```

Also add a bound text label on arrows when the protocol or flow name should be visible.

### Rules

- **New elements:** only after the user picks from [new object options](#new-object-options) (or gave full spec upfront). Then assign semantic `id`, visible label, and `customData`.
- **Edits:** when a service splits, renames, or changes tech, update `id` (if safe), label text, and `customData` on that element **and** connected arrows.
- **Do not** stash per-node facts only in metadata if they belong on that element.
- **Do** keep project-wide rules in metadata (constraints, global visual prefs, learned prefs).
- Preserve existing semantic `id`s and `customData` unless the user asks to rename or replace.
- Use `groupIds` to tie visually grouped components; keep the group name in the parent element's label or `customData`.

Selection refs and chat scope use element labels and ids — good semantics make `@architecture.excalidraw:… · Auth Service` accurate.

## Visual legend (required)

Every **visual** diagram (`.excalidraw` and similar canvas formats) MUST include a compact **Legend** in the **upper-left** corner so a human can read the drawing without guessing.

### Placement and layout

- Anchor the legend at roughly **x 24–32**, **y 24–32** on the canvas.
- Keep width ≤ **260px** so the main diagram starts around **x ≥ 300**.
- Group legend elements with a shared `groupIds` value (e.g. `"legend"`) or a light background rectangle behind all legend rows.
- Use **roughness 0**, solid fills, and consistent row height (~28px). Legend is reference UI — not hand-drawn sketch.

### What the legend must explain

List **only symbols and colors actually used** on this diagram:

| Explain | How (one row each) |
|---------|-------------------|
| **Shape** | Small swatch of the shape (rounded rect, ellipse, diamond, arrow stroke, …) |
| **Fill / stroke color** | Swatch uses the **exact** `backgroundColor` / `strokeColor` from the diagram |
| **Meaning** | Short label: "Service", "Database", "Viewer host", "Error path", … |

Add rows for arrows if line style matters (solid sync vs dashed async).

### Row pattern

Each row = **swatch** (24×18 px sample) + **label** (13–14px text, left-aligned). Optional section title **"Legend"** (15–16px) at the top of the panel.

### When editing

- **Create:** define the color/shape language first, build the legend, then draw the diagram using only those conventions.
- **Patch:** if you add a new color or shape type, **add a legend row** in the same change.
- **Remove:** drop unused legend rows when no element uses that convention anymore.
- Do **not** duplicate the full legend spec in `*.metadata.md` — metadata holds project-wide rules; the legend on canvas is the per-diagram key.

See [excalidraw-format.md](excalidraw-format.md#legend-panel) for JSON patterns.

## Editing `.excalidraw` files

The file is JSON with this shape:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [],
  "appState": {},
  "files": {}
}
```

Rules:

- Preserve `type`, `version`, and `source` unless creating a new file.
- Edit `elements` for shapes, text, arrows, and bindings.
- Keep valid Excalidraw element IDs; use **semantic kebab-case ids** for new elements (`payment-api`, not random strings unless merging into an existing naming scheme).
- Write relevant semantics into bound labels, `id`, and `customData` on each affected element (see [semantic data on elements](#semantic-data-on-elements)).
- Respect metadata visual preferences for colors, shapes, layout, and fonts.
- Prefer moving, splitting, or relabeling existing elements over deleting user work.
- When the user chooses option **2** ("You edited it"), re-read the `.excalidraw` file before continuing.

For element field reference, see [excalidraw-format.md](excalidraw-format.md).

## Response to user choices

When the user replies with a menu number:

| Choice | Action |
|--------|--------|
| **1 — Accept** | Continue normally. |
| **2 — You edited it** | Re-read `.excalidraw` and metadata, then continue from their edits. |
| **3 — Reject — create another version** | Generate a different proposal; write file; show menu again. |
| **4 — Reject completely** | Do not rewrite the diagram. Await further instructions. |

## Required end-of-turn interaction

Whenever you finish a design proposal you MUST finish with:

```
Design updated.

Choose one:

1. Accept
2. You edited it — I'll review your changes
3. Reject — create another version
4. Reject completely
```

Use this exact wording every time.

## Examples

**User:** "Add a cache for auth."

1. Read `architecture.excalidraw` and `architecture.metadata.md`.
2. No existing cache element — show [new object options](#new-object-options), e.g. Redis ellipse near Auth Service vs in-process box vs skip if user clarifies.
3. Wait for user's number.
4. Add chosen element with `id`, label, `customData`, arrows; save file.
5. End with the required interaction menu.

**User:** "Split the auth service."

1. Read `architecture.excalidraw` and `architecture.metadata.md`.
2. Read `auth-service` (or equivalent) element labels and `customData`.
3. Duplicate or decompose into two services with semantic ids, labels, `customData`, and updated arrows.
4. Save the file.
5. Append any stable **project-wide** decision to metadata if the user stated one ("Keep Auth0 in the gateway path.").
6. End with the required interaction menu.

**User:** "Use red for errors."

1. Update error-related elements in the diagram.
2. Add to metadata under `Visual Preferences`: `- Errors are red.`
3. End with the required interaction menu.

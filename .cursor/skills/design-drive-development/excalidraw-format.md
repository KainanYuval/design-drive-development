# Excalidraw JSON reference

## Semantic fields (read and write these)

Every element agents create or edit should carry meaning in the JSON itself:

1. **`id`** — stable kebab-case slug (`api-gateway`, `arrow-billing-db`)
2. **Bound label** — `text` / `originalText` on a text child with `containerId` pointing at the shape
3. **`customData`** — optional structured facts about this element only

Read all three before patching. Update all three when meaning changes.

### `customData` on a rectangle (service)

```json
{
  "id": "auth-service",
  "type": "rectangle",
  "link": null,
  "customData": {
    "kind": "service",
    "role": "authentication",
    "tech": "Auth0"
  }
}
```

### `customData` on an arrow (flow)

```json
{
  "id": "arrow-gateway-auth",
  "type": "arrow",
  "customData": {
    "protocol": "HTTPS",
    "pattern": "sync"
  }
}
```

Suggested keys: `kind`, `role`, `tech`, `engine`, `protocol`, `pattern`, `payload`, `owner`, `notes`.

## Common element types

| type | use |
|------|-----|
| `rectangle` | services, components |
| `ellipse` | databases, external actors |
| `diamond` | decisions |
| `arrow` | relationships, data flow |
| `text` | labels (often bound to a container) |

## Minimal rectangle

```json
{
  "id": "unique-id",
  "type": "rectangle",
  "x": 100,
  "y": 100,
  "width": 180,
  "height": 72,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "#a5d8ff",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "groupIds": [],
  "frameId": null,
  "roundness": { "type": 3 },
  "seed": 1,
  "version": 2,
  "versionNonce": 1,
  "isDeleted": false,
  "boundElements": [],
  "updated": 1,
  "link": null,
  "locked": false,
  "customData": {
    "kind": "service",
    "role": "api-gateway"
  }
}
```

## Text bound to a shape

Set `containerId` to the parent shape id. Add a `boundElements` entry on the parent:

```json
{ "type": "text", "id": "label-id" }
```

## Arrow between shapes

Use `startBinding` and `endBinding`:

```json
{
  "type": "arrow",
  "points": [[0, 0], [120, 0]],
  "startBinding": { "elementId": "from-id", "focus": 0, "gap": 1 },
  "endBinding": { "elementId": "to-id", "focus": 0, "gap": 1 },
  "endArrowhead": "arrow"
}
```

## Font family numbers

Excalidraw uses numeric font ids. Virgil is commonly `3`.

## Patch strategy

1. Map existing elements by semantic `id`, label text, and `customData` — not only coordinates.
2. Change only affected elements and connected arrows; keep their semantics accurate.
3. Shift coordinates to reduce overlapping arrows when metadata says so.
4. Write valid JSON; pretty-print with 2-space indent.

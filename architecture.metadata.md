# Architecture Metadata

## Constraints

- No queues.
- PostgreSQL only.
- Kubernetes deployment.

## Decisions

- Auth0 authentication.
- Redis cache.

## Visual Preferences

- Services are rounded rectangles.
- Databases are green cylinders.
- External systems are blue.
- Use Virgil font.
- Horizontal layout.
- Errors are red.

## Interaction Preferences

- Prefer patches over complete rewrites.
- Never delete user work without confirmation.
- When a request conflicts with saved metadata, diagram state, or saved designs, ask before changing anything.
- When adding a new diagram object, offer numbered representation options and wait for the user's choice before editing the file.

## Learned Preferences

- User prefers caches near services.
- User dislikes crossing arrows.

## Saved Components

- **10 balls** — rainbow row of 10 circles; `@.designs/groups/10-balls.excalidraw-group.json`; `group.elements` at origin `(0,0)`, size in `bounds`.
- **smily** — same 10-circle row; `@.designs/groups/smily.excalidraw-group.json`; `group.elements` at origin `(0,0)`, size in `bounds`.

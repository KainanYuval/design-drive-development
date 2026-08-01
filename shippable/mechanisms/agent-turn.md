# Agent turn lock

Create `<diagram>.excalidraw.ddd-agent-turn.lock` before the first agent disk write in a design turn; delete when done.

```json
{
  "kind": "agent-turn",
  "label": "Agent turn",
  "pid": 0,
  "startedAt": "2026-08-01T13:00:00.000Z"
}
```

While the lock exists, open DDD hosts show a red banner, pause human canvas input, reload disk at ~16ms, and apply agent writes live.

Also wait while `<diagram>.ddd-write.lock` exists (human save in progress).

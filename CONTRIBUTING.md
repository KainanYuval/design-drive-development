# Contributing

Thanks for helping improve **Design Drive Development (DDD)**.

## Before you start

- Read `project/running_spec.md` for product/engineering decisions.
- Diagram changes: follow `.cursor/skills/design-drive-development/SKILL.md`.
- Business/GTM ideas → not this repo's engineering backlog; use issues for product discussion.

## Development

```bash
cd extension
npm install
npm test
npm run build
npm run install:local   # local Cursor install
```

Reload Cursor after installing the VSIX.

## Pull requests

1. Branch from `main`
2. Keep scope focused — extension vs skill vs docs
3. `npm test` and `npm run build` must pass in `extension/`
4. Do not commit secrets, `node_modules/`, `extension/out/`, `extension/media/`, or `*.vsix`

## Security

See [SECURITY.md](SECURITY.md).

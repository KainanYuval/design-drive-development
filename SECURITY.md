# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest release on `main` | yes |
| older VSIX / tags | best effort |

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email or DM the maintainers with:

- Description of the issue
- Steps to reproduce
- Impact assessment (if known)
- Affected paths (extension, webview, skill, sample files)

We aim to acknowledge within **72 hours** and share a remediation timeline when confirmed.

## Scope

In scope:

- Design Drive Development extension (webview, file I/O, `.designs/` handling)
- Repository sample diagrams and agent skill content that could enable unsafe workflows

Out of scope:

- Upstream [Excalidraw](https://github.com/excalidraw/excalidraw) or VS Code/Cursor platform bugs (report to those projects)
- User-generated diagram content in forks

## Safe defaults

- Never commit `.env`, keys, or tokens — see `.gitignore`
- Extension runs locally; it does not send diagram data to a DDD server

# GitHub repository setup (public)

Apply these in **GitHub → Settings** after pushing. Files in `.github/` cannot enable all protections alone.

## Security (Settings → Code security)

- [ ] **Dependency graph** — enabled (default on public repos)
- [ ] **Dependabot alerts** — enabled
- [ ] **Dependabot security updates** — enabled
- [ ] **Secret scanning** — enabled (public repos: on by default)
- [ ] **Push protection for secret scanning** — enabled

## Branch protection (`main`)

Settings → Branches → Add rule for `main`:

- [ ] Require a pull request before merging
- [ ] Require approvals: **1** (or enable Code Owners after editing `.github/CODEOWNERS`)
- [ ] Dismiss stale pull request approvals when new commits are pushed
- [ ] Require status checks: **CI / extension-build**
- [ ] Require branches to be up to date before merging
- [ ] Do not allow bypassing the above settings
- [ ] Restrict who can push to matching branches (optional: maintainers only)
- [ ] Block force pushes
- [ ] Block deletions

## General

- [ ] Default branch: `main`
- [ ] Replace `@OWNER` and `OWNER/REPO` in `.github/CODEOWNERS` and issue template config
- [ ] Add repository description + link to product site when live
- [ ] Topics: `cursor`, `excalidraw`, `vscode-extension`, `architecture`, `system-design`

## Releases

- [ ] GitHub Release attaches CI-built `.vsix` artifact (or release workflow later)
- [ ] Tag format: `v0.3.0` matching `extension/package.json`

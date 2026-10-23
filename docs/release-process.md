# Release Process

This document describes the full release process for Prism (Grat), covering version bumps, git tagging, and publishing each distributable artifact.

---

## Overview

Prism ships four artifacts from a single monorepo:

| Artifact | Location | Registry |
|---|---|---|
| `grat` CLI binary | `crates/cli` | [crates.io](https://crates.io) |
| `grat-core` library | `crates/core` | [crates.io](https://crates.io) |
| `grat-wasm` WASM package | `crates/wasm` | npm (via `wasm-pack`) |
| VS Code Extension | `extensions/vscode` | [VS Code Marketplace](https://marketplace.visualstudio.com) |

Releases follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

---

## 1. Pre-release Checklist

Before cutting a release, verify:

- [ ] All CI checks on `main` are green.
- [ ] `CHANGELOG.md` has a section for the new version with all notable changes.
- [ ] No unresolved `TODO` or `FIXME` comments that should block the release.
- [ ] Dependencies are up to date (`cargo outdated`, `pnpm outdated`).
- [ ] The error taxonomy is up to date (`taxonomy/enhanced_error_taxonomy.toml`).

---

## 2. Version Bump

All Rust crate versions are controlled from the workspace root via `[workspace.package]` in `Cargo.toml`. A single edit updates all crates at once.

### Rust crates

Open `Cargo.toml` at the repo root and update the `version` field:

```toml
[workspace.package]
version = "0.2.0"   # <-- bump this
```

### VS Code Extension

The extension version is maintained independently in `extensions/vscode/package.json`:

```json
{
  "version": "0.2.0"
}
```

### Commit the version bump

```bash
git add Cargo.toml Cargo.lock extensions/vscode/package.json
git commit -m "chore: bump version to v0.2.0"
```

---

## 3. Update CHANGELOG.md

Move the `[Unreleased]` section to the new version and add the release date:

```markdown
## [0.2.0] - 2024-06-01

### Added
- ...

## [Unreleased]
```

Add the new comparison link at the bottom of the file:

```markdown
[Unreleased]: https://github.com/DevNiola/Prism/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/DevNiola/Prism/compare/v0.1.0...v0.2.0
```

Commit:

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for v0.2.0"
```

---

## 4. Tag the Release

Create an annotated git tag. Annotated tags carry tagger information and a message, which GitHub uses to generate release notes.

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin main
git push origin v0.2.0
```

Then [create a GitHub Release](https://github.com/DevNiola/Prism/releases/new) from the tag, paste the relevant CHANGELOG section into the release notes, and attach any prebuilt binaries.

---

## 5. Publish CLI and Core Library to crates.io

The `grat-core` library must be published before `grat` (the CLI) because the CLI depends on it.

### Prerequisites

- A [crates.io account](https://crates.io) with a verified email.
- API token added to your local Cargo config:

```bash
cargo login <YOUR_TOKEN>
```

### Publish `grat-core`

```bash
cd crates/core
cargo publish
```

Wait for the crates.io index to update (usually 30–60 seconds).

### Publish `grat-wasm`

```bash
cd crates/wasm
cargo publish
```

### Publish `grat` (CLI)

```bash
cd crates/cli
cargo publish
```

### Verify

```bash
cargo search grat
```

All three crates should appear with the new version.

---

## 6. Publish the WASM Package to npm

The `crates/wasm` crate is also distributed as an npm package for use in the web app and by third-party JS/TS consumers.

### Prerequisites

- [`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/) installed.
- An npm account with publish access to the `@grat-soroban` scope.

### Build and publish

```bash
# From the repo root
cd crates/wasm

# Build for the web target (generates pkg/ directory)
wasm-pack build --target web --release

# Publish to npm
wasm-pack publish --access public
```

The generated `pkg/` directory contains the WASM binary, JS bindings, TypeScript type definitions, and a `package.json` ready for npm.

### Verify

```bash
npm info @grat-soroban/grat-wasm version
```

---

## 7. Publish the VS Code Extension

### Prerequisites

- `vsce` installed (comes as a dev dependency in `extensions/vscode`):

```bash
pnpm install
```

- A [Visual Studio Marketplace publisher account](https://marketplace.visualstudio.com/manage).
- A Personal Access Token (PAT) from [Azure DevOps](https://dev.azure.com/) with **Marketplace (Publish)** scope.

### Build and package

```bash
cd extensions/vscode

# Compile TypeScript and bundle with esbuild
pnpm run build

# Create the .vsix package
pnpm run package
```

This produces a `grat-vscode-<version>.vsix` file.

### Publish to the Marketplace

```bash
# Login with your PAT
npx vsce login grat-soroban

# Publish
npx vsce publish
```

Alternatively, upload the `.vsix` file manually at [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).

### Verify

Search for "Grat" in the VS Code Extensions panel or visit the extension's Marketplace page.

---

## 8. Post-release

- [ ] Close the milestone on GitHub (if used).
- [ ] Announce the release on the project's Discord.
- [ ] Open a new `[Unreleased]` section in `CHANGELOG.md` on `main`.
- [ ] Update any documentation that references version numbers.

---

## Hotfix Process

For urgent bug fixes on an already-released version:

1. Branch from the release tag: `git checkout -b hotfix/v0.1.1 v0.1.0`
2. Apply the fix and bump the patch version.
3. Follow steps 3–8 above, substituting the hotfix version number.
4. Merge the hotfix branch back into `main` to keep the history consistent.

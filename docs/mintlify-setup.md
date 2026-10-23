# Mintlify Documentation Site Configuration

The Prism documentation site is powered by [Mintlify](https://mintlify.com). This guide explains the `mint.json` configuration file, how to add new pages, and how contributors can extend the docs without breaking the site.

---

## Configuration Files

There are two `mint.json` files in this repo:

| File | Purpose |
|---|---|
| `/mint.json` | Root-level config (used when Mintlify serves from the repo root) |
| `/docs/mint.json` | Config for the `docs/` subdirectory deployment |

Both files share the same schema but differ in page path prefixes. The `docs/mint.json` uses relative paths (e.g., `"introduction"`), while the root `mint.json` prefixes them with `"docs/"` (e.g., `"docs/introduction"`).

When in doubt, the `docs/mint.json` is the primary source of truth for the hosted documentation site.

---

## `mint.json` Structure

A complete annotated example based on the current config:

```json
{
  "name": "Grat",
  "logo": {
    "light": "<url-to-light-logo>",
    "dark": "<url-to-dark-logo>"
  },
  "favicon": "/favicon.png",
  "colors": {
    "primary": "#7C3AED",
    "light": "#A78BFA",
    "dark": "#5B21B6"
  },
  "topbarLinks": [
    {
      "name": "GitHub",
      "url": "https://github.com/DevNiola/Prism"
    }
  ],
  "anchors": [
    {
      "name": "Discord",
      "icon": "discord",
      "url": "https://discord.gg/placeholder"
    }
  ],
  "navigation": [ /* see Navigation section */ ],
  "footerLinks": [
    { "name": "MIT License", "url": "/license" },
    { "name": "Contributing", "url": "/contributing" }
  ],
  "footerSocials": {
    "github": "https://github.com/DevNiola/Prism"
  }
}
```

### Top-level Fields

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Site name shown in the browser tab and header |
| `logo` | `object` | Logo images for light and dark mode. Can be a URL or a path to a file in the repo |
| `favicon` | `string` | Path to the favicon file |
| `colors` | `object` | Brand colors used throughout the UI |
| `topbarLinks` | `array` | Links shown in the top navigation bar |
| `anchors` | `array` | Icon links shown prominently (Discord, API reference, etc.) |
| `navigation` | `array` | Sidebar navigation groups (see below) |
| `footerLinks` | `array` | Links in the site footer |
| `footerSocials` | `object` | Social media links for the footer icons |

### Colors

```json
"colors": {
  "primary": "#7C3AED",   // buttons, active links
  "light": "#A78BFA",     // light-mode accents
  "dark": "#5B21B6"       // dark-mode accents
}
```

To change the brand color, update all three values to maintain consistent contrast ratios across light and dark modes.

---

## Navigation Configuration

The `navigation` array defines the sidebar. It is an ordered list of **groups**, each containing a list of **pages**.

```json
"navigation": [
  {
    "group": "Getting Started",
    "pages": [
      "introduction",
      "installation",
      "quickstart",
      "roadmap"
    ]
  },
  {
    "group": "Core Concepts",
    "pages": [
      "concepts/error-decoding",
      "concepts/execution-replay"
    ]
  }
]
```

### How Mintlify Resolves Pages

Each entry in `pages` is a path **relative to the docs root** (for `docs/mint.json`) or prefixed with `docs/` (for the root `mint.json`), **without the file extension**.

| `pages` entry | Resolved file |
|---|---|
| `"introduction"` | `docs/introduction.mdx` |
| `"concepts/error-decoding"` | `docs/concepts/error-decoding.mdx` |
| `"cli/decode"` | `docs/cli/decode.mdx` |

Mintlify supports both `.mdx` and `.md` file extensions.

### Current Navigation Groups

| Group | Pages |
|---|---|
| Getting Started | introduction, installation, quickstart, roadmap |
| Core Concepts | error-decoding, execution-replay, time-travel, error-taxonomy |
| CLI Reference | decode, inspect, trace, profile, diff, replay, whatif, export, serve, db-update |
| Interfaces | cli, vscode, web-app, core-library |
| Architecture | overview, decode-engine, replay-engine, breakpoint-controller, what-if-engine, shared-infrastructure |
| API Reference | decode-error, resolve-contract-error, replay-transaction, profile-transaction, diff-state |
| Guides | debugging-transactions, resource-optimization, regression-testing, contributing-taxonomy |

---

## Adding a New Documentation Page

### Step 1: Create the file

Create a new `.mdx` file in the appropriate directory under `docs/`:

```bash
# Example: adding a new guide
touch docs/guides/my-new-guide.mdx
```

All documentation files use [MDX](https://mdxjs.com/) — Markdown with optional JSX component support. A minimal page looks like:

```mdx
---
title: "My New Guide"
description: "A short description shown in search results and social previews."
---

## Introduction

Your content here.
```

The frontmatter fields recognized by Mintlify:

| Field | Description |
|---|---|
| `title` | Page title (shown in the browser tab and sidebar) |
| `description` | Short description for SEO and search previews |
| `icon` | An icon name from [Font Awesome](https://fontawesome.com/icons) or [Lucide](https://lucide.dev) |
| `sidebarTitle` | Override the sidebar label (defaults to `title`) |

### Step 2: Add the page to `mint.json`

Open `docs/mint.json` and add the new page path to the appropriate group:

```json
{
  "group": "Guides",
  "pages": [
    "guides/debugging-transactions",
    "guides/resource-optimization",
    "guides/regression-testing",
    "guides/contributing-taxonomy",
    "guides/my-new-guide"       // <-- add here
  ]
}
```

**Important:** If you only add the file but forget to add it to `mint.json`, the page exists but will not appear in the sidebar.

If you also need to update the root `mint.json`, add it with the `docs/` prefix:

```json
"guides/my-new-guide"   →   "docs/guides/my-new-guide"
```

### Step 3: Add a new group (optional)

To add a completely new section to the sidebar, append a new group object to the `navigation` array:

```json
{
  "group": "Internals",
  "pages": [
    "internals/caching",
    "internals/wasm-bridge"
  ]
}
```

Groups appear in the sidebar in the order they are listed in `mint.json`.

---

## Using Mintlify Components

Mintlify provides a set of built-in MDX components. No imports required — they are globally available.

### Cards

```mdx
<CardGroup cols={2}>
  <Card title="Quickstart" icon="bolt" href="/quickstart">
    Get up and running in under 60 seconds.
  </Card>
  <Card title="API Reference" icon="code" href="/api/decode-error">
    Explore the full API.
  </Card>
</CardGroup>
```

### Callouts

```mdx
<Note>
  This feature requires Rust 1.77 or higher.
</Note>

<Warning>
  Running this command on mainnet is irreversible.
</Warning>

<Tip>
  Use `--json` flag for machine-readable output.
</Tip>
```

### Tabs

```mdx
<Tabs>
  <Tab title="CLI">
    ```bash
    grat decode <tx-hash>
    ```
  </Tab>
  <Tab title="Rust">
    ```rust
    let report = decode_error(&tx_result)?;
    ```
  </Tab>
</Tabs>
```

### Code blocks

Standard Markdown code fences work as-is and support syntax highlighting for all common languages.

---

## Local Preview

To preview changes locally before pushing:

```bash
# Install the Mintlify CLI (one-time)
npm install -g mintlify

# Serve from the docs/ directory
cd docs
mintlify dev
```

The site will be available at `http://localhost:3000`. Changes to `.mdx` files and `mint.json` hot-reload automatically.

---

## Contributing to the Docs

### What belongs in the docs?

- Feature explanations and conceptual overviews.
- Step-by-step guides and tutorials.
- API reference pages.
- Architecture deep-dives.

Code comments and inline rustdoc go in the source files, not here.

### Writing style

- Use second person ("you") for guides and tutorials.
- Use active voice.
- Keep sentences short and scannable.
- Include a working code example for every non-trivial concept.
- Add a `description` frontmatter field to every page.

### Review process

Doc-only changes (`.mdx`, `.md`, `mint.json`) do not require a Rust or TypeScript build to pass. Open a PR with the label `documentation` — these get a lighter review focused on accuracy and clarity.

### Common mistakes to avoid

| Mistake | Effect | Fix |
|---|---|---|
| Adding a `.mdx` file without updating `mint.json` | Page is unreachable from the sidebar | Always update both |
| Using absolute paths in `docs/mint.json` (e.g., `"docs/introduction"`) | 404 on the hosted site | Use relative paths in `docs/mint.json` |
| Duplicate page entries in `mint.json` | Mintlify build warning | Each page path must appear exactly once |
| Missing frontmatter `title` | Page title defaults to filename | Always add a `title` |

---

## Deployment

The Mintlify site is connected to the GitHub repository and deploys automatically on every push to `main` that changes files in the `docs/` directory or `mint.json`. No manual deploy step is needed.

To trigger a manual redeploy, visit the [Mintlify dashboard](https://dashboard.mintlify.com) and click **Redeploy**.

# Grat VS Code Extension — User Guide

The Grat VS Code extension brings Soroban error decoding and transaction debugging directly into your editor. Inline diagnostics, hover explanations, code lens actions, and quick-fix suggestions are all available without leaving VS Code.

---

## Table of Contents

- [Installation](#installation)
  - [From the VS Code Marketplace](#from-the-vs-code-marketplace)
  - [From Source (VSIX)](#from-source-vsix)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Features](#features)
  - [Diagnostics](#diagnostics)
  - [Hover Explanations](#hover-explanations)
  - [Code Lens](#code-lens)
  - [Quick Fix](#quick-fix)
  - [Decode Command](#decode-command)
- [Commands Reference](#commands-reference)
- [Troubleshooting](#troubleshooting)

---

## Installation

### From the VS Code Marketplace

1. Open VS Code.
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS) to open the Extensions panel.
3. Search for **"Grat — Soroban Debugger"**.
4. Click **Install**.

Alternatively, run this in a terminal:

```bash
code --install-extension grat-soroban.grat-vscode
```

### From Source (VSIX)

Use this method if you want the latest unreleased version or are contributing to the extension.

**Prerequisites:** Node.js 20+, pnpm, and the `@vscode/vsce` CLI tool.

```bash
# 1. Clone the repo
git clone https://github.com/DevNiola/Prism.git
cd Prism

# 2. Install dependencies
pnpm install

# 3. Build the extension
cd extensions/vscode
pnpm run build

# 4. Package as a VSIX archive
pnpm run package
# → Creates grat-vscode-<version>.vsix

# 5. Install the VSIX into VS Code
code --install-extension grat-vscode-*.vsix
```

Or install directly from the VS Code UI:

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **Extensions: Install from VSIX...**.
3. Select the `.vsix` file produced in step 4.

---

## Prerequisites

The extension shells out to the `grat` CLI binary for all decoding and replay operations. You must have `grat` installed and on your `PATH` before using the extension.

**Install the CLI:**

```bash
# Build from source
git clone https://github.com/DevNiola/Prism.git
cd Prism
cargo build --release
# Add ./target/release to your PATH, or copy the binary:
cp target/release/grat ~/.local/bin/grat
```

Verify the CLI is available:

```bash
grat --version
```

If `grat` is installed in a non-standard location, configure the path in VS Code settings (see [Configuration](#configuration)).

---

## Configuration

The extension exposes settings under the `grat` namespace in VS Code's `settings.json`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `grat.network` | string | `"testnet"` | Stellar network to use for all operations. Accepted values: `mainnet`, `testnet`, `futurenet`. |
| `grat.binaryPath` | string | `"grat"` | Path to the `grat` CLI binary. Use an absolute path if the binary is not on your `PATH`. |

### Editing Settings

**Via the Settings UI:**

1. Open Settings (`Ctrl+,` / `Cmd+,`).
2. Search for **"grat"**.
3. Update the values.

**Via `settings.json`:**

```json
{
  "grat.network": "mainnet",
  "grat.binaryPath": "/home/user/.local/bin/grat"
}
```

**Workspace-level settings** (override per project):

Create or edit `.vscode/settings.json` at the root of your project:

```json
{
  "grat.network": "mainnet"
}
```

---

## Features

The extension activates automatically when you open a Rust file (`*.rs`) or invoke the `grat.decode` command.

### Diagnostics

The **Diagnostics** provider registers a diagnostic collection named `grat` in the Problems panel. When Grat identifies issues in your Soroban contract code (such as patterns that match known error-prone host function usages), it reports them as warnings or errors directly in the editor gutter.

- Diagnostics appear in the **Problems** panel (`Ctrl+Shift+M`).
- Red/yellow squiggles underline the relevant code.
- Hover over a squiggle to read the error description.

> **Note:** Diagnostics are populated when you run a decode or inspect operation on a transaction produced by the open file's contract.

### Hover Explanations

The **Hover** provider is registered for Rust files. When you hover over a recognized Soroban error symbol or constant, a tooltip appears with:

- The full error name and numeric code.
- A plain English summary from the taxonomy database.
- A link to the official Stellar documentation.

**Example:**

Hovering over `Error::CPUExceeded` in your contract shows:

```
CPUExceeded (Budget · Code 0)

The transaction exceeded its CPU instruction budget.

See: https://soroban.stellar.org/docs/fundamentals/fees-and-metering
```

### Code Lens

The **Code Lens** provider adds clickable action links above Rust functions that interact with Soroban host APIs. These links appear inline above the function signature in a lighter color.

Typical lenses include:

- **Decode last failed tx** — Decodes the most recent failed transaction for this contract.
- **View error taxonomy** — Opens the taxonomy entry for the nearest recognized error code.

Click any lens to execute the action directly in the editor without opening a terminal.

### Quick Fix

The **Quick Fix** provider registers code actions (the lightbulb `💡` icon) for diagnostics raised by Grat. When Grat detects a known error pattern, it suggests one or more automated fixes:

- **Increase resource budget** — Inserts the recommended `soroban_sdk` resource declaration snippet.
- **Add balance check** — Inserts a guard clause before a transfer call.
- **View suggested fix** — Opens the relevant taxonomy entry in a side panel.

To trigger a quick fix:

1. Place your cursor on a squiggled error.
2. Press `Ctrl+.` (or click the lightbulb icon).
3. Select a fix from the dropdown.

### Decode Command

The **Grat: Decode Transaction Error** command lets you decode any transaction hash or raw XDR string from directly within VS Code, without switching to a terminal.

**How to use:**

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Type **"Grat: Decode"** and select **Grat: Decode Transaction Error**.
3. Paste a transaction hash (64-character hex) or a raw base64-encoded XDR string.
4. Press `Enter`.

A progress notification appears while Grat fetches and decodes the transaction. The result opens as a read-only JSON document in a side panel:

```json
{
  "error_category": "budget",
  "error_name": "CPUExceeded",
  "severity": "Error",
  "summary": "The transaction exceeded its CPU instruction budget.",
  "detailed_explanation": "The contract executed a large unbounded loop...",
  "suggested_fixes": [
    "Increase the CPU instruction limit in the transaction resource declaration.",
    "Optimize the loop to avoid iterating over the full collection."
  ],
  "auth_entries": [
    {
      "auth_type": "Ed25519",
      "address": "GABC...XYZ"
    }
  ]
}
```

If the decode fails (network error, invalid hash, etc.), an error notification appears in the bottom-right corner with the CLI's error message.

**Keyboard shortcut:** You can bind the command to a key in **File → Preferences → Keyboard Shortcuts** by searching for `grat.decode`.

---

## Commands Reference

| Command ID | Title | Description |
|------------|-------|-------------|
| `grat.decode` | Grat: Decode Transaction Error | Prompt for a tx hash or XDR, decode it, and display the report |
| `grat.inspect` | Grat: Inspect Transaction | Inspect a transaction and show all operation reports |

All commands are accessible from the Command Palette (`Ctrl+Shift+P`).

---

## Troubleshooting

### "grat CLI error: ..." notification

The extension failed to call the `grat` binary. Check:

1. **Is `grat` installed?**
   ```bash
   which grat
   grat --version
   ```
2. **Is the binary path correct?** If `grat` is not on your `PATH`, set `grat.binaryPath` in settings to the absolute path of the binary.
3. **Does the binary have execute permission?**
   ```bash
   chmod +x ~/.local/bin/grat
   ```

### "Failed to parse grat output"

The CLI produced output that could not be parsed as JSON. This can happen if `grat` printed a warning or error to stdout before the JSON payload. Run the same command in a terminal with `--output json` to see the raw output:

```bash
grat --output json decode <TX_HASH>
```

### Diagnostics not appearing

Diagnostics are only populated when a decode or inspect operation is run. Make sure you have decoded at least one transaction since opening the file. If the Problems panel remains empty, check the VS Code Output panel for the **Grat** channel.

### Extension not activating

The extension activates on `onLanguage:rust` and `onCommand:grat.decode`. If you are working in a Rust file and the extension has not activated:

1. Confirm the extension is installed: open Extensions (`Ctrl+Shift+X`) and search **"Grat"**.
2. Check the VS Code Output panel (`Ctrl+Shift+U`) for any activation errors.
3. Reload the window: `Ctrl+Shift+P` → **Developer: Reload Window**.

### Wrong network being used

The default network is `testnet`. To use `mainnet`, update your settings:

```json
{
  "grat.network": "mainnet"
}
```

Or add this to your workspace `.vscode/settings.json` so it only applies to a specific project.

---

## Development & Contributing

To contribute to the extension or run it in development mode:

```bash
cd extensions/vscode

# Install dependencies
pnpm install

# Watch mode (rebuilds on save)
pnpm run watch

# Open VS Code and press F5 to launch a new Extension Development Host window
```

The extension source lives in `extensions/vscode/src/`:

| File | Purpose |
|------|---------|
| `extension.ts` | Entry point — activates the extension and registers all providers |
| `cli/bridge.ts` | Shells out to the `grat` binary |
| `providers/diagnostics.ts` | Registers the diagnostics collection |
| `providers/hover.ts` | Hover tooltip provider for Rust files |
| `providers/codeLens.ts` | Code lens provider for Rust files |
| `providers/quickFix.ts` | Quick fix / code action provider |
| `utils/config.ts` | Reads `grat.*` settings from VS Code configuration |

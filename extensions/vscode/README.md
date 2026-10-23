# Grat — Soroban Debugger for VS Code

Inline Soroban error decoding and transaction debugging for VS Code. Understand why your Soroban smart contract transactions fail — directly inside your editor.

## Features

- **Inline Diagnostics** — Errors and warnings appear as squiggles in the editor and in the Problems panel.
- **Hover Explanations** — Hover over a recognized Soroban error symbol to see a plain English description and link to documentation.
- **Code Lens** — Clickable action links appear above Soroban host function calls.
- **Quick Fix** — Automated fix suggestions for common error patterns (budget overflows, missing balance checks, etc.).
- **Decode Command** — Decode any transaction hash or raw XDR string without leaving VS Code.

## Requirements

The extension requires the `grat` CLI binary to be installed and accessible from your `PATH`.

```bash
# Build from source
git clone https://github.com/DevNiola/Prism.git
cd Prism
cargo build --release
cp target/release/grat ~/.local/bin/grat
```

## Usage

1. Open any Rust file — the extension activates automatically.
2. Open the Command Palette (`Ctrl+Shift+P`) and run **Grat: Decode Transaction Error**.
3. Paste a transaction hash or raw XDR string and press Enter.
4. The decoded report opens in a side panel as read-only JSON.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `grat.network` | `"testnet"` | Network for operations: `mainnet`, `testnet`, `futurenet` |
| `grat.binaryPath` | `"grat"` | Absolute path to the `grat` binary if not on `PATH` |

Add to your `settings.json`:

```json
{
  "grat.network": "mainnet",
  "grat.binaryPath": "/home/user/.local/bin/grat"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Grat: Decode Transaction Error` | Decode a tx hash or raw XDR string |
| `Grat: Inspect Transaction` | Inspect all operations in a transaction |

## Documentation

For the full user guide including screenshots, troubleshooting, and contribution instructions, see [docs/vscode-extension.md](../../docs/vscode-extension.md).

## License

MIT — see [LICENSE](../../LICENSE).

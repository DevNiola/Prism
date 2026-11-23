# Network Configuration

Prism’s CLI (Grat) can use a custom Soroban RPC endpoint. The web network picker
selects a built-in network, and the API server has its own RPC health-check
configuration.

## CLI

Use `--network` (`-n`) to select `testnet` (the default), `mainnet`,
`futurenet`, or `local`. The aliases `localhost` and `standalone` also
select `local`.

- Use `--network testnet --rpc-url https://rpc.example.com` for a private
  endpoint that serves testnet. `--rpc-url` takes precedence over the
  selected network’s default URL and keeps its passphrase and archive settings.
- Use `--network https://rpc.example.com` to use the URL as both the network
  identifier and the endpoint. URL selectors have an empty passphrase and no
  default history archives.
- A custom name such as `devnet` needs an explicit `--rpc-url`. The name
  alone supplies neither an endpoint nor a passphrase.
- Use `--no-cache` to bypass the local cache while checking an endpoint.

The CLI loads and validates `~/.grat/config.toml` at startup. Use
`--config-path <PATH>` to choose a different file or
`grat --config-path ./grat.toml config:validate` to check its contents.
Although the TOML schema accepts `[[networks]]` entries and a
`default_network`, the current CLI resolves command endpoints from
`--network` and `--rpc-url`. The file's passphrase, archive, timeout and
API key settings are available through the core configuration types, but
aren’t applied by these CLI commands.

## Web NetworkSwitcher

The header’s network picker offers Testnet, Mainnet and Futurenet. The web
`Network` type includes `custom`, and the browser store can persist a
`customRpcUrl`, but the switcher has no custom option or URL input.
Selecting a built-in network calls the API’s `/health` route. That request
checks the API server’s configured RPC independently of the browser selection.

## API server

Set `SOROBAN_RPC_URL` in the server process environment or in an environment
file in its working directory. The server reads `.env`, `.env.local` and
`.env.<NODE_ENV>` in that order, then applies process environment overrides.
Restart the server after changing the value.

The URL must use HTTP or HTTPS. The default is
`https://soroban-testnet.stellar.org`. The server sends a JSON-RPC
`getHealth` request to this URL when you call its `/health` route. This
setting configures that dependency check. The web picker and CLI resolve their
network settings separately.

## Worked example with local Stellar RPC

Start a [Stellar Quickstart](https://github.com/stellar/quickstart) container
with an RPC endpoint on the host:

```bash
docker run --rm -it -p 127.0.0.1:8000:8000 stellar/quickstart:latest --local --enable rpc
```

Once Quickstart has initialized, send a health request to the RPC endpoint:

```bash
curl -fsS http://127.0.0.1:8000/rpc \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

Replace `YOUR_LOCAL_TX_HASH` with the hash of a failed Soroban transaction
submitted to this instance. The built-in `local` selector uses the
standalone passphrase (`Standalone Network ; February 2017`) and the URL
shown below. The explicit URL lets you adapt the command if you change ports.

```bash
grat --network local --rpc-url http://127.0.0.1:8000/rpc decode YOUR_LOCAL_TX_HASH
```

With the Prism API’s dependencies running, start it from `apps/server` in
another terminal and point the health probe at the same instance:

```bash
SOROBAN_RPC_URL=http://127.0.0.1:8000/rpc pnpm dev
```

Open `http://127.0.0.1:3001/health` and look for
`dependencies.soroban_rpc.status` to be `up`. If the API runs in a container,
use an address reachable from inside that container, such as the RPC service’s
hostname on a shared Docker network.

See the [troubleshooting guide](./troubleshooting.md) for connection and
retention issues.

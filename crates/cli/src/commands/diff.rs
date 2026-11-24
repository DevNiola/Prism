use clap::{Args, Subcommand};
use grat_core::types::config::NetworkConfig;
use grat_core::xdr::cmp::TransactionDiff;

#[derive(Args)]
pub struct DiffArgs {
    #[command(subcommand)]
    pub mode: DiffMode,
}

#[derive(Subcommand)]
pub enum DiffMode {
    /// Compare the ledger state changes of a single transaction.
    State {
        #[arg(value_name = "TX_HASH")]
        tx_hash: String,
    },
    /// Compare two transactions side-by-side by their XDR envelopes.
    ///
    /// Each argument may be either a raw base64-encoded `TransactionEnvelope`
    /// XDR string, or a 64-hex-character transaction hash (fetched from the
    /// network automatically).
    Tx {
        /// First transaction: base64 XDR or tx hash.
        #[arg(value_name = "TX_A")]
        tx_a: String,
        /// Second transaction: base64 XDR or tx hash.
        #[arg(value_name = "TX_B")]
        tx_b: String,
        /// Output machine-readable JSON instead of the human-readable summary.
        #[arg(long)]
        json: bool,
    },
}

pub async fn run(
    args: DiffArgs,
    network: &NetworkConfig,
    output_format: &str,
    save: Option<&str>,
) -> anyhow::Result<()> {
    match args.mode {
        DiffMode::State { tx_hash } => run_state_diff(tx_hash, network, output_format, save).await,
        DiffMode::Tx { tx_a, tx_b, json } => {
            run_tx_diff(tx_a, tx_b, json, network, output_format, save).await
        }
    }
}

// ── State diff (original behaviour) ──────────────────────────────────────

async fn run_state_diff(
    tx_hash: String,
    network: &NetworkConfig,
    output_format: &str,
    save: Option<&str>,
) -> anyhow::Result<()> {
    let progress = indicatif::ProgressBar::new_spinner();
    progress.set_message("Computing state diff...");
    progress.enable_steady_tick(std::time::Duration::from_millis(100));

    let trace = grat_core::replay::replay_transaction(&tx_hash, network).await?;

    progress.finish_and_clear();

    crate::output::print_state_diff(&trace.state_diff, output_format)?;

    if let Some(path) = save {
        let json = serde_json::to_string_pretty(&trace.state_diff)?;
        std::fs::write(path, &json)
            .map_err(|e| anyhow::anyhow!("Failed to write save file '{path}': {e}"))?;
        eprintln!("Saved diff to {path}");
    }
    Ok(())
}

// ── XDR transaction diff (Issue #66 enhancement) ─────────────────────────

async fn run_tx_diff(
    tx_a: String,
    tx_b: String,
    as_json: bool,
    network: &NetworkConfig,
    output_format: &str,
    save: Option<&str>,
) -> anyhow::Result<()> {
    let progress = indicatif::ProgressBar::new_spinner();
    progress.set_message("Fetching transaction envelopes...");
    progress.enable_steady_tick(std::time::Duration::from_millis(100));

    let xdr_a = resolve_xdr_or_fetch(&tx_a, network).await?;
    let xdr_b = resolve_xdr_or_fetch(&tx_b, network).await?;

    progress.finish_and_clear();

    let diff = TransactionDiff::from_base64(&xdr_a, &xdr_b)
        .map_err(|e| anyhow::anyhow!("Failed to diff transactions: {e}"))?;

    if as_json || output_format == "json" {
        println!("{}", serde_json::to_string_pretty(&diff)?);
    } else {
        if diff.is_identical {
            println!("✅ Transactions are identical.");
        } else {
            println!(
                "🔍 Transaction diff ({} difference{}):",
                diff.differences.len(),
                if diff.differences.len() == 1 { "" } else { "s" }
            );
            print!("{diff}");
        }
    }

    if let Some(path) = save {
        let json = serde_json::to_string_pretty(&diff)?;
        std::fs::write(path, &json)
            .map_err(|e| anyhow::anyhow!("Failed to write save file '{path}': {e}"))?;
        eprintln!("Saved diff to {path}");
    }

    Ok(())
}

/// Return a base64-encoded `TransactionEnvelope` XDR string for `input`.
///
/// If `input` is 64 hex characters it is treated as a tx hash and the
/// envelope is fetched via the Soroban RPC.  Otherwise the string is assumed
/// to already be base64 XDR and returned as-is.
async fn resolve_xdr_or_fetch(input: &str, network: &NetworkConfig) -> anyhow::Result<String> {
    let is_likely_hash = input.len() == 64 && input.chars().all(|c| c.is_ascii_hexdigit());

    if is_likely_hash {
        let client = grat_core::rpc::SorobanRpcClient::new(network);
        let response = client
            .get_transaction(input)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to fetch transaction '{input}': {e}"))?;

        response
            .envelope_xdr
            .ok_or_else(|| anyhow::anyhow!("Transaction '{input}' has no envelope XDR (may be pending or not yet finalised)"))
    } else {
        Ok(input.to_string())
    }
}

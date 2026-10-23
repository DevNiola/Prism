//! # Replay Module
//!
//! Provides deterministic sandbox re-execution of historical Soroban transactions,
//! reconstructing ledger state, computing state diffs, and profiling resource consumption.
//!
//! ## Submodules
//! - [`sandbox`]: Embedded host environment for re-executing transactions.
//! - [`state`]: Fetches and reconstructs ledger state from RPC/archives.
//! - [`differ`]: Computes pre- and post-state differences.
//! - [`profiler`]: Profiles CPU instructions and memory consumption per host function.
//! - [`trace`]: Assembles hierarchical execution trees.

pub mod differ;
pub mod profiler;
pub mod sandbox;
pub mod state;
pub mod trace;

use crate::decode::auth::scval_to_readable_string;
use crate::decode::walk_diagnostic_events;
use crate::error::GratResult;
use crate::types::config::NetworkConfig;
use crate::types::trace::{DiagnosticEvent, ExecutionTrace, TraceId};

/// Replays a transaction by hash against the specified network, generating an execution trace and resource profile.
///
/// ## Example
/// ```rust,no_run
/// use grat_core::replay::replay_transaction;
/// use grat_core::types::config::NetworkConfig;
///
/// # async fn run() -> Result<(), Box<dyn std::error::Error>> {
/// let config = NetworkConfig::default();
/// let trace = replay_transaction("abcd1234", &config).await?;
/// println!("Replayed transaction in ledger {}", trace.ledger_sequence);
/// # Ok(())
/// # }
/// ```
pub async fn replay_transaction(
    tx_hash: &str,
    network: &NetworkConfig,
) -> GratResult<ExecutionTrace> {
    let ledger_state = state::reconstruct_state(tx_hash, network).await?;
    let trace_id = TraceId::new();

    let raw_trace = sandbox::execute_with_tracing(&ledger_state, tx_hash, trace_id).await?;

    let trace_tree = trace::build_trace_tree(&raw_trace)?;

    let state_diff = differ::compute_diff(&ledger_state, &raw_trace)?;

    let profile = profiler::generate_profile(&raw_trace, &state_diff)?;

    let diagnostic_events = walk_diagnostic_events(&raw_trace.diagnostic_events)
        .into_iter()
        .enumerate()
        .map(|(timeline_position, event)| DiagnosticEvent {
            event_type: event.kind.to_string(),
            topics: event.topics.iter().map(scval_to_readable_string).collect(),
            data: std::collections::HashMap::from([(
                "value".to_string(),
                scval_to_readable_string(&event.data),
            )]),
            timeline_position,
        })
        .collect();

    Ok(ExecutionTrace {
        tx_hash: tx_hash.to_string(),
        ledger_sequence: ledger_state.ledger_sequence,
        network: network.network.to_string(),
        invocations: trace_tree,
        state_diff,
        resource_profile: profile,
        diagnostic_events,
    })
}

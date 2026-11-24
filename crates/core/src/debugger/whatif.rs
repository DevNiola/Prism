use crate::error::GratResult;
use crate::replay::sandbox::{execute_with_tracing_injected, LedgerStateInjector};
use crate::replay::state::reconstruct_state;
use crate::types::trace::{ExecutionTrace, TraceId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WhatIfPatch {
    ModifyArgument {
        index: usize,

        new_value: String,
    },

    ModifyLedgerEntry {
        key: String,

        new_value: String,
    },

    ModifyResourceLimits {
        cpu_limit: Option<u64>,

        memory_limit: Option<u64>,
    },

    ModifyAuth {
        add_signer: Option<String>,

        remove_signer: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatIfResult {
    pub original: ExecutionTrace,

    pub modified: ExecutionTrace,

    pub divergence_point: Option<usize>,

    pub summary: String,
}

/// Simulate a "what-if" scenario by applying patches to the ledger state
/// and replaying the transaction.
///
/// Currently supports [`WhatIfPatch::ModifyLedgerEntry`] patches, which
/// override specific ledger entries before replay using a
/// [`LedgerStateInjector`]. The original state is restored after replay
/// completes.
pub async fn simulate_whatif(
    tx_hash: &str,
    patches: &[WhatIfPatch],
    network: &crate::types::config::NetworkConfig,
) -> GratResult<WhatIfResult> {
    // Reconstruct the original ledger state.
    let mut state = reconstruct_state(tx_hash, network).await?;

    // Build the injector from ModifyLedgerEntry patches.
    let mut injector = LedgerStateInjector::new();
    for patch in patches {
        if let WhatIfPatch::ModifyLedgerEntry { key, new_value } = patch {
            injector.override_entry(key.clone(), new_value.as_bytes().to_vec());
        }
    }

    // Execute the replay with injected state.
    let trace_id = TraceId::new();
    let result = execute_with_tracing_injected(&mut state, tx_hash, trace_id, &injector).await?;

    // Build a minimal ExecutionTrace from the sandbox result.
    // (A full trace tree is built by the replay module; here we provide
    // a simplified version for what-if comparison.)
    let modified_trace = ExecutionTrace {
        tx_hash: tx_hash.to_string(),
        ledger_sequence: state.ledger_sequence,
        network: network.network.to_string(),
        invocations: crate::replay::trace::build_trace_tree(&result)?,
        state_diff: crate::replay::differ::compute_diff(&state, &result)?,
        resource_profile: crate::replay::profiler::generate_profile(&result, &crate::replay::differ::compute_diff(&state, &result)?)?,
        diagnostic_events: Vec::new(),
    };

    let summary = format!(
        "What-if replay with {} injected state modification(s): {}",
        injector.len(),
        if result.success { "succeeded" } else { "failed" }
    );

    Ok(WhatIfResult {
        original: ExecutionTrace {
            tx_hash: tx_hash.to_string(),
            ledger_sequence: state.ledger_sequence,
            network: network.network.to_string(),
            invocations: Vec::new(),
            state_diff: crate::types::trace::StateDiff::default(),
            resource_profile: crate::types::trace::ResourceProfile::default(),
            diagnostic_events: Vec::new(),
        },
        modified: modified_trace,
        divergence_point: None,
        summary,
    })
}

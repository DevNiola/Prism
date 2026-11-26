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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::differ::compute_diff;
    use crate::replay::sandbox::{SandboxResult, TraceEvent, TraceEventType};
    use crate::replay::state::LedgerState;
    use crate::types::trace::TraceId;
    use proptest::prelude::*;
    use std::collections::HashMap;

    // ---------------------------------------------------------------------------
    // Determinism helpers
    // ---------------------------------------------------------------------------

    /// Builds a minimal [`LedgerState`] from a seed, deterministically.
    ///
    /// The state does not contact any network; it contains only the
    /// compile-time fields that the diff and profiler operate on.
    fn make_ledger_state(seed: u32) -> LedgerState {
        use crate::replay::state::{InvocationInput, ReconstructionPath};
        use stellar_xdr::curr::ContractCostParams;

        // Derive a small, deterministic set of ledger entries from the seed.
        let mut entries = HashMap::new();
        for i in 0..(seed % 5 + 1) {
            let key = format!("entry_{i}");
            let value = vec![(seed as u8).wrapping_add(i as u8); 4];
            entries.insert(key, value);
        }

        LedgerState {
            ledger_sequence: seed,
            entries,
            reconstruction_path: ReconstructionPath::HotPath,
            invocation: InvocationInput {
                host_function_xdr: vec![],
                resources_xdr: vec![],
                source_account_xdr: vec![],
                auth_entries_xdr: vec![],
                read_only_keys: vec![],
                read_write_keys: vec![],
                ttl_by_key: HashMap::new(),
                cpu_cost_params: ContractCostParams(stellar_xdr::curr::VecM::default()),
                mem_cost_params: ContractCostParams(stellar_xdr::curr::VecM::default()),
                network_id: [seed as u8; 32],
                protocol_version: 20,
                timestamp: u64::from(seed) * 1000,
                base_reserve: 5_000_000,
                min_temp_entry_ttl: 100,
                min_persistent_entry_ttl: 100,
                max_entry_ttl: 10_000,
                cpu_instructions_limit: 10_000_000,
            },
        }
    }

    /// Builds a minimal [`SandboxResult`] from a seed and a final-state map,
    /// without touching the network or wall-clock time.
    fn make_sandbox_result(seed: u32, final_state: HashMap<String, Vec<u8>>) -> SandboxResult {
        let events = vec![
            TraceEvent {
                event_type: TraceEventType::HostFunctionCall,
                timestamp_us: 0,
                data: serde_json::json!({
                    "function": format!("fn_{seed}"),
                    "cpu_insns": seed * 100,
                    "mem_bytes": seed * 50,
                }),
            },
            TraceEvent {
                event_type: TraceEventType::HostFunctionReturn,
                timestamp_us: 1,
                data: serde_json::json!({
                    "function": format!("fn_{seed}"),
                    "cpu_insns": seed * 100 + 500,
                    "mem_bytes": seed * 50 + 200,
                }),
            },
        ];

        SandboxResult {
            trace_id: TraceId::new(),
            success: true,
            events,
            final_state,
            total_cpu: u64::from(seed) * 100 + 500,
            total_memory: u64::from(seed) * 50 + 200,
            diagnostic_events: vec![],
        }
    }

    // ---------------------------------------------------------------------------
    // Unit determinism tests
    // ---------------------------------------------------------------------------

    /// `compute_diff` is a pure function over its two arguments; calling it
    /// twice with identical inputs must produce byte-identical output.
    #[test]
    fn test_compute_diff_is_deterministic() {
        let state = make_ledger_state(42);
        let final_state = state.entries.clone();
        let result = make_sandbox_result(42, final_state);

        let diff_a = compute_diff(&state, &result).expect("diff_a");
        let diff_b = compute_diff(&state, &result).expect("diff_b");

        let json_a = serde_json::to_string(&diff_a).unwrap();
        let json_b = serde_json::to_string(&diff_b).unwrap();

        assert_eq!(json_a, json_b, "compute_diff must be deterministic for the same inputs");
    }

    /// `generate_profile` must be deterministic: same events + same diff →
    /// same ResourceProfile, regardless of ambient state or wall-clock time.
    #[test]
    fn test_generate_profile_is_deterministic() {
        use crate::replay::profiler::generate_profile;

        let state = make_ledger_state(7);
        let final_state = state.entries.clone();
        let result = make_sandbox_result(7, final_state);
        let diff = compute_diff(&state, &result).expect("diff");

        let profile_a = generate_profile(&result, &diff).expect("profile_a");
        let profile_b = generate_profile(&result, &diff).expect("profile_b");

        let json_a = serde_json::to_string(&profile_a).unwrap();
        let json_b = serde_json::to_string(&profile_b).unwrap();

        assert_eq!(json_a, json_b, "generate_profile must be deterministic for the same inputs");
    }

    /// Re-simulating the same state twice with no patches produces identical diffs.
    #[test]
    fn test_re_simulation_same_inputs_gives_identical_diffs() {
        let state = make_ledger_state(99);
        let final_state = state.entries.clone();

        let result_1 = make_sandbox_result(99, final_state.clone());
        let result_2 = make_sandbox_result(99, final_state);

        let diff_1 = compute_diff(&state, &result_1).expect("diff_1");
        let diff_2 = compute_diff(&state, &result_2).expect("diff_2");

        // Sort entries so the comparison is order-independent.
        let mut entries_1 = diff_1.entries.clone();
        let mut entries_2 = diff_2.entries.clone();
        entries_1.sort_by_key(|e| e.key.clone());
        entries_2.sort_by_key(|e| e.key.clone());

        assert_eq!(
            serde_json::to_string(&entries_1).unwrap(),
            serde_json::to_string(&entries_2).unwrap(),
            "two replays of the same state must produce identical diffs"
        );
    }

    /// No ambient non-determinism: the replay path must not inspect wall-clock
    /// time or any global state. We verify this by asserting that the
    /// deterministic helpers above never produce divergent results even when
    /// interleaved.
    #[test]
    fn test_replay_path_does_not_rely_on_wall_clock() {
        use crate::replay::profiler::generate_profile;

        // Run the same computation ten times in quick succession.
        let mut serialized: Vec<String> = Vec::new();
        for _ in 0..10 {
            let state = make_ledger_state(3);
            let final_state = state.entries.clone();
            let result = make_sandbox_result(3, final_state);
            let diff = compute_diff(&state, &result).expect("diff");
            let profile = generate_profile(&result, &diff).expect("profile");
            let combined = serde_json::to_string(&(&diff, &profile)).unwrap();
            serialized.push(combined);
        }

        let first = &serialized[0];
        for (i, s) in serialized.iter().enumerate() {
            assert_eq!(s, first, "run {i} diverged from run 0 — wall-clock or ambient state detected");
        }
    }

    // ---------------------------------------------------------------------------
    // Property-based determinism tests
    // ---------------------------------------------------------------------------

    proptest! {
        /// For any fixed seed, `compute_diff` produces byte-identical output
        /// on repeated calls with the same inputs.
        #[test]
        fn prop_compute_diff_deterministic(seed in 0u32..=1000u32) {
            let state = make_ledger_state(seed);
            let final_state = state.entries.clone();
            let result = make_sandbox_result(seed, final_state);

            let diff_a = compute_diff(&state, &result).expect("diff_a");
            let diff_b = compute_diff(&state, &result).expect("diff_b");

            let mut a = diff_a.entries.clone();
            let mut b = diff_b.entries.clone();
            a.sort_by_key(|e| e.key.clone());
            b.sort_by_key(|e| e.key.clone());

            prop_assert_eq!(
                serde_json::to_string(&a).unwrap(),
                serde_json::to_string(&b).unwrap(),
            );
        }

        /// For any fixed seed, `generate_profile` produces byte-identical
        /// output on repeated calls.
        #[test]
        fn prop_generate_profile_deterministic(seed in 0u32..=1000u32) {
            use crate::replay::profiler::generate_profile;

            let state = make_ledger_state(seed);
            let final_state = state.entries.clone();
            let result = make_sandbox_result(seed, final_state);
            let diff = compute_diff(&state, &result).expect("diff");

            let profile_a = generate_profile(&result, &diff).expect("profile_a");
            let profile_b = generate_profile(&result, &diff).expect("profile_b");

            prop_assert_eq!(
                serde_json::to_string(&profile_a).unwrap(),
                serde_json::to_string(&profile_b).unwrap(),
            );
        }

        /// Re-running the what-if path (differ + profiler) with the same seed
        /// and the same injected entries produces identical reports each time.
        #[test]
        fn prop_whatif_replay_reports_are_byte_identical(seed in 1u32..=500u32) {
            use crate::replay::profiler::generate_profile;

            let mut state = make_ledger_state(seed);

            // Inject a deterministic override.
            let injected_key = "injected_entry".to_string();
            let injected_value = vec![seed as u8; 8];
            state.entries.insert(injected_key.clone(), injected_value.clone());

            let final_state = {
                let mut fs = state.entries.clone();
                // Simulate a state change.
                fs.insert(injected_key.clone(), injected_value.iter().map(|b| b.wrapping_add(1)).collect());
                fs
            };

            let result_1 = make_sandbox_result(seed, final_state.clone());
            let result_2 = make_sandbox_result(seed, final_state);

            let diff_1 = compute_diff(&state, &result_1).expect("diff_1");
            let diff_2 = compute_diff(&state, &result_2).expect("diff_2");

            let profile_1 = generate_profile(&result_1, &diff_1).expect("profile_1");
            let profile_2 = generate_profile(&result_2, &diff_2).expect("profile_2");

            let mut entries_1 = diff_1.entries.clone();
            let mut entries_2 = diff_2.entries.clone();
            entries_1.sort_by_key(|e| e.key.clone());
            entries_2.sort_by_key(|e| e.key.clone());

            prop_assert_eq!(
                serde_json::to_string(&entries_1).unwrap(),
                serde_json::to_string(&entries_2).unwrap(),
            );
            prop_assert_eq!(
                serde_json::to_string(&profile_1).unwrap(),
                serde_json::to_string(&profile_2).unwrap(),
            );
        }
    }
}

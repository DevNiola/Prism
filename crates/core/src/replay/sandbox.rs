use crate::error::{GratError, GratResult};
use crate::replay::state::{encode_xdr, LedgerState};
use crate::types::trace::TraceId;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use soroban_env_host::budget::Budget;
use soroban_env_host::e2e_invoke::invoke_host_function_with_trace_hook;
use soroban_env_host::{LedgerInfo, TraceEvent as HostTraceEvent, TraceHook};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use stellar_xdr::curr::{DiagnosticEvent, Hash as XdrHash, TtlEntry};

/// A ledger state injector that overrides specific ledger keys for "what-if"
/// replay scenarios.
///
/// The injector saves the original values of any keys it overrides, applies
/// the injected values before replay, and restores the originals after replay
/// completes (regardless of success or failure).
#[derive(Debug, Clone, Default)]
pub struct LedgerStateInjector {
    /// base64(LedgerKey XDR) -> raw LedgerEntry XDR bytes to inject.
    overrides: HashMap<String, Vec<u8>>,
}

impl LedgerStateInjector {
    /// Create an empty injector.
    pub fn new() -> Self {
        Self::default()
    }

    /// Override a single ledger entry key with new raw XDR bytes.
    ///
    /// The key must be base64-encoded `LedgerKey` XDR, matching the format
    /// used by [`LedgerState::entries`].
    pub fn override_entry(&mut self, key: impl Into<String>, value: impl Into<Vec<u8>>) {
        self.overrides.insert(key.into(), value.into());
    }

    /// Override multiple entries at once.
    pub fn override_entries(&mut self, entries: HashMap<String, Vec<u8>>) {
        self.overrides.extend(entries);
    }

    /// Returns the number of overridden keys.
    pub fn len(&self) -> usize {
        self.overrides.len()
    }

    /// Returns `true` if no overrides are configured.
    pub fn is_empty(&self) -> bool {
        self.overrides.is_empty()
    }

    /// Apply the injected state to a [`LedgerState`], saving any displaced
    /// originals so they can be restored later.
    ///
    /// Returns a [`StateGuard`] that will restore the original values when
    /// dropped (or when [`StateGuard::restore`] is called explicitly).
    pub fn apply(&self, state: &mut LedgerState) -> StateGuard {
        let saved: HashMap<String, Option<Vec<u8>>> = self
            .overrides
            .iter()
            .map(|(key, new_value)| {
                let original = state.entries.insert(key.clone(), new_value.clone());
                (key.clone(), original)
            })
            .collect();

        StateGuard {
            state,
            saved,
            restored: false,
        }
    }
}

/// RAII guard that restores the original ledger state when dropped.
///
/// Created by [`LedgerStateInjector::apply`]. Call [`restore`](Self::restore)
/// explicitly, or simply drop the guard to undo the injection.
pub struct StateGuard<'a> {
    state: &'a mut LedgerState,
    saved: HashMap<String, Option<Vec<u8>>>,
    restored: bool,
}

impl<'a> StateGuard<'a> {
    /// Explicitly restore the original ledger state.
    pub fn restore(mut self) {
        for (key, original) in &self.saved {
            match original {
                Some(value) => {
                    self.state.entries.insert(key.clone(), value.clone());
                }
                None => {
                    self.state.entries.remove(key);
                }
            }
        }
        self.restored = true;
    }
}

impl<'a> Drop for StateGuard<'a> {
    fn drop(&mut self) {
        if !self.restored {
            for (key, original) in &self.saved {
                match original {
                    Some(value) => {
                        self.state.entries.insert(key.clone(), value.clone());
                    }
                    None => {
                        self.state.entries.remove(key);
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TraceEvent {
    pub event_type: TraceEventType,

    pub timestamp_us: u64,

    pub data: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum TraceEventType {
    InvocationStart,

    InvocationEnd,

    HostFunctionCall,

    HostFunctionReturn,

    StorageRead,

    StorageWrite,

    AuthCheck,

    EventEmit,

    BudgetCheckpoint,
}

#[derive(Debug)]
pub struct SandboxResult {
    pub trace_id: TraceId,

    pub success: bool,

    pub events: Vec<TraceEvent>,

    pub final_state: std::collections::HashMap<String, Vec<u8>>,

    pub total_cpu: u64,

    pub total_memory: u64,

    pub diagnostic_events: Vec<DiagnosticEvent>,
}

/// Generous fixed ceiling for the replay memory budget. Unlike the CPU
/// instruction limit (which is taken directly from the transaction's own
/// recorded `SorobanResources`, so it matches what actually ran at
/// consensus), the network's exact per-transaction memory ceiling isn't
/// fetched here — this only needs to sit comfortably above real usage so
/// tracing is never cut short by an artificial memory limit.
const MEM_BYTES_CEILING: u64 = 500 * 1024 * 1024;

#[allow(clippy::too_many_lines)]
pub async fn execute_with_tracing(state: &LedgerState, tx_hash: &str, trace_id: TraceId) -> GratResult<SandboxResult> {
    let inv = &state.invocation;

    let budget = Budget::try_from_configs(
        inv.cpu_instructions_limit.max(1),
        MEM_BYTES_CEILING,
        inv.cpu_cost_params.clone(),
        inv.mem_cost_params.clone(),
    )
    .map_err(|e| GratError::ReplayError(format!("failed to build execution budget: {e}")))?;

    let ledger_info = LedgerInfo {
        protocol_version: inv.protocol_version,
        sequence_number: state.ledger_sequence,
        timestamp: inv.timestamp,
        network_id: inv.network_id,
        base_reserve: inv.base_reserve,
        min_temp_entry_ttl: inv.min_temp_entry_ttl,
        min_persistent_entry_ttl: inv.min_persistent_entry_ttl,
        max_entry_ttl: inv.max_entry_ttl,
    };

    let mut encoded_ledger_entries: Vec<Vec<u8>> = Vec::new();
    let mut encoded_ttl_entries: Vec<Vec<u8>> = Vec::new();
    for key_b64 in inv.read_only_keys.iter().chain(inv.read_write_keys.iter()) {
        let Some(entry_bytes) = state.entries.get(key_b64) else {
            // Footprint key that doesn't exist yet (e.g. storage the
            // contract is about to create for the first time).
            continue;
        };
        encoded_ledger_entries.push(entry_bytes.clone());
        encoded_ttl_entries.push(match inv.ttl_by_key.get(key_b64) {
            Some(live_until) => encode_ttl_entry(key_b64, *live_until)?,
            None => Vec::new(),
        });
    }

    let seed: [u8; 32] = Sha256::digest(tx_hash.as_bytes()).into();

    let events: Rc<RefCell<Vec<TraceEvent>>> = Rc::new(RefCell::new(Vec::new()));
    let events_for_hook = Rc::clone(&events);
    let budget_for_hook = budget.clone();
    let start_time = std::time::Instant::now();

    let trace_hook: TraceHook = Rc::new(move |_host, event| {
        let cpu = budget_for_hook.get_cpu_insns_consumed().unwrap_or(0);
        let mem = budget_for_hook.get_mem_bytes_consumed().unwrap_or(0);
        let timestamp_us = start_time.elapsed().as_micros() as u64;

        let (event_type, mut data) = classify_trace_event(&event);
        if let serde_json::Value::Object(ref mut map) = data {
            map.insert("cpu_insns".to_string(), serde_json::json!(cpu));
            map.insert("mem_bytes".to_string(), serde_json::json!(mem));
        }

        events_for_hook.borrow_mut().push(TraceEvent {
            event_type,
            timestamp_us,
            data,
        });
        Ok(())
    });

    let mut diagnostic_events: Vec<DiagnosticEvent> = Vec::new();

    let invoke_result = invoke_host_function_with_trace_hook(
        &budget,
        true,
        inv.host_function_xdr.clone(),
        inv.resources_xdr.clone(),
        inv.source_account_xdr.clone(),
        inv.auth_entries_xdr.clone().into_iter(),
        ledger_info,
        encoded_ledger_entries.into_iter(),
        encoded_ttl_entries.into_iter(),
        seed.to_vec(),
        &mut diagnostic_events,
        Some(trace_hook),
    )
    .map_err(|e| {
        GratError::ReplayError(format!(
            "sandbox execution setup failed for transaction {tx_hash}: {e}"
        ))
    })?;

    if !diagnostic_events.is_empty() {
        tracing::debug!(
            tx_hash,
            count = diagnostic_events.len(),
            "captured diagnostic events during sandbox execution"
        );
    }

    let success = invoke_result.encoded_invoke_result.is_ok();
    if let Err(e) = &invoke_result.encoded_invoke_result {
        tracing::info!(tx_hash, error = %e, "sandboxed invocation did not succeed");
    }

    let mut final_state = state.entries.clone();
    for change in &invoke_result.ledger_changes {
        if change.read_only {
            continue;
        }
        let key_b64 = STANDARD.encode(&change.encoded_key);
        match &change.encoded_new_value {
            Some(new_value) => {
                final_state.insert(key_b64, new_value.clone());
            }
            None => {
                final_state.remove(&key_b64);
            }
        }
    }

    let total_cpu = budget.get_cpu_insns_consumed().unwrap_or(0);
    let total_memory = budget.get_mem_bytes_consumed().unwrap_or(0);

    let events = match Rc::try_unwrap(events) {
        Ok(cell) => cell.into_inner(),
        Err(shared) => shared.borrow().clone(),
    };

    Ok(SandboxResult {
        trace_id,
        success,
        events,
        final_state,
        total_cpu,
        total_memory,
        diagnostic_events,
    })
}

/// Replay a transaction with injected ledger state, restoring the original
/// state after replay completes (even on error).
///
/// This is the primary entry point for "what-if" scenarios: the caller
/// provides a [`LedgerStateInjector`] that overrides specific ledger keys
/// before the sandbox runs, and the original values are restored when the
/// returned guard is dropped.
///
/// # Example
/// ```ignore
/// let mut injector = LedgerStateInjector::new();
/// injector.override_entry("base64:LedgerKey", new_entry_xdr);
/// let result = execute_with_tracing_injected(&mut state, &tx_hash, trace_id, &injector).await?;
/// // state.entries is automatically restored here
/// ```
pub async fn execute_with_tracing_injected(
    state: &mut LedgerState,
    tx_hash: &str,
    trace_id: TraceId,
    injector: &LedgerStateInjector,
) -> GratResult<SandboxResult> {
    let _guard = injector.apply(state);
    let result = execute_with_tracing(state, tx_hash, trace_id).await;
    // Guard is dropped here, restoring original state.
    result
}

fn encode_ttl_entry(key_b64: &str, live_until_ledger_seq: u32) -> GratResult<Vec<u8>> {
    let key_bytes = STANDARD
        .decode(key_b64)
        .map_err(|e| GratError::XdrDecodingFailed {
            type_name: "LedgerKey",
            reason: format!("invalid base64: {e}"),
        })?;
    let key_hash: [u8; 32] = Sha256::digest(&key_bytes).into();
    let ttl_entry = TtlEntry {
        key_hash: XdrHash(key_hash),
        live_until_ledger_seq,
    };
    encode_xdr(&ttl_entry, "TtlEntry")
}

/// Classifies one host trace event and renders it into our own event schema.
///
/// The host's `Context`/`Frame` types backing `PushCtx`/`PopCtx` aren't public
/// outside `soroban-env-host`, so the contract id and function name for those
/// two variants are recovered by best-effort parsing of the host's own
/// `Display` rendering (of the form `push VM:<id>:<fn>(...)` /
/// `pop VM:<id>:<fn> -> Ok(...)`) rather than field access. `EnvCall`/`EnvRet`
/// carry their function name directly and don't need this.
fn classify_trace_event(event: &HostTraceEvent<'_>) -> (TraceEventType, serde_json::Value) {
    match event {
        HostTraceEvent::Begin => (
            TraceEventType::BudgetCheckpoint,
            serde_json::json!({ "phase": "begin" }),
        ),
        HostTraceEvent::End => (
            TraceEventType::BudgetCheckpoint,
            serde_json::json!({ "phase": "end" }),
        ),
        HostTraceEvent::PushCtx(..) => {
            let detail = format!("{event}");
            let (contract_id, function) = parse_frame_label(&detail, "push ", "(");
            (
                TraceEventType::InvocationStart,
                serde_json::json!({
                    "contract_id": contract_id,
                    "function": function,
                    "detail": detail,
                }),
            )
        }
        HostTraceEvent::PopCtx(.., result) => {
            let detail = format!("{event}");
            let (contract_id, function) = parse_frame_label(&detail, "pop ", " ->");
            (
                TraceEventType::InvocationEnd,
                serde_json::json!({
                    "contract_id": contract_id,
                    "function": function,
                    "is_error": result.is_err(),
                    "detail": detail,
                }),
            )
        }
        HostTraceEvent::EnvCall(name, _args) => (
            TraceEventType::HostFunctionCall,
            serde_json::json!({
                "function": name,
                "detail": format!("{event}"),
            }),
        ),
        HostTraceEvent::EnvRet(name, result) => (
            TraceEventType::HostFunctionReturn,
            serde_json::json!({
                "function": name,
                "is_error": result.is_err(),
                "detail": format!("{event}"),
            }),
        ),
    }
}

fn parse_frame_label(
    detail: &str,
    prefix: &str,
    end_marker: &str,
) -> (Option<String>, Option<String>) {
    let Some(rest) = detail.strip_prefix(prefix) else {
        return (None, None);
    };
    let Some(end) = rest.find(end_marker) else {
        return (None, None);
    };
    let label = &rest[..end];
    let mut parts = label.splitn(3, ':');
    let ty = parts.next().unwrap_or_default();
    let id = parts.next().unwrap_or_default();
    let function = parts.next().filter(|f| !f.is_empty()).map(str::to_string);

    if ty.is_empty() && id.is_empty() {
        return (None, function);
    }
    (Some(format!("{ty}:{id}")), function)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::state::{InvocationInput, LedgerState, ReconstructionPath};
    use crate::replay::trace::build_trace_tree;
    use crate::types::trace::TraceId;
    use stellar_xdr::curr::{ContractCostParams, VecM};

    // ── Helpers ───────────────────────────────────────────────────────────

    fn minimal_invocation() -> InvocationInput {
        InvocationInput {
            host_function_xdr: Vec::new(),
            resources_xdr: Vec::new(),
            source_account_xdr: Vec::new(),
            auth_entries_xdr: Vec::new(),
            read_only_keys: Vec::new(),
            read_write_keys: Vec::new(),
            ttl_by_key: HashMap::new(),
            cpu_cost_params: ContractCostParams(VecM::default()),
            mem_cost_params: ContractCostParams(VecM::default()),
            network_id: [0u8; 32],
            protocol_version: 21,
            timestamp: 0,
            base_reserve: 5_000_000,
            min_temp_entry_ttl: 17,
            min_persistent_entry_ttl: 2_073_600,
            max_entry_ttl: 3_110_400,
            cpu_instructions_limit: 1_000_000,
        }
    }

    fn minimal_ledger_state(ledger_sequence: u32) -> LedgerState {
        LedgerState {
            ledger_sequence,
            entries: HashMap::new(),
            reconstruction_path: ReconstructionPath::HotPath,
            invocation: minimal_invocation(),
        }
    }

    fn test_trace_id() -> TraceId {
        TraceId("test-trace-id".to_string())
    }

    fn empty_sandbox_result() -> SandboxResult {
        SandboxResult {
            trace_id: test_trace_id(),
            success: true,
            events: Vec::new(),
            final_state: HashMap::new(),
            total_cpu: 0,
            total_memory: 0,
            diagnostic_events: Vec::new(),
        }
    }

    // ── LedgerStateInjector tests ─────────────────────────────────────────

    #[test]
    fn new_injector_is_empty() {
        let injector = LedgerStateInjector::new();
        assert!(injector.is_empty());
        assert_eq!(injector.len(), 0);
    }

    #[test]
    fn override_entry_adds_one_entry() {
        let mut injector = LedgerStateInjector::new();
        injector.override_entry("key1", vec![1u8, 2, 3]);
        assert_eq!(injector.len(), 1);
        assert!(!injector.is_empty());
    }

    #[test]
    fn override_entries_adds_multiple() {
        let mut injector = LedgerStateInjector::new();
        let mut overrides = HashMap::new();
        overrides.insert("keyA".to_string(), vec![10u8]);
        overrides.insert("keyB".to_string(), vec![20u8]);
        injector.override_entries(overrides);
        assert_eq!(injector.len(), 2);
    }

    // ── StateGuard restoration tests ──────────────────────────────────────

    #[test]
    fn state_guard_applies_override_and_restores_on_drop() {
        let mut state = minimal_ledger_state(100);
        let original_value = vec![0xFFu8; 4];
        state
            .entries
            .insert("test_key".to_string(), original_value.clone());

        let injected_value = vec![0x00u8; 4];
        let mut injector = LedgerStateInjector::new();
        injector.override_entry("test_key", injected_value.clone());

        {
            let _guard = injector.apply(&mut state);
            assert_eq!(
                state.entries.get("test_key").unwrap(),
                &injected_value,
                "injected value should be active while guard is held"
            );
        }
        assert_eq!(
            state.entries.get("test_key").unwrap(),
            &original_value,
            "original value must be restored after guard drop"
        );
    }

    #[test]
    fn state_guard_explicit_restore_works() {
        let mut state = minimal_ledger_state(200);
        state.entries.insert("k".to_string(), vec![1u8]);

        let mut injector = LedgerStateInjector::new();
        injector.override_entry("k", vec![2u8]);

        let guard = injector.apply(&mut state);
        assert_eq!(state.entries["k"], vec![2u8]);

        guard.restore();
        assert_eq!(
            state.entries["k"],
            vec![1u8],
            "value must be restored after explicit restore()"
        );
    }

    #[test]
    fn state_guard_adds_new_key_and_removes_it_on_drop() {
        let mut state = minimal_ledger_state(300);
        assert!(!state.entries.contains_key("new_key"));

        let mut injector = LedgerStateInjector::new();
        injector.override_entry("new_key", vec![42u8]);

        {
            let _guard = injector.apply(&mut state);
            assert!(
                state.entries.contains_key("new_key"),
                "new_key should exist while guard is held"
            );
        }

        assert!(
            !state.entries.contains_key("new_key"),
            "new_key must be removed after guard drop (it didn't exist originally)"
        );
    }

    // ── LedgerState construction / field access tests ─────────────────────

    #[test]
    fn ledger_state_fields_are_accessible() {
        let state = minimal_ledger_state(42);
        assert_eq!(state.ledger_sequence, 42);
        assert!(state.entries.is_empty());
        assert_eq!(state.reconstruction_path, ReconstructionPath::HotPath);
        assert_eq!(state.invocation.protocol_version, 21);
    }

    #[test]
    fn reconstruction_path_variants_are_distinct() {
        assert_ne!(ReconstructionPath::HotPath, ReconstructionPath::ColdPath);
        assert_eq!(ReconstructionPath::HotPath, ReconstructionPath::HotPath);
        assert_eq!(ReconstructionPath::ColdPath, ReconstructionPath::ColdPath);
    }

    #[test]
    fn ledger_state_with_entries_stores_them() {
        let mut state = minimal_ledger_state(55);
        state.entries.insert("entry1".to_string(), vec![1, 2, 3]);
        state.entries.insert("entry2".to_string(), vec![4, 5, 6]);
        assert_eq!(state.entries.len(), 2);
        assert_eq!(state.entries["entry1"], vec![1, 2, 3]);
    }

    // ── build_trace_tree tests ────────────────────────────────────────────

    #[test]
    fn empty_sandbox_result_produces_empty_trace() {
        let result = empty_sandbox_result();
        let tree = build_trace_tree(&result).expect("build_trace_tree should not fail");
        assert!(tree.is_empty(), "empty events should produce empty trace tree");
    }

    #[test]
    fn trace_event_types_are_distinct() {
        assert_ne!(TraceEventType::InvocationStart, TraceEventType::InvocationEnd);
        assert_ne!(
            TraceEventType::HostFunctionCall,
            TraceEventType::HostFunctionReturn
        );
        assert_ne!(TraceEventType::StorageRead, TraceEventType::StorageWrite);
        assert_ne!(
            TraceEventType::InvocationStart,
            TraceEventType::BudgetCheckpoint
        );
    }

    #[test]
    fn sandbox_result_fields_are_accessible() {
        let result = SandboxResult {
            trace_id: test_trace_id(),
            success: true,
            events: Vec::new(),
            final_state: HashMap::new(),
            total_cpu: 100,
            total_memory: 200,
            diagnostic_events: Vec::new(),
        };
        assert!(result.success);
        assert_eq!(result.total_cpu, 100);
        assert_eq!(result.total_memory, 200);
        assert!(result.events.is_empty());
        assert!(result.diagnostic_events.is_empty());
    }

    #[test]
    fn build_trace_tree_matched_start_end_produces_one_root() {
        // A single InvocationStart + InvocationEnd pair should yield one root node.
        let start = TraceEvent {
            event_type: TraceEventType::InvocationStart,
            timestamp_us: 0,
            data: serde_json::json!({
                "contract_id": "test_contract",
                "function": "my_function",
            }),
        };
        let end = TraceEvent {
            event_type: TraceEventType::InvocationEnd,
            timestamp_us: 100,
            data: serde_json::json!({
                "contract_id": "test_contract",
                "function": "my_function",
                "is_error": false,
            }),
        };

        let result = SandboxResult {
            trace_id: test_trace_id(),
            success: true,
            events: vec![start, end],
            final_state: HashMap::new(),
            total_cpu: 500,
            total_memory: 1024,
            diagnostic_events: Vec::new(),
        };

        let tree = build_trace_tree(&result).expect("build_trace_tree");
        assert_eq!(
            tree.len(),
            1,
            "one start+end pair must produce exactly one root invocation"
        );
        assert_eq!(tree[0].contract_id, "test_contract");
        assert_eq!(tree[0].function_name, "my_function");
        assert!(
            tree[0].sub_invocations.is_empty(),
            "no nested calls means no sub-invocations"
        );
    }

    #[test]
    fn build_trace_tree_nested_invocations_produce_sub_invocations() {
        // Parent: Start → (child Start → End) → End
        let parent_start = TraceEvent {
            event_type: TraceEventType::InvocationStart,
            timestamp_us: 0,
            data: serde_json::json!({"contract_id": "parent", "function": "outer"}),
        };
        let child_start = TraceEvent {
            event_type: TraceEventType::InvocationStart,
            timestamp_us: 10,
            data: serde_json::json!({"contract_id": "child", "function": "inner"}),
        };
        let child_end = TraceEvent {
            event_type: TraceEventType::InvocationEnd,
            timestamp_us: 20,
            data: serde_json::json!({"is_error": false}),
        };
        let parent_end = TraceEvent {
            event_type: TraceEventType::InvocationEnd,
            timestamp_us: 30,
            data: serde_json::json!({"is_error": false}),
        };

        let result = SandboxResult {
            trace_id: test_trace_id(),
            success: true,
            events: vec![parent_start, child_start, child_end, parent_end],
            final_state: HashMap::new(),
            total_cpu: 0,
            total_memory: 0,
            diagnostic_events: Vec::new(),
        };

        let tree = build_trace_tree(&result).expect("build_trace_tree");
        assert_eq!(tree.len(), 1, "one root invocation");
        assert_eq!(tree[0].function_name, "outer");
        assert_eq!(
            tree[0].sub_invocations.len(),
            1,
            "must have one sub-invocation"
        );
        assert_eq!(tree[0].sub_invocations[0].function_name, "inner");
    }

    #[test]
    fn protocol_version_is_pinned_in_invocation() {
        // The replay sandbox determinism guarantee requires a pinned protocol version.
        // This asserts the value flows through InvocationInput correctly.
        let inv = minimal_invocation();
        assert_eq!(
            inv.protocol_version, 21,
            "protocol version must be pinned to 21 for deterministic replay"
        );
    }

    #[test]
    fn final_state_reflects_injected_entries() {
        // After injection, entries appear in the state map.
        let mut state = minimal_ledger_state(77);
        let mut injector = LedgerStateInjector::new();
        injector.override_entry("ledger_key_b64", vec![0xAA, 0xBB]);

        let _guard = injector.apply(&mut state);
        assert!(
            state.entries.contains_key("ledger_key_b64"),
            "injected key must be present in state.entries"
        );
        assert_eq!(state.entries["ledger_key_b64"], vec![0xAA, 0xBB]);
    }
}

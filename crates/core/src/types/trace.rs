use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceId(pub String);

impl TraceId {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostFunctionCall {
    pub function_name: String,

    pub arguments: Vec<String>,

    pub return_value: Option<String>,

    pub cpu_instructions: u64,

    pub memory_bytes: u64,

    pub is_error: bool,

    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractInvocation {
    pub trace_id: TraceId,

    pub contract_id: String,

    pub function_name: String,

    pub arguments: Vec<String>,

    pub return_value: Option<String>,

    pub host_calls: Vec<HostFunctionCall>,

    pub sub_invocations: Vec<ContractInvocation>,

    pub total_cpu_instructions: u64,

    pub total_memory_bytes: u64,

    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntryDiff {
    pub key: String,

    pub before: Option<String>,

    pub after: Option<String>,

    pub change_type: DiffChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffChangeType {
    Created,
    Updated,
    Deleted,
    Unchanged,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StateDiff {
    pub entries: Vec<LedgerEntryDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceHotspot {
    pub location: String,

    pub cpu_instructions: u64,

    pub cpu_percentage: f64,

    pub memory_bytes: u64,

    pub memory_percentage: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceProfile {
    pub total_cpu: u64,

    pub cpu_limit: u64,

    pub total_memory: u64,

    pub memory_limit: u64,

    pub total_read_bytes: u64,

    pub total_write_bytes: u64,

    pub read_limit: u64,

    pub write_limit: u64,

    pub hotspots: Vec<ResourceHotspot>,

    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticEvent {
    pub event_type: String,

    pub topics: Vec<String>,

    pub data: HashMap<String, String>,

    pub timeline_position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionTrace {
    pub tx_hash: String,

    pub ledger_sequence: u32,

    pub network: String,

    pub invocations: Vec<ContractInvocation>,

    pub state_diff: StateDiff,

    pub resource_profile: ResourceProfile,

    pub diagnostic_events: Vec<DiagnosticEvent>,
}

// ── Call Graph (Issue #62) ────────────────────────────────────────────────

/// A directed edge in the cross-contract call graph.
///
/// Represents one invocation boundary: `caller` called `callee` at the given
/// function with the listed arguments.  `call_index` preserves the temporal
/// order of edges so callers can reconstruct the exact invocation sequence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallEdge {
    /// Stellar strkey of the calling contract (`C…`).
    pub caller: String,
    /// Stellar strkey of the called contract (`C…`).
    pub callee: String,
    /// Name of the function invoked on `callee`.
    pub function_name: String,
    /// Human-readable argument values (best-effort).
    pub arguments: Vec<String>,
    /// Zero-based position of this call among all calls in the transaction.
    pub call_index: usize,
    /// Call-stack depth at the time of this invocation (root = 0).
    pub depth: usize,
    /// `true` if this edge is part of a detected cycle.
    pub is_cycle: bool,
}

/// A node in the call graph — one participating contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallNode {
    /// Stellar strkey for this contract.
    pub contract_id: String,
    /// All functions that were invoked on this contract during the transaction.
    pub invoked_functions: Vec<String>,
    /// Total number of times this contract was called (in-degree).
    pub call_count: usize,
}

/// Full directed call graph for a transaction.
///
/// The graph is serialised as a flat list of edges (suitable for any graph
/// renderer) together with a per-node summary.  Any cycle in the call path
/// is flagged on the relevant edges rather than stored separately so the
/// structure stays acyclic when serialised.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CallGraph {
    /// All directed edges, in temporal (call_index) order.
    pub edges: Vec<CallEdge>,
    /// One entry per distinct contract that participated in the transaction.
    pub nodes: Vec<CallNode>,
    /// `true` if at least one cycle was detected.
    pub has_cycles: bool,
    /// Human-readable descriptions of any cycles that were found.
    pub cycle_descriptions: Vec<String>,
}

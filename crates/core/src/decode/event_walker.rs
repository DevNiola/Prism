//! Diagnostic event walker for pinpointing the failing contract in a Soroban transaction.
//!
//! Soroban transactions emit a chronological stream of [`DiagnosticEvent`]s
//! during execution.  Each event carries a contract ID, a list of topics (Symbol
//! or String values), and an optional data payload.
//!
//! This module provides [`DiagnosticEventWalker`] which walks that event stream
//! and uses a call-stack model to determine *which contract* was executing at the
//! moment a failure occurred.  This is important because a single transaction can
//! involve many contracts (A → B → C), and a naive reverse scan of the events
//! would incorrectly blame the top-level contract (A) instead of the one that
//! actually panicked (C).

use stellar_strkey::Contract as StrkeyContract;
use stellar_xdr::curr::{ContractEventBody, DiagnosticEvent, Hash, ScVal};

// ---------------------------------------------------------------------------
// DiagnosticEventWalker — chronological call-stack walker
// ---------------------------------------------------------------------------

/// Walks a chronological vector of [`DiagnosticEvent`] records, maintaining
/// an internal call-stack that tracks the currently-executing contract.
///
/// When a failure indicator (`in_successful_contract_call = false`,
/// `ScVal::Error`, or topic matching `error` / `panic` / `revert` /
/// `hosterror` / `failed` / `trap`) is encountered, the walker halts
/// immediately and returns the [`ContractId`] at the top of the stack — i.e.
/// the exact contract that was executing when the failure occurred.
///
/// This is more precise than a simple reverse scan because it correctly
/// identifies the culprit in multi-contract call chains (e.g., A → B → C
/// where C panics).  Without this stack, the walker would mistakenly blame
/// contract A (the top-level invocation).
///
/// # Edge cases
/// - **First-instruction panic:**  If a contract panics before emitting any
///   sub-events the stack is empty.  The walker falls back to the
///   [`DiagnosticEvent::event.contract_id`] of the failing event itself.
/// - **No failure:** Returns [`None`].
/// - **Empty input:** Returns [`None`].
pub struct DiagnosticEventWalker;

impl DiagnosticEventWalker {
    pub fn new() -> Self {
        Self
    }

    /// Walk `events` chronologically and return the strkey-encoded contract
    /// identifier (`C…`) of the contract that caused the first detected
    /// failure, or [`None`] if no failure is found.
    pub fn locate_failing_contract(&self, events: &[DiagnosticEvent]) -> Option<String> {
        // The call stack models the currently active chain of contract invocations.
        // We push when we see an `fn_call` event and pop on `fn_return`.
        // At any point the top of the stack is the contract currently executing.
        let mut stack: Vec<String> = Vec::new();

        for event in events {
            let ContractEventBody::V0(v0) = &event.event.body;

            // Extract all topics as plain strings for matching.
            // Non-string topics (e.g., numeric ScVal) are silently dropped here;
            // they are not used as call-flow or failure indicators.
            let topics: Vec<String> = v0.topics.iter().filter_map(Self::topic_to_string).collect();
            let first_topic = topics.first().map(String::as_str);

            // Update the call stack based on the first topic of the event.
            match first_topic {
                // `fn_call` signals that the Soroban host is entering a contract.
                // Push the contract's strkey so we know who is executing next.
                Some("fn_call") => {
                    if let Some(ref hash) = event.event.contract_id {
                        stack.push(Self::hash_to_strkey(hash));
                    }
                    // If the event has no contract_id (rare but possible for
                    // system-level calls), we don't push anything and the stack
                    // stays unchanged.
                }
                // `fn_return` signals a clean return from the current contract.
                // Pop it off the stack to restore the caller's context.
                Some("fn_return") => {
                    stack.pop();
                }
                _ => {
                    // All other topics don't affect the call stack.
                }
            }

            // Check whether this event indicates a failure.  If so, the
            // contract at the top of the stack is the culprit.
            if Self::is_failure_event(event, &topics, &v0.data) {
                return stack
                    .last()
                    .cloned()
                    // Fallback: if the stack is empty (e.g., a top-level panic
                    // before any `fn_call` was emitted) use the event's own
                    // contract_id instead.
                    .or_else(|| event.event.contract_id.as_ref().map(Self::hash_to_strkey));
            }
        }

        // No failure event found in the entire stream.
        None
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    /// Extract a Symbol or String topic value as a plain Rust `String`.
    /// Returns `None` for numeric/binary topics that are not relevant to
    /// call-flow tracking.
    fn topic_to_string(val: &ScVal) -> Option<String> {
        match val {
            ScVal::Symbol(sym) => Some(sym.to_string()),
            ScVal::String(s) => Some(s.to_string()),
            _ => None,
        }
    }

    /// Determine whether a single diagnostic event represents a failure.
    ///
    /// Three independent signals are checked (any one is sufficient):
    ///
    /// 1. `in_successful_contract_call == false` — the Soroban host itself
    ///    marked this event as coming from a failed call.
    /// 2. `data` is `ScVal::Error(…)` — the event's data payload contains an
    ///    explicit error value (common for host errors and budget overflows).
    /// 3. A topic contains a known failure keyword — contracts commonly emit
    ///    `"panic"`, `"error"`, `"revert"`, `"hosterror"`, `"failed"`, or
    ///    `"trap"` as their first topic when something goes wrong.
    fn is_failure_event(event: &DiagnosticEvent, topics: &[String], data: &ScVal) -> bool {
        // Signal 1: host-level failure flag.
        if !event.in_successful_contract_call {
            return true;
        }

        // Signal 2: error payload in the event data.
        if matches!(data, ScVal::Error(_)) {
            return true;
        }

        // Signal 3: known failure keyword in any topic.
        topics.iter().any(|t| {
            let lower = t.to_ascii_lowercase();
            lower == "error"
                || lower == "panic"
                || lower == "revert"
                || lower == "hosterror"
                || lower.contains("failed") // e.g., "assertion_failed"
                || lower.contains("trap")   // e.g., "wasm_trap"
        })
    }

    /// Convert a raw 32-byte contract hash to a strkey-encoded `C…` string.
    fn hash_to_strkey(hash: &Hash) -> String {
        StrkeyContract(hash.0).to_string()
    }
}

impl Default for DiagnosticEventWalker {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::curr::{
        ContractEvent, ContractEventBody, ContractEventType, ContractEventV0, ExtensionPoint, Hash,
        ScSymbol, ScVal,
    };

    fn contract_hash(seed: u8) -> Hash {
        Hash([seed; 32])
    }

    fn make_event(
        event_type: ContractEventType,
        contract_id: Option<Hash>,
        topics: Vec<ScVal>,
        data: ScVal,
        in_successful_contract_call: bool,
    ) -> DiagnosticEvent {
        DiagnosticEvent {
            in_successful_contract_call,
            event: ContractEvent {
                ext: ExtensionPoint::V0,
                contract_id,
                type_: event_type,
                body: ContractEventBody::V0(ContractEventV0 {
                    topics: topics.try_into().expect("topics VecM"),
                    data,
                }),
            },
        }
    }

    fn sym(s: &str) -> ScVal {
        ScVal::Symbol(ScSymbol(s.try_into().expect("symbol string")))
    }

    fn strkey_of(hash: &Hash) -> String {
        StrkeyContract(hash.0).to_string()
    }

    fn h1() -> Hash {
        contract_hash(1)
    }
    fn h2() -> Hash {
        contract_hash(2)
    }
    fn h3() -> Hash {
        contract_hash(3)
    }

    // -----------------------------------------------------------------------
    // A calls B, B panics → stack [B], returns B
    // -----------------------------------------------------------------------

    #[test]
    fn returns_contract_that_emitted_direct_failure() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("do_thing")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h2()),
                vec![sym("panic"), sym("out_of_bounds")],
                ScVal::Void,
                false,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h2()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // A → B → C, C panics → stack [B, C], returns C
    // -----------------------------------------------------------------------

    #[test]
    fn returns_deepest_contract_in_nested_chain() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("b_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::System,
                Some(h3()),
                vec![sym("fn_call"), sym("c_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h3()),
                vec![sym("error"), sym("index_oob")],
                ScVal::Void,
                false,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h3()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // First-instruction panic (empty stack) → fallback to event's contract_id
    // -----------------------------------------------------------------------

    #[test]
    fn returns_own_contract_id_when_stack_is_empty() {
        let events = vec![make_event(
            ContractEventType::Contract,
            Some(h1()),
            vec![sym("panic")],
            ScVal::Void,
            false,
        )];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h1()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // No failure → None
    // -----------------------------------------------------------------------

    #[test]
    fn returns_none_when_no_failure() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("do_thing")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_return")],
                ScVal::Void,
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new().locate_failing_contract(&events),
            None
        );
    }

    #[test]
    fn returns_none_on_empty_input() {
        assert_eq!(
            DiagnosticEventWalker::new().locate_failing_contract(&[]),
            None
        );
    }

    #[test]
    fn returns_none_when_all_events_are_successful() {
        let events = vec![
            make_event(
                ContractEventType::Contract,
                Some(contract_hash(1)),
                vec![sym("transfer")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(contract_hash(2)),
                vec![sym("mint")],
                ScVal::Void,
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new().locate_failing_contract(&events),
            None
        );
    }

    // -----------------------------------------------------------------------
    // First failure wins (chronological halt)
    // -----------------------------------------------------------------------

    #[test]
    fn returns_first_failure_chronologically() {
        let events = vec![
            make_event(
                ContractEventType::Contract,
                Some(h1()),
                vec![sym("error")],
                ScVal::Void,
                false,
            ),
            make_event(
                ContractEventType::Contract,
                Some(contract_hash(2)),
                vec![sym("panic")],
                ScVal::Void,
                false,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h1()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Stack: fn_call pushes, fn_return pops, deep failure tracked correctly
    // -----------------------------------------------------------------------

    #[test]
    fn stack_tracks_nested_calls_correctly() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("b_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::System,
                Some(h3()),
                vec![sym("fn_call"), sym("c_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h3()),
                vec![sym("panic")],
                ScVal::Void,
                false,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h3()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Failure via ScVal::Error payload
    // -----------------------------------------------------------------------

    #[test]
    fn detects_failure_via_scval_error_payload() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("do_thing")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h2()),
                vec![sym("fn_return")],
                ScVal::Error(stellar_xdr::curr::ScError::Contract(4)),
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h2()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Failure via "revert" topic
    // -----------------------------------------------------------------------

    #[test]
    fn detects_failure_via_revert_topic() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("b_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::System,
                Some(h3()),
                vec![sym("fn_call"), sym("c_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h3()),
                vec![sym("revert")],
                ScVal::Void,
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h3()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Failure via "hosterror" topic
    // -----------------------------------------------------------------------

    #[test]
    fn detects_failure_via_hosterror_topic() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("risky_op")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h2()),
                vec![sym("hosterror"), sym("budget_exceeded")],
                ScVal::Void,
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h2()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Failure via topic containing "trap"
    // -----------------------------------------------------------------------

    #[test]
    fn detects_failure_via_trap_topic() {
        let events = vec![make_event(
            ContractEventType::Contract,
            Some(h1()),
            vec![sym("trap"), sym("division_by_zero")],
            ScVal::Void,
            true,
        )];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h1()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Failure via topic containing "failed"
    // -----------------------------------------------------------------------

    #[test]
    fn detects_failure_via_failed_topic() {
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(h2()),
                vec![sym("fn_call"), sym("do_thing")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h2()),
                vec![sym("assertion_failed")],
                ScVal::Void,
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h2()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // fn_call without contract_id → nothing pushed, fallback to event id
    // -----------------------------------------------------------------------

    #[test]
    fn fn_call_without_contract_id_does_not_push() {
        let events = vec![
            make_event(
                ContractEventType::System,
                None,
                vec![sym("fn_call"), sym("some_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(h1()),
                vec![sym("error")],
                ScVal::Void,
                false,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h1()).as_str())
        );
    }

    // -----------------------------------------------------------------------
    // Default impl matches new()
    // -----------------------------------------------------------------------

    #[test]
    fn default_walker_matches_new_walker() {
        let events = vec![make_event(
            ContractEventType::Contract,
            Some(contract_hash(7)),
            vec![sym("error")],
            ScVal::Void,
            false,
        )];

        assert_eq!(
            DiagnosticEventWalker.locate_failing_contract(&events),
            DiagnosticEventWalker::new().locate_failing_contract(&events),
        );
    }

    // -----------------------------------------------------------------------
    // fn_return removes contract from stack
    // -----------------------------------------------------------------------

    #[test]
    fn fn_return_removes_contract_from_stack() {
        let ha = h1();
        let hb = h2();

        // B is called and returns; then A calls and fails — stack should
        // correctly have A alone at the moment of failure.
        let events = vec![
            make_event(
                ContractEventType::System,
                Some(hb.clone()),
                vec![sym("fn_call"), sym("b_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::System,
                Some(hb),
                vec![sym("fn_return")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::System,
                Some(ha.clone()),
                vec![sym("fn_call"), sym("c_func")],
                ScVal::Void,
                true,
            ),
            make_event(
                ContractEventType::Contract,
                Some(ha),
                vec![sym("error")],
                ScVal::Void,
                true,
            ),
        ];

        assert_eq!(
            DiagnosticEventWalker::new()
                .locate_failing_contract(&events)
                .as_deref(),
            Some(strkey_of(&h1()).as_str())
        );
    }
}

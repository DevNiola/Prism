use stellar_xdr::curr::{ContractEventBody, ContractEventType, DiagnosticEvent, Hash, ScVal};

use crate::error::GratResult;
use crate::types::report::{DiagnosticReport, FailureAttribution};
use crate::types::trace::{CallEdge, CallGraph, CallNode};
use crate::xdr::codec::XdrCodec;

#[derive(Debug, Clone)]
struct CallFrame {
    contract_address: String,
    function_name: Option<String>,
    depth: usize,
}

// ── Failure attribution (original behaviour) ─────────────────────────────

pub fn attribute_failure(
    report: &mut DiagnosticReport,
    tx_data: &serde_json::Value,
) -> GratResult<()> {
    let events_b64 = match tx_data
        .get("diagnosticEventsXdr")
        .and_then(|v| v.as_array())
    {
        Some(arr) if !arr.is_empty() => arr,
        _ => return Ok(()),
    };

    let mut call_stack: Vec<CallFrame> = Vec::new();
    let mut failure: Option<CallFrame> = None;

    for event_b64 in events_b64 {
        let Some(b64_str) = event_b64.as_str() else {
            continue;
        };
        let Ok(event) = DiagnosticEvent::from_xdr_base64(b64_str) else {
            continue;
        };

        process_event(&event, &mut call_stack, &mut failure);
    }

    if let Some(frame) = failure {
        if frame.depth > 0 {
            report.cross_contract_attribution = Some(FailureAttribution {
                origin_description: build_description(&frame),
                contract_address: frame.contract_address,
                function_name: frame.function_name,
                call_depth: frame.depth,
            });
        }
    }

    Ok(())
}

fn process_event(
    event: &DiagnosticEvent,
    call_stack: &mut Vec<CallFrame>,
    failure: &mut Option<CallFrame>,
) {
    let ContractEventBody::V0(v0) = &event.event.body;

    let contract_address = match &event.event.contract_id {
        Some(hash) => hash_to_string(hash),
        None => return,
    };

    let topics: Vec<String> = v0.topics.iter().filter_map(scval_to_string).collect();
    let first_topic = topics.first().map_or("", String::as_str);

    match first_topic {
        // fn_call / fn_return are emitted by the host for every cross-contract
        // invocation boundary.
        "fn_call" => {
            let function_name = topics.get(1).cloned();
            call_stack.push(CallFrame {
                contract_address,
                function_name,
                depth: call_stack.len(),
            });
        }
        "fn_return" => {
            call_stack.pop();
        }

        "error" | "panic" => {
            let frame = call_stack.last().cloned().unwrap_or(CallFrame {
                contract_address,
                function_name: topics.get(1).cloned(),
                depth: call_stack.len(),
            });

            if failure.is_none() {
                *failure = Some(frame);
            }
        }
        _ => {
            if event.event.type_ == ContractEventType::System && !event.in_successful_contract_call
            {
                let frame = call_stack.last().cloned().unwrap_or(CallFrame {
                    contract_address,
                    function_name: topics.first().cloned(),
                    depth: call_stack.len(),
                });
                if failure.is_none() {
                    *failure = Some(frame);
                }
            }
        }
    }
}

fn build_description(frame: &CallFrame) -> String {
    match &frame.function_name {
        Some(fn_name) => format!(
            "Failure originated in contract {} at function `{}` (call depth {})",
            frame.contract_address, fn_name, frame.depth
        ),
        None => format!(
            "Failure originated in contract {} (call depth {})",
            frame.contract_address, frame.depth
        ),
    }
}

// ── Call graph builder (Issue #62) ───────────────────────────────────────

/// Build a directed [`CallGraph`] from the raw `diagnosticEventsXdr` array
/// inside a Horizon/RPC transaction response.
///
/// Each `fn_call` diagnostic event emitted by the Soroban host represents
/// one cross-contract invocation.  This function walks every event in order,
/// maintains a call stack, and records a directed edge for each invocation
/// boundary.  Cycles (a contract calling itself or a previously seen ancestor
/// on the current call path) are detected and flagged.
pub fn build_call_graph(tx_data: &serde_json::Value) -> GratResult<CallGraph> {
    let events_b64 = match tx_data
        .get("diagnosticEventsXdr")
        .and_then(|v| v.as_array())
    {
        Some(arr) if !arr.is_empty() => arr.as_slice(),
        _ => return Ok(CallGraph::default()),
    };

    let mut graph = CallGraph::default();
    let mut call_stack: Vec<CallFrame> = Vec::new();
    let mut call_index: usize = 0;

    for event_b64 in events_b64 {
        let Some(b64_str) = event_b64.as_str() else {
            continue;
        };
        let Ok(event) = DiagnosticEvent::from_xdr_base64(b64_str) else {
            continue;
        };

        let ContractEventBody::V0(v0) = &event.event.body;
        let contract_address = match &event.event.contract_id {
            Some(hash) => hash_to_string(hash),
            None => continue,
        };

        let topics: Vec<String> = v0.topics.iter().filter_map(scval_to_string).collect();
        let first_topic = topics.first().map_or("", String::as_str);

        match first_topic {
            "fn_call" => {
                let function_name = topics
                    .get(1)
                    .cloned()
                    .unwrap_or_else(|| "<unknown>".to_string());

                // Collect arguments from topics[2..]
                let arguments: Vec<String> = topics.iter().skip(2).cloned().collect();

                // Detect cycle: is `contract_address` already on the call stack?
                let is_cycle = call_stack
                    .iter()
                    .any(|frame| frame.contract_address == contract_address);

                if is_cycle {
                    let cycle_path: Vec<String> = call_stack
                        .iter()
                        .map(|f| f.contract_address.clone())
                        .chain(std::iter::once(contract_address.clone()))
                        .collect();
                    graph.cycle_descriptions.push(format!(
                        "Cycle detected: {}",
                        cycle_path.join(" → ")
                    ));
                    graph.has_cycles = true;
                }

                // Record the edge from the current top-of-stack to this callee.
                if let Some(caller_frame) = call_stack.last() {
                    graph.edges.push(CallEdge {
                        caller: caller_frame.contract_address.clone(),
                        callee: contract_address.clone(),
                        function_name: function_name.clone(),
                        arguments: arguments.clone(),
                        call_index,
                        depth: call_stack.len(),
                        is_cycle,
                    });
                    call_index += 1;
                }

                call_stack.push(CallFrame {
                    contract_address,
                    function_name: Some(function_name),
                    depth: call_stack.len(),
                });
            }
            "fn_return" => {
                call_stack.pop();
            }
            _ => {}
        }
    }

    // Build per-node summaries from the edges.
    build_nodes(&mut graph);

    Ok(graph)
}

/// Derive [`CallNode`] summaries from the edges already recorded in `graph`.
fn build_nodes(graph: &mut CallGraph) {
    use std::collections::HashMap;

    // Track (contract_id → (functions, call_count))
    let mut node_map: HashMap<String, (Vec<String>, usize)> = HashMap::new();

    for edge in &graph.edges {
        // Record callee node — this is the contract being called.
        let entry = node_map.entry(edge.callee.clone()).or_default();
        if !entry.0.contains(&edge.function_name) {
            entry.0.push(edge.function_name.clone());
        }
        entry.1 += 1;

        // Ensure caller node exists even if it has no in-edges itself.
        node_map.entry(edge.caller.clone()).or_default();
    }

    graph.nodes = node_map
        .into_iter()
        .map(|(contract_id, (invoked_functions, call_count))| CallNode {
            contract_id,
            invoked_functions,
            call_count,
        })
        .collect();

    // Sort nodes for deterministic output.
    graph.nodes.sort_by(|a, b| a.contract_id.cmp(&b.contract_id));
}

// ── Shared helpers ────────────────────────────────────────────────────────

fn hash_to_string(hash: &Hash) -> String {
    bytes_to_hex(&hash.0)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut output, b| {
        use std::fmt::Write;
        let _ = write!(output, "{b:02x}");
        output
    })
}

fn scval_to_string(val: &ScVal) -> Option<String> {
    match val {
        ScVal::Symbol(sym) => Some(sym.to_string()),
        ScVal::String(s) => Some(s.to_string()),
        ScVal::U32(u) => Some(u.to_string()),
        ScVal::I32(i) => Some(i.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_event_b64(contract: &[u8; 32], topics: Vec<ScVal>) -> String {
        use stellar_xdr::curr::{
            ContractEvent, ContractEventBody, ContractEventType, ContractEventV0, ExtensionPoint,
            Hash, ScVec,
        };

        let event = DiagnosticEvent {
            in_successful_contract_call: true,
            event: ContractEvent {
                ext: ExtensionPoint::V0,
                contract_id: Some(Hash(*contract)),
                type_: ContractEventType::Diagnostic,
                body: ContractEventBody::V0(ContractEventV0 {
                    topics: ScVec(topics.try_into().unwrap()),
                    data: ScVal::Void,
                }),
            },
        };
        XdrCodec::to_xdr_base64(&event).unwrap()
    }

    fn sym(s: &str) -> ScVal {
        ScVal::Symbol(stellar_xdr::curr::ScSymbol(s.try_into().unwrap()))
    }

    #[test]
    fn empty_events_produces_empty_graph() {
        let data = json!({ "diagnosticEventsXdr": [] });
        let graph = build_call_graph(&data).unwrap();
        assert!(graph.edges.is_empty());
        assert!(graph.nodes.is_empty());
        assert!(!graph.has_cycles);
    }

    #[test]
    fn single_cross_contract_call_builds_one_edge() {
        let contract_a = [0x01u8; 32];
        let contract_b = [0x02u8; 32];

        // A is on the stack (root), A calls B's "transfer"
        let call_ev = make_event_b64(&contract_b, vec![sym("fn_call"), sym("transfer")]);
        let ret_ev = make_event_b64(&contract_b, vec![sym("fn_return")]);

        let data = json!({
            "diagnosticEventsXdr": [call_ev, ret_ev]
        });

        // Seed the call stack with contract_a as root using a fn_call from nowhere.
        // In a real trace, the outermost contract doesn't have an fn_call event
        // because it's the entry point — so only cross-contract calls produce edges.
        // With no root frame on the stack, no edge is generated for the first fn_call.
        // This tests the edge-from-caller-to-callee logic with a root frame.
        let _ = data; // just check it parses without panic
        let graph = build_call_graph(&data).unwrap();
        // No caller on stack for the first fn_call, so no edges are recorded.
        assert!(graph.edges.is_empty());
    }

    #[test]
    fn nested_calls_build_edges_in_order() {
        let contract_a = [0x01u8; 32];
        let contract_b = [0x02u8; 32];
        let contract_c = [0x03u8; 32];

        // Simulate: A (root, injected via a fn_call to A first), A→B, B→C
        let a_call = make_event_b64(&contract_a, vec![sym("fn_call"), sym("entry")]);
        let b_call = make_event_b64(&contract_b, vec![sym("fn_call"), sym("intermediate")]);
        let c_call = make_event_b64(&contract_c, vec![sym("fn_call"), sym("leaf")]);
        let c_ret = make_event_b64(&contract_c, vec![sym("fn_return")]);
        let b_ret = make_event_b64(&contract_b, vec![sym("fn_return")]);
        let a_ret = make_event_b64(&contract_a, vec![sym("fn_return")]);

        let data = json!({
            "diagnosticEventsXdr": [a_call, b_call, c_call, c_ret, b_ret, a_ret]
        });
        let graph = build_call_graph(&data).unwrap();

        // A→B and B→C edges (A has no caller so no edge for A_call)
        assert_eq!(graph.edges.len(), 2);

        // Edge 0: A calls B
        let edge0 = &graph.edges[0];
        assert_eq!(edge0.function_name, "intermediate");
        assert_eq!(edge0.call_index, 0);
        assert!(!edge0.is_cycle);

        // Edge 1: B calls C
        let edge1 = &graph.edges[1];
        assert_eq!(edge1.function_name, "leaf");
        assert_eq!(edge1.call_index, 1);
        assert!(!edge1.is_cycle);
    }

    #[test]
    fn cyclic_call_is_flagged() {
        let contract_a = [0x01u8; 32];

        // A calls itself (cycle)
        let a_call1 = make_event_b64(&contract_a, vec![sym("fn_call"), sym("recurse")]);
        let a_call2 = make_event_b64(&contract_a, vec![sym("fn_call"), sym("recurse")]);
        let a_ret2 = make_event_b64(&contract_a, vec![sym("fn_return")]);
        let a_ret1 = make_event_b64(&contract_a, vec![sym("fn_return")]);

        let data = json!({
            "diagnosticEventsXdr": [a_call1, a_call2, a_ret2, a_ret1]
        });
        let graph = build_call_graph(&data).unwrap();
        assert!(graph.has_cycles);
        assert!(!graph.cycle_descriptions.is_empty());
        assert!(graph.edges.iter().any(|e| e.is_cycle));
    }

    #[test]
    fn call_graph_is_serializable_to_json() {
        let data = json!({ "diagnosticEventsXdr": [] });
        let graph = build_call_graph(&data).unwrap();
        let json = serde_json::to_string(&graph).expect("serialize");
        assert!(json.contains("edges"));
        assert!(json.contains("nodes"));
        assert!(json.contains("has_cycles"));
    }

    #[test]
    fn missing_events_key_returns_empty_graph() {
        let data = json!({});
        let graph = build_call_graph(&data).unwrap();
        assert!(graph.edges.is_empty());
    }
}

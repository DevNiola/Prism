//! Type-aware recursive decoding of Soroban values.
//!
//! This module bridges raw [`ScVal`] XDR values and structured JSON by walking
//! the contract's ABI spec (`ScSpecTypeDef`) in lock-step with the value tree.
//! Without the spec every value degrades to its generic JSON representation
//! (e.g., `{"u32": 42}`); with it, primitive numeric types become plain JSON
//! numbers and user-defined types (structs, enums, unions) become named objects.

use crate::decode::scval_to_json;
use crate::spec::decoder::{ContractSpec, ContractStructDef};
use crate::types::report::DiagnosticReport;
use serde_json::{json, Map, Value};
use stellar_xdr::curr::{ContractEventBody, DiagnosticEvent, ScSpecTypeDef, ScVal};

/// Carries the type specification for one value being decoded, together with
/// the full contract spec needed to resolve any user-defined types (`Udt`)
/// that appear in nested fields.
#[derive(Clone, Copy)]
pub struct TypeRef<'a> {
    pub type_def: &'a ScSpecTypeDef,
    /// The full contract ABI spec, required to look up struct/enum/union defs.
    /// `None` when decoding without a spec (falls back to generic JSON).
    pub contract_spec: Option<&'a ContractSpec>,
}

impl<'a> TypeRef<'a> {
    pub fn new(type_def: &'a ScSpecTypeDef, contract_spec: Option<&'a ContractSpec>) -> Self {
        Self {
            type_def,
            contract_spec,
        }
    }
}

/// Dispatches a value to the decoder for its current type and carries the
/// contract specification into every nested value.
///
/// The decoder is stateless — it holds no per-call data and is cheap to copy,
/// so it can be threaded through recursive calls without heap allocation.
#[derive(Debug, Clone, Copy, Default)]
pub struct RecursiveTypeDecoder;

impl RecursiveTypeDecoder {
    pub fn new() -> Self {
        Self
    }

    /// Entry point: decode `val` using the type information in `type_ref`.
    ///
    /// When `type_ref` is `None` (no ABI available), falls back to the
    /// generic `scval_to_json` converter which produces verbose but correct output.
    pub fn decode<'a>(&self, val: &ScVal, type_ref: Option<TypeRef<'a>>) -> Value {
        let Some(type_ref) = type_ref else {
            // No type information — use the generic fallback path.
            return scval_to_json(val, None);
        };
        self.decode_type(val, type_ref.type_def, type_ref.contract_spec, 0)
    }

    /// Core recursive dispatch — matches the ABI `type_def` to pick the right
    /// decoding strategy for `val`.
    ///
    /// `depth` guards against pathological specs that could cause unbounded
    /// recursion (e.g., self-referential custom types).  At depth > 100 we
    /// give up and fall back to the generic converter rather than stack-overflow.
    fn decode_type(
        &self,
        val: &ScVal,
        type_def: &ScSpecTypeDef,
        contract_spec: Option<&ContractSpec>,
        depth: usize,
    ) -> Value {
        // Safety guard: bail out to generic JSON if nesting is unexpectedly deep.
        if depth > 100 {
            return scval_to_json(val, None);
        }

        // Convenience closure that recurses with depth + 1 and threads the
        // current contract_spec into every child call automatically.
        let child = |value: &ScVal, td: &ScSpecTypeDef| {
            self.decode_type(value, td, contract_spec, depth + 1)
        };

        match type_def {
            // Void is always JSON null regardless of the underlying ScVal.
            ScSpecTypeDef::Void => Value::Null,

            // Val means "any Soroban value" — no richer type info, use generic.
            ScSpecTypeDef::Val => scval_to_json(val, None),

            // Primitive scalar types: extract the inner Rust value directly
            // so the JSON output is a plain number/bool rather than a tagged object.
            ScSpecTypeDef::Bool => match val {
                ScVal::Bool(v) => json!(v),
                _ => scval_to_json(val, None),
            },
            ScSpecTypeDef::U32 => match val {
                ScVal::U32(v) => json!(v),
                _ => scval_to_json(val, None),
            },
            ScSpecTypeDef::I32 => match val {
                ScVal::I32(v) => json!(v),
                _ => scval_to_json(val, None),
            },
            ScSpecTypeDef::U64 => match val {
                ScVal::U64(v) => json!(v),
                _ => scval_to_json(val, None),
            },
            ScSpecTypeDef::I64 => match val {
                ScVal::I64(v) => json!(v),
                _ => scval_to_json(val, None),
            },

            // Timepoint and Duration are stored as u64 internally; unwrap the
            // newtype wrapper so the output is a plain numeric timestamp.
            ScSpecTypeDef::Timepoint => match val {
                ScVal::Timepoint(v) => json!(v.0),
                ScVal::U64(v) => json!(v), // Accept raw u64 as a fallback.
                _ => scval_to_json(val, None),
            },
            ScSpecTypeDef::Duration => match val {
                ScVal::Duration(v) => json!(v.0),
                ScVal::U64(v) => json!(v),
                _ => scval_to_json(val, None),
            },

            // 128/256-bit integers and raw byte/string/address types: the
            // generic converter already handles these well enough.
            ScSpecTypeDef::U128
            | ScSpecTypeDef::I128
            | ScSpecTypeDef::U256
            | ScSpecTypeDef::I256 => scval_to_json(val, None),
            ScSpecTypeDef::Bytes
            | ScSpecTypeDef::BytesN(_)
            | ScSpecTypeDef::String
            | ScSpecTypeDef::Symbol
            | ScSpecTypeDef::Address
            | ScSpecTypeDef::Error => scval_to_json(val, None),

            // Option<T> — Soroban encodes None as Void or an empty Vec,
            // and Some(v) as a single-element Vec [v] or the value directly.
            ScSpecTypeDef::Option(spec) => match val {
                ScVal::Void => Value::Null,
                ScVal::Vec(Some(values)) if values.is_empty() => Value::Null,
                // Single-element vec wraps the inner Some(v) payload.
                ScVal::Vec(Some(values)) if values.len() == 1 => {
                    child(&values[0], &spec.value_type)
                }
                // Bare value (not wrapped in a vec) — treat as Some(val).
                _ => child(val, &spec.value_type),
            },

            // Result<Ok, Err> — encoded as a 2-element Vec [variant_name, payload].
            // The first element is a Symbol/String "Ok" or "Err" discriminator;
            // the second element is the actual payload decoded with the matching type.
            ScSpecTypeDef::Result(spec) => match val {
                ScVal::Vec(Some(values)) if values.len() == 2 => {
                    let name = match &values[0] {
                        ScVal::Symbol(v) => v.to_string(),
                        ScVal::String(v) => v.to_string(),
                        _ => return scval_to_json(val, None),
                    };
                    let payload = if name == "Ok" {
                        child(&values[1], &spec.ok_type)
                    } else if name == "Err" {
                        child(&values[1], &spec.error_type)
                    } else {
                        // Unknown discriminator — fall back to generic.
                        return scval_to_json(val, None);
                    };
                    json!({ (name): payload })
                }
                _ => scval_to_json(val, None),
            },

            // Vec<T> — decode each element with the homogeneous element type.
            ScSpecTypeDef::Vec(spec) => match val {
                ScVal::Vec(Some(values)) => Value::Array(
                    values
                        .iter()
                        .map(|v| child(v, &spec.element_type))
                        .collect(),
                ),
                _ => scval_to_json(val, None),
            },

            // Map<K, V> — iterate entries and decode each key and value pair.
            //
            // When all keys decode to JSON strings we emit a JSON object for
            // easy readability; otherwise we fall back to an array of [key, value]
            // pairs to avoid losing non-string keys.
            ScSpecTypeDef::Map(spec) => match val {
                ScVal::Map(Some(entries)) => {
                    let mut object = Map::new();
                    let mut pairs = Vec::new();
                    for entry in entries.iter() {
                        let key = child(&entry.key, &spec.key_type);
                        let value = child(&entry.val, &spec.value_type);
                        if let Value::String(key) = key {
                            // String key → add directly to the JSON object.
                            object.insert(key, value);
                        } else {
                            // Non-string key → store as a [key, value] pair.
                            pairs.push(json!([key, value]));
                        }
                    }
                    if pairs.is_empty() {
                        // All keys were strings — return a clean JSON object.
                        Value::Object(object)
                    } else {
                        // Mixed or non-string keys — return array of pairs.
                        Value::Array(pairs)
                    }
                }
                _ => scval_to_json(val, None),
            },

            // Tuple — positionally typed; each element is decoded with its
            // corresponding type from the spec's value_types list.
            ScSpecTypeDef::Tuple(spec) => match val {
                ScVal::Vec(Some(values)) => Value::Array(
                    values
                        .iter()
                        .enumerate()
                        .map(|(i, value)| {
                            // Use the spec type for this position if available,
                            // otherwise fall back to generic for extra elements.
                            spec.value_types
                                .get(i)
                                .map_or_else(|| scval_to_json(value, None), |td| child(value, td))
                        })
                        .collect(),
                ),
                _ => scval_to_json(val, None),
            },

            // Udt (User-Defined Type) — look up the type name in the contract spec
            // and dispatch to the appropriate struct/enum/union decoder.
            ScSpecTypeDef::Udt(spec) => {
                let Some(contract_spec) = contract_spec else {
                    // No spec available — cannot resolve the UDT; use generic.
                    return scval_to_json(val, None);
                };
                let name = spec.name.to_string();
                // Search structs first, then enums, then unions.
                if let Some(def) = contract_spec.structs.iter().find(|def| def.name == name) {
                    self.decode_struct(val, def, contract_spec, depth)
                } else if let Some(def) = contract_spec.enums.iter().find(|def| def.name == name) {
                    self.decode_enum(val, def)
                } else if let Some(def) = contract_spec.unions.iter().find(|def| def.name == name) {
                    self.decode_union(val, def, contract_spec, depth)
                } else {
                    // Type name not found in any category — fall back to generic.
                    scval_to_json(val, None)
                }
            }
        }
    }

    /// Decode a struct value.
    ///
    /// Soroban serialises structs in two ways depending on the SDK version:
    /// - **Map**: fields are `{Symbol → value}` entries (named layout).
    /// - **Vec**: fields are positional, matched by index to the spec's field list.
    ///
    /// Both forms are supported; missing fields are emitted as `null` so the
    /// output always contains every field declared in the spec.
    fn decode_struct(
        &self,
        val: &ScVal,
        def: &ContractStructDef,
        spec: &ContractSpec,
        depth: usize,
    ) -> Value {
        let mut object = Map::new();
        match val {
            ScVal::Map(Some(entries)) => {
                // Named layout: look up each spec field by its symbol/string key.
                for field in &def.fields {
                    let entry = entries.iter().find(|entry| match &entry.key {
                        ScVal::Symbol(k) => k.to_string() == field.name,
                        ScVal::String(k) => k.to_string() == field.name,
                        _ => false,
                    });
                    object.insert(
                        field.name.clone(),
                        entry
                            .and_then(|entry| {
                                field.type_def.as_ref().map(|td| {
                                    self.decode_type(&entry.val, td, Some(spec), depth + 1)
                                })
                            })
                            .unwrap_or(Value::Null),
                    );
                }
            }
            ScVal::Vec(Some(values)) => {
                // Positional layout: match each spec field to the value at the
                // same index in the vec.
                for (i, field) in def.fields.iter().enumerate() {
                    object.insert(
                        field.name.clone(),
                        values
                            .get(i)
                            .and_then(|value| {
                                field
                                    .type_def
                                    .as_ref()
                                    .map(|td| self.decode_type(value, td, Some(spec), depth + 1))
                            })
                            .unwrap_or(Value::Null),
                    );
                }
            }
            _ => return scval_to_json(val, None),
        }
        Value::Object(object)
    }

    /// Decode an enum value.
    ///
    /// Soroban enums are integer-tagged at the wire level (a `u32` discriminant)
    /// but the spec maps each discriminant to a human-readable case name.
    /// Symbols/strings from newer SDK versions are also accepted directly.
    fn decode_enum(&self, val: &ScVal, def: &crate::spec::decoder::ContractEnumDef) -> Value {
        match val {
            // SDK >= some version serialises enum cases as their symbol name.
            ScVal::Symbol(v) => json!(v.to_string()),
            ScVal::String(v) => json!(v.to_string()),
            // Numeric discriminant — look up the case name in the spec.
            // If the discriminant is out of range, fall back to the raw number.
            ScVal::U32(v) => def
                .cases
                .iter()
                .find(|case| case.value == *v)
                .map_or_else(|| json!(v), |case| json!(case.name)),
            _ => scval_to_json(val, None),
        }
    }

    /// Decode a union (tagged-enum) value.
    ///
    /// Unions are encoded as a Vec whose first element is the variant name
    /// (a Symbol or String) and whose remaining elements are the payload values.
    ///
    /// The variant name is used to look up the case definition in the spec,
    /// which carries the types of the payload elements.  A single-element
    /// payload is unwrapped to a plain `{name: value}` object; multi-element
    /// payloads use `{name: [v1, v2, …]}`.
    fn decode_union(
        &self,
        val: &ScVal,
        def: &crate::spec::decoder::ContractUnionDef,
        spec: &ContractSpec,
        depth: usize,
    ) -> Value {
        // Unions must be encoded as a Vec.
        let ScVal::Vec(Some(values)) = val else {
            return scval_to_json(val, None);
        };
        // The first element is always the variant name discriminator.
        let Some(first) = values.first() else {
            return scval_to_json(val, None);
        };
        let name = match first {
            ScVal::Symbol(v) => v.to_string(),
            ScVal::String(v) => v.to_string(),
            _ => return scval_to_json(val, None),
        };
        // Look up the case definition so we know the payload types.
        let Some(case) = def.cases.iter().find(|case| case.name == name) else {
            return scval_to_json(val, None);
        };
        if let Some(types) = &case.value_types {
            // Decode each payload element with its corresponding type from the spec.
            let payload: Vec<Value> = values[1..]
                .iter()
                .enumerate()
                .map(|(i, value)| {
                    types.get(i).map_or_else(
                        || scval_to_json(value, None),
                        |td| self.decode_type(value, td, Some(spec), depth + 1),
                    )
                })
                .collect();
            // Unwrap single-element payloads for a cleaner JSON representation.
            if payload.len() == 1 {
                json!({ (name): payload[0] })
            } else {
                json!({ (name): payload })
            }
        } else {
            // Unit variant — no payload, just emit the name as a string.
            json!(name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::decoder::{
        ContractEnumCase, ContractEnumDef, ContractSpec, ContractStructDef, ContractStructField,
    };
    use serde_json::json;
    use stellar_xdr::curr::{ScMapEntry, ScSpecTypeTuple, ScSpecTypeUdt, ScSymbol, StringM};

    fn symbol(value: &str) -> ScVal {
        ScVal::Symbol(ScSymbol(
            StringM::try_from(value.as_bytes().to_vec()).unwrap(),
        ))
    }

    fn map(entries: Vec<(&str, ScVal)>) -> ScVal {
        ScVal::Map(Some(
            entries
                .into_iter()
                .map(|(key, val)| ScMapEntry {
                    key: symbol(key),
                    val,
                })
                .collect::<Vec<_>>()
                .try_into()
                .unwrap(),
        ))
    }

    #[test]
    fn nested_udts_keep_type_context_for_struct_enum_and_tuple() {
        let status = ScSpecTypeDef::Udt(ScSpecTypeUdt {
            name: "Status".try_into().unwrap(),
        });
        let inner = ScSpecTypeDef::Udt(ScSpecTypeUdt {
            name: "Inner".try_into().unwrap(),
        });
        let tuple = ScSpecTypeDef::Tuple(Box::new(ScSpecTypeTuple {
            value_types: vec![ScSpecTypeDef::U32, ScSpecTypeDef::U32]
                .try_into()
                .unwrap(),
        }));
        let spec = ContractSpec {
            errors: vec![],
            functions: vec![],
            structs: vec![
                ContractStructDef {
                    name: "Outer".to_string(),
                    fields: vec![ContractStructField {
                        name: "inner".to_string(),
                        type_name: "Inner".to_string(),
                        doc: None,
                        type_def: Some(inner.clone()),
                    }],
                    doc: None,
                },
                ContractStructDef {
                    name: "Inner".to_string(),
                    fields: vec![
                        ContractStructField {
                            name: "status".to_string(),
                            type_name: "Status".to_string(),
                            doc: None,
                            type_def: Some(status.clone()),
                        },
                        ContractStructField {
                            name: "pair".to_string(),
                            type_name: "(U32,U32)".to_string(),
                            doc: None,
                            type_def: Some(tuple),
                        },
                    ],
                    doc: None,
                },
            ],
            enums: vec![ContractEnumDef {
                name: "Status".to_string(),
                cases: vec![ContractEnumCase {
                    name: "Active".to_string(),
                    value: 1,
                    doc: None,
                }],
                doc: None,
            }],
            unions: vec![],
            name: None,
            version: None,
        };
        let value = map(vec![(
            "inner",
            map(vec![
                ("status", ScVal::U32(1)),
                (
                    "pair",
                    ScVal::Vec(Some(vec![ScVal::U32(2), ScVal::U32(3)].try_into().unwrap())),
                ),
            ]),
        )]);
        let outer = ScSpecTypeDef::Udt(ScSpecTypeUdt {
            name: "Outer".try_into().unwrap(),
        });

        let decoded =
            RecursiveTypeDecoder::new().decode(&value, Some(TypeRef::new(&outer, Some(&spec))));
        assert_eq!(
            decoded,
            json!({"inner": {"status": "Active", "pair": [2, 3]}})
        );
    }

    #[test]
    fn test_deeply_nested_contract_calls_3_plus_levels() {
        use stellar_xdr::curr::{ContractEvent, ContractEventBody, ContractEventType, ExtensionPoint, Hash, ScVec, StringM};

        fn make_event(contract: [u8; 32], topic_strings: &[&str]) -> DiagnosticEvent {
            let topics: Vec<ScVal> = topic_strings
                .iter()
                .map(|t| symbol(t))
                .collect();
            DiagnosticEvent {
                in_successful_contract_call: true,
                event: ContractEvent {
                    ext: ExtensionPoint::V0,
                    contract_id: Some(Hash(contract)),
                    type_: ContractEventType::Diagnostic,
                    body: ContractEventBody::V0(stellar_xdr::curr::ContractEventV0 {
                        topics: ScVec::try_from(topics).unwrap(),
                        data: ScVal::Void,
                    }),
                },
            }
        }

        let addr_a = [1u8; 32];
        let addr_b = [2u8; 32];
        let addr_c = [3u8; 32];
        let addr_d = [4u8; 32];

        // Call sequence: A -> B -> C -> D (depth 1 -> 2 -> 3 -> 4)
        let events = vec![
            make_event(addr_a, &["fn_call", "deposit"]),
            make_event(addr_b, &["fn_call", "transfer"]),
            make_event(addr_c, &["fn_call", "validate"]),
            make_event(addr_d, &["fn_call", "check_balance"]),
            make_event(addr_d, &["error", "InsufficientFunds"]),
            make_event(addr_d, &["fn_return"]),
            make_event(addr_c, &["fn_return"]),
            make_event(addr_b, &["fn_return"]),
            make_event(addr_a, &["fn_return"]),
        ];

        let report = decode_nested_contract_calls(&events, None);

        assert_eq!(report.call_depth, Some(0));
        assert_eq!(report.nested_reports.len(), 1);

        let level_1 = &report.nested_reports[0];
        assert_eq!(level_1.call_depth, Some(1));
        assert_eq!(level_1.error_name, "deposit");
        assert_eq!(level_1.nested_reports.len(), 1);

        let level_2 = &level_1.nested_reports[0];
        assert_eq!(level_2.call_depth, Some(2));
        assert_eq!(level_2.error_name, "transfer");
        assert_eq!(level_2.nested_reports.len(), 1);

        let level_3 = &level_2.nested_reports[0];
        assert_eq!(level_3.call_depth, Some(3));
        assert_eq!(level_3.error_name, "validate");
        assert_eq!(level_3.nested_reports.len(), 1);

        let level_4 = &level_3.nested_reports[0];
        assert_eq!(level_4.call_depth, Some(4));
        assert_eq!(level_4.error_name, "check_balance");
        assert!(level_4.summary.contains("InsufficientFunds"));
    }
}

/// Helper to convert ScVal topic to string
fn topic_to_string(val: &ScVal) -> Option<String> {
    match val {
        ScVal::Symbol(sym) => Some(sym.to_string()),
        ScVal::String(s) => Some(String::from_utf8_lossy(s.as_ref()).into_owned()),
        ScVal::Address(addr) => Some(format!("{addr:?}")),
        _ => None,
    }
}

/// Recursively decode diagnostic events for nested contract calls (A -> B -> C -> D),
/// building a hierarchical tree of DiagnosticReports with `call_depth` indicators.
pub fn decode_nested_contract_calls(
    events: &[DiagnosticEvent],
    base_report: Option<DiagnosticReport>,
) -> DiagnosticReport {
    let mut root = base_report.unwrap_or_else(|| {
        DiagnosticReport::new("Contract", 0, "RootInvocation", "Root transaction invocation")
    });
    root.call_depth = Some(0);

    let mut stack: Vec<DiagnosticReport> = vec![root];

    for event in events {
        let ContractEventBody::V0(v0) = &event.event.body;
        let contract_id = event
            .event
            .contract_id
            .as_ref()
            .map(|h| hex::encode(h.0))
            .unwrap_or_else(|| "unknown".to_string());

        let topics: Vec<String> = v0.topics.iter().filter_map(topic_to_string).collect();
        let topic_str = topics.first().map_or("", String::as_str);

        match topic_str {
            "fn_call" => {
                let func_name = topics.get(1).cloned().unwrap_or_else(|| "unknown_fn".to_string());
                let current_depth = stack.len();
                let mut child_report = DiagnosticReport::new(
                    "Contract",
                    0,
                    &func_name,
                    &format!("Nested call to {}::{} at depth {}", contract_id, func_name, current_depth),
                );
                child_report.failing_contract_id = Some(contract_id);
                child_report.call_depth = Some(current_depth);
                stack.push(child_report);
            }
            "fn_return" => {
                if stack.len() > 1 {
                    let completed = stack.pop().unwrap();
                    let parent = stack.last_mut().unwrap();
                    parent.nested_reports.push(completed);
                }
            }
            "error" | "panic" => {
                let error_desc = topics.get(1).cloned().unwrap_or_else(|| topic_str.to_string());
                if let Some(current) = stack.last_mut() {
                    current.summary = format!("{}: {}", current.summary, error_desc);
                    current.failing_contract_id = Some(contract_id);
                }
            }
            _ => {}
        }
    }

    // Collapse any unclosed frames back into their parents
    while stack.len() > 1 {
        let child = stack.pop().unwrap();
        stack.last_mut().unwrap().nested_reports.push(child);
    }

    stack.pop().unwrap()
}

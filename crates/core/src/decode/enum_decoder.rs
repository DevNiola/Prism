//! Contract-spec-aware decoding for Soroban enum values.
//!
//! Soroban encodes simple enum values as a discriminant (`u32`) or a symbol,
//! while variants carrying data are represented as a vector whose first item
//! is the variant symbol. This module keeps that wire-format knowledge out of
//! the generic `ScVal` renderer and exposes a small reusable decoder.

use crate::decode::scval_to_json::scval_to_json;
use crate::spec::decoder::ContractEnumDef;
use serde_json::{json, Value};
use stellar_xdr::curr::ScVal;

/// Decodes a contract enum using the variant names from its contract spec.
#[derive(Debug, Clone, Copy, Default)]
pub struct EnumDecoder;

impl EnumDecoder {
    /// Creates an enum decoder.
    pub const fn new() -> Self {
        Self
    }

    /// Checks if an enum definition represents a Soroban `Option` pattern.
    pub fn is_option_enum(enum_def: &ContractEnumDef) -> bool {
        if enum_def.name.eq_ignore_ascii_case("Option") {
            return true;
        }
        let has_none = enum_def.cases.iter().any(|c| c.name.eq_ignore_ascii_case("None"));
        let has_some = enum_def.cases.iter().any(|c| c.name.eq_ignore_ascii_case("Some"));
        has_none && has_some && enum_def.cases.len() == 2
    }

    /// Checks if an enum definition represents a Soroban `Result` pattern.
    pub fn is_result_enum(enum_def: &ContractEnumDef) -> bool {
        if enum_def.name.eq_ignore_ascii_case("Result") {
            return true;
        }
        let has_ok = enum_def.cases.iter().any(|c| c.name.eq_ignore_ascii_case("Ok"));
        let has_err = enum_def.cases.iter().any(|c| c.name.eq_ignore_ascii_case("Err"));
        has_ok && has_err && enum_def.cases.len() == 2
    }

    /// Decodes an enum value into a human-readable JSON representation.
    ///
    /// Unknown discriminants and variant heads are deliberately preserved via
    /// the normal dynamic renderer instead of being silently discarded. A
    /// payload-free variant is rendered as its name; a variant with one or
    /// more payload values is rendered as `{ "Variant": payload }`.
    pub fn decode(&self, val: &ScVal, enum_def: &ContractEnumDef) -> Value {
        // Special handling for Option pattern
        if Self::is_option_enum(enum_def) {
            return self.decode_option(val, enum_def);
        }

        // Special handling for Result pattern
        if Self::is_result_enum(enum_def) {
            return self.decode_result(val, enum_def);
        }

        match val {
            ScVal::U32(discriminant) => enum_def
                .cases
                .iter()
                .find(|case| case.value == *discriminant)
                .map_or_else(|| json!(*discriminant), |case| json!(case.name)),
            ScVal::I32(discriminant) if *discriminant >= 0 => {
                #[allow(clippy::cast_sign_loss)]
                let discriminant = *discriminant as u32;
                enum_def
                    .cases
                    .iter()
                    .find(|case| case.value == discriminant)
                    .map_or_else(|| json!(*discriminant), |case| json!(case.name))
            }
            ScVal::Symbol(symbol) => json!(symbol.to_string()),
            ScVal::String(string) => json!(string.to_string()),
            ScVal::Vec(Some(values)) if !values.is_empty() => {
                let Some(variant_name) = variant_name(&values[0]) else {
                    return scval_to_json(val, None);
                };

                if !enum_def.cases.iter().any(|case| case.name == variant_name) {
                    return scval_to_json(val, None);
                }

                let payload: Vec<Value> = values[1..]
                    .iter()
                    .map(|v| scval_to_json(v, None))
                    .collect();
                match payload.as_slice() {
                    [] => json!(variant_name),
                    [value] => json!({ variant_name: value }),
                    _ => json!({ variant_name: payload }),
                }
            }
            _ => scval_to_json(val, None),
        }
    }

    /// Decodes an `Option` enum value, returning `{ "None": null }` or `{ "Some": value }`.
    pub fn decode_option(&self, val: &ScVal, _enum_def: &ContractEnumDef) -> Value {
        match val {
            ScVal::Void => json!({ "None": null }),
            ScVal::Vec(Some(values)) if !values.is_empty() => {
                if let Some(name) = variant_name(&values[0]) {
                    if name.eq_ignore_ascii_case("None") {
                        return json!({ "None": null });
                    }
                    if name.eq_ignore_ascii_case("Some") {
                        let inner = if values.len() > 1 {
                            scval_to_json(&values[1], None)
                        } else {
                            Value::Null
                        };
                        return json!({ "Some": inner });
                    }
                }
                json!({ "Some": scval_to_json(val, None) })
            }
            ScVal::Symbol(s) if s.to_string().eq_ignore_ascii_case("None") => {
                json!({ "None": null })
            }
            other => json!({ "Some": scval_to_json(other, None) }),
        }
    }

    /// Decodes a `Result` enum value, returning `{ "Ok": value }` or `{ "Err": error }`.
    pub fn decode_result(&self, val: &ScVal, _enum_def: &ContractEnumDef) -> Value {
        match val {
            ScVal::Error(err) => json!({ "Err": format!("{err:?}") }),
            ScVal::Vec(Some(values)) if !values.is_empty() => {
                if let Some(name) = variant_name(&values[0]) {
                    if name.eq_ignore_ascii_case("Err") {
                        let inner = if values.len() > 1 {
                            scval_to_json(&values[1], None)
                        } else {
                            Value::Null
                        };
                        return json!({ "Err": inner });
                    }
                    if name.eq_ignore_ascii_case("Ok") {
                        let inner = if values.len() > 1 {
                            scval_to_json(&values[1], None)
                        } else {
                            Value::Null
                        };
                        return json!({ "Ok": inner });
                    }
                }
                json!({ "Ok": scval_to_json(val, None) })
            }
            other => json!({ "Ok": scval_to_json(other, None) }),
        }
    }
}

fn variant_name(value: &ScVal) -> Option<String> {
    match value {
        ScVal::Symbol(symbol) => Some(symbol.to_string()),
        ScVal::String(string) => Some(string.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::decoder::{ContractEnumCase, ContractEnumDef};
    use stellar_xdr::curr::{ScSymbol, ScVec};

    fn enum_def() -> ContractEnumDef {
        ContractEnumDef {
            name: "Outcome".to_string(),
            cases: vec![
                ContractEnumCase {
                    name: "Success".to_string(),
                    value: 0,
                    doc: None,
                },
                ContractEnumCase {
                    name: "Error".to_string(),
                    value: 1,
                    doc: None,
                },
            ],
            doc: None,
        }
    }

    fn option_enum_def() -> ContractEnumDef {
        ContractEnumDef {
            name: "Option".to_string(),
            cases: vec![
                ContractEnumCase {
                    name: "None".to_string(),
                    value: 0,
                    doc: None,
                },
                ContractEnumCase {
                    name: "Some".to_string(),
                    value: 1,
                    doc: None,
                },
            ],
            doc: None,
        }
    }

    fn result_enum_def() -> ContractEnumDef {
        ContractEnumDef {
            name: "Result".to_string(),
            cases: vec![
                ContractEnumCase {
                    name: "Ok".to_string(),
                    value: 0,
                    doc: None,
                },
                ContractEnumCase {
                    name: "Err".to_string(),
                    value: 1,
                    doc: None,
                },
            ],
            doc: None,
        }
    }

    #[test]
    fn test_option_enum_decoding_none_and_some() {
        let decoder = EnumDecoder::new();
        let opt_def = option_enum_def();

        let none_val = ScVal::Void;
        let decoded_none = decoder.decode(&none_val, &opt_def);
        assert_eq!(decoded_none, json!({ "None": null }));

        let some_val = ScVal::U32(42);
        let decoded_some = decoder.decode(&some_val, &opt_def);
        assert_eq!(decoded_some, json!({ "Some": 42 }));
    }

    #[test]
    fn test_result_enum_decoding_ok_and_err() {
        let decoder = EnumDecoder::new();
        let res_def = result_enum_def();

        let ok_vec = ScVal::Vec(Some(
            vec![
                ScVal::Symbol(ScSymbol("Ok".try_into().unwrap())),
                ScVal::U32(100),
            ]
            .try_into()
            .unwrap(),
        ));
        let decoded_ok = decoder.decode(&ok_vec, &res_def);
        assert_eq!(decoded_ok, json!({ "Ok": 100 }));

        let err_vec = ScVal::Vec(Some(
            vec![
                ScVal::Symbol(ScSymbol("Err".try_into().unwrap())),
                ScVal::Symbol(ScSymbol("NotFound".try_into().unwrap())),
            ]
            .try_into()
            .unwrap(),
        ));
        let decoded_err = decoder.decode(&err_vec, &res_def);
        assert_eq!(decoded_err, json!({ "Err": "NotFound" }));
    }
}

    fn symbol(value: &str) -> ScVal {
        ScVal::Symbol(ScSymbol(value.try_into().unwrap()))
    }

    #[test]
    fn decodes_integer_discriminants_to_variant_names() {
        let decoder = EnumDecoder::new();
        assert_eq!(
            decoder.decode(&ScVal::U32(0), &enum_def()),
            json!("Success")
        );
        assert_eq!(decoder.decode(&ScVal::I32(1), &enum_def()), json!("Error"));
    }

    #[test]
    fn decodes_symbol_head_and_payload() {
        let value = ScVal::Vec(Some(ScVec(
            vec![symbol("Error"), ScVal::U32(42)].try_into().unwrap(),
        )));
        assert_eq!(
            EnumDecoder::new().decode(&value, &enum_def()),
            json!({ "Error": 42 })
        );
    }

    #[test]
    fn decodes_payload_free_symbol_head() {
        let value = ScVal::Vec(Some(ScVec(vec![symbol("Success")].try_into().unwrap())));
        assert_eq!(
            EnumDecoder::new().decode(&value, &enum_def()),
            json!("Success")
        );
    }

    #[test]
    fn preserves_unknown_discriminants_and_heads() {
        let decoder = EnumDecoder::new();
        assert_eq!(decoder.decode(&ScVal::U32(99), &enum_def()), json!(99));
        let unknown = ScVal::Vec(Some(ScVec(vec![symbol("Other")].try_into().unwrap())));
        assert_eq!(decoder.decode(&unknown, &enum_def()), json!(["Other"]));
    }
}

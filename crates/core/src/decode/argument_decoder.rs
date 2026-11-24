use crate::decode::function_call_decoder::DecodedArgument;
use crate::decode::return_decoder::ReturnValueDecoder;
use crate::spec::decoder::{ContractFunction, ContractSpec};
use serde_json::Value;
use stellar_xdr::curr::{ScSpecTypeDef, ScVal};

/// Decoder for contract function arguments, converting raw `ScVal` structures
/// into typed, human-readable `DecodedArgument` representations based on contract function parameter specifications.
#[derive(Debug, Clone, Default)]
pub struct ArgumentDecoder {
    return_decoder: ReturnValueDecoder,
}

impl ArgumentDecoder {
    /// Creates a new `ArgumentDecoder`.
    pub fn new() -> Self {
        Self {
            return_decoder: ReturnValueDecoder::new(),
        }
    }

    /// Decodes a list of raw `ScVal` arguments using a slice of parameter definitions `(name, type_def)`.
    ///
    /// Edge cases handled:
    /// - Extra arguments beyond parameter specs are decoded dynamically with fallback names `argN`.
    /// - Fewer arguments than parameter specs decode only the supplied arguments.
    /// - Type conflicts between the raw `ScVal` and the `ScSpecTypeDef` fall back to dynamic decoding.
    pub fn decode(
        &self,
        args: &[ScVal],
        param_defs: &[(String, ScSpecTypeDef)],
        contract_spec: Option<&ContractSpec>,
    ) -> Vec<DecodedArgument> {
        args.iter()
            .enumerate()
            .map(|(i, val)| {
                if let Some((param_name, type_def)) = param_defs.get(i) {
                    self.decode_single_argument(param_name, val, Some(type_def), contract_spec)
                } else {
                    let fallback_name = format!("arg{i}");
                    self.decode_single_argument(&fallback_name, val, None, contract_spec)
                }
            })
            .collect()
    }

    /// Decodes a list of raw `ScVal` arguments given a target `ContractFunction` spec.
    pub fn decode_function_args(
        &self,
        args: &[ScVal],
        func: &ContractFunction,
        contract_spec: Option<&ContractSpec>,
    ) -> Vec<DecodedArgument> {
        if func.param_defs.is_empty() {
            args.iter()
                .enumerate()
                .map(|(i, val)| {
                    let name = func
                        .params
                        .get(i)
                        .map_or_else(|| format!("arg{i}"), |(pname, _)| pname.clone());
                    self.decode_single_argument(&name, val, None, contract_spec)
                })
                .collect()
        } else {
            self.decode(args, &func.param_defs, contract_spec)
        }
    }

    /// Decodes raw `ScVal` arguments dynamically without parameter specifications.
    pub fn decode_dynamic(&self, args: &[ScVal]) -> Vec<DecodedArgument> {
        args.iter()
            .enumerate()
            .map(|(i, val)| {
                let name = format!("arg{i}");
                self.decode_single_argument(&name, val, None, None)
            })
            .collect()
    }

    /// Decodes a single `ScVal` argument into a `DecodedArgument`.
    pub fn decode_single_argument(
        &self,
        name: &str,
        val: &ScVal,
        type_def: Option<&ScSpecTypeDef>,
        contract_spec: Option<&ContractSpec>,
    ) -> DecodedArgument {
        let value = self.return_decoder.decode(val, type_def, contract_spec);
        let formatted = Self::format_value(&value);
        DecodedArgument {
            name: name.to_string(),
            value,
            formatted,
        }
    }

    /// Formats a decoded JSON value into a clean human-readable string representation.
    pub fn format_value(value: &Value) -> String {
        match value {
            Value::String(s) => s.clone(),
            Value::Null => "null".to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => n.to_string(),
            other => serde_json::to_string(other).unwrap_or_else(|_| other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::decoder::{ContractStructDef, ContractStructField};
    use serde_json::json;
    use stellar_xdr::curr::{Hash, ScAddress, ScMapEntry, ScString, ScSymbol, ScVal};

    fn sym(s: &str) -> ScVal {
        ScVal::Symbol(ScSymbol(s.try_into().unwrap()))
    }

    fn str_val(s: &str) -> ScVal {
        ScVal::String(ScString(s.try_into().unwrap()))
    }

    #[test]
    fn test_primitive_argument_decoding() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::U32(42), ScVal::Bool(true), sym("admin")];
        let param_defs = vec![
            ("amount".to_string(), ScSpecTypeDef::U32),
            ("active".to_string(), ScSpecTypeDef::Bool),
            ("role".to_string(), ScSpecTypeDef::Symbol),
        ];

        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded.len(), 3);

        assert_eq!(decoded[0].name, "amount");
        assert_eq!(decoded[0].value, json!(42));
        assert_eq!(decoded[0].formatted, "42");

        assert_eq!(decoded[1].name, "active");
        assert_eq!(decoded[1].value, json!(true));
        assert_eq!(decoded[1].formatted, "true");

        assert_eq!(decoded[2].name, "role");
        assert_eq!(decoded[2].value, json!("admin"));
        assert_eq!(decoded[2].formatted, "admin");
    }

    #[test]
    fn test_argument_count_mismatch_extra_arguments() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::U32(100), ScVal::I32(-5), sym("extra")];
        let param_defs = vec![("count".to_string(), ScSpecTypeDef::U32)];

        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded.len(), 3);

        assert_eq!(decoded[0].name, "count");
        assert_eq!(decoded[0].value, json!(100));

        assert_eq!(decoded[1].name, "arg1");
        assert_eq!(decoded[1].value, json!(-5));
        assert_eq!(decoded[1].formatted, "-5");

        assert_eq!(decoded[2].name, "arg2");
        assert_eq!(decoded[2].value, json!("extra"));
        assert_eq!(decoded[2].formatted, "extra");
    }

    #[test]
    fn test_argument_count_mismatch_fewer_arguments() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::U32(10)];
        let param_defs = vec![
            ("first".to_string(), ScSpecTypeDef::U32),
            ("second".to_string(), ScSpecTypeDef::String),
        ];

        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "first");
        assert_eq!(decoded[0].value, json!(10));
    }

    #[test]
    fn test_type_conflict_fallback() {
        let decoder = ArgumentDecoder::new();
        // Expecting U32, but provided a Symbol
        let args = vec![sym("not_a_number")];
        let param_defs = vec![("expected_num".to_string(), ScSpecTypeDef::U32)];

        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "expected_num");
        assert_eq!(decoded[0].value, json!("not_a_number"));
        assert_eq!(decoded[0].formatted, "not_a_number");
    }

    #[test]
    fn test_udt_struct_argument_decoding() {
        let decoder = ArgumentDecoder::new();
        let struct_def = ContractStructDef {
            name: "Recipient".to_string(),
            fields: vec![
                ContractStructField {
                    name: "address".to_string(),
                    type_name: "Address".to_string(),
                    doc: None,
                    type_def: Some(ScSpecTypeDef::Address),
                },
                ContractStructField {
                    name: "weight".to_string(),
                    type_name: "U32".to_string(),
                    doc: None,
                    type_def: Some(ScSpecTypeDef::U32),
                },
            ],
            doc: None,
        };

        let contract_spec = ContractSpec {
            errors: vec![],
            functions: vec![],
            structs: vec![struct_def],
            name: None,
            version: None,
            metadata: crate::spec::metadata::ContractMetadata::default(),
            enums: vec![],
            unions: vec![],
        };

        let addr = ScAddress::Contract(Hash([1u8; 32]));
        let map_val = ScVal::Map(Some(
            vec![
                ScMapEntry {
                    key: sym("address"),
                    val: ScVal::Address(addr.clone()),
                },
                ScMapEntry {
                    key: sym("weight"),
                    val: ScVal::U32(50),
                },
            ]
            .try_into()
            .unwrap(),
        ));

        let param_defs = vec![(
            "target".to_string(),
            ScSpecTypeDef::Udt(stellar_xdr::curr::ScSpecTypeUdt {
                name: "Recipient".try_into().unwrap(),
            }),
        )];

        let decoded = decoder.decode(&[map_val], &param_defs, Some(&contract_spec));
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "target");
        assert_eq!(
            decoded[0].value,
            json!({ "address": addr.to_string(), "weight": 50 })
        );
        assert!(decoded[0].formatted.contains("weight"));
    }

    #[test]
    fn test_decode_function_args_convenience() {
        let decoder = ArgumentDecoder::new();
        let func = ContractFunction {
            name: "transfer".to_string(),
            params: vec![
                ("to".to_string(), "Address".to_string()),
                ("amount".to_string(), "U128".to_string()),
            ],
            return_type: "Void".to_string(),
            doc: None,
            return_type_def: Some(ScSpecTypeDef::Void),
            param_defs: vec![
                ("to".to_string(), ScSpecTypeDef::Address),
                ("amount".to_string(), ScSpecTypeDef::U64),
            ],
        };

        let addr = ScAddress::Contract(Hash([2u8; 32]));
        let args = vec![ScVal::Address(addr.clone()), ScVal::U64(1000)];

        let decoded = decoder.decode_function_args(&args, &func, None);
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].name, "to");
        assert_eq!(decoded[0].value, json!(addr.to_string()));
        assert_eq!(decoded[1].name, "amount");
        assert_eq!(decoded[1].value, json!(1000));
    }

    #[test]
    fn test_decode_dynamic() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::U32(1), str_val("test")];
        let decoded = decoder.decode_dynamic(&args);

        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].name, "arg0");
        assert_eq!(decoded[0].value, json!(1));
        assert_eq!(decoded[1].name, "arg1");
        assert_eq!(decoded[1].value, json!("test"));
    }

    // ── i32 ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_i32_positive() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::I32(42)];
        let param_defs = vec![("val".to_string(), ScSpecTypeDef::I32)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(42));
        assert_eq!(decoded[0].formatted, "42");
    }

    #[test]
    fn test_decode_i32_negative() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::I32(-1)];
        let param_defs = vec![("val".to_string(), ScSpecTypeDef::I32)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(-1));
    }

    #[test]
    fn test_decode_i32_min_max() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::I32(i32::MIN), ScVal::I32(i32::MAX)];
        let param_defs = vec![
            ("min".to_string(), ScSpecTypeDef::I32),
            ("max".to_string(), ScSpecTypeDef::I32),
        ];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(i32::MIN));
        assert_eq!(decoded[1].value, json!(i32::MAX));
    }

    // ── i64 ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_i64() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::I64(-9_999_999_999_i64), ScVal::I64(i64::MAX)];
        let param_defs = vec![
            ("neg".to_string(), ScSpecTypeDef::I64),
            ("big".to_string(), ScSpecTypeDef::I64),
        ];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(-9_999_999_999_i64));
        assert_eq!(decoded[1].value, json!(i64::MAX));
    }

    // ── u64 ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_u64() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::U64(0), ScVal::U64(u64::MAX)];
        let param_defs = vec![
            ("zero".to_string(), ScSpecTypeDef::U64),
            ("max".to_string(), ScSpecTypeDef::U64),
        ];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(0u64));
        assert_eq!(decoded[1].value, json!(u64::MAX));
    }

    // ── u128 / i128 ─────────────────────────────────────────────────────────

    #[test]
    fn test_decode_u128() {
        use stellar_xdr::curr::UInt128Parts;
        let decoder = ArgumentDecoder::new();
        // Represent the value 2^64 (hi=1, lo=0).
        let args = vec![ScVal::U128(UInt128Parts { hi: 1, lo: 0 })];
        let param_defs = vec![("big".to_string(), ScSpecTypeDef::U128)];
        let decoded = decoder.decode(&args, &param_defs, None);
        // The decoded value should be a string representation of 2^64.
        let expected: u128 = 1u128 << 64;
        assert_eq!(decoded[0].value, json!(expected.to_string()));
    }

    #[test]
    fn test_decode_u128_zero() {
        use stellar_xdr::curr::UInt128Parts;
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::U128(UInt128Parts { hi: 0, lo: 0 })];
        let param_defs = vec![("z".to_string(), ScSpecTypeDef::U128)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!("0"));
    }

    #[test]
    fn test_decode_i128_negative() {
        use stellar_xdr::curr::Int128Parts;
        let decoder = ArgumentDecoder::new();
        // Represent -1 in two's complement 128-bit: hi = -1 (i64), lo = u64::MAX.
        let args = vec![ScVal::I128(Int128Parts {
            hi: -1_i64,
            lo: u64::MAX,
        })];
        let param_defs = vec![("neg".to_string(), ScSpecTypeDef::I128)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!("-1"));
    }

    // ── bool ────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_bool_true_false() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::Bool(true), ScVal::Bool(false)];
        let param_defs = vec![
            ("a".to_string(), ScSpecTypeDef::Bool),
            ("b".to_string(), ScSpecTypeDef::Bool),
        ];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(true));
        assert_eq!(decoded[0].formatted, "true");
        assert_eq!(decoded[1].value, json!(false));
        assert_eq!(decoded[1].formatted, "false");
    }

    // ── String ──────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_string() {
        let decoder = ArgumentDecoder::new();
        let args = vec![str_val("hello world")];
        let param_defs = vec![("msg".to_string(), ScSpecTypeDef::String)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!("hello world"));
        assert_eq!(decoded[0].formatted, "hello world");
    }

    #[test]
    fn test_decode_empty_string() {
        let decoder = ArgumentDecoder::new();
        let args = vec![str_val("")];
        let param_defs = vec![("empty".to_string(), ScSpecTypeDef::String)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(""));
        assert_eq!(decoded[0].formatted, "");
    }

    // ── Bytes ────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_bytes() {
        use stellar_xdr::curr::ScBytes;
        let decoder = ArgumentDecoder::new();
        let raw = vec![0xDE_u8, 0xAD, 0xBE, 0xEF];
        let args = vec![ScVal::Bytes(ScBytes(raw.clone().try_into().unwrap()))];
        let param_defs = vec![("data".to_string(), ScSpecTypeDef::Bytes)];
        let decoded = decoder.decode(&args, &param_defs, None);
        // Bytes are represented as a hex or array; just assert non-null value present.
        assert!(!decoded[0].value.is_null());
    }

    #[test]
    fn test_decode_empty_bytes() {
        use stellar_xdr::curr::ScBytes;
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::Bytes(ScBytes(vec![].try_into().unwrap()))];
        let param_defs = vec![("empty".to_string(), ScSpecTypeDef::Bytes)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].name, "empty");
        assert!(!decoded[0].value.is_null());
    }

    // ── Vec ──────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_vec_of_u32() {
        use stellar_xdr::curr::{ScSpecTypeVec, ScVec};
        let decoder = ArgumentDecoder::new();
        let inner = ScVec(
            vec![ScVal::U32(1), ScVal::U32(2), ScVal::U32(3)]
                .try_into()
                .unwrap(),
        );
        let args = vec![ScVal::Vec(Some(inner))];
        let param_defs = vec![(
            "items".to_string(),
            ScSpecTypeDef::Vec(Box::new(ScSpecTypeVec {
                element_type: Box::new(ScSpecTypeDef::U32),
            })),
        )];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].name, "items");
        assert!(decoded[0].value.is_array());
        let arr = decoded[0].value.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0], json!(1));
        assert_eq!(arr[1], json!(2));
        assert_eq!(arr[2], json!(3));
    }

    #[test]
    fn test_decode_empty_vec() {
        use stellar_xdr::curr::{ScSpecTypeVec, ScVec};
        let decoder = ArgumentDecoder::new();
        let inner = ScVec(vec![].try_into().unwrap());
        let args = vec![ScVal::Vec(Some(inner))];
        let param_defs = vec![(
            "empty_list".to_string(),
            ScSpecTypeDef::Vec(Box::new(ScSpecTypeVec {
                element_type: Box::new(ScSpecTypeDef::Bool),
            })),
        )];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert!(decoded[0].value.is_array());
        assert_eq!(decoded[0].value.as_array().unwrap().len(), 0);
    }

    // ── Map ──────────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_map() {
        use stellar_xdr::curr::{ScMapEntry, ScSpecTypeMap};
        let decoder = ArgumentDecoder::new();
        let map_val = ScVal::Map(Some(
            vec![
                ScMapEntry {
                    key: sym("foo"),
                    val: ScVal::U32(10),
                },
                ScMapEntry {
                    key: sym("bar"),
                    val: ScVal::U32(20),
                },
            ]
            .try_into()
            .unwrap(),
        ));
        let args = vec![map_val];
        let param_defs = vec![(
            "mapping".to_string(),
            ScSpecTypeDef::Map(Box::new(ScSpecTypeMap {
                key_type: Box::new(ScSpecTypeDef::Symbol),
                value_type: Box::new(ScSpecTypeDef::U32),
            })),
        )];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].name, "mapping");
        // Map may decode as object or array of pairs — just assert non-null.
        assert!(!decoded[0].value.is_null());
    }

    // ── Symbol ──────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_symbol() {
        let decoder = ArgumentDecoder::new();
        let args = vec![sym("transfer")];
        let param_defs = vec![("fn_name".to_string(), ScSpecTypeDef::Symbol)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!("transfer"));
        assert_eq!(decoded[0].formatted, "transfer");
    }

    #[test]
    fn test_decode_symbol_empty() {
        let decoder = ArgumentDecoder::new();
        let args = vec![sym("")];
        let param_defs = vec![("empty_sym".to_string(), ScSpecTypeDef::Symbol)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(""));
    }

    // ── Address ──────────────────────────────────────────────────────────────

    #[test]
    fn test_decode_contract_address() {
        let decoder = ArgumentDecoder::new();
        let addr = ScAddress::Contract(Hash([0xABu8; 32]));
        let args = vec![ScVal::Address(addr.clone())];
        let param_defs = vec![("contract".to_string(), ScSpecTypeDef::Address)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].name, "contract");
        assert_eq!(decoded[0].value, json!(addr.to_string()));
    }

    #[test]
    fn test_decode_account_address() {
        use stellar_xdr::curr::{AccountId, PublicKey};
        let decoder = ArgumentDecoder::new();
        let addr = ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(
            stellar_xdr::curr::Uint256([1u8; 32]),
        )));
        let args = vec![ScVal::Address(addr.clone())];
        let param_defs = vec![("account".to_string(), ScSpecTypeDef::Address)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].name, "account");
        assert!(!decoded[0].value.is_null());
    }

    // ── Nested types ─────────────────────────────────────────────────────────

    #[test]
    fn test_decode_nested_vec_of_bool() {
        use stellar_xdr::curr::{ScSpecTypeVec, ScVec};
        let decoder = ArgumentDecoder::new();
        // Outer Vec<Vec<bool>>
        let inner1 = ScVec(
            vec![ScVal::Bool(true), ScVal::Bool(false)]
                .try_into()
                .unwrap(),
        );
        let inner2 = ScVec(vec![ScVal::Bool(false)].try_into().unwrap());
        let outer = ScVec(
            vec![ScVal::Vec(Some(inner1)), ScVal::Vec(Some(inner2))]
                .try_into()
                .unwrap(),
        );
        let args = vec![ScVal::Vec(Some(outer))];
        let param_defs = vec![(
            "nested".to_string(),
            ScSpecTypeDef::Vec(Box::new(ScSpecTypeVec {
                element_type: Box::new(ScSpecTypeDef::Vec(Box::new(ScSpecTypeVec {
                    element_type: Box::new(ScSpecTypeDef::Bool),
                }))),
            })),
        )];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert!(decoded[0].value.is_array());
        let outer_arr = decoded[0].value.as_array().unwrap();
        assert_eq!(outer_arr.len(), 2);
        assert!(outer_arr[0].is_array());
        assert_eq!(outer_arr[0].as_array().unwrap().len(), 2);
        assert!(outer_arr[1].is_array());
        assert_eq!(outer_arr[1].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_decode_nested_map_with_vec_values() {
        use stellar_xdr::curr::{ScMapEntry, ScSpecTypeMap, ScSpecTypeVec, ScVec};
        let decoder = ArgumentDecoder::new();
        let vec_val = ScVec(vec![ScVal::U32(7), ScVal::U32(8)].try_into().unwrap());
        let map_val = ScVal::Map(Some(
            vec![ScMapEntry {
                key: sym("nums"),
                val: ScVal::Vec(Some(vec_val)),
            }]
            .try_into()
            .unwrap(),
        ));
        let args = vec![map_val];
        let param_defs = vec![(
            "data".to_string(),
            ScSpecTypeDef::Map(Box::new(ScSpecTypeMap {
                key_type: Box::new(ScSpecTypeDef::Symbol),
                value_type: Box::new(ScSpecTypeDef::Vec(Box::new(ScSpecTypeVec {
                    element_type: Box::new(ScSpecTypeDef::U32),
                }))),
            })),
        )];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert!(!decoded[0].value.is_null());
    }

    #[test]
    fn test_decode_option_some_u32() {
        use stellar_xdr::curr::ScSpecTypeOption;
        let decoder = ArgumentDecoder::new();
        // Option<U32> with a value — represented as a Vec with one element in XDR.
        let args = vec![ScVal::Vec(Some(
            stellar_xdr::curr::ScVec(vec![ScVal::U32(99)].try_into().unwrap()),
        ))];
        let param_defs = vec![(
            "opt".to_string(),
            ScSpecTypeDef::Option(Box::new(ScSpecTypeOption {
                value_type: Box::new(ScSpecTypeDef::U32),
            })),
        )];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].name, "opt");
        assert!(!decoded[0].value.is_null());
    }

    #[test]
    fn test_decode_void_scval() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::Void];
        let param_defs = vec![("nothing".to_string(), ScSpecTypeDef::Void)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded[0].value, json!(null));
    }

    // ── Error / malformed input cases ────────────────────────────────────────

    #[test]
    fn test_empty_args_empty_param_defs() {
        let decoder = ArgumentDecoder::new();
        let decoded = decoder.decode(&[], &[], None);
        assert!(decoded.is_empty());
    }

    #[test]
    fn test_empty_args_with_param_defs() {
        let decoder = ArgumentDecoder::new();
        let param_defs = vec![
            ("a".to_string(), ScSpecTypeDef::U32),
            ("b".to_string(), ScSpecTypeDef::String),
        ];
        let decoded = decoder.decode(&[], &param_defs, None);
        assert!(decoded.is_empty());
    }

    #[test]
    fn test_type_conflict_bool_given_u32_spec() {
        let decoder = ArgumentDecoder::new();
        let args = vec![ScVal::Bool(true)];
        let param_defs = vec![("count".to_string(), ScSpecTypeDef::U32)];
        let decoded = decoder.decode(&args, &param_defs, None);
        // Falls back to dynamic decoding — should not panic, should produce a value.
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "count");
        assert!(!decoded[0].formatted.is_empty());
    }

    #[test]
    fn test_type_conflict_string_given_address_spec() {
        let decoder = ArgumentDecoder::new();
        let args = vec![str_val("not_an_address")];
        let param_defs = vec![("addr".to_string(), ScSpecTypeDef::Address)];
        let decoded = decoder.decode(&args, &param_defs, None);
        assert_eq!(decoded.len(), 1);
        // Fallback to dynamic — value is a string representation.
        assert_eq!(decoded[0].value, json!("not_an_address"));
    }

    #[test]
    fn test_format_value_null() {
        assert_eq!(ArgumentDecoder::format_value(&json!(null)), "null");
    }

    #[test]
    fn test_format_value_number() {
        assert_eq!(ArgumentDecoder::format_value(&json!(123)), "123");
    }

    #[test]
    fn test_format_value_string() {
        assert_eq!(
            ArgumentDecoder::format_value(&json!("hello")),
            "hello"
        );
    }

    #[test]
    fn test_format_value_object() {
        let obj = json!({"key": "val"});
        let formatted = ArgumentDecoder::format_value(&obj);
        assert!(formatted.contains("key"));
        assert!(formatted.contains("val"));
    }

    #[test]
    fn test_decode_function_args_no_param_defs() {
        let decoder = ArgumentDecoder::new();
        let func = ContractFunction {
            name: "bare".to_string(),
            params: vec![
                ("x".to_string(), "U32".to_string()),
                ("y".to_string(), "Symbol".to_string()),
            ],
            return_type: "Void".to_string(),
            doc: None,
            return_type_def: Some(ScSpecTypeDef::Void),
            param_defs: vec![],
        };
        let args = vec![ScVal::U32(5), sym("hello")];
        let decoded = decoder.decode_function_args(&args, &func, None);
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].name, "x");
        assert_eq!(decoded[1].name, "y");
    }

    #[test]
    fn test_decode_function_args_more_args_than_params() {
        let decoder = ArgumentDecoder::new();
        let func = ContractFunction {
            name: "partial".to_string(),
            params: vec![("a".to_string(), "U32".to_string())],
            return_type: "Void".to_string(),
            doc: None,
            return_type_def: Some(ScSpecTypeDef::Void),
            param_defs: vec![],
        };
        let args = vec![ScVal::U32(1), ScVal::U32(2), ScVal::U32(3)];
        let decoded = decoder.decode_function_args(&args, &func, None);
        // Extra args get positional fallback names.
        assert_eq!(decoded.len(), 3);
        assert_eq!(decoded[0].name, "a");
        assert_eq!(decoded[1].name, "arg1");
        assert_eq!(decoded[2].name, "arg2");
    }
}

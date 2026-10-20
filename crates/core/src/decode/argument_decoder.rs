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
        if let Some(ScSpecTypeDef::Option(opt_spec)) = type_def {
            let (value, formatted) = match val {
                ScVal::Void => (serde_json::json!({ "None": null }), "None".to_string()),
                _ => {
                    let inner = self.return_decoder.decode(val, Some(&opt_spec.value_type), contract_spec);
                    let formatted_inner = Self::format_value(&inner);
                    (serde_json::json!({ "Some": inner }), format!("Some({formatted_inner})"))
                }
            };
            return DecodedArgument {
                name: name.to_string(),
                value,
                formatted,
            };
        }

        if let Some(ScSpecTypeDef::Result(res_spec)) = type_def {
            let (value, formatted) = match val {
                ScVal::Error(err) => {
                    let err_str = format!("{err:?}");
                    (serde_json::json!({ "Err": err_str }), format!("Err({err_str})"))
                }
                _ => {
                    let inner = self.return_decoder.decode(val, Some(&res_spec.ok_type), contract_spec);
                    let formatted_inner = Self::format_value(&inner);
                    (serde_json::json!({ "Ok": inner }), format!("Ok({formatted_inner})"))
                }
            };
            return DecodedArgument {
                name: name.to_string(),
                value,
                formatted,
            };
        }

        if let Some(ScSpecTypeDef::Udt(udt)) = type_def {
            if let Some(spec) = contract_spec {
                if let Some(enum_def) = spec.find_enum(&udt.name) {
                    if crate::decode::enum_decoder::EnumDecoder::is_option_enum(enum_def) {
                        let value = crate::decode::enum_decoder::EnumDecoder::new().decode_option(val, enum_def);
                        let formatted = Self::format_value(&value);
                        return DecodedArgument {
                            name: name.to_string(),
                            value,
                            formatted,
                        };
                    }
                    if crate::decode::enum_decoder::EnumDecoder::is_result_enum(enum_def) {
                        let value = crate::decode::enum_decoder::EnumDecoder::new().decode_result(val, enum_def);
                        let formatted = Self::format_value(&value);
                        return DecodedArgument {
                            name: name.to_string(),
                            value,
                            formatted,
                        };
                    }
                }
            }
        }

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
            Value::Object(map) if map.len() == 1 => {
                if let Some((k, v)) = map.iter().next() {
                    if k == "Some" {
                        return format!("Some({})", Self::format_value(v));
                    }
                    if k == "None" {
                        return "None".to_string();
                    }
                    if k == "Ok" {
                        return format!("Ok({})", Self::format_value(v));
                    }
                    if k == "Err" {
                        return format!("Err({})", Self::format_value(v));
                    }
                }
                serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
            }
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

    #[test]
    fn test_option_argument_decoding() {
        use stellar_xdr::curr::ScSpecTypeOption;

        let decoder = ArgumentDecoder::new();
        let param_defs = vec![
            (
                "maybe_amount".to_string(),
                ScSpecTypeDef::Option(Box::new(ScSpecTypeOption {
                    value_type: Box::new(ScSpecTypeDef::U32),
                })),
            ),
        ];

        // None case (Void)
        let decoded_none = decoder.decode(&[ScVal::Void], &param_defs, None);
        assert_eq!(decoded_none.len(), 1);
        assert_eq!(decoded_none[0].name, "maybe_amount");
        assert_eq!(decoded_none[0].value, json!({ "None": null }));
        assert_eq!(decoded_none[0].formatted, "None");

        // Some case (U32)
        let decoded_some = decoder.decode(&[ScVal::U32(500)], &param_defs, None);
        assert_eq!(decoded_some.len(), 1);
        assert_eq!(decoded_some[0].name, "maybe_amount");
        assert_eq!(decoded_some[0].value, json!({ "Some": 500 }));
        assert_eq!(decoded_some[0].formatted, "Some(500)");
    }

    #[test]
    fn test_result_argument_decoding() {
        use stellar_xdr::curr::ScSpecTypeResult;

        let decoder = ArgumentDecoder::new();
        let param_defs = vec![
            (
                "outcome".to_string(),
                ScSpecTypeDef::Result(Box::new(ScSpecTypeResult {
                    ok_type: Box::new(ScSpecTypeDef::String),
                    error_type: Box::new(ScSpecTypeDef::U32),
                })),
            ),
        ];

        // Ok case
        let decoded_ok = decoder.decode(&[str_val("success_token")], &param_defs, None);
        assert_eq!(decoded_ok.len(), 1);
        assert_eq!(decoded_ok[0].name, "outcome");
        assert_eq!(decoded_ok[0].value, json!({ "Ok": "success_token" }));
        assert_eq!(decoded_ok[0].formatted, "Ok(success_token)");
    }
}

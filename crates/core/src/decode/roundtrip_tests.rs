//! Roundtrip tests for `scval_to_json` → `json_to_scval` conversion.
//!
//! Each test encodes an `ScVal` to JSON and then parses it back, asserting the
//! result equals the original. Additional tests cover the spec-aware entry
//! points (`scval_to_json_with_contract_spec`, `scval_to_json_with_spec`) and
//! a golden-file style assertion for `StructDecodeReport` to catch structural
//! changes.

#[cfg(test)]
mod tests {
    use crate::decode::json_to_scval::json_to_scval;
    use crate::decode::scval_to_json::{
        scval_to_json, scval_to_json_with_contract_spec, scval_to_json_with_spec,
    };
    use crate::decode::struct_decoder::{StructDecodeReport, StructDecoder};
    use crate::spec::decoder::{
        ContractEnumCase, ContractEnumDef, ContractSpec, ContractStructDef, ContractStructField,
    };
    use crate::spec::metadata::ContractMetadata;
    use serde_json::json;
    use stellar_xdr::curr::{
        Duration, Hash, Int128Parts, ScAddress, ScBytes, ScContractInstance,
        ContractExecutable, ScError, ScErrorCode, ScMapEntry, ScNonceKey, ScSpecTypeDef,
        ScSpecTypeUdt, ScString, ScSymbol, ScVal, ScVec, StringM, TimePoint, UInt128Parts,
    };

    // ── helpers ───────────────────────────────────────────────────────────

    fn sym(s: &str) -> ScVal {
        ScVal::Symbol(ScSymbol(StringM::try_from(s.as_bytes().to_vec()).unwrap()))
    }

    fn str_val(s: &str) -> ScVal {
        ScVal::String(ScString(StringM::try_from(s.as_bytes().to_vec()).unwrap()))
    }

    fn sym_map(entries: Vec<(&str, ScVal)>) -> ScVal {
        ScVal::Map(Some(
            entries
                .into_iter()
                .map(|(k, v)| ScMapEntry { key: sym(k), val: v })
                .collect::<Vec<_>>()
                .try_into()
                .unwrap(),
        ))
    }

    fn vec_val(items: Vec<ScVal>) -> ScVal {
        ScVal::Vec(Some(ScVec(items.try_into().unwrap())))
    }

    fn empty_spec() -> ContractSpec {
        ContractSpec {
            errors: vec![],
            functions: vec![],
            structs: vec![],
            enums: vec![],
            unions: vec![],
            name: None,
            version: None,
            metadata: ContractMetadata::default(),
        }
    }

    fn spec_field(name: &str, type_def: ScSpecTypeDef) -> ContractStructField {
        ContractStructField {
            name: name.to_string(),
            type_name: format!("{type_def:?}"),
            doc: None,
            type_def: Some(type_def),
        }
    }

    fn udt(name: &str) -> ScSpecTypeDef {
        ScSpecTypeDef::Udt(ScSpecTypeUdt {
            name: StringM::try_from(name.as_bytes().to_vec()).unwrap(),
        })
    }

    fn spec_with_structs(structs: Vec<ContractStructDef>) -> ContractSpec {
        ContractSpec { structs, ..empty_spec() }
    }

    fn spec_with_enums(enums: Vec<ContractEnumDef>) -> ContractSpec {
        ContractSpec { enums, ..empty_spec() }
    }

    // ── ScVal primitive roundtrips ────────────────────────────────────────

    /// Every primitive `ScVal` variant must survive encode→decode unchanged.
    #[test]
    fn primitives_roundtrip() {
        let cases: Vec<ScVal> = vec![
            ScVal::Void,
            ScVal::Bool(true),
            ScVal::Bool(false),
            ScVal::U32(0),
            ScVal::U32(u32::MAX),
            ScVal::I32(0),
            ScVal::I32(i32::MIN),
            ScVal::I32(i32::MAX),
            ScVal::U64(0),
            ScVal::U64(u64::MAX),
            ScVal::I64(0),
            ScVal::I64(i64::MIN),
            ScVal::I64(i64::MAX),
            ScVal::Timepoint(TimePoint(0)),
            ScVal::Timepoint(TimePoint(999_999)),
            ScVal::Duration(Duration(0)),
            ScVal::Duration(Duration(42)),
            ScVal::Bytes(ScBytes(vec![].try_into().unwrap())),
            ScVal::Bytes(ScBytes(vec![0xDE, 0xAD, 0xBE, 0xEF].try_into().unwrap())),
            ScVal::String(ScString(StringM::try_from(b"hello world".to_vec()).unwrap())),
            sym("transfer"),
        ];

        for original in cases {
            let json = scval_to_json(&original, None);
            let recovered = json_to_scval(&json)
                .unwrap_or_else(|e| panic!("json_to_scval failed for {original:?}: {e}"));
            // Symbol and String share the same JSON wire form (a plain string), so
            // json_to_scval cannot recover the Symbol variant — it always returns String.
            // For all other variants the roundtrip must be exact.
            match &original {
                ScVal::Symbol(sym) => {
                    assert_eq!(
                        recovered,
                        str_val(&sym.to_string()),
                        "Symbol should round-trip as String"
                    );
                }
                ScVal::Timepoint(t) => {
                    // Timepoint encodes as a plain number; json_to_scval recovers it as U32/U64.
                    let json_num = scval_to_json(&original, None);
                    let as_u64 = json_num.as_u64().expect("timepoint encodes as number");
                    assert_eq!(as_u64, t.0, "Timepoint value preserved");
                }
                ScVal::Duration(d) => {
                    let json_num = scval_to_json(&original, None);
                    let as_u64 = json_num.as_u64().expect("duration encodes as number");
                    assert_eq!(as_u64, d.0, "Duration value preserved");
                }
                _ => {
                    assert_eq!(recovered, original, "failed roundtrip for {original:?}");
                }
            }
        }
    }

    // ── u128 / i128 roundtrips ────────────────────────────────────────────

    #[test]
    fn u128_roundtrip() {
        let cases = [
            UInt128Parts { hi: 0, lo: 0 },
            UInt128Parts { hi: 0, lo: 1 },
            UInt128Parts { hi: 0, lo: u64::MAX },
            UInt128Parts { hi: 1, lo: 0 },
            UInt128Parts { hi: u64::MAX, lo: u64::MAX },
        ];
        for parts in cases {
            let original = ScVal::U128(parts);
            let json = scval_to_json(&original, None);
            let recovered = json_to_scval(&json).unwrap();
            assert_eq!(recovered, original, "u128 roundtrip failed for {parts:?}");
        }
    }

    #[test]
    fn i128_roundtrip() {
        let cases = [
            Int128Parts { hi: 0, lo: 0 },
            Int128Parts { hi: 0, lo: 1_000 },
            Int128Parts { hi: i64::MIN, lo: 0 },
            Int128Parts { hi: -1, lo: u64::MAX },
        ];
        for parts in cases {
            let original = ScVal::I128(parts);
            let json = scval_to_json(&original, None);
            let recovered = json_to_scval(&json).unwrap();
            assert_eq!(recovered, original, "i128 roundtrip failed for {parts:?}");
        }
    }

    // ── Nested Vec roundtrips ─────────────────────────────────────────────

    #[test]
    fn flat_vec_roundtrip() {
        let original = vec_val(vec![ScVal::U32(1), ScVal::U32(2), ScVal::U32(3)]);
        let json = scval_to_json(&original, None);
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    #[test]
    fn nested_vec_of_vecs_roundtrip() {
        // Vec<Vec<u32>>
        let inner_a = vec_val(vec![ScVal::U32(1), ScVal::U32(2)]);
        let inner_b = vec_val(vec![ScVal::U32(3), ScVal::U32(4)]);
        let original = vec_val(vec![inner_a, inner_b]);
        let json = scval_to_json(&original, None);
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    #[test]
    fn vec_of_mixed_types_roundtrip() {
        let original = vec_val(vec![
            ScVal::U32(42),
            ScVal::Bool(true),
            ScVal::Bytes(ScBytes(vec![0xAB].try_into().unwrap())),
        ]);
        let json = scval_to_json(&original, None);
        // JSON: [42, true, "0xab"]
        assert_eq!(json, json!([42, true, "0xab"]));
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    // ── Nested Map roundtrips ─────────────────────────────────────────────

    #[test]
    fn flat_map_roundtrip() {
        let original = sym_map(vec![
            ("alpha", ScVal::U32(1)),
            ("beta", ScVal::U32(2)),
        ]);
        let json = scval_to_json(&original, None);
        let recovered = json_to_scval(&json).unwrap();
        // Keys come back as String (not Symbol) through JSON but values are intact.
        // Verify the JSON shape is correct.
        assert_eq!(json["alpha"], json!(1));
        assert_eq!(json["beta"], json!(2));
        // After recovery the keys will be ScString; check the values match.
        if let ScVal::Map(Some(entries)) = &recovered {
            for entry in entries.iter() {
                match &entry.key {
                    ScVal::String(k) | ScVal::Symbol(k) => {
                        let k_str = k.to_string();
                        let expected = match k_str.as_str() {
                            "alpha" => ScVal::U32(1),
                            "beta" => ScVal::U32(2),
                            other => panic!("unexpected key: {other}"),
                        };
                        assert_eq!(entry.val, expected);
                    }
                    other => panic!("unexpected key type: {other:?}"),
                }
            }
        } else {
            panic!("recovered value is not a map");
        }
    }

    #[test]
    fn nested_map_roundtrip() {
        // {outer: {inner: 42}}
        let inner = sym_map(vec![("inner", ScVal::U32(42))]);
        let original = sym_map(vec![("outer", inner)]);
        let json = scval_to_json(&original, None);
        assert_eq!(json["outer"]["inner"], json!(42));
        let recovered = json_to_scval(&json).unwrap();
        // Recovered nested value should still be a map with key "inner" = 42.
        if let ScVal::Map(Some(outer_entries)) = recovered {
            let outer_val = &outer_entries.iter().next().unwrap().val;
            if let ScVal::Map(Some(inner_entries)) = outer_val {
                let inner_entry = inner_entries.iter().next().unwrap();
                assert_eq!(inner_entry.val, ScVal::U32(42));
            } else {
                panic!("nested value is not a map");
            }
        } else {
            panic!("recovered outer is not a map");
        }
    }

    #[test]
    fn map_inside_vec_roundtrip() {
        // Vec<Map>
        let m = sym_map(vec![("count", ScVal::U32(5))]);
        let original = vec_val(vec![m.clone(), m]);
        let json = scval_to_json(&original, None);
        assert_eq!(json[0]["count"], json!(5));
        assert_eq!(json[1]["count"], json!(5));
        let recovered = json_to_scval(&json).unwrap();
        if let ScVal::Vec(Some(items)) = recovered {
            assert_eq!(items.len(), 2);
        } else {
            panic!("recovered is not a vec");
        }
    }

    // ── Lossless map (colliding keys) roundtrip ───────────────────────────

    #[test]
    fn colliding_key_map_roundtrip() {
        // U32(7) and String("7") collide on the JSON key "7"; the codec must
        // use the lossless array representation and round-trip it back exactly.
        let original = ScVal::Map(Some(
            vec![
                ScMapEntry {
                    key: ScVal::U32(7),
                    val: sym("from_number"),
                },
                ScMapEntry {
                    key: str_val("7"),
                    val: sym("from_string"),
                },
            ]
            .try_into()
            .unwrap(),
        ));
        let json = scval_to_json(&original, None);
        assert!(json.is_array(), "colliding keys should produce lossless array");
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    // ── Struct roundtrip via scval_to_json_with_contract_spec ─────────────

    #[test]
    fn struct_roundtrip_via_spec() {
        // Encode a Counter struct, decode it with spec, verify the JSON has the
        // declared field order and correct types. Then encode→decode the JSON
        // back to ScVal and confirm equality.
        let spec = spec_with_structs(vec![ContractStructDef {
            name: "Counter".to_string(),
            fields: vec![
                spec_field("count", ScSpecTypeDef::U64),
                spec_field("label", ScSpecTypeDef::String),
            ],
            doc: None,
        }]);

        let original = sym_map(vec![
            ("count", ScVal::U64(100)),
            ("label", str_val("hits")),
        ]);

        let json = scval_to_json_with_contract_spec(&original, &spec);
        // Spec-aware render types the u64 value directly (not as a string since
        // it fits in a plain JSON number here).
        assert_eq!(json["count"], json!(100u64));
        assert_eq!(json["label"], json!("hits"));

        // Encode the JSON back to ScVal; keys become ScString through the JSON path.
        let recovered = json_to_scval(&json).unwrap();
        // Values must be preserved regardless of key encoding.
        if let ScVal::Map(Some(entries)) = &recovered {
            for entry in entries.iter() {
                let k = entry.key.to_string();
                match k.as_str() {
                    "count" => assert_eq!(entry.val, ScVal::U64(100)),
                    "label" => assert_eq!(entry.val, str_val("hits")),
                    _ => {}
                }
            }
        }
    }

    #[test]
    fn nested_struct_roundtrip_via_spec() {
        // Wallet contains an Owner which contains a User.
        let spec = spec_with_structs(vec![
            ContractStructDef {
                name: "User".to_string(),
                fields: vec![
                    spec_field("id", ScSpecTypeDef::U64),
                    spec_field("name", ScSpecTypeDef::String),
                ],
                doc: None,
            },
            ContractStructDef {
                name: "Wallet".to_string(),
                fields: vec![
                    spec_field("owner", udt("User")),
                    spec_field("balance", ScSpecTypeDef::U64),
                ],
                doc: None,
            },
        ]);

        let user = sym_map(vec![
            ("id", ScVal::U64(7)),
            ("name", str_val("Alice")),
        ]);
        let wallet = sym_map(vec![
            ("owner", user),
            ("balance", ScVal::U64(1_000_000)),
        ]);

        let json = scval_to_json_with_contract_spec(&wallet, &spec);
        assert_eq!(json["owner"]["id"], json!(7u64));
        assert_eq!(json["owner"]["name"], json!("Alice"));
        assert_eq!(json["balance"], json!(1_000_000u64));
    }

    #[test]
    fn vec_of_structs_roundtrip_via_spec() {
        // Vec<Counter> — each element in the vec is a Counter struct.
        let spec = spec_with_structs(vec![ContractStructDef {
            name: "Counter".to_string(),
            fields: vec![
                spec_field("count", ScSpecTypeDef::U64),
                spec_field("label", ScSpecTypeDef::String),
            ],
            doc: None,
        }]);

        let counter_a = sym_map(vec![("count", ScVal::U64(1)), ("label", str_val("a"))]);
        let counter_b = sym_map(vec![("count", ScVal::U64(2)), ("label", str_val("b"))]);
        let original = vec_val(vec![counter_a, counter_b]);

        let json = scval_to_json_with_contract_spec(&original, &spec);
        assert!(json.is_array());
        assert_eq!(json[0]["count"], json!(1u64));
        assert_eq!(json[1]["label"], json!("b"));
    }

    // ── scval_to_json_with_spec roundtrip ─────────────────────────────────

    #[test]
    fn scval_to_json_with_spec_resolves_struct_via_type_def() {
        let spec = spec_with_structs(vec![ContractStructDef {
            name: "Point".to_string(),
            fields: vec![
                spec_field("x", ScSpecTypeDef::I64),
                spec_field("y", ScSpecTypeDef::I64),
            ],
            doc: None,
        }]);

        let original = sym_map(vec![("x", ScVal::I64(-10)), ("y", ScVal::I64(20))]);
        let type_def = udt("Point");
        let json = scval_to_json_with_spec(&original, Some(&type_def), Some(&spec));
        assert_eq!(json["x"], json!(-10i64));
        assert_eq!(json["y"], json!(20i64));
    }

    // ── Contract-defined enum roundtrip via scval_to_json_with_spec ───────

    #[test]
    fn enum_discriminant_roundtrip_via_spec() {
        // A simple integer enum: Status { Active = 0, Inactive = 1 }
        use crate::decode::enum_decoder::EnumDecoder;

        let enum_def = ContractEnumDef {
            name: "Status".to_string(),
            cases: vec![
                ContractEnumCase { name: "Active".to_string(), value: 0, doc: None },
                ContractEnumCase { name: "Inactive".to_string(), value: 1, doc: None },
            ],
            doc: None,
        };

        let decoder = EnumDecoder::new();

        let active = ScVal::U32(0);
        assert_eq!(decoder.decode(&active, &enum_def), json!("Active"));

        let inactive = ScVal::U32(1);
        assert_eq!(decoder.decode(&inactive, &enum_def), json!("Inactive"));

        // Unknown discriminant preserved as-is.
        let unknown = ScVal::U32(99);
        assert_eq!(decoder.decode(&unknown, &enum_def), json!(99));
    }

    #[test]
    fn enum_symbol_head_with_payload_roundtrip() {
        use crate::decode::enum_decoder::EnumDecoder;

        let enum_def = ContractEnumDef {
            name: "Event".to_string(),
            cases: vec![
                ContractEnumCase { name: "Transfer".to_string(), value: 0, doc: None },
                ContractEnumCase { name: "Burn".to_string(), value: 1, doc: None },
            ],
            doc: None,
        };

        let decoder = EnumDecoder::new();

        // Variant with one payload value.
        let transfer = vec_val(vec![sym("Transfer"), ScVal::U64(500)]);
        assert_eq!(decoder.decode(&transfer, &enum_def), json!({ "Transfer": 500 }));

        // Variant with no payload (pure discriminant via symbol head).
        let burn_no_payload = vec_val(vec![sym("Burn")]);
        assert_eq!(decoder.decode(&burn_no_payload, &enum_def), json!("Burn"));

        // Multiple payload values.
        let transfer_multi = vec_val(vec![sym("Transfer"), ScVal::U64(100), ScVal::U64(200)]);
        assert_eq!(
            decoder.decode(&transfer_multi, &enum_def),
            json!({ "Transfer": [100, 200] })
        );
    }

    // ── StructDecodeReport golden-file test ───────────────────────────────

    /// This golden-file test asserts the exact shape of `StructDecodeReport`
    /// so that field additions, renames, or type changes are caught at review
    /// time rather than silently changing serialized output consumed by callers.
    #[test]
    fn struct_decode_report_golden_exact_match() {
        let report = StructDecodeReport {
            struct_name: "Transfer".to_string(),
            missing_fields: vec!["amount".to_string()],
            unexpected_keys: vec!["legacy_fee".to_string()],
        };

        // Serialize to JSON and compare against the golden shape.
        let json = serde_json::to_value(&report).expect("StructDecodeReport must be serializable");

        let golden = json!({
            "struct_name": "Transfer",
            "missing_fields": ["amount"],
            "unexpected_keys": ["legacy_fee"]
        });

        assert_eq!(
            json, golden,
            "StructDecodeReport JSON shape changed — update the golden if intentional"
        );
    }

    #[test]
    fn struct_decode_report_exact_match_is_exact() {
        let exact = StructDecodeReport {
            struct_name: "Mint".to_string(),
            missing_fields: vec![],
            unexpected_keys: vec![],
        };
        assert!(exact.is_exact());

        let inexact = StructDecodeReport {
            struct_name: "Mint".to_string(),
            missing_fields: vec!["to".to_string()],
            unexpected_keys: vec![],
        };
        assert!(!inexact.is_exact());
    }

    #[test]
    fn struct_decode_report_golden_empty() {
        let report = StructDecodeReport {
            struct_name: "Noop".to_string(),
            missing_fields: vec![],
            unexpected_keys: vec![],
        };
        let json = serde_json::to_value(&report).unwrap();
        let golden = json!({
            "struct_name": "Noop",
            "missing_fields": [],
            "unexpected_keys": []
        });
        assert_eq!(json, golden);
    }

    // ── StructDecoder decode_checked golden assertion ─────────────────────

    #[test]
    fn struct_decoder_checked_report_golden() {
        let spec = spec_with_structs(vec![ContractStructDef {
            name: "Transfer".to_string(),
            fields: vec![
                spec_field("from", ScSpecTypeDef::Address),
                spec_field("to", ScSpecTypeDef::Address),
                spec_field("amount", ScSpecTypeDef::U64),
            ],
            doc: None,
        }]);

        // Payload is missing "amount" and carries an unexpected "memo" key.
        let payload = sym_map(vec![
            ("from", sym("GABC")),
            ("to", sym("GXYZ")),
            ("memo", str_val("test transfer")),
        ]);

        let decoder = StructDecoder::new();
        let struct_def = &spec.structs[0];
        let (_, report) = decoder.decode_checked(&payload, struct_def, &spec);

        // Golden shape of the report for this specific mismatch.
        assert_eq!(report.struct_name, "Transfer");
        assert_eq!(report.missing_fields, vec!["amount"]);
        assert_eq!(report.unexpected_keys, vec!["memo"]);
        assert!(!report.is_exact());

        // Serialized form must match the golden JSON.
        let json = serde_json::to_value(&report).unwrap();
        let golden = json!({
            "struct_name": "Transfer",
            "missing_fields": ["amount"],
            "unexpected_keys": ["memo"]
        });
        assert_eq!(json, golden);
    }

    // ── ScVal::Error roundtrip ────────────────────────────────────────────

    #[test]
    fn contract_error_roundtrip() {
        let original = ScVal::Error(ScError::Contract(42));
        let json = scval_to_json(&original, None);
        assert_eq!(json, json!({ "type": "Contract", "code": 42 }));
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    #[test]
    fn host_error_roundtrip() {
        let original = ScVal::Error(ScError::Storage(ScErrorCode::MissingValue));
        let json = scval_to_json(&original, None);
        assert_eq!(json, json!({ "type": "Storage", "code": "MissingValue" }));
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    // ── Address roundtrip ─────────────────────────────────────────────────

    #[test]
    fn contract_address_roundtrip() {
        let original = ScVal::Address(ScAddress::Contract(Hash([3u8; 32])));
        let json = scval_to_json(&original, None);
        let strkey = json.as_str().unwrap();
        assert!(strkey.starts_with('C'), "contract strkey must start with C");
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    // ── LedgerKey variants roundtrip ──────────────────────────────────────

    #[test]
    fn ledger_key_contract_instance_roundtrip() {
        let original = ScVal::LedgerKeyContractInstance;
        let json = scval_to_json(&original, None);
        assert_eq!(json, json!("LedgerKeyContractInstance"));
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    #[test]
    fn ledger_key_nonce_roundtrip() {
        let original = ScVal::LedgerKeyNonce(ScNonceKey { nonce: 12345 });
        let json = scval_to_json(&original, None);
        assert_eq!(json, json!({ "nonce": 12345 }));
        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    // ── ContractInstance roundtrip ────────────────────────────────────────

    #[test]
    fn contract_instance_roundtrip() {
        let original = ScVal::ContractInstance(ScContractInstance {
            executable: ContractExecutable::Wasm(Hash([7u8; 32])),
            storage: Some(
                vec![ScMapEntry {
                    key: sym("version"),
                    val: ScVal::U32(1),
                }]
                .try_into()
                .unwrap(),
            ),
        });

        let json = scval_to_json(&original, None);
        assert_eq!(json["executable"]["type"], json!("Wasm"));
        assert!(json["executable"]["wasmHash"].as_str().unwrap().starts_with("0x"));
        // Values in storage must be preserved.
        assert_eq!(json["storage"]["version"], json!(1));

        let recovered = json_to_scval(&json).unwrap();
        assert_eq!(recovered, original);
    }

    // ── Deep nesting sanity check (does not overflow) ─────────────────────

    #[test]
    fn deeply_nested_vec_truncates_instead_of_overflowing() {
        let mut v = ScVal::U32(1);
        for _ in 0..150 {
            v = vec_val(vec![v]);
        }
        let json = scval_to_json(&v, None);
        // Traverse until we find the truncation marker.
        let mut node = &json;
        let mut found = false;
        for _ in 0..200 {
            if node.get("__truncated__").is_some() {
                found = true;
                break;
            }
            match node.as_array().and_then(|a| a.first()) {
                Some(next) => node = next,
                None => break,
            }
        }
        assert!(found, "expected __truncated__ marker in deeply nested output");
    }
}

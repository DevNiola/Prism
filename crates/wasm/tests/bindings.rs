#![cfg(target_arch = "wasm32")]

use grat_wasm::{decode_error, resolve_contract_error, version};
use serde_json::Value;
use wasm_bindgen_test::wasm_bindgen_test;

wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn decode_error_returns_a_report_for_sample_input() {
    let result = decode_error(r#"{"errorType":"Budget","errorCode":1}"#)
        .expect("valid transaction input should decode");
    let report: Value = serde_wasm_bindgen::from_value(result)
        .expect("the returned JS value should serialize as a report");

    assert!(report.is_object());
}

#[wasm_bindgen_test]
fn decode_error_rejects_invalid_json() {
    let error = decode_error("not json").expect_err("invalid JSON should be rejected");

    assert!(error.as_string().is_some_and(|message| {
        message.contains("invalid JSON input")
    }));
}

#[wasm_bindgen_test]
fn resolve_contract_error_serializes_its_status() {
    let result = resolve_contract_error(&[], 1).expect("resolution returns a status object");
    let result: Value = serde_wasm_bindgen::from_value(result)
        .expect("the returned JS value should serialize as JSON");

    assert_eq!(result, serde_json::json!({ "status": "not_yet_implemented" }));
}

#[wasm_bindgen_test]
fn version_returns_the_package_version() {
    assert_eq!(version(), env!("CARGO_PKG_VERSION"));
}

#[wasm_bindgen_test]
fn report_serialization_round_trips_through_js_value() {
    let report = serde_json::json!({
        "errorType": "ContractError",
        "errorCode": 7,
        "contractId": "contract-id",
        "rootCauses": [{ "description": "missing authorization", "likelihood": "high" }]
    });
    let js_value = serde_wasm_bindgen::to_value(&report)
        .expect("JSON value should serialize into a JS value");
    let round_tripped: Value = serde_wasm_bindgen::from_value(js_value)
        .expect("JS value should deserialize back into JSON");

    assert_eq!(round_tripped, report);
}
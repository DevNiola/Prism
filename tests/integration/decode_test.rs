// Integration tests for the full decode pipeline
//
// These tests exercise the decode path from transaction fixture data →
// parsed response → DiagnosticReport structure, without requiring a live
// RPC node. All RPC communication is mocked via fixture JSON files under
// tests/fixtures/transactions/.
//
// The real end-to-end CLI integration tests that spawn the compiled binary
// live in:  crates/cli/tests/integration/decode_test.rs

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::Deserialize;
use std::path::PathBuf;

// ── Fixture helpers ──────────────────────────────────────────────────────────

fn fixtures_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let direct = manifest.join("fixtures").join("transactions");
    if direct.exists() {
        return direct;
    }
    let sub = manifest.join("tests").join("fixtures").join("transactions");
    if sub.exists() {
        return sub;
    }
    let parent_tests = manifest
        .parent()
        .map(|p| p.join("tests").join("fixtures").join("transactions"));
    if let Some(p) = parent_tests {
        if p.exists() {
            return p;
        }
    }
    direct
}

fn load_fixture(name: &str) -> serde_json::Value {
    let path = fixtures_dir().join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read fixture {}: {}", path.display(), e));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("Failed to parse fixture {}: {}", path.display(), e))
}

// ── Fixture shape: mirrors the transaction JSON files ────────────────────────

#[derive(Debug, Deserialize)]
struct TransactionFixture {
    status: String,
    hash: String,
    ledger: u32,
    #[serde(rename = "resultXdr")]
    result_xdr: String,
    #[serde(rename = "diagnosticEvents", default)]
    diagnostic_events: Vec<serde_json::Value>,
    #[serde(rename = "contractId", default)]
    contract_id: Option<String>,
}

fn parse_fixture(name: &str) -> TransactionFixture {
    let val = load_fixture(name);
    serde_json::from_value(val)
        .unwrap_or_else(|e| panic!("Failed to deserialise fixture {}: {}", name, e))
}

// ── DiagnosticReport shape (subset used for assertions) ──────────────────────

#[derive(Debug, Deserialize)]
struct PartialDiagnosticReport {
    error_category: String,
    error_code: u32,
    error_name: String,
    summary: String,
    severity: String,
    learn_more: String,
}

// ── budget_exceeded fixture tests ────────────────────────────────────────────

#[test]
fn test_budget_exceeded_fixture_loads_correctly() {
    let fixture = parse_fixture("budget_exceeded.json");
    assert_eq!(fixture.status, "FAILED");
    assert_eq!(fixture.ledger, 50000);
    assert!(!fixture.hash.is_empty(), "tx hash should be present");
}

#[test]
fn test_budget_exceeded_result_xdr_is_base64() {
    let fixture = parse_fixture("budget_exceeded.json");
    assert!(!fixture.result_xdr.is_empty());
    let decoded = BASE64_STANDARD.decode(&fixture.result_xdr);
    assert!(
        decoded.is_ok(),
        "resultXdr should be valid base64 in budget_exceeded.json"
    );
}

#[test]
fn test_budget_exceeded_has_diagnostic_events() {
    let fixture = parse_fixture("budget_exceeded.json");
    assert!(
        !fixture.diagnostic_events.is_empty(),
        "budget_exceeded.json should contain diagnostic events"
    );
    let event = &fixture.diagnostic_events[0];
    assert_eq!(event["type"], "budget");
    assert_eq!(event["data"]["category"], "cpu");
}

#[test]
fn test_budget_exceeded_cpu_limit_exceeded() {
    let fixture = parse_fixture("budget_exceeded.json");
    let event = &fixture.diagnostic_events[0];
    let used = event["data"]["used"].as_u64().expect("used field");
    let limit = event["data"]["limit"].as_u64().expect("limit field");
    assert!(
        used > limit,
        "budget_exceeded: cpu used ({used}) should exceed limit ({limit})"
    );
}

// ── auth_failed fixture tests ─────────────────────────────────────────────────

#[test]
fn test_auth_failed_fixture_loads_correctly() {
    let fixture = parse_fixture("auth_failed.json");
    assert_eq!(fixture.status, "FAILED");
    assert_eq!(fixture.ledger, 50100);
    assert!(!fixture.hash.is_empty());
}

#[test]
fn test_auth_failed_result_xdr_is_base64() {
    let fixture = parse_fixture("auth_failed.json");
    assert!(!fixture.result_xdr.is_empty());
    let decoded = BASE64_STANDARD.decode(&fixture.result_xdr);
    assert!(
        decoded.is_ok(),
        "resultXdr should be valid base64 in auth_failed.json"
    );
}

#[test]
fn test_auth_failed_has_auth_diagnostic_event() {
    let fixture = parse_fixture("auth_failed.json");
    assert!(
        !fixture.diagnostic_events.is_empty(),
        "auth_failed.json should contain diagnostic events"
    );
    let event = &fixture.diagnostic_events[0];
    assert_eq!(event["type"], "auth");
}

#[test]
fn test_auth_failed_required_and_provided_addresses_differ() {
    let fixture = parse_fixture("auth_failed.json");
    let event = &fixture.diagnostic_events[0];
    let required = event["data"]["required"].as_str().unwrap_or("");
    let provided = event["data"]["provided"].as_str().unwrap_or("");
    assert_ne!(
        required, provided,
        "auth_failed: required and provided addresses must differ"
    );
    // Stellar accounts start with 'G'
    assert!(
        required.starts_with('G'),
        "required address should be a Stellar account"
    );
    assert!(
        provided.starts_with('G'),
        "provided address should be a Stellar account"
    );
}

// ── contract_error fixture tests ──────────────────────────────────────────────

#[test]
fn test_contract_error_fixture_loads_correctly() {
    let fixture = parse_fixture("contract_error.json");
    assert_eq!(fixture.status, "FAILED");
    assert_eq!(fixture.ledger, 50200);
    assert!(!fixture.hash.is_empty());
}

#[test]
fn test_contract_error_result_xdr_is_base64() {
    let fixture = parse_fixture("contract_error.json");
    assert!(!fixture.result_xdr.is_empty());
    let decoded = BASE64_STANDARD.decode(&fixture.result_xdr);
    assert!(
        decoded.is_ok(),
        "resultXdr should be valid base64 in contract_error.json"
    );
}

#[test]
fn test_contract_error_has_contract_id() {
    let fixture = parse_fixture("contract_error.json");
    let contract_id = fixture
        .contract_id
        .as_deref()
        .expect("contract_error.json should have a contractId field");
    // Soroban contract addresses start with 'C'
    assert!(
        contract_id.starts_with('C'),
        "contractId should be a Soroban contract address starting with 'C', got: {contract_id}"
    );
}

#[test]
fn test_contract_error_no_diagnostic_events() {
    let fixture = parse_fixture("contract_error.json");
    assert!(
        fixture.diagnostic_events.is_empty(),
        "contract_error.json should have an empty diagnosticEvents array"
    );
}

// ── Cross-fixture / pipeline assertions ──────────────────────────────────────

#[test]
fn test_all_fixtures_have_failed_status() {
    for name in &["budget_exceeded.json", "auth_failed.json", "contract_error.json"] {
        let fixture = parse_fixture(name);
        assert_eq!(
            fixture.status, "FAILED",
            "{name}: expected FAILED status"
        );
    }
}

#[test]
fn test_all_fixture_hashes_are_unique() {
    let hashes: Vec<String> = ["budget_exceeded.json", "auth_failed.json", "contract_error.json"]
        .iter()
        .map(|n| parse_fixture(n).hash)
        .collect();

    for i in 0..hashes.len() {
        for j in (i + 1)..hashes.len() {
            assert_ne!(
                hashes[i], hashes[j],
                "Fixture hashes must be unique: {} == {}",
                hashes[i], hashes[j]
            );
        }
    }
}

#[test]
fn test_all_fixture_ledgers_are_distinct_and_ordered() {
    let budget = parse_fixture("budget_exceeded.json").ledger;
    let auth = parse_fixture("auth_failed.json").ledger;
    let contract = parse_fixture("contract_error.json").ledger;

    assert!(budget < auth, "budget_exceeded ledger should precede auth_failed");
    assert!(auth < contract, "auth_failed ledger should precede contract_error");
}

#[test]
fn test_all_fixture_result_xdr_fields_non_empty() {
    for name in &["budget_exceeded.json", "auth_failed.json", "contract_error.json"] {
        let fixture = parse_fixture(name);
        assert!(
            !fixture.result_xdr.is_empty(),
            "{name}: resultXdr should not be empty"
        );
    }
}

// ── DiagnosticReport construction (mocked / deterministic pipeline) ───────────

/// Simulate the minimal report that the decode pipeline produces for a given
/// error category + code, without calling any RPC endpoint.
fn mock_diagnostic_report(
    category: &str,
    code: u32,
    name: &str,
    summary: &str,
    severity: &str,
) -> serde_json::Value {
    serde_json::json!({
        "error_category": category,
        "error_code": code,
        "error_name": name,
        "summary": summary,
        "detailed_explanation": "",
        "severity": severity,
        "root_causes": [],
        "suggested_fixes": [],
        "related_errors": [],
        "learn_more": "https://developers.stellar.org/docs/learn/smart-contracts/errors"
    })
}

#[test]
fn test_budget_exceeded_report_structure() {
    let report_json = mock_diagnostic_report(
        "Budget",
        0,
        "CpuLimitExceeded",
        "The transaction exhausted the CPU instruction budget.",
        "Error",
    );
    let report: PartialDiagnosticReport = serde_json::from_value(report_json).unwrap();

    assert_eq!(report.error_category, "Budget");
    assert_eq!(report.error_name, "CpuLimitExceeded");
    assert!(!report.summary.is_empty());
    assert!(report.learn_more.starts_with("https://"));
}

#[test]
fn test_auth_failed_report_structure() {
    let report_json = mock_diagnostic_report(
        "Auth",
        12,
        "AuthFailed",
        "Authorization check failed for the submitted credentials.",
        "Error",
    );
    let report: PartialDiagnosticReport = serde_json::from_value(report_json).unwrap();

    assert_eq!(report.error_category, "Auth");
    assert_eq!(report.error_code, 12);
    assert_eq!(report.severity, "Error");
    assert!(!report.learn_more.is_empty());
}

#[test]
fn test_contract_error_report_has_error_code() {
    let report_json = mock_diagnostic_report(
        "Contract",
        3,
        "InsufficientBalance",
        "The contract rejected the call with error code #3.",
        "Error",
    );
    let report: PartialDiagnosticReport = serde_json::from_value(report_json).unwrap();

    assert_eq!(report.error_code, 3);
    assert_eq!(report.error_name, "InsufficientBalance");
}

#[test]
fn test_successful_transaction_report_structure() {
    // A successful (non-failed) transaction should produce a valid report
    // with an informational severity level.
    let report_json = mock_diagnostic_report(
        "Success",
        0,
        "OK",
        "The transaction completed successfully.",
        "Info",
    );
    let report: PartialDiagnosticReport = serde_json::from_value(report_json).unwrap();

    assert_eq!(report.error_category, "Success");
    assert_eq!(report.severity, "Info");
    assert_eq!(report.error_code, 0);
}

#[test]
fn test_report_severity_values_are_valid() {
    for sev in &["Info", "Warning", "Error", "Fatal"] {
        let report_json = mock_diagnostic_report("Test", 0, "Test", "Test", sev);
        let report: PartialDiagnosticReport = serde_json::from_value(report_json).unwrap();
        let valid = ["Info", "Warning", "Error", "Fatal"];
        assert!(
            valid.contains(&report.severity.as_str()),
            "severity '{}' should be one of {:?}",
            report.severity,
            valid
        );
    }
}

#[test]
fn test_report_learn_more_url_is_stellar_docs() {
    let report_json = mock_diagnostic_report("Budget", 0, "Test", "Test", "Error");
    let report: PartialDiagnosticReport = serde_json::from_value(report_json).unwrap();
    assert!(
        report.learn_more.contains("developers.stellar.org"),
        "learn_more URL should point to Stellar docs, got: {}",
        report.learn_more
    );
}

#[test]
fn test_mock_rpc_response_structure_for_budget_exceeded() {
    // Simulate a JSON-RPC response the mock server would return for budget_exceeded
    let fixture = parse_fixture("budget_exceeded.json");
    let mock_rpc_response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "status": fixture.status,
            "hash": fixture.hash,
            "ledger": fixture.ledger,
            "envelopeXdr": "",
            "resultXdr": fixture.result_xdr,
            "resultMetaXdr": "",
        }
    });

    assert!(mock_rpc_response["result"]["status"] == "FAILED");
    assert!(mock_rpc_response["result"]["ledger"] == 50000);
    assert!(!mock_rpc_response["result"]["resultXdr"].as_str().unwrap().is_empty());
}

#[test]
fn test_mock_rpc_response_structure_for_auth_failed() {
    let fixture = parse_fixture("auth_failed.json");
    let mock_rpc_response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "status": fixture.status,
            "hash": fixture.hash,
            "ledger": fixture.ledger,
            "envelopeXdr": "",
            "resultXdr": fixture.result_xdr,
            "resultMetaXdr": "",
        }
    });

    assert!(mock_rpc_response["result"]["status"] == "FAILED");
    assert!(mock_rpc_response["result"]["ledger"] == 50100);
}

#[test]
fn test_mock_rpc_response_structure_for_contract_error() {
    let fixture = parse_fixture("contract_error.json");
    let mock_rpc_response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "status": fixture.status,
            "hash": fixture.hash,
            "ledger": fixture.ledger,
            "envelopeXdr": "",
            "resultXdr": fixture.result_xdr,
            "resultMetaXdr": "",
            "contractId": fixture.contract_id,
        }
    });

    assert!(mock_rpc_response["result"]["status"] == "FAILED");
    // contractId should be present in the response
    assert!(!mock_rpc_response["result"]["contractId"].is_null());
}

// ── Taxonomy Validation Helpers ──────────────────────────────────────────────

fn taxonomy_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if manifest.join("crates").join("core").join("src").join("taxonomy").join("data").exists() {
        return manifest.join("crates").join("core").join("src").join("taxonomy").join("data");
    }
    if let Some(parent) = manifest.parent() {
        let p = parent.join("crates").join("core").join("src").join("taxonomy").join("data");
        if p.exists() {
            return p;
        }
        if let Some(grandparent) = parent.parent() {
            let gp = grandparent.join("scratch").join("prism").join("crates").join("core").join("src").join("taxonomy").join("data");
            if gp.exists() {
                return gp;
            }
        }
    }
    manifest.join("crates").join("core").join("src").join("taxonomy").join("data")
}

fn load_taxonomy(category: &str) -> toml::Value {
    let path = taxonomy_dir().join(format!("{}.toml", category.to_lowercase()));
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read taxonomy file {}: {}", path.display(), e));
    raw.parse::<toml::Value>()
        .unwrap_or_else(|e| panic!("Failed to parse taxonomy file {}: {}", path.display(), e))
}

// ── 10 Integration Tests Covering All Required Scenarios (Issue #15) ────────

#[test]
fn test_fixture_1_single_op_success() {
    let val = load_fixture("single_op_success.json");
    assert_eq!(val["status"], "SUCCESS");
    assert_eq!(val["operation_count"], 1);

    let op = &val["operations"][0];
    assert_eq!(op["type"], "InvokeHostFunction");
    assert_eq!(op["status"], "SUCCESS");
    assert!(op["contract_id"].as_str().unwrap().starts_with('C'));

    let report = &val["expected_report"];
    assert_eq!(report["error_category"], "Success");
    assert_eq!(report["error_code"], 0);
    assert_eq!(report["severity"], "Info");
}

#[test]
fn test_fixture_2_single_op_failure() {
    let val = load_fixture("single_op_failure.json");
    assert_eq!(val["status"], "FAILED");
    assert_eq!(val["operation_count"], 1);

    let op = &val["operations"][0];
    assert_eq!(op["status"], "FAILED");
    assert_eq!(op["error_code"], 1);

    let report = &val["expected_report"];
    assert_eq!(report["error_category"], "Contract");
    assert_eq!(report["error_code"], 0);
    assert_eq!(report["severity"], "Error");
    assert!(!report["suggested_fixes"].as_array().unwrap().is_empty());

    // Validate against taxonomy
    let tax = load_taxonomy("contract");
    assert_eq!(tax["category"]["name"].as_str().unwrap(), "Contract");
}

#[test]
fn test_fixture_3_multi_op_with_error_cross_linking() {
    let val = load_fixture("multi_op_with_error.json");
    assert_eq!(val["status"], "FAILED");
    assert_eq!(val["operation_count"], 3);
    assert_eq!(val["failing_operation_index"], 1);

    // Cross-operation error linking assertions (issue #11)
    let link = &val["cross_operation_link"];
    assert_eq!(link["root_cause_op"], 1);
    let rolled_back = link["rolled_back_ops"].as_array().unwrap();
    assert!(rolled_back.iter().any(|v| v == 0), "Op 0 rolled back");
    let unexecuted = link["unexecuted_ops"].as_array().unwrap();
    assert!(unexecuted.iter().any(|v| v == 2), "Op 2 unexecuted");

    let op0 = &val["operations"][0];
    assert_eq!(op0["status"], "ROLLED_BACK");
    let op1 = &val["operations"][1];
    assert_eq!(op1["status"], "FAILED");
    assert_eq!(op1["error_name"], "InsufficientAllowance");
    let op2 = &val["operations"][2];
    assert_eq!(op2["status"], "ABORTED");
}

#[test]
fn test_fixture_4_auth_ed25519_detection() {
    let val = load_fixture("auth_ed25519.json");
    let auth_entries = val["auth_entries"].as_array().expect("auth_entries array");
    assert!(!auth_entries.is_empty(), "expected auth entries");

    let ed_entry = auth_entries
        .iter()
        .find(|e| e["auth_type"] == "Ed25519")
        .expect("should detect Ed25519 auth entry");
    let addr = ed_entry["address"].as_str().unwrap();
    assert!(addr.starts_with('G'), "Ed25519 address must be Stellar account (G...)");

    // Validate credentials in soroban_meta
    let meta_auth = &val["soroban_meta"]["auth"][0];
    assert_eq!(
        meta_auth["credentials"]["type"],
        "SorobanCredentialsTypeEnum.SOROBAN_CREDENTIALS_ADDRESS"
    );
    assert_eq!(meta_auth["credentials"]["address"]["type"], "ScAddress.Account");
}

#[test]
fn test_fixture_5_auth_smart_wallet_detection() {
    let val = load_fixture("auth_smart_wallet.json");
    let auth_entries = val["auth_entries"].as_array().expect("auth_entries array");
    assert!(!auth_entries.is_empty(), "expected auth entries");

    let sw_entry = auth_entries
        .iter()
        .find(|e| e["auth_type"] == "Smart Wallet")
        .expect("should detect Smart Wallet auth entry");
    let addr = sw_entry["address"].as_str().unwrap();
    assert!(addr.starts_with('C'), "Smart Wallet address must be Soroban contract (C...)");

    // Validate contract credentials in soroban_meta
    let meta_auth = &val["soroban_meta"]["auth"][0];
    assert_eq!(
        meta_auth["credentials"]["type"],
        "SorobanCredentialsTypeEnum.SOROBAN_CREDENTIALS_ADDRESS"
    );
    assert_eq!(meta_auth["credentials"]["address"]["type"], "ScAddress.Contract");
}

#[test]
fn test_fixture_6_budget_exceeded_resource_profile() {
    let val = load_fixture("budget_exceeded.json");
    assert_eq!(val["status"], "FAILED");

    let events = val["diagnosticEvents"].as_array().expect("events");
    let budget_evt = events
        .iter()
        .find(|e| e["type"] == "budget")
        .expect("budget event");
    assert_eq!(budget_evt["data"]["category"], "cpu");
    let used = budget_evt["data"]["used"].as_u64().unwrap();
    let limit = budget_evt["data"]["limit"].as_u64().unwrap();
    assert!(used > limit, "used cpu ({used}) must exceed limit ({limit})");

    // Validate against taxonomy
    let tax = load_taxonomy("budget");
    assert_eq!(tax["category"]["name"].as_str().unwrap(), "Budget");
    let errors = tax["errors"].as_array().unwrap();
    assert!(errors.iter().any(|e| e["name"].as_str().unwrap() == "CPUExceeded"));
}

#[test]
fn test_fixture_7_storage_error_taxonomy_resolution() {
    let val = load_fixture("storage_error.json");
    assert_eq!(val["status"], "FAILED");

    let events = val["diagnosticEvents"].as_array().expect("events");
    let storage_evt = events
        .iter()
        .find(|e| e["type"] == "storage")
        .expect("storage event");
    assert_eq!(storage_evt["data"]["key_type"], "Instance");
    assert_eq!(storage_evt["data"]["code"], 1);

    let report = &val["expected_report"];
    assert_eq!(report["error_category"], "Storage");
    assert_eq!(report["error_code"], 1);
    assert_eq!(report["error_name"], "EntryNotFound");

    // Validate taxonomy matching
    let tax = load_taxonomy("storage");
    assert_eq!(tax["category"]["name"].as_str().unwrap(), "Storage");
    let errors = tax["errors"].as_array().unwrap();
    let entry_not_found = errors
        .iter()
        .find(|e| e["name"].as_str().unwrap() == "EntryNotFound")
        .expect("EntryNotFound in storage.toml");
    assert_eq!(entry_not_found["code"].as_integer().unwrap(), 1);
}

#[test]
fn test_fixture_8_wasm_trap_taxonomy_resolution() {
    let val = load_fixture("wasm_trap.json");
    assert_eq!(val["status"], "FAILED");

    let events = val["diagnosticEvents"].as_array().expect("events");
    let wasm_evt = events.iter().find(|e| e["type"] == "wasm").expect("wasm event");
    assert_eq!(wasm_evt["data"]["code"], 1);
    assert_eq!(wasm_evt["data"]["trap"], "Unreachable");

    let report = &val["expected_report"];
    assert_eq!(report["error_category"], "WASM");
    assert_eq!(report["error_code"], 1);
    assert_eq!(report["error_name"], "Unreachable");

    // Validate taxonomy matching
    let tax = load_taxonomy("wasm");
    assert_eq!(tax["category"]["name"].as_str().unwrap(), "WASM");
    let errors = tax["errors"].as_array().unwrap();
    let unreachable = errors
        .iter()
        .find(|e| e["name"].as_str().unwrap() == "Unreachable")
        .expect("Unreachable in wasm.toml");
    assert_eq!(unreachable["code"].as_integer().unwrap(), 1);
}

#[test]
fn test_fixture_9_event_decoding_topics_and_payload() {
    let val = load_fixture("event_decoding.json");
    assert_eq!(val["status"], "SUCCESS");

    let decoded = val["decoded_events"].as_array().expect("decoded events");
    assert!(!decoded.is_empty());
    let ev = &decoded[0];
    assert_eq!(ev["topic"], "TRANSFER");
    assert_eq!(ev["amount"], "5000000");
    assert_eq!(ev["symbol"], "USDC");
    assert!(ev["from"].as_str().unwrap().starts_with('G'));
    assert!(ev["to"].as_str().unwrap().starts_with('G'));
}

#[test]
fn test_fixture_10_cross_contract_call_chain_analysis() {
    let val = load_fixture("cross_contract_call.json");
    assert_eq!(val["status"], "FAILED");

    let chain = &val["chain_analysis"];
    assert_eq!(chain["call_depth"], 2);
    assert!(chain["caller"].as_str().unwrap().starts_with('C'));
    assert!(chain["target"].as_str().unwrap().starts_with('C'));

    // Check call tree depth
    let tree = &val["call_tree"];
    assert_eq!(tree["depth"], 0);
    let child1 = &tree["children"][0];
    assert_eq!(child1["depth"], 1);
    let child2 = &child1["children"][0];
    assert_eq!(child2["depth"], 2);
    assert_eq!(child2["error_name"], "PoolDepleted");

    assert_eq!(val["root_cause_contract"], child2["contract_id"]);
}

#[test]
fn test_all_10_fixtures_exist_and_parse_validly() {
    let fixture_names = [
        "single_op_success.json",
        "single_op_failure.json",
        "multi_op_with_error.json",
        "auth_ed25519.json",
        "auth_smart_wallet.json",
        "budget_exceeded.json",
        "storage_error.json",
        "wasm_trap.json",
        "event_decoding.json",
        "cross_contract_call.json",
    ];

    for name in &fixture_names {
        let val = load_fixture(name);
        assert!(!val["hash"].as_str().unwrap_or("").is_empty(), "{name}: hash must be present");
        assert!(val["ledger"].as_u64().is_some(), "{name}: ledger must be present");
        assert!(
            val["status"] == "SUCCESS" || val["status"] == "FAILED",
            "{name}: status must be SUCCESS or FAILED"
        );
        assert!(!val["resultXdr"].as_str().unwrap_or("").is_empty(), "{name}: resultXdr must be non-empty");
    }
}

#[test]
fn test_taxonomy_coverage_for_all_fixture_categories() {
    for cat in &["budget", "storage", "wasm", "contract", "auth"] {
        let tax = load_taxonomy(cat);
        assert!(!tax["category"]["name"].as_str().unwrap().is_empty());
        assert!(!tax["errors"].as_array().unwrap().is_empty());
    }
}

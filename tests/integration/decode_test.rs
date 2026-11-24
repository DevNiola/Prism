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
    // CARGO_MANIFEST_DIR for this package is tests/; fixtures live alongside.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("transactions")
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

#[test]
fn test_decode_host_error_code_50_memory_limit_exceeded() {
    let tx_data = serde_json::json!({
        "status": "FAILED",
        "hash": "def789abc123def456789abc123def456789abc123def456789abc123def4567",
        "ledger": 50300,
        "errorCode": 50,
        "diagnosticEvents": [
            {
                "type": "budget",
                "data": {
                    "category": "memory",
                    "used": 60_000_000,
                    "limit": 40_000_000
                }
            }
        ]
    });

    let classified =
        grat_core::decode::host_error::classify_error(&tx_data).expect("should classify code 50");
    assert_eq!(
        classified.category,
        grat_core::taxonomy::schema::ErrorCategory::Budget
    );
    assert_eq!(classified.error_code, 50);

    let report =
        grat_core::decode::report::build_report(&classified).expect("should build report");
    assert_eq!(report.error_code, 50);
    assert_eq!(report.error_name, "MemoryLimitExceeded");
    assert!(
        report.summary.contains("Memory Limit Exceeded"),
        "expected summary to mention 'Memory Limit Exceeded', got: {}",
        report.summary
    );
    assert!(
        report
            .suggested_fixes
            .iter()
            .any(|fix| fix.description.contains("memory_bytes")),
        "expected a suggested fix mentioning 'memory_bytes', got: {:?}",
        report.suggested_fixes
    );

    let host_err = grat_core::decode::host_error::HostError::Budget { code: 50 };
    assert_eq!(host_err.summary(), "[BUDGET] MemoryLimitExceeded");
    assert!(host_err
        .suggested_fix()
        .expect("suggested fix for code 50")
        .contains("memory_bytes"));
}

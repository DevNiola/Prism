use grat_cli::output::{compact, human, json};
use grat_core::types::report::{
    ContractErrorInfo, DiagnosticReport, Severity,
};

fn create_fixture_report() -> DiagnosticReport {
    DiagnosticReport {
        error_category: "Contract".to_string(),
        error_code: 1,
        error_name: "InsufficientBalance".to_string(),
        summary: "The account does not have enough balance to complete this transaction.".to_string(),
        detailed_explanation: "Account balance was 50, but operation required 100.".to_string(),
        severity: Severity::Error,
        root_causes: Vec::new(),
        suggested_fixes: Vec::new(),
        contract_error: Some(ContractErrorInfo {
            contract_id: "CBDLTOJWR2YX2U6BR3P5C4UXKWHE5DJW3JPSIOEXTW2E7D5JUDPQULE7".to_string(),
            error_code: 1,
            error_name: Some("InsufficientBalance".to_string()),
            doc_comment: Some("Transfer amount exceeds available balance".to_string()),
            learn_more: "https://developers.stellar.org/docs/learn/smart-contracts/errors".to_string(),
        }),
        transaction_context: None,
        related_errors: Vec::new(),
        cross_contract_attribution: None,
        auth_signatures: Vec::new(),
        auth_entries: Vec::new(),
        failing_contract_id: None,
        call_chain: None,
        call_graph: None,
        resource_diagnostics: None,
        operation_index: None,
        operation_count: None,
        is_first_failure: None,
        call_depth: None,
        nested_reports: Vec::new(),
        learn_more: "https://developers.stellar.org/docs/learn/smart-contracts/errors".to_string(),
    }
}

#[test]
fn test_compact_output_snapshot() {
    let report = create_fixture_report();
    let formatted = compact::format_report(&report);
    insta::assert_snapshot!(formatted, @"[Contract] InsufficientBalance: The account does not have enough balance to complete this transaction.");
}

#[test]
fn test_json_output_snapshot() {
    let report = create_fixture_report();
    let formatted = json::format_report(&report).unwrap();
    insta::assert_snapshot!(formatted);
}

#[test]
fn test_human_output_snapshot() {
    let report = create_fixture_report();
    let formatted = human::format_report(&report);
    insta::assert_snapshot!(formatted);
}

use crate::error::{GratError, GratResult};
use crate::taxonomy::loader::{TaxonomyDatabase, TaxonomyDiff, TaxonomyParser};
use crate::taxonomy::schema::{ErrorCategory, TaxonomyEntry};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const TAXONOMY_URL: &str = "https://raw.githubusercontent.com/grat-soroban/grat/main/taxonomy/enhanced_error_taxonomy.toml";

#[derive(Serialize, Deserialize)]
struct UpdateCache {
    last_check: SystemTime,
    version: Option<String>,
}

pub fn cache_file_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("", "", "grat")
        .map(|proj_dirs| proj_dirs.cache_dir().join("taxonomy_update.json"))
}

pub fn db_file_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("", "", "grat")
        .map(|proj_dirs| proj_dirs.data_dir().join("taxonomy").join("database.toml"))
}

pub async fn check_and_update(offline: bool) -> GratResult<()> {
    let _ = auto_update_taxonomy(None, offline).await;
    Ok(())
}

pub async fn auto_update_taxonomy(
    custom_url: Option<&str>,
    offline: bool,
) -> GratResult<TaxonomyDiff> {
    if offline {
        tracing::debug!("Offline mode enabled, skipping taxonomy update");
        return Ok(TaxonomyDiff::default());
    }

    let url = custom_url.unwrap_or(TAXONOMY_URL);

    let client = match reqwest::Client::builder()
        .user_agent("grat-taxonomy-updater")
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to build reqwest client for taxonomy update: {e}");
            return Ok(TaxonomyDiff::default());
        }
    };

    tracing::info!("Fetching latest taxonomy from {url}");
    let response = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Failed to download taxonomy database: {e}");
            return Ok(TaxonomyDiff::default());
        }
    };

    if !response.status().is_success() {
        tracing::warn!(
            "Failed to download taxonomy database: HTTP {}",
            response.status()
        );
        return Ok(TaxonomyDiff::default());
    }

    let content = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("Failed to read taxonomy database response: {e}");
            return Ok(TaxonomyDiff::default());
        }
    };

    apply_taxonomy_update(&content)
}

pub fn apply_taxonomy_update(content: &str) -> GratResult<TaxonomyDiff> {
    let schema = TaxonomyParser::parse(content)?;

    // Validate the updated taxonomy with the taxonomy linter
    crate::taxonomy::linter::lint_entries(&schema.errors)?;

    let mut current_db = TaxonomyDatabase::load_latest().unwrap_or_else(|_| {
        TaxonomyDatabase::load_embedded().unwrap_or_default()
    });

    let mut incoming_db = TaxonomyDatabase::default();
    for entry in &schema.errors {
        incoming_db.insert_or_update(entry.clone());
    }

    let diff = current_db.diff(&incoming_db);

    // Apply updates and log all changes
    for entry in &diff.added {
        tracing::info!(
            category = %entry.category,
            code = entry.code,
            name = %entry.name,
            "Taxonomy auto-update: added new error entry"
        );
        current_db.insert_or_update(entry.clone());
    }

    for entry in &diff.updated {
        tracing::info!(
            category = %entry.category,
            code = entry.code,
            name = %entry.name,
            "Taxonomy auto-update: updated error entry"
        );
        current_db.insert_or_update(entry.clone());
    }

    tracing::info!(
        added = diff.added.len(),
        updated = diff.updated.len(),
        unchanged = diff.unchanged_count,
        "Taxonomy auto-update complete"
    );

    // Atomically persist database if path is available
    if let Some(db_path) = db_file_path() {
        if let Some(parent) = db_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let temp_path = db_path.with_extension("tmp");
        if fs::write(&temp_path, content).is_ok() {
            if fs::rename(&temp_path, &db_path).is_err() {
                tracing::warn!("Failed to replace taxonomy database atomically");
                let _ = fs::remove_file(temp_path);
            } else {
                tracing::info!("Taxonomy database written to disk successfully");
            }
        }
    }

    if let Some(cache_path) = cache_file_path() {
        if let Some(parent) = cache_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let cache = UpdateCache {
            last_check: SystemTime::now(),
            version: None,
        };
        if let Ok(serialized) = serde_json::to_string(&cache) {
            let _ = fs::write(&cache_path, serialized);
        }
    }

    Ok(diff)
}

/// The Soroban protocol version currently compiled against.
pub const CURRENT_PROTOCOL: u32 = crate::SOROBAN_PROTOCOL_VERSION;

/// A host-level error code that the Soroban environment exposes.
///
/// When a protocol version bump introduces new error variants these codes will
/// not yet have a corresponding entry in the taxonomy data files.  The updater
/// uses this type to describe what it found in the host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolCode {
    pub category: crate::taxonomy::schema::ErrorCategory,
    pub code: u32,
    pub name: String,
}

/// A single taxonomy entry that is present in the host but absent from the
/// taxonomy data files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingTaxonomyEntry {
    pub category: crate::taxonomy::schema::ErrorCategory,
    pub code: u32,
    pub name: String,
    /// A ready-to-commit template entry that only needs `summary` and
    /// `suggested_fixes` filled in by a human contributor.
    pub template: TaxonomyEntry,
}

/// The result of comparing the host's known error codes against the taxonomy.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtocolDriftReport {
    /// Entries that exist in the host but have no taxonomy record.
    pub missing_entries: Vec<MissingTaxonomyEntry>,
    /// Number of host codes that are already covered by the taxonomy.
    pub covered_count: usize,
    /// Protocol version that was checked.
    pub protocol_version: u32,
}

impl ProtocolDriftReport {
    /// Returns `true` if any host error codes are missing from the taxonomy.
    pub fn has_drift(&self) -> bool {
        !self.missing_entries.is_empty()
    }

    /// Returns a human-readable summary suitable for CI output.
    pub fn summary(&self) -> String {
        if self.missing_entries.is_empty() {
            format!(
                "Taxonomy is up-to-date with Soroban protocol v{}. \
                 All {} known host error codes are covered.",
                self.protocol_version, self.covered_count
            )
        } else {
            format!(
                "Protocol drift detected for Soroban protocol v{}: \
                 {} host error code(s) are missing from the taxonomy \
                 ({} covered).",
                self.protocol_version,
                self.missing_entries.len(),
                self.covered_count
            )
        }
    }
}

/// Generate a template [`TaxonomyEntry`] for a host error code that is not yet
/// in the taxonomy.  The `summary` and `detailed_explanation` are placeholder
/// strings that a contributor must replace before merging.
pub fn generate_template_entry(
    category: crate::taxonomy::schema::ErrorCategory,
    code: u32,
    name: &str,
    protocol_version: u32,
) -> TaxonomyEntry {
    TaxonomyEntry {
        id: format!(
            "{}.{}.{}",
            category.to_string().to_lowercase(),
            name.to_lowercase().replace(' ', "_"),
            code
        ),
        category,
        code,
        name: name.to_string(),
        severity: "Error".to_string(),
        since_protocol: Some(protocol_version),
        deprecated_protocol: None,
        // These are intentionally left as placeholders that will fail the
        // linter's minimum-length check until a contributor fills them in.
        summary: format!("TODO: Provide a summary for {name} (host error code {code})."),
        detailed_explanation: format!(
            "TODO: Provide a detailed explanation for {name} (host error code {code}). \
             Added automatically by the taxonomy updater for protocol v{protocol_version}."
        ),
        common_causes: vec![],
        suggested_fixes: vec![],
        related_errors: vec![],
        source_file: None,
        source_line: None,
        documentation_url: None,
    }
}

/// Compare a list of host error codes against the loaded taxonomy database and
/// return a [`ProtocolDriftReport`] describing any gaps.
///
/// # Usage
/// ```rust,no_run
/// use grat_core::taxonomy::updater::{diff_host_codes_against_taxonomy, CURRENT_PROTOCOL};
/// use grat_core::taxonomy::loader::TaxonomyDatabase;
///
/// let db = TaxonomyDatabase::load_embedded().unwrap();
/// // `host_codes` would normally come from introspecting soroban_env_host.
/// let report = diff_host_codes_against_taxonomy(&db, &[]);
/// if report.has_drift() {
///     eprintln!("{}", report.summary());
/// }
/// ```
pub fn diff_host_codes_against_taxonomy(
    db: &TaxonomyDatabase,
    host_codes: &[ProtocolCode],
) -> ProtocolDriftReport {
    let mut missing = Vec::new();
    let mut covered = 0usize;

    for host_code in host_codes {
        if db.lookup(&host_code.category, host_code.code).is_some() {
            covered += 1;
        } else {
            let template = generate_template_entry(
                host_code.category.clone(),
                host_code.code,
                &host_code.name,
                CURRENT_PROTOCOL,
            );
            missing.push(MissingTaxonomyEntry {
                category: host_code.category.clone(),
                code: host_code.code,
                name: host_code.name.clone(),
                template,
            });
        }
    }

    ProtocolDriftReport {
        missing_entries: missing,
        covered_count: covered,
        protocol_version: CURRENT_PROTOCOL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_taxonomy_update_diff_and_validation() {
        let sample_toml = r#"
[category]
name = "budget"
title = "Budget Errors"
description = "Errors related to resource budgets and consumption limits."

[[errors]]
id = "budget_new_test_error"
category = "budget"
code = 9999
name = "TestBudgetExceeded"
severity = "Error"
summary = "This is a test budget error that exceeds limit."
detailed_explanation = "This is a detailed explanation of the test budget error exceeding limit."

[[errors.common_causes]]
description = "Infinite recursion in contract invocation."
likelihood = "High"

[[errors.suggested_fixes]]
description = "Optimize loop bounds and avoid infinite recursion."
difficulty = "Medium"
requires_upgrade = false
"#;

        let diff = apply_taxonomy_update(sample_toml).expect("Should apply taxonomy update successfully");
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].id, "budget_new_test_error");
        assert_eq!(diff.added[0].code, 9999);
    }

    // ── Protocol-drift detection tests ────────────────────────────────────────

    #[test]
    fn protocol_drift_report_contains_missing_entries() {
        // Create a database that has only one known code, then ask the diff
        // function to compare it against two host codes — one known, one new.
        let mut db = TaxonomyDatabase::default();
        let existing = make_test_entry("budget.cpu.limit_exceeded", ErrorCategory::Budget, 1);
        db.insert_or_update(existing);

        let host_codes = vec![
            ProtocolCode { category: ErrorCategory::Budget, code: 1, name: "CpuLimitExceeded".to_string() },
            ProtocolCode { category: ErrorCategory::Budget, code: 2, name: "MemoryLimitExceeded".to_string() },
        ];

        let report = diff_host_codes_against_taxonomy(&db, &host_codes);
        assert_eq!(report.missing_entries.len(), 1);
        assert_eq!(report.missing_entries[0].code, 2);
        assert_eq!(report.missing_entries[0].name, "MemoryLimitExceeded");
        assert_eq!(report.covered_count, 1);
    }

    #[test]
    fn protocol_drift_report_empty_when_all_covered() {
        let mut db = TaxonomyDatabase::default();
        db.insert_or_update(make_test_entry("budget.cpu.limit_exceeded", ErrorCategory::Budget, 1));
        db.insert_or_update(make_test_entry("budget.memory.limit_exceeded", ErrorCategory::Budget, 2));

        let host_codes = vec![
            ProtocolCode { category: ErrorCategory::Budget, code: 1, name: "CpuLimitExceeded".to_string() },
            ProtocolCode { category: ErrorCategory::Budget, code: 2, name: "MemoryLimitExceeded".to_string() },
        ];

        let report = diff_host_codes_against_taxonomy(&db, &host_codes);
        assert!(report.missing_entries.is_empty(), "no missing entries when all codes are covered");
        assert_eq!(report.covered_count, 2);
    }

    #[test]
    fn template_entry_contains_required_fields() {
        let tmpl = generate_template_entry(ErrorCategory::Auth, 42, "NewAuthError", CURRENT_PROTOCOL);
        assert_eq!(tmpl.category, ErrorCategory::Auth);
        assert_eq!(tmpl.code, 42);
        assert_eq!(tmpl.name, "NewAuthError");
        assert_eq!(tmpl.since_protocol, Some(CURRENT_PROTOCOL));
        // summary and detailed_explanation must be non-empty placeholders
        assert!(!tmpl.summary.is_empty());
        assert!(!tmpl.detailed_explanation.is_empty());
    }

    #[test]
    fn protocol_drift_report_has_drift_flag_when_missing() {
        let db = TaxonomyDatabase::default(); // empty
        let host_codes = vec![
            ProtocolCode { category: ErrorCategory::Wasm, code: 10, name: "InvalidOpcode".to_string() },
        ];
        let report = diff_host_codes_against_taxonomy(&db, &host_codes);
        assert!(report.has_drift(), "has_drift() must return true when entries are missing");
    }

    #[test]
    fn protocol_drift_report_no_drift_flag_when_fully_covered() {
        let mut db = TaxonomyDatabase::default();
        db.insert_or_update(make_test_entry("wasm.invalid_opcode", ErrorCategory::Wasm, 10));
        let host_codes = vec![
            ProtocolCode { category: ErrorCategory::Wasm, code: 10, name: "InvalidOpcode".to_string() },
        ];
        let report = diff_host_codes_against_taxonomy(&db, &host_codes);
        assert!(!report.has_drift(), "has_drift() must return false when all codes are covered");
    }

    fn make_test_entry(id: &str, category: ErrorCategory, code: u32) -> TaxonomyEntry {
        TaxonomyEntry {
            id: id.to_string(),
            category,
            code,
            name: format!("TestEntry{code}"),
            severity: "Error".to_string(),
            since_protocol: Some(20),
            deprecated_protocol: None,
            summary: "Test summary long enough to pass validation.".to_string(),
            detailed_explanation: "Test detailed explanation long enough to pass validation.".to_string(),
            common_causes: vec![],
            suggested_fixes: vec![],
            related_errors: vec![],
            source_file: None,
            source_line: None,
            documentation_url: None,
        }
    }
}

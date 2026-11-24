use crate::error::{GratError, GratResult};
use crate::taxonomy::loader::{TaxonomyDatabase, TaxonomyDiff, TaxonomyParser};
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
}

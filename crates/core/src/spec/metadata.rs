//! Extraction of user supplied Soroban contract metadata.

use crate::error::{GratError, GratResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use stellar_xdr::curr::{Limited, Limits, ReadXdr, ScSymbol, ScVal};

const METADATA_SECTION: &str = "contractmetav0";
const METADATA_XDR_MAX_LEN: usize = 1024 * 1024;

/// User supplied key/value metadata embedded in a contract WASM module.
///
/// Metadata values are strings in the Soroban contract metadata convention.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContractMetadata {
    pub entries: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub error_docs: BTreeMap<String, String>,
}

pub(crate) fn is_empty(metadata: &ContractMetadata) -> bool {
    metadata.entries.is_empty() && metadata.error_docs.is_empty()
}

impl ContractMetadata {
    pub fn version(&self) -> Option<String> {
        self.entries.get("version").cloned()
    }

    /// Retrieve doc comment for an error variant by name or code.
    pub fn get_error_doc(&self, identifier: &str) -> Option<String> {
        if let Some(doc) = self.error_docs.get(identifier) {
            return Some(doc.clone());
        }
        if let Some(short_name) = identifier.split("::").last() {
            if let Some(doc) = self.error_docs.get(short_name) {
                return Some(doc.clone());
            }
        }
        None
    }
}

/// Parse custom section bytes looking for doc comment entries associated with error variants.
pub fn parse_custom_error_docs(section_data: &[u8]) -> BTreeMap<String, String> {
    let mut docs = BTreeMap::new();

    // 1. Try parsing as JSON first
    if let Ok(json_val) = serde_json::from_slice::<serde_json::Value>(section_data) {
        if let serde_json::Value::Object(map) = json_val {
            for (k, v) in map {
                if let Some(s) = v.as_str() {
                    let cleaned = clean_doc_string(s);
                    docs.insert(k, cleaned);
                }
            }
            if !docs.is_empty() {
                return docs;
            }
        }
    }

    // 2. Try parsing as XDR symbol/val stream
    let cursor = std::io::Cursor::new(section_data);
    let mut limited = Limited::new(
        cursor,
        Limits {
            depth: 64,
            len: METADATA_XDR_MAX_LEN,
        },
    );
    while let Ok(key) = ScSymbol::read_xdr(&mut limited) {
        let key_str = key.to_string();
        let value_str = match ScVal::read_xdr(&mut limited) {
            Ok(ScVal::String(value)) => String::from_utf8_lossy(value.as_ref()).into_owned(),
            Ok(ScVal::Symbol(value)) => value.to_string(),
            Ok(_) => continue,
            Err(_) => break,
        };
        let cleaned = clean_doc_string(&value_str);
        docs.insert(key_str, cleaned);
    }
    if !docs.is_empty() {
        return docs;
    }

    // 3. Fallback: Parse line-by-line looking for /// doc comments and enum variant names
    if let Ok(text) = std::str::from_utf8(section_data) {
        let mut pending_doc_lines: Vec<String> = Vec::new();

        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Some(stripped) = trimmed.strip_prefix("///") {
                pending_doc_lines.push(stripped.trim().to_string());
            } else if trimmed.contains("///") {
                // E.g. "InsufficientBalance: /// Not enough balance"
                let parts: Vec<&str> = trimmed.splitn(2, "///").collect();
                if parts.len() == 2 {
                    let key = parts[0].trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != ':');
                    let doc = parts[1].trim();
                    if !key.is_empty() && !doc.is_empty() {
                        docs.insert(key.to_string(), doc.to_string());
                    }
                }
            } else {
                // Could be the variant name following /// lines
                if !pending_doc_lines.is_empty() {
                    // Extract identifier (e.g. "InsufficientBalance = 1" -> "InsufficientBalance")
                    let identifier = trimmed
                        .split(['=', ':', ' ', ';', ','])
                        .next()
                        .unwrap_or("")
                        .trim();
                    if !identifier.is_empty() && identifier.chars().all(|c| c.is_alphanumeric() || c == '_' || c == ':') {
                        let combined_doc = pending_doc_lines.join(" ");
                        docs.insert(identifier.to_string(), combined_doc);
                        pending_doc_lines.clear();
                    }
                }
            }
        }
    }

    docs
}

fn clean_doc_string(raw: &str) -> String {
    let mut lines = Vec::new();
    for line in raw.lines() {
        let t = line.trim();
        if let Some(stripped) = t.strip_prefix("///") {
            lines.push(stripped.trim());
        } else {
            lines.push(t);
        }
    }
    lines.join(" ").trim().to_string()
}

/// Find `contractmetav0` and `"contract custom"` sections, and decode metadata and custom error doc comments.
pub fn extract_contract_metadata(wasm_bytes: &[u8]) -> GratResult<ContractMetadata> {
    let parser = wasmparser::Parser::new(0);
    let mut meta_data_raw = None;
    let mut custom_error_docs = BTreeMap::new();

    for payload in parser.parse_all(wasm_bytes).filter_map(Result::ok) {
        if let wasmparser::Payload::CustomSection(section) = payload {
            let name = section.name();
            if name == METADATA_SECTION {
                meta_data_raw = Some(section.data().to_vec());
            } else if name == "contract custom" || name == "contractcustom" || name == "contractdocs" {
                let parsed = parse_custom_error_docs(section.data());
                custom_error_docs.extend(parsed);
            }
        }
    }

    let mut metadata = ContractMetadata::default();
    metadata.error_docs = custom_error_docs;

    let Some(data) = meta_data_raw else {
        if !metadata.error_docs.is_empty() {
            return Ok(metadata);
        }
        return Err(GratError::SpecError(format!("{METADATA_SECTION} custom section not found")));
    };

    if data.len() > METADATA_XDR_MAX_LEN {
        return Err(GratError::SpecError(
            "contract metadata section exceeds size limit".into(),
        ));
    }

    let cursor = std::io::Cursor::new(data);
    let mut limited = Limited::new(
        cursor,
        Limits {
            depth: 64,
            len: METADATA_XDR_MAX_LEN,
        },
    );
    loop {
        let start = limited.inner.position();
        let key = match ScSymbol::read_xdr(&mut limited) {
            Ok(key) => key.to_string(),
            Err(_) => break,
        };
        let value = match ScVal::read_xdr(&mut limited) {
            Ok(ScVal::String(value)) => String::from_utf8_lossy(value.as_ref()).into_owned(),
            Ok(ScVal::Symbol(value)) => value.to_string(),
            // Preserve the stream boundary and tolerate future value variants.
            Ok(_) => continue,
            Err(_) => break,
        };
        if limited.inner.position() <= start {
            break;
        }

        // Check if key is an error doc entry
        if let Some(err_name) = key.strip_prefix("error_doc:") {
            metadata.error_docs.insert(err_name.to_string(), clean_doc_string(&value));
        } else if let Some(err_name) = key.strip_prefix("doc:") {
            metadata.error_docs.insert(err_name.to_string(), clean_doc_string(&value));
        }

        metadata.entries.insert(key, value);
    }
    Ok(metadata)
}

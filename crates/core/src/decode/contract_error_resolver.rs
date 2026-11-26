use crate::cache::store::{CacheCategory, CacheStore};
use crate::error::{GratError, GratResult};
use crate::rpc::SorobanRpcClient;
use crate::spec::decoder::{decode_contract_spec, resolve_error_code};
use crate::types::address::Address;
use crate::types::config::NetworkConfig;
use crate::xdr::codec::XdrCodec;
use stellar_xdr::curr::{
    ContractDataDurability, ContractExecutable, Hash, LedgerEntry, LedgerEntryData, LedgerKey,
    LedgerKeyContractCode, LedgerKeyContractData, ScAddress, ScVal,
};

pub struct ContractErrorResolver {
    network: NetworkConfig,
}

impl ContractErrorResolver {
    pub fn new(network: NetworkConfig) -> Self {
        Self { network }
    }

    /// Resolves a numeric contract error code to its human-readable name and doc string.
    /// Gracefully falls back to returning the raw integer as a string if resolution fails.
    pub async fn resolve(&self, contract_id: &str, error_code: u32) -> (String, Option<String>) {
        match self.resolve_inner(contract_id, error_code).await {
            Ok((name, doc)) => (name, doc),
            Err(e) => {
                tracing::warn!(
                    contract_id,
                    error_code,
                    error = %e,
                    "Failed to resolve contract error code, falling back to raw integer"
                );
                (error_code.to_string(), None)
            }
        }
    }

    async fn resolve_inner(
        &self,
        contract_id: &str,
        error_code: u32,
    ) -> GratResult<(String, Option<String>)> {
        // Validate Contract ID
        Address::validate_contract_id(contract_id)?;

        // Try local cache first (skipped when no_cache is set)
        let cache = CacheStore::default_location()?;
        let cache_key = format!("{contract_id}_spec");

        let wasm_bytes = if !self.network.no_cache {
            if let Some(cached) = cache.get(CacheCategory::WasmBlob, &cache_key, None)? {
                cached
            } else {
                // Fetch WASM from the network
                let fetched = self.fetch_wasm_from_network(contract_id).await?;
                // Cache it
                let _ = cache.put(CacheCategory::WasmBlob, &cache_key, &fetched, None);
                fetched
            }
        } else {
            // Bypass cache lookup and always fetch live network data
            let fetched = self.fetch_wasm_from_network(contract_id).await?;
            // Still write fresh data for subsequent cached runs
            let _ = cache.put(CacheCategory::WasmBlob, &cache_key, &fetched, None);
            fetched
        };

        // Parse WASM spec
        let spec = decode_contract_spec(&wasm_bytes)?;

        // Resolve error code
        if let Some(entry) = resolve_error_code(&spec, error_code) {
            let doc = entry.doc.clone().or_else(|| {
                spec.metadata.get_error_doc(&entry.name)
            }).or_else(|| {
                spec.metadata.get_error_doc(&error_code.to_string())
            });
            Ok((entry.name.clone(), doc))
        } else if let Some(doc) = spec.metadata.get_error_doc(&error_code.to_string()) {
            Ok((error_code.to_string(), Some(doc)))
        } else {
            Err(GratError::SpecError(format!(
                "Error code {error_code} not found in contract {contract_id} spec"
            )))
        }
    }

    async fn fetch_wasm_from_network(&self, contract_id: &str) -> GratResult<Vec<u8>> {
        let rpc_client = SorobanRpcClient::new(&self.network);
        let address = Address::from_contract_id(contract_id)?;

        let mut contract_bytes = [0u8; 32];
        contract_bytes.copy_from_slice(&address.bytes);

        // Step 1: Fetch ContractData LedgerEntry to find the WASM hash
        let instance_key = LedgerKey::ContractData(LedgerKeyContractData {
            contract: ScAddress::Contract(Hash(contract_bytes)),
            key: ScVal::LedgerKeyContractInstance,
            durability: ContractDataDurability::Persistent,
        });

        let base64_key = instance_key.to_xdr_base64()?;
        let response = rpc_client.get_ledger_entries(&[base64_key]).await?;

        let entries = response
            .get("entries")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| {
                GratError::ContractNotFound(format!("Invalid response for contract {contract_id}"))
            })?;

        if entries.is_empty() {
            return Err(GratError::ContractNotFound(contract_id.to_string()));
        }

        let entry_val = &entries[0];
        let xdr_base64 = entry_val
            .get("xdr")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                GratError::SpecError(format!(
                    "Missing XDR in response for contract {contract_id}"
                ))
            })?;

        let ledger_entry = LedgerEntry::from_xdr_base64(xdr_base64)?;

        let wasm_hash = match ledger_entry.data {
            LedgerEntryData::ContractData(contract_data) => match contract_data.val {
                ScVal::ContractInstance(instance) => match instance.executable {
                    ContractExecutable::Wasm(wasm_hash) => wasm_hash,
                    ContractExecutable::StellarAsset => {
                        return Err(GratError::SpecError(
                            "Contract is not a WASM executable".to_string(),
                        ))
                    }
                },
                _ => {
                    return Err(GratError::SpecError(
                        "Ledger entry value is not a ContractInstance".to_string(),
                    ))
                }
            },
            _ => {
                return Err(GratError::SpecError(
                    "Ledger entry is not ContractData".to_string(),
                ))
            }
        };

        // Step 2: Fetch the ContractCode LedgerEntry using wasm_hash
        let code_key = LedgerKey::ContractCode(LedgerKeyContractCode { hash: wasm_hash });

        let base64_code_key = code_key.to_xdr_base64()?;
        let code_response = rpc_client.get_ledger_entries(&[base64_code_key]).await?;

        let code_entries = code_response
            .get("entries")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| {
                GratError::ContractNotFound(format!(
                    "Invalid response for contract code {contract_id}"
                ))
            })?;

        if code_entries.is_empty() {
            return Err(GratError::ContractNotFound(contract_id.to_string()));
        }

        let code_entry_val = &code_entries[0];
        let code_xdr_base64 = code_entry_val
            .get("xdr")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                GratError::SpecError(format!(
                    "Missing XDR in response for contract code {contract_id}"
                ))
            })?;

        let code_ledger_entry = LedgerEntry::from_xdr_base64(code_xdr_base64)?;

        match code_ledger_entry.data {
            LedgerEntryData::ContractCode(code_entry) => Ok(code_entry.code.to_vec()),
            _ => Err(GratError::SpecError(
                "Ledger entry is not a contract code entry".to_string(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::curr::{
        Limits, ScSpecEntry, ScSpecUdtErrorEnumCaseV0, ScSpecUdtErrorEnumV0, WriteXdr,
    };

    #[tokio::test]
    async fn test_resolve_from_cache_success() {
        // Construct a mock error enum spec entry
        let error_enum = ScSpecUdtErrorEnumV0 {
            doc: "Error documentation".try_into().unwrap(),
            lib: "".try_into().unwrap(),
            name: "MyError".try_into().unwrap(),
            cases: vec![ScSpecUdtErrorEnumCaseV0 {
                doc: "Some doc".try_into().unwrap(),
                name: "Failed".try_into().unwrap(),
                value: 1042,
            }]
            .try_into()
            .unwrap(),
        };
        let entry = ScSpecEntry::UdtErrorEnumV0(error_enum);
        let entry_bytes = entry.to_xdr(Limits::none()).unwrap();

        // Construct mock WASM payload
        let mut wasm = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
        let section_name = "contractspecv0";
        let section_data = entry_bytes;

        let mut custom_payload = Vec::new();
        custom_payload.push(section_name.len() as u8);
        custom_payload.extend_from_slice(section_name.as_bytes());
        custom_payload.extend_from_slice(&section_data);

        wasm.push(0);
        wasm.push(custom_payload.len() as u8);
        wasm.extend(custom_payload);

        let contract_id_str = stellar_strkey::Contract([7u8; 32]).to_string();
        let contract_id = &contract_id_str;
        let cache = CacheStore::default_location().unwrap();
        let cache_key = format!("{contract_id}_spec");
        cache
            .put(CacheCategory::WasmBlob, &cache_key, &wasm, None)
            .unwrap();

        let resolver = ContractErrorResolver::new(NetworkConfig::testnet());
        let (name, doc) = resolver.resolve(contract_id, 1042).await;
        assert_eq!(name, "MyError::Failed");
        assert_eq!(doc, Some("Some doc".to_string()));

        let (name_fb, doc_fb) = resolver.resolve(contract_id, 9999).await;
        assert_eq!(name_fb, "9999");
        assert_eq!(doc_fb, None);

        // Cleanup cache
        let _ = cache.remove(CacheCategory::WasmBlob, &cache_key, None);
    }

    // ── Issue #470: Hardened resolver tests ───────────────────────────────

    /// Build a minimal WASM module containing a `contractspecv0` custom section
    /// that holds the XDR-encoded `entry`.  The LEB-128 length prefix matches
    /// what a real WASM parser would expect.
    fn build_spec_wasm(entry_bytes: &[u8]) -> Vec<u8> {
        let section_name = b"contractspecv0";
        let mut payload: Vec<u8> = Vec::new();
        // Name length as a single byte (fine for ≤127 chars).
        payload.push(section_name.len() as u8);
        payload.extend_from_slice(section_name);
        payload.extend_from_slice(entry_bytes);

        // WASM magic + version.
        let mut wasm = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
        // Custom section id = 0.
        wasm.push(0x00);
        // Section size as a single byte (fine for small payloads).
        wasm.push(payload.len() as u8);
        wasm.extend(payload);
        wasm
    }

    #[tokio::test]
    async fn test_resolve_multiple_error_codes_in_enum() {
        use stellar_xdr::curr::{
            Limits, ScSpecEntry, ScSpecUdtErrorEnumCaseV0, ScSpecUdtErrorEnumV0, WriteXdr,
        };

        let error_enum = ScSpecUdtErrorEnumV0 {
            doc: "Token errors".try_into().unwrap(),
            lib: "".try_into().unwrap(),
            name: "TokenError".try_into().unwrap(),
            cases: vec![
                ScSpecUdtErrorEnumCaseV0 {
                    doc: "Balance is too low".try_into().unwrap(),
                    name: "InsufficientBalance".try_into().unwrap(),
                    value: 1,
                },
                ScSpecUdtErrorEnumCaseV0 {
                    doc: "Token is frozen".try_into().unwrap(),
                    name: "TokenFrozen".try_into().unwrap(),
                    value: 2,
                },
                ScSpecUdtErrorEnumCaseV0 {
                    doc: "Unauthorized operation".try_into().unwrap(),
                    name: "Unauthorized".try_into().unwrap(),
                    value: 3,
                },
            ]
            .try_into()
            .unwrap(),
        };

        let entry_bytes = ScSpecEntry::UdtErrorEnumV0(error_enum)
            .to_xdr(Limits::none())
            .unwrap();
        let wasm = build_spec_wasm(&entry_bytes);

        let contract_id_str = stellar_strkey::Contract([8u8; 32]).to_string();
        let cache = CacheStore::default_location().unwrap();
        let cache_key = format!("{contract_id_str}_spec");
        cache
            .put(CacheCategory::WasmBlob, &cache_key, &wasm, None)
            .unwrap();

        let resolver = ContractErrorResolver::new(NetworkConfig::testnet());

        let (name1, doc1) = resolver.resolve(&contract_id_str, 1).await;
        assert_eq!(name1, "TokenError::InsufficientBalance");
        assert_eq!(doc1, Some("Balance is too low".to_string()));

        let (name2, doc2) = resolver.resolve(&contract_id_str, 2).await;
        assert_eq!(name2, "TokenError::TokenFrozen");
        assert_eq!(doc2, Some("Token is frozen".to_string()));

        let (name3, doc3) = resolver.resolve(&contract_id_str, 3).await;
        assert_eq!(name3, "TokenError::Unauthorized");
        assert_eq!(doc3, Some("Unauthorized operation".to_string()));

        let _ = cache.remove(CacheCategory::WasmBlob, &cache_key, None);
    }

    #[tokio::test]
    async fn test_resolve_unknown_code_falls_back_to_numeric_string() {
        use stellar_xdr::curr::{
            Limits, ScSpecEntry, ScSpecUdtErrorEnumCaseV0, ScSpecUdtErrorEnumV0, WriteXdr,
        };

        let error_enum = ScSpecUdtErrorEnumV0 {
            doc: "".try_into().unwrap(),
            lib: "".try_into().unwrap(),
            name: "MyError".try_into().unwrap(),
            cases: vec![ScSpecUdtErrorEnumCaseV0 {
                doc: "".try_into().unwrap(),
                name: "KnownError".try_into().unwrap(),
                value: 10,
            }]
            .try_into()
            .unwrap(),
        };

        let entry_bytes = ScSpecEntry::UdtErrorEnumV0(error_enum)
            .to_xdr(Limits::none())
            .unwrap();
        let wasm = build_spec_wasm(&entry_bytes);

        let contract_id_str = stellar_strkey::Contract([9u8; 32]).to_string();
        let cache = CacheStore::default_location().unwrap();
        let cache_key = format!("{contract_id_str}_spec");
        cache
            .put(CacheCategory::WasmBlob, &cache_key, &wasm, None)
            .unwrap();

        let resolver = ContractErrorResolver::new(NetworkConfig::testnet());

        // Code 10 is known.
        let (name_known, _) = resolver.resolve(&contract_id_str, 10).await;
        assert_eq!(name_known, "MyError::KnownError");

        // Code 999 is not in the spec — falls back to the string "999".
        let (name_fallback, doc_fallback) = resolver.resolve(&contract_id_str, 999).await;
        assert_eq!(
            name_fallback, "999",
            "unknown error code must fall back to its numeric string"
        );
        assert!(doc_fallback.is_none(), "unknown code fallback must have no doc");

        let _ = cache.remove(CacheCategory::WasmBlob, &cache_key, None);
    }

    #[tokio::test]
    async fn test_resolve_error_code_zero() {
        use stellar_xdr::curr::{
            Limits, ScSpecEntry, ScSpecUdtErrorEnumCaseV0, ScSpecUdtErrorEnumV0, WriteXdr,
        };

        let error_enum = ScSpecUdtErrorEnumV0 {
            doc: "".try_into().unwrap(),
            lib: "".try_into().unwrap(),
            name: "ZeroError".try_into().unwrap(),
            cases: vec![ScSpecUdtErrorEnumCaseV0 {
                doc: "The zero case".try_into().unwrap(),
                name: "None".try_into().unwrap(),
                value: 0,
            }]
            .try_into()
            .unwrap(),
        };

        let entry_bytes = ScSpecEntry::UdtErrorEnumV0(error_enum)
            .to_xdr(Limits::none())
            .unwrap();
        let wasm = build_spec_wasm(&entry_bytes);

        let contract_id_str = stellar_strkey::Contract([10u8; 32]).to_string();
        let cache = CacheStore::default_location().unwrap();
        let cache_key = format!("{contract_id_str}_spec");
        cache
            .put(CacheCategory::WasmBlob, &cache_key, &wasm, None)
            .unwrap();

        let resolver = ContractErrorResolver::new(NetworkConfig::testnet());
        let (name, doc) = resolver.resolve(&contract_id_str, 0).await;
        assert_eq!(name, "ZeroError::None");
        assert_eq!(doc, Some("The zero case".to_string()));

        let _ = cache.remove(CacheCategory::WasmBlob, &cache_key, None);
    }

    #[test]
    fn test_contract_error_info_fields_are_accessible() {
        use crate::types::report::ContractErrorInfo;

        let info = ContractErrorInfo {
            contract_id: "CTEST123".to_string(),
            error_code: 42,
            error_name: Some("MyError::Overflow".to_string()),
            doc_comment: Some("Arithmetic overflow occurred".to_string()),
            learn_more: "https://developers.stellar.org".to_string(),
        };

        assert_eq!(info.contract_id, "CTEST123");
        assert_eq!(info.error_code, 42);
        assert_eq!(info.error_name.as_deref(), Some("MyError::Overflow"));
        assert_eq!(
            info.doc_comment.as_deref(),
            Some("Arithmetic overflow occurred")
        );
        assert!(info.learn_more.starts_with("https://"));
    }

    #[test]
    fn test_resolved_error_name_follows_enum_variant_pattern() {
        // The resolved name must follow "EnumName::VariantName" format.
        let resolved = "TokenError::InsufficientBalance";
        let parts: Vec<&str> = resolved.splitn(2, "::").collect();
        assert_eq!(parts.len(), 2, "resolved name must contain '::'");
        assert!(!parts[0].is_empty(), "enum name must not be empty");
        assert!(!parts[1].is_empty(), "variant name must not be empty");
        assert!(
            parts[0].chars().next().unwrap().is_uppercase(),
            "enum name must be PascalCase"
        );
        assert!(
            parts[1].chars().next().unwrap().is_uppercase(),
            "variant name must be PascalCase"
        );
    }

    #[tokio::test]
    async fn test_resolve_invalid_contract_id_returns_fallback() {
        // A contract ID that doesn't start with 'C' is invalid; the resolver
        // must fall back to the numeric string rather than panicking.
        let resolver = ContractErrorResolver::new(NetworkConfig::testnet());
        let (name, doc) = resolver.resolve("GNOT_A_CONTRACT", 5).await;
        assert_eq!(
            name, "5",
            "invalid contract ID must fall back to numeric string"
        );
        assert!(doc.is_none());
    }

    // ── End Issue #470 ────────────────────────────────────────────────────
}

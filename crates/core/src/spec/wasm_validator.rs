/// Validates a Soroban contract WASM module's imports against the allowed
/// Soroban host-function set.
///
/// Soroban restricts the WASM imports a contract may declare to a specific set
/// of host functions exported by `soroban_env_host`. Any import that references
/// a module other than `"e"` (the Soroban environment module), or that names a
/// function not in the allowed set, is rejected with a diagnostic referencing
/// taxonomy entry `host.wasm.invalid_module`.
///
/// # Usage
///
/// ```rust
/// use grat_core::spec::wasm_validator::validate_wasm_imports;
///
/// let result = validate_wasm_imports(&wasm_bytes);
/// if let Err(e) = result {
///     eprintln!("WASM validation failed: {e}");
/// }
/// ```

/// The Soroban host module name. All Soroban host-function imports must use
/// this module string; any other module is disallowed.
const SOROBAN_HOST_MODULE: &str = "e";

/// A snapshot of the Soroban protocol-20+ host functions exported from the
/// `"e"` module. Generated from the soroban-env-interface XDR definition.
/// Source: <https://github.com/stellar/rs-soroban-env/blob/main/soroban-env-host/src/host/host_functions.rs>
const ALLOWED_HOST_FUNCTIONS: &[&str] = &[
    // Value operations
    "obj_from_i64",
    "obj_to_i64",
    "obj_from_u64",
    "obj_to_u64",
    "obj_from_i128_pieces",
    "obj_to_i128_lo64",
    "obj_to_i128_hi64",
    "obj_from_u128_pieces",
    "obj_to_u128_lo64",
    "obj_to_u128_hi64",
    "obj_from_i256_pieces",
    "obj_to_i256_lo128",
    "obj_to_i256_hi128",
    "obj_from_u256_pieces",
    "obj_to_u256_lo128",
    "obj_to_u256_hi128",
    // Map
    "map_new",
    "map_put",
    "map_get",
    "map_del",
    "map_len",
    "map_has",
    "map_key_by_pos",
    "map_val_by_pos",
    "map_new_from_linear_memory",
    "map_unpack_to_linear_memory",
    // Vec
    "vec_new",
    "vec_put",
    "vec_get",
    "vec_del",
    "vec_len",
    "vec_push_front",
    "vec_pop_front",
    "vec_push_back",
    "vec_pop_back",
    "vec_front",
    "vec_back",
    "vec_insert",
    "vec_append",
    "vec_slice",
    "vec_first_index_of",
    "vec_last_index_of",
    "vec_binary_search",
    "vec_new_from_linear_memory",
    "vec_unpack_to_linear_memory",
    // Ledger / storage
    "put_contract_data",
    "has_contract_data",
    "get_contract_data",
    "del_contract_data",
    "create_contract",
    "create_asset_contract",
    "upload_wasm",
    "deserialize_from_bytes",
    "serialize_to_bytes",
    "contract_event",
    "get_ledger_sequence",
    "get_ledger_timestamp",
    "get_ledger_network_id",
    "get_ledger_base_reserve",
    "get_ledger_min_temp_ttl",
    "get_ledger_min_persistent_ttl",
    "get_ledger_max_live_until_ledger",
    "extend_contract_data_ttl",
    "extend_current_contract_instance_and_code_ttl",
    // Authorization
    "require_auth",
    "require_auth_for_args",
    "authorize_as_curr_contract",
    // Crypto
    "compute_hash_sha256",
    "verify_sig_ed25519",
    "recover_key_ecdsa_secp256k1",
    "compute_hash_keccak256",
    // Address
    "address_obj_from_account",
    "address_obj_from_contract",
    "account_obj_from_address",
    // Bytes / string
    "bytes_new",
    "bytes_put",
    "bytes_get",
    "bytes_del",
    "bytes_len",
    "bytes_push",
    "bytes_pop",
    "bytes_front",
    "bytes_back",
    "bytes_insert",
    "bytes_append",
    "bytes_slice",
    "bytes_new_from_linear_memory",
    "bytes_copy_to_linear_memory",
    "bytes_copy_from_linear_memory",
    "string_new_from_linear_memory",
    "string_copy_to_linear_memory",
    "string_len",
    "symbol_new_from_linear_memory",
    "symbol_copy_to_linear_memory",
    "symbol_len",
    "symbol_index_in_linear_memory",
    // Prng
    "prng_reseed",
    "prng_bytes_new",
    "prng_u64_in_inclusive_range",
    "prng_vec_shuffle",
    // Call / invoke
    "call",
    "try_call",
    "get_current_contract_address",
    // Error / diagnostic
    "fail_with_error",
    "log_from_linear_memory",
    // Budget
    "get_cpu_insns_count",
    "get_mem_bytes_count",
];

/// An import that was present in the WASM module but is not an allowed
/// Soroban host function.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisallowedImport {
    /// The import module string (e.g. `"wasi_snapshot_preview1"` or `"env"`).
    pub module: String,
    /// The imported name within that module (e.g. `"fd_write"`).
    pub name: String,
    /// A human-readable explanation of why this import is rejected.
    pub reason: String,
}

/// Error returned when WASM import validation fails.
#[derive(Debug, Clone)]
pub struct WasmImportValidationError {
    /// Every import that was rejected.
    pub disallowed: Vec<DisallowedImport>,
}

impl std::fmt::Display for WasmImportValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(
            f,
            "WASM module contains {} disallowed import(s) \
             (taxonomy: host.wasm.invalid_module):",
            self.disallowed.len()
        )?;
        for imp in &self.disallowed {
            writeln!(f, "  {}::{} — {}", imp.module, imp.name, imp.reason)?;
        }
        Ok(())
    }
}

impl std::error::Error for WasmImportValidationError {}

/// Validates the imports section of a Soroban contract WASM module.
///
/// Returns `Ok(())` if every import in the module is an allowed Soroban host
/// function. Returns `Err(WasmImportValidationError)` listing every offending
/// import otherwise.
///
/// # Errors
///
/// - Any import whose module is not `"e"` is rejected (wrong module).
/// - Any import from module `"e"` whose name is not in `ALLOWED_HOST_FUNCTIONS`
///   is rejected (unknown host function).
/// - If `wasmparser` cannot parse the module a parse error is surfaced.
pub fn validate_wasm_imports(wasm: &[u8]) -> Result<(), WasmImportValidationError> {
    use wasmparser::{Parser, Payload};

    let allowed: std::collections::HashSet<&str> =
        ALLOWED_HOST_FUNCTIONS.iter().copied().collect();

    let mut disallowed: Vec<DisallowedImport> = Vec::new();
    let mut parse_error: Option<String> = None;

    'outer: for payload in Parser::new(0).parse_all(wasm) {
        let payload = match payload {
            Ok(p) => p,
            Err(e) => {
                parse_error = Some(format!("wasmparser error: {e}"));
                break 'outer;
            }
        };

        if let Payload::ImportSection(reader) = payload {
            for import in reader {
                let import = match import {
                    Ok(i) => i,
                    Err(e) => {
                        parse_error = Some(format!("wasmparser import error: {e}"));
                        break 'outer;
                    }
                };

                if import.module != SOROBAN_HOST_MODULE {
                    disallowed.push(DisallowedImport {
                        module: import.module.to_string(),
                        name: import.name.to_string(),
                        reason: format!(
                            "imports from module {:?} are not allowed in Soroban contracts; \
                             only imports from the {:?} (soroban-env-host) module are permitted \
                             (see taxonomy entry host.wasm.invalid_module)",
                            import.module, SOROBAN_HOST_MODULE,
                        ),
                    });
                } else if !allowed.contains(import.name) {
                    disallowed.push(DisallowedImport {
                        module: import.module.to_string(),
                        name: import.name.to_string(),
                        reason: format!(
                            "{:?} is not a recognized Soroban host function; \
                             verify the contract was compiled with a supported \
                             Soroban SDK version \
                             (see taxonomy entry host.wasm.invalid_module)",
                            import.name,
                        ),
                    });
                }
            }
        }
    }

    if let Some(err) = parse_error {
        // Surface as a single synthetic disallowed entry so callers get a
        // typed error rather than a panic.
        return Err(WasmImportValidationError {
            disallowed: vec![DisallowedImport {
                module: "<parse>".to_string(),
                name: "<parse>".to_string(),
                reason: err,
            }],
        });
    }

    if disallowed.is_empty() {
        Ok(())
    } else {
        Err(WasmImportValidationError { disallowed })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal valid WASM magic + version with no sections
    fn empty_wasm() -> Vec<u8> {
        vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]
    }

    /// Build a minimal WASM module that imports a single function.
    ///
    /// Section layout:
    ///   type section  (section id 1): one func type () -> ()
    ///   import section (section id 2): one import entry
    fn wasm_with_import(module: &str, name: &str) -> Vec<u8> {
        let mut out = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];

        // Type section: one type entry — func () -> ()
        // 0x60 = func type, 0x00 params, 0x00 results
        let type_body: Vec<u8> = vec![0x01, 0x60, 0x00, 0x00];
        out.push(0x01); // section id
        out.push(type_body.len() as u8);
        out.extend_from_slice(&type_body);

        // Import section
        let mod_bytes = module.as_bytes();
        let name_bytes = name.as_bytes();
        // entry: len(module) | module | len(name) | name | 0x00 (func) | 0x00 (type index)
        let mut entry = Vec::new();
        entry.push(mod_bytes.len() as u8);
        entry.extend_from_slice(mod_bytes);
        entry.push(name_bytes.len() as u8);
        entry.extend_from_slice(name_bytes);
        entry.push(0x00); // import kind: function
        entry.push(0x00); // type index 0

        let mut import_body = Vec::new();
        import_body.push(0x01); // one import
        import_body.extend_from_slice(&entry);

        out.push(0x02); // section id
        out.push(import_body.len() as u8);
        out.extend_from_slice(&import_body);

        out
    }

    #[test]
    fn empty_module_passes_validation() {
        assert!(validate_wasm_imports(&empty_wasm()).is_ok());
    }

    #[test]
    fn allowed_host_function_passes_validation() {
        let wasm = wasm_with_import("e", "map_new");
        assert!(validate_wasm_imports(&wasm).is_ok());
    }

    #[test]
    fn disallowed_module_is_rejected() {
        let wasm = wasm_with_import("wasi_snapshot_preview1", "fd_write");
        let err = validate_wasm_imports(&wasm).unwrap_err();
        assert_eq!(err.disallowed.len(), 1);
        let imp = &err.disallowed[0];
        assert_eq!(imp.module, "wasi_snapshot_preview1");
        assert_eq!(imp.name, "fd_write");
        assert!(imp.reason.contains("host.wasm.invalid_module"));
    }

    #[test]
    fn unknown_soroban_function_is_rejected() {
        // Import from the right module but with a name that is not an allowed
        // Soroban host function (simulates a future/removed function).
        let wasm = wasm_with_import("e", "unsupported_future_fn");
        let err = validate_wasm_imports(&wasm).unwrap_err();
        assert_eq!(err.disallowed.len(), 1);
        let imp = &err.disallowed[0];
        assert_eq!(imp.module, "e");
        assert_eq!(imp.name, "unsupported_future_fn");
        assert!(imp.reason.contains("host.wasm.invalid_module"));
    }

    #[test]
    fn error_message_references_taxonomy_entry() {
        let wasm = wasm_with_import("env", "malloc");
        let err = validate_wasm_imports(&wasm).unwrap_err();
        let display = err.to_string();
        assert!(display.contains("host.wasm.invalid_module"));
    }

    #[test]
    fn multiple_disallowed_imports_all_reported() {
        // Build a module with two imports: one bad module, one unknown function
        let mut out = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];

        // Type section: one type () -> ()
        let type_body: Vec<u8> = vec![0x01, 0x60, 0x00, 0x00];
        out.push(0x01);
        out.push(type_body.len() as u8);
        out.extend_from_slice(&type_body);

        fn import_entry(module: &str, name: &str) -> Vec<u8> {
            let mut e = Vec::new();
            let mb = module.as_bytes();
            let nb = name.as_bytes();
            e.push(mb.len() as u8);
            e.extend_from_slice(mb);
            e.push(nb.len() as u8);
            e.extend_from_slice(nb);
            e.push(0x00); // func
            e.push(0x00); // type index 0
            e
        }

        let e1 = import_entry("bad_module", "foo");
        let e2 = import_entry("e", "not_a_real_fn");

        let mut import_body = Vec::new();
        import_body.push(0x02); // two imports
        import_body.extend_from_slice(&e1);
        import_body.extend_from_slice(&e2);

        out.push(0x02);
        out.push(import_body.len() as u8);
        out.extend_from_slice(&import_body);

        let err = validate_wasm_imports(&out).unwrap_err();
        assert_eq!(err.disallowed.len(), 2);
    }
}

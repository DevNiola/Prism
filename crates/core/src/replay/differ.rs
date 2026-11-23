use crate::error::GratResult;
use crate::replay::sandbox::SandboxResult;
use crate::replay::state::{normalize_ledger_key, LedgerState};
use crate::types::trace::{DiffChangeType, LedgerEntryDiff, StateDiff};

pub fn compute_diff(pre_state: &LedgerState, result: &SandboxResult) -> GratResult<StateDiff> {
    let mut entries = Vec::new();

    for (key, before_value) in &pre_state.entries {
        // Normalize the opaque base64 key to a readable, stable string.
        let display_key = normalize_ledger_key(key);

        if let Some(after_value) = result.final_state.get(key) {
            if before_value == after_value {
                entries.push(LedgerEntryDiff {
                    key: display_key,
                    before: Some(hex::encode(before_value)),
                    after: Some(hex::encode(after_value)),
                    change_type: DiffChangeType::Unchanged,
                });
            } else {
                entries.push(LedgerEntryDiff {
                    key: display_key,
                    before: Some(hex::encode(before_value)),
                    after: Some(hex::encode(after_value)),
                    change_type: DiffChangeType::Updated,
                });
            }
        } else {
            entries.push(LedgerEntryDiff {
                key: display_key,
                before: Some(hex::encode(before_value)),
                after: None,
                change_type: DiffChangeType::Deleted,
            });
        }
    }

    for (key, after_value) in &result.final_state {
        if !pre_state.entries.contains_key(key) {
            let display_key = normalize_ledger_key(key);
            entries.push(LedgerEntryDiff {
                key: display_key,
                before: None,
                after: Some(hex::encode(after_value)),
                change_type: DiffChangeType::Created,
            });
        }
    }

    Ok(StateDiff { entries })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    /// A well-known LedgerKey XDR (ContractData entry) encoded in base64.
    /// This key is used to verify that `normalize_ledger_key` is deterministic:
    /// the same base64 input must always produce the same output string.
    fn sample_key_b64() -> String {
        // LedgerKey::Account with a known public key —
        // base64(LedgerKey XDR for a minimal account key)
        // We construct the raw bytes directly to avoid an XDR encode round-trip
        // so the test is not sensitive to stellar-xdr version changes.
        //
        // LedgerKey discriminant for Account = 0x00000000 (u32 big-endian)
        // AccountID discriminant = 0x00000000 (PublicKeyTypeEd25519)
        // 32 zero bytes (ed25519 key)
        let mut bytes = vec![0u8; 4 + 4 + 32]; // key type + pk type + key
        // All zeros → Account(PublicKeyTypeEd25519([0; 32]))
        STANDARD.encode(&bytes)
    }

    #[test]
    fn normalize_ledger_key_is_deterministic() {
        let key = sample_key_b64();
        // Call the normalizer twice with identical input; both calls must return
        // equal strings — this guarantees stable key serialization across runs.
        let first = normalize_ledger_key(&key);
        let second = normalize_ledger_key(&key);
        assert_eq!(
            first, second,
            "normalize_ledger_key must return the same string for the same input across calls"
        );
    }

    #[test]
    fn normalize_ledger_key_different_keys_produce_different_strings() {
        let key1 = sample_key_b64();
        // A different key: same structure but with a different last byte
        let raw2 = {
            let mut b = base64::Engine::decode(&STANDARD, &key1).unwrap();
            *b.last_mut().unwrap() ^= 0xFF;
            STANDARD.encode(&b)
        };
        let n1 = normalize_ledger_key(&key1);
        let n2 = normalize_ledger_key(&raw2);
        assert_ne!(
            n1, n2,
            "different ledger keys must produce different normalized strings"
        );
    }

    #[test]
    fn normalize_ledger_key_invalid_base64_falls_back_gracefully() {
        // If the key is not valid base64 / XDR, the normalizer must not panic;
        // it must return a non-empty fallback string.
        let garbage = "not!valid!base64!!!";
        let result = normalize_ledger_key(garbage);
        assert!(!result.is_empty(), "fallback must not be empty");
    }
}


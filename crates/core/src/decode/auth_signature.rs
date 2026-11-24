use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use stellar_xdr::curr::{
    Limits, ReadXdr, ScMap, ScVal, SorobanAddressCredentials, SorobanAuthorizationEntry,
    SorobanCredentials,
};

// ── Public types ──────────────────────────────────────────────────────────

/// The format of the Soroban authorization signature found in the credential.
///
/// Soroban protocol V21 supports two distinct signature layouts depending on
/// whether the authorizer is a classic Stellar account (Ed25519) or a smart
/// wallet contract that validates its own signature format.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "format")]
pub enum SignatureFormat {
    /// Classic Ed25519 64-byte signature encoded as hex.
    Ed25519 { hex: String },
    /// Smart-wallet map entry: `{public_key: 0x…, signature: 0x…}`.
    SmartWalletEntry {
        public_key: String,
        signature: String,
    },
    /// V2 multi-sig map: `{address → {public_key, signature}}`.
    ///
    /// Introduced in protocol V21 for smart wallets that accept multiple
    /// signers.  Each entry maps a signer address to its own key/sig pair.
    MultiSigV2 { signers: Vec<V2SignerEntry> },
    /// The signature is a raw bytes blob (unrecognised format — hex-encoded).
    RawBytes { hex: String },
    /// The signature was absent or `Void`.
    Absent,
}

/// One signer entry within a V2 multi-sig map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct V2SignerEntry {
    /// The signer's address (Stellar strkey or raw hex).
    pub address: String,
    /// Hex-encoded public key bytes if present.
    pub public_key: Option<String>,
    /// Hex-encoded signature bytes.
    pub signature: String,
}

// ── Legacy string-based API (backward-compatible) ─────────────────────────

/// Decode raw signature bytes into a lowercase hex string.
///
/// Returns an error-label string (not an `Err`) so callers can always embed
/// the result in a diagnostic report without unwrapping.
pub fn decode_signature_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "<invalid: empty signature>".to_string();
    }
    if bytes.len() != 64 {
        return format!("<invalid: expected 64 bytes, got {}>", bytes.len());
    }
    bytes.iter().fold(String::new(), |mut output, b| {
        use std::fmt::Write;
        let _ = write!(output, "{b:02x}");
        output
    })
}

/// Decode all signature hex strings from a base64-encoded
/// `SorobanAuthorizationEntry`.
///
/// Returns an empty `Vec` for `SourceAccount` credentials (no explicit
/// signature) and error labels for malformed input.
pub fn decode_auth_entry_signatures(auth_entry_b64: &str) -> Vec<String> {
    let Ok(bytes) = STANDARD.decode(auth_entry_b64) else {
        return vec!["<invalid: base64 decode failed>".to_string()];
    };

    let Ok(entry) = SorobanAuthorizationEntry::from_xdr(&bytes, Limits::none()) else {
        return vec!["<invalid: xdr decode failed>".to_string()];
    };

    match entry.credentials {
        SorobanCredentials::SourceAccount => vec![],
        SorobanCredentials::Address(SorobanAddressCredentials { signature, .. }) => {
            extract_signatures_from_scval(&signature)
        }
    }
}

fn extract_signatures_from_scval(val: &ScVal) -> Vec<String> {
    match val {
        ScVal::Bytes(sc_bytes) => vec![decode_signature_bytes(sc_bytes.as_ref())],

        ScVal::Map(Some(ScMap(entries))) => {
            let mut results = Vec::new();
            for entry in entries.iter() {
                let key_str = match &entry.key {
                    ScVal::Symbol(s) => s.to_string(),
                    ScVal::String(s) => s.to_string(),
                    _ => continue,
                };
                if key_str == "signature" {
                    results.extend(extract_signatures_from_scval(&entry.val));
                }
            }
            results
        }

        ScVal::Vec(Some(vec)) => vec.iter().flat_map(extract_signatures_from_scval).collect(),

        _ => vec![],
    }
}

// ── Structured V2 API ─────────────────────────────────────────────────────

/// Parse the `signature` field of a `SorobanAddressCredentials` into a
/// structured [`SignatureFormat`].
///
/// This supports the full range of signature layouts:
///
/// | Layout | Protocol version | `SignatureFormat` variant |
/// |--------|-----------------|--------------------------|
/// | `Bytes(64)` | V1 / Ed25519 classic | `Ed25519` |
/// | `Map {public_key, signature}` | V1+ smart wallet single-sig | `SmartWalletEntry` |
/// | `Map {address → {public_key?, signature}}` | V21+ smart wallet multi-sig | `MultiSigV2` |
/// | `Void` | unsigned | `Absent` |
/// | anything else | unknown | `RawBytes` |
pub fn parse_signature_format(val: &ScVal) -> SignatureFormat {
    match val {
        ScVal::Void => SignatureFormat::Absent,

        ScVal::Bytes(b) => {
            let hex = decode_signature_bytes(b.as_ref());
            SignatureFormat::Ed25519 { hex }
        }

        ScVal::Map(Some(ScMap(entries))) => {
            // ── Try V2 multi-sig map: every key is an address (Bytes/String/Symbol)
            // and every value is a map containing at least a "signature" field.
            if looks_like_v2_multisig_map(entries) {
                let mut signers = Vec::new();
                for entry in entries.iter() {
                    let address = scval_to_display_string(&entry.key);
                    if let Some(signer) = parse_v2_signer_entry(&address, &entry.val) {
                        signers.push(signer);
                    }
                }
                return SignatureFormat::MultiSigV2 { signers };
            }

            // ── Try single smart-wallet entry: {public_key: Bytes, signature: Bytes}
            let public_key = find_bytes_field(entries, "public_key");
            let signature = find_bytes_field(entries, "signature");
            if let (Some(pk), Some(sig)) = (public_key, signature) {
                return SignatureFormat::SmartWalletEntry {
                    public_key: pk,
                    signature: sig,
                };
            }

            // ── Fall back to raw hex of the entire map debug representation.
            SignatureFormat::RawBytes {
                hex: format!("{val:?}"),
            }
        }

        ScVal::Vec(Some(vec)) => {
            // A Vec of signature maps (rare, but handle gracefully).
            let signers: Vec<V2SignerEntry> = vec
                .iter()
                .enumerate()
                .filter_map(|(i, item)| parse_v2_signer_entry(&format!("[{i}]"), item))
                .collect();
            if !signers.is_empty() {
                SignatureFormat::MultiSigV2 { signers }
            } else {
                SignatureFormat::RawBytes {
                    hex: format!("{val:?}"),
                }
            }
        }

        other => SignatureFormat::RawBytes {
            hex: format!("{other:?}"),
        },
    }
}

/// Decode all signatures from a base64-encoded `SorobanAuthorizationEntry`
/// into structured [`SignatureFormat`] values.
///
/// Returns `None` for `SourceAccount` credentials.
pub fn decode_auth_entry_signatures_v2(
    auth_entry_b64: &str,
) -> Result<Option<SignatureFormat>, String> {
    let bytes = STANDARD
        .decode(auth_entry_b64)
        .map_err(|e| format!("<invalid: base64 decode failed: {e}>"))?;
    let entry = SorobanAuthorizationEntry::from_xdr(&bytes, Limits::none())
        .map_err(|e| format!("<invalid: xdr decode failed: {e}>"))?;

    Ok(match entry.credentials {
        SorobanCredentials::SourceAccount => None,
        SorobanCredentials::Address(SorobanAddressCredentials { signature, .. }) => {
            Some(parse_signature_format(&signature))
        }
    })
}

// ── Private helpers ───────────────────────────────────────────────────────

/// Returns `true` when every map entry has an address-like key and a map
/// value containing a "signature" field (the V2 multi-sig shape).
fn looks_like_v2_multisig_map(entries: &[stellar_xdr::curr::ScMapEntry]) -> bool {
    if entries.is_empty() {
        return false;
    }
    entries.iter().all(|e| {
        is_address_like(&e.key)
            && inner_has_signature_field(&e.val)
    })
}

fn inner_has_signature_field(val: &ScVal) -> bool {
    let ScVal::Map(Some(ScMap(inner))) = val else {
        return false;
    };
    inner.iter().any(|ie| match &ie.key {
        ScVal::Symbol(s) => s.to_string() == "signature",
        ScVal::String(s) => s.to_string() == "signature",
        _ => false,
    })
}

fn is_address_like(val: &ScVal) -> bool {
    matches!(val, ScVal::Bytes(_) | ScVal::String(_) | ScVal::Address(_))
}

fn parse_v2_signer_entry(address: &str, val: &ScVal) -> Option<V2SignerEntry> {
    let ScVal::Map(Some(ScMap(entries))) = val else {
        return None;
    };

    let signature = find_bytes_field(entries, "signature")?;
    let public_key = find_bytes_field(entries, "public_key");

    Some(V2SignerEntry {
        address: address.to_string(),
        public_key,
        signature,
    })
}

fn find_bytes_field(
    entries: &[stellar_xdr::curr::ScMapEntry],
    name: &str,
) -> Option<String> {
    for entry in entries {
        let key_str = match &entry.key {
            ScVal::Symbol(s) => s.to_string(),
            ScVal::String(s) => s.to_string(),
            _ => continue,
        };
        if key_str == name {
            if let ScVal::Bytes(b) = &entry.val {
                return Some(bytes_to_hex(b.as_ref()));
            }
        }
    }
    None
}

fn scval_to_display_string(val: &ScVal) -> String {
    match val {
        ScVal::Bytes(b) => format!("0x{}", bytes_to_hex(b.as_ref())),
        ScVal::String(s) => s.to_string(),
        ScVal::Symbol(s) => s.to_string(),
        ScVal::Address(a) => format!("{a:?}"),
        other => format!("{other:?}"),
    }
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut output, b| {
        use std::fmt::Write;
        let _ = write!(output, "{b:02x}");
        output
    })
}

// Helper extension on ScVal to extract string representation if possible.
trait ScValExt {
    fn to_string_maybe(&self) -> Option<String>;
}

impl ScValExt for ScVal {
    fn to_string_maybe(&self) -> Option<String> {
        match self {
            ScVal::Symbol(s) => Some(s.to_string()),
            ScVal::String(s) => Some(s.to_string()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_valid_64_bytes() {
        let bytes = vec![0xabu8; 64];
        let hex = decode_signature_bytes(&bytes);
        assert_eq!(hex.len(), 128);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(hex.starts_with("ab"));
    }

    #[test]
    fn decode_empty_bytes_returns_error_label() {
        let result = decode_signature_bytes(&[]);
        assert_eq!(result, "<invalid: empty signature>");
    }

    #[test]
    fn decode_wrong_length_returns_error_label() {
        let result = decode_signature_bytes(&[0u8; 32]);
        assert!(result.starts_with("<invalid: expected 64 bytes"));
    }

    #[test]
    fn decode_invalid_base64_returns_error_label() {
        let result = decode_auth_entry_signatures("!!!not-base64!!!");
        assert_eq!(result, vec!["<invalid: base64 decode failed>"]);
    }

    #[test]
    fn decode_invalid_xdr_returns_error_label() {
        let result = decode_auth_entry_signatures("AAAA");
        assert_eq!(result, vec!["<invalid: xdr decode failed>"]);
    }

    // ── V2 signature format tests ─────────────────────────────────────────

    #[test]
    fn parse_void_returns_absent() {
        let fmt = parse_signature_format(&ScVal::Void);
        assert_eq!(fmt, SignatureFormat::Absent);
    }

    #[test]
    fn parse_64_byte_blob_returns_ed25519() {
        use stellar_xdr::curr::ScBytes;
        let bytes = vec![0xdeu8; 64];
        let val = ScVal::Bytes(ScBytes(bytes.clone().try_into().unwrap()));
        let fmt = parse_signature_format(&val);
        match fmt {
            SignatureFormat::Ed25519 { hex } => {
                assert_eq!(hex.len(), 128);
                assert!(hex.starts_with("de"));
            }
            other => panic!("expected Ed25519, got {other:?}"),
        }
    }

    #[test]
    fn parse_smart_wallet_single_sig_map() {
        use stellar_xdr::curr::{ScBytes, ScMap, ScMapEntry, ScSymbol, StringM};

        let pk_bytes = vec![0xaau8; 32];
        let sig_bytes = vec![0xbbu8; 64];

        let map_entries = vec![
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(StringM::try_from("public_key").unwrap())),
                val: ScVal::Bytes(ScBytes(pk_bytes.clone().try_into().unwrap())),
            },
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(StringM::try_from("signature").unwrap())),
                val: ScVal::Bytes(ScBytes(sig_bytes.clone().try_into().unwrap())),
            },
        ];

        let val = ScVal::Map(Some(ScMap(map_entries.try_into().unwrap())));
        let fmt = parse_signature_format(&val);

        match fmt {
            SignatureFormat::SmartWalletEntry {
                public_key,
                signature,
            } => {
                assert_eq!(public_key.len(), 64); // 32 bytes → 64 hex chars
                assert_eq!(signature.len(), 128); // 64 bytes → 128 hex chars
                assert!(public_key.starts_with("aa"));
                assert!(signature.starts_with("bb"));
            }
            other => panic!("expected SmartWalletEntry, got {other:?}"),
        }
    }

    #[test]
    fn parse_v2_multisig_map_with_two_signers() {
        use stellar_xdr::curr::{ScBytes, ScMap, ScMapEntry, ScSymbol, StringM};

        let mk_sig_map = |pk_seed: u8, sig_seed: u8| {
            let pk = vec![pk_seed; 32];
            let sig = vec![sig_seed; 64];
            let entries = vec![
                ScMapEntry {
                    key: ScVal::Symbol(ScSymbol(StringM::try_from("public_key").unwrap())),
                    val: ScVal::Bytes(ScBytes(pk.try_into().unwrap())),
                },
                ScMapEntry {
                    key: ScVal::Symbol(ScSymbol(StringM::try_from("signature").unwrap())),
                    val: ScVal::Bytes(ScBytes(sig.try_into().unwrap())),
                },
            ];
            ScVal::Map(Some(ScMap(entries.try_into().unwrap())))
        };

        // Outer map: {addr_bytes_A → sig_map_A, addr_bytes_B → sig_map_B}
        let addr_a = vec![0x01u8; 32];
        let addr_b = vec![0x02u8; 32];
        let outer_entries = vec![
            ScMapEntry {
                key: ScVal::Bytes(ScBytes(addr_a.clone().try_into().unwrap())),
                val: mk_sig_map(0xaa, 0xcc),
            },
            ScMapEntry {
                key: ScVal::Bytes(ScBytes(addr_b.clone().try_into().unwrap())),
                val: mk_sig_map(0xbb, 0xdd),
            },
        ];
        let val = ScVal::Map(Some(ScMap(outer_entries.try_into().unwrap())));
        let fmt = parse_signature_format(&val);

        match fmt {
            SignatureFormat::MultiSigV2 { signers } => {
                assert_eq!(signers.len(), 2);
                // Signer 0 — address derived from addr_a bytes
                assert!(signers[0].signature.starts_with("cc"));
                assert!(signers[1].signature.starts_with("dd"));
            }
            other => panic!("expected MultiSigV2, got {other:?}"),
        }
    }

    #[test]
    fn v2_format_is_serializable_to_json() {
        use stellar_xdr::curr::ScBytes;
        let bytes = vec![0x11u8; 64];
        let val = ScVal::Bytes(ScBytes(bytes.try_into().unwrap()));
        let fmt = parse_signature_format(&val);
        let json = serde_json::to_string(&fmt).expect("serialize");
        assert!(json.contains("ed25519") || json.contains("hex"));
    }

    #[test]
    fn decode_auth_entry_v2_invalid_base64() {
        let result = decode_auth_entry_signatures_v2("!!!not-base64!!!");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("base64"));
    }
}

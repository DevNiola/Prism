use serde::{Deserialize, Serialize};
use std::fmt;
use stellar_xdr::curr::{SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanCredentials};

use crate::decode::auth::{scaddress_to_strkey, AuthorizationType};
use crate::error::GratResult;
use crate::xdr::codec::XdrCodec;

// ── V1 (backward-compatible) ──────────────────────────────────────────────

/// Address and nonce extracted from a Soroban authorization entry.
///
/// Compatible with both V1 (protocol ≤ 20) and V2 (protocol V21+)
/// authorization entries — the XDR structure for `SorobanAddressCredentials`
/// is the same in both protocol versions; only the `signature` field layout
/// differs (handled in `auth_signature.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddressWithNonce {
    pub address: String,
    pub nonce: i64,
}

impl AddressWithNonce {
    pub fn from_auth_entry_base64(b64: &str) -> GratResult<Option<Self>> {
        let entry = SorobanAuthorizationEntry::from_xdr_base64(b64)?;
        Ok(Self::from_entry(&entry))
    }

    pub fn from_entry(entry: &SorobanAuthorizationEntry) -> Option<Self> {
        match &entry.credentials {
            SorobanCredentials::SourceAccount => None,
            SorobanCredentials::Address(creds) => Some(Self::from_credentials(creds)),
        }
    }

    fn from_credentials(creds: &SorobanAddressCredentials) -> Self {
        Self {
            address: scaddress_to_strkey(&creds.address),
            nonce: creds.nonce,
        }
    }
}

impl fmt::Display for AddressWithNonce {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Address: {}", self.address)?;
        write!(f, "Nonce:   {}", self.nonce)
    }
}

// ── V2 enriched credential ────────────────────────────────────────────────

/// Full credential information extracted from a `SorobanAddressCredentials`
/// entry, including the Soroban V21 protocol fields.
///
/// This is the structured counterpart of [`AddressWithNonce`] — it carries
/// the same data plus the signature expiration ledger, the address type
/// (`Ed25519` vs `SmartWallet`), and whether a non-`Void` signature is
/// present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddressCredentialV2 {
    /// Stellar strkey of the authorizing address.
    pub address: String,
    /// Whether this is a classic Ed25519 account or a smart-wallet contract.
    pub auth_type: AuthorizationType,
    /// For smart-wallet contracts, this repeats the address (it *is* the
    /// contract ID).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub contract_id: Option<String>,
    /// The replay-prevention nonce stored in the credential.
    pub nonce: i64,
    /// The ledger sequence number after which this credential expires.
    pub signature_expiration_ledger: u32,
    /// `true` when the `signature` field is not `ScVal::Void`.
    pub signed: bool,
}

impl AddressCredentialV2 {
    /// Parse a base64-encoded `SorobanAuthorizationEntry` into a V2 credential.
    ///
    /// Returns `None` for `SourceAccount` entries (no explicit address or
    /// nonce) and `Err` when the input is malformed.
    pub fn from_auth_entry_base64(b64: &str) -> GratResult<Option<Self>> {
        let entry = SorobanAuthorizationEntry::from_xdr_base64(b64)?;
        Ok(Self::from_entry(&entry))
    }

    pub fn from_entry(entry: &SorobanAuthorizationEntry) -> Option<Self> {
        match &entry.credentials {
            SorobanCredentials::SourceAccount => None,
            SorobanCredentials::Address(creds) => Some(Self::from_credentials(creds)),
        }
    }

    fn from_credentials(creds: &SorobanAddressCredentials) -> Self {
        use stellar_xdr::curr::ScAddress;
        use stellar_xdr::curr::ScVal;

        let address = scaddress_to_strkey(&creds.address);
        let (auth_type, contract_id) = match &creds.address {
            ScAddress::Account(_) => (AuthorizationType::Ed25519, None),
            ScAddress::Contract(_) => (AuthorizationType::SmartWallet, Some(address.clone())),
        };

        Self {
            address,
            auth_type,
            contract_id,
            nonce: creds.nonce,
            signature_expiration_ledger: creds.signature_expiration_ledger,
            signed: creds.signature != ScVal::Void,
        }
    }
}

impl fmt::Display for AddressCredentialV2 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Address:            {}", self.address)?;
        writeln!(f, "Type:               {}", self.auth_type)?;
        if let Some(ref cid) = self.contract_id {
            writeln!(f, "Contract ID:        {cid}")?;
        }
        writeln!(f, "Nonce:              {}", self.nonce)?;
        writeln!(
            f,
            "Expires Ledger:     {}",
            self.signature_expiration_ledger
        )?;
        write!(
            f,
            "Signed:             {}",
            if self.signed { "yes" } else { "no (unsigned)" }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::curr::{
        AccountId, Hash, InvokeContractArgs, PublicKey, ScAddress, ScSymbol, ScVal,
        SorobanAuthorizedFunction, SorobanAuthorizedInvocation, Uint256,
    };

    fn account_address(seed: u8) -> ScAddress {
        ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
            [seed; 32],
        ))))
    }

    fn contract_address(seed: u8) -> ScAddress {
        ScAddress::Contract(Hash([seed; 32]))
    }

    fn root_invocation(addr: ScAddress) -> SorobanAuthorizedInvocation {
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: addr,
                function_name: ScSymbol("f".try_into().unwrap()),
                args: Vec::new().try_into().unwrap(),
            }),
            sub_invocations: Vec::new().try_into().unwrap(),
        }
    }

    fn address_entry(addr: ScAddress, nonce: i64) -> SorobanAuthorizationEntry {
        SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: addr.clone(),
                nonce,
                signature_expiration_ledger: 0,
                signature: ScVal::Void,
            }),
            root_invocation: root_invocation(addr),
        }
    }

    // ── V1 (AddressWithNonce) tests ───────────────────────────────────────

    #[test]
    fn extracts_account_address_and_nonce() {
        let entry = address_entry(account_address(3), 42);
        let parsed = AddressWithNonce::from_entry(&entry).expect("address credential");
        assert!(parsed.address.starts_with('G'));
        assert_eq!(parsed.nonce, 42);
    }

    #[test]
    fn extracts_contract_address_and_nonce() {
        let entry = address_entry(contract_address(9), -7);
        let parsed = AddressWithNonce::from_entry(&entry).expect("address credential");
        assert!(parsed.address.starts_with('C'));
        assert_eq!(parsed.nonce, -7);
    }

    #[test]
    fn source_account_has_no_address_with_nonce() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::SourceAccount,
            root_invocation: root_invocation(contract_address(1)),
        };
        assert!(AddressWithNonce::from_entry(&entry).is_none());
    }

    #[test]
    fn display_separates_address_and_nonce() {
        let entry = address_entry(account_address(5), 1234);
        let parsed = AddressWithNonce::from_entry(&entry).expect("address credential");
        let rendered = parsed.to_string();
        assert!(rendered.contains(&format!("Address: {}", parsed.address)));
        assert!(rendered.contains("Nonce:   1234"));

        assert_eq!(rendered.lines().count(), 2);
    }

    #[test]
    fn round_trips_through_base64() {
        let entry = address_entry(account_address(7), 99);
        let b64 = XdrCodec::to_xdr_base64(&entry).expect("encode");
        let parsed = AddressWithNonce::from_auth_entry_base64(&b64)
            .expect("decode")
            .expect("address credential");
        assert!(parsed.address.starts_with('G'));
        assert_eq!(parsed.nonce, 99);
    }

    #[test]
    fn source_account_base64_yields_none() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::SourceAccount,
            root_invocation: root_invocation(contract_address(2)),
        };
        let b64 = XdrCodec::to_xdr_base64(&entry).expect("encode");
        let parsed = AddressWithNonce::from_auth_entry_base64(&b64).expect("decode");
        assert!(parsed.is_none());
    }

    #[test]
    fn invalid_base64_is_an_error() {
        assert!(AddressWithNonce::from_auth_entry_base64("!!!not-valid!!!").is_err());
    }

    // ── V2 (AddressCredentialV2) tests ────────────────────────────────────

    #[test]
    fn v2_ed25519_credential_fields_are_correct() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account_address(3),
                nonce: 77,
                signature_expiration_ledger: 500,
                signature: ScVal::Bool(true), // non-Void → signed
            }),
            root_invocation: root_invocation(contract_address(9)),
        };
        let cred = AddressCredentialV2::from_entry(&entry).expect("address credential");
        assert_eq!(cred.auth_type, AuthorizationType::Ed25519);
        assert!(cred.address.starts_with('G'));
        assert!(cred.contract_id.is_none());
        assert_eq!(cred.nonce, 77);
        assert_eq!(cred.signature_expiration_ledger, 500);
        assert!(cred.signed);
    }

    #[test]
    fn v2_smart_wallet_credential_fields_are_correct() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: contract_address(5),
                nonce: -3,
                signature_expiration_ledger: 9999,
                signature: ScVal::Void, // unsigned
            }),
            root_invocation: root_invocation(contract_address(8)),
        };
        let cred = AddressCredentialV2::from_entry(&entry).expect("address credential");
        assert_eq!(cred.auth_type, AuthorizationType::SmartWallet);
        assert!(cred.address.starts_with('C'));
        assert_eq!(cred.contract_id.as_deref(), Some(cred.address.as_str()));
        assert_eq!(cred.nonce, -3);
        assert_eq!(cred.signature_expiration_ledger, 9999);
        assert!(!cred.signed);
    }

    #[test]
    fn v2_source_account_yields_none() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::SourceAccount,
            root_invocation: root_invocation(contract_address(1)),
        };
        assert!(AddressCredentialV2::from_entry(&entry).is_none());
    }

    #[test]
    fn v2_display_includes_all_fields() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account_address(1),
                nonce: 42,
                signature_expiration_ledger: 1000,
                signature: ScVal::Bool(true),
            }),
            root_invocation: root_invocation(contract_address(2)),
        };
        let cred = AddressCredentialV2::from_entry(&entry).unwrap();
        let display = cred.to_string();
        assert!(display.contains("Address:"));
        assert!(display.contains("Nonce:"));
        assert!(display.contains("Expires Ledger:"));
        assert!(display.contains("Signed:"));
    }

    #[test]
    fn v2_round_trips_through_base64() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account_address(10),
                nonce: 555,
                signature_expiration_ledger: 2000,
                signature: ScVal::Void,
            }),
            root_invocation: root_invocation(contract_address(11)),
        };
        let b64 = XdrCodec::to_xdr_base64(&entry).expect("encode");
        let cred = AddressCredentialV2::from_auth_entry_base64(&b64)
            .expect("decode")
            .expect("address credential");
        assert_eq!(cred.nonce, 555);
        assert_eq!(cred.signature_expiration_ledger, 2000);
        assert!(!cred.signed);
    }

    #[test]
    fn v2_serializes_to_json() {
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account_address(7),
                nonce: 1,
                signature_expiration_ledger: 100,
                signature: ScVal::Void,
            }),
            root_invocation: root_invocation(contract_address(2)),
        };
        let cred = AddressCredentialV2::from_entry(&entry).unwrap();
        let json = serde_json::to_string(&cred).expect("serialize");
        assert!(json.contains("address"));
        assert!(json.contains("nonce"));
        assert!(json.contains("signature_expiration_ledger"));
    }
}

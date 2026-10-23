use serde::{Deserialize, Serialize};
use stellar_xdr::curr::{
    MuxedAccount, Operation, ScVal, SorobanAuthorizationEntry, SorobanResources,
    TransactionEnvelope, TransactionExt,
};

use crate::xdr::codec::XdrCodec;

// ---------------------------------------------------------------------------
// ScVal-level comparison (existing)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum ScValPathSegment {
    MapKey(ScVal),
    VecIndex(usize),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScValChange {
    pub path: Vec<ScValPathSegment>,
    pub old: Option<ScVal>,
    pub new: Option<ScVal>,
}

pub fn compare_scval(old: &ScVal, new: &ScVal) -> Option<Vec<ScValChange>> {
    let mut changes = Vec::new();
    compare_at(old, new, &mut Vec::new(), &mut changes);
    (!changes.is_empty()).then_some(changes)
}

fn compare_at(
    old: &ScVal,
    new: &ScVal,
    path: &mut Vec<ScValPathSegment>,
    changes: &mut Vec<ScValChange>,
) {
    if old == new {
        return;
    }

    match (old, new) {
        (ScVal::Map(Some(old_map)), ScVal::Map(Some(new_map))) => {
            for old_entry in old_map.iter() {
                path.push(ScValPathSegment::MapKey(old_entry.key.clone()));
                if let Some(new_entry) = new_map.iter().find(|entry| entry.key == old_entry.key) {
                    compare_at(&old_entry.val, &new_entry.val, path, changes);
                } else {
                    changes.push(ScValChange {
                        path: path.clone(),
                        old: Some(old_entry.val.clone()),
                        new: None,
                    });
                }
                path.pop();
            }

            for new_entry in new_map.iter() {
                if !old_map.iter().any(|entry| entry.key == new_entry.key) {
                    path.push(ScValPathSegment::MapKey(new_entry.key.clone()));
                    changes.push(ScValChange {
                        path: path.clone(),
                        old: None,
                        new: Some(new_entry.val.clone()),
                    });
                    path.pop();
                }
            }
        }
        (ScVal::Vec(Some(old_vec)), ScVal::Vec(Some(new_vec))) => {
            for index in 0..old_vec.len().max(new_vec.len()) {
                path.push(ScValPathSegment::VecIndex(index));
                match (old_vec.get(index), new_vec.get(index)) {
                    (Some(old_value), Some(new_value)) => {
                        compare_at(old_value, new_value, path, changes);
                    }
                    (Some(old_value), None) => changes.push(ScValChange {
                        path: path.clone(),
                        old: Some(old_value.clone()),
                        new: None,
                    }),
                    (None, Some(new_value)) => changes.push(ScValChange {
                        path: path.clone(),
                        old: None,
                        new: Some(new_value.clone()),
                    }),
                    (None, None) => unreachable!(),
                }
                path.pop();
            }
        }
        _ => changes.push(ScValChange {
            path: path.clone(),
            old: Some(old.clone()),
            new: Some(new.clone()),
        }),
    }
}

// ---------------------------------------------------------------------------
// Transaction-level diff
// ---------------------------------------------------------------------------

/// The kind of field that changed between two transactions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxDiffField {
    /// The source account (MuxedAccount) changed.
    SourceAccount,
    /// The transaction fee changed.
    Fee,
    /// The transaction sequence number changed.
    SequenceNumber,
    /// The memo changed.
    Memo,
    /// An operation was added, removed, or modified.
    Operation { index: usize },
    /// Soroban resources (CPU, memory, footprint) changed.
    Resources,
    /// A Soroban authorization entry was added, removed, or modified.
    AuthEntry { index: usize },
    /// The transaction extension version changed.
    Ext,
}

/// A single difference between two transactions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxDiffEntry {
    /// Which field changed.
    pub field: TxDiffField,
    /// The old value as a debug string (None if field was added).
    pub before: Option<String>,
    /// The new value as a debug string (None if field was removed).
    pub after: Option<String>,
}

/// A structured diff between two transactions, machine-readable and
/// serializable.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransactionDiff {
    /// The list of differences found. Empty if the transactions are identical.
    pub differences: Vec<TxDiffEntry>,
    /// `true` if no differences were found.
    pub is_identical: bool,
}

impl TransactionDiff {
    /// Compare two base64-encoded `TransactionEnvelope` XDR blobs.
    pub fn from_base64(old_b64: &str, new_b64: &str) -> crate::error::GratResult<Self> {
        let old = TransactionEnvelope::from_xdr_base64(old_b64)?;
        let new = TransactionEnvelope::from_xdr_base64(new_b64)?;
        Ok(Self::compare(&old, &new))
    }

    /// Compare two decoded `TransactionEnvelope` values and produce a
    /// structured diff highlighting differences in source account, fees,
    /// operations, resources, and auth entries.
    pub fn compare(old: &TransactionEnvelope, new: &TransactionEnvelope) -> Self {
        let mut differences = Vec::new();

        // Compare envelope types first.
        let old_is_fee_bump = matches!(old, TransactionEnvelope::TxFeeBump(_));
        let new_is_fee_bump = matches!(new, TransactionEnvelope::TxFeeBump(_));
        if old_is_fee_bump != new_is_fee_bump {
            differences.push(TxDiffEntry {
                field: TxDiffField::Ext,
                before: Some(format!("{old_is_fee_bump}")),
                after: Some(format!("{new_is_fee_bump}")),
            });
            return Self {
                differences,
                is_identical: false,
            };
        }

        let (old_tx, old_auth) = extract_tx_view_and_auth(old);
        let (new_tx, new_auth) = extract_tx_view_and_auth(new);

        // Source account
        if old_tx.source_account != new_tx.source_account {
            differences.push(TxDiffEntry {
                field: TxDiffField::SourceAccount,
                before: Some(muxed_account_to_string(&old_tx.source_account)),
                after: Some(muxed_account_to_string(&new_tx.source_account)),
            });
        }

        // Fee
        if old_tx.fee != new_tx.fee {
            differences.push(TxDiffEntry {
                field: TxDiffField::Fee,
                before: Some(old_tx.fee.to_string()),
                after: Some(new_tx.fee.to_string()),
            });
        }

        // Sequence number
        if old_tx.seq_num != new_tx.seq_num {
            differences.push(TxDiffEntry {
                field: TxDiffField::SequenceNumber,
                before: Some(old_tx.seq_num.0.to_string()),
                after: Some(new_tx.seq_num.0.to_string()),
            });
        }

        // Memo
        if old_tx.memo != new_tx.memo {
            differences.push(TxDiffEntry {
                field: TxDiffField::Memo,
                before: Some(format!("{:?}", old_tx.memo)),
                after: Some(format!("{:?}", new_tx.memo)),
            });
        }

        // Extension version
        if !matches!(old_tx.ext, TransactionExt::V0) || !matches!(new_tx.ext, TransactionExt::V0) {
            differences.push(TxDiffEntry {
                field: TxDiffField::Ext,
                before: Some(format!("{:?}", old_tx.ext)),
                after: Some(format!("{:?}", new_tx.ext)),
            });
        }

        // Operations
        compare_operations(old_tx.operations, new_tx.operations, &mut differences);

        // Auth entries
        compare_auth_entries(&old_auth, &new_auth, &mut differences);

        let is_identical = differences.is_empty();
        Self {
            differences,
            is_identical,
        }
    }
}

impl std::fmt::Display for TransactionDiff {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.is_identical {
            return write!(f, "Transactions are identical.");
        }
        for diff in &self.differences {
            match &diff.field {
                TxDiffField::SourceAccount => {
                    writeln!(
                        f,
                        "  🔑 Source Account: {} → {}",
                        diff.before.as_deref().unwrap_or("(none)"),
                        diff.after.as_deref().unwrap_or("(none)")
                    )?;
                }
                TxDiffField::Fee => {
                    writeln!(
                        f,
                        "  💰 Fee: {} → {}",
                        diff.before.as_deref().unwrap_or("(none)"),
                        diff.after.as_deref().unwrap_or("(none)")
                    )?;
                }
                TxDiffField::SequenceNumber => {
                    writeln!(
                        f,
                        "  🔢 Sequence: {} → {}",
                        diff.before.as_deref().unwrap_or("(none)"),
                        diff.after.as_deref().unwrap_or("(none)")
                    )?;
                }
                TxDiffField::Memo => {
                    writeln!(
                        f,
                        "  📝 Memo: {} → {}",
                        diff.before.as_deref().unwrap_or("(none)"),
                        diff.after.as_deref().unwrap_or("(none)")
                    )?;
                }
                TxDiffField::Operation { index } => {
                    if diff.before.is_none() {
                        writeln!(f, "  ➕ Operation [{index}] added: {}", diff.after.as_deref().unwrap_or(""))?;
                    } else if diff.after.is_none() {
                        writeln!(f, "  ➖ Operation [{index}] removed: {}", diff.before.as_deref().unwrap_or(""))?;
                    } else {
                        writeln!(f, "  ✏️  Operation [{index}] changed:")?;
                        writeln!(f, "      before: {}", diff.before.as_deref().unwrap_or(""))?;
                        writeln!(f, "      after:  {}", diff.after.as_deref().unwrap_or(""))?;
                    }
                }
                TxDiffField::Resources => {
                    writeln!(
                        f,
                        "  📊 Resources: {} → {}",
                        diff.before.as_deref().unwrap_or("(none)"),
                        diff.after.as_deref().unwrap_or("(none)")
                    )?;
                }
                TxDiffField::AuthEntry { index } => {
                    if diff.before.is_none() {
                        writeln!(f, "  ➕ Auth [{index}] added: {}", diff.after.as_deref().unwrap_or(""))?;
                    } else if diff.after.is_none() {
                        writeln!(f, "  ➖ Auth [{index}] removed: {}", diff.before.as_deref().unwrap_or(""))?;
                    } else {
                        writeln!(f, "  ✏️  Auth [{index}] changed:")?;
                        writeln!(f, "      before: {}", diff.before.as_deref().unwrap_or(""))?;
                        writeln!(f, "      after:  {}", diff.after.as_deref().unwrap_or(""))?;
                    }
                }
                TxDiffField::Ext => {
                    writeln!(
                        f,
                        "  🔧 Ext: {} → {}",
                        diff.before.as_deref().unwrap_or("(none)"),
                        diff.after.as_deref().unwrap_or("(none)")
                    )?;
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// A minimal view over a transaction's envelope-level fields, normalised so
/// that both `TxV0` and `Tx` envelopes can be compared with a single code
/// path.
struct TxView<'a> {
    source_account: MuxedAccount,
    fee: u32,
    seq_num: stellar_xdr::curr::SequenceNumber,
    memo: stellar_xdr::curr::Memo,
    operations: &'a [Operation],
    ext: &'a TransactionExt,
}

/// Extract a normalised [`TxView`] and the associated Soroban auth entries
/// from any `TransactionEnvelope` variant.
fn extract_tx_view_and_auth(
    envelope: &TransactionEnvelope,
) -> (TxView<'_>, Vec<SorobanAuthorizationEntry>) {
    match envelope {
        TransactionEnvelope::TxV0(v0) => {
            // TxV0 uses a plain ed25519 key, not a MuxedAccount.
            let source = MuxedAccount::Ed25519(v0.tx.source_account_ed25519);
            let view = TxView {
                source_account: source,
                fee: v0.tx.fee,
                seq_num: v0.tx.seq_num,
                memo: v0.tx.memo.clone(),
                operations: v0.tx.operations.as_slice(),
                // TxV0 has no TransactionExt — treat as V0.
                ext: &STATIC_V0_EXT,
            };
            (view, Vec::new())
        }
        TransactionEnvelope::Tx(v1) => {
            let auth = extract_auth_from_ext(&v1.tx.ext);
            let view = TxView {
                source_account: v1.tx.source_account.clone(),
                fee: v1.tx.fee,
                seq_num: v1.tx.seq_num,
                memo: v1.tx.memo.clone(),
                operations: v1.tx.operations.as_slice(),
                ext: &v1.tx.ext,
            };
            (view, auth)
        }
        TransactionEnvelope::TxFeeBump(fee_bump) => {
            match &fee_bump.tx.inner_tx {
                stellar_xdr::curr::FeeBumpTransactionInnerTx::Tx(inner) => {
                    let auth = extract_auth_from_ext(&inner.tx.ext);
                    let view = TxView {
                        source_account: inner.tx.source_account.clone(),
                        fee: inner.tx.fee,
                        seq_num: inner.tx.seq_num,
                        memo: inner.tx.memo.clone(),
                        operations: inner.tx.operations.as_slice(),
                        ext: &inner.tx.ext,
                    };
                    (view, auth)
                }
            }
        }
    }
}

/// A static `TransactionExt::V0` used when diffing `TxV0` envelopes that
/// carry no extension.
static STATIC_V0_EXT: TransactionExt = TransactionExt::V0;

/// Extract Soroban authorization entries from a `TransactionExt`.
fn extract_auth_from_ext(ext: &TransactionExt) -> Vec<SorobanAuthorizationEntry> {
    match ext {
        TransactionExt::V0 => Vec::new(),
        TransactionExt::V1(soroban) => soroban.auth.as_vec().to_vec(),
    }
}

/// Extract Soroban resources from a `TransactionExt`.
fn extract_resources_from_ext(ext: &TransactionExt) -> Option<&SorobanResources> {
    match ext {
        TransactionExt::V0 => None,
        TransactionExt::V1(soroban) => Some(&soroban.resources),
    }
}

fn muxed_account_to_string(account: &MuxedAccount) -> String {
    match account {
        MuxedAccount::Ed25519(bytes) => {
            stellar_strkey::ed25519::PublicKey(bytes.0).to_string()
        }
        MuxedAccount::MuxedEd25519(m) => {
            // Format as G... key from the underlying ed25519 bytes.
            stellar_strkey::ed25519::PublicKey(m.ed25519.0).to_string()
        }
    }
}

fn compare_operations(
    old: &[Operation],
    new: &[Operation],
    differences: &mut Vec<TxDiffEntry>,
) {
    let shared_len = old.len().min(new.len());
    for i in 0..shared_len {
        if old[i] != new[i] {
            differences.push(TxDiffEntry {
                field: TxDiffField::Operation { index: i },
                before: Some(format!("{:?}", old[i])),
                after: Some(format!("{:?}", new[i])),
            });
        }
    }
    for (i, op) in old.iter().enumerate().skip(shared_len) {
        differences.push(TxDiffEntry {
            field: TxDiffField::Operation { index: i },
            before: Some(format!("{op:?}")),
            after: None,
        });
    }
    for (i, op) in new.iter().enumerate().skip(shared_len) {
        differences.push(TxDiffEntry {
            field: TxDiffField::Operation { index: i },
            before: None,
            after: Some(format!("{op:?}")),
        });
    }
}

fn compare_auth_entries(
    old: &[SorobanAuthorizationEntry],
    new: &[SorobanAuthorizationEntry],
    differences: &mut Vec<TxDiffEntry>,
) {
    let shared_len = old.len().min(new.len());
    for i in 0..shared_len {
        if old[i] != new[i] {
            differences.push(TxDiffEntry {
                field: TxDiffField::AuthEntry { index: i },
                before: Some(format!("{:?}", old[i])),
                after: Some(format!("{:?}", new[i])),
            });
        }
    }
    for (i, entry) in old.iter().enumerate().skip(shared_len) {
        differences.push(TxDiffEntry {
            field: TxDiffField::AuthEntry { index: i },
            before: Some(format!("{entry:?}")),
            after: None,
        });
    }
    for (i, entry) in new.iter().enumerate().skip(shared_len) {
        differences.push(TxDiffEntry {
            field: TxDiffField::AuthEntry { index: i },
            before: None,
            after: Some(format!("{entry:?}")),
        });
    }
}

/// Compare the Soroban resources of two transactions and add differences to
/// the diff entries.
pub fn compare_resources(
    old: Option<&SorobanResources>,
    new: Option<&SorobanResources>,
    differences: &mut Vec<TxDiffEntry>,
) {
    match (old, new) {
        (Some(old_r), Some(new_r)) => {
            if old_r != new_r {
                differences.push(TxDiffEntry {
                    field: TxDiffField::Resources,
                    before: Some(format!("{old_r:?}")),
                    after: Some(format!("{new_r:?}")),
                });
            }
        }
        (Some(old_r), None) => {
            differences.push(TxDiffEntry {
                field: TxDiffField::Resources,
                before: Some(format!("{old_r:?}")),
                after: None,
            });
        }
        (None, Some(new_r)) => {
            differences.push(TxDiffEntry {
                field: TxDiffField::Resources,
                before: None,
                after: Some(format!("{new_r:?}")),
            });
        }
        (None, None) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::curr::{
        Memo, Preconditions, SequenceNumber, Transaction, TransactionExt,
        TransactionV1Envelope, Uint256,
    };

    fn make_envelope(fee: u32, seq: i64) -> TransactionEnvelope {
        TransactionEnvelope::Tx(TransactionV1Envelope {
            tx: Transaction {
                source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
                fee,
                seq_num: SequenceNumber(seq),
                cond: Preconditions::None,
                memo: Memo::None,
                operations: vec![].try_into().unwrap(),
                ext: TransactionExt::V0,
            },
            signatures: vec![].try_into().unwrap(),
        })
    }

    #[test]
    fn identical_envelopes_produce_no_diff() {
        let tx = make_envelope(100, 1);
        let diff = TransactionDiff::compare(&tx, &tx);
        assert!(diff.is_identical);
        assert!(diff.differences.is_empty());
    }

    #[test]
    fn fee_difference_is_detected() {
        let old = make_envelope(100, 1);
        let new = make_envelope(200, 1);
        let diff = TransactionDiff::compare(&old, &new);
        assert!(!diff.is_identical);
        assert!(diff.differences.iter().any(|d| d.field == TxDiffField::Fee));
        let fee_diff = diff
            .differences
            .iter()
            .find(|d| d.field == TxDiffField::Fee)
            .unwrap();
        assert_eq!(fee_diff.before.as_deref(), Some("100"));
        assert_eq!(fee_diff.after.as_deref(), Some("200"));
    }

    #[test]
    fn sequence_number_difference_is_detected() {
        let old = make_envelope(100, 1);
        let new = make_envelope(100, 2);
        let diff = TransactionDiff::compare(&old, &new);
        assert!(diff
            .differences
            .iter()
            .any(|d| matches!(d.field, TxDiffField::SequenceNumber)));
    }

    #[test]
    fn source_account_difference_is_detected() {
        let mut old = make_envelope(100, 1);
        let mut new = make_envelope(100, 1);
        if let TransactionEnvelope::Tx(ref mut tx) = new {
            tx.tx.source_account = MuxedAccount::Ed25519(Uint256([1; 32]));
        }
        let diff = TransactionDiff::compare(&old, &new);
        assert!(diff
            .differences
            .iter()
            .any(|d| matches!(d.field, TxDiffField::SourceAccount)));
    }

    #[test]
    fn diff_is_serializable() {
        let old = make_envelope(100, 1);
        let new = make_envelope(200, 1);
        let diff = TransactionDiff::compare(&old, &new);
        let json = serde_json::to_string(&diff).expect("serialize");
        assert!(json.contains("fee"));
    }

    #[test]
    fn display_output_is_human_readable() {
        let old = make_envelope(100, 1);
        let new = make_envelope(200, 1);
        let diff = TransactionDiff::compare(&old, &new);
        let output = diff.to_string();
        assert!(output.contains("Fee"));
        assert!(output.contains("100"));
        assert!(output.contains("200"));
    }

    #[test]
    fn round_trip_through_base64() {
        let old = make_envelope(100, 1);
        let new = make_envelope(200, 1);
        let old_b64 = XdrCodec::to_xdr_base64(&old).unwrap();
        let new_b64 = XdrCodec::to_xdr_base64(&new).unwrap();
        let diff = TransactionDiff::from_base64(&old_b64, &new_b64).unwrap();
        assert!(!diff.is_identical);
        assert!(diff.differences.iter().any(|d| d.field == TxDiffField::Fee));
    }
}

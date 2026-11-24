use crate::error::GratResult;
use crate::types::report::FeeBreakdown;
use crate::xdr::codec::XdrCodec;
use serde::{Deserialize, Serialize};
use stellar_xdr::curr::{TransactionEnvelope, TransactionMeta, TransactionResult};

/// A per-resource fee attribution entry.
///
/// Breaks down the resource fee into costs attributed to specific resource
/// types (storage read, storage write, CPU instructions, memory bytes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceFeeAttribution {
    /// Human-readable resource type (e.g. "Storage Read", "CPU Instructions").
    pub resource_type: ResourceType,
    /// Fee attributed to this resource, in stroops.
    pub cost: i64,
}

/// The resource types that fees are attributed to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResourceType {
    /// Storage read operations.
    StorageRead,
    /// Storage write operations.
    StorageWrite,
    /// CPU instruction execution.
    CpuInstructions,
    /// Memory byte consumption.
    MemoryBytes,
}

impl ResourceType {
    /// Human-readable label for the resource type.
    pub fn label(&self) -> &'static str {
        match self {
            Self::StorageRead => "Storage Read",
            Self::StorageWrite => "Storage Write",
            Self::CpuInstructions => "CPU Instructions",
            Self::MemoryBytes => "Memory Bytes",
        }
    }
}

/// Per-resource fee breakdown with attribution and highlight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeBreakdownWithAttribution {
    /// The base fee breakdown (unchanged from existing API).
    #[serde(flatten)]
    pub base: FeeBreakdown,
    /// Per-resource fee costs.
    pub resource_costs: Vec<ResourceFeeAttribution>,
    /// The most expensive resource type, if any resource costs are present.
    pub most_expensive_resource: Option<ResourceType>,
}

pub fn analyze_fee_breakdown(tx_data: &serde_json::Value) -> FeeBreakdown {
    let total_fee = tx_data
        .get("resultXdr")
        .and_then(|v| v.as_str())
        .and_then(parse_total_fee)
        .unwrap_or(0);

    let bid_fee = tx_data
        .get("envelopeXdr")
        .and_then(|v| v.as_str())
        .and_then(parse_bid_fee)
        .or_else(|| tx_data.get("feeBid")?.as_i64());

    let (non_refundable_fee, refundable_resource_fee, rent_fee, has_soroban_resource_fee) = tx_data
        .get("resourceFee")
        .and_then(serde_json::Value::as_object)
        .map_or_else(
            || parse_resource_fee_from_meta(tx_data),
            parse_resource_fee_object,
        );

    let resource_fee = if has_soroban_resource_fee {
        non_refundable_fee + refundable_resource_fee + rent_fee
    } else {
        0
    };

    let inclusion_fee = tx_data
        .get("inclusionFee")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_else(|| {
            if resource_fee > 0 {
                total_fee.saturating_sub(resource_fee)
            } else {
                total_fee
            }
        });

    FeeBreakdown {
        total_charged_fee: total_fee,
        inclusion_fee,
        resource_fee,
        refundable_resource_fee,
        refundable_fee: refundable_resource_fee + rent_fee,
        non_refundable_fee,
        bid_fee,
    }
}

/// Analyze the fee breakdown with per-resource cost attribution.
///
/// Parses the transaction result and metadata to attribute the resource fee
/// to specific resource types (storage read, storage write, CPU, memory).
/// Returns the base [`FeeBreakdown`] plus a list of per-resource costs and
/// a highlight of the most expensive resource.
pub fn analyze_fee_breakdown_with_attribution(
    tx_data: &serde_json::Value,
) -> FeeBreakdownWithAttribution {
    let base = analyze_fee_breakdown(tx_data);

    // Extract resource usage metrics from the transaction data.
    // The Soroban transaction meta contains cost information that lets us
    // attribute the non-refundable resource fee to CPU and memory, and the
    // refundable resource fee to storage read/write operations.
    let (cpu_used, mem_used, read_bytes, write_bytes) = extract_resource_usage(tx_data);

    let non_refundable = base.non_refundable_fee;
    let refundable = base.refundable_resource_fee;

    let mut resource_costs = Vec::new();

    if non_refundable > 0 {
        // Attribute non-refundable fee between CPU and memory based on usage.
        let total_units = cpu_used.saturating_add(mem_used);
        if total_units > 0 {
            let cpu_cost = (non_refundable as u128 * cpu_used as u128 / total_units as u128) as i64;
            let mem_cost = non_refundable - cpu_cost;
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::CpuInstructions,
                cost: cpu_cost,
            });
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::MemoryBytes,
                cost: mem_cost,
            });
        } else {
            // No usage data — split evenly as a fallback.
            let half = non_refundable / 2;
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::CpuInstructions,
                cost: half,
            });
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::MemoryBytes,
                cost: non_refundable - half,
            });
        }
    }

    if refundable > 0 {
        // Attribute refundable fee between storage read and write based on bytes.
        let total_bytes = read_bytes.saturating_add(write_bytes);
        if total_bytes > 0 {
            let read_cost = (refundable as u128 * read_bytes as u128 / total_bytes as u128) as i64;
            let write_cost = refundable - read_cost;
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::StorageRead,
                cost: read_cost,
            });
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::StorageWrite,
                cost: write_cost,
            });
        } else {
            // No byte data — split evenly as a fallback.
            let half = refundable / 2;
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::StorageRead,
                cost: half,
            });
            resource_costs.push(ResourceFeeAttribution {
                resource_type: ResourceType::StorageWrite,
                cost: refundable - half,
            });
        }
    }

    // Find the most expensive resource.
    let most_expensive_resource = resource_costs
        .iter()
        .max_by_key(|r| r.cost)
        .filter(|r| r.cost > 0)
        .map(|r| r.resource_type.clone());

    FeeBreakdownWithAttribution {
        base,
        resource_costs,
        most_expensive_resource,
    }
}

/// Extract resource usage metrics (CPU instructions, memory bytes, read bytes,
/// write bytes) from the transaction data.
///
/// Tries `resourcesConsumed` first (from diagnostic events), then falls back
/// to `resourcesAllocated` as an approximation.
fn extract_resource_usage(tx_data: &serde_json::Value) -> (u64, u64, u64, u64) {
    let mut cpu = 0u64;
    let mut mem = 0u64;
    let mut read = 0u64;
    let mut write = 0u64;

    // Try resourcesConsumed first.
    if let Some(consumed) = tx_data.get("resourcesConsumed") {
        cpu = consumed
            .get("cpuInstructions")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        mem = consumed
            .get("memoryBytes")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        read = consumed
            .get("readBytes")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        write = consumed
            .get("writeBytes")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
    }

    // Fall back to resourcesAllocated if consumed is zero.
    if cpu == 0 && mem == 0 && read == 0 && write == 0 {
        if let Some(allocated) = tx_data.get("resourcesAllocated") {
            cpu = allocated
                .get("cpuInstructions")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            mem = allocated
                .get("memoryBytes")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            read = allocated
                .get("readBytes")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            write = allocated
                .get("writeBytes")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
        }
    }

    // Try diagnostic events for budget data.
    if cpu == 0 {
        if let Some(events) = tx_data.get("diagnosticEvents").and_then(|e| e.as_array()) {
            for event in events {
                if event.get("type").and_then(|t| t.as_str()) == Some("budget") {
                    if let Some(data) = event.get("data") {
                        let category = data
                            .get("category")
                            .and_then(|c| c.as_str())
                            .unwrap_or("");
                        let used = data
                            .get("used")
                            .and_then(serde_json::Value::as_u64)
                            .unwrap_or(0);
                        match category {
                            "cpu" => cpu = used,
                            "memory" => mem = used,
                            "read" => read = used,
                            "write" => write = used,
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    (cpu, mem, read, write)
}

pub fn inject_fee_metadata(tx_data: &mut serde_json::Value) -> GratResult<()> {
    let breakdown = analyze_fee_breakdown(tx_data);

    tx_data["inclusionFee"] = serde_json::json!(breakdown.inclusion_fee);
    if breakdown.resource_fee > 0 {
        tx_data["resourceFee"] = serde_json::json!({
            "totalNonRefundableResourceFeeCharged": breakdown.non_refundable_fee,
            "totalRefundableResourceFeeCharged": breakdown.refundable_resource_fee,
            "rentFeeCharged": breakdown.refundable_fee.saturating_sub(breakdown.refundable_resource_fee),
        });
    }

    Ok(())
}

fn parse_total_fee(result_xdr_b64: &str) -> Option<i64> {
    TransactionResult::from_xdr_base64(result_xdr_b64)
        .ok()
        .map(|result| result.fee_charged)
}

fn parse_bid_fee(envelope_xdr_b64: &str) -> Option<i64> {
    let tx_envelope = TransactionEnvelope::from_xdr_base64(envelope_xdr_b64).ok()?;
    Some(match tx_envelope {
        TransactionEnvelope::Tx(v1) => i64::from(v1.tx.fee),
        TransactionEnvelope::TxFeeBump(fee_bump) => fee_bump.tx.fee,
        TransactionEnvelope::TxV0(v0) => i64::from(v0.tx.fee),
    })
}

fn parse_resource_fee_object(
    resource_fee_obj: &serde_json::Map<String, serde_json::Value>,
) -> (i64, i64, i64, bool) {
    (
        resource_fee_obj
            .get("totalNonRefundableResourceFeeCharged")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0),
        resource_fee_obj
            .get("totalRefundableResourceFeeCharged")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0),
        resource_fee_obj
            .get("rentFeeCharged")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0),
        true,
    )
}

fn parse_resource_fee_from_meta(tx_data: &serde_json::Value) -> (i64, i64, i64, bool) {
    let Some(meta_xdr_b64) = tx_data.get("resultMetaXdr").and_then(|v| v.as_str()) else {
        return (0, 0, 0, false);
    };

    let Ok(TransactionMeta::V3(v3)) = TransactionMeta::from_xdr_base64(meta_xdr_b64) else {
        return (0, 0, 0, false);
    };

    let Some(soroban_meta) = v3.soroban_meta else {
        return (0, 0, 0, false);
    };

    match soroban_meta.ext {
        stellar_xdr::curr::SorobanTransactionMetaExt::V0 => (0, 0, 0, false),
        stellar_xdr::curr::SorobanTransactionMetaExt::V1(v1) => (
            v1.total_non_refundable_resource_fee_charged,
            v1.total_refundable_resource_fee_charged,
            v1.rent_fee_charged,
            true,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xdr::codec::XdrCodec;
    use stellar_xdr::curr::{
        ExtensionPoint, Memo, MuxedAccount, Preconditions, SequenceNumber, SorobanTransactionMeta,
        SorobanTransactionMetaExt, SorobanTransactionMetaExtV1, Transaction, TransactionEnvelope,
        TransactionExt, TransactionMeta, TransactionMetaV3, TransactionResult,
        TransactionResultResult, TransactionV1Envelope, Uint256,
    };

    #[test]
    fn analyzes_non_soroban_fee_breakdown() {
        let tx = Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
            fee: 150,
            seq_num: SequenceNumber(1),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![].try_into().unwrap(),
            ext: TransactionExt::V0,
        };
        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: vec![].try_into().unwrap(),
        });
        let envelope_xdr = envelope.to_xdr_base64().unwrap();

        let result = TransactionResult {
            fee_charged: 120,
            result: TransactionResultResult::TxSuccess(vec![].try_into().unwrap()),
            ext: stellar_xdr::curr::TransactionResultExt::V0,
        };
        let result_xdr = result.to_xdr_base64().unwrap();

        let tx_data = serde_json::json!({
            "envelopeXdr": envelope_xdr,
            "resultXdr": result_xdr,
        });

        let breakdown = analyze_fee_breakdown(&tx_data);
        assert_eq!(breakdown.total_charged_fee, 120);
        assert_eq!(breakdown.bid_fee, Some(150));
        assert_eq!(breakdown.inclusion_fee, 120);
        assert_eq!(breakdown.resource_fee, 0);
        assert_eq!(breakdown.refundable_resource_fee, 0);
        assert_eq!(breakdown.refundable_fee, 0);
        assert_eq!(breakdown.non_refundable_fee, 0);
    }

    #[test]
    fn analyzes_soroban_fee_breakdown() {
        let tx = Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
            fee: 500,
            seq_num: SequenceNumber(1),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![].try_into().unwrap(),
            ext: TransactionExt::V0,
        };
        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: vec![].try_into().unwrap(),
        });
        let envelope_xdr = envelope.to_xdr_base64().unwrap();

        let result = TransactionResult {
            fee_charged: 450,
            result: TransactionResultResult::TxSuccess(vec![].try_into().unwrap()),
            ext: stellar_xdr::curr::TransactionResultExt::V0,
        };
        let result_xdr = result.to_xdr_base64().unwrap();

        let meta = TransactionMeta::V3(TransactionMetaV3 {
            ext: ExtensionPoint::V0,
            tx_changes_before: vec![].try_into().unwrap(),
            operations: vec![].try_into().unwrap(),
            tx_changes_after: vec![].try_into().unwrap(),
            soroban_meta: Some(SorobanTransactionMeta {
                ext: SorobanTransactionMetaExt::V1(SorobanTransactionMetaExtV1 {
                    ext: ExtensionPoint::V0,
                    total_non_refundable_resource_fee_charged: 100,
                    total_refundable_resource_fee_charged: 200,
                    rent_fee_charged: 50,
                }),
                events: vec![].try_into().unwrap(),
                return_value: stellar_xdr::curr::ScVal::Void,
                diagnostic_events: vec![].try_into().unwrap(),
            }),
        });
        let meta_xdr = meta.to_xdr_base64().unwrap();

        let tx_data = serde_json::json!({
            "envelopeXdr": envelope_xdr,
            "resultXdr": result_xdr,
            "resultMetaXdr": meta_xdr,
        });

        let breakdown = analyze_fee_breakdown(&tx_data);
        assert_eq!(breakdown.total_charged_fee, 450);
        assert_eq!(breakdown.bid_fee, Some(500));
        assert_eq!(breakdown.resource_fee, 350);
        assert_eq!(breakdown.inclusion_fee, 100);
        assert_eq!(breakdown.refundable_resource_fee, 200);
        assert_eq!(breakdown.refundable_fee, 250);
        assert_eq!(breakdown.non_refundable_fee, 100);
    }

    #[test]
    fn handles_insufficient_fee_surges() {
        let tx = Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
            fee: 400,
            seq_num: SequenceNumber(1),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![].try_into().unwrap(),
            ext: TransactionExt::V0,
        };
        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: vec![].try_into().unwrap(),
        });
        let envelope_xdr = envelope.to_xdr_base64().unwrap();

        let result = TransactionResult {
            fee_charged: 600,
            result: TransactionResultResult::TxSuccess(vec![].try_into().unwrap()),
            ext: stellar_xdr::curr::TransactionResultExt::V0,
        };
        let result_xdr = result.to_xdr_base64().unwrap();

        let tx_data = serde_json::json!({
            "envelopeXdr": envelope_xdr,
            "resultXdr": result_xdr,
        });

        let breakdown = analyze_fee_breakdown(&tx_data);
        assert_eq!(breakdown.total_charged_fee, 600);
        assert_eq!(breakdown.bid_fee, Some(400));
        assert_eq!(breakdown.inclusion_fee, 600);
        assert_eq!(breakdown.resource_fee, 0);
        assert_eq!(breakdown.refundable_fee, 0);
    }

    #[test]
    fn fee_attribution_splits_non_refundable_by_cpu_memory() {
        let tx = Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
            fee: 500,
            seq_num: SequenceNumber(1),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![].try_into().unwrap(),
            ext: TransactionExt::V0,
        };
        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: vec![].try_into().unwrap(),
        });
        let envelope_xdr = envelope.to_xdr_base64().unwrap();

        let result = TransactionResult {
            fee_charged: 450,
            result: TransactionResultResult::TxSuccess(vec![].try_into().unwrap()),
            ext: stellar_xdr::curr::TransactionResultExt::V0,
        };
        let result_xdr = result.to_xdr_base64().unwrap();

        let meta = TransactionMeta::V3(TransactionMetaV3 {
            ext: ExtensionPoint::V0,
            tx_changes_before: vec![].try_into().unwrap(),
            operations: vec![].try_into().unwrap(),
            tx_changes_after: vec![].try_into().unwrap(),
            soroban_meta: Some(SorobanTransactionMeta {
                ext: SorobanTransactionMetaExt::V1(SorobanTransactionMetaExtV1 {
                    ext: ExtensionPoint::V0,
                    total_non_refundable_resource_fee_charged: 100,
                    total_refundable_resource_fee_charged: 200,
                    rent_fee_charged: 50,
                }),
                events: vec![].try_into().unwrap(),
                return_value: stellar_xdr::curr::ScVal::Void,
                diagnostic_events: vec![].try_into().unwrap(),
            }),
        });
        let meta_xdr = meta.to_xdr_base64().unwrap();

        let tx_data = serde_json::json!({
            "envelopeXdr": envelope_xdr,
            "resultXdr": result_xdr,
            "resultMetaXdr": meta_xdr,
            "resourcesConsumed": {
                "cpuInstructions": 3000,
                "memoryBytes": 1000,
                "readBytes": 500,
                "writeBytes": 500,
            },
        });

        let attributed = analyze_fee_breakdown_with_attribution(&tx_data);

        // Non-refundable = 100, CPU:mem ratio = 3:1 → CPU=75, Mem=25.
        let cpu_cost = attributed
            .resource_costs
            .iter()
            .find(|r| r.resource_type == ResourceType::CpuInstructions)
            .map(|r| r.cost)
            .unwrap();
        let mem_cost = attributed
            .resource_costs
            .iter()
            .find(|r| r.resource_type == ResourceType::MemoryBytes)
            .map(|r| r.cost)
            .unwrap();
        assert_eq!(cpu_cost, 75);
        assert_eq!(mem_cost, 25);

        // Refundable = 200, read:write ratio = 1:1 → 100 each.
        let read_cost = attributed
            .resource_costs
            .iter()
            .find(|r| r.resource_type == ResourceType::StorageRead)
            .map(|r| r.cost)
            .unwrap();
        let write_cost = attributed
            .resource_costs
            .iter()
            .find(|r| r.resource_type == ResourceType::StorageWrite)
            .map(|r| r.cost)
            .unwrap();
        assert_eq!(read_cost, 100);
        assert_eq!(write_cost, 100);

        // CPU should be the most expensive resource (75 > others).
        assert_eq!(
            attributed.most_expensive_resource,
            Some(ResourceType::CpuInstructions)
        );
    }

    #[test]
    fn fee_attribution_handles_no_resource_fee() {
        let tx = Transaction {
            source_account: MuxedAccount::Ed25519(Uint256([0; 32])),
            fee: 150,
            seq_num: SequenceNumber(1),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![].try_into().unwrap(),
            ext: TransactionExt::V0,
        };
        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: vec![].try_into().unwrap(),
        });
        let envelope_xdr = envelope.to_xdr_base64().unwrap();

        let result = TransactionResult {
            fee_charged: 120,
            result: TransactionResultResult::TxSuccess(vec![].try_into().unwrap()),
            ext: stellar_xdr::curr::TransactionResultExt::V0,
        };
        let result_xdr = result.to_xdr_base64().unwrap();

        let tx_data = serde_json::json!({
            "envelopeXdr": envelope_xdr,
            "resultXdr": result_xdr,
        });

        let attributed = analyze_fee_breakdown_with_attribution(&tx_data);
        assert!(attributed.resource_costs.is_empty());
        assert_eq!(attributed.most_expensive_resource, None);
    }

    #[test]
    fn fee_attribution_falls_back_to_diagnostic_events() {
        let tx_data = serde_json::json!({
            "resultXdr": "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=",
            "diagnosticEvents": [
                {
                    "type": "budget",
                    "data": { "category": "cpu", "used": 10000, "limit": 50000 }
                },
                {
                    "type": "budget",
                    "data": { "category": "memory", "used": 5000, "limit": 20000 }
                }
            ],
            "resourcesConsumed": {
                "cpuInstructions": 10000,
                "memoryBytes": 5000,
                "readBytes": 2000,
                "writeBytes": 1000,
            }
        });

        let (cpu, mem, read, write) = extract_resource_usage(&tx_data);
        assert_eq!(cpu, 10000);
        assert_eq!(mem, 5000);
        assert_eq!(read, 2000);
        assert_eq!(write, 1000);
    }
}

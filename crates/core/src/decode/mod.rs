//! # Decode Module
//!
//! Provides comprehensive decoding functionality for Soroban contract invocations,
//! function arguments, error reports, call-chains, and resource diagnostics.
//!
//! ## Submodules
//! - [`argument_decoder`]: Typed decoding of contract function arguments.
//! - [`enum_decoder`]: Decoder for Soroban enums, Options, and Results.
//! - [`multi_op_decoder`]: Multi-operation transaction batch decoder.
//! - [`chain_analyzer`]: Reconstructs contract call chains and detects failure patterns.
//! - [`resource_analyzer`]: Analyzes CPU, memory, and storage resource limits.
//!
//! ## Example
//! ```rust,no_run
//! use grat_core::decode::ArgumentDecoder;
//!
//! let decoder = ArgumentDecoder::new();
//! let args = vec![];
//! let decoded = decoder.decode_dynamic(&args);
//! println!("Decoded {} arguments", decoded.len());
//! ```

pub mod argument_decoder;
pub mod auth;
pub mod auth_address_nonce;
pub mod auth_signature;
pub mod chain_analyzer;
pub mod contract_error;
pub mod contract_error_resolver;
pub mod cross_contract;
pub mod decode_context;
pub mod deepest_error;
pub mod diagnostic;
pub mod enum_decoder;
pub mod event_walker;
pub mod fee_analyzer;
pub mod function_call_decoder;
pub mod host_error;
pub mod json_to_scval;
pub mod mappings;
/// Envelope-level decoding that emits one diagnostic report per operation.
pub mod multi_op_decoder;
pub mod recursive_decoder;
pub mod report;
pub mod resource_analyzer;
pub mod return_decoder;
pub mod scval_to_json;
pub mod struct_decoder;
pub mod walker;

pub use argument_decoder::ArgumentDecoder;
pub use auth::{
    AddressCredential, AuthChain, AuthCredential, AuthFunctionKind, AuthInvocation,
    AuthorizationType,
};
pub use auth_address_nonce::AddressWithNonce;
pub use chain_analyzer::{analyze_call_chain, CallChain, ChainAnalyzer, ChainFrame, FrameRole};
pub use deepest_error::{find_deepest_error, DeepestError, DeepestErrorFinder};
pub use enum_decoder::EnumDecoder;
pub use function_call_decoder::{DecodedArgument, DecodedFunctionCall, FunctionCallDecoder};
pub use json_to_scval::json_to_scval;
pub use multi_op_decoder::{decode_transaction_with_op_filter, MultiOpDecoder};
pub use recursive_decoder::{RecursiveTypeDecoder, TypeRef};
pub use resource_analyzer::{
    MetricDiagnostic, MetricKind, ResourceDiagnostics, ResourceUsageAnalyzer, TransactionResultMeta,
};
pub use return_decoder::ReturnValueDecoder;
pub use scval_to_json::{scval_to_json, scval_to_json_with_contract_spec, scval_to_json_with_spec};
pub use struct_decoder::{StructDecodeReport, StructDecoder};
pub use walker::{
    walk_diagnostic_events, DiagnosticEventKind, DiagnosticEventWalker, StructuredDiagnosticEvent,
};

/// Decodes a transaction using the async cache with a cache-aside pattern, preventing blocking on cache I/O.
pub async fn decode_with_cache(
    cache: &crate::cache::async_cache::AsyncCache,
    tx_data: &serde_json::Value,
) -> crate::error::GratResult<Vec<crate::types::report::DiagnosticReport>> {
    let hash = tx_data
        .get("hash")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let cache_key = format!("decode_tx:{hash}");

    cache
        .get_or_compute(&cache_key, || async {
            let decoder = MultiOpDecoder::new();
            decoder.decode_transaction(tx_data)
        })
        .await
}

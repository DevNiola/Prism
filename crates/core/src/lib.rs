//! # Prism Core
//!
//! `grat_core` is Prism's execution, decoding, and analysis engine for Soroban smart contracts
//! on the Stellar network.
//!
//! ## Modules
//! - [`decode`]: Transaction decoding, argument parsing, multi-operation handling, and error diagnosis.
//! - [`replay`]: Transaction sandbox execution, state reconstruction, and resource profiling.
//! - [`debugger`]: Interactive breakpoint controller, stepping execution, and what-if simulation.
//! - [`taxonomy`]: Soroban error classification and taxonomy database.
//! - [`cache`]: Synchronous and asynchronous persistent caching.
//!
//! ## Example
//! ```rust,no_run
//! use grat_core::{VERSION, SOROBAN_PROTOCOL_VERSION};
//!
//! println!("Prism Core v{} running Soroban Protocol v{}", VERSION, SOROBAN_PROTOCOL_VERSION);
//! ```
//!
//! ## Look up a taxonomy entry
//!
//! ```rust
//! use grat_core::taxonomy::{loader::TaxonomyDatabase, schema::ErrorCategory};
//!
//! fn main() -> grat_core::GratResult<()> {
//!     let database = TaxonomyDatabase::load_embedded()?;
//!     let entry = database.lookup(&ErrorCategory::Budget, 0).expect("CPU budget entry");
//!
//!     assert_eq!(entry.name, "CPUExceeded");
//!     println!("{}", entry.summary);
//!     Ok(())
//! }
//! ```

#[cfg(feature = "decode")]
pub mod archive;
#[cfg(feature = "decode")]
pub mod cache;
#[cfg(feature = "decode")]
pub mod debugger;
/// ## Walk diagnostic events
///
/// Pass diagnostic events decoded from transaction metadata to the walker.
/// This fixture represents one event from a failed call.
///
/// ```rust
/// use grat_core::decode::walk_diagnostic_events;
/// use stellar_xdr::curr::{
///     ContractEvent, ContractEventBody, ContractEventType, ContractEventV0, DiagnosticEvent,
///     ExtensionPoint, Hash, ScVal,
/// };
///
/// fn main() {
///     let events = [DiagnosticEvent {
///         in_successful_contract_call: false,
///         event: ContractEvent {
///             ext: ExtensionPoint::V0,
///             contract_id: Some(Hash([1; 32])),
///             type_: ContractEventType::Contract,
///             body: ContractEventBody::V0(ContractEventV0 {
///                 topics: Vec::new().try_into().expect("empty XDR topic list"),
///                 data: ScVal::U32(42),
///             }),
///         },
///     }];
///
///     let decoded = walk_diagnostic_events(&events);
///     assert!(!decoded[0].in_successful_call);
///     assert_eq!(decoded[0].data, ScVal::U32(42));
/// }
/// ```
///
/// ## Decode a function call
///
/// Pass a function and contract spec when available. With `None`, the decoder
/// uses the XDR value types directly.
///
/// ```rust
/// use grat_core::decode::FunctionCallDecoder;
/// use serde_json::json;
/// use stellar_xdr::curr::ScVal;
///
/// fn main() {
///     let args = [ScVal::U32(10), ScVal::U32(20)];
///     let result = ScVal::U32(30);
///     let decoded = FunctionCallDecoder::new().decode("add", &args, None, Some(&result), None);
///
///     assert_eq!(decoded.arguments[0].value, json!(10));
///     assert_eq!(decoded.return_value, Some(json!(30)));
/// }
/// ```
#[cfg(feature = "decode")]
pub mod decode;
pub mod error;
#[cfg(feature = "decode")]
pub mod network;
#[cfg(feature = "decode")]
pub mod replay;
#[cfg(feature = "decode")]
pub mod rpc;
#[cfg(feature = "decode")]
pub mod spec;
pub mod taxonomy;
#[cfg(feature = "decode")]
pub mod types;
pub mod xdr;

#[cfg(feature = "decode")]
pub use decode::{
    scval_to_json, scval_to_json_with_contract_spec, scval_to_json_with_spec,
    walk_diagnostic_events, AddressCredential, AddressWithNonce, AddressCredentialV2,
    ArgumentDecoder, AuthChain,
    AuthCredential, AuthFunctionKind, AuthInvocation, DecodedArgument, DecodedFunctionCall,
    DiagnosticEventKind, DiagnosticEventWalker, EnumDecoder, FunctionCallDecoder, MultiOpDecoder,
    ReturnValueDecoder, StructDecodeReport, StructDecoder, StructuredDiagnosticEvent,
    build_call_graph, SignatureFormat, V2SignerEntry, decode_auth_entry_signatures_v2,
    parse_signature_format,
};
pub use error::{GratError, GratResult};
#[cfg(feature = "decode")]
pub use network::config::Network;
#[cfg(feature = "decode")]
pub use types::address::Address;
#[cfg(feature = "decode")]
pub use types::config::NetworkConfig;
#[cfg(feature = "decode")]
pub use types::report::DiagnosticReport;

/// Current crate version as defined in `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Current supported Soroban protocol version supported by the host environment.
pub const SOROBAN_PROTOCOL_VERSION: u32 =
    soroban_env_host::meta::get_ledger_protocol_version(soroban_env_host::meta::INTERFACE_VERSION);

#[cfg(test)]
#[ctor::ctor]
fn init_test_logging() {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("grat_core=debug,soroban_env_host=warn"));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_test_writer()
        .try_init();
}

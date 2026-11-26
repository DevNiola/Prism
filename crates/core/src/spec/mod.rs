pub mod decoder;
pub mod metadata;
pub mod resolver;
pub mod wasm_validator;

pub use decoder::{
    ContractEnumCase, ContractEnumDef, ContractErrorEntry, ContractFunction, ContractSpec,
    ContractStructDef, ContractStructField, ContractUnionCase, ContractUnionDef, SpecParser,
};
pub use metadata::{extract_contract_metadata, ContractMetadata};
pub use resolver::{ContractId, ResolverStats, SCSpecResolver};
pub use wasm_validator::{validate_wasm_imports, DisallowedImport, WasmImportValidationError};

#[cfg(test)]
mod tests;

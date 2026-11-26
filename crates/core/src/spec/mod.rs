pub mod decoder;
pub mod metadata;
pub mod resolver;
pub mod type_resolver;

pub use decoder::{
    ContractEnumCase, ContractEnumDef, ContractErrorEntry, ContractFunction, ContractSpec,
    ContractStructDef, ContractStructField, ContractUnionCase, ContractUnionDef, SpecParser,
};
pub use metadata::{extract_contract_metadata, ContractMetadata};
pub use resolver::{ContractId, ResolverStats, SCSpecResolver};
pub use type_resolver::{GenericContext, TypeResolver};

#[cfg(test)]
mod tests;

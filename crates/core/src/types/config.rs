use std::env;
use std::fs;
use std::path::Path;

pub use crate::network::config::{Network, NetworkConfig};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("Configuration validation error: {0}")]
    Validation(String),

    #[error("Missing required environment variable: {0}")]
    MissingRequiredVar(String),

    #[error("Invalid environment value for {key}: {details}")]
    InvalidValue { key: String, details: String },

    #[error("IO error reading configuration file: {0}")]
    Io(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GratConfig {
    pub default_network: Network,

    pub networks: Vec<NetworkConfig>,

    pub cache_dir: Option<String>,

    pub max_cache_size_mb: u64,

    pub request_timeout_secs: u64,
}

impl Default for GratConfig {
    fn default() -> Self {
        Self {
            default_network: Network::Testnet,
            networks: vec![
                NetworkConfig::testnet(),
                NetworkConfig::mainnet(),
                NetworkConfig::futurenet(),
                NetworkConfig::local(),
            ],
            cache_dir: None,
            max_cache_size_mb: 512,
            request_timeout_secs: DEFAULT_REQUEST_TIMEOUT_SECS,
        }
    }
}

impl GratConfig {
    /// Loads environment files hierarchically:
    /// 1. `.env.<NODE_ENV>.local`
    /// 2. `.env.local`
    /// 3. `.env.<NODE_ENV>`
    /// 4. `.env`
    pub fn load_env_files(base_dir: impl AsRef<Path>) {
        let env_mode = env::var("NODE_ENV")
            .or_else(|_| env::var("GRAT_ENV"))
            .unwrap_or_else(|_| "development".to_string());

        let candidates = [
            format!(".env.{env_mode}.local"),
            ".env.local".to_string(),
            format!(".env.{env_mode}"),
            ".env".to_string(),
        ];

        for filename in &candidates {
            let path = base_dir.as_ref().join(filename);
            if path.exists() {
                if let Ok(content) = fs::read_to_string(&path) {
                    Self::parse_and_inject_env(&content);
                }
            }
        }
    }

    fn parse_and_inject_env(content: &str) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once('=') {
                let key = k.trim();
                let mut val = v.trim();
                if (val.starts_with('"') && val.ends_with('"'))
                    || (val.starts_with('\'') && val.ends_with('\''))
                {
                    val = &val[1..val.len() - 1];
                }
                if env::var(key).is_err() {
                    env::set_var(key, val);
                }
            }
        }
    }

    /// Constructs a `GratConfig` from environment variables, falling back to defaults.
    pub fn from_env() -> Result<Self, ConfigError> {
        let mut cfg = Self::default();

        if let Ok(net_str) = env::var("GRAT_DEFAULT_NETWORK") {
            cfg.default_network = match net_str.to_lowercase().as_str() {
                "mainnet" => Network::Mainnet,
                "testnet" => Network::Testnet,
                "futurenet" => Network::Futurenet,
                "local" | "standalone" => Network::Custom("local".to_string()),
                other => Network::Custom(other.to_string()),
            };
        }

        if let Ok(cache_dir) = env::var("GRAT_CACHE_DIR") {
            if !cache_dir.trim().is_empty() {
                cfg.cache_dir = Some(cache_dir);
            }
        }

        if let Ok(max_cache_str) = env::var("GRAT_MAX_CACHE_SIZE_MB") {
            let max_cache: u64 = max_cache_str.parse().map_err(|_| ConfigError::InvalidValue {
                key: "GRAT_MAX_CACHE_SIZE_MB".to_string(),
                details: format!("expected positive integer, got '{max_cache_str}'"),
            })?;
            cfg.max_cache_size_mb = max_cache;
        }

        if let Ok(timeout_str) = env::var("GRAT_REQUEST_TIMEOUT_SECS") {
            let timeout: u64 = timeout_str.parse().map_err(|_| ConfigError::InvalidValue {
                key: "GRAT_REQUEST_TIMEOUT_SECS".to_string(),
                details: format!("expected positive integer, got '{timeout_str}'"),
            })?;
            cfg.request_timeout_secs = timeout;
        }

        cfg.validate()?;
        Ok(cfg)
    }

    /// Validates configuration values for correctness.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.max_cache_size_mb == 0 {
            return Err(ConfigError::Validation(
                "max_cache_size_mb must be greater than 0".to_string(),
            ));
        }

        if self.request_timeout_secs == 0 {
            return Err(ConfigError::Validation(
                "request_timeout_secs must be greater than 0".to_string(),
            ));
        }

        if self.networks.is_empty() {
            return Err(ConfigError::Validation(
                "at least one network configuration must be defined".to_string(),
            ));
        }

        for net in &self.networks {
            if net.rpc_url.trim().is_empty() {
                return Err(ConfigError::Validation(format!(
                    "network '{:?}' has an empty RPC URL",
                    net.network
                )));
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_rpc_url() {
        assert_eq!(
            Network::Mainnet.default_rpc_url(),
            "https://soroban-mainnet.stellar.org"
        );
        assert_eq!(
            Network::Testnet.default_rpc_url(),
            "https://soroban-testnet.stellar.org"
        );
        assert_eq!(
            Network::Futurenet.default_rpc_url(),
            "https://rpc-futurenet.stellar.org"
        );
        assert_eq!(
            Network::Custom("local".to_string()).default_rpc_url(),
            "http://127.0.0.1:8000/rpc"
        );
    }

    #[test]
    fn test_config_validation_success() {
        let config = GratConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_validation_invalid_cache() {
        let mut config = GratConfig::default();
        config.max_cache_size_mb = 0;
        let result = config.validate();
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            ConfigError::Validation("max_cache_size_mb must be greater than 0".to_string())
        );
    }

    #[test]
    fn test_config_from_env() {
        env::set_var("GRAT_DEFAULT_NETWORK", "futurenet");
        env::set_var("GRAT_MAX_CACHE_SIZE_MB", "1024");
        env::set_var("GRAT_REQUEST_TIMEOUT_SECS", "60");

        let config = GratConfig::from_env().expect("failed to load from env");
        assert_eq!(config.default_network, Network::Futurenet);
        assert_eq!(config.max_cache_size_mb, 1024);
        assert_eq!(config.request_timeout_secs, 60);

        // Clean up
        env::remove_var("GRAT_DEFAULT_NETWORK");
        env::remove_var("GRAT_MAX_CACHE_SIZE_MB");
        env::remove_var("GRAT_REQUEST_TIMEOUT_SECS");
    }
}

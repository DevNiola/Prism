pub use crate::network::config::{Network, NetworkConfig};
use serde::{Deserialize, Serialize};

pub const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GratConfig {
    pub default_network: Network,

    pub networks: Vec<NetworkConfig>,

    pub cache_dir: Option<String>,

    pub max_cache_size_mb: u64,
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
        }
    }
}

impl GratConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.networks.is_empty() {
            return Err("at least one network must be configured".to_string());
        }

        if self.max_cache_size_mb == 0 {
            return Err("max_cache_size_mb must be greater than zero".to_string());
        }

        if !self
            .networks
            .iter()
            .any(|network| network.network == self.default_network)
        {
            return Err(format!(
                "default_network '{}' must be present in networks",
                self.default_network
            ));
        }

        for network in &self.networks {
            validate_http_url(&network.rpc_url, "rpc_url", &network.network.to_string())?;
            if network.network_passphrase.trim().is_empty() {
                return Err(format!(
                    "network '{}' must have a non-empty network_passphrase",
                    network.network
                ));
            }
            if network.request_timeout_secs == 0 {
                return Err(format!(
                    "network '{}' request_timeout_secs must be greater than zero",
                    network.network
                ));
            }
            for archive_url in &network.archive_urls {
                validate_http_url(archive_url, "archive_urls", &network.network.to_string())?;
            }
        }

        Ok(())
    }
}

fn validate_http_url(value: &str, field: &str, network: &str) -> Result<(), String> {
    let url = url::Url::parse(value).map_err(|_| {
        format!("network '{network}' has an invalid {field} URL: '{value}'")
    })?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!(
            "network '{network}' has an invalid {field} URL: '{value}'"
        ));
    }
    Ok(())
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
}

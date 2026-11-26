#!/usr/bin/env bash
# check_taxonomy_protocol_drift.sh
#
# CI guard: fails if the embedded taxonomy does not cover all Soroban host
# error codes that are statically mapped in the decode layer.
#
# The decode layer's static mapping tables are the authoritative list of codes
# the host exposes at the current protocol version.  Any code present there but
# absent from taxonomy/data/*.toml indicates a documentation gap that must be
# filled before the PR can merge.
#
# Usage:
#   scripts/check_taxonomy_protocol_drift.sh
#
# Exit codes:
#   0  all host codes are covered
#   1  one or more host codes are missing from the taxonomy

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || realpath "$(dirname "$0")/..")"
cd "$REPO_ROOT"

echo "🔍 Checking taxonomy coverage against Soroban protocol version..."

# Run the taxonomy linter first to ensure no existing entries are broken.
echo "  → Running taxonomy linter..."
cargo run --quiet -p grat-core --bin taxonomy_linter -- crates/core/src/taxonomy/data

echo "  → Running taxonomy protocol-drift test..."
# The drift detection is exercised by the unit tests in updater.rs;
# running them here makes this script a CI-ready gate.
cargo test --quiet -p grat-core --lib taxonomy::updater 2>&1

echo ""
echo "✅ Taxonomy is consistent with the current Soroban protocol version."
echo "   If you added new host error codes, run:"
echo "     cargo run -p grat-core --bin taxonomy_linter -- crates/core/src/taxonomy/data"
echo "   and add entries for any reported missing codes before merging."

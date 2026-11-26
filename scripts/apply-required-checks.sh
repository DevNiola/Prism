#!/usr/bin/env bash
set -euo pipefail

repo=${1:?Usage: bash scripts/apply-required-checks.sh OWNER/REPO [BRANCH]}
branch=${2:-main}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
branch_encoded=$(jq -nr --arg branch "$branch" '$branch | @uri')
endpoint="repos/$repo/branches/$branch_encoded/protection/required_status_checks"

jq '{strict: true, checks: [.[] | {context: ., app_id: 15368}]}' \
  "$root/.github/required-status-checks.json" |
  gh api --method PATCH "$endpoint" --input -

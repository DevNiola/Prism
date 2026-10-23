#!/usr/bin/env bash
set -euo pipefail

crate_name="$1"
version="$(cargo metadata --no-deps --format-version 1 | jq -r --arg name "$crate_name" '.packages[] | select(.name == $name) | .version')"

if [[ -z "$version" || "$version" == "null" ]]; then
  printf 'Could not determine version for crate %s\n' "$crate_name" >&2
  exit 1
fi

curl --fail --silent --show-error --location --retry 5 --retry-delay 10 --retry-all-errors \
  "https://crates.io/api/v1/crates/${crate_name}/${version}" \
  | jq --exit-status --arg version "$version" '.version.num == $version' >/dev/null

printf 'Verified %s %s is available on crates.io\n' "$crate_name" "$version"
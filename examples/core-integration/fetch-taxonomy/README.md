# Fetch Taxonomy

This example script demonstrates how the Prism web application dynamically
builds its Error Dictionary by parsing the core Rust engine's source-of-truth
TOML files at runtime, rather than hardcoding error numbers.

## What it demonstrates

- Reading `crates/core/src/taxonomy/data/contract.toml` using the
  `@iarna/toml` parser.
- Flattening the deeply-nested TOML namespace tree (e.g.,
  `[errors.contract.authentication]`) into a single-level JSON dictionary
  keyed by numeric error code for O(1) UI lookups.
- Writing the resulting dictionary to `taxonomy.json` for consumption by the
  frontend.
- Handling malformed or unexpected TOML shapes defensively (skips unknown
  nodes with a warning instead of crashing).

## Flattening algorithm

The `@iarna/toml` parser returns an AST that mirrors the Rust codebase's
nested namespaces.  The `flattenTaxonomy` recursive graph walker collapses
that tree into a flat dictionary:

```json
{
  "0": { "code": 0, "name": "ContractError", "summary": "..." },
  "6": { "code": 6, "name": "AccountMissingError", "summary": "..." }
}
```

Rules:
- Structural grouping nodes (objects without a `name` field) are recursed into.
- Terminal leaf nodes (objects with a `name` field and a numeric `code`) are
  added to the flat output.
- Duplicate codes keep the first definition encountered and emit a warning.
- Unexpected shapes (arrays, bare primitives) are skipped with a warning.

## Prerequisites

- Node.js 18 or higher.
- The TOML taxonomy file at `crates/core/src/taxonomy/data/contract.toml`
  (present in the repo root).

## Installation

```bash
pnpm install
# or
npm install
```

## Running the Example

```bash
npm start
```

This reads the TOML file, flattens it, and writes the result to
`taxonomy.json` in the same directory.

## Running the Tests

```bash
npm test
```

The test suite covers the flattening logic for all documented node shapes,
including edge cases (empty input, duplicate codes, unknown shapes).

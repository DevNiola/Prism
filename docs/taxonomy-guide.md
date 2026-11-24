# Taxonomy Guide — Custom Error Mappings

The Grat error taxonomy is the database that powers plain-English error explanations. It maps raw Soroban host error codes to human-readable names, detailed descriptions, common causes, and suggested fixes. This guide explains the taxonomy schema and walks through adding your own custom error mappings.

---

## Table of Contents

- [Overview](#overview)
- [File Layout](#file-layout)
- [Schema Reference](#schema-reference)
  - [Category Metadata (`[category]`)](#category-metadata-category)
  - [Entry Fields (`[[errors]]`)](#entry-fields-errors)
  - [Common Causes (`[[errors.common_causes]]`)](#common-causes-errorscommon_causes)
  - [Suggested Fixes (`[[errors.suggested_fixes]]`)](#suggested-fixes-errorssuggested_fixes)
  - [Error Categories](#error-categories)
  - [Severity Levels](#severity-levels)
- [Adding a Custom Error Mapping](#adding-a-custom-error-mapping)
  - [Step 1 — Choose or create a category file](#step-1--choose-or-create-a-category-file)
  - [Step 2 — Write the entry](#step-2--write-the-entry)
  - [Step 3 — Run the linter](#step-3--run-the-linter)
  - [Step 4 — Update the taxonomy database](#step-4--update-the-taxonomy-database)
- [Running the Taxonomy Linter](#running-the-taxonomy-linter)
- [Full Example Entry](#full-example-entry)
- [Contributing Taxonomy Changes](#contributing-taxonomy-changes)

---

## Overview

When Grat decodes a failed Soroban transaction, it looks up the host error code in the taxonomy database and returns a structured `DiagnosticReport` with:

- **Error name** — A readable identifier (e.g. `CPUExceeded`).
- **Summary** — A one-sentence description.
- **Detailed explanation** — A paragraph-level explanation of the error and when it occurs.
- **Common causes** — A ranked list of likely root causes.
- **Suggested fixes** — Actionable remediation steps with difficulty ratings.

All of this data comes from taxonomy TOML files stored in `crates/core/src/taxonomy/data/`.

---

## File Layout

```
crates/core/src/taxonomy/
├── data/
│   ├── budget.toml     ← CPU & memory budget errors
│   ├── storage.toml    ← Ledger storage errors
│   ├── auth.toml       ← Authorization errors
│   ├── context.toml    ← Execution context errors
│   ├── value.toml      ← ScVal type errors
│   ├── object.toml     ← Host object errors
│   ├── crypto.toml     ← Cryptographic operation errors
│   ├── contract.toml   ← Contract invocation errors
│   ├── wasm.toml       ← WASM execution errors
│   └── events.toml     ← Event emission errors
├── schema.rs           ← Rust types for the schema
├── loader.rs           ← Loads and indexes the taxonomy at runtime
└── linter.rs           ← Validates TOML files against the schema
```

Each `.toml` file covers one error **category** and contains a `[category]` header followed by one or more `[[errors]]` entries.

---

## Schema Reference

### Category Metadata (`[category]`)

Every TOML file must begin with a `[category]` section that describes the category as a whole.

```toml
[category]
name = "Budget"
description = "Errors triggered when a transaction or contract invocation exceeds its allocated computation or memory budget."
source_module = "soroban-env-host/src/budget.rs"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the category (title case) |
| `description` | string | Yes | One or two sentence description of the category |
| `source_module` | string | Yes | Path to the Soroban source module that produces these errors |

---

### Entry Fields (`[[errors]]`)

Each error entry is an element of the `[[errors]]` array. All required fields must be present or the linter will reject the file.

```toml
[[errors]]
id = "host.budget.limit_exceeded.cpu"
category = "budget"
code = 0
name = "CPUExceeded"
severity = "Error"
since_protocol = 20
summary = "The transaction exceeded its CPU instruction budget."
detailed_explanation = """
The Soroban runtime enforces strict CPU instruction limits per transaction...
"""
related_errors = ["host.budget.insufficient_memory"]
source_file = "soroban-env-host/src/budget.rs"
source_line = 42
documentation_url = "https://soroban.stellar.org/docs/fundamentals/fees-and-metering"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Globally unique dotted identifier, e.g. `"host.budget.limit_exceeded.cpu"`. Convention: `"host.<category>.<error_group>.<variant>"` |
| `category` | string | Yes | Lowercase category name. Must match one of the [error categories](#error-categories). |
| `code` | integer | Yes | Numeric error code as defined in the Soroban host source |
| `name` | string | Yes | PascalCase error name, e.g. `"CPUExceeded"` |
| `severity` | string | Yes | Severity level. One of: `"Error"`, `"Warning"`, `"Info"` — see [Severity Levels](#severity-levels) |
| `since_protocol` | integer | Yes | Soroban protocol version in which this error was introduced |
| `deprecated_protocol` | integer | No | Protocol version in which this error was deprecated, if applicable |
| `summary` | string | Yes | One-sentence description. Shown in compact/short output. |
| `detailed_explanation` | string | Yes | Full explanation. Use a multi-line TOML string (`"""..."""`) for long text. |
| `related_errors` | array of strings | No | IDs of related taxonomy entries (cross-references) |
| `source_file` | string | No | Source file in the Soroban host repo where this error originates |
| `source_line` | integer | No | Line number in `source_file` |
| `documentation_url` | string | No | URL to official documentation for this error |

---

### Common Causes (`[[errors.common_causes]]`)

An optional list of likely root causes for this error, ranked by likelihood. Add at least one high-likelihood cause for new entries.

```toml
[[errors.common_causes]]
description = "Unbounded or large loops processing collections with many entries"
likelihood = "high"

[[errors.common_causes]]
description = "Complex cryptographic verification operations"
likelihood = "medium"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | A sentence explaining what causes the error |
| `likelihood` | string | Yes | How often this cause is responsible. One of: `"high"`, `"medium"`, `"low"` |

---

### Suggested Fixes (`[[errors.suggested_fixes]]`)

An optional list of remediation steps. Each fix has a difficulty rating and flags whether the fix requires a contract upgrade.

```toml
[[errors.suggested_fixes]]
description = "Increase the CPU instruction limit in the transaction resource declaration"
difficulty = "easy"
requires_upgrade = false

[[errors.suggested_fixes]]
description = "Optimize the contract logic to reduce computational complexity"
difficulty = "medium"
requires_upgrade = true
example = """
// Before: iterates the full map
for (key, val) in storage.all() { ... }

// After: reads only the required key
let val = storage.get(key);
"""
id = "fix.budget.cpu.optimize_loop"
remedy_code = "storage.get(key)"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | What the fix involves |
| `difficulty` | string | Yes | Implementation effort. One of: `"easy"`, `"medium"`, `"hard"` |
| `requires_upgrade` | boolean | Yes | Whether applying this fix requires redeploying the contract |
| `example` | string | No | Code snippet illustrating the fix (can be multi-line) |
| `id` | string | No | Unique identifier for the fix, used for automated tooling |
| `remedy_code` | string | No | Minimal code snippet that resolves the issue |

---

### Error Categories

The `category` field in each entry must be one of these lowercase values:

| Value | Description |
|-------|-------------|
| `budget` | CPU instruction and memory budget limit errors |
| `storage` | Ledger entry access and storage operation errors |
| `auth` | Authorization and signature verification errors |
| `context` | Execution context and environment errors |
| `value` | `ScVal` type conversion and validation errors |
| `object` | Host object creation and manipulation errors |
| `crypto` | Cryptographic operation errors (hashing, signing, verification) |
| `contract` | Contract invocation and dispatch errors |
| `wasm` | WASM module loading, validation, and execution errors |
| `events` | Contract event emission errors |

---

### Severity Levels

| Value | Meaning |
|-------|---------|
| `"Error"` | The transaction failed because of this condition. Requires action to fix. |
| `"Warning"` | The transaction succeeded but a potentially problematic condition was detected. |
| `"Info"` | Informational annotation. No action required. |

---

## Adding a Custom Error Mapping

Follow these four steps to add a new error to the taxonomy.

### Step 1 — Choose or create a category file

Find the `.toml` file in `crates/core/src/taxonomy/data/` that best matches your error. If your error does not fit any existing category, create a new file:

```bash
touch crates/core/src/taxonomy/data/myapp.toml
```

A new file must start with a `[category]` block:

```toml
[category]
name = "MyApp"
description = "Custom errors raised by the MyApp Soroban contract."
source_module = "contracts/myapp/src/errors.rs"
```

### Step 2 — Write the entry

Append a new `[[errors]]` block to the file:

```toml
[[errors]]
id = "host.myapp.insufficient_balance"
category = "contract"
code = 3
name = "InsufficientBalance"
severity = "Error"
since_protocol = 21
summary = "The caller does not have enough token balance to complete the transfer."
detailed_explanation = """
This error is raised by the transfer() function when the caller's balance is lower than the
requested transfer amount. The contract checks the stored balance for the caller's address
before executing the transfer. If the check fails, it panics with error code 3.
"""
related_errors = ["host.auth.not_authorized"]
documentation_url = "https://example.com/myapp/errors"

[[errors.common_causes]]
description = "Calling transfer() without first checking the balance with get_balance()"
likelihood = "high"

[[errors.common_causes]]
description = "The caller's balance was reduced by a concurrent transaction in the same ledger"
likelihood = "low"

[[errors.suggested_fixes]]
description = "Read the balance before calling transfer and check it is sufficient"
difficulty = "easy"
requires_upgrade = false
example = """
let balance = token.balance(&env, &caller);
if balance < amount {
    return Err(Error::InsufficientBalance);
}
token.transfer(&env, &caller, &recipient, &amount);
"""

[[errors.suggested_fixes]]
description = "Return a meaningful error to the caller rather than panicking"
difficulty = "easy"
requires_upgrade = true
```

### Step 3 — Run the linter

Before committing, validate your changes with the taxonomy linter:

```bash
# Using the convenience script:
./scripts/lint_taxonomy.sh

# Or directly with cargo:
cargo run -p grat-core --bin taxonomy_linter -- crates/core/src/taxonomy/data
```

The linter checks:

- All required fields (`id`, `category`, `code`, `name`, `severity`, `since_protocol`, `summary`, `detailed_explanation`) are present.
- `id` values are unique across all files.
- `category` values match the allowed set.
- `severity` values are one of `"Error"`, `"Warning"`, `"Info"`.
- `likelihood` values in `common_causes` are one of `"high"`, `"medium"`, `"low"`.
- `difficulty` values in `suggested_fixes` are one of `"easy"`, `"medium"`, `"hard"`.
- No unknown fields are present (the schema uses `deny_unknown_fields`).

A passing run looks like:

```
✅ No issues found in crates/core/src/taxonomy/data
```

Fix any reported errors before proceeding.

### Step 4 — Update the taxonomy database

After the linter passes, rebuild the in-memory database index to pick up your changes:

```bash
grat db update
```

Then verify your entry is indexed:

```bash
grat db search "InsufficientBalance"
```

Or search with the `search-error` command for a rich table view:

```bash
grat search-error "InsufficientBalance"
```

---

## Running the Taxonomy Linter

The linter is a standalone Rust binary in `crates/core/src/bin/taxonomy_linter.rs`. It validates every TOML file in a directory against the schema and reports all violations.

**Via the shell script (recommended):**

```bash
./scripts/lint_taxonomy.sh
```

**Via cargo directly:**

```bash
# Lint the default data directory
cargo run -p grat-core --bin taxonomy_linter

# Lint a specific directory
cargo run -p grat-core --bin taxonomy_linter -- /path/to/taxonomy/data

# Lint with verbose Rust logging
RUST_LOG=debug cargo run -p grat-core --bin taxonomy_linter
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All files are valid |
| `1` | One or more validation errors found, or the directory does not exist |

The linter is also run as part of the project's CI pipeline. Pull requests with invalid taxonomy files will fail CI.

---

## Full Example Entry

Here is a complete, production-quality taxonomy entry demonstrating every available field:

```toml
[[errors]]
id = "host.storage.missing_entry"
category = "storage"
code = 0
name = "MissingEntry"
severity = "Error"
since_protocol = 20
deprecated_protocol = null
summary = "The requested ledger entry does not exist."
detailed_explanation = """
The contract attempted to read a value from ledger storage (instance, temporary, or persistent)
using a key that has never been written, or whose TTL has expired and been removed from the
ledger. The Soroban host terminates the invocation immediately with this error.

This is distinct from returning a default value — Soroban's storage APIs panic on a missing
entry unless the contract explicitly uses has_entry() or get_or_default() variants.
"""
related_errors = [
  "host.storage.existing_entry",
  "host.storage.access_denied",
]
source_file = "soroban-env-host/src/storage.rs"
source_line = 112
documentation_url = "https://soroban.stellar.org/docs/fundamentals/persisting-data#errors"

[[errors.common_causes]]
description = "Reading a storage key that was never initialized (first-time contract deployment)"
likelihood = "high"

[[errors.common_causes]]
description = "The entry's TTL expired and the ledger pruned it before the transaction ran"
likelihood = "medium"

[[errors.common_causes]]
description = "A typo or off-by-one in the key derivation logic"
likelihood = "low"

[[errors.suggested_fixes]]
description = "Use env.storage().instance().has(&key) before reading to guard against missing entries"
difficulty = "easy"
requires_upgrade = false
example = """
if !env.storage().instance().has(&DataKey::Balance) {
    return Ok(0_i128);
}
let balance: i128 = env.storage().instance().get(&DataKey::Balance).unwrap();
"""
id = "fix.storage.missing_entry.guard_read"

[[errors.suggested_fixes]]
description = "Extend the entry's TTL before it expires using extend_ttl()"
difficulty = "easy"
requires_upgrade = false
example = """
// Extend the TTL by 100 ledgers
env.storage().instance().extend_ttl(100, 100);
"""
id = "fix.storage.missing_entry.extend_ttl"

[[errors.suggested_fixes]]
description = "Initialize the entry in the constructor so it always exists"
difficulty = "medium"
requires_upgrade = true
id = "fix.storage.missing_entry.initialize_in_ctor"
```

---

## Contributing Taxonomy Changes

When contributing new taxonomy entries or fixing existing ones:

1. **Follow the style** of existing entries in the same category file.
2. **Add at least one `common_causes` entry** (ideally with `"high"` likelihood) and at least one `suggested_fixes` entry.
3. **Run the linter** (`./scripts/lint_taxonomy.sh`) and ensure it exits with code 0.
4. **Search for duplicates** — check that the `id` and `code` are not already used in the same category.
5. **Open a pull request** — PRs that add or fix taxonomy entries are very welcome. Include the output of `grat search-error <name>` in the PR description to show the entry is correctly indexed.

For questions about the schema or to propose new categories, open a discussion on GitHub.

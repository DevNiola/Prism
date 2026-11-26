# Contributing to the Error Taxonomy

Taxonomy data lives in [`crates/core/src/taxonomy/data/`](../crates/core/src/taxonomy/data/), with one TOML file per error category. Follow the [taxonomy contribution guide](guides/contributing-taxonomy.mdx) for the field reference, validation rules, and pull request checklist.

After adding or updating an entry, run the linter from the repository root:

```bash
bash scripts/lint_taxonomy.sh
```

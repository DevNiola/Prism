# Branch protection and required checks

Pull requests into `main` must satisfy these GitHub Actions checks and be up to date with the base branch.

| Canonical check | GitHub check name | Workflow |
| --- | --- | --- |
| `rust_checks` | Rust Checks | [CI](workflows/ci.yml) |
| `node_checks` | Node & Web Checks | [CI](workflows/ci.yml) |
| `wasm-build` | wasm-build | [WASM Build](workflows/wasm-check.yml) |
| `web-e2e` | playwright | [Web E2E](workflows/web-e2e.yml) |
| `security` | security | [Security](workflows/security.yml) |

The WASM build runs on every pull request to `main` and builds the web package. The security check requires the dependency audits, CodeQL, and container scans to succeed.

## Apply the policy

A repository administrator needs authenticated GitHub CLI access with repository Administration write permission and `jq`. Enable classic branch protection on `main` first. Wait for GitHub Actions to report all five checks on a recent commit before applying the policy.

```bash
bash scripts/apply-required-checks.sh DevNiola/Prism main
```

The script replaces the required check list with the GitHub Actions contexts in [required-status-checks.json](required-status-checks.json) and enables strict status checks. It updates only the required-status-checks section of classic branch protection. Review the repository's release automation permissions before applying the policy because semantic-release pushes a changelog commit directly to `main`.

When renaming or replacing a required job, update its check name in the JSON file and this table, let the new check report on GitHub, then reapply the policy.

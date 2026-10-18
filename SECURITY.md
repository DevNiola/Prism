# Security Policy

## Reporting a Vulnerability

We prioritize the security of our users. If you find a security vulnerability in Grat, please report it privately.

### How to Report

Please do NOT open public issues for security vulnerabilities. Send an email to the project maintainers.

### Security Best Practices

- **Read-Only Operations**: Grat is a read-only diagnostic tool and never handles private keys or signs transactions.
- **Isolated Sandbox**: Transaction replay occurs in an isolated local sandbox with no network access.
- **Validation**: All external inputs (XDR, WASM metadata) are validated before processing.

### Automated Security Scanning

We run continuous automated security scanning via GitHub Actions (`.github/workflows/security.yml`):

1. **Rust Dependencies**: Audited using `cargo-audit` against the RustSec Advisory Database.
2. **JavaScript/TypeScript Dependencies**: Audited using `pnpm audit` with strict enforcement on high and critical severity findings.
3. **Static Application Security Testing (SAST)**: GitHub CodeQL semantic analysis scans code on every pull request and weekly schedule.
4. **Vulnerability & Misconfiguration Scanning**: Trivy scanner audits filesystem configurations, secrets, and container manifests.
5. **Quality Gate**: Pull requests containing high-severity security findings are blocked from merging.


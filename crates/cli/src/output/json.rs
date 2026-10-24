use grat_core::types::report::DiagnosticReport;

pub fn format_report(report: &DiagnosticReport) -> anyhow::Result<String> {
    Ok(serde_json::to_string_pretty(report)?)
}

pub fn print_report(report: &DiagnosticReport) -> anyhow::Result<()> {
    println!("{}", format_report(report)?);
    Ok(())
}

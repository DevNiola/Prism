use grat_core::types::report::DiagnosticReport;

pub fn format_report(report: &DiagnosticReport) -> String {
    format!(
        "[{}] {}: {}",
        report.error_category, report.error_name, report.summary
    )
}

pub fn print_report(report: &DiagnosticReport) -> anyhow::Result<()> {
    println!("{}", format_report(report));
    Ok(())
}

use crate::types::report::Severity;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorSeverity {
    Critical,
    Error,
    Warning,
    Info,
}

impl From<ErrorSeverity> for Severity {
    fn from(sev: ErrorSeverity) -> Self {
        match sev {
            ErrorSeverity::Critical => Severity::Fatal,
            ErrorSeverity::Error => Severity::Error,
            ErrorSeverity::Warning => Severity::Warning,
            ErrorSeverity::Info => Severity::Info,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BudgetErrorDetail {
    pub code: u32,

    pub name: &'static str,
    /// Short explanation of the failure.
    pub summary: &'static str,

    pub severity: ErrorSeverity,
}

pub const BUDGET_ERROR_DETAILS: &[BudgetErrorDetail] = &[
    BudgetErrorDetail {
        code: 0,
        name: "CPUExceeded",
        summary: "CPU budget exceeded: the transaction ran out of CPU instructions before completing execution.",
        severity: ErrorSeverity::Critical,
    },
    BudgetErrorDetail {
        code: 8,
        name: "ExceededLimit",
        summary: "The transaction exceeded an allocated resource limit.",
        severity: ErrorSeverity::Error,
    },
    BudgetErrorDetail {
        code: 1,
        name: "InsufficientInstructions",
        summary: "The transaction did not have enough CPU instructions allocated.",
        severity: ErrorSeverity::Critical,
    },
    BudgetErrorDetail {
        code: 2,
        name: "InsufficientMemory",
        summary: "The transaction did not have enough memory allocated.",
        severity: ErrorSeverity::Critical,
    },
];

pub fn lookup(code: u32) -> Option<&'static BudgetErrorDetail> {
    BUDGET_ERROR_DETAILS
        .iter()
        .find(|detail| detail.code == code)
}

/// Map a budget error code to the resource type it relates to.
///
/// Returns `None` if the error code doesn't map to a specific resource
/// type (e.g. a generic "ExceededLimit").
pub fn resource_type_for_code(code: u32) -> Option<&'static str> {
    match code {
        0 | 1 => Some("CPU Instructions"),
        2 => Some("Memory Bytes"),
        _ => None,
    }
}

/// Generate a human-readable summary of which resource is responsible for
/// the fee breakdown, given budget error details and per-resource costs.
///
/// Returns a formatted string suitable for inclusion in a diagnostic report.
pub fn format_fee_attribution_summary(
    resource_costs: &[( &str, i64)],
    most_expensive: Option<&str>,
) -> String {
    if resource_costs.is_empty() {
        return "No per-resource fee attribution available.".to_string();
    }

    let mut lines = Vec::new();
    for (resource_type, cost) in resource_costs {
        lines.push(format!("  {resource_type}: {cost} stroops"));
    }

    if let Some(most_expensive) = most_expensive {
        lines.push(format!(
            "Most expensive resource: {most_expensive}"
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_returns_cpu_exceeded_detail() {
        let detail = lookup(0).expect("cpu exceeded detail");
        assert_eq!(detail.name, "CPUExceeded");
        assert!(detail.summary.contains("CPU instructions"));
    }

    #[test]
    fn table_covers_known_budget_codes() {
        assert_eq!(BUDGET_ERROR_DETAILS.len(), 4);
        assert!(lookup(99).is_none());
    }

    #[test]
    fn resource_type_for_code_maps_cpu_errors() {
        assert_eq!(resource_type_for_code(0), Some("CPU Instructions"));
        assert_eq!(resource_type_for_code(1), Some("CPU Instructions"));
        assert_eq!(resource_type_for_code(2), Some("Memory Bytes"));
        assert_eq!(resource_type_for_code(8), None);
        assert_eq!(resource_type_for_code(99), None);
    }

    #[test]
    fn format_fee_attribution_summary_with_costs() {
        let costs = [("CPU Instructions", 75), ("Memory Bytes", 25)];
        let summary = format_fee_attribution_summary(&costs, Some("CPU Instructions"));
        assert!(summary.contains("CPU Instructions: 75 stroops"));
        assert!(summary.contains("Memory Bytes: 25 stroops"));
        assert!(summary.contains("Most expensive resource: CPU Instructions"));
    }

    #[test]
    fn format_fee_attribution_summary_empty() {
        let summary = format_fee_attribution_summary(&[], None);
        assert!(summary.contains("No per-resource fee attribution"));
    }
}

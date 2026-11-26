use clap::Args;
use grat_core::debugger::breakpoint::{
    BreakpointCondition, BreakpointController, FunctionBreakpoint, FunctionBreakpointTrigger,
};
use grat_core::types::config::NetworkConfig;

#[derive(Args)]
pub struct TraceArgs {
    #[arg(index = 1, value_name = "TX_HASH")]
    pub tx_hash: String,

    #[arg(long, short)]
    pub output_file: Option<String>,

    #[arg(long)]
    pub auth: bool,

    #[arg(long)]
    pub auth_only: bool,

    /// Add a conditional breakpoint: `[contract_id:]function_name[=condition]`
    ///
    /// Examples:
    ///   --break transfer
    ///   --break "transfer=amount > 100"
    ///   --break "CABC123:deposit=amount == 0"
    ///
    /// The condition is evaluated against the decoded function arguments.
    /// Omit the condition to break unconditionally on every entry to that function.
    /// Pass `--break '*'` to break on every function entry.
    #[arg(long = "break", value_name = "SPEC", num_args = 1)]
    pub breakpoints: Vec<String>,
}

/// Parse a breakpoint spec of the form `[contract_id:]function_name[=condition]`.
fn parse_breakpoint_spec(spec: &str) -> (Option<String>, String, Option<String>) {
    // Split on `=` once to separate condition from the target part
    let (target_part, condition) = match spec.splitn(2, '=').collect::<Vec<_>>().as_slice() {
        [target, cond] => (*target, Some(cond.trim().to_string())),
        [target] => (*target, None),
        _ => (spec, None),
    };

    // Split the target on `:` once to get an optional contract prefix
    let (contract_id, function_name) = match target_part.splitn(2, ':').collect::<Vec<_>>().as_slice() {
        [contract, func] => (Some(contract.trim().to_string()), func.trim().to_string()),
        [func] => (None, func.trim().to_string()),
        _ => (None, target_part.to_string()),
    };

    let condition = condition.filter(|c| !c.is_empty());
    (contract_id, function_name, condition)
}

pub async fn run(
    args: TraceArgs,
    network: &NetworkConfig,
    output_format: &str,
    save: Option<&str>,
) -> anyhow::Result<()> {
    // Build the breakpoint controller from any --break specs provided
    let mut bp_controller = BreakpointController::new();
    for spec in &args.breakpoints {
        let (contract_id, function_name, condition) = parse_breakpoint_spec(spec);
        let mut bp = FunctionBreakpoint::new(
            contract_id.clone(),
            function_name.clone(),
            FunctionBreakpointTrigger::Entry,
        );
        if let Some(cond) = condition.clone() {
            bp = bp.with_condition(cond);
        }
        let label = format!(
            "{}{}{}",
            contract_id.as_deref().map(|c| format!("{c}:")).unwrap_or_default(),
            function_name,
            condition.as_deref().map(|c| format!(" [{c}]")).unwrap_or_default(),
        );
        bp_controller.add(
            BreakpointCondition::Function(bp),
            Some(label),
        );
    }

    if !bp_controller.list().is_empty() {
        eprintln!(
            "Registered {} conditional breakpoint(s):",
            bp_controller.list().len()
        );
        for bp in bp_controller.list() {
            eprintln!(
                "  [{}] {}",
                bp.id,
                bp.label.as_deref().unwrap_or("<unnamed>")
            );
        }
    }

    let progress = indicatif::ProgressBar::new_spinner();
    progress.set_message("Reconstructing state and replaying transaction...");
    progress.enable_steady_tick(std::time::Duration::from_millis(100));

    let trace = grat_core::replay::replay_transaction(&args.tx_hash, network).await?;

    progress.finish_and_clear();

    let output = if args.auth || args.auth_only {
        if args.auth_only {
            crate::output::auth_tree::render_auth_only(&trace)?
        } else {
            crate::output::auth_tree::render_auth_tree(&trace)?
        }
    } else {
        crate::output::format_trace(&trace, output_format)?
    };

    if let Some(path) = args.output_file {
        std::fs::write(&path, &output)?;
        println!("Trace written to {path}");
    } else {
        println!("{output}");
    }

    if let Some(path) = save {
        let json = serde_json::to_string_pretty(&trace)?;
        std::fs::write(path, &json)
            .map_err(|e| anyhow::anyhow!("Failed to write save file '{path}': {e}"))?;
        eprintln!("Saved trace to {path}");
    }
    Ok(())
}

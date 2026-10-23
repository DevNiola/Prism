use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FunctionBreakpointTrigger {
    Entry,
    Exit,
    EntryOrExit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FunctionBreakpoint {
    pub contract_id: Option<String>,
    pub function_name: String,
    pub trigger: FunctionBreakpointTrigger,
    pub condition_expr: Option<String>,
}

impl FunctionBreakpoint {
    pub fn new(
        contract_id: Option<String>,
        function_name: impl Into<String>,
        trigger: FunctionBreakpointTrigger,
    ) -> Self {
        Self {
            contract_id,
            function_name: function_name.into(),
            trigger,
            condition_expr: None,
        }
    }

    pub fn with_condition(mut self, expr: impl Into<String>) -> Self {
        self.condition_expr = Some(expr.into());
        self
    }

    pub fn should_break(
        &self,
        contract: Option<&str>,
        function: &str,
        is_entry: bool,
        args: Option<&serde_json::Value>,
    ) -> bool {
        if let Some(target_contract) = &self.contract_id {
            if contract != Some(target_contract.as_str()) {
                return false;
            }
        }

        if self.function_name != "*" && self.function_name != function {
            return false;
        }

        match self.trigger {
            FunctionBreakpointTrigger::Entry => {
                if !is_entry {
                    return false;
                }
            }
            FunctionBreakpointTrigger::Exit => {
                if is_entry {
                    return false;
                }
            }
            FunctionBreakpointTrigger::EntryOrExit => {}
        }

        if let Some(expr) = &self.condition_expr {
            evaluate_condition(expr, args)
        } else {
            true
        }
    }
}

pub fn evaluate_condition(expr: &str, args: Option<&serde_json::Value>) -> bool {
    let expr = expr.trim();
    if expr.is_empty() || expr.eq_ignore_ascii_case("true") {
        return true;
    }
    if expr.eq_ignore_ascii_case("false") {
        return false;
    }

    let Some(args_val) = args else {
        return false;
    };

    let operators = [">=", "<=", "!=", "==", ">", "<", "="];
    let mut found_op = None;
    for op in operators {
        if let Some(idx) = expr.find(op) {
            found_op = Some((op, idx));
            break;
        }
    }

    let (op, idx) = match found_op {
        Some(found) => found,
        None => {
            // Check if expr references a boolean variable directly
            if let Some(b) = resolve_var(expr, args_val).and_then(|v| v.as_bool()) {
                return b;
            }
            return false;
        }
    };

    let var_name = expr[..idx].trim();
    let target_val_str = expr[idx + op.len()..].trim();

    let actual_val = match resolve_var(var_name, args_val) {
        Some(v) => v,
        None => return false,
    };

    // Numerical comparison
    if let (Some(a), Ok(b)) = (actual_val.as_f64(), target_val_str.parse::<f64>()) {
        return match op {
            ">" => a > b,
            "<" => a < b,
            ">=" => a >= b,
            "<=" => a <= b,
            "==" | "=" => (a - b).abs() < f64::EPSILON,
            "!=" => (a - b).abs() >= f64::EPSILON,
            _ => false,
        };
    }

    // String comparison
    let actual_str = match actual_val {
        serde_json::Value::String(s) => s.as_str(),
        _ => return false,
    };
    let clean_target = target_val_str.trim_matches('\'').trim_matches('"');
    match op {
        "==" | "=" => actual_str == clean_target,
        "!=" => actual_str != clean_target,
        ">" => actual_str > clean_target,
        "<" => actual_str < clean_target,
        _ => false,
    }
}

fn resolve_var<'a>(name: &str, args: &'a serde_json::Value) -> Option<&'a serde_json::Value> {
    if let Some(obj) = args.as_object() {
        if let Some(val) = obj.get(name) {
            return Some(val);
        }
    }

    if let Some(arr) = args.as_array() {
        if name == "arg" || name == "arg0" {
            return arr.first();
        }
        if let Some(num_str) = name.strip_prefix("arg") {
            if let Ok(idx) = num_str.parse::<usize>() {
                return arr.get(idx);
            }
        }
    }

    if name == "arg" {
        return Some(args);
    }

    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breakpoint {
    pub id: u32,

    pub condition: BreakpointCondition,

    pub enabled: bool,

    pub label: Option<String>,

    pub hit_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BreakpointCondition {
    FunctionEntry {
        contract_id: Option<String>,
        function_name: String,
        condition: Option<String>,
    },

    FunctionExit {
        contract_id: Option<String>,
        function_name: String,
        condition: Option<String>,
    },

    Function(FunctionBreakpoint),

    HostFunction {
        function_name: String,
    },

    ContractCall {
        target_contract_id: String,
    },

    BudgetThreshold {
        cpu_instructions: u64,
    },

    StorageAccess {
        ledger_key: String,
    },
}

pub struct BreakpointController {
    breakpoints: Vec<Breakpoint>,

    next_id: u32,
}

impl BreakpointController {
    pub fn new() -> Self {
        Self {
            breakpoints: Vec::new(),
            next_id: 1,
        }
    }

    pub fn add(&mut self, condition: BreakpointCondition, label: Option<String>) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.breakpoints.push(Breakpoint {
            id,
            condition,
            enabled: true,
            label,
            hit_count: 0,
        });
        id
    }

    pub fn add_function_breakpoint(&mut self, bp: FunctionBreakpoint, label: Option<String>) -> u32 {
        self.add(BreakpointCondition::Function(bp), label)
    }

    pub fn check_function_event(
        &mut self,
        contract: Option<&str>,
        function: &str,
        is_entry: bool,
        args: Option<&serde_json::Value>,
    ) -> Option<u32> {
        for bp in self.breakpoints.iter_mut() {
            if !bp.enabled {
                continue;
            }
            let triggered = match &bp.condition {
                BreakpointCondition::Function(f_bp) => {
                    f_bp.should_break(contract, function, is_entry, args)
                }
                BreakpointCondition::FunctionEntry { contract_id, function_name, condition } => {
                    if is_entry
                        && (contract_id.is_none() || contract_id.as_deref() == contract)
                        && (function_name == "*" || function_name == function)
                    {
                        if let Some(cond) = condition {
                            evaluate_condition(cond, args)
                        } else {
                            true
                        }
                    } else {
                        false
                    }
                }
                BreakpointCondition::FunctionExit { contract_id, function_name, condition } => {
                    if !is_entry
                        && (contract_id.is_none() || contract_id.as_deref() == contract)
                        && (function_name == "*" || function_name == function)
                    {
                        if let Some(cond) = condition {
                            evaluate_condition(cond, args)
                        } else {
                            true
                        }
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if triggered {
                bp.hit_count += 1;
                return Some(bp.id);
            }
        }
        None
    }

    pub fn remove(&mut self, id: u32) -> bool {
        let len_before = self.breakpoints.len();
        self.breakpoints.retain(|bp| bp.id != id);
        self.breakpoints.len() < len_before
    }

    pub fn toggle(&mut self, id: u32) -> Option<bool> {
        self.breakpoints
            .iter_mut()
            .find(|bp| bp.id == id)
            .map(|bp| {
                bp.enabled = !bp.enabled;
                bp.enabled
            })
    }

    pub fn list(&self) -> &[Breakpoint] {
        &self.breakpoints
    }
}

impl Default for BreakpointController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_function_breakpoint_entry_and_exit() {
        let mut controller = BreakpointController::new();
        let bp_entry = FunctionBreakpoint::new(
            Some("C123".to_string()),
            "transfer",
            FunctionBreakpointTrigger::Entry,
        );
        let bp_exit = FunctionBreakpoint::new(
            Some("C123".to_string()),
            "transfer",
            FunctionBreakpointTrigger::Exit,
        );

        let id_entry = controller.add_function_breakpoint(bp_entry, Some("entry bp".to_string()));
        let id_exit = controller.add_function_breakpoint(bp_exit, Some("exit bp".to_string()));

        // Check entry on matching contract and function
        let hit = controller.check_function_event(Some("C123"), "transfer", true, None);
        assert_eq!(hit, Some(id_entry));

        // Check exit on matching contract and function
        let hit = controller.check_function_event(Some("C123"), "transfer", false, None);
        assert_eq!(hit, Some(id_exit));

        // Check other contract does not hit
        let hit = controller.check_function_event(Some("C999"), "transfer", true, None);
        assert_eq!(hit, None);

        // Check other function does not hit
        let hit = controller.check_function_event(Some("C123"), "balance", true, None);
        assert_eq!(hit, None);
    }

    #[test]
    fn test_conditional_function_breakpoint() {
        let mut controller = BreakpointController::new();
        let bp = FunctionBreakpoint::new(
            None,
            "deposit",
            FunctionBreakpointTrigger::Entry,
        ).with_condition("amount > 100");

        let id = controller.add_function_breakpoint(bp, None);

        // Args with amount = 50 should not hit
        let args_small = serde_json::json!({ "amount": 50 });
        assert_eq!(controller.check_function_event(None, "deposit", true, Some(&args_small)), None);

        // Args with amount = 150 should hit
        let args_large = serde_json::json!({ "amount": 150 });
        assert_eq!(controller.check_function_event(None, "deposit", true, Some(&args_large)), Some(id));
        assert_eq!(controller.list()[0].hit_count, 1);
    }
}

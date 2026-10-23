use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StepCommand {
    StepInto,

    StepOver,

    StepOut,

    Continue,

    RunToEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PauseState {
    pub trace_position: usize,

    pub current_contract: String,

    pub current_function: String,

    pub call_depth: usize,

    pub remaining_cpu: u64,

    pub remaining_memory: u64,

    pub visible_storage: Vec<(String, String)>,

    pub auth_context: Vec<String>,
}

pub struct ExecutionStepper {
    current_state: Option<PauseState>,

    is_paused: bool,
}

impl ExecutionStepper {
    pub fn new() -> Self {
        Self {
            current_state: None,
            is_paused: false,
        }
    }

    pub fn step(&mut self, command: StepCommand) -> Option<&PauseState> {
        tracing::debug!("Stepping: {command:?}");
        self.current_state.as_ref()
    }

    pub fn current_state(&self) -> Option<&PauseState> {
        self.current_state.as_ref()
    }

    pub fn is_paused(&self) -> bool {
        self.is_paused
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.is_paused = paused;
    }

    pub fn set_current_state(&mut self, state: PauseState) {
        self.current_state = Some(state);
    }

    pub fn check_and_apply_breakpoint(
        &mut self,
        controller: &mut super::breakpoint::BreakpointController,
        contract: Option<&str>,
        function: &str,
        is_entry: bool,
        args: Option<&serde_json::Value>,
        state: PauseState,
    ) -> Option<u32> {
        if let Some(id) = controller.check_function_event(contract, function, is_entry, args) {
            self.current_state = Some(state);
            self.is_paused = true;
            Some(id)
        } else {
            None
        }
    }
}

impl Default for ExecutionStepper {
    fn default() -> Self {
        Self::new()
    }
}

//! # Debugger Module
//!
//! Provides interactive debugging capabilities for Soroban contract invocations,
//! including function entry/exit breakpoints, conditional breakpoints, stepping,
//! and what-if speculative execution.
//!
//! ## Submodules
//! - [`breakpoint`]: Controller for managing line and function-level breakpoints.
//! - [`stepping`]: Step-by-step execution stepper (StepInto, StepOver, StepOut).
//! - [`whatif`]: Speculative execution simulating parameter or state modifications.
//!
//! ## Example
//! ```rust
//! use grat_core::debugger::breakpoint::{BreakpointController, BreakpointCondition};
//!
//! let mut controller = BreakpointController::new();
//! let id = controller.add(BreakpointCondition::HostFunction { function_name: "log".into() }, None);
//! assert_eq!(id, 1);
//! ```

pub mod breakpoint;
pub mod stepping;
pub mod whatif;

pub use breakpoint::{Breakpoint, BreakpointCondition, BreakpointController};
pub use stepping::{ExecutionStepper, PauseState, StepCommand};

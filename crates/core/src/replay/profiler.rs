use crate::error::GratResult;
use crate::replay::sandbox::{SandboxResult, TraceEventType};
use crate::types::trace::{DiffChangeType, ResourceHotspot, ResourceProfile, StateDiff};
use std::collections::HashMap;

pub fn extract_host_function_hotspots(
    events: &[crate::replay::sandbox::TraceEvent],
    total_cpu: u64,
    total_memory: u64,
) -> Vec<ResourceHotspot> {
    struct FnStats {
        call_count: usize,
        total_cpu: u64,
        total_mem: u64,
    }

    let mut stats: HashMap<String, FnStats> = HashMap::new();
    let mut call_stack: Vec<(String, u64, u64)> = Vec::new();

    for event in events {
        match event.event_type {
            TraceEventType::HostFunctionCall => {
                let func_name = event
                    .data
                    .get("function")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let cpu = event.data.get("cpu_insns").and_then(|v| v.as_u64()).unwrap_or(0);
                let mem = event.data.get("mem_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                call_stack.push((func_name, cpu, mem));
            }
            TraceEventType::HostFunctionReturn => {
                let cpu = event.data.get("cpu_insns").and_then(|v| v.as_u64()).unwrap_or(0);
                let mem = event.data.get("mem_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                if let Some((func_name, start_cpu, start_mem)) = call_stack.pop() {
                    let cpu_diff = cpu.saturating_sub(start_cpu);
                    let mem_diff = mem.saturating_sub(start_mem);
                    let entry = stats.entry(func_name).or_insert(FnStats {
                        call_count: 0,
                        total_cpu: 0,
                        total_mem: 0,
                    });
                    entry.call_count += 1;
                    entry.total_cpu += cpu_diff;
                    entry.total_mem += mem_diff;
                }
            }
            _ => {}
        }
    }

    while let Some((func_name, start_cpu, start_mem)) = call_stack.pop() {
        let cpu_diff = total_cpu.saturating_sub(start_cpu);
        let mem_diff = total_memory.saturating_sub(start_mem);
        let entry = stats.entry(func_name).or_insert(FnStats {
            call_count: 0,
            total_cpu: 0,
            total_mem: 0,
        });
        entry.call_count += 1;
        entry.total_cpu += cpu_diff;
        entry.total_mem += mem_diff;
    }

    let mut hotspots: Vec<ResourceHotspot> = stats
        .into_iter()
        .map(|(location, s)| {
            let cpu_percentage = if total_cpu > 0 {
                (s.total_cpu as f64 / total_cpu as f64) * 100.0
            } else {
                0.0
            };
            let memory_percentage = if total_memory > 0 {
                (s.total_mem as f64 / total_memory as f64) * 100.0
            } else {
                0.0
            };
            ResourceHotspot {
                location,
                cpu_instructions: s.total_cpu,
                cpu_percentage,
                memory_bytes: s.total_mem,
                memory_percentage,
            }
        })
        .collect();

    hotspots.sort_by(|a, b| {
        b.cpu_instructions
            .cmp(&a.cpu_instructions)
            .then_with(|| b.memory_bytes.cmp(&a.memory_bytes))
    });

    hotspots
}

pub fn generate_profile(
    result: &SandboxResult,
    state_diff: &StateDiff,
) -> GratResult<ResourceProfile> {
    let mut total_write_bytes: u64 = 0;
    let mut total_read_bytes: u64 = 0;

    for entry in &state_diff.entries {
        match entry.change_type {
            DiffChangeType::Created => {
                if let Some(after) = &entry.after {
                    total_write_bytes += after.len() as u64 / 2;
                }
            }
            DiffChangeType::Updated => {
                if let Some(after) = &entry.after {
                    total_write_bytes += after.len() as u64 / 2;
                }
                if let Some(before) = &entry.before {
                    total_read_bytes += before.len() as u64 / 2;
                }
            }
            DiffChangeType::Deleted | DiffChangeType::Unchanged => {
                if let Some(before) = &entry.before {
                    total_read_bytes += before.len() as u64 / 2;
                }
            }
        }
    }

    let hotspots = extract_host_function_hotspots(&result.events, result.total_cpu, result.total_memory);

    let mut profile = ResourceProfile {
        total_cpu: result.total_cpu,
        cpu_limit: 0,
        total_memory: result.total_memory,
        memory_limit: 0,
        total_read_bytes,
        total_write_bytes,
        read_limit: 0,
        write_limit: 0,
        hotspots,
        warnings: Vec::new(),
    };

    if let Some(top) = profile.hotspots.first() {
        if top.cpu_instructions > 0 || top.memory_bytes > 0 {
            profile.warnings.push(format!(
                "Most expensive host function: '{}' consumed {} CPU instructions ({:.1}%) and {} memory bytes ({:.1}%)",
                top.location, top.cpu_instructions, top.cpu_percentage, top.memory_bytes, top.memory_percentage
            ));
        }
    }

    if profile.cpu_limit > 0 {
        let cpu_usage = (profile.total_cpu as f64 / profile.cpu_limit as f64) * 100.0;
        if cpu_usage > 90.0 {
            profile.warnings.push(format!(
                "CPU usage is at {cpu_usage:.0}% of budget — consider increasing or optimizing"
            ));
        }
    }

    if profile.memory_limit > 0 {
        let mem_usage = (profile.total_memory as f64 / profile.memory_limit as f64) * 100.0;
        if mem_usage > 90.0 {
            profile.warnings.push(format!(
                "Memory usage is at {mem_usage:.0}% of budget — consider increasing or optimizing"
            ));
        }
    }

    if profile.write_limit > 0 {
        let write_usage = (profile.total_write_bytes as f64 / profile.write_limit as f64) * 100.0;
        if write_usage > 90.0 {
            profile.warnings.push(format!(
                "Write bytes usage is at {write_usage:.0}% of limit — consider reducing storage writes"
            ));
        }
    }

    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::sandbox::{TraceEvent, TraceEventType};

    #[test]
    fn test_extract_host_function_hotspots_sorting_and_attribution() {
        let events = vec![
            TraceEvent {
                event_type: TraceEventType::HostFunctionCall,
                timestamp_us: 10,
                data: serde_json::json!({
                    "function": "storage_get",
                    "cpu_insns": 100,
                    "mem_bytes": 500
                }),
            },
            TraceEvent {
                event_type: TraceEventType::HostFunctionReturn,
                timestamp_us: 20,
                data: serde_json::json!({
                    "function": "storage_get",
                    "cpu_insns": 500,
                    "mem_bytes": 1500
                }),
            },
            TraceEvent {
                event_type: TraceEventType::HostFunctionCall,
                timestamp_us: 25,
                data: serde_json::json!({
                    "function": "compute_sha256",
                    "cpu_insns": 600,
                    "mem_bytes": 2000
                }),
            },
            TraceEvent {
                event_type: TraceEventType::HostFunctionReturn,
                timestamp_us: 35,
                data: serde_json::json!({
                    "function": "compute_sha256",
                    "cpu_insns": 2000,
                    "mem_bytes": 2500
                }),
            },
        ];

        let hotspots = extract_host_function_hotspots(&events, 2000, 3000);
        assert_eq!(hotspots.len(), 2);
        // compute_sha256: 2000 - 600 = 1400 cpu
        // storage_get: 500 - 100 = 400 cpu
        assert_eq!(hotspots[0].location, "compute_sha256");
        assert_eq!(hotspots[0].cpu_instructions, 1400);
        assert_eq!(hotspots[1].location, "storage_get");
        assert_eq!(hotspots[1].cpu_instructions, 400);
    }
}

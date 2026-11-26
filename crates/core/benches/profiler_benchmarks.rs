//! Benchmarks for `crates/core/src/replay/profiler.rs`.
//!
//! These benchmarks pin the cost of running the resource profiler over
//! representative trace fixtures. They are wired into the `benchmark.yml`
//! regression baseline; a >10 % regression in any benchmark group fails CI.
//!
//! # Fixture sizes
//!
//! | Fixture                | Host-function pairs | Total events |
//! |------------------------|---------------------|--------------|
//! | `small_trace`          | 10                  | 20           |
//! | `medium_trace`         | 100                 | 200          |
//! | `large_trace`          | 1 000               | 2 000        |
//! | `realistic_trace`      | varies (mixed)      | ≈ 300        |
//!
//! Each `HostFunctionCall`/`HostFunctionReturn` pair carries plausible
//! CPU-instruction and memory-byte increments so the hotspot ranking is
//! exercised on every iteration.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use grat_core::replay::profiler::{extract_host_function_hotspots, generate_profile};
use grat_core::replay::sandbox::{SandboxResult, TraceEvent, TraceEventType};
use grat_core::types::trace::{DiffChangeType, LedgerEntryDiff, StateDiff, TraceId};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Creates a synthetic trace with `call_pairs` `HostFunctionCall` /
/// `HostFunctionReturn` event pairs spread across `function_count` distinct
/// function names. Each pair advances `cpu_insns` by `cpu_step` and
/// `mem_bytes` by `mem_step`.
fn make_trace_events(
    call_pairs: usize,
    function_count: usize,
    cpu_step: u64,
    mem_step: u64,
) -> Vec<TraceEvent> {
    let mut events = Vec::with_capacity(call_pairs * 2);
    let mut cpu: u64 = 0;
    let mut mem: u64 = 0;

    for i in 0..call_pairs {
        let fn_name = format!("host_fn_{}", i % function_count);
        events.push(TraceEvent {
            event_type: TraceEventType::HostFunctionCall,
            timestamp_us: (i * 2) as u64,
            data: serde_json::json!({
                "function": fn_name,
                "cpu_insns": cpu,
                "mem_bytes": mem,
            }),
        });
        cpu = cpu.saturating_add(cpu_step);
        mem = mem.saturating_add(mem_step);
        events.push(TraceEvent {
            event_type: TraceEventType::HostFunctionReturn,
            timestamp_us: (i * 2 + 1) as u64,
            data: serde_json::json!({
                "function": fn_name,
                "cpu_insns": cpu,
                "mem_bytes": mem,
            }),
        });
    }

    events
}

/// Creates a [`SandboxResult`] from a pre-built event list.
fn make_sandbox_result(events: Vec<TraceEvent>, total_cpu: u64, total_memory: u64) -> SandboxResult {
    SandboxResult {
        trace_id: TraceId::new(),
        success: true,
        events,
        final_state: std::collections::HashMap::new(),
        total_cpu,
        total_memory,
        diagnostic_events: vec![],
    }
}

/// Creates a [`StateDiff`] with `entry_count` updated entries.
///
/// Each entry carries `hex_bytes` hex bytes in both `before` and `after`
/// fields so the profiler's byte accounting is exercised.
fn make_state_diff(entry_count: usize, hex_bytes: usize) -> StateDiff {
    let hex_str = "ab".repeat(hex_bytes / 2 + 1).chars().take(hex_bytes).collect::<String>();
    StateDiff {
        entries: (0..entry_count)
            .map(|i| LedgerEntryDiff {
                key: format!("entry_{i}"),
                before: Some(hex_str.clone()),
                after: Some(hex_str.clone()),
                change_type: DiffChangeType::Updated,
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------
// Benchmark: extract_host_function_hotspots
// ---------------------------------------------------------------------------

fn bench_extract_hotspots(c: &mut Criterion) {
    let mut group = c.benchmark_group("profiler/extract_hotspots");

    for (label, call_pairs, fn_count) in [
        ("small_10_calls_5_fns", 10, 5),
        ("medium_100_calls_10_fns", 100, 10),
        ("large_1000_calls_20_fns", 1_000, 20),
        ("wide_1000_calls_200_fns", 1_000, 200),
    ] {
        let events = make_trace_events(call_pairs, fn_count, 1_000, 500);
        let total_cpu = call_pairs as u64 * 1_000;
        let total_mem = call_pairs as u64 * 500;

        group.throughput(Throughput::Elements(events.len() as u64));
        group.bench_with_input(
            BenchmarkId::new("extract_hotspots", label),
            &(events, total_cpu, total_mem),
            |b, (evts, cpu, mem)| {
                b.iter(|| {
                    let hotspots = extract_host_function_hotspots(
                        black_box(evts),
                        black_box(*cpu),
                        black_box(*mem),
                    );
                    black_box(hotspots)
                })
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: generate_profile (full pipeline)
// ---------------------------------------------------------------------------

fn bench_generate_profile(c: &mut Criterion) {
    let mut group = c.benchmark_group("profiler/generate_profile");

    for (label, call_pairs, fn_count, entry_count) in [
        ("small_trace", 10, 5, 5),
        ("medium_trace", 100, 10, 50),
        ("large_trace", 1_000, 20, 200),
        ("realistic_trace", 150, 15, 30),
    ] {
        let events = make_trace_events(call_pairs, fn_count, 2_000, 800);
        let total_cpu = call_pairs as u64 * 2_000;
        let total_mem = call_pairs as u64 * 800;
        let result = make_sandbox_result(events, total_cpu, total_mem);
        let diff = make_state_diff(entry_count, 64);

        group.throughput(Throughput::Elements(result.events.len() as u64));
        group.bench_with_input(
            BenchmarkId::new("generate_profile", label),
            &(result, diff),
            |b, (res, d)| {
                b.iter(|| {
                    let profile = generate_profile(black_box(res), black_box(d))
                        .expect("generate_profile must not fail");
                    black_box(profile)
                })
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: host-function call-count sanity
//
// This group measures the per-event throughput of the hotspot extractor so
// we can track it as a regression baseline in benchmark.yml.
// ---------------------------------------------------------------------------

fn bench_hotspot_call_count_sanity(c: &mut Criterion) {
    let mut group = c.benchmark_group("profiler/call_count_sanity");

    // Build a trace with exactly 500 call pairs across 50 distinct functions.
    let events = make_trace_events(500, 50, 1_500, 600);
    let total_cpu = 500 * 1_500_u64;
    let total_mem = 500 * 600_u64;

    group.throughput(Throughput::Elements(events.len() as u64));
    group.bench_function("500_calls_50_fns", |b| {
        b.iter(|| {
            let hotspots = extract_host_function_hotspots(
                black_box(&events),
                black_box(total_cpu),
                black_box(total_mem),
            );
            // Sanity assertion: we expect exactly 50 distinct function names.
            assert_eq!(hotspots.len(), 50, "expected 50 distinct hot functions");
            black_box(hotspots)
        })
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: mixed event types (InvocationStart/End mixed with host calls)
// ---------------------------------------------------------------------------

fn bench_mixed_event_trace(c: &mut Criterion) {
    let mut group = c.benchmark_group("profiler/mixed_events");

    // Build a trace that interleaves InvocationStart/End events with host
    // calls to exercise the event-type dispatch path in the profiler.
    let mut events: Vec<TraceEvent> = Vec::new();
    let mut cpu: u64 = 0;
    let mut mem: u64 = 0;

    for i in 0..100usize {
        // Invocation wrapper
        events.push(TraceEvent {
            event_type: TraceEventType::InvocationStart,
            timestamp_us: (i * 10) as u64,
            data: serde_json::json!({ "contract_id": format!("contract_{i}"), "function": "invoke" }),
        });

        // Two host calls per invocation
        for j in 0..2usize {
            let fn_name = format!("storage_{}", j % 5);
            events.push(TraceEvent {
                event_type: TraceEventType::HostFunctionCall,
                timestamp_us: (i * 10 + j + 1) as u64,
                data: serde_json::json!({
                    "function": fn_name,
                    "cpu_insns": cpu,
                    "mem_bytes": mem,
                }),
            });
            cpu = cpu.saturating_add(800);
            mem = mem.saturating_add(300);
            events.push(TraceEvent {
                event_type: TraceEventType::HostFunctionReturn,
                timestamp_us: (i * 10 + j + 2) as u64,
                data: serde_json::json!({
                    "function": fn_name,
                    "cpu_insns": cpu,
                    "mem_bytes": mem,
                }),
            });
        }

        events.push(TraceEvent {
            event_type: TraceEventType::InvocationEnd,
            timestamp_us: (i * 10 + 9) as u64,
            data: serde_json::json!({ "contract_id": format!("contract_{i}"), "is_error": false }),
        });
    }

    let total_cpu = cpu;
    let total_mem = mem;
    let result = make_sandbox_result(events, total_cpu, total_mem);
    let diff = make_state_diff(20, 32);

    group.throughput(Throughput::Elements(result.events.len() as u64));
    group.bench_function("100_invocations_200_host_calls", |b| {
        b.iter(|| {
            let profile = generate_profile(black_box(&result), black_box(&diff))
                .expect("generate_profile must not fail");
            black_box(profile)
        })
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

criterion_group!(
    benches,
    bench_extract_hotspots,
    bench_generate_profile,
    bench_hotspot_call_count_sanity,
    bench_mixed_event_trace,
);
criterion_main!(benches);

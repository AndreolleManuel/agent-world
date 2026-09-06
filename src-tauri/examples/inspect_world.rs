//! Read-only smoke check. Prints aggregate metrics, never raw agent/task data.
use pixel_ops_lib::heartbeat::{discover_agent_registry, read_world_snapshot};
fn main() {
    let Some(root) = std::env::args_os().nth(1).map(std::path::PathBuf::from) else {
        eprintln!(
            "usage: inspect_world ABSOLUTE_HERMES_ROOT [samples:1..60] [interval_ms:0..1000]"
        );
        std::process::exit(2);
    };
    let samples = std::env::args()
        .nth(2)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
        .clamp(1, 60);
    let interval = std::env::args()
        .nth(3)
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
        .min(1000);
    let registry = discover_agent_registry(&root).expect("registry_unavailable");
    let (mut partial_reads, mut min_ms, mut max_ms) = (0, u64::MAX, 0);
    for sample in 0..samples {
        if sample > 0 {
            std::thread::sleep(std::time::Duration::from_millis(interval));
        }
        let snapshot = read_world_snapshot(&root, &registry);
        partial_reads += u32::from(snapshot.kanban.partial);
        min_ms = min_ms.min(snapshot.collection_ms);
        max_ms = max_ms.max(snapshot.collection_ms);
        println!(
            "agents={} cards={} partial={} collection_ms={} active={} unknown={}",
            snapshot.agents.len(),
            snapshot.kanban.tasks.len(),
            snapshot.kanban.partial,
            snapshot.collection_ms,
            snapshot
                .agents
                .iter()
                .filter(|a| matches!(a.task_phase.as_str(), "live_run" | "live_session"))
                .count(),
            snapshot
                .agents
                .iter()
                .filter(|a| a.task_phase == "telemetry_unavailable")
                .count()
        );
        let mut sources = std::collections::BTreeMap::new();
        for agent in &snapshot.agents {
            for proof in &agent.evidence {
                *sources
                    .entry(format!(
                        "{}/{}/{}",
                        proof.source,
                        proof.status,
                        proof.error_code.as_deref().unwrap_or("none")
                    ))
                    .or_insert(0_u32) += 1;
            }
        }
        println!("source_counts={sources:?}");
    }
    println!(
        "summary samples={samples} partial_reads={partial_reads} min_ms={min_ms} max_ms={max_ms}"
    );
}

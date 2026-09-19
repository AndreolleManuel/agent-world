//! Administrative/local exporter. Never used as an SSH command.
#[path = "../../src-tauri/src/export.rs"]
mod export;
#[path = "../../src-tauri/src/heartbeat.rs"]
#[allow(dead_code)]
mod heartbeat;
#[path = "../../src-tauri/src/remote_protocol.rs"]
#[allow(dead_code)]
mod remote_protocol;
#[path = "../../src-tauri/src/sqlite_read.rs"]
mod sqlite_read;
#[path = "../../src-tauri/src/telemetry.rs"]
mod telemetry;
use std::{io::Write, path::Path};

fn run(args: &[String]) -> Result<(), &'static str> {
    if args == ["--version"] {
        println!(
            "agent-world-collector {} protocol=2 exporter",
            env!("CARGO_PKG_VERSION")
        );
        return Ok(());
    }
    if args.len() != 4 || args[0] != "--export" {
        return Err("usage_export_root_policy_output");
    }
    let root = Path::new(&args[1]);
    let policy = export::read_policy(Path::new(&args[2]))?;
    let response = export::collect(root, &policy)?;
    let bytes = serde_json::to_vec(&response).map_err(|_| "response_unavailable")?;
    if bytes.len() > remote_protocol::MAX_RESPONSE_BYTES {
        return Err("response_limit");
    }
    let output = Path::new(&args[3]);
    if !output.is_absolute() || output.file_name().is_none() {
        return Err("invalid_output");
    }
    let directory = output.parent().ok_or("invalid_output")?;
    let canonical = directory.canonicalize().map_err(|_| "invalid_output")?;
    if canonical != directory {
        return Err("invalid_output");
    }
    if std::fs::symlink_metadata(output).is_ok_and(|m| !m.is_file()) {
        return Err("invalid_output");
    }
    use std::os::unix::fs::OpenOptionsExt;
    let pending = directory.join(format!(".snapshot-{}.pending", std::process::id()));
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o640)
        .open(&pending)
        .map_err(|_| "output_unavailable")?;
    let result = (|| {
        f.write_all(&bytes)?;
        f.sync_all()?;
        std::fs::rename(&pending, output)?;
        std::fs::File::open(directory)?.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(pending);
    }
    result.map_err(|_| "output_unavailable")
}
fn main() {
    if let Err(code) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("agent_world:{code}");
        std::process::exit(1);
    }
}

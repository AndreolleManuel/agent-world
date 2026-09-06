//! One request over stdin, one allowlisted response over stdout. No listener.
#[path = "../../src-tauri/src/heartbeat.rs"]
#[allow(dead_code)] // Shared reader also exposes desktop-only entry points.
mod heartbeat;
#[path = "../../src-tauri/src/sqlite_read.rs"]
mod sqlite_read;
#[path = "../../src-tauri/src/remote_protocol.rs"]
#[allow(dead_code)] // The client parses responses; this binary only produces them.
mod remote_protocol;
use std::io::{Read, Write};

fn collect() -> Result<remote_protocol::Response, &'static str> {
    let mut input = Vec::new();
    std::io::stdin().take(8193).read_to_end(&mut input).map_err(|_| "request_unavailable")?;
    let request = remote_protocol::parse_request(&input)?;
    let root = match request.root {
        Some(root) => std::path::PathBuf::from(root),
        None => heartbeat::resolve_hermes_root().map_err(|_| "hermes_not_found")?,
    };
    let root = root.canonicalize().map_err(|_| "hermes_not_found")?;
    let registry = heartbeat::discover_agent_registry(&root).map_err(|_| "hermes_not_found")?;
    Ok(remote_protocol::Response { protocol: 1, root: root.to_string_lossy().into_owned(), snapshot: heartbeat::read_world_snapshot(&root, &registry) })
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--version"] { println!("agent-world-collector {} protocol=1", env!("CARGO_PKG_VERSION")); return; }
    if args != ["--stdio"] { eprintln!("usage: agent-world-collector --stdio | --version"); std::process::exit(2); }
    let result = collect().and_then(|response| {
        let bytes = serde_json::to_vec(&response).map_err(|_| "response_unavailable")?;
        if bytes.len() > remote_protocol::MAX_RESPONSE_BYTES { return Err("response_limit"); }
        std::io::stdout().write_all(&bytes).map_err(|_| "response_unavailable")
    });
    if let Err(code) = result { eprintln!("agent_world:{code}"); std::process::exit(1); }
}

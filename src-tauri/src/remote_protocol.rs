use serde::{Deserialize, Serialize};
use crate::heartbeat::WorldSnapshotDto;
pub const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request { pub protocol: u8, pub root: Option<String> }
#[derive(Serialize, Deserialize)]
pub struct Response { pub protocol: u8, pub root: String, pub snapshot: WorldSnapshotDto }

pub fn parse_request(bytes: &[u8]) -> Result<Request, &'static str> {
    if bytes.len() > 8192 { return Err("request_limit"); }
    let request: Request = serde_json::from_slice(bytes).map_err(|_| "invalid_request")?;
    if request.protocol != 1 { return Err("protocol_mismatch"); }
    if let Some(root) = &request.root {
        if root.len() > 4096 || !root.starts_with('/') || root.chars().any(char::is_control) { return Err("invalid_root"); }
    }
    Ok(request)
}

pub fn parse_response(bytes: &[u8]) -> Result<Response, &'static str> {
    if bytes.len() > MAX_RESPONSE_BYTES { return Err("response_limit"); }
    let response: Response = serde_json::from_slice(bytes).map_err(|_| "invalid_response")?;
    if response.protocol != 1 { return Err("protocol_mismatch"); }
    if !response.root.starts_with('/') || response.root.len() > 4096 || response.root.chars().any(char::is_control)
        || response.snapshot.agents.len() > 256 || response.snapshot.kanban.tasks.len() > 512 {
        return Err("invalid_response");
    }
    let mut ids = std::collections::HashSet::new();
    for agent in &response.snapshot.agents {
        if agent.agent_id.is_empty() || agent.agent_id.len() > 256 || !ids.insert(&agent.agent_id)
            || agent.display_name.chars().count() > 128 || agent.evidence.len() > 128 { return Err("invalid_response"); }
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_is_versioned_bounded_and_never_shell_code() {
        assert!(parse_request(br#"{"protocol":1,"root":"/home/user/a b'c"}"#).is_ok());
        assert!(parse_request(br#"{"protocol":2,"root":null}"#).is_err());
        assert!(parse_request(br#"{"protocol":1,"root":"relative"}"#).is_err());
        assert!(parse_request(br#"{"protocol":1,"root":null,"sql":"DROP"}"#).is_err());
        assert!(parse_request(&vec![b' '; 8193]).is_err());
        assert!(parse_response(&vec![b' '; MAX_RESPONSE_BYTES + 1]).is_err());
    }
}

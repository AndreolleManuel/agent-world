use std::{io::Write, process::{Command, Stdio}};
fn invoke(input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_agent-world-collector")).arg("--stdio")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}
#[test]
fn reads_a_real_temporary_profile_and_only_outputs_the_allowlisted_snapshot() {
    let fixture = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(fixture.path().join("state")).unwrap();
    std::fs::write(fixture.path().join("profile.yaml"), "display_name: Remote Fixture\nsecret: MUST_NOT_LEAK\n").unwrap();
    let input = serde_json::to_vec(&serde_json::json!({"protocol":1,"root":fixture.path()})).unwrap();
    let output = invoke(&input);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["protocol"], 1);
    assert_eq!(value["snapshot"]["agents"].as_array().unwrap().len(), 1);
    assert!(!String::from_utf8_lossy(&output.stdout).contains("MUST_NOT_LEAK"));
    assert_eq!(std::fs::read_to_string(fixture.path().join("profile.yaml")).unwrap(), "display_name: Remote Fixture\nsecret: MUST_NOT_LEAK\n");
}
#[test]
fn rejects_wrong_versions_and_unknown_operations_without_echoing_input() {
    for input in [br#"{"protocol":99,"root":null}"#.as_slice(), br#"{"protocol":1,"root":null,"command":"SECRET"}"#.as_slice()] {
        let output = invoke(input); assert!(!output.status.success()); assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains("SECRET"));
    }
}

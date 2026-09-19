use std::process::Command;
#[test]
fn exports_only_explicit_profiles_and_never_private_metadata_by_default() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    std::fs::write(
        root.join("profile.yaml"),
        "display_name: PRIVATE_SENTINEL_NAME\nsecret: PRIVATE_SENTINEL_KEY\n",
    )
    .unwrap();
    let policy = root.join("policy.json");
    std::fs::write(
        &policy,
        serde_json::to_vec(&serde_json::json!({"salt":"a".repeat(64),"profiles":["default"]}))
            .unwrap(),
    )
    .unwrap();
    let output = root.join("snapshot.json");
    let run = Command::new(env!("CARGO_BIN_EXE_agent-world-collector"))
        .arg("--export")
        .arg(&root)
        .arg(&policy)
        .arg(&output)
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let json = std::fs::read_to_string(&output).unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["protocol"], 2);
    assert_eq!(value["snapshot"]["agents"].as_array().unwrap().len(), 1);
    assert!(!json.contains("PRIVATE_SENTINEL"));
    assert!(!json.contains(root.to_str().unwrap()));
    let before = std::fs::read(&output).unwrap();
    std::fs::write(&policy, br#"{"salt":"bad","profiles":[]}"#).unwrap();
    assert!(
        !Command::new(env!("CARGO_BIN_EXE_agent-world-collector"))
            .arg("--export")
            .arg(&root)
            .arg(&policy)
            .arg(&output)
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(std::fs::read(&output).unwrap(), before);
}
#[test]
fn rejects_legacy_ssh_entrypoint_and_never_echoes_input() {
    let output = Command::new(env!("CARGO_BIN_EXE_agent-world-collector"))
        .arg("--stdio")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}

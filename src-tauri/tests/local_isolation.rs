#![cfg(target_os = "macos")]
use pixel_ops_lib::local_helper::{collect_with, sandbox_profile};
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};
#[test]
fn real_helper_reads_only_approved_metadata_and_redacts_titles() {
    let root = tempfile::tempdir().unwrap();
    let root = root.path().canonicalize().unwrap();
    fs::write(
        root.join("profile.yaml"),
        "display_name: Local Fixture\nsecret: PRIVATE_SENTINEL\n",
    )
    .unwrap();
    fs::write(root.join(".env"), "PRIVATE_SENTINEL").unwrap();
    let db = rusqlite::Connection::open(root.join("state.db")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE sessions (id TEXT,title TEXT,ended_at REAL,started_at REAL,last_activity_at REAL,last_activity_description TEXT); CREATE TABLE session_turn_leases (conversation_id TEXT,expires_at REAL);").unwrap();
    let db = rusqlite::Connection::open(root.join("kanban.db")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE tasks (id TEXT,assignee TEXT,status TEXT,title TEXT,block_kind TEXT,created_at INTEGER); CREATE TABLE task_runs (id INTEGER,task_id TEXT,status TEXT,outcome TEXT,ended_at TEXT,last_heartbeat_at INTEGER,started_at INTEGER,claim_expires INTEGER);").unwrap();
    drop(db);
    assert!(!root.join("kanban.db-wal").exists());
    let r = collect_with(
        &root,
        &"a".repeat(64),
        std::path::Path::new(env!("CARGO_BIN_EXE_pixel-ops")),
    )
    .unwrap();
    assert!(
        !r.snapshot.kanban.partial,
        "closed WAL must stay readable inside the sandbox"
    );
    assert!(!root.join("kanban.db-wal").exists());
    assert!(!root.join("kanban.db-shm").exists());
    assert_eq!(r.snapshot.agents.len(), 1);
    assert_eq!(r.snapshot.agents[0].display_name, "Local Fixture");
    let json = serde_json::to_string(&r).unwrap();
    assert!(!json.contains("PRIVATE_SENTINEL"));
    assert!(!json.contains(root.to_str().unwrap()));
}
#[test]
fn sandbox_denies_private_files_inside_and_outside_root_and_all_writes() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(root.join(".env"), "PRIVATE_SENTINEL").unwrap();
    fs::write(outside.path().join("private.txt"), "PRIVATE_SENTINEL").unwrap();
    fs::write(root.join("profile.yaml"), "display_name: Fixture").unwrap();
    for (path, success) in [
        (root.join("profile.yaml"), true),
        (root.join(".env"), false),
        (outside.path().join("private.txt"), false),
    ] {
        let profile = sandbox_profile(&root, std::path::Path::new("/bin/cat")).unwrap();
        let result = Command::new("/usr/bin/sandbox-exec")
            .args(["-p", &profile, "/bin/cat"])
            .arg(path)
            .output()
            .unwrap();
        assert_eq!(
            result.status.success(),
            success,
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(!String::from_utf8_lossy(&result.stdout).contains("PRIVATE_SENTINEL"));
    }
    let profile = sandbox_profile(&root, std::path::Path::new("/usr/bin/tee")).unwrap();
    let mut child = Command::new("/usr/bin/sandbox-exec")
        .args(["-p", &profile, "/usr/bin/tee"])
        .arg(root.join("forbidden"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"NO").unwrap();
    assert!(!child.wait().unwrap().success());
    assert!(!root.join("forbidden").exists());
}

#[test]
fn sandbox_denies_network_and_process_creation_at_the_syscall_boundary() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    let source = root.join("probe.c");
    let binary = root.join("probe");
    fs::write(&source, r#"#include <sys/socket.h>
#include <unistd.h>
#include <errno.h>
#include <netinet/in.h>
int main(void) {
 int s=socket(AF_INET, SOCK_STREAM, 0);
 if(s >= 0) {
   struct sockaddr_in a = {0}; a.sin_family=AF_INET; a.sin_port=htons(9); a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
   if(connect(s,(struct sockaddr*)&a,sizeof(a)) != -1 || errno != EPERM) return 1;
   a.sin_port=0;
   if(bind(s,(struct sockaddr*)&a,sizeof(a)) != -1 || errno != EPERM) return 4;
   close(s);
 } else if(errno != EPERM) return 5;
 int p=fork();
 if(p == 0) _exit(2);
 if(p >= 0 || errno != EPERM) return 3;
 return 0;
}"#).unwrap();
    assert!(
        Command::new("/usr/bin/cc")
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .status()
            .unwrap()
            .success()
    );
    let profile = sandbox_profile(&root, &binary).unwrap();
    let result = Command::new("/usr/bin/sandbox-exec")
        .args(["-p", &profile])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{} {:?}",
        String::from_utf8_lossy(&result.stderr),
        result.status.code()
    );
}

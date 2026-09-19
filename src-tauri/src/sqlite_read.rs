//! Bounded, read-only embedded SQLite adapter. No shell or raw error DTOs.
use rusqlite::{
    Connection, ErrorCode, OpenFlags,
    hooks::{AuthAction, AuthContext, Authorization},
    limits::Limit,
    types::ValueRef,
};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::{
    fs::File,
    io::{self, Read, Write},
    path::Path,
    sync::{Mutex, TryLockError},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug)]
pub enum QueryError {
    Unavailable,
    Timeout,
    TooLarge,
    Changed,
    Busy,
    ReadOnly,
    OpenFailed,
}
impl QueryError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "read_failed",
            Self::Timeout => "timeout",
            Self::TooLarge => "limit_exceeded",
            Self::Changed => "source_changed",
            Self::Busy => "database_busy",
            Self::ReadOnly => "readonly_storage",
            Self::OpenFailed => "database_open_failed",
        }
    }
}

#[cfg(unix)]
fn identity(file: &File) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let m = file.metadata().ok()?;
    (m.is_file() && m.nlink() == 1).then_some((m.dev(), m.ino()))
}

#[cfg(not(unix))]
fn identity(_file: &File) -> Option<(u64, u64)> {
    None
}

// Serialize adapter connections: closing a separate descriptor of the same
// inode can release POSIX locks held by another connection in this process.
// Do not let IPC calls overlap that descriptor-validation window.
static READ_GATE: Mutex<()> = Mutex::new(());

pub fn query(path: &Path, sql: &str, cap: usize, deadline: Instant) -> Result<Vec<u8>, QueryError> {
    let _gate = loop {
        if Instant::now() >= deadline {
            return Err(QueryError::Timeout);
        }
        match READ_GATE.try_lock() {
            Ok(guard) => break guard,
            Err(TryLockError::Poisoned(_)) => return Err(QueryError::Unavailable),
            Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(1)),
        }
    };
    let end = deadline.min(Instant::now() + Duration::from_millis(350));
    let parent =
        super::heartbeat::open_directory_no_symlinks(path.parent().ok_or(QueryError::Unavailable)?)
            .map_err(|_| QueryError::Unavailable)?;
    let file = super::heartbeat::open_child_file(
        &parent,
        path.file_name().ok_or(QueryError::Unavailable)?,
    )
    .ok_or(QueryError::Unavailable)?;
    let before = identity(&file).ok_or(QueryError::Unavailable)?;
    // Never use immutable=1 or ignore the live WAL. Keep the existing sidecar
    // checks: embedded SQLite also opens auxiliary files by pathname.
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        match std::fs::symlink_metadata(&sidecar) {
            Ok(m) if m.file_type().is_symlink() || !m.is_file() || m.nlink() != 1 => {
                return Err(QueryError::Unavailable);
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(QueryError::Unavailable);
            }
            _ => {}
        }
    }
    // The bundled upstream engine can read a clean, closed WAL database.
    // macOS /usr/bin/sqlite3 3.51.0 failed with CANTOPEN on its absent -wal file.
    let isolated = closed_wal_view(path, &file, end)?;
    let (connection, stamp) = match isolated {
        Some((connection, stamp)) => (connection, Some(stamp)),
        None => (open_readonly(path)?, None),
    };
    let bytes = read_rows(connection, sql, cap, end)?;
    if let Some(stamp) = stamp
        && (file_stamp(&file)? != stamp || !sidecars_absent(path)?)
    {
        return Err(QueryError::Changed);
    }
    // read_rows drops its statement/connection BEFORE reopening or closing any
    // extra descriptor. No SQLite read transaction is held across this check.
    let current_parent = super::heartbeat::open_directory_no_symlinks(path.parent().unwrap())
        .map_err(|_| QueryError::Changed)?;
    let current = super::heartbeat::open_child_file(&current_parent, path.file_name().unwrap())
        .ok_or(QueryError::Changed)?;
    if identity(&current) != Some(before) {
        return Err(QueryError::Changed);
    }
    Ok(bytes)
}

fn authorize(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Select | AuthAction::Read { .. } | AuthAction::Recursive => {
            Authorization::Allow
        }
        AuthAction::Function { function_name }
            if !function_name.eq_ignore_ascii_case("load_extension") =>
        {
            Authorization::Allow
        }
        AuthAction::Pragma { pragma_name, .. }
            if pragma_name.eq_ignore_ascii_case("table_info") =>
        {
            Authorization::Allow
        }
        _ => Authorization::Deny,
    }
}

type FileStamp = (u64, u64, u64, i64, i64, i64, i64);
fn file_stamp(file: &File) -> Result<FileStamp, QueryError> {
    let m = file.metadata().map_err(|_| QueryError::Unavailable)?;
    Ok((
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
    ))
}
fn sidecars_absent(path: &Path) -> Result<bool, QueryError> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        match std::fs::symlink_metadata(name) {
            Ok(_) => return Ok(false),
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(_) => return Err(QueryError::Unavailable),
        }
    }
    Ok(true)
}
// A cleanly closed WAL database can require SQLite to CREATE sidecars even for
// a read-only connection. Never grant writes to Hermes to accommodate that.
// Only when ALL sidecars are absent, use a bounded private in-memory image.
// Reject it if inode/size/nanosecond mtime/ctime changes or a sidecar appears.
// Live WALs always use SQLite's normal WAL reader/locks; never immutable=1.
fn closed_wal_view(
    path: &Path,
    file: &File,
    end: Instant,
) -> Result<Option<(Connection, FileStamp)>, QueryError> {
    use std::os::unix::fs::FileExt;
    let mut header = [0u8; 100];
    if file
        .read_at(&mut header, 0)
        .map_err(|_| QueryError::Unavailable)?
        != 100
        || &header[..16] != b"SQLite format 3\0"
        || header[18..20] != [2, 2]
        || !sidecars_absent(path)?
    {
        return Ok(None);
    }
    let stamp = file_stamp(file)?;
    const MAX_IMAGE: u64 = 32 * 1024 * 1024;
    if stamp.2 > MAX_IMAGE {
        return Err(QueryError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| QueryError::Unavailable)?;
    if bytes.len() as u64 != stamp.2 || file_stamp(file)? != stamp || !sidecars_absent(path)? {
        return Err(QueryError::Changed);
    }
    if Instant::now() >= end {
        return Err(QueryError::Timeout);
    }
    // SQLite's documented deserialize WAL workaround applies only to this copy.
    bytes[18] = 1;
    bytes[19] = 1;
    let mut connection = Connection::open_in_memory().map_err(classify_error)?;
    connection
        .deserialize_read_exact("main", io::Cursor::new(&bytes), bytes.len(), true)
        .map_err(classify_error)?;
    Ok(Some((connection, stamp)))
}
fn open_readonly(path: &Path) -> Result<Connection, QueryError> {
    // Encode every URI metacharacter: filenames can never supply SQLite options.
    let path = path.to_str().ok_or(QueryError::Unavailable)?;
    let encoded: String = path
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"/-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    Connection::open_with_flags(
        format!("file:{encoded}?mode=ro&readonly_shm=1"),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(classify_error)
}
fn read_rows(
    connection: Connection,
    sql: &str,
    cap: usize,
    end: Instant,
) -> Result<Vec<u8>, QueryError> {
    if Instant::now() >= end {
        return Err(QueryError::Timeout);
    }
    connection
        .busy_timeout(Duration::from_millis(100).min(end.saturating_duration_since(Instant::now())))
        .map_err(classify_error)?;
    connection
        .progress_handler(1000, Some(move || Instant::now() >= end))
        .map_err(classify_error)?;
    connection
        .set_limit(
            Limit::SQLITE_LIMIT_LENGTH,
            cap.clamp(64 * 1024, 1024 * 1024) as i32,
        )
        .map_err(classify_error)?;
    connection
        .set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, 16 * 1024)
        .map_err(classify_error)?;
    connection
        .set_limit(Limit::SQLITE_LIMIT_COLUMN, 64)
        .map_err(classify_error)?;
    connection
        .execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;")
        .map_err(classify_error)?;
    connection
        .authorizer(Some(authorize))
        .map_err(classify_error)?;
    let mut statement = connection.prepare(sql).map_err(classify_error)?;
    if !statement.readonly() {
        return Err(QueryError::ReadOnly);
    }
    let names = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query([]).map_err(classify_error)?;
    let mut output = CappedOutput {
        bytes: Vec::new(),
        cap,
    };
    output.write_all(b"[").map_err(|_| QueryError::TooLarge)?;
    let mut first = true;
    while let Some(row) = rows.next().map_err(classify_error)? {
        if Instant::now() >= end {
            return Err(QueryError::Timeout);
        }
        let mut object = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i).map_err(classify_error)? {
                ValueRef::Null => serde_json::Value::Null,
                ValueRef::Integer(v) => v.into(),
                ValueRef::Real(v) => serde_json::json!(v),
                ValueRef::Text(v) => {
                    if v.len() > cap {
                        return Err(QueryError::TooLarge);
                    }
                    std::str::from_utf8(v)
                        .map_err(|_| QueryError::Unavailable)?
                        .into()
                }
                ValueRef::Blob(_) => return Err(QueryError::Unavailable),
            };
            object.insert(name.clone(), value);
        }
        if !first {
            output.write_all(b",").map_err(|_| QueryError::TooLarge)?;
        }
        serde_json::to_writer(&mut output, &object).map_err(|_| QueryError::TooLarge)?;
        first = false;
    }
    output.write_all(b"]").map_err(|_| QueryError::TooLarge)?;
    if Instant::now() >= end {
        return Err(QueryError::Timeout);
    }
    // Preserve the adapter's existing successful-empty contract.
    Ok(if first { Vec::new() } else { output.bytes })
}

struct CappedOutput {
    bytes: Vec<u8>,
    cap: usize,
}
impl Write for CappedOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.cap.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("limit_exceeded"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn classify_error(error: rusqlite::Error) -> QueryError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => QueryError::Busy,
        Some(
            ErrorCode::ReadOnly
            | ErrorCode::AuthorizationForStatementDenied
            | ErrorCode::PermissionDenied,
        ) => QueryError::ReadOnly,
        Some(ErrorCode::CannotOpen) => QueryError::OpenFailed,
        Some(ErrorCode::OperationInterrupted) => QueryError::Timeout,
        Some(ErrorCode::TooBig) => QueryError::TooLarge,
        _ => QueryError::Unavailable,
    }
}

pub fn rows<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<Vec<T>, QueryError> {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Vec::new());
    }
    serde_json::from_slice(bytes).map_err(|_| QueryError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};

    #[test]
    fn sqlite_errors_expose_codes_not_raw_messages() {
        let error = |code| {
            rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(code),
                Some("private path or SQL must not escape".into()),
            )
        };
        assert_eq!(
            classify_error(error(rusqlite::ffi::SQLITE_BUSY)).code(),
            "database_busy"
        );
        assert_eq!(
            classify_error(error(rusqlite::ffi::SQLITE_READONLY)).code(),
            "readonly_storage"
        );
        assert_eq!(
            classify_error(error(rusqlite::ffi::SQLITE_CANTOPEN)).code(),
            "database_open_failed"
        );
        assert_eq!(
            classify_error(error(rusqlite::ffi::SQLITE_CORRUPT)).code(),
            "read_failed"
        );
    }

    #[test]
    fn reads_closed_wal_database_without_preexisting_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().canonicalize().unwrap().join("closed-wal.db");
        // Reproduce the native macOS writer's clean shutdown. Never touch Hermes.
        let created = Command::new("/usr/bin/sqlite3")
            .args(["-cmd", ".filectrl persist_wal 0"])
            .arg(&path)
            .arg("PRAGMA journal_mode=WAL; CREATE TABLE t(x); INSERT INTO t VALUES(42);")
            .output()
            .unwrap();
        assert!(created.status.success());
        assert!(!path.with_extension("db-wal").exists());
        assert!(!path.with_extension("db-shm").exists());
        let before = std::fs::read(&path).unwrap();
        for _ in 0..10 {
            let bytes = query(
                &path,
                "SELECT x FROM t",
                1024,
                Instant::now() + Duration::from_secs(1),
            )
            .unwrap();
            assert_eq!(
                rows::<serde_json::Value>(&bytes).unwrap(),
                vec![serde_json::json!({"x":42})]
            );
        }
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(!path.with_extension("db-wal").exists());
        assert!(!path.with_extension("db-shm").exists());
    }

    #[test]
    fn uri_metacharacters_in_filenames_cannot_change_readonly_options() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .canonicalize()
            .unwrap()
            .join("literal?mode=rwc&immutable=1.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES(7);")
            .unwrap();
        drop(db);
        let bytes = query(
            &path,
            "SELECT x FROM t",
            1024,
            Instant::now() + Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(
            rows::<serde_json::Value>(&bytes).unwrap(),
            vec![serde_json::json!({"x":7})]
        );
        assert!(!path.parent().unwrap().join("literal").exists());
    }

    // A real separate-process writer avoids accidentally testing SQLite against
    // another connection sharing this test process's POSIX file locks.
    struct Writer(Child);
    impl Drop for Writer {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    fn writer(path: &Path, sql: &str) -> Writer {
        use std::io::{BufRead, BufReader};
        let mut child = Writer(
            Command::new("/usr/bin/sqlite3")
                .arg(path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        writeln!(child.0.stdin.as_mut().unwrap(), "{sql}\n.print ready").unwrap();
        let stdout = child.0.stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line == "ready" {
                    let _ = send.send(());
                    break;
                }
            }
        });
        receive
            .recv_timeout(Duration::from_secs(2))
            .expect("synthetic writer did not become ready");
        child
    }

    #[test]
    fn reads_committed_live_wal_without_checkpointing_or_reading_uncommitted_work() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().canonicalize().unwrap().join("live.db");
        let mut writer = writer(
            &path,
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(x); INSERT INTO t VALUES(41); BEGIN IMMEDIATE; INSERT INTO t VALUES(99);",
        );
        let before = std::fs::read(&path).unwrap();
        let wal_before = std::fs::read(path.with_extension("db-wal")).unwrap();
        for _ in 0..5 {
            let bytes = query(
                &path,
                "SELECT x FROM t",
                1024,
                Instant::now() + Duration::from_secs(1),
            )
            .unwrap();
            assert_eq!(
                rows::<serde_json::Value>(&bytes).unwrap(),
                vec![serde_json::json!({"x":41})]
            );
        }
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(
            std::fs::read(path.with_extension("db-wal")).unwrap(),
            wal_before
        );
        writeln!(writer.0.stdin.as_mut().unwrap(), "ROLLBACK;").unwrap();
    }

    #[test]
    fn locked_database_and_expired_budget_fail_within_bounds() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().canonicalize().unwrap().join("locked.db");
        let _writer = writer(
            &path,
            "CREATE TABLE t(x); BEGIN EXCLUSIVE; INSERT INTO t VALUES(1);",
        );
        let start = Instant::now();
        assert!(matches!(
            query(
                &path,
                "SELECT x FROM t",
                1024,
                start + Duration::from_secs(1)
            ),
            Err(QueryError::Busy)
        ));
        assert!(start.elapsed() < Duration::from_millis(500));
        assert!(matches!(
            query(&path, "SELECT x FROM t", 1024, Instant::now()),
            Err(QueryError::Timeout)
        ));
    }

    #[test]
    fn denies_mutations_attachments_and_missing_database_creation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().canonicalize().unwrap().join("guarded.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES(42);")
            .unwrap();
        let before = std::fs::read(&path).unwrap();
        for sql in [
            "INSERT INTO t VALUES(7)",
            "DELETE FROM t",
            "DROP TABLE t",
            "PRAGMA query_only=OFF",
            "ATTACH DATABASE ':memory:' AS extra",
        ] {
            assert!(
                matches!(
                    query(&path, sql, 1024, Instant::now() + Duration::from_secs(1)),
                    Err(QueryError::ReadOnly)
                ),
                "{sql}"
            );
        }
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let absent = path.with_file_name("must-not-be-created.db");
        assert!(
            query(
                &absent,
                "SELECT 1",
                1024,
                Instant::now() + Duration::from_secs(1)
            )
            .is_err()
        );
        assert!(!absent.exists());
    }

    #[test]
    fn bounded_queries_timeout_and_limit_output_without_mutating_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().canonicalize().unwrap().join("test.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t(x);")
            .unwrap();
        let before = std::fs::read(&path).unwrap();
        let deadline = || Instant::now() + Duration::from_secs(1);
        assert_eq!(
            query(&path, "SELECT * FROM t", 100, deadline()).unwrap(),
            Vec::<u8>::new()
        );
        assert!(matches!(
            query(&path, "SELECT hex(zeroblob(10000))", 100, deadline()),
            Err(QueryError::TooLarge)
        ));
        let started = Instant::now();
        assert!(matches!(
            query(
                &path,
                "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n",
                100,
                deadline()
            ),
            Err(QueryError::Timeout)
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}

//! The SSH login shell inside a root-owned chroot. No SQLite, shell or user paths.
#[path = "../../src-tauri/src/remote_protocol.rs"]
#[allow(dead_code)]
mod remote_protocol;
#[path = "../../src-tauri/src/telemetry.rs"]
#[allow(dead_code)]
mod telemetry;
use std::{
    io::{Read, Write},
    time::Duration,
};

#[cfg(target_os = "linux")]
fn restrict_process() -> Result<(), &'static str> {
    for (kind, value) in [
        (libc::RLIMIT_CPU, 2),
        (libc::RLIMIT_AS, 64 * 1024 * 1024),
        (libc::RLIMIT_NPROC, 0),
        (libc::RLIMIT_FSIZE, 0),
        (libc::RLIMIT_NOFILE, 16),
        (libc::RLIMIT_CORE, 0),
    ] {
        let limit = libc::rlimit {
            rlim_cur: value,
            rlim_max: value,
        };
        if unsafe { libc::setrlimit(kind, &limit) } != 0 {
            return Err("confinement_unavailable");
        }
    }
    // An independent wall deadline includes a client that never closes stdin.
    unsafe {
        libc::alarm(5);
    }
    #[cfg(target_arch = "x86_64")]
    const ARCH: u32 = 0xc000003e;
    #[cfg(target_arch = "aarch64")]
    const ARCH: u32 = 0xc00000b7;
    let mut filter = vec![
        libc::sock_filter {
            code: 0x20,
            jt: 0,
            jf: 0,
            k: 4,
        },
        libc::sock_filter {
            code: 0x15,
            jt: 1,
            jf: 0,
            k: ARCH,
        },
        libc::sock_filter {
            code: 0x06,
            jt: 0,
            jf: 0,
            k: 0x8000_0000,
        },
        libc::sock_filter {
            code: 0x20,
            jt: 0,
            jf: 0,
            k: 0,
        },
    ];
    // Allow only IO on already-open descriptors and bounded runtime housekeeping.
    // No open/openat, network, process creation, exec or io_uring escape hatch.
    for call in [
        libc::SYS_read,
        libc::SYS_write,
        libc::SYS_readv,
        libc::SYS_writev,
        libc::SYS_close,
        libc::SYS_exit,
        libc::SYS_exit_group,
        libc::SYS_fstat,
        libc::SYS_newfstatat,
        libc::SYS_statx,
        libc::SYS_lseek,
        libc::SYS_fcntl,
        libc::SYS_ioctl,
        libc::SYS_clock_gettime,
        libc::SYS_gettimeofday,
        libc::SYS_nanosleep,
        libc::SYS_clock_nanosleep,
        libc::SYS_futex,
        libc::SYS_mmap,
        libc::SYS_munmap,
        libc::SYS_mremap,
        libc::SYS_mprotect,
        libc::SYS_madvise,
        libc::SYS_brk,
        libc::SYS_rt_sigaction,
        libc::SYS_rt_sigprocmask,
        libc::SYS_rt_sigreturn,
        libc::SYS_sigaltstack,
        libc::SYS_getrandom,
        libc::SYS_getpid,
        libc::SYS_gettid,
        libc::SYS_sched_yield,
        libc::SYS_restart_syscall,
    ] {
        filter.push(libc::sock_filter {
            code: 0x15,
            jt: 0,
            jf: 1,
            k: call as u32,
        });
        filter.push(libc::sock_filter {
            code: 0x06,
            jt: 0,
            jf: 0,
            k: 0x7fff_0000,
        });
    }
    filter.push(libc::sock_filter {
        code: 0x06,
        jt: 0,
        jf: 0,
        k: 0x0005_0000 | libc::EPERM as u32,
    });
    let program = libc::sock_fprog {
        len: filter.len() as u16,
        filter: filter.as_mut_ptr(),
    };
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0
        || unsafe { libc::prctl(libc::PR_SET_SECCOMP, 2, &program) } != 0
    {
        return Err("confinement_unavailable");
    }
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn restrict_process() -> Result<(), &'static str> {
    Err("linux_required")
}

fn run() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!(
            "agent-world-reader {} protocol=2",
            env!("CARGO_PKG_VERSION")
        );
        return Ok(());
    }
    // sshd invokes the account shell with -c ForceCommand. Interactive login is rejected.
    if args != ["-c", "snapshot"] {
        return Err("operation_not_allowed");
    }
    if std::env::var("SSH_ORIGINAL_COMMAND").ok().as_deref() != Some("snapshot") {
        return Err("operation_not_allowed");
    }
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open("/data/snapshot.json")
        .map_err(|_| "snapshot_unavailable")?;
    let m = file.metadata().map_err(|_| "snapshot_unavailable")?;
    if !m.is_file() || m.nlink() != 1 || m.len() > remote_protocol::MAX_RESPONSE_BYTES as u64 {
        return Err("invalid_response");
    }
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open("/read.lock")
        .map_err(|_| "confinement_unavailable")?;
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("reader_busy");
    }
    restrict_process()?;
    let mut input = Vec::new();
    std::io::stdin()
        .take((remote_protocol::MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut input)
        .map_err(|_| "invalid_request")?;
    remote_protocol::parse_request(&input)?;
    let mut bytes = Vec::new();
    file.take((remote_protocol::MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "snapshot_unavailable")?;
    let mut response = remote_protocol::parse_response(&bytes)?;
    remote_protocol::age_snapshot(&mut response, time::OffsetDateTime::now_utc())?;
    // Keep the original collected_at: fetching a snapshot never produces new evidence.
    let output = serde_json::to_vec(&response).map_err(|_| "invalid_response")?;
    if output.len() > remote_protocol::MAX_RESPONSE_BYTES {
        return Err("response_limit");
    }
    std::thread::sleep(Duration::from_secs(1));
    std::io::stdout()
        .write_all(&output)
        .map_err(|_| "response_unavailable")
}
fn main() {
    if let Err(code) = run() {
        eprintln!("agent_world:{code}");
        std::process::exit(1);
    }
}

#[cfg(all(test, target_os = "linux"))]
mod isolation_tests {
    use super::*;
    #[test]
    fn seccomp_denies_open_socket_and_fork_even_without_chroot() {
        let child = unsafe { libc::fork() };
        assert!(child >= 0);
        if child == 0 {
            if restrict_process().is_err() {
                unsafe { libc::_exit(10) }
            }
            let fd = unsafe { libc::open(c"/etc/passwd".as_ptr(), libc::O_RDONLY) };
            if fd != -1 || std::io::Error::last_os_error().raw_os_error() != Some(libc::EPERM) {
                unsafe { libc::_exit(11) }
            }
            let socket = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
            if socket != -1 || std::io::Error::last_os_error().raw_os_error() != Some(libc::EPERM) {
                unsafe { libc::_exit(12) }
            }
            let process = unsafe { libc::fork() };
            if process != -1 || std::io::Error::last_os_error().raw_os_error() != Some(libc::EPERM)
            {
                unsafe { libc::_exit(13) }
            }
            unsafe { libc::_exit(0) }
        }
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(child, &mut status, 0) }, child);
        assert_eq!(status, 0, "confinement probe failed");
    }
}

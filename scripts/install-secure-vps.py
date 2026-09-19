#!/usr/bin/env python3
"""Administrative installer. Run reviewed source locally on the target Linux server.
Never called by the desktop app. Only manages /var/lib/agent-world, named units,
a dedicated account/key file and one sshd fragment; never changes Hermes data.
"""
import argparse, base64, hashlib, json, os, pathlib, pwd, re, shutil, stat, subprocess, sys, tempfile, time
from vps_admin import capture, restore
P = pathlib.Path
BASE = P('/var/lib/agent-world')
SSH_FRAGMENT = P('/etc/ssh/sshd_config.d/60-agent-world.conf')
MARKER = '# Managed by Agent World protocol 2\n'
SHELL = '/usr/local/libexec/agent-world-reader'

def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

def safe_path(path):
    path = P(path)
    if not path.is_absolute() or any(ord(c) < 32 for c in str(path)): raise ValueError('Absolute clean path required')
    for p in [path, *path.parents]:
        if p.is_symlink(): raise ValueError('Symlink refused: '+str(p))
    return path

def atomic(path, contents, mode=0o644):
    path = safe_path(path); safe_path(path.parent)
    if path.exists() and not path.is_file(): raise ValueError('Regular file required')
    fd, name = tempfile.mkstemp(prefix='.agent-world-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as f: f.write(contents); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def elf(path, expected):
    path = safe_path(path); b = path.read_bytes()
    if len(b) < 64 or len(b) > 16*1024*1024 or b[:6] != b'\x7fELF\x02\x01': raise ValueError('Static ELF required')
    if hashlib.sha256(b).hexdigest() != expected: raise ValueError('Binary hash mismatch')
    machine = int.from_bytes(b[18:20], 'little')
    if machine != {'x86_64':62, 'aarch64':183}.get(os.uname().machine): raise ValueError('Wrong architecture')
    offset=int.from_bytes(b[32:40],'little'); size=int.from_bytes(b[54:56],'little'); count=int.from_bytes(b[56:58],'little')
    if size < 56 or not count or offset+size*count > len(b): raise ValueError('Invalid ELF')
    if any(int.from_bytes(b[offset+i*size:offset+i*size+4],'little')==3 for i in range(count)): raise ValueError('Dynamic interpreter refused')
    return b

def unit_path(value):
    # systemd specifiers and quoting differ from shell escaping.
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value): raise ValueError('Use a root path without whitespace or special characters')
    return value

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hermes-root', required=True); parser.add_argument('--hermes-user', required=True)
    parser.add_argument('--policy', required=True); parser.add_argument('--public-key', required=True)
    parser.add_argument('--collector', required=True); parser.add_argument('--collector-sha256', required=True)
    parser.add_argument('--reader', required=True); parser.add_argument('--reader-sha256', required=True)
    parser.add_argument('--reviewed-source-build', action='store_true', help='Explicitly trust your own build of reviewed source; SHA256 alone does not authenticate an author')
    parser.add_argument('--manifest'); parser.add_argument('--signature'); parser.add_argument('--allowed-signers'); parser.add_argument('--signer')
    parser.add_argument('--apply', action='store_true', help='Otherwise validate and print the proposed paths only')
    a=parser.parse_args()
    if sys.platform != 'linux' or os.geteuid()!=0: raise ValueError('Run as the server administrator on Linux')
    if not a.reviewed_source_build:
        if not all([a.manifest,a.signature,a.allowed_signers,a.signer]): raise ValueError('Authenticate the server manifest or explicitly use --reviewed-source-build for your own reviewed build')
        data=safe_path(a.manifest).read_bytes()
        if len(data)>32768: raise ValueError('Manifest too large')
        subprocess.run(['ssh-keygen','-Y','verify','-f',str(safe_path(a.allowed_signers)),'-I',a.signer,'-n','agent-world-server','-s',str(safe_path(a.signature))],input=data,check=True,capture_output=True)
        manifest=json.loads(data)
        if manifest.get('protocol')!=2 or manifest.get('architecture')!=os.uname().machine or manifest.get('readerSha256')!=a.reader_sha256 or manifest.get('collectorSha256')!=a.collector_sha256: raise ValueError('Signed manifest does not match this installation')
    owner=pwd.getpwnam(a.hermes_user)
    if owner.pw_uid==0 or a.hermes_user=='aw-view': raise ValueError('Hermes must use a separate non-root account')
    root=safe_path(a.hermes_root); unit_path(str(root))
    if not root.is_dir() or not (root/'profile.yaml').is_file(): raise ValueError('Hermes root unavailable')
    policy=json.loads(safe_path(a.policy).read_bytes())
    if set(policy)-{'salt','profiles','disclose_names','disclose_titles'}: raise ValueError('Unknown export policy field')
    if not re.fullmatch('[0-9a-f]{64}',policy.get('salt','')): raise ValueError('Generate a private random salt with openssl rand -hex 32')
    profiles=policy.get('profiles');
    if not isinstance(profiles,list) or not 1 <= len(profiles) <= 256 or len(set(profiles))!=len(profiles) or any(not isinstance(p,str) or not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',p) for p in profiles): raise ValueError('Invalid published profile list')
    for key in ['disclose_names','disclose_titles']:
        if key in policy and not isinstance(policy[key],bool): raise ValueError('Privacy switches must be boolean')
    key=safe_path(a.public_key).read_text().strip().split()
    if len(key)<2 or key[0]!='ssh-ed25519': raise ValueError('One dedicated Ed25519 public key required')
    decoded=base64.b64decode(key[1],validate=True)
    if len(decoded)!=51: raise ValueError('Invalid Ed25519 public key')
    collector=elf(a.collector,a.collector_sha256); reader=elf(a.reader,a.reader_sha256)
    safe_path(BASE); safe_path(SSH_FRAGMENT)
    if SSH_FRAGMENT.exists() and not SSH_FRAGMENT.read_text().startswith(MARKER): raise ValueError('Existing unrelated SSH configuration refused')
    if BASE.exists() and not (BASE/'managed-v2').is_file(): raise ValueError('Existing unmanaged directory refused')
    managed = (BASE/'managed-v2').is_file()
    try:
        existing = pwd.getpwnam('aw-view')
        if not managed: raise ValueError('Refusing to reuse an existing unrelated account')
        if existing.pw_shell != SHELL or existing.pw_dir != '/' or os.getgrouplist('aw-view',existing.pw_gid) != [existing.pw_gid]: raise ValueError('Reader account privileges differ from the installed policy')
    except KeyError: pass
    if not a.apply:
        print(json.dumps({'mode':'validation only','paths':[str(BASE),str(SSH_FRAGMENT),SHELL,'/etc/systemd/system/agent-world-export.service','/etc/systemd/system/agent-world-export.timer'],'account':'aw-view','publishedProfiles':len(profiles)},indent=2)); return
    # No service activation occurs until binaries, files, units and SSH config validate.
    BASE.mkdir(mode=0o755,parents=True,exist_ok=True); os.chown(BASE,0,0); os.chmod(BASE,0o755)
    if not (BASE/'managed-v2').exists(): atomic(BASE/'managed-v2',b'{"schema":2,"state":"preparing"}',0o600)
    lock=os.open(BASE/'install.lock',os.O_CREAT|os.O_RDONLY|os.O_NOFOLLOW,0o600)
    import fcntl
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    existing = None
    try: existing=pwd.getpwnam('aw-view')
    except KeyError: pass
    if existing and not (BASE/'managed-v2').exists(): raise ValueError('Refusing to reuse an existing account')
    if not existing:
        run('useradd','--system','--user-group','--no-create-home','--home-dir','/','--shell',SHELL,'aw-view')
        # Locked account can be rejected before public-key auth on some OpenSSH setups.
        # '*' is not a usable password; password auth is also prohibited in Match.
        run('usermod','--password','*','aw-view')
    account=pwd.getpwnam('aw-view')
    for p in [BASE/'view',BASE/'view/usr/local/libexec',BASE/'view/data',BASE/'export',BASE/'export/bin',BASE/'export/usr/local/libexec',BASE/'export/etc',BASE/'export/hermes',BASE/'export/out',P(SHELL).parent]:
        safe_path(p); p.mkdir(mode=0o755,parents=True,exist_ok=True)
    os.chown(BASE/'view/data',owner.pw_uid,account.pw_gid); os.chmod(BASE/'view/data',0o750)
    # Existing release is retained for manual rollback, never executed from the viewer.
    backup=BASE/('backup-'+str(time.time_ns())); backup.mkdir(mode=0o700)
    capture(backup)
    try:
        atomic(P(SHELL),reader,0o755); atomic(BASE/'view'/SHELL.lstrip('/'),reader,0o755)
        atomic(BASE/'view/read.lock',b'',0o444)
        atomic(P('/usr/local/libexec/agent-world-exporter'),collector,0o755)
        atomic(BASE/'export/usr/local/libexec/agent-world-exporter',collector,0o755)
        atomic(BASE/'export/etc/policy.json',json.dumps(policy).encode(),0o440)
        os.chown(BASE/'export/etc/policy.json',0,account.pw_gid)
        keyfile=BASE/'authorized_keys'
        atomic(keyfile,('restrict,command="snapshot" '+key[0]+' '+key[1]+'\n').encode(),0o644)
        fragment=MARKER+f'''Match User aw-view
        ChrootDirectory {BASE}/view
        ForceCommand snapshot
        AuthorizedKeysFile {keyfile}
        AuthenticationMethods publickey
        PubkeyAuthentication yes
        PasswordAuthentication no
        KbdInteractiveAuthentication no
        DisableForwarding yes
        AllowTcpForwarding no
        AllowStreamLocalForwarding no
        AllowAgentForwarding no
        X11Forwarding no
        PermitTunnel no
        PermitTTY no
        PermitUserRC no
        MaxSessions 1
    Match all
    '''
        old=SSH_FRAGMENT.read_bytes() if SSH_FRAGMENT.exists() else None
        atomic(SSH_FRAGMENT,fragment.encode())
        try:
            run('/usr/sbin/sshd','-t')
            effective=subprocess.check_output(['/usr/sbin/sshd','-T','-C','user=aw-view,host=localhost,addr=127.0.0.1'],text=True)
            required={'forcecommand':'snapshot','chrootdirectory':str(BASE/'view'),'disableforwarding':'yes','permittty':'no','permituserrc':'no','passwordauthentication':'no','authorizedkeysfile':str(keyfile),'authenticationmethods':'publickey','permituserenvironment':'no'}
            actual=dict(line.split(' ',1) for line in effective.splitlines())
            if any(actual.get(k)!=v for k,v in required.items()): raise ValueError('Effective SSH policy does not match; check Include/earlier Match directives')
        except Exception:
            if old is None: SSH_FRAGMENT.unlink()
            else: atomic(SSH_FRAGMENT,old)
            raise
        service=MARKER+f'''[Unit]
    Description=Agent World metadata exporter
    [Service]
    Type=oneshot
    User={owner.pw_uid}
    Group={account.pw_gid}
    RootDirectory={BASE}/export
    BindReadOnlyPaths={root}:/hermes
    BindPaths={BASE}/view/data:/out
    ExecStart=/usr/local/libexec/agent-world-exporter --export /hermes /etc/policy.json /out/snapshot.json
    UMask=0027
    ProtectSystem=strict
    ReadWritePaths=/out
    PrivateNetwork=yes
    PrivateDevices=yes
    NoNewPrivileges=yes
    CapabilityBoundingSet=
    RestrictAddressFamilies=AF_UNIX
    RestrictSUIDSGID=yes
    RestrictNamespaces=yes
    LockPersonality=yes
    MemoryDenyWriteExecute=yes
    SystemCallArchitectures=native
    SystemCallFilter=@system-service
    SystemCallFilter=~@network-io @mount @privileged
    InaccessiblePaths=-/hermes/.env -/hermes/config.yaml -/hermes/credentials -/hermes/.ssh
    LimitCORE=0
    MemoryMax=128M
    TasksMax=8
    CPUQuota=50%
    TimeoutStartSec=6s
    '''
        timer=MARKER+'''[Unit]
    Description=Refresh Agent World metadata
    [Timer]
    OnBootSec=3s
    OnUnitInactiveSec=3s
    AccuracySec=1s
    [Install]
    WantedBy=timers.target
    '''
        for name,content in [('service',service),('timer',timer)]: atomic(P('/etc/systemd/system/agent-world-export.'+name),content.encode())
        run('systemd-analyze','verify','/etc/systemd/system/agent-world-export.service','/etc/systemd/system/agent-world-export.timer')
        atomic(BASE/'managed-v2',json.dumps({'schema':2,'hermesUser':a.hermes_user,'hermesRoot':str(root),'installedAt':int(time.time())}).encode(),0o600)
        run('systemctl','daemon-reload'); subprocess.run(['systemctl','reset-failed','agent-world-export.service'],check=False,capture_output=True); run('systemctl','start','agent-world-export.service')
        run('systemctl','enable','--now','agent-world-export.timer')
        run('systemctl','reload','ssh')
    except Exception:
        restore(backup)
        raise
    print('Installed. Keep this administrator session open. Test the dedicated key and forbidden operations before closing it. Rollback files: '+str(backup))

if __name__=='__main__':
    try: main()
    except Exception as e: print('Installation stopped: '+str(e),file=sys.stderr); sys.exit(1)

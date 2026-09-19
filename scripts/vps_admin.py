#!/usr/bin/env python3
"""Administrative recovery/revocation for an Agent World protocol 2 installation."""
import argparse, hashlib, json, os, pathlib, stat, subprocess, tempfile
P = pathlib.Path
BASE = P('/var/lib/agent-world')
FILES = [P('/usr/local/libexec/agent-world-reader'), P('/usr/local/libexec/agent-world-exporter'), BASE/'export/etc/policy.json', BASE/'authorized_keys', P('/etc/ssh/sshd_config.d/60-agent-world.conf'), P('/etc/systemd/system/agent-world-export.service'), P('/etc/systemd/system/agent-world-export.timer')]

def safe(path):
    for p in [path, *path.parents]:
        if p.is_symlink(): raise ValueError('Symlink refused')
    if path.exists() and (not path.is_file() or path.stat().st_nlink != 1): raise ValueError('Regular private inode required')

def write(path, data, mode, uid=0, gid=0):
    safe(path)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.aw-')
    try:
        os.fchmod(fd, mode); os.fchown(fd, uid, gid)
        with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def system(*args, check=True):
    return subprocess.run(['systemctl', *args], check=check, capture_output=True)

def capture(backup):
    entries=[]
    for p in FILES:
        safe(p)
        if p.exists():
            s=p.stat(); data=p.read_bytes(); write(backup/p.name,data,0o600)
            entries.append({'path':str(p),'sha256':hashlib.sha256(data).hexdigest(),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid})
        else: entries.append({'path':str(p),'absent':True})
    state={'schema':1,'entries':entries,'timerActive':system('is-active','--quiet','agent-world-export.timer',check=False).returncode==0,'timerEnabled':system('is-enabled','--quiet','agent-world-export.timer',check=False).returncode==0}
    write(backup/'manifest.json',json.dumps(state).encode(),0o600)

def restore(backup):
    if backup.parent != BASE or not backup.name.startswith('backup-') or backup.is_symlink() or backup.stat().st_uid!=0 or backup.stat().st_mode & 0o077: raise ValueError('Root-owned installation backup required')
    safe(backup/'manifest.json'); state=json.loads((backup/'manifest.json').read_bytes())
    if state['schema']!=1 or [e['path'] for e in state['entries']] != [str(p) for p in FILES]: raise ValueError('Invalid backup manifest')
    # Validate the entire backup before stopping services or changing any file.
    for e in state['entries']:
        safe(P(e['path']))
        if not e.get('absent'):
            p=backup/P(e['path']).name; safe(p)
            if hashlib.sha256(p.read_bytes()).hexdigest()!=e['sha256']: raise ValueError('Backup hash mismatch')
    system('stop','agent-world-export.timer','agent-world-export.service',check=False)
    for e in state['entries']:
        p=P(e['path'])
        if e.get('absent'): p.unlink(missing_ok=True)
        else: write(p,(backup/p.name).read_bytes(),e['mode'],e['uid'],e['gid'])
    for host, jail in [(FILES[0],BASE/'view'/str(FILES[0]).lstrip('/')),(FILES[1],BASE/'export'/str(FILES[1]).lstrip('/'))]:
        safe(jail)
        if host.exists(): write(jail,host.read_bytes(),0o755)
        else: jail.unlink(missing_ok=True)
    subprocess.run(['/usr/sbin/sshd','-t'],check=True)
    system('daemon-reload')
    system('reset-failed','agent-world-export.service',check=False)
    if state['timerEnabled']: system('enable','agent-world-export.timer')
    else: system('disable','agent-world-export.timer',check=False)
    if state['timerActive']: system('start','agent-world-export.service'); system('start','agent-world-export.timer')
    system('reload','ssh')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('operation',choices=['revoke','rollback','uninstall']); p.add_argument('--backup'); p.add_argument('--apply',action='store_true'); a=p.parse_args()
    if os.geteuid()!=0 or not (BASE/'managed-v2').is_file(): raise ValueError('Managed installation and server administrator required')
    safe(BASE/'managed-v2')
    if not a.apply: print('Validation only. Requested operation: '+a.operation); return
    import fcntl
    lock=os.open(BASE/'install.lock',os.O_RDONLY|os.O_NOFOLLOW); fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if a.operation=='rollback':
        if not a.backup: raise ValueError('--backup required')
        restore(P(a.backup)); print('Previous installation restored. Test the reader before closing the administrator session.'); return
    write(BASE/'authorized_keys',b'',0o644)
    if a.operation=='revoke': print('Reader key revoked. Already running reads end within the reader timeout (5 seconds).'); return
    system('disable','--now','agent-world-export.timer',check=False); system('stop','agent-world-export.service',check=False)
    fragment=FILES[4]; safe(fragment)
    if fragment.exists() and not fragment.read_text().startswith('# Managed by Agent World protocol 2\n'): raise ValueError('Unrelated SSH fragment refused')
    for path in [*FILES[:2],fragment,*FILES[5:]]:
        safe(path); path.unlink(missing_ok=True)
    for path in [BASE/'view/usr/local/libexec/agent-world-reader',BASE/'export/usr/local/libexec/agent-world-exporter',BASE/'view/data/snapshot.json']:
        safe(path); path.unlink(missing_ok=True)
    subprocess.run(['/usr/sbin/sshd','-t'],check=True); system('daemon-reload'); system('reload','ssh')
    print('Services, SSH access, binaries and current snapshot removed. Hermes unchanged. Disabled account and root-only backups retained for explicit administrative recovery/removal.')

if __name__=='__main__':
    try: main()
    except Exception as e: raise SystemExit('Administration stopped: '+str(e))

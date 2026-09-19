#!/usr/bin/env python3
"""Destructive ONLY inside the explicitly configured disposable localhost VM.
Never accepts a remote host. Requires a dedicated lab admin key and pinned host key.
"""
import argparse, hashlib, io, json, os, pathlib, shlex, subprocess, tarfile, time
P=pathlib.Path

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--lab',required=True); p.add_argument('--port',type=int,default=22223); a=p.parse_args()
    root=P(__file__).resolve().parent.parent; lab=P(a.lab).resolve()
    options=['ssh','-F','/dev/null','-o','BatchMode=yes','-o','IdentityAgent=none','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(lab/'known_hosts'),'-o','ConnectTimeout=5','-p',str(a.port)]
    admin=options+['-i',str(lab/'admin-key'),'lab@127.0.0.1']
    viewer=options+['-i',str(lab/'viewer-key'),'aw-view@127.0.0.1']
    def ssh(command,input=None,check=True,timeout=30):
        result=subprocess.run(admin+[command],input=input,capture_output=True,timeout=timeout)
        if check and result.returncode: raise RuntimeError(result.stderr.decode(errors='replace')+result.stdout.decode(errors='replace'))
        return result
    files={'vps_admin.py':root/'scripts/vps_admin.py','install.py':root/'scripts/install-secure-vps.py','reader':root/'reader/target/aarch64-unknown-linux-musl/release/agent-world-reader','collector':root/'release/collectors/agent-world-collector-linux-aarch64','viewer.pub':lab/'viewer-key.pub'}
    blob=io.BytesIO()
    with tarfile.open(fileobj=blob,mode='w') as t:
        for name,path in files.items(): t.add(path,arcname=name)
    ssh('mkdir -p /home/lab/agent-world-lab && tar xf - -C /home/lab/agent-world-lab',blob.getvalue())
    fixture='''import pathlib,sqlite3,json,time
r=pathlib.Path('/home/lab/hermes-fixture'); r.mkdir(exist_ok=True); (r/'state').mkdir(exist_ok=True)
(r/'profile.yaml').write_text('display_name: PRIVATE_SENTINEL_NAME\\napi_key: PRIVATE_SENTINEL_KEY\\n')
(r/'.env').write_text('PRIVATE_SENTINEL_ENV')
now=int(time.time())
db=sqlite3.connect(r/'state.db'); db.executescript('CREATE TABLE IF NOT EXISTS sessions (id TEXT,title TEXT,ended_at REAL,started_at REAL,last_activity_at REAL,last_activity_description TEXT); CREATE TABLE IF NOT EXISTS session_turn_leases (conversation_id TEXT,expires_at REAL); DELETE FROM sessions; DELETE FROM session_turn_leases;')
db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',('PRIVATE_SENTINEL_SESSION','PRIVATE_SENTINEL_TITLE',None,now,now,'tool running: fixture')); db.execute('INSERT INTO session_turn_leases VALUES (?,?)',('PRIVATE_SENTINEL_SESSION',now+86400)); db.commit(); db.close()
db=sqlite3.connect(r/'kanban.db'); db.executescript('CREATE TABLE IF NOT EXISTS tasks (id TEXT,assignee TEXT,status TEXT,title TEXT,block_kind TEXT,created_at INTEGER); CREATE TABLE IF NOT EXISTS task_runs (id INTEGER,task_id TEXT,status TEXT,outcome TEXT,ended_at TEXT,last_heartbeat_at INTEGER,started_at INTEGER,claim_expires INTEGER); DELETE FROM tasks; DELETE FROM task_runs;')
db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?)',('PRIVATE_SENTINEL_TASK','default','running','PRIVATE_SENTINEL_TITLE',None,now)); db.execute('INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?)',(1,'PRIVATE_SENTINEL_TASK','running',None,None,now,now,now+86400)); db.commit(); db.close()
pathlib.Path('/home/lab/agent-world-lab/policy.json').write_text(json.dumps({'salt':'a'*64,'profiles':['default'],'disclose_names':False,'disclose_titles':False}))
'''
    ssh('python3 -',fixture.encode())
    install_command=['sudo','python3','/home/lab/agent-world-lab/install.py','--hermes-root','/home/lab/hermes-fixture','--hermes-user','lab','--policy','/home/lab/agent-world-lab/policy.json','--public-key','/home/lab/agent-world-lab/viewer.pub','--reader','/home/lab/agent-world-lab/reader','--reader-sha256',hashlib.sha256(files['reader'].read_bytes()).hexdigest(),'--collector','/home/lab/agent-world-lab/collector','--collector-sha256',hashlib.sha256(files['collector'].read_bytes()).hexdigest(),'--reviewed-source-build','--apply']
    install=ssh(shlex.join(install_command),timeout=40); (lab/'installation.txt').write_bytes(install.stdout+install.stderr)
    reports=[]
    def view(command='snapshot',input=b'{"protocol":2}'):
        return subprocess.run(viewer+[command],input=input,capture_output=True,timeout=10)
    good=view()
    if good.returncode: raise RuntimeError('Reader failed: '+good.stderr.decode())
    response=json.loads(good.stdout); assert response['protocol']==2 and len(response['snapshot']['agents'])==1
    assert response['snapshot']['agents'][0]['task_phase']=='live_run', response
    assert b'PRIVATE_SENTINEL' not in good.stdout and b'/home/' not in good.stdout
    reports.append('authorized snapshot and privacy sentinels: PASS')
    for command in ['', 'id', 'cat /etc/passwd','cat /home/lab/hermes-fixture/.env','touch /data/pwned','sftp','scp -f /etc/passwd','snapshot; id']:
        result=view(command); assert result.returncode!=0 and not result.stdout, (command,result)
    reports.append('shell, arbitrary command, SFTP/SCP, private file and write attempts: PASS')
    for payload in [b'{"protocol":1}', b'{"protocol":2,"root":"/etc"}', b' '*65, b'{"protocol":2,"command":"id"}']:
        result=view(input=payload); assert result.returncode!=0 and not result.stdout
    reports.append('legacy/path/oversized/unknown request rejection: PASS')
    for forwarding in [['-W','127.0.0.1:22'], ['-N','-R','127.0.0.1:31337:127.0.0.1:22'], ['-N','-R','/tmp/aw-forbidden.sock:127.0.0.1:22']]:
        result=subprocess.run(options+['-o','ExitOnForwardFailure=yes']+forwarding+['-i',str(lab/'viewer-key'),'aw-view@127.0.0.1'],capture_output=True,timeout=8)
        assert result.returncode!=0, result
    reports.append('TCP direct/remote forwarding and remote Unix forwarding: PASS')
    effective=ssh('sudo /usr/sbin/sshd -T -C user=aw-view,host=localhost,addr=127.0.0.1').stdout.decode()
    for line in ['disableforwarding yes','permittty no','permituserrc no','permituserenvironment no','allowagentforwarding no','x11forwarding no','permittunnel no']:
        assert line in effective, line
    reports.append('effective sshd PTY, user-rc/environment, agent, X11 and tunnel policy: PASS')
    # Stolen-key clients cannot hold the reader forever or multiply concurrent work.
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        burst=list(pool.map(lambda _: view(), range(8)))
    assert any(r.returncode==0 for r in burst) and sum(r.returncode==0 for r in burst)<=2
    assert all(not r.stdout for r in burst if r.returncode!=0)
    hung=subprocess.Popen(viewer+['snapshot'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        assert hung.wait(timeout=7)!=0
        assert not hung.stdout.read()
    finally:
        if hung.poll() is None: hung.kill(); hung.wait()
        hung.stdin.close()
    reports.append('concurrent burst bounded and unfinished stdin terminated: PASS')
    changed=lab/'known_hosts_changed'
    original=(lab/'known_hosts').read_text().split(); replacement=(lab/'admin-key.pub').read_text().split()
    changed.write_text(original[0]+' '+replacement[0]+' '+replacement[1]+'\n')
    wrong=[('UserKnownHostsFile='+str(changed)) if x.startswith('UserKnownHostsFile=') else x for x in viewer]
    result=subprocess.run(wrong+['snapshot'],input=b'{"protocol":2}',capture_output=True,timeout=8)
    assert result.returncode!=0 and not result.stdout
    reports.append('changed server host key refused: PASS')
    # Repeat installation exercises an update while preserving a working admin connection.
    install=ssh(shlex.join(install_command),timeout=40)
    reports.append('repeat installation and administrator access preserved: PASS')
    ssh('sudo systemctl stop agent-world-export.timer')
    stale=ssh("sudo python3 -c 'import json,pathlib;p=pathlib.Path(\"/var/lib/agent-world/view/data/snapshot.json\");v=json.loads(p.read_text());v[\"snapshot\"][\"collected_at\"]=\"2026-01-01T00:00:00Z\";p.write_text(json.dumps(v))'")
    result=view(); assert result.returncode!=0 and not result.stdout
    ssh('sudo systemctl start agent-world-export.service && sudo systemctl start agent-world-export.timer')
    reports.append('stopped exporter/stale snapshot rejected: PASS')
    # Integrity and source-authentication gates fail before changing the running service.
    invalid=list(install_command); invalid[invalid.index('--reader-sha256')+1]='0'*64
    assert ssh(shlex.join(invalid),check=False).returncode != 0
    invalid=[v for v in install_command if v!='--reviewed-source-build']
    assert ssh(shlex.join(invalid),check=False).returncode != 0
    assert view().returncode == 0
    reports.append('corrupted binary and unauthenticated prebuilt package refused: PASS')
    # A failed exporter activation restores the exact prior keys, units and policy.
    failed=ssh('cp /home/lab/agent-world-lab/policy.json /home/lab/agent-world-lab/policy-good.json && python3 -c '+shlex.quote('import json,pathlib;p=pathlib.Path("/home/lab/agent-world-lab/policy.json");v=json.loads(p.read_text());v["profiles"]=["nonexistent"];p.write_text(json.dumps(v))'))
    assert ssh(shlex.join(install_command),check=False,timeout=45).returncode != 0
    ssh('cp /home/lab/agent-world-lab/policy-good.json /home/lab/agent-world-lab/policy.json')
    assert view().returncode == 0
    reports.append('failed update automatically rolls back; administrator and reader survive: PASS')
    manage='sudo python3 /home/lab/agent-world-lab/vps_admin.py '
    backup=ssh('sudo find /var/lib/agent-world -maxdepth 1 -type d -name "backup-*"').stdout.decode().splitlines()[-1]
    ssh(manage+'revoke --apply'); assert view().returncode != 0
    reports.append('server-side key revocation blocks a new connection: PASS')
    ssh(manage+'rollback --backup '+shlex.quote(backup)+' --apply',timeout=40)
    assert view().returncode == 0
    reports.append('explicit rollback restores the reader: PASS')
    ssh(manage+'uninstall --apply'); assert view().returncode != 0
    assert ssh('test -f /home/lab/hermes-fixture/profile.yaml && test -f /home/lab/hermes-fixture/state.db').returncode == 0
    ssh(shlex.join(install_command),timeout=40); assert view().returncode == 0
    reports.append('uninstall preserves Hermes and administrator access; reinstall works: PASS')
    (lab/'security-results.json').write_text(json.dumps({'platform':'Debian 13 arm64 VM','checks':reports},indent=2)+'\n')
    print('\n'.join(reports))
if __name__=='__main__': main()

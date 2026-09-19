#!/usr/bin/env python3
"""Tests ONLY a synthetic encrypted key, a temporary SSH agent and the local VM.
Creates then removes one exact OpenSSH Keychain item; never lists other items.
"""
import json,os,pathlib,subprocess,tempfile,time
root=pathlib.Path(__file__).resolve().parent.parent
lab=root/'work/security-remediation-2026-09-19/vm'
key=lab/'encrypted-viewer-test-key'
phrase=b'AgentWorld synthetic test only 2026\n'
if not key.exists():
    subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-a','16','-f',str(key)],input=phrase+phrase,check=True,capture_output=True)
base=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','IdentityAgent=none','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(lab/'known_hosts'),'-p','22223']
admin=base+['-i',str(lab/'admin-key'),'lab@127.0.0.1']
public=key.with_suffix('.pub').read_bytes()
original=subprocess.check_output(admin+['sudo cat /var/lib/agent-world/authorized_keys'])
subprocess.run(admin+['sudo tee /var/lib/agent-world/authorized_keys >/dev/null'],input=b'restrict,command="snapshot" '+public,check=True)
with tempfile.TemporaryDirectory(prefix='aw-key-test-',dir='/private/tmp') as folder:
    socket=str(pathlib.Path(folder)/'agent.sock')
    agent=subprocess.Popen(['/usr/bin/ssh-agent','-D','-a',socket],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    env=dict(os.environ,SSH_AUTH_SOCK=socket); env.pop('SSH_AGENT_PID',None)
    try:
        for _ in range(50):
            if pathlib.Path(socket).exists(): break
            time.sleep(.1)
        subprocess.run(['/usr/bin/ssh-add','--apple-use-keychain','-t','60',str(key)],input=phrase,env=env,check=True,capture_output=True,timeout=15)
        result=subprocess.run(base+['-o','UseKeychain=yes','-i',str(key),'aw-view@127.0.0.1','snapshot'],input=b'{"protocol":2}',capture_output=True,timeout=10)
        assert result.returncode==0,result.stderr.decode()
        assert json.loads(result.stdout)['protocol']==2
        print('Encrypted dedicated key + Apple Keychain + IdentityAgent=none: PASS')
    finally:
        subprocess.run(['/usr/bin/ssh-add','--apple-use-keychain','-d',str(key)],env=env,capture_output=True,timeout=10)
        agent.terminate(); agent.wait(timeout=5)
        subprocess.run(admin+['sudo tee /var/lib/agent-world/authorized_keys >/dev/null'],input=original,check=True)

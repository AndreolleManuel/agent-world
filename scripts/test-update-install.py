#!/usr/bin/env python3
"""Build and test an isolated synthetic app; never installs/launches the user's app.
The known fixture password is NOT a release credential. All files stay in ignored work/.
"""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
(ROOT / 'work').mkdir(exist_ok=True)
directory = Path(tempfile.mkdtemp(prefix='update-install-test-', dir=ROOT / 'work'))
app = directory / 'Agent World.app'
(app / 'Contents/MacOS').mkdir(parents=True)
shutil.copyfile('/bin/echo', app / 'Contents/MacOS/pixel-ops')
(app / 'Contents/MacOS/pixel-ops').chmod(0o755)
with (app / 'Contents/Info.plist').open('wb') as file:
    plistlib.dump({'CFBundleIdentifier': 'com.amlabs.pixelops', 'CFBundleShortVersionString': '0.3.0', 'CFBundleVersion': '0.3.0', 'CFBundleExecutable': 'pixel-ops', 'CFBundlePackageType': 'APPL'}, file)
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], check=True)
name = 'Agent-World-0.3.0-mac-universal.app.tar.gz'
subprocess.run(['/usr/bin/tar', '--format', 'ustar', '--no-xattrs', '-czf', str(directory / name), '-C', str(directory), 'Agent World.app'], env={**os.environ, 'COPYFILE_DISABLE': '1'}, check=True)
archive = (directory / name).read_bytes()
package = {'url': 'https://github.com/AndreolleManuel/agent-world/releases/download/v0.3.0/' + name, 'size': len(archive), 'sha256': hashlib.sha256(archive).hexdigest()}
(directory / 'latest.json').write_text(json.dumps({'schema': 1, 'version': '0.3.0', 'notes': 'Synthetic fixture, never publish.', 'platforms': {'darwin-aarch64': package, 'darwin-x86_64': package}}) + '\n')
cli = ROOT / 'node_modules/.bin/tauri'
password = 'fixture-only-not-a-release-key'
env = {k: v for k, v in os.environ.items() if not k.startswith(('TAURI_SIGNING_', 'TAURI_PRIVATE_', 'TAURI_KEY_'))}
subprocess.run([str(cli), 'signer', 'generate', '--ci', '--password', password, '--write-keys', str(directory / 'fixture.key')], env=env, stdout=subprocess.DEVNULL, check=True)
subprocess.run([str(cli), 'signer', 'sign', '--private-key-path', str(directory / 'fixture.key'), str(directory / 'latest.json')], env={**env, 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': password}, stdout=subprocess.DEVNULL, check=True)
subprocess.run(['cargo', 'test', '--locked', '--offline', '--manifest-path', str(ROOT / 'src-tauri/Cargo.toml'), '--lib', 'updates::tests::signed_bundle_roundtrip', '--', '--ignored'], env={**env, 'AGENT_WORLD_UPDATE_FIXTURE': str(directory)}, check=True)
print('Verified isolated signed bundle fixture:', directory)

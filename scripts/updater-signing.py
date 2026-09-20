#!/usr/bin/env python3
"""Interactive maintainer tool. Private keys and passwords never enter Git or CLI arguments."""
import base64
import getpass
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / 'node_modules/.bin/tauri'
DEFAULT_KEY = Path.home() / '.config/agent-world/update-signing.key'


def public_key(path):
    value = path.read_text().strip()
    lines = base64.b64decode(value, validate=True).decode().strip().splitlines()
    raw = base64.b64decode(lines[1], validate=True)
    if not lines[0].startswith('untrusted comment:') or len(raw) != 42 or raw[:2] != b'Ed':
        raise ValueError('Clé publique invalide.')
    return value + '\n'


def main():
    os.umask(0o077)
    if not sys.stdin.isatty():
        raise ValueError('Lancez ce script dans votre Terminal personnel, pas dans un agent ou un journal de CI.')
    if len(sys.argv) < 2 or sys.argv[1] not in ('init', 'sign'):
        raise ValueError('Usage : python3 scripts/updater-signing.py init [chemin-clé] OU sign /chemin/latest.json [chemin-clé]')
    mode = sys.argv[1]
    if mode == 'init' and len(sys.argv) > 3 or mode == 'sign' and len(sys.argv) not in (3, 4):
        raise ValueError('Arguments invalides.')
    key = Path(sys.argv[2] if mode == 'init' and len(sys.argv) == 3 else sys.argv[3] if mode == 'sign' and len(sys.argv) == 4 else DEFAULT_KEY).expanduser().absolute()
    if key.is_symlink() or key.parent.resolve() != key.parent or key.is_relative_to(ROOT):
        raise ValueError('La clé doit rester dans un dossier réel hors du dépôt.')
    env = {k: v for k, v in os.environ.items() if not k.startswith(('TAURI_SIGNING_', 'TAURI_PRIVATE_', 'TAURI_KEY_')) and k != 'CI'}
    if mode == 'init':
        if key.exists() or Path(str(key) + '.pub').exists() or Path(str(key) + '.pub').is_symlink():
            raise ValueError('Une clé existe déjà. Elle ne sera pas remplacée.')
        destination = ROOT / 'docs/agent-world-updater.pub'
        if destination.read_text().strip():
            raise ValueError('La clé publique de publication est déjà installée. Rotation manuelle à préparer.')
        key.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        print('Choisissez une phrase secrète NON VIDE. Saisissez-la ici uniquement ; ne l’envoyez pas dans le chat.', flush=True)
        subprocess.run([str(CLI), 'signer', 'generate', '--write-keys', str(key)], env=env, check=True)
        key.chmod(0o600)
        with tempfile.TemporaryDirectory(prefix='agent-world-key-check-') as tmp:
            probe = Path(tmp) / 'probe'; probe.write_text('Agent World updater key check\n')
            check = subprocess.run([str(CLI), 'signer', 'sign', '--private-key-path', str(key), str(probe)], env={**env, 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': ''}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if check.returncode == 0:
                key.unlink(); Path(str(key) + '.pub').unlink()
                raise ValueError('Phrase secrète vide refusée ; la paire créée a été supprimée. Relancez avec un mot de passe.')
        value = public_key(Path(str(key) + '.pub'))
        destination.write_text(value)
        print('Terminé : clé publique installée. Conservez une sauvegarde privée de la clé et de sa phrase secrète.')
        print('Empreinte publique SHA256 :', hashlib.sha256(value.strip().encode()).hexdigest())
    else:
        if not key.is_file() or stat.S_IMODE(key.stat().st_mode) & 0o077:
            raise ValueError('Clé privée absente ou permissions trop larges (0600 requis).')
        manifest = Path(sys.argv[2]).resolve(strict=True)
        if manifest.name != 'latest.json' or manifest.stat().st_size > 32768:
            raise ValueError('Manifeste latest.json invalide.')
        if public_key(Path(str(key) + '.pub')) != public_key(ROOT / 'docs/agent-world-updater.pub'):
            raise ValueError('Cette clé ne correspond pas à la clé publique embarquée.')
        password = getpass.getpass('Phrase secrète de la clé de mise à jour : ')
        if not password:
            raise ValueError('Une phrase secrète non vide est obligatoire.')
        subprocess.run([str(CLI), 'signer', 'sign', '--private-key-path', str(key), str(manifest)], env={**env, 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': password}, stdout=subprocess.DEVNULL, check=True)
        del password
        print('Terminé : latest.json.sig créé. Vérifiez le candidat avant de publier.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Arrêt :', str(error), file=sys.stderr)
        sys.exit(1)

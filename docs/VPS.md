# VPS — installation administrative du protocole 2

Pour développeurs et administrateurs Linux. La préparation est distincte de l’app Mac. Ne jamais donner au viewer une clé root/Hermes générale. Configuration prise en charge : **Debian 13 ARM64, OpenSSH et systemd**, validée dans une VM locale. Aucune autre architecture ou distribution n’est annoncée compatible.

## Architecture

Un exporteur sans root lit les profils explicitement publiés dans un espace de fichiers isolé par systemd, sans réseau, et écrit un snapshot minimal. Un compte `aw-view`, sans groupe supplémentaire, voit seulement un chroot avec un lecteur statique et ce snapshot. Le lecteur n’embarque pas SQLite ; après ouverture de ses fichiers fixes, seccomp interdit nouvelles ouvertures, processus, exécution et réseau. OpenSSH interdit shell libre, SCP/SFTP, PTY, tunnels TCP/Unix/agent/X11 et scripts utilisateur.

L’exporteur reste de confiance : les bases contiennent potentiellement plus que les métadonnées qu’il extrait. Le répertoire Hermes est monté en lecture seule dans son espace ; les secrets usuels `.env`, `config.yaml`, `credentials`, `.ssh` sont masqués, mais ce n’est pas un inventaire universel des secrets d’une installation personnalisée. Ne pas stocker de secret dans un nom ou titre publié volontairement.

## 1. Compiler ou authentifier les composants

Examiner les sources d’une révision précise. Sur Debian 13 ARM64, installer Rust 1.98.0, `musl-tools`, compilateur C et `sqlite3`, puis :

```sh
rustup target add aarch64-unknown-linux-musl
CC=musl-gcc RUSTFLAGS='-C linker=musl-gcc -C target-feature=+crt-static' cargo build --locked --release --manifest-path collector/Cargo.toml --target aarch64-unknown-linux-musl
RUSTFLAGS='-C linker=musl-gcc -C target-feature=+crt-static' cargo build --locked --release --manifest-path reader/Cargo.toml --target aarch64-unknown-linux-musl
```

L’installateur exige les hashes des deux ELF statiques et leur architecture. Pour une compilation que vous avez examinée vous-même, ajouter explicitement `--reviewed-source-build`. Pour un paquet précompilé, fournir `--manifest`, `--signature`, `--allowed-signers` et `--signer` : vérification OpenSSH `ssh-keygen -Y verify`, namespace `agent-world-server`. Le manifeste JSON contient `protocol: 2`, `architecture`, `readerSha256` et `collectorSha256`. Vérifier la signature et les hashes depuis un outil de confiance avant de lancer un script en root ; le contrôle interne ne peut pas rendre sûr un installateur déjà modifié. Examiner les deux scripts administratifs. La clé de confiance doit être obtenue indépendamment du paquet. L’identité du mainteneur et la vérification de l’inventaire complet, qui couvre aussi les scripts, sont décrites dans [SIGNATURES.md](SIGNATURES.md). Un hash seul n’authentifie pas le mainteneur.

## 2. Créer la clé de consultation sur le Mac

Depuis les sources examinées :

```sh
sh scripts/prepare-viewer-key.sh "$HOME/.ssh/agent-world-viewer"
```

Saisir une phrase secrète non vide. Le script refuse de remplacer une clé, génère une Ed25519 dédiée, enregistre la phrase par Apple OpenSSH dans le trousseau avec un agent temporaire isolé, puis arrête cet agent. L’app utilise `IdentityAgent=none`, `IdentitiesOnly=yes`, `UseKeychain=yes` et cette seule identité. Elle refuse les clés privées en clair, symlinks, hardlinks et permissions ouvertes. Fournir uniquement le fichier `.pub` à l’administrateur.

Vérifier l’empreinte de la clé hôte par la console de l’hébergeur ou un canal indépendant. L’ajouter ensuite aux hôtes connus OpenSSH du Mac. `ssh-keyscan` seul n’authentifie pas le serveur. Ne pas utiliser `StrictHostKeyChecking=no` ; un changement d’empreinte doit bloquer jusqu’à vérification.

## 3. Politique d’export

Sur le serveur, dans un fichier privé de l’administrateur :

```json
{"salt":"REMPLACER_PAR_64_CARACTERES_HEXA_ALEATOIRES","profiles":["default"],"disclose_names":false,"disclose_titles":false}
```

Générer le sel avec `openssl rand -hex 32`. Ajouter seulement les slugs de profils à publier. Un profil absent provoque un échec explicite. Conserver le sel lors des mises à jour pour garder les identifiants et avatars. Les alias lisibles se saisissent sur le Mac. Les noms/titres libres demandent une activation explicite côté serveur.

## 4. Installation

Garder une connexion administrative de secours ouverte. Hermes doit appartenir à un utilisateur non-root distinct. Copier les deux binaires, la politique, la clé publique et **les deux scripts voisins** `install-secure-vps.py` / `vps_admin.py` dans un dossier administratif examiné. Calculer les hashes avec `sha256sum`, puis adapter :

```sh
sudo python3 scripts/install-secure-vps.py \
  --hermes-root /home/hermes/.hermes --hermes-user hermes \
  --policy /root/agent-world-policy.json --public-key /root/viewer.pub \
  --collector /root/agent-world-collector --collector-sha256 HASH_COLLECTEUR \
  --reader /root/agent-world-reader --reader-sha256 HASH_LECTEUR \
  --reviewed-source-build
```

Sans `--apply`, l’installateur vérifie et décrit les emplacements sans installation. Après examen, relancer avec `--apply`. Pour un paquet authentifié, remplacer le choix de compilation personnelle par les quatre options de signature.

L’installation gère `/var/lib/agent-world`, deux binaires dans `/usr/local/libexec`, le compte `aw-view`, deux unités `agent-world-export` et un seul fragment SSH `60-agent-world.conf`. Elle refuse compte/répertoire/fragments existants non gérés. Elle valide la syntaxe et la politique SSH effective avant rechargement ; elle exige `PermitUserEnvironment no` global. Un échec après sauvegarde restaure les fichiers et le service précédents. Une interruption brutale du processus/OS ne peut pas exécuter ce retour automatique : utiliser la sauvegarde root affichée, garder l’accès de secours, puis relancer.

Contrôler `systemctl status agent-world-export.timer`, le service et `sshd -T -C user=aw-view,host=localhost,addr=127.0.0.1`. Tester la clé avec `snapshot` et la requête `{"protocol":2}` ; `id`, SFTP et un forwarding doivent être refusés. La VM du projet exécute ces tentatives avec de fausses données et sa propre clé. L’app ne certifie pas à distance la configuration d’un serveur inconnu.

## Mise à jour, révocation, retour arrière, désinstallation

La mise à jour reprend la même commande administrative, nouveaux hashes et mêmes politique/sel. Le compte viewer ne peut pas la faire. Sauvegardes root-only `backup-…` avec manifeste et hashes ; pas de copie des bases Hermes.

```sh
sudo python3 scripts/vps_admin.py revoke --apply
sudo python3 scripts/vps_admin.py rollback --backup /var/lib/agent-world/backup-IDENTIFIANT --apply
sudo python3 scripts/vps_admin.py uninstall --apply
```

Sans `--apply`, ces commandes ne modifient rien. Révocation : vide uniquement le fichier de clés publiques dédié ; les lectures déjà en cours se terminent sous cinq secondes. Rotation : révoquer, générer une nouvelle clé dédiée, réinstaller la nouvelle `.pub`, vérifier, puis retirer l’ancienne clé/trousseau du Mac. **Un retour arrière restaure aussi l’ancienne clé autorisée : ne pas l’utiliser après vol de cette clé sans corriger la sauvegarde ou révoquer à nouveau.**

Désinstallation : arrête le service/timer, retire le fragment, les binaires et le snapshot courant. Les données Hermes restent intactes ; compte sans exécutable de connexion et sauvegardes administratives sont conservés pour récupération/suppression explicite. Une connexion administrative existante reste nécessaire pour contrôler le résultat. Ne pas supprimer des répertoires Hermes, modifier globalement SSH ou réutiliser une clé administrative.

## Mainteneur : signer les fichiers distribués

La signature est gratuite et utilise [OpenSSH](https://man.openbsd.org/ssh-keygen). Elle permet de vérifier qu’un manifeste a été signé avec la clé privée correspondant à une clé publique de confiance. Les empreintes du manifeste permettent ensuite de vérifier les deux binaires. Elle ne certifie pas l’absence de bugs et ne chiffre pas les données ; le transport reste protégé par SSH.

### Une fois : créer une identité de signature

L’identité d’Agent World existe déjà ; voir [SIGNATURES.md](SIGNATURES.md). La procédure ci-dessous explique la création initiale pour un nouveau projet ou une rotation préparée ; ne pas remplacer la clé existante. Sur le Mac du mainteneur, dans un terminal personnel :

```sh
mkdir -p "$HOME/.ssh"
ssh-keygen -t ed25519 -a 100 -f "$HOME/.ssh/agent-world-release" -C "AM Labs Agent World releases"
```

Choisir une phrase secrète non vide, saisie directement dans le terminal. Si ce nom de fichier existe déjà, refuser son remplacement. `agent-world-release` est la clé privée : conserver hors du dépôt et des archives, avec une sauvegarde chiffrée. `agent-world-release.pub` est la clé publique, destinée à être publiée. Cette identité de signature est distincte de la clé de consultation `agent-world-viewer` et ne doit pas être ajoutée aux clés autorisées d’un serveur.

### À chaque version : calculer le manifeste puis signer

Le parcours complet recommandé pour le mainteneur utilise `scripts/sign-release.sh`, décrit dans [SIGNATURES.md](SIGNATURES.md). Les commandes ci-dessous montrent les opérations individuelles ; la signature du seul manifeste serveur ne couvre pas les scripts administratifs.

Dans un dossier de préparation contenant les deux binaires ARM64 examinés et testés, nommés `agent-world-collector` et `agent-world-reader`, générer un nouveau fichier :

```sh
python3 - <<'PY'
import hashlib, json
from pathlib import Path
def sha(name):
    return hashlib.sha256(Path(name).read_bytes()).hexdigest()
manifest = {
    'protocol': 2,
    'architecture': 'aarch64',
    'collectorSha256': sha('agent-world-collector'),
    'readerSha256': sha('agent-world-reader'),
}
with open('server-manifest.json', 'x') as out:
    json.dump(manifest, out, indent=2)
    out.write('\n')
PY
ssh-keygen -Y sign -f "$HOME/.ssh/agent-world-release" -n agent-world-server server-manifest.json
```

Saisir la phrase secrète : OpenSSH produit `server-manifest.json.sig`. Le manifeste et sa signature se distribuent avec les binaires. Ne plus modifier le manifeste après signature. L’architecture est celle des binaires Linux, même lorsque la signature est réalisée sur Mac.

### Vérifier avec une clé publique connue

Pour la vérification locale du mainteneur, créer la liste des signataires à partir de sa propre clé publique :

```sh
awk '{print "am-labs namespaces=\"agent-world-server\" " $1 " " $2}' "$HOME/.ssh/agent-world-release.pub" > allowed-signers
ssh-keygen -Y verify -f allowed-signers -I am-labs -n agent-world-server -s server-manifest.json.sig < server-manifest.json
```

Cette commande doit réussir. Les utilisateurs doivent construire ou vérifier `allowed-signers` avec la clé publique obtenue par un canal de confiance indépendant du paquet, par exemple la page HTTPS du projet, et conserver cette référence pour les mises à jour. Accepter une nouvelle clé uniquement parce qu’elle accompagne le téléchargement annule cette protection. Un fichier remplacé avec son nouveau hash ne passera pas la signature du manifeste d’origine.

Avant toute exécution en root, vérifier aussi les hashes des deux binaires et examiner les deux scripts administratifs : ce manifeste ne signe pas ces scripts. L’installateur répète la vérification des signatures et des hashes avec les options `--manifest`, `--signature`, `--allowed-signers` et `--signer am-labs` (chemins absolus). Pour diffuser également les scripts sous signature, signer un inventaire complet séparé et le vérifier avec un outil de confiance avant de les exécuter.

# VPS — installation administrative du protocole 2

Pour développeurs et administrateurs Linux. La préparation est distincte de l’app Mac. Ne jamais donner au viewer une clé root/Hermes générale. Référence testée : Debian 13 arm64, OpenSSH et systemd. Les autres distributions doivent valider les protections avant toute annonce de compatibilité.

## Architecture

Un exporteur sans root lit les profils explicitement publiés dans un espace de fichiers isolé par systemd, sans réseau, et écrit un snapshot minimal. Un compte `aw-view`, sans groupe supplémentaire, voit seulement un chroot avec un lecteur statique et ce snapshot. Le lecteur n’embarque pas SQLite ; après ouverture de ses fichiers fixes, seccomp interdit nouvelles ouvertures, processus, exécution et réseau. OpenSSH interdit shell libre, SCP/SFTP, PTY, tunnels TCP/Unix/agent/X11 et scripts utilisateur.

L’exporteur reste de confiance : les bases contiennent potentiellement plus que les métadonnées qu’il extrait. Le répertoire Hermes est monté en lecture seule dans son espace ; les secrets usuels `.env`, `config.yaml`, `credentials`, `.ssh` sont masqués, mais ce n’est pas un inventaire universel des secrets d’une installation personnalisée. Ne pas stocker de secret dans un nom ou titre publié volontairement.

## 1. Compiler ou authentifier les composants

Examiner les sources d’une révision précise. Sur chaque architecture Linux cible, installer Rust 1.98.0, `musl-tools`, compilateur C et `sqlite3`, puis :

```sh
rustup target add aarch64-unknown-linux-musl
CC=musl-gcc RUSTFLAGS='-C linker=musl-gcc -C target-feature=+crt-static' cargo build --locked --release --manifest-path collector/Cargo.toml --target aarch64-unknown-linux-musl
RUSTFLAGS='-C linker=musl-gcc -C target-feature=+crt-static' cargo build --locked --release --manifest-path reader/Cargo.toml --target aarch64-unknown-linux-musl
```

Pour x86_64, remplacer le triplet par `x86_64-unknown-linux-musl`. Un binaire compilé n’est pas une preuve de fonctionnement sur cette architecture.

L’installateur exige les hashes des deux ELF statiques et leur architecture. Pour une compilation que vous avez examinée vous-même, ajouter explicitement `--reviewed-source-build`. Pour un paquet précompilé, fournir `--manifest`, `--signature`, `--allowed-signers` et `--signer` : vérification OpenSSH `ssh-keygen -Y verify`, namespace `agent-world-server`. Le manifeste JSON contient `protocol: 2`, `architecture`, `readerSha256` et `collectorSha256`. Vérifier la signature et les hashes depuis un outil de confiance avant de lancer un script en root ; le contrôle interne ne peut pas rendre sûr un installateur déjà modifié. Examiner les deux scripts administratifs. La clé de confiance doit être obtenue indépendamment du paquet. **Aucune clé de signature officielle 0.2.0 n’a encore été publiée : un hash seul n’authentifie pas le mainteneur.**

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

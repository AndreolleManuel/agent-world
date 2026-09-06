# Agent World — connexion à Hermes sur un VPS

## État réel de cette version

L’app macOS propose **Sur ce Mac** et **Sur un VPS**. Le mode VPS exécute un collecteur sur le serveur via SSH, puis affiche les mêmes agents et preuves dans le laboratoire. Il ne pilote pas Hermes. Aucun serveur AM Labs ni port HTTP public n’intervient.

Le collecteur est un programme Rust autonome sans Tauri, navigateur, serveur web, service systemd ou dépendance à l’exécutable sqlite3. Il réutilise les fichiers source du lecteur de l’app et son SQLite embarqué. La compatibilité des données reste celle des versions/schémas Hermes reconnus par ce lecteur, pas une promesse sur toutes les versions d’Hermes.

**Parcours conseillé :** le ZIP Mac de la bêta contient les deux collecteurs Linux ; l'app détecte l'architecture et propose leur installation après consentement. Aucun compilateur à installer avec ce parcours : voir [INSTALLATION.md](INSTALLATION.md). L'installation avancée depuis les sources est décrite ci-dessous. La compilation croisée et les contrôles de fichiers ne remplacent pas une recette sur VPS réel, qui reste à effectuer. L'app n'est pas notarisée.

## 1. Installation avancée depuis les sources (facultative)

Utiliser le compte Unix qui exécute Hermes, avec accès à ses données, sans sudo. Le script refuse l’installation en root ; ne pas changer les permissions des bases pour contourner une erreur. Pour Docker, le collecteur doit avoir un accès cohérent au répertoire Hermes et aux fichiers WAL/SHM sur le serveur ; le branchement dans un conteneur n’est pas automatisé dans cette version.

Prérequis : SSH, Rust/Cargo récent compatible avec `collector/Cargo.lock` (édition Rust 2024), compilateur C et outils de compilation. Si Rust manque, suivre son [installation officielle](https://www.rust-lang.org/tools/install) ; le script n’installe pas silencieusement une chaîne de compilation.

Depuis le poste de développement, produire une archive minimale :

```sh
sh scripts/package-collector.sh
```

L’archive contient uniquement les sources nécessaires et ce guide, sans `.git`, préférences, données Hermes ou clés. La transférer sur le VPS, l’extraire dans un dossier dédié, puis depuis ce dossier :

```sh
sh scripts/install-collector.sh
```

Le binaire est installé dans `~/.local/bin/agent-world-collector`. Le script compile avec le verrou Cargo fourni et vérifie `--version`. Aucun fichier de configuration Hermes n’est modifié et aucun service n’est activé.

Pour mettre à jour explicitement :

```sh
sh scripts/install-collector.sh --replace
```

Une copie de l’ancien binaire est conservée ; son chemin est affiché. Pour revenir en arrière, remplacer uniquement le collecteur par cette copie après avoir fermé Agent World. Pour désinstaller, retirer ce binaire et, si souhaité, ses sauvegardes identifiées. Ne pas supprimer le dossier Hermes.

## 2. Préparer SSH sur le Mac

Faire une première connexion manuelle vers le **nom/adresse et le port exacts** du VPS. Comparer l’empreinte de clé de serveur avec une source fiable de l’hébergeur avant de l’accepter. Une clé modifiée doit être investiguée, pas supprimée automatiquement de known_hosts.

L’app utilise `/usr/bin/ssh`, clés déjà approuvées et authentification par clé. Une clé protégée doit être déverrouillée dans l’agent SSH. On peut indiquer son chemin absolu sur le Mac dans le configurateur ; son contenu n’est jamais lu par le frontend ni enregistré dans les préférences.

Cette première version ignore `~/.ssh/config` (`-F /dev/null`) : saisir l’adresse réelle, l’utilisateur et le port, pas un alias dépendant de ProxyCommand/ProxyJump. Bastions, mots de passe interactifs, ajout automatique de clés hôte et transfert de l’agent SSH ne sont pas pris en charge.

## 3. Configurer Agent World

1. Ouvrir **Configurer mes agents**, puis **Sur un VPS**.
2. Renseigner serveur, utilisateur, port ; clé privée locale facultative.
3. Laisser le dossier distant vide pour le dossier Hermes résolu côté serveur, ou fournir un chemin absolu.
4. Cliquer **Tester le VPS**. Ce bouton ne fait aucune installation.
5. Sélectionner les profils, choisir les avatars et ouvrir le laboratoire.

La source est recontrôlée au moment de l’enregistrement. Source et préférences sont conservées atomiquement sur le Mac ; les identités sont séparées par serveur, utilisateur, port et racine distante. Le mode local reste disponible. Une seule source est affichée à la fois, pas un agrégateur simultané multi-VPS.

## Transport et confidentialité

- Commande distante fixe : `exec "$HOME/.local/bin/agent-world-collector" --stdio`.
- Le dossier distant est transmis en JSON sur stdin, jamais interpolé dans une commande shell. Aucun SQL, commande d’agent ou chemin d’exécutable distant personnalisé n’est accepté.
- Une connexion SSH par collecte ; pas de socket de contrôle persistant. Le polling de l’app reste sans chevauchement. Délai global local de 12 secondes ; requête limitée à 8 Kio et réponse à 4 Mio.
- Protocole versionné (v1), contrôle des formes/limites et identifiants uniques ; champs inconnus non retransmis au frontend. Un résultat invalide n’est pas présenté comme un monde vide.
- Seuls identités publiques, titres, états et preuves autorisés sont exportés. Pas de prompts, conversations, tokens ou variables d’environnement. **Un titre peut lui-même contenir une information sensible** : ne pas partager aveuglément une capture.
- Horloges du Mac/VPS synchronisées nécessaires : un décalage ou snapshot âgé de plus de 30 secondes est refusé. La durée de transport est ajoutée conservativement à l’âge des preuves.
- Coupure SSH : dernier état conservé et monde figé, message de connexion perdue ; la fraîcheur continue de vieillir. Reconnexion à la collecte suivante ou via Réessayer.
- StrictHostKeyChecking=yes, BatchMode=yes, aucun transfert d’agent/port, aucune acceptation silencieuse d’identité hôte. Les erreurs publiques sont des codes expurgés, pas le stderr brut.
- Le compte SSH garde ses droits système habituels. Le collecteur restreint ce qu’il lit/expose ; ce n’est pas un sandbox OS ni une clé SSH magiquement limitée à la lecture. Un compte/une clé dédiés et une commande forcée peuvent durcir un déploiement, mais ne sont pas configurés automatiquement.
- Les garanties SQLite détaillées dans [SECURITY.md](SECURITY.md) restent applicables : aucune mutation SQL ; des fichiers auxiliaires WAL/SHM peuvent néanmoins être créés/gérés par SQLite.

## Erreurs utiles

| Message | Action |
| --- | --- |
| Identité non vérifiée/modifiée | Vérifier l’empreinte côté hébergeur et la première connexion SSH |
| Authentification refusée | Vérifier utilisateur, clé et agent SSH déverrouillé |
| Collecteur introuvable | Installer le collecteur avec le même utilisateur SSH |
| Hermes introuvable | Vérifier utilisateur, racine distante et droits ; ne pas ouvrir les permissions globalement |
| Version incompatible | Déployer le collecteur de la même version que l’app |
| Données anciennes/horloge décalée | Synchroniser l’heure des deux machines |

## Recette avant distribution publique

Tests locaux : protocole/collecteur avec vrais fichiers temporaires, commandes SSH sans interpolation, délais de processus, erreurs expurgées, stockage multi-source, onboarding et reprise après coupure simulés. Sans VPS fourni, cela ne valide pas une connexion SSH réseau réelle ni une installation Linux.

À effectuer sur VPS de test : Linux x86_64 et ARM64, clé protégée, hôte inconnu/modifié, mauvais utilisateur, collecteur absent/incompatible, changement de racine, données WAL en écriture, coupure/rétablissement réseau, installation/mise à jour/retour arrière. Les binaires embarqués suppriment le prérequis Cargo, pas le besoin de cette recette.

Références de conception : [OpenSSH ssh](https://man.openbsd.org/ssh), [configuration SSH](https://man.openbsd.org/ssh_config), [connexion distante documentée par Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/desktop). L’API Hermes distante n’est pas intégrée ici : la parité de ses preuves avec notre contrat Kanban/session n’a pas été établie, d’où la réutilisation du lecteur existant.

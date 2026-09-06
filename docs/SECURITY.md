# Modèle de sécurité — état du 6 septembre 2026

Pour une présentation sans détails d'implémentation, lire [Données et confidentialité](PRIVACY.md). Ce modèle technique ne doit pas être présenté comme un audit indépendant ou une certification du binaire distribué.

## Frontière de confiance et configuration

La récupération des seules préférences Agent World est explicite : `recover_configuration` exige confirmation, refuse une configuration saine ou un lien symbolique, et déplace le fichier invalide dans un sous-dossier privé `recovery-…` sans l'effacer. Le dossier Hermes n'est jamais ciblé. Le même lecteur de préférences borné à 1 Mio est utilisé au démarrage et en détection ; les données brutes invalides ne sont pas renvoyées au frontend. La récupération peut échouer si le stockage n'est pas accessible ; elle ne contourne pas les permissions.

Le configurateur utilise un propriétaire d'opération pour empêcher diagnostic, installation et sauvegarde simultanés. L'annulation d'une détection invalide sa réponse côté UI ; elle ne prétend pas tuer une connexion SSH déjà lancée, qui reste bornée par son délai backend. Un diagnostic relancé retire l'ancien rapport et son consentement ; une erreur ne laisse pas un ancien succès affiché comme actuel.

Le frontend n'a pas d'accès général au système de fichiers. Les commandes de collecte Rust utilisent la racine Hermes conservée côté Rust ; elles n'acceptent ni SQL ni chemin arbitraire de fichier. Les commandes `detect_hermes` et `configure_hermes` acceptent en revanche une racine absolue : elle est validée par la découverte du registre avant utilisation.

La découverte est refaite à chaque collecte : profil par défaut et enfants directs valides de `profiles/`, limite de 256 profils, slugs ASCII restreints. Liens symboliques, fichiers spéciaux, métadonnées invalides et profils supprimés/tombstones sont rejetés. Un dépassement du nombre de profils échoue explicitement plutôt que de tronquer silencieusement la liste.

La racine, la sélection d'agents et les avatars sont sauvegardés ensemble dans `hermes-source.json` dans le dossier de configuration de l'application, par fichier temporaire privé synchronisé puis renommage. Les préférences sont séparées par racine canonique ; le stockage de la WebView est seulement un cache, avec reprise des anciennes préférences au premier démarrage. Une erreur de cache après validation native n'annule pas la configuration. Le fichier est plafonné à 1 Mio et 128 sources ; les sélections/avatars sont bornés. Les brouillons de l'atelier DEV ont leur propre clé locale. Ces écritures de préférences ne modifient pas la configuration des agents Hermes.

## Heartbeats et fichiers de métadonnées

Sur Unix, les composants de répertoire sont ouverts relativement aux descripteurs parents avec `O_DIRECTORY`, `O_NOFOLLOW` et `O_CLOEXEC`. Le heartbeat est le fichier fixe `state/gateway.heartbeat`, ouvert en lecture seule, sans suivre de lien, puis contrôlé comme fichier régulier. Lecture plafonnée à 65 536 octets avec un octet supplémentaire pour détecter une croissance ; seul `updated_at` est interprété. Les métadonnées publiques de profil sont également bornées. Les plateformes non-Unix échouent fermées pour ces lectures.

Cette ouverture par descripteur protège les lectures de fichiers contre la redirection de leur parent ou feuille. Elle ne doit pas être confondue avec les garanties du moteur SQLite décrit ci-dessous, qui ouvre encore les fichiers par chemin.

## SQLite : requêtes en lecture seule, limites explicites

Les métadonnées Kanban et de sessions sont lues par SQLite 3.53.2 embarqué via `rusqlite` 0.40.2, versions verrouillées dans Cargo.lock. Le collecteur ne lance plus `/usr/bin/sqlite3`. Ouverture `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX | SQLITE_OPEN_NOFOLLOW`, sans URI, création ni mode lecture-écriture ; `query_only=ON`, `trusted_schema=OFF` et requêtes fixes. L'autoriseur n'admet que SELECT/lectures/fonctions (hors chargement d'extension), récursion et inspection `table_info` ; mutation, ATTACH et changement de PRAGMA refusés. Aucun SQL fourni par le frontend et aucune commande d'agent.

- Jusqu'à 64 boards et 256 entrées de découverte ; leur dépassement est signalé comme lecture partielle. Au plus 512 cartes agrégées, triées pour préserver la priorité aux runs confirmés. Un fichier marqueur `kanban/current` n'est pas traité comme une base illisible.
- Sortie Kanban limitée à 128 KiB par requête, lecture des sessions également bornée. Colonnes explicitement sélectionnées ; aucun corps de message, prompt ou historique de conversation n'est demandé.
- Budget de travail de 350 ms par lecture, dans le budget partagé de deux secondes du snapshot. Interruption coopérative SQLite par callback toutes les mille instructions et vérification entre les lignes ; attente de verrou limitée à 100 ms ou au budget restant à l'ouverture. Les appels filesystem/OS bloquants ne sont pas interruptibles par ce mécanisme : il ne s'agit pas d'une garantie de temps réel strict ni d'un processus que l'on peut tuer à l'échéance.
- Les connexions de ce lecteur sont sérialisées ; l'attente utilise le budget global, avant de commencer le budget de travail. La connexion est fermée avant la revérification et la fermeture des descripteurs épinglés : cela évite de libérer par inadvertance les verrous POSIX d'une autre connexion du collecteur dans le même processus.
- Sérialisation JSON plafonnée pendant l'écriture, limites SQLite sur taille de valeur, longueur SQL et nombre de colonnes. Valeurs binaires non attendues rejetées ; aucune extension SQLite activée. Fichiers temporaires de requêtes en mémoire.
- Parent et fichier principal épinglés avant la requête ; liens et fichiers auxiliaires non réguliers rejetés. Identité du fichier principal revérifiée après la lecture.
- Codes d'erreur SQLite typés convertis en codes publics (`database_busy`, `database_open_failed`, `readonly_storage`, `timeout`, etc.), sans analyse ni exposition d'un message stderr. Les erreurs de boards exposent leur slug et l'étape (`schema` ou `tasks`), pas leur chemin ni le SQL.

Limites importantes : SQLite ouvre toujours un chemin. Le refus des liens et la vérification d'identité après lecture n'empêchent pas toutes les courses portant sur les chemins ou fichiers auxiliaires ; ce n'est pas l'équivalent du confinement par descripteur des heartbeats. En mode WAL, même une connexion SQL en lecture seule peut créer ou gérer les fichiers auxiliaires `-wal`/`-shm` et prendre des verrous. **Absence de mutation SQL ne signifie donc pas zéro écriture auxiliaire sur disque.** Le mode `immutable=1` n'est pas utilisé sur les bases vivantes, car il pourrait ignorer des changements du WAL. Voir les [conditions officielles de lecture des bases WAL](https://www.sqlite.org/wal.html#read_only_databases).

Le cas `schema_database_open_failed` observé a été reproduit sur une base WAL saine fermée sans fichiers auxiliaires : `/usr/bin/sqlite3` Apple 3.51.0 renvoyait `CANTOPEN`, erreur système `ENOENT` sur le fichier `-wal`. Le lecteur embarqué passe désormais ce cas et celui d'un WAL vivant avec écrivain externe. Aucun recours au mode lecture-écriture, aucune suppression manuelle de journal, modification de permissions ou conversion des bases Hermes. Les autres erreurs réelles restent signalées : une panne d'un board n'efface pas un run confirmé dans un board lisible ; sans preuve suffisante, on ne prétend toujours pas que l'agent est disponible.

## Données publiques IPC et confidentialité

Les types sérialisés définissent la liste des champs exposés :

- Agent : identité, nom public, profil, rôle, origine, machine, état du gateway, activité principale, pièce, référence/statut/titre de tâche, motif d'attente, dates/âges/confiance, indicateur de collecte partielle.
- Preuve : source, statut, date d'observation, âge, confiance et code d'erreur expurgé.
- Session éventuelle : identifiant, titre, date d'observation, âge et confiance. Elle n'écrase pas un run confirmé.
- Carte : board, identifiant, titre, statut, assigné éventuel, motif, date de création et observation du run.
- Snapshot : agents, cartes, état partiel, date et durée de collecte.

Les titres et motifs sont tronqués et débarrassés des caractères de contrôle. Ce nettoyage **n'est pas un détecteur de secrets** : un titre d'agent, de session ou de tâche peut contenir une information sensible saisie par son auteur. Vérifier les données affichées avant capture publique ou démonstration. Aucun message brut, token, variable d'environnement ou ligne de commande d'un agent n'est volontairement collecté. La racine locale est renvoyée par la détection pour l'écran de configuration, pas par les snapshots du monde.

## Fraîcheur et incertitude

Gateway connecté jusqu'à trente secondes, puis déconnecté ; les erreurs de lecture sont distinctes d'un fichier sain et vide. Les runs confirmés utilisent leur propre date et bail ; les sessions utilisent leur bail de tour ou une inférence limitée aux outils de fond récents. Cette dernière reste une heuristique, pas une certitude d'exécution.

La fusion conserve les preuves lisibles lorsqu'une autre source échoue. Elle ne traduit pas une base illisible par « agent disponible ». Le frontend fait vieillir les preuves, signale les snapshots anciens et arrête les animations lors d'un échec/périmé ; le dernier état conservé n'est pas une nouvelle preuve.

## Réseau et permissions

Aucun client de télémétrie produit, serveur relais AM Labs ou pilotage distant d'Hermes. Le mode VPS ouvre des connexions SSH directes vers le serveur choisi par l'utilisateur. Vite écoute sur loopback en développement. La capacité Tauri n'autorise pas de plugin général filesystem/shell/HTTP ; les commandes Rust restent néanmoins privilégiées et hébergent le moteur SQLite et le transport SSH dédié.

### Source VPS via SSH

`detect_remote_hermes` teste une source ; `configure_remote_hermes` la revalide avant de sauvegarder atomiquement source et préférences. `configured_remote` restitue les paramètres enregistrés sans contacter le serveur. Hôte, utilisateur, port, chemin facultatif de clé et racine sont validés. Les préférences distantes sont séparées par hôte/utilisateur/port/racine ; le contenu des clés et les mots de passe ne sont pas enregistrés par l'app.

L'exécutable fixe `/usr/bin/ssh` est lancé avec arguments séparés, configuration utilisateur ignorée, `BatchMode=yes` et `StrictHostKeyChecking=yes`. Aucun ajout automatique de clé hôte, transfert de port ou transfert d'agent. La commande distante est fixe ; la racine Hermes passe en JSON sur stdin, jamais dans la commande shell. Le compte SSH conserve cependant ses permissions habituelles : ce n'est pas un compte rendu automatiquement lecture seule.

Le collecteur autonome utilise le même lecteur et exporte un contrat versionné de métadonnées, sans serveur réseau. Le client borne la requête à 8 Kio, la réponse à 4 Mio, stderr à 8 Kio et le processus SSH à 12 secondes avant arrêt/récupération du processus local. Les erreurs publiques sont expurgées. La réponse est désérialisée dans les DTO autorisés, contrôlée (version, cardinalités, identifiants uniques) et rejetée si son horodatage diffère de plus de trente secondes. Ces contrôles ne certifient pas la véracité d'un serveur compromis.

Voir le [guide VPS](VPS.md) pour les prérequis SSH, les limites WAL/SHM, la confidentialité des titres et la recette Linux encore nécessaire. Aucun VPS réel n'a été contacté pour les tests locaux de cette implémentation.

La commande dédiée `open_company_site` ouvre uniquement l'URL fixe `https://amlabs.dev` sur clic utilisateur. Cela lance le navigateur et peut provoquer une connexion réseau ; ce n'est pas un envoi automatique de données d'agents. La CSP de production limite les ressources de la WebView et l'IPC ; elle ne constitue pas un sandbox du collecteur Rust.

## Retour arrière et distribution

Le parcours de bêta ajoute deux commandes dédiées : `diagnose_remote` (sondes système et lecture Hermes, sans installation) et `install_remote_collector` (écriture distante limitée au collecteur après confirmation). Le backend n'accepte ni URL, script, commande ou binaire du frontend. Les ressources empaquetées sont contrôlées par manifeste de version, SHA-256, format et architecture ELF. Le transfert SSH est limité à 16 Mio et soixante secondes côté client. Le serveur vérifie la somme et la version avant le remplacement, conserve l'ancien binaire et sérialise les installations par verrou. Voir [BETA-MAC.md](BETA-MAC.md).

L'arrêt du processus SSH local n'est pas une garantie de destruction de tous les processus distants ; un dépassement de délai laisse l'issue de l'installation incertaine, à diagnostiquer avant une nouvelle tentative. La somme de contrôle détecte les corruptions mais n'authentifie pas à elle seule un paquet dont le manifeste aurait aussi été remplacé : la chaîne de signature/distribution de l'app reste essentielle. Les chemins symboliques et les comptes root sont refusés par l'installateur ; cela ne constitue toujours pas un sandbox du compte SSH.

Le diagnostic copiable utilise une seconde liste de champs/codes autorisés côté UI, sans hôte, utilisateur, chemin, titre ni erreur brute. La vérification publique `scripts/audit-public.mjs --history` inspecte le worktree et les objets de l'historique en lecture seule, sans afficher les valeurs détectées. Ses motifs ne garantissent pas l'absence exhaustive de secrets ; les droits des assets et la licence sont des contrôles séparés.

Arrêter le processus de développement avant toute restauration. Préserver les préférences utilisateur et l'intégralité des données Hermes. Le worktree contient plusieurs lots non commités : inspecter le diff et faire une sauvegarde avant de restaurer des fichiers ciblés depuis un checkpoint connu. Aucune suppression de branche, de worktree ou de base n'est une étape automatique de rollback.

La bêta est signée ad-hoc, sans Developer ID ni notarisation. La recette Linux réelle reste à faire et les mises à jour sont manuelles. Le rendu Pixi utilise son adaptateur statique sans unsafe-eval et charge les PNG embarqués par image, sans worker blob ni fetch de texture ; la CSP reste stricte. Ce document décrit l'implémentation et ses limites actuelles, pas une certification de sécurité pour distribution.

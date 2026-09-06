# Données et confidentialité

État de l'implémentation : 6 septembre 2026. Ce document décrit Agent World, pas les traitements effectués par Hermes, ses modèles d'IA ou les sites externes visités par l'utilisateur.

## En bref

Agent World affiche l'activité de vos agents Hermes depuis votre Mac ou votre VPS. Les données d'agents ne sont pas envoyées à AM Labs par l'application. Aucun compte AM Labs, service cloud AM Labs, suivi d'usage ou rapport de plantage automatique n'est intégré dans cette version.

L'application observe les agents ; elle ne leur envoie pas de tâches. Le mode VPS transmet des métadonnées directement du serveur au Mac par SSH. Ce n'est donc pas un mode « sans réseau ».

## Quelles données sont lues ?

- Identifiants et noms publics des profils, rôle et informations d'activité.
- Horodatages des heartbeats et indices de fraîcheur.
- Identifiants, titres, états et assignations des tâches Kanban ; motifs d'attente et informations de runs nécessaires à la supervision.
- Certaines métadonnées de sessions, notamment identifiant, titre et dates d'activité.

Les requêtes ne demandent pas les corps de messages, les prompts ni l'historique des conversations. Les fichiers de secrets Hermes ne font pas partie des sources de collecte prévues. Un **titre** peut néanmoins contenir une information sensible : les limites de longueur et le retrait des caractères de contrôle ne constituent pas une anonymisation. Vérifiez l'écran avant une capture ou une démonstration publique.

Le code restreint les lectures et les champs exposés ; cela ne supprime pas les permissions système du processus. Le collecteur n'est pas un sandbox du compte utilisateur.

## Qu'est-ce qui est conservé sur le Mac ?

Agent World enregistre le dossier Hermes choisi, la sélection d'agents et leurs avatars dans `hermes-source.json`, dans le dossier de configuration de l'application (`com.amlabs.pixelops`, sous `~/Library/Application Support` sur macOS). Un cache de préférences existe aussi dans le stockage local de la WebView.

Pour une source VPS, les préférences comprennent l'hôte, l'utilisateur, le port, le dossier distant et, si renseigné, le **chemin** de la clé SSH. Elles ne contiennent pas le contenu de la clé ni un mot de passe. L'authentification utilise OpenSSH sur le Mac et éventuellement son agent SSH ; une clé privée n'est pas transférée sur le VPS par Agent World.

Les paramètres ne sont pas chiffrés par l'application ; le fichier natif est créé avec des permissions privées. Les préférences restent présentes après fermeture, mise à jour ou retrait de l'app. Une récupération de configuration conserve une sauvegarde dans un sous-dossier `recovery-…` ; cette sauvegarde peut donc contenir les anciens paramètres de connexion.

Les snapshots et le journal des changements sont conservés en mémoire pendant l'exécution ; aucun historique persistant de tâches n'est prévu. Le journal est limité à cent événements observés. Les outils de placement réservés au développement ont leur propre brouillon local.

## Quelles connexions sont établies ?

- **Mode Mac :** la collecte se fait sur les fichiers locaux ; elle n'a pas besoin d'un serveur AM Labs.
- **Mode VPS :** le client SSH du Mac contacte le serveur choisi et exécute le collecteur. Aucun relais AM Labs, transfert de port ou transfert de l'agent SSH n'est configuré. Le serveur doit déjà être approuvé dans SSH ; l'app ne valide pas automatiquement son identité. Son administrateur peut journaliser les connexions SSH.
- **Lien AM Labs :** un clic ouvre `https://amlabs.dev` dans le navigateur. La visite relève des traitements du site, pas de la collecte Hermes ; l'URL n'inclut pas les données des agents.
- **Téléchargement et assistance :** télécharger depuis GitHub ou y publier un signalement implique une interaction avec GitHub. Une issue et ses pièces jointes peuvent être publiques. Cela ne signifie pas que GitHub reçoit les données Hermes pendant l'utilisation de l'app.

Les connexions propres à Hermes, au système d'exploitation et au navigateur sont distinctes. Les mises à jour d'Agent World sont manuelles dans cette version ; il n'existe pas de vérification automatique des nouvelles versions intégrée.

## Quelles écritures sont possibles ?

La supervision n'exécute pas de mutation SQL ni de commande d'agent. Cela ne signifie pas « zéro écriture sur disque » : l'application sauvegarde ses préférences et SQLite peut gérer des fichiers auxiliaires WAL/SHM ou des verrous lors de la lecture d'une base vivante.

Sur VPS, l'installation ou la mise à jour du collecteur demande une autorisation explicite. Elle écrit dans `~/.local/bin`, conserve une ancienne version lorsqu'elle existe et n'installe pas de service permanent. Elle ne modifie pas les réglages Hermes. Le compte SSH conserve ses droits habituels. Voir [VPS.md](VPS.md) et [SECURITY.md](SECURITY.md) pour les limites précises.

## Assistance, suppression et signalements

Le bouton « Copier le diagnostic » prépare un texte limité à la version, la plateforme, l'architecture et des codes d'état autorisés. Il ne l'envoie pas : vous choisissez ensuite où le partager. Ne joignez pas vos bases Hermes, conversations, captures sensibles, clés ou mots de passe à une issue.

Fermer Agent World arrête sa collecte ; cela n'arrête pas Hermes. Mettre l'app à la corbeille ne supprime ni les données Hermes ni les préférences Agent World. Le guide [INSTALLATION.md](INSTALLATION.md) et le guide [BETA-MAC.md](BETA-MAC.md) distinguent le retrait de l'app, du collecteur et des paramètres. Ne supprimez pas le dossier Hermes pour désinstaller Agent World.

Pour une vulnérabilité, utilisez le [signalement privé GitHub](https://github.com/AndreolleManuel/agent-world/security/advisories/new), activé le 6 septembre 2026 ; n'ouvrez pas d'issue contenant une faille exploitable ou des données sensibles. Aucun délai contractuel de réponse n'est promis.

## Ce qui reste à vérifier avant diffusion

Ces explications reposent sur l'examen de l'implémentation ; elles ne constituent ni un audit indépendant ni une certification de sécurité. La capture du trafic réseau du paquet distribué, les essais sur des Mac externes et la recette SSH sur VPS réel restent à consigner. La version actuelle est non notarisée par Apple : voir les précautions de [INSTALLATION.md](INSTALLATION.md).

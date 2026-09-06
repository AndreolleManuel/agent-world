# Agent World — bêta Mac

## Ce que l'utilisateur doit pouvoir faire

Une app universelle Intel/Apple Silicon, macOS 12.3 minimum déclaré (la recette de compatibilité reste à faire), sans Node, Rust ni Cargo. Le guide utilisateur est [INSTALLATION.md](INSTALLATION.md). Hermes reste installé séparément. La supervision observe les preuves disponibles ; elle n'exécute aucune tâche d'agent.

- **Sur ce Mac** : détecter Hermes, sélectionner les agents et leurs avatars, ouvrir le laboratoire.
- **Sur un VPS** : renseigner une adresse réelle, un compte SSH et éventuellement un chemin de clé ; vérifier le serveur ; autoriser l'installation du collecteur inclus ; tester Hermes, choisir les avatars et ouvrir le laboratoire.

Le VPS n'a besoin ni de navigateur ni de port HTTP public. Les binaires Linux statiques x86_64 et ARM64 sont sélectionnés automatiquement. La distribution n'est pas demandée à l'utilisateur ; les systèmes anciens et environnements atypiques restent soumis à validation.

## Connexion SSH : limites visibles

L'identité du serveur doit déjà être approuvée dans known_hosts après vérification de l'empreinte. L'app ne désactive jamais cette protection. Authentification par clé ; pour une clé protégée, la déverrouiller dans l'agent SSH du Mac. Aucun mot de passe enregistré. Cette version ignore les alias et directives de `~/.ssh/config` ; pas de bastion automatique.

L'installation intégrée refuse root, les chemins de destination symboliques et les plateformes non prises en charge. Elle ne change pas les droits des données Hermes. Docker n'est pas automatiquement configuré : un accès cohérent aux données et fichiers WAL/SHM doit être préparé par l'administrateur.

## Installation du collecteur

Le diagnostic n'installe rien. La case de consentement et le bouton d'installation sont distincts. Le backend recontrôle le serveur, vérifie le manifeste de la même version que l'app, la somme SHA-256 et l'architecture du binaire. Transfert direct par SSH vers un fichier temporaire privé, seconde vérification SHA-256 sur le serveur, test `--version`, sauvegarde de l'ancien binaire et renommage final. Aucun téléchargement arbitraire ni URL fourni par le frontend.

Seule la destination `~/.local/bin/agent-world-collector` est utilisée. Les sauvegardes portent le préfixe `agent-world-collector.backup.` dans le même dossier. Aucun service permanent, port d'écoute ou fichier de configuration Hermes ajouté. Un verrou d'installation empêche deux remplacements simultanés. Une interruption brutale peut laisser un verrou ou un fichier temporaire : inspecter les processus avant tout nettoyage manuel. Après un délai dépassé, relancer le diagnostic avant de recommencer ; l'issue distante peut être incertaine.

Pour désinstaller : fermer Agent World, mettre l'app à la corbeille ; sur le serveur, retirer uniquement le binaire du collecteur et ses sauvegardes identifiées si inutiles. Ne pas supprimer le dossier Hermes. Pour revenir à une version antérieure du collecteur, fermer l'app et remettre la sauvegarde choisie à la place du seul binaire.

## Diagnostic partageable

Le bouton **Copier le diagnostic** exporte version de l'app, plateforme, architecture, étapes et codes autorisés. Aucun hôte, utilisateur, chemin de clé, titre d'agent/tâche, conversation ou erreur brute. En cas de refus du presse-papiers, une zone de texte permet la copie manuelle. Les captures du monde peuvent en revanche révéler des titres sensibles : les vérifier avant partage.

## Fabriquer une bêta sans publication

Le workflow manuel `.github/workflows/beta.yml` compile et teste les collecteurs sur Linux x86_64 et ARM64, puis assemble une app Mac universelle. Il vérifie la présence de binaires ELF sans interpréteur dynamique et construit un manifeste SHA-256. Il n'a que la permission `contents: read` et n'effectue aucune publication, création de tag ou de release. Les artefacts de workflow ne constituent pas une distribution publique approuvée.

Il reste nécessaire d'autoriser l'envoi du code et l'exécution du workflow sur le dépôt voulu. La définition du workflow n'est pas une preuve de réussite de son exécution.

Sur un dépôt public, les logs/artefacts de workflow suivent les règles d'accès GitHub : ne pas les considérer comme confidentiels. Le workflow ne reçoit aucun profil Hermes ni secret de signature.

Pour construire une bêta complète localement après récupération des deux binaires issus de ce workflow :

```sh
npm ci
rustup target add aarch64-apple-darwin x86_64-apple-darwin
node scripts/prepare-collectors.mjs /chemin/vers/les/deux/binaires
npm run build:beta
npm run package:beta
```

`npm run build:mac` construit l'app universelle sans collecteurs Linux embarqués ; le diagnostic indique alors leur absence et l'installation intégrée n'est pas proposée. L'installation avancée depuis les sources reste documentée dans [VPS.md](VPS.md).

Une compilation croisée locale est aussi possible avec un exécutable Zig vérifié provenant du [site officiel](https://ziglang.org/download/) et les cibles Rust Linux musl installées : `node scripts/build-collectors-macos.mjs /chemin/absolu/vers/zig`. Ce script compile SQLite avec Zig et lie le collecteur avec le linker Rust ; il ne télécharge rien et ne prouve pas l'exécution Linux. Les binaires obtenus passent ensuite par `prepare-collectors.mjs` avant leur inclusion dans l'app.

Le packaging local et le workflow utilisent le même script. Le dossier `release/beta-…` contient l'app en ZIP, les guides liés entre eux, `BUILD-STATUS.json` et `SHA256SUMS` pour tous ces fichiers. La révision Git et l'empreinte des sources sont embarquées au build ; le packaging refuse un changement de sources depuis la compilation. Une révision marquée `dirty` n'est pas un commit reproductible : figer le lot public avant une release finale.

## Distribution gratuite et validation avant diffusion

La procédure GitHub et les décisions de licence sont détaillées dans [PUBLICATION.md](PUBLICATION.md). `npm run audit:assets` inventorie les visuels sans présumer de leurs droits.

La distribution retenue est gratuite, avec signature ad-hoc : **pas de notarisation ni de garantie d'ouverture sans avertissement Gatekeeper**. Les scripts de build Mac retirent les variables Apple héritées et imposent cette signature locale ; aucune soumission de notarisation. L'abonnement Apple n'est pas requis pour ce parcours. La première ouverture est documentée dans [INSTALLATION.md](INSTALLATION.md) : uniquement une exception propre à l'app de confiance, jamais une désactivation globale des protections.

Avant de déclarer la version prête : tester sur un Mac Intel et un Mac Apple Silicon, une installation propre, les clés protégées, des données Hermes vivantes sur Linux, les pertes de connexion, les versions incompatibles et le retour arrière. Tester également la version minimale de macOS annoncée.

## Avant de rendre le dépôt public

```sh
node scripts/audit-public.mjs --history
```

Le contrôle est en lecture seule, n'affiche pas les valeurs détectées et échoue tant qu'une licence n'est pas choisie ou que la provenance des assets n'est pas validée. Il signale aussi certains motifs de secrets et chemins personnels dans le worktree et l'historique. Ce n'est pas un audit exhaustif. Ne pas publier directement ce worktree avec ses rapports internes ; examiner les résultats et préparer un lot public approuvé. Ne pas réécrire l'historique ni publier sans accord.

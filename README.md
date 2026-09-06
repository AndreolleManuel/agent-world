# AM Labs · Agent World

Un laboratoire pixel-art pour voir vivre vos agents Hermes : activité, attente, blocages et tâches, depuis votre Mac ou votre VPS. Un projet gratuit et open source porté par [AM Labs](https://amlabs.dev). Ce n'est pas un outil de pilotage : il n'envoie aucune tâche aux agents.

**[Télécharger pour Mac — bêta](https://github.com/AndreolleManuel/agent-world/releases/tag/v0.1.0-beta.1)** · Intel et Apple Silicon · **non notarisée par Apple**

[Installation Mac](docs/INSTALLATION.md) · [Données et confidentialité](docs/PRIVACY.md) · [Contribuer](CONTRIBUTING.md) · [Sécurité](SECURITY.md)

![Agent World : agents au travail dans le laboratoire et en pause dans le salon](docs/screenshots/agent-world-demo.png)

Capture réelle du mode démo : données simulées, aucune conversation ni donnée privée publiée. Les animations illustrent les états observés ; les occupations de pause sont décoratives.

## Vos agents restent chez vous

Agent World affiche les métadonnées Hermes sans les transmettre à AM Labs. Aucun compte AM Labs, suivi d'usage ou rapport de plantage automatique n'est intégré. En mode local, la collecte lit les fichiers sur le Mac ; en mode VPS, les métadonnées arrivent directement du serveur par SSH.

L'app lit notamment les noms, états et titres de tâches/sessions, pas les corps des conversations. Ces titres peuvent contenir des informations sensibles : vérifiez vos captures avant de les partager. Connexions et avatars sont enregistrés localement ; l'installation d'un collecteur VPS demande un accord explicite. Consultez la [fiche de confidentialité](docs/PRIVACY.md) pour les données conservées, les écritures possibles et les liens externes. Ces mécanismes ne constituent pas une certification de sécurité.

## Bêta Mac et installation

Le parcours de bêta vise une app universelle Intel/Apple Silicon, macOS 12.3+, avec collecteurs Linux x86_64/ARM64 embarqués : aucun Rust/Cargo à installer par l'utilisateur. Le configurateur vérifie le serveur et propose une installation SSH uniquement après consentement. Le diagnostic partageable exclut adresses, clés et données d'agents.

La distribution est **gratuite, non notarisée**, sans abonnement Apple. Voir le [guide d'installation](docs/INSTALLATION.md), la [préparation de bêta](docs/BETA-MAC.md) et le [parcours GitHub Releases](docs/PUBLICATION.md). Le workflow manuel produit des artefacts de test, sans publier de release. **Sa présence ne signifie pas que les tests Linux ou la compatibilité Mac ont été validés.** L'installation sur un VPS réel, le Mac Intel et la version minimale de macOS restent à valider : cette première version est une bêta de test, pas une version stable certifiée.

## Fonctionnement actuel

- Détection du profil par défaut et des profils nommés d'une racine Hermes configurable ; sélection des agents et de leurs avatars dans un accueil illustré.
- Choix Mac/VPS dans le configurateur. Le mode distant utilise un collecteur autonome via SSH vérifié, sans relais AM Labs ni port HTTP public. Une seule source à la fois ; installation intégrée si les binaires vérifiés sont inclus dans la build, sinon alternative depuis les sources. Voir le [guide VPS](docs/VPS.md).
- Lecture des heartbeats, des métadonnées de sessions et des boards Kanban SQLite. Run confirmé, session active, attente, revue, blocage et absence de preuve sont distingués. La fraîcheur du gateway ne prouve pas à elle seule un travail en cours.
- Dix places dans le laboratoire et dix à droite dans la salle de pause. Les occupations de pause sont décoratives, pas des actions Hermes. Au-delà de la capacité d'une zone, une notice et le panneau Équipe donnent accès aux agents hors scène.
- Monde adapté à la hauteur disponible ; Équipe, Kanban et Journal dans un panneau superposé, fermé par défaut. Fermeture par bouton, Échap ou fond du dialogue, défilement interne. Filtres de recherche, board, statut, assignation et cartes prêtes non assignées.
- Collecte périodique bornée côté SQLite, hors du thread UI. En cas d'échec, les dernières données restent identifiées comme anciennes et les animations s'arrêtent. Le journal garde au plus cent changements observés depuis l'ouverture, sans historique persistant.
- Correspondances d'avatars et sélection conservées localement ; chemin de source sauvegardé dans la configuration de l'application. Aucun compte cloud ni télémétrie produit.

## Développement macOS

Prérequis : Node.js/npm, Rust stable et outils de développement macOS nécessaires à Tauri. SQLite est embarqué dans l'application (`rusqlite` 0.40.2 / SQLite 3.53.2) : aucun outil SQLite à installer pour l'utilisateur. Les tests macOS emploient encore `/usr/bin/sqlite3` comme écrivain externe de bases jetables.

```bash
npm ci
npm test
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

`npm run tauri dev` démarre Vite sur `127.0.0.1:1420` et la fenêtre native. `Ctrl-C` arrête le processus de développement. Le navigateur seul ne dispose pas du collecteur IPC natif.

Routes de vérification réservées au développement :

- `/?fixture=1` : scénarios simulés (dix actifs, dix en pause, absence de preuve, surcharge, erreur) ; aucune lecture Hermes.
- `/?layout=1` : atelier de placement manuel, brouillon local indépendant. L'export JSON ne modifie pas automatiquement le monde et ne certifie pas les collisions.

Diagnostic optionnel, avec une racine absolue choisie explicitement :

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example inspect_world -- /chemin/absolu/vers/hermes
```

Cinq lectures ponctuelles par défaut ; arguments optionnels après la racine : nombre de lectures (1–60), intervalle en millisecondes (0–1000). Sortie limitée aux comptes, durées et codes d'état par source, sans titres ni conversations.

## Architecture et limites

L'app utilise Tauri 2, React/TypeScript et PixiJS. `src/App.tsx` orchestre la collecte et les panneaux ; `src/world/` contient placement, navigation et rendu ; `src-tauri/src/heartbeat.rs` fusionne les preuves ; `sqlite_read.rs` encadre le moteur SQLite embarqué en lecture seule. Le [modèle de sécurité](docs/SECURITY.md) décrit les garanties et les limites du lecteur et du transport SSH.

Le défaut d'ouverture des bases WAL fermées avec le SQLite macOS a été reproduit puis corrigé par l'emploi du moteur embarqué ; les erreurs réelles restent explicites. Restent notamment l'évitement entre agents mobiles, la collision de leur silhouette complète, une recette visuelle automatisée et la consolidation du configurateur multi-source. Les tests de trajets ne prouvent pas une animation sans aucun chevauchement. Le bundle principal dépasse encore le seuil d'avertissement Vite de 500 kB.

Le téléchargement est un ZIP universel signé ad-hoc. Developer ID et notarisation ne sont pas utilisés dans ce parcours gratuit. La recette multi-machines reste à compléter. Les mises à jour de l'app sont manuelles ; les limites et vérifications propres à chaque build figurent dans ses notes de release et `BUILD-STATUS.json`.

## Licence et contributions

Décision de publication : code source sous **MIT**, permettant utilisation, modification et redistribution, y compris commerciale, avec conservation des mentions de licence et de copyright. Il n'y a pas de restriction publicitaire ni d'interdiction de revente ajoutée à cette licence. La présence d'AM Labs dans la version officielle n'oblige pas les versions dérivées à conserver ce décor.

Voir [LICENSE](LICENSE) — Copyright © 2026 Manuel Andreolle — et [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Le mainteneur atteste avoir créé les visuels pour ce projet, sans pack tiers déclaré. La licence ne concède que les droits détenus par les contributeurs, sans revendication de droits exclusifs sur des éléments purement générés par IA. Les dépendances gardent leurs licences et notices ; les sources MPL non modifiées sont fournies avec l'app.

Les retours et améliorations sont bienvenus : voir [CONTRIBUTING.md](CONTRIBUTING.md). Créé et maintenu par [AM Labs](https://amlabs.dev) — applications métier et automatisations sur mesure.

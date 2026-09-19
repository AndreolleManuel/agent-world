# Contribuer à Agent World

Projet MIT pour développeurs utilisant Hermes. Commencer par le README, le modèle de sécurité et le protocole 2. Toute donnée de test doit être synthétique.

Sur macOS : Node.js 22+, Rust 1.98.0, Xcode et sqlite3. Exécuter `npm ci`, `npm run lint`, `npm test`, `npm run test:release`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `npm run build`. Les tests d'isolation macOS doivent réellement s'exécuter ; un environnement qui interdit sandbox-exec n'est pas une validation réussie.

Pour le serveur, tester `collector` et `reader` sur Linux, avec SQLite installé pour les fixtures ; ne jamais utiliser de données ou comptes de production. Les workflows PR ont uniquement des permissions de lecture et ne publient pas d'artefacts signés. Les essais SSH destructifs s'exécutent exclusivement dans une VM jetable locale dédiée.

Une PR explique le défaut concret, le comportement obtenu, les tests et limites. Les changements aux DTO, dépendances ou cibles demandent de rafraîchir protocole, lockfiles, inventaires et notices. Les dépendances de release gardent leur licence et les archives MPL vérifiées.

Ne pas ajouter de commande shell, URL automatique, chemin distant ou IPC générique en réponse à une donnée reçue. Ne pas utiliser les avatars comme contrôle d'accès. Ne pas fournir de repli vers un compte SSH général en cas d'erreur.

Pour une vulnérabilité, suivre SECURITY.md plutôt qu'une issue publique avec secrets ou détails immédiatement exploitables.

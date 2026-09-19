# AM Labs · Agent World

Un laboratoire pixel-art pour observer l’activité de ses agents Hermes sur Mac : travail confirmé, attente, blocages et absence de preuve. Gratuit et open source, sous licence MIT. Créé par [AM Labs](https://amlabs.dev).

**0.2.0 — candidat de test pour développeurs.** Cette version remplace l’ancien accès SSH général par un lecteur dédié et un export limité. Les anciennes archives 0.1.x ne bénéficient pas de ces protections. Le candidat 0.2.0 n’est pas encore une release publique ni une version notarisée.

[Installer / compiler](docs/INSTALLATION.md) · [Préparer un VPS](docs/VPS.md) · [Confidentialité](docs/PRIVACY.md) · [Sécurité](docs/SECURITY.md) · [Validation](docs/VALIDATION-0.2.0.md) · [Contribuer](CONTRIBUTING.md)

![Agent World, capture du mode démo](docs/screenshots/agent-world-demo.png)

La capture utilise des données simulées. Les bulles et occupations sont décoratives ; les statuts proviennent des preuves Hermes. L’app ne commande pas les agents.

## Données et accès

- Pas de compte AM Labs, télémétrie produit, rapport de plantage automatique ni relais cloud.
- Sur Mac : consentement natif pour la source ; collecte dans un processus isolé, sans réseau ni écriture dans Hermes. Les noms locaux restent visibles ; les titres sont masqués.
- Sur VPS : export de profils explicitement choisis par l’administrateur ; identifiants opaques, noms génériques et titres masqués par défaut. Les alias saisis dans l’app restent sur le Mac.
- Le compte `aw-view` n’a accès qu’au snapshot publié. Sa clé dédiée ne donne ni shell, ni commande libre, ni transfert de fichiers, ni tunnel. L’app ne sait plus installer de logiciel sur le serveur.
- SSH chiffre la connexion directe. Clé privée Ed25519 chiffrée obligatoire ; Apple OpenSSH utilise le trousseau sans l’agent SSH général. L’empreinte serveur doit être vérifiée séparément.

Le processus d’export lit des bases qui peuvent aussi contenir des données privées : il demeure un composant de confiance. Un OS ou administrateur compromis dépasse ces protections. La sélection d’avatars ne définit pas les permissions du serveur. Voir le [modèle de sécurité](docs/SECURITY.md).

## Fonctionnement

Une source à la fois, 256 agents maximum et 512 cartes dans le protocole. La scène a dix places de travail et dix de repos ; les autres agents restent consultables dans Équipe. Actualisation toutes les cinq secondes, erreurs et données périmées explicites, journal en mémoire limité à cent événements. Un agent disponible peut conserver son poste 90 secondes après une activité confirmée sans falsifier son état.

## Développement sur Mac

Node.js 22+, Rust 1.98.0 et outils Xcode. Les fichiers lock sont versionnés ; SQLite est embarqué. Les tests utilisent aussi `sqlite3`.

```sh
npm ci
npm run lint
npm test
npm run test:release
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Démo navigateur : `npm run dev`, puis `http://127.0.0.1:1420/?fixture=1`. Scénarios mixte, dix actifs/en pause/sans preuve, quarante ou 256 agents, registre vide et erreur. Aucune lecture Hermes en mode démo. Ces routes sont exclues de la production.

Build : `npm run build:beta -- --bundles app`, puis `npm run package:beta`. Produit un bundle universel signé ad hoc, **non notarisé**. La compilation Intel et le minimum déclaré macOS 12.3 ne valent pas validation sur ces machines. Les parcours réellement essayés et limites sont dans le [rapport](docs/VALIDATION-0.2.0.md).

## Contributions et licence

[MIT](LICENSE), copyright © 2026 Manuel Andreolle. Utilisation, modification et redistribution, y compris commerciale, avec les mentions de licence. Les dépendances conservent leurs licences ; notices complètes et sources MPL non modifiées accompagnent la distribution. Le mainteneur atteste avoir créé les visuels pour ce projet, sans pack tiers déclaré ; aucune exclusivité n’est revendiquée sur les éléments purement générés par IA. Voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

GitHub facilite la lecture du code et la contribution ; un dépôt public ne réserve pas l’utilisation aux développeurs. Ce public est visé par la documentation et les prérequis, sans contrôle d’accès artificiel.

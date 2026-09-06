# Distribution publique gratuite

Agent World est publié sous MIT dans le dépôt [agent-world](https://github.com/AndreolleManuel/agent-world). L'app officielle est gratuite, signée ad-hoc et **non notarisée**. Aucun abonnement Apple n'est utilisé. La bêta ne prétend pas être une version stable ou auditée indépendamment.

## Pour les utilisateurs

La [release bêta Mac](https://github.com/AndreolleManuel/agent-world/releases/tag/v0.1.0-beta.1) contient le ZIP universel prêt à ouvrir et les guides. Les fichiers « Source code » ajoutés automatiquement par GitHub sont le projet à compiler, pas l'app. Suivre [INSTALLATION.md](INSTALLATION.md) et consulter [PRIVACY.md](PRIVACY.md) avant connexion.

## Préparer une nouvelle version

Après les tests, suivre [BETA-MAC.md](BETA-MAC.md) pour compiler les collecteurs et l'app. Les scripts Mac forcent une signature ad-hoc et retirent les variables d'authentification Apple ; aucune soumission de notarisation n'a lieu.

```sh
npm ci
npm run lint
npm test
npm run test:release
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path collector/Cargo.toml
node scripts/verify-notices.mjs
npm run audit:public -- --history
```

Le contrôle de publication vérifie les notices et sources MPL, l'attestation et les empreintes des visuels, puis certains motifs de secrets et chemins personnels. Il ne garantit pas l'absence exhaustive de données privées. Après une modification des dépendances, refaire l'inventaire et la revue des notices : `npm run audit:dependencies -- --check`, `npm run build:notices`.

Figer les sources dans un commit propre, préparer les collecteurs, puis compiler. Le packaging refuse une app construite à partir d'autres sources :

```sh
npm run build:beta -- --bundles app
npm run package:beta -- --public-beta
```

`--public-beta` exige un worktree propre et un audit sans blocage ; il marque l'autorisation de préparer une bêta publique, **pas la réussite des essais Linux ou une certification**. Sans cette option, le paquet reste marqué comme artefact de test. Aucun script ne pousse le code ou ne publie automatiquement une release.

Le dossier de livraison contient le ZIP, les guides liés entre eux, la licence, les notices, `BUILD-STATUS.json` et `SHA256SUMS`. Le binaire embarque les notices tierces et les sources MPL inchangées. Vérifier signature ad-hoc, architectures, fichiers embarqués et rendu natif après extraction. Associer la release à un tag du commit vérifié, joindre les fichiers, la marquer comme préversion et décrire exactement les essais réalisés.

Le workflow manuel GitHub produit des artefacts temporaires, pas une release. Sa définition ne prouve pas qu'il a été exécuté avec succès.

## Droits et provenance

`LICENSE` applique la MIT standard aux contributions originales, Copyright © 2026 Manuel Andreolle. Utilisation, modification et redistribution commerciale sont permises avec conservation des mentions applicables. Aucune clause non commerciale, interdiction de revente ou publicité obligatoire dans les forks n'est ajoutée.

Le mainteneur a confirmé le 6 septembre 2026 que les visuels ont été créés pour ce projet, sans pack tiers déclaré. L'attestation et les empreintes sont dans `docs/asset-rights.json`. Cela n'est pas une certification indépendante et ne revendique pas de droits exclusifs sur les éléments purement générés par IA. La capture README provient du mode démo, sans données Hermes réelles.

Les composants tiers conservent leurs licences. `THIRD_PARTY_NOTICES.md` indique les textes redistribués et les cinq archives sources MPL exactes. `docs/dependency-rights.json` enregistre le périmètre et l'empreinte de la revue ; la simple présence d'un identifiant SPDX ne remplace pas les notices.

## Protection des données avant un push

Le dépôt public part d'un export autorisé et d'un nouvel historique. L'ancien dépôt de développement reste privé et intact. Ne pas y copier les profils Hermes, clés, fichiers `.env`, préférences, captures privées ou rapports internes. Les binaires vont dans les Releases, pas dans l'historique source.

`npm run prepare:public` affiche la liste des fichiers autorisés. `npm run prepare:public -- --write` crée une copie séparée sous `work/`, sans Git, commit ni action réseau. Tester et auditer cette copie avant le premier push ; l'export ne constitue pas une validation automatique.

## Transparence et limites de la bêta

- Les informations de confidentialité sont visibles dans le README et le guide d'installation. Aucun compte AM Labs ni télémétrie produit ; SSH direct vers le VPS choisi. Les titres d'agents/tâches peuvent être sensibles.
- Le signalement privé des vulnérabilités GitHub est activé depuis le 6 septembre 2026 ; aucun délai contractuel ou prime n'est promis.
- La recette sur VPS réel, les essais Mac Intel et macOS minimum et la capture réseau du paquet restent à compléter. Une compilation croisée ne prouve pas le fonctionnement Linux.
- Ne jamais demander la désactivation globale de Gatekeeper. Les avertissements de malware ou d'app endommagée imposent l'arrêt de l'installation.
- AM Labs est la marque de la distribution officielle, pas une revendication de propriété exclusive de tous les composants ni une obligation de publicité dans chaque fork.

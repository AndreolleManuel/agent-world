# Contribuer à Agent World

Agent World est un projet open source sous MIT porté par [AM Labs](https://amlabs.dev). Les améliorations, retours d'expérience Hermes et vérifications des mécanismes de lecture des données sont bienvenus.

## Proposer une amélioration

Ouvrez une issue sur le dépôt officiel avant une modification importante. Expliquez le problème concret, le comportement attendu et votre environnement (versions d'Agent World, macOS et Hermes ; architecture Linux si nécessaire). Pour une correction ciblée, une pull request avec un test de régression est bienvenue.

N'incluez pas de profils Hermes réels, secrets, adresses de serveur, bases de données ou captures contenant des titres sensibles. Utilisez des fixtures inventées. Une faille de sécurité se signale en privé selon [SECURITY.md](SECURITY.md), pas dans une issue publique.

## Principes à préserver

- La supervision reste fondée sur des preuves : un gateway connecté ne signifie pas qu'un agent travaille.
- Aucune commande d'agent, écriture de tâche ou modification des réglages Hermes dans la collecte.
- Pas de télémétrie produit, d'envoi automatique de diagnostic ou de nouveau destinataire réseau sans discussion explicite et mise à jour des informations de confidentialité.
- Les accès sont bornés et les données exposées limitées à un contrat explicite ; une erreur de lecture ne doit pas devenir un faux état « disponible ».
- L'installation distante nécessite une autorisation explicite. Ne contournez pas les permissions, SSH ou les contrôles de macOS.
- Pour les changements visuels, fournissez des captures des scénarios affectés ; des tests de coordonnées seuls ne prouvent pas l'absence de collisions.

## Développer et vérifier

Depuis une copie du dépôt sur macOS, avec Node.js/npm, Rust et les outils Tauri installés :

```sh
npm ci
npm run lint
npm test
npm run test:release
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path collector/Cargo.toml
```

Le [README](README.md) explique le lancement natif et les fixtures de développement. Vérifiez séparément les parcours local et VPS touchés par votre modification. Les tests sur un Mac ne remplacent pas ceux sur Linux ; les captures simulées ne valident pas l'installation chez un utilisateur.

Ne joignez pas `node_modules`, les builds, les données Hermes ou votre configuration locale. Une pull request doit rester centrée sur son objectif et décrire les tests exécutés ainsi que ceux qui ne l'ont pas été.

## Droits et crédits

Les contributions originales au code sont proposées sous MIT, sans clause interdisant les usages commerciaux. Ne contribuez que des éléments que vous avez le droit de partager sous les conditions du projet ; signalez les composants tiers, leur licence et la provenance des images ou références utilisées avec une IA.

Une contribution n'impose aucune cession de propriété à AM Labs. Les auteurs conservent leurs droits ; les composants tiers conservent leurs licences. L'attribution du projet à AM Labs ne doit pas être présentée comme une propriété exclusive de tous les composants ou contributions.

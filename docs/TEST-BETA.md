# Recette et signalement

Utiliser de fausses données avant toute source privée. Sur Mac : `npm ci`, `npm run lint`, `npm test`, `npm run test:release`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, puis compilation et ouverture du bundle exact.

La démo `http://127.0.0.1:1420/?fixture=1` après `npm run dev` ne lit pas Hermes. Essayer 10 actifs, pause, sans preuve, 40 et 256 agents, liste vide, erreur puis reprise. Vérifier Équipe/Kanban/Journal, recherche, fermeture Échap, fenêtre 960×640, agrandissement et réduction des animations. La scène ne doit pas prétendre accueillir tous les agents simultanément : une notice renvoie vers Équipe.

Le laboratoire VPS est une **VM jetable dédiée uniquement**, avec utilisateur `lab`, clés de test et empreinte épinglée, port local 22223. `scripts/test-vps-lab.py` modifie cette VM : installation, mauvaises requêtes, accès interdits, révocation, échec de mise à jour, retour arrière et désinstallation. Il ne faut jamais adapter ce test à un VPS de production. Les tests Keychain n'utilisent qu'une identité synthétique et la retirent ensuite.

Pour un retour : version exacte, OS/architecture, étape, code d'erreur, résultat attendu et obtenu, données synthétiques permettant de reproduire. Ne pas envoyer de clé, phrase secrète, fichier `.env`, base Hermes, conversations ou snapshot privé. Pour une vulnérabilité, voir la politique `SECURITY.md` du dépôt et éviter une issue publique contenant les détails exploitables.

Une compilation ou un test unitaire ne prouve pas une installation téléchargée avec quarantaine, une compatibilité Intel/macOS minimum ou toutes les distributions Linux. Le [rapport de validation](VALIDATION-0.2.0.md) sépare ces faits.

# Agent World 0.2.1 — installation Mac

Version pour développeurs, gratuite et open source. Hermes doit déjà fonctionner. Les archives publiques 0.1.x suivent un ancien modèle de connexion : ne pas les confondre avec cette version.

## Depuis les sources

Sur Mac, installer Node.js 22+, Rust 1.98.0 et les outils Xcode. Depuis une copie examinée du dépôt :

```sh
npm ci
npm run lint
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run build:beta -- --bundles app
npm run package:beta
```

Le dossier produit contient l’app, les guides, `BUILD-STATUS.json` et `SHA256SUMS`. Le hash détecte une modification ; il n’authentifie pas à lui seul l’auteur. La distribution finale du mainteneur ajoute une signature de l’inventaire : voir [SIGNATURES.md](SIGNATURES.md). Cette bêta doit provenir de la [page Releases du dépôt officiel](https://github.com/AndreolleManuel/agent-world/releases) et annoncer explicitement 0.2.1. Les trois fichiers du canal de mise à jour intégré sont décrits dans [UPDATES.md](UPDATES.md).

## Bundle Mac

Extraire l’archive, placer Agent World.app dans votre dossier Applications personnel (`~/Applications`, à créer si nécessaire), puis ouvrir l’app. Ce dossier permet le remplacement de l’app sans droits administrateur. La build ad hoc n’est pas notarisée : Gatekeeper peut la bloquer. Ne pas désactiver Gatekeeper ni enlever globalement la quarantaine. Si le candidat est identifié et accepté, suivre l’exception individuelle décrite par [Apple](https://support.apple.com/fr-fr/102445). Une alerte « malveillant », « endommagé » ou « modifié » demande d’arrêter et vérifier le fichier.

Application pour **Mac Apple Silicon**. La version de macOS utilisée pour les essais est consignée dans [VALIDATION-0.2.1.md](VALIDATION-0.2.1.md) ; elle ne limite pas l’installation à cette seule version. Le projet vise les versions récentes de macOS sans promettre le support des anciennes versions. Le seuil technique de compilation à 12.3 ne constitue pas une garantie de compatibilité depuis cette version. Le bundle contient aussi une architecture Intel, non incluse dans le périmètre annoncé.

Mode distant : **Debian 13 ARM64 avec OpenSSH et systemd**, après préparation administrative.

La distribution non notarisée est un choix du projet. Une signature ad hoc n’apporte pas l’identité Developer ID d’une distribution notarisée ; l’exception individuelle macOS reste à expliquer et à tester sur le téléchargement exact.

## Source locale

Choisir « Sur ce Mac », détecter ou saisir la racine Hermes. Une boîte de dialogue native décrit l’accès avant collecte. L’extraction est isolée par macOS et échoue si le confinement n’est pas disponible. Choisir agents et avatars puis ouvrir le laboratoire. Les noms locaux sont affichés ; les titres restent masqués. Le frontend ne reçoit pas les bases.

## Source VPS

L’administrateur prépare d’abord le service séparé décrit dans [VPS.md](VPS.md). Dans l’app, choisir le serveur, le port, l’utilisateur imposé `aw-view` et le chemin de la nouvelle clé chiffrée dédiée. Aucun compte administrateur ni mot de passe de VPS ne doit être saisi dans l’app. Une confirmation native valide la source ; les alias « Nom sur ce Mac » ne modifient pas le serveur.

## Migration, mise à jour, retrait

La version 0.2.1 vérifie les mises à jour à l’ouverture, puis toutes les 24 heures tant que l’app reste ouverte. **Nouvelle version · …** apparaît en bas du laboratoire uniquement lorsqu’une version est disponible. Le bouton affiche les notes, puis propose l’installation après confirmation native et le redémarrage. Pour une recherche manuelle ou pour désactiver **Vérifier automatiquement**, ouvrir **Configurer mes agents → Vérifier les mises à jour** ; il n’est pas nécessaire de modifier les agents. Aucun téléchargement du programme n’est automatique. Voir le canal signé, les limites et la restauration dans [UPDATES.md](UPDATES.md). Les anciens téléchargements sans ce mécanisme nécessitent encore un remplacement manuel.

Pour une mise à jour manuelle du Mac :

1. Lire les notes de version et les éventuelles consignes de migration.
2. Télécharger l’archive du mainteneur et vérifier sa signature selon [SIGNATURES.md](SIGNATURES.md).
3. Fermer complètement Agent World, puis remplacer l’application dans son dossier Applications personnel.
4. Relancer et vérifier les agents, la source sélectionnée et la fraîcheur de la lecture.

Les réglages sont stockés séparément de l’application et conservés lors de son remplacement. Une nouvelle version de l’app ne met pas à jour les composants VPS : l’administrateur suit la procédure et les sauvegardes de [VPS.md](VPS.md) si les notes de version le demandent. Conserver l’ancienne archive et une sauvegarde privée des réglages avant une migration ; ne pas présumer qu’une ancienne app saura relire des réglages migrés.

Les préférences 0.1.x sont copiées dans `hermes-source.pre-v2.json` avant migration des identifiants, sélections et avatars. Les connexions générales anciennes restent à reconfigurer et ne se reconnectent pas automatiquement. En cas de configuration corrompue, la récupération archive le fichier après confirmation native ; elle ne supprime aucune donnée Hermes.

Fermer l’app avant de la remplacer. Mettre l’app à la corbeille ne révoque pas la clé VPS. Révoquer côté serveur selon [VPS.md](VPS.md), puis retirer uniquement la clé dédiée et son entrée de trousseau si souhaité. Les préférences sont dans le dossier de configuration de l’app (`com.amlabs.pixelops` sous `~/Library/Application Support`). Ne jamais effacer Hermes pour désinstaller Agent World.

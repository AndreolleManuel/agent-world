# Agent World 0.2.0 — installation Mac

Candidat pour développeurs, gratuit et open source. Hermes doit déjà fonctionner. Les archives publiques 0.1.x suivent un ancien modèle de connexion : ne pas les confondre avec ce candidat.

## Depuis les sources

Sur Mac, installer Node.js 22+, Rust 1.98.0 et les outils Xcode. Depuis une copie examinée du dépôt :

```sh
npm ci
npm run lint
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:beta -- --bundles app
npm run package:beta
```

Le dossier produit contient l’app, les guides, `BUILD-STATUS.json` et `SHA256SUMS`. Le hash détecte une modification ; il n’authentifie pas à lui seul l’auteur. La distribution finale du mainteneur ajoute une signature de l’inventaire : voir [SIGNATURES.md](SIGNATURES.md). Une bêta publique doit provenir de la [page Releases du dépôt officiel](https://github.com/AndreolleManuel/agent-world/releases) et annoncer explicitement 0.2.0. Aucun lien vers un fichier inexistant n’est fourni.

## Bundle Mac

Extraire l’archive, placer Agent World.app dans Applications, puis ouvrir l’app. La build ad hoc n’est pas notarisée : Gatekeeper peut la bloquer. Ne pas désactiver Gatekeeper ni enlever globalement la quarantaine. Si le candidat est identifié et accepté, suivre l’exception individuelle décrite par [Apple](https://support.apple.com/fr-fr/102445). Une alerte « malveillant », « endommagé » ou « modifié » demande d’arrêter et vérifier le fichier.

Application pour **Mac Apple Silicon**. La version de macOS utilisée pour les essais est consignée dans [VALIDATION-0.2.0.md](VALIDATION-0.2.0.md) ; elle ne limite pas l’installation à cette seule version. Le projet vise les versions récentes de macOS sans promettre le support des anciennes versions. Le seuil technique de compilation à 12.3 ne constitue pas une garantie de compatibilité depuis cette version. Le bundle contient aussi une architecture Intel, non incluse dans le périmètre annoncé.

Mode distant : **Debian 13 ARM64 avec OpenSSH et systemd**, après préparation administrative.

La distribution non notarisée est un choix du projet. Une signature ad hoc n’apporte pas l’identité Developer ID d’une distribution notarisée ; l’exception individuelle macOS reste à expliquer et à tester sur le téléchargement exact.

## Source locale

Choisir « Sur ce Mac », détecter ou saisir la racine Hermes. Une boîte de dialogue native décrit l’accès avant collecte. L’extraction est isolée par macOS et échoue si le confinement n’est pas disponible. Choisir agents et avatars puis ouvrir le laboratoire. Les noms locaux sont affichés ; les titres restent masqués. Le frontend ne reçoit pas les bases.

## Source VPS

L’administrateur prépare d’abord le service séparé décrit dans [VPS.md](VPS.md). Dans l’app, choisir le serveur, le port, l’utilisateur imposé `aw-view` et le chemin de la nouvelle clé chiffrée dédiée. Aucun compte administrateur ni mot de passe de VPS ne doit être saisi dans l’app. Une confirmation native valide la source ; les alias « Nom sur ce Mac » ne modifient pas le serveur.

## Migration, mise à jour, retrait

Les préférences 0.1.x sont copiées dans `hermes-source.pre-v2.json` avant migration des identifiants, sélections et avatars. Les connexions générales anciennes restent à reconfigurer et ne se reconnectent pas automatiquement. En cas de configuration corrompue, la récupération archive le fichier après confirmation native ; elle ne supprime aucune donnée Hermes.

Fermer l’app avant de la remplacer. Mettre l’app à la corbeille ne révoque pas la clé VPS. Révoquer côté serveur selon [VPS.md](VPS.md), puis retirer uniquement la clé dédiée et son entrée de trousseau si souhaité. Les préférences sont dans le dossier de configuration de l’app (`com.amlabs.pixelops` sous `~/Library/Application Support`). Ne jamais effacer Hermes pour désinstaller Agent World.

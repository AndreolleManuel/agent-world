# Mises à jour depuis l’app

Le bouton **Nouvelle version** apparaît en bas du laboratoire uniquement lorsqu’une mise à jour est disponible. La configuration garde un bouton **Vérifier les mises à jour** pour lancer une recherche manuelle. L’installation demande une confirmation native. La vérification automatique est activée par défaut : à l’ouverture, puis toutes les 24 heures tant que l’app reste ouverte. Une recherche manuelle reporte la prochaine vérification automatique de 24 heures. Après une mise en veille, l’app vérifie à son retour si ce délai est dépassé, sans multiplier les requêtes. L’option **Vérifier automatiquement** désactive aussi bien la recherche au lancement que les recherches quotidiennes. Il n’y a ni téléchargement automatique du programme ni installation silencieuse. Une app compilée sans clé affiche explicitement que cette fonction n’est pas activée.

Le canal suit la dernière release GitHub ordinaire du dépôt `AndreolleManuel/agent-world`. Un commit, un tag seul, un brouillon ou une prerelease ne déclenchent pas de mise à jour. Le mot « bêta » dans la présentation du projet reste possible, mais une release marquée « pre-release » par GitHub n’alimente pas ce canal.

Les anciens téléchargements sans ce bouton demandent un dernier remplacement manuel de l’app pour recevoir cette fonction. Une archive déjà signée n’est jamais modifiée sur place. La première version équipée doit contenir la clé publique définitive avant d’être distribuée.

## Confidentialité et installation

Les seules connexions de mise à jour sont des requêtes HTTPS vers les assets de la release officielle GitHub et son CDN `release-assets.githubusercontent.com`. GitHub reçoit notamment l’adresse IP et l’agent HTTP générique `Agent-World-Updater`. Aucun snapshot, nom d’agent, identifiant utilisateur, chemin, clé SSH ou renseignement sur le VPS n’accompagne ces requêtes. Les cookies, identifiants GitHub et proxies automatiques du système ne sont pas utilisés. Aucun script distant n’est exécuté. Voir [PRIVACY.md](PRIVACY.md).

La clé publique embarquée vérifie la signature Ed25519/minisign de `latest.json` **avant** de lire son contenu. Ce manifeste signé lie version, notes, URL, taille et empreinte SHA-256 de l’archive. Le paquet est contrôlé contre cette empreinte avant extraction ; son identité, sa version et son intégrité de bundle sont ensuite vérifiées. La clé privée reste chez le mainteneur. Les utilisateurs n’ont aucune clé à créer ou à saisir. Cette signature est distincte de la signature OpenSSH des paquets serveur et de la notarisation Apple ; aucun abonnement Apple n’est requis.

Les téléchargements sont bornés (manifeste 32 Kio, signature 2 Kio, archive 256 Mio ; extraction 768 Mio et 10 000 entrées). Les chemins sortant du bundle, liens symboliques, liens physiques et fichiers spéciaux sont refusés. L’IPC n’accepte ni URL, ni chemin d’installation, ni clé fournie par l’interface. Une seule opération peut s’exécuter à la fois, avec un délai minimal de 30 secondes entre vérifications.

Installez une copie de l’app dans un dossier dont vous êtes propriétaire, idéalement `~/Applications`. La mise à jour ne réclame pas de droits administrateur et refuse une app encore sur un DMG ou déplacée par Gatekeeper (App Translocation). En cas de refus, fermer l’app, la copier dans ce dossier, puis relancer. Les protections Gatekeeper de la première ouverture restent applicables à cette app non notarisée.

Le remplacement prépare et vérifie la nouvelle app dans le même dossier/volume. L’ancienne app est sauvegardée dans `.agent-world-backup-…/Agent World.app` à côté de celle-ci. Un échec du second renommage déclenche une restauration. En cas d’erreur de restauration, la sauvegarde est conservée et l’app signale le problème. Ces dossiers de sauvegarde peuvent être supprimés manuellement une fois la nouvelle version validée (Finder : Cmd + Maj + point pour les afficher). Prévoir l’espace pour le téléchargement, l’app extraite et l’ancienne app.

Seule Agent World redémarre. Ses préférences, les données Hermes et les composants VPS ne sont ni remplacés ni migrés par ce mécanisme. Les évolutions du protocole serveur doivent rester compatibles ou être accompagnées d’une procédure distincte dans [VPS.md](VPS.md).

## Préparer la clé (une seule fois)

Dans un Terminal personnel, à la racine du dépôt :

```sh
python3 scripts/updater-signing.py init
```

Choisir une phrase secrète non vide. Le script crée la clé privée chiffrée dans `~/.config/agent-world/update-signing.key` (0600), hors du dépôt, et copie uniquement la clé publique dans `docs/agent-world-updater.pub`. Il refuse de remplacer une clé existante ou une clé publique de publication déjà installée. Sauvegarder **la clé privée et sa phrase secrète** dans des emplacements privés. Ne jamais les coller dans un chat, une issue, Git ou un workflow. Ne pas ajouter cette clé aux accès SSH.

La perte de cette clé empêche de signer les prochaines mises à jour pour les installations existantes. Une rotation doit passer par une version encore signée avec l’ancienne clé, embarquant la suivante. Si la clé est perdue ou compromise, arrêter le canal et fournir une nouvelle installation manuelle vérifiée indépendamment. Ne pas remplacer discrètement la clé publique dans Git.

## Publier une nouvelle version

1. Faire évoluer ensemble `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, son lockfile et `src-tauri/tauri.conf.json`. Utiliser une version numérique strictement supérieure. Tester les changements, les migrations éventuelles et les notices.
2. Compiler depuis les sources publiques exactes et propres avec `npm run build:mac -- --bundles app`, puis préparer le téléchargement manuel selon [PUBLICATION.md](PUBLICATION.md). Le build de distribution refuse une clé manquante. `--test-build` permet une compilation de vérification non destinée à la publication ; les workflows restent sans secrets et sans publication automatique.
3. Écrire des notes courtes dans un fichier texte, puis préparer le candidat :

```sh
npm run package:update -- "/chemin/Agent World.app" /chemin/notes.txt
python3 scripts/updater-signing.py sign /chemin/du/candidat/latest.json
cargo run --locked --manifest-path src-tauri/Cargo.toml --example verify-update -- docs/agent-world-updater.pub /chemin/du/candidat
```

4. Dans une release GitHub **en brouillon** portant le tag `vVERSION`, joindre `Agent-World-VERSION-mac-universal.app.tar.gz`, `latest.json` et `latest.json.sig`, en plus du téléchargement manuel et de ses documents/signatures. Vérifier la correspondance version/tag/fichiers ; conserver les releases précédentes.
5. Publier la release ordinaire et la désigner comme dernière version après validation du mainteneur. Vérifier immédiatement le téléchargement HTTPS public du manifeste, de sa signature et de l’archive, puis faire un essai depuis la version précédente sur une copie de test.

Ne pas publier un manifeste signé pointant vers un paquet absent. Ne pas réutiliser un numéro de version pour un autre binaire. Pour revenir sur une mauvaise version, publier un correctif avec un numéro supérieur : les retours automatiques à un numéro inférieur sont refusés. La publication d’une release sans les trois fichiers de mise à jour rend la vérification temporairement indisponible, sans bloquer le laboratoire.

## Vérification en développement

Le mode `?fixture=1` propose les scénarios « Nouvelle version », « À jour », « Hors ligne » et « Signature invalide ». Ce sont des simulations sans téléchargement ni installation. Les tests Rust couvrent séparément la signature réelle, les bornes, les URLs, l’extraction, le remplacement et la restauration. Une recette locale sur un paquet signé ne prouve pas le parcours GitHub public ni la compatibilité sur un autre Mac ; ces essais sont à consigner lors de la première publication.

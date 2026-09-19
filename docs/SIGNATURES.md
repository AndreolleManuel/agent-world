# Vérifier les fichiers d’Agent World

La signature OpenSSH du mainteneur authentifie les empreintes des fichiers distribués. Elle ne remplace pas la notarisation Apple et ne certifie pas l’absence de bugs. Les fichiers restent lisibles : la signature ne chiffre pas leur contenu.

## Identité de référence

Clé publique Ed25519 : [agent-world-release.pub](agent-world-release.pub). Empreinte :

```text
SHA256:t34tkGmMwyKjy1b8j7kBDDYbR8LkJ1eCNPdlJjMxQ5Q
```

Le signataire est `am-labs`. La [liste des signataires](allowed-signers) autorise cette seule clé pour les namespaces `agent-world-release` et `agent-world-server`. La clé privée demeure sur le Mac du mainteneur, protégée par une phrase secrète ; elle n’est jamais nécessaire aux utilisateurs et ne fait pas partie des téléchargements.

Obtenir la clé ou confirmer son empreinte depuis une référence de confiance indépendante du paquet reçu, par exemple la page HTTPS du projet, puis conserver cette référence pour les mises à jour. Accepter une nouvelle clé simplement parce qu’elle accompagne une archive ne permet pas d’authentifier cette archive. Un changement de clé demande une annonce et une vérification distinctes.

## Avant d’ouvrir ou d’installer un téléchargement

La version signée comprend `SHA256SUMS`, `SHA256SUMS.sig`, la clé publique et `allowed-signers`. Après vérification de l’identité ci-dessus, depuis le dossier téléchargé :

```sh
ssh-keygen -lf agent-world-release.pub
ssh-keygen -Y verify -f allowed-signers -I am-labs -n agent-world-release -s SHA256SUMS.sig < SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

La première commande affiche l’empreinte de la clé fournie. La deuxième doit retourner un succès avec **la même empreinte de référence** : une liste de signataires remplacée par une autre ne doit pas être acceptée. La troisième vérifie les fichiers effectifs. Sous Debian, `sha256sum -c SHA256SUMS` remplace la dernière commande. Arrêter si une signature ou un hash ne correspond pas. Les fichiers déclarés dans l’inventaire doivent tous être présents ; seuls ces fichiers sont couverts.

Les archives Mac et sources ainsi que les binaires, scripts administratifs et guides du paquet sont couverts par cet inventaire. Vérifier avant extraction et avant d’exécuter un script, surtout avec `sudo`. Utiliser les outils OpenSSH et SHA-256 déjà installés et de confiance, pas un vérificateur téléchargé dans le paquet à contrôler.

## Installation des programmes VPS précompilés

Après validation de l’inventaire complet, vérifier aussi le manifeste serveur :

```sh
ssh-keygen -Y verify -f allowed-signers -I am-labs -n agent-world-server -s server-manifest.json.sig < server-manifest.json
```

Le manifeste contient le protocole 2, l’architecture `aarch64` et les empreintes des programmes `agent-world-collector` et `agent-world-reader`. Pour l’installation administrative de [VPS.md](VPS.md), remplacer `--reviewed-source-build` par :

```text
--manifest /CHEMIN/ABSOLU/server-manifest.json
--signature /CHEMIN/ABSOLU/server-manifest.json.sig
--allowed-signers /CHEMIN/ABSOLU/allowed-signers
--signer am-labs
```

Conserver les arguments de chemins et hashes des deux programmes. L’installateur répète ces contrôles, mais cela ne dispense pas de vérifier les scripts avant de les exécuter. Compiler soi-même des sources examinées reste possible sans utiliser les binaires précompilés.

## Mainteneur : signer une nouvelle version

La clé de référence existe déjà. Ne pas la recréer à chaque version. Préparer et contrôler tous les fichiers dans un nouveau dossier, y compris le manifeste serveur, puis lancer depuis les sources examinées :

```sh
sh scripts/sign-release.sh /CHEMIN/ABSOLU/PAQUET "$HOME/.ssh/agent-world-release"
```

Le script refuse une clé sans phrase secrète, une clé publique différente, un manifeste incohérent et le remplacement de signatures existantes. Il demande la phrase secrète directement dans Terminal, charge seulement cette clé dans un agent temporaire isolé pendant cinq minutes au maximum, signe le manifeste serveur, calcule l’inventaire complet, signe cet inventaire et vérifie le résultat. L’agent est arrêté en fin d’exécution. Aucun envoi réseau ni publication n’est effectué.

Conserver la phrase secrète dans un gestionnaire de mots de passe et une sauvegarde chiffrée de la clé privée séparément du dépôt. La phrase secrète seule ne remplace pas le fichier privé. Après perte ou compromission, arrêter les signatures et annoncer une nouvelle identité par un canal de confiance.

Référence : [signature et vérification avec OpenSSH](https://man.openbsd.org/ssh-keygen).

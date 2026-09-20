<p align="center">
  <img src="src-tauri/icons/agent-world.svg" width="76" height="76" alt="Icône Agent World">
</p>

<h1 align="center">Agent World</h1>

<p align="center">
  Vos agents Hermes dans un laboratoire en pixel art.<br>
  Un aperçu de leur activité, avec des bureaux, un coin café et quelques bulles de pensée.
</p>

<p align="center"><strong>Mac Apple Silicon · Lecture seule · Gratuit et open source</strong></p>

<p align="center">
  <a href="https://github.com/AndreolleManuel/agent-world/releases/latest">Télécharger</a> ·
  <a href="#installer-sur-mac">Installation</a> ·
  <a href="docs/VPS.md">Configuration VPS</a> ·
  <a href="#mises-à-jour">Mises à jour</a> ·
  <a href="#essayer-la-démo-et-développer">Démo et sources</a>
</p>

![Le laboratoire Agent World : agents, bureaux, salle de repos et tableau Kanban](docs/screenshots/agent-world-demo.png)

<p align="center"><sub>Capture du mode démo. Les animations et les bulles sont décoratives ; les états affichés reposent sur l’activité remontée par Hermes.</sub></p>

## À quoi ça sert ?

Agent World est une app Mac qui donne une vue d’ensemble d’une installation **Hermes existante**, sur votre Mac ou sur un VPS préparé avec le guide du projet.

- **Équipe** : agents, avatars, activité confirmée, blocages et demandes de revue.
- **Kanban** : tâches en cours et cartes à suivre.
- **État de la connexion** : fraîcheur des données et erreurs de lecture visibles.

L’app observe Hermes en lecture seule. Elle ne lance pas d’agents, ne leur envoie pas d’instructions et n’exécute pas leurs tâches. Si l’équipe dépasse la capacité de la scène, tous les agents restent consultables dans le panneau Équipe.

## Installer sur Mac

**Version publiée : [0.2.1](https://github.com/AndreolleManuel/agent-world/releases/tag/v0.2.1)**, destinée aux développeurs utilisant Hermes sur **Mac Apple Silicon**.

1. Télécharger **[Agent-World-0.2.1-mac-universal-UNNOTARIZED.zip](https://github.com/AndreolleManuel/agent-world/releases/download/v0.2.1/Agent-World-0.2.1-mac-universal-UNNOTARIZED.zip)**. C’est l’archive de l’application Mac ; les autres fichiers de la release servent aux vérifications, aux sources et à l’installation VPS.
2. Vérifier l’archive avec le [guide des signatures](docs/SIGNATURES.md), puis l’extraire.
3. Placer **Agent World.app** dans votre dossier Applications personnel, **`~/Applications`** (à créer si nécessaire), puis l’ouvrir. Ce dossier permet les mises à jour sans droits administrateur.
4. Choisir où tournent vos agents, suivre les indications ci-dessous, puis ouvrir le laboratoire.

> [!NOTE]
> L’app est **non notarisée** : macOS peut demander une autorisation à la première ouverture. Suivre le [guide d’installation](docs/INSTALLATION.md), sans désactiver Gatekeeper globalement.

### Vos agents tournent sur ce Mac

Hermes doit déjà fonctionner. Dans Agent World, choisir **Sur ce Mac**, lancer **Détecter**, puis autoriser la lecture dans la confirmation native. Sélectionner les agents et leurs avatars, puis cliquer sur **Ouvrir mon laboratoire**.

### Vos agents tournent sur un VPS

**Configuration VPS disponible : [suivre le guide](docs/VPS.md).** Il explique la préparation du serveur, la création d’une clé SSH dédiée et la connexion depuis l’app. Cette préparation se fait une fois, avant de choisir **Sur un VPS** dans Agent World.

L’installation serveur a été validée sur **Debian 13 ARM64 avec OpenSSH et systemd**. Utiliser le compte de consultation dédié prévu par le guide ; ne pas fournir de clé SSH administrateur ou root à l’app. Pour un autre environnement, indiquer sa configuration dans vos [retours](https://github.com/AndreolleManuel/agent-world/issues).

Les versions récentes de macOS sont visées ; le système exact utilisé pour les essais figure dans le [rapport de validation](docs/VALIDATION-0.2.1.md). L’archive contient aussi un binaire Intel, mais aucune recette de l’interface sur Mac Intel n’est annoncée.

## Mises à jour

La version 0.2.1 intègre les mises à jour depuis GitHub :

1. L’app vérifie les nouvelles versions **à l’ouverture, puis toutes les 24 heures tant qu’elle reste ouverte**.
2. Si une mise à jour existe, **Nouvelle version · …** apparaît en bas du laboratoire. Sinon, aucun bouton de notification n’encombre la scène.
3. Cliquer dessus pour lire les notes, puis sur **Installer et redémarrer**. Le paquet est vérifié avant installation et une confirmation native est demandée.
4. Les réglages et la sélection des agents sont conservés. L’ancienne app est sauvegardée avant son remplacement.

**Aucune reconfiguration des agents n’est nécessaire.** Pour une recherche manuelle : **Configurer mes agents → Vérifier les mises à jour**. Cette fenêtre permet aussi de désactiver **Vérifier automatiquement**. Aucun programme n’est téléchargé ou installé automatiquement.

La signature des nouvelles versions est faite par le mainteneur ; l’app la vérifie avec sa clé publique intégrée. **Les utilisateurs n’ont aucune clé de signature à créer ni mot de passe de signature à saisir.**

Les anciennes versions sans ce mécanisme demandent un dernier remplacement manuel. Les archives 0.1.x ne contiennent pas les protections actuelles et utilisent un ancien modèle de connexion VPS. Les composants VPS se mettent à jour séparément, selon leur guide.

[Fonctionnement, publication et restauration des mises à jour](docs/UPDATES.md). Un simple commit GitHub ne déclenche pas de notification : une nouvelle release avec son paquet signé est nécessaire.

## Données et sécurité

Pas de compte AM Labs, de télémétrie produit ni de relais cloud pour les données Hermes.

**Sur le Mac**, la lecture passe par un processus isolé, sans accès réseau ni écriture dans Hermes. **Sur VPS**, un export limité expose les informations des profils choisis par l’administrateur, avec noms et titres masqués par défaut. La consultation utilise une connexion SSH chiffrée et un compte restreint, sans shell libre, transfert de fichiers ou tunnel.

**Les vérifications de mises à jour contactent GitHub**, qui voit notamment votre adresse IP. Elles n’envoient aucune donnée Hermes, clé SSH ou information sur votre VPS. L’exporteur serveur reste un composant de confiance ; ces protections ne garantissent pas la sécurité d’une machine déjà compromise.

[Confidentialité](docs/PRIVACY.md) · [Modèle de sécurité](docs/SECURITY.md) · [Vérification des téléchargements](docs/SIGNATURES.md)

## Essayer la démo et développer

Avec **Node.js 22 ou plus récent** :

```sh
git clone https://github.com/AndreolleManuel/agent-world.git
cd agent-world
npm ci
npm run dev
```

Ouvrir **http://127.0.0.1:1420/?fixture=1**. Cette démo utilise uniquement des données fictives : aucune installation Hermes ni connexion VPS n’est nécessaire. Elle propose plusieurs états d’agents, des erreurs simulées et des scénarios de mise à jour. Elle est réservée au développement et n’est pas embarquée dans l’app distribuée.

Pour lancer l’app native sur Mac, installer aussi **Rust 1.98.0** et les **outils Xcode**, puis exécuter :

```sh
npm run tauri dev
```

<details>
<summary><strong>Compiler une archive Mac depuis les sources</strong></summary>

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run build:beta -- --bundles app
npm run package:beta
```

Le dossier `release/beta-…` contient l’archive locale et les documents associés. Cette compilation ne publie rien sur GitHub. Les signatures officielles des téléchargements sont ajoutées séparément par le mainteneur.

</details>

Les commandes de test et les règles de contribution sont dans **[CONTRIBUTING.md](CONTRIBUTING.md)**. Les tests natifs nécessitent aussi `sqlite3`.

## Un bug ou une idée ?

[Ouvrir une issue](https://github.com/AndreolleManuel/agent-world/issues) avec la version de l’app, le système utilisé, les étapes et le résultat attendu. Pour un souci VPS, préciser aussi la distribution et l’architecture du serveur. Utiliser des données fictives ; ne pas joindre de clé privée, mot de passe, conversation ou base Hermes.

Pour une vulnérabilité, suivre le [signalement privé](SECURITY.md). [Guide de test et de retour](docs/TEST-BETA.md).

---

Créé par **[AM Labs](https://amlabs.dev)** · Licence **[MIT](LICENSE)** · [Notices et droits des visuels](THIRD_PARTY_NOTICES.md)

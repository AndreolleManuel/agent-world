# Modèle de sécurité — Agent World 0.2.0

Objectif : limiter l’accès d’un viewer compromis aux métadonnées publiées. Ce n’est pas une certification d’inviolabilité.

## Frontières

1. **Interface considérée hostile.** Huit commandes IPC explicitement permises ; ni shell, ni HTTP, ni filesystem générique dans les capacités Tauri. Nouvelle source soumise à une confirmation native ; approbation associée à la source. Une seule opération de collecte à la fois, sans file illimitée. WebView limitée à l’origine de l’app, nouvelles fenêtres refusées, CSP locale.
2. **Collecte locale séparée.** Helper court dans `sandbox-exec` : lecture bornée de fichiers autorisés de la racine choisie, aucune écriture Hermes, pas de connexion/écoute réseau ni création de processus. Si le mécanisme manque, échec sans repli permissif. Le système Apple utilisé doit être testé après mise à jour.
3. **VPS séparé.** Exporteur systemd non-root, montage lecture seule, espace minimal, sans réseau, CPU/mémoire/temps limités. Lecteur sans SQLite dans un chroot distinct. Seccomp avec liste d’appels système autorisés après ouverture du snapshot ; limites mémoire/CPU/processus ; verrou de lecture. L’exporteur et root restent de confiance.
4. **SSH.** Compte/clé dédiés, commande exacte `snapshot`, pas de shell libre ou transfert, forwarding désactivé côté serveur, empreinte obligatoire côté client. Pas d’agent SSH général, clé privée chiffrée et permissions privées. L’application ne contient plus d’installateur distant.
5. **Payload hostile.** Contrat versionné partagé, taille/profondeur/cardinalités/dates/textes/relations contrôlés avant rendu. Identifiants opaques, objets sans prototype et accès propres. Un snapshot rejoué ne retrouve pas une date fraîche. Voir [PROTOCOL.md](PROTOCOL.md).
6. **Fichiers.** Lectures sans suivi de symlink, refus de hardlinks pour les entrées de données, budgets de découverte et de SQLite. Refus d’un registre inaccessible ou ambigu. Sauvegarde avant migration, écriture atomique des préférences et snapshots ; erreurs fermées sans contenu brut.

## Hypothèses et risques résiduels

Les bases SQLite et `profile.yaml` peuvent contenir des données privées au-delà des champs extraits. Le helper/exporteur doit être fiable ; il n’est pas possible de rendre une colonne privée inaccessible par permissions quand elle partage le même fichier. Le montage Hermes complet de l’exporteur Linux n’est pas une liste exhaustive des fichiers secrets personnalisés.

La sandbox locale filtre des chemins et le lecteur rejette les liens multiples détectés ; un attaquant déjà capable de modifier continuellement l’arborescence Hermes ou le compte OS demeure hors d’une garantie absolue contre toutes les courses de fichiers. Aucun secret système ne doit être placé dans les fichiers de métadonnées autorisés. L’app principale et OpenSSH appartiennent au même utilisateur macOS : ce n’est pas un sandbox global de tout le compte.

Un attaquant détenant la clé peut lire le snapshot autorisé et solliciter SSH. Le lecteur limite sa propre concurrence et son débit ; cela ne remplace pas les limites SSH globales et la protection anti-déni de service du serveur. Un serveur compromis peut inventer des états. L’application exige un compte restreint mais ne peut prouver la bonne configuration d’un VPS hostile.

La sélection visuelle n’est pas un contrôle d’accès ; seuls les profils publiés dans la politique serveur le sont. Une clé choisie manuellement pourrait avoir été réutilisée ailleurs : créer une nouvelle identité dédiée, ne pas réutiliser une clé générale.

## Distribution

Les lockfiles et actions CI sont épinglés ; PR sans secrets de publication. Audit de dépendances, scan des sources/historique public et notices vérifiées font partie des contrôles. Les scans par motifs ne prouvent pas l’absence de tout secret. SHA-256 vérifie l’intégrité, une signature vérifie la provenance sous réserve d’une clé de confiance indépendante.

Le candidat Mac est signé ad hoc et non notarisé. Developer ID, recette macOS minimum/Intel, signature officielle du paquet serveur et publication restent des conditions séparées ; aucune validation CI distante n’est déduite de la seule présence d’un workflow. Voir [VALIDATION-0.2.0.md](VALIDATION-0.2.0.md).

Références de conception : [OpenSSH sshd_config](https://man.openbsd.org/sshd_config), [Tauri capabilities](https://tauri.app/security/capabilities/), [Apple OpenSSH](https://github.com/apple-oss-distributions/OpenSSH), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).

Une base WAL proprement fermée, sans aucun fichier auxiliaire, est lue depuis une image privée en mémoire (32 Mio maximum). Inode, taille, dates de modification/changement et absence des auxiliaires sont contrôlés avant et après ; toute modification observée rejette la lecture. Le fichier source est inchangé. Un WAL actif suit le lecteur et les verrous SQLite habituels, jamais `immutable=1`. Cette copie peut contenir temporairement le fichier complet dans le helper, mais seuls les champs autorisés sortent. Référence : [SQLite deserialize](https://www.sqlite.org/c3ref/deserialize.html).

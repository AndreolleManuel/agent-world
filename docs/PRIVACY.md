# Données et confidentialité — protocole 2

Aucun envoi automatique vers AM Labs, compte cloud, suivi d’usage ou rapport de plantage intégré. Le lien AM Labs est une navigation volontaire ; le site a sa propre politique. Aucun serveur HTTP public n’est nécessaire.

## Trajet des données

Sur VPS : fichiers Hermes → exporteur isolé administré sur le serveur → snapshot minimal → lecteur `aw-view` → canal SSH direct → validation Rust sur le Mac → interface. La requête contient uniquement la version de protocole. Elle ne contient ni SQL, ni chemin, ni nom de tâche. Sur Mac, un helper isolé lit la racine approuvée puis transmet le même format minimal à l’app.

Le compte lecteur n’a pas accès aux bases Hermes. L’exporteur a techniquement accès aux fichiers SQLite autorisés, qui peuvent aussi contenir des conversations. Ses requêtes n’en extraient que les preuves d’activité. Le confinement n’est pas une anonymisation de ces fichiers ; l’exporteur reste un composant de confiance.

## Ce qui est publié

Par défaut distant : identifiants opaques salés par source, phases, états, dates, âge, compteurs, codes d’erreur fermés, noms « Agent N » et titres génériques. Seuls les profils explicitement publiés et les cartes qui leur sont assignées sortent. Les cartes sans assignation sont exclues. Pas de corps de conversation, chemin distant, hostname, commande, clé API, motif libre ou titre original dans cet export.

L’administrateur peut activer séparément `disclose_names` et `disclose_titles` dans sa politique locale. Le client ne peut pas changer ces choix. Un titre ou nom autorisé peut contenir une donnée sensible : les limites de longueur ne la rendent pas publique sans risque. Localement, le consentement annonce l’affichage des noms ; les titres restent masqués.

L’app garde les alias locaux, avatars, sélection, adresse/port/utilisateur, chemin de clé et racine locale dans ses préférences privées. Elle ne stocke pas la phrase secrète ; Apple OpenSSH et le trousseau la gèrent. Les snapshots et le journal de cent événements restent en mémoire dans l’app. Sur le VPS, un snapshot courant est écrit atomiquement ; les sauvegardes d’installation conservent configuration, politique et clé publique sous root, sans copier les bases Hermes.

## Limites et suppression

Les métadonnées révèlent déjà des horaires et de l’activité. Une clé volée peut lire les données publiées jusqu’à révocation. Un serveur compromis peut mentir sur ses états ; SSH authentifie une connexion, pas la vérité des statuts. Les outils de capture et sauvegardes du système restent sous le contrôle de l’utilisateur.

Déconnexion de l’app, retrait de ses préférences et révocation serveur sont distincts. Voir [VPS.md](VPS.md). Aucun diagnostic automatique à partager : pour un incident, transmettre version, OS, code d’erreur et reproduction synthétique selon [TEST-BETA.md](TEST-BETA.md), jamais base Hermes, clé ou snapshot privé.

Une base WAL proprement fermée, sans aucun fichier auxiliaire, est lue depuis une image privée en mémoire (32 Mio maximum). Inode, taille, dates de modification/changement et absence des auxiliaires sont contrôlés avant et après ; toute modification observée rejette la lecture. Le fichier source est inchangé. Un WAL actif suit le lecteur et les verrous SQLite habituels, jamais `immutable=1`. Cette copie peut contenir temporairement le fichier complet dans le helper, mais seuls les champs autorisés sortent. Référence : [SQLite deserialize](https://www.sqlite.org/c3ref/deserialize.html).

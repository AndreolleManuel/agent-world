# Fiche de test — Agent World sur Mac et VPS

Cette bêta observe Hermes, elle ne lui envoie pas de tâches. Faire le premier essai sur une installation de test ou non critique. Aucun identifiant, mot de passe, clé privée ou contenu de conversation à transmettre à AM Labs.

## Avant de commencer

- App universelle Intel/Apple Silicon ; macOS 12.3+ visé. Signaler le modèle du Mac et la version de macOS. La compatibilité minimum reste à valider.
- Hermes déjà installé sur le VPS, avec un compte utilisateur non root et un accès SSH par clé.
- Vérifier l'empreinte SSH auprès de l'hébergeur avant la première connexion. Déverrouiller une clé protégée dans l'agent SSH du Mac.
- Docker, bastions et accès par mot de passe : nous prévenir avant l'essai, ils ne sont pas automatisés dans cette bêta.
- La distribution est signée ad-hoc, pas notarisée : aucun abonnement Apple prévu. Suivre [INSTALLATION.md](INSTALLATION.md) pour la première ouverture. Si vous ne souhaitez pas autoriser cette seule app de confiance, ne pas poursuivre ; ne jamais désactiver globalement les protections macOS.

## Installation et premier lancement

1. Suivre le guide [INSTALLATION.md](INSTALLATION.md) depuis le fichier téléchargé, protections macOS actives. Noter si l'ouverture a nécessité l'exception prévue par Apple.
2. Choisir **Sur un VPS** et renseigner sa connexion SSH. La distribution Linux et l'architecture sont détectées automatiquement.
3. Cliquer **Vérifier mon serveur**. Aucun fichier n'est installé à cette étape.
4. Si l'installation est proposée, lire sa portée, cocher l'autorisation et cliquer **Installer le collecteur sur mon VPS**. Laisser l'app ouverte jusqu'au résultat.
5. Cliquer **Tester le VPS**, vérifier les agents détectés, choisir leurs avatars et ouvrir le laboratoire.

## Cinq vérifications utiles

- Les agents attendus sont présents, y compris ceux sans activité. Les profils volontairement désélectionnés restent masqués.
- Pendant une tâche de test lancée normalement dans Hermes, le monde affiche une activité appuyée par des preuves. Une connexion gateway seule ne doit pas être confondue avec un travail.
- À la fin de la tâche, le statut évolue correctement. Les occupations décoratives en salle de pause ne sont pas de vraies tâches Hermes.
- Fermer/réouvrir l'app conserve serveur, sélection et avatars. Ouvrir/fermer Équipe et Kanban ne réduit pas le monde et ne laisse pas de défilement parasite.
- Hors installation, couper brièvement le réseau du Mac : les données deviennent anciennes, puis la collecte reprend après rétablissement. Ne pas couper le serveur de production.

## Retour à transmettre

Version de l'app, version de macOS, étape exacte, résultat attendu/observé et **Copier le diagnostic**. Vérifier/anonymiser les titres avant toute capture du monde. Ne pas envoyer la base Hermes, ses configurations, clés ou journaux complets.

En cas d'installation interrompue, relancer le diagnostic avant de réessayer. Mise à jour, sauvegardes et désinstallation sont décrites dans [BETA-MAC.md](BETA-MAC.md).

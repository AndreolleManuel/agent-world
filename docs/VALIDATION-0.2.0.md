# Validation 0.2.0 — 19 septembre 2026

Candidat développeurs, préparation locale. Aucun push, release, modification du site ni installation sur un VPS réel. Ce rapport ne vaut pas certification ; le reçu de paquet complète les vérifications du binaire exact après compilation.

## Corrections couvertes

Protocole 2 strict et partagé ; masquage des titres/noms distants par défaut ; IDs opaques et alias locaux ; séparation exporteur/lecteur VPS ; compte et clé restreints ; refus des anciennes connexions générales ; confirmation native et capacités IPC explicites ; helper local isolé ; registre inaccessible/ambigu/volumineux refusé ; dictionnaires sans collision de prototype ; avatars obsolètes purgés ; installation administrative avec sauvegarde, reprise, révocation et désinstallation ; Vitest mis à jour.

## Vérifications exécutées

| Périmètre | Résultat local |
|---|---|
| TypeScript / frontend | lint, 137 tests, build Vite réussis |
| Scripts de distribution | 21 tests réussis |
| Rust application | 24 tests unitaires + 43 lectures/régressions + 3 tests d’isolation macOS réussis |
| Exporteur / protocole | 13 tests unitaires + 2 tests d’intégration réussis |
| Lecteur | 3 tests de protocole sur Mac ; 4 tests exécutés dans la VM Linux, dont les refus seccomp de fichier/socket/fork |
| Clippy | trois composants, avertissements traités comme erreurs |
| Démo via MCP Chrome | mixte, dix actifs/pause/sans preuve, quarante et 256 agents, états mélangés, vide/erreur/reprise ; pas de débordement horizontal en 960×640 ; pas d’erreur console observée |
| Isolation Mac réelle | lecture autorisée ; fichiers privés dedans/dehors et écritures refusés ; connexion/écoute réseau et création de processus refusées |
| Debian 13 arm64 jetable | snapshot, sentinelles privées absentes, commandes/SFTP/SCP/écritures/tunnels TCP/Unix refusés ; bursts simultanés et stdin bloqué bornés ; fausse clé hôte refusée ; restrictions PTY/X11/agent/environnement contrôlées dans sshd effectif |
| Cycle d’installation VM | installation répétée, échec d’activation avec restauration, révocation, retour arrière, désinstallation et réinstallation ; accès administrateur et fichiers Hermes préservés |
| Paquets VM | hash altéré, paquet non authentifié et signature modifiée refusés ; manifeste correctement signé accepté |
| Keychain Mac | clé synthétique chiffrée, connexion SSH avec `IdentityAgent=none` et `UseKeychain=yes` ; identité de test retirée ensuite |
| Dépendances | npm : zéro vulnérabilité ; RustSec : zéro vulnérabilité signalée dans les trois lockfiles, contrôle du registre inclus |
| Notices | 281 entrées, cinq archives MPL conformes aux hashes Cargo, aucune notice manquante |

Une régression native supplémentaire a été corrigée : bases WAL fermées sans auxiliaires désormais lues via une image mémoire limitée, sans création de WAL/SHM dans Hermes. Le test s’exécute dans la sandbox macOS réelle. Le bundle précédent utilisé pendant la recette est remplacé par un nouveau candidat.

Les tests de plusieurs composants réexécutent du code partagé : leur addition n’est pas un nombre de protections indépendantes. Les scénarios visuels ne garantissent pas l’absence de tous chevauchements entre avatars mobiles.

## Réserves identifiées

- RustSec conserve des avertissements « unmaintained » sur `proc-macro-error` et cinq crates `unic-*` transitives, plus « unsound » sur `glib`, dépendance du desktop Linux absente du graphe livré Mac/serveur. La chaîne Tauri doit suivre les remplacements upstream ; pas de fork improvisé de ses parseurs durant cette correction.
- Le bundle principal Vite dépasse le seuil indicatif de 500 kB. Pas de blocage fonctionnel constaté en démo ; les mesures de mémoire/CPU ne remplacent pas une campagne de performance multi-machines.
- Linux arm64 testé dans une VM Debian locale, pas chez un hébergeur. x86_64 compilé ; exécution x86_64, Mac Intel et macOS minimum 12.3 non validés ici. Les workflows multi-architectures sont préparés mais non exécutés sur GitHub dans cette intervention.
- Confinement macOS testé sur la machine de développement Apple Silicon ; `sandbox-exec` doit rester disponible et vérifié. Si absent, la collecte échoue sans repli.
- Une interruption brutale à chaque instruction de l’installateur n’a pas été simulée. Les échecs contrôlés restaurent les fichiers ; conserver une session administrative et les sauvegardes pour les interruptions OS.
- Signature Developer ID/notarisation et clé de signature officielle des paquets serveur non configurées. Ne pas présenter un SHA-256 ou une signature ad hoc comme une identité d’éditeur authentifiée.
- Téléchargement public, quarantaine d’un téléchargement HTTPS réel, redirections et cache du site restent à vérifier après décision de publication. Les anciennes releases 0.1.x ne sont pas remplacées par cette préparation.

Pour une diffusion initiale honnête : sources et candidat de test destinés aux développeurs, avec ces limites visibles. Une release stable doit achever la recette des cibles annoncées et l’authentification des artefacts. Guides : [installation](INSTALLATION.md), [VPS](VPS.md), [sécurité](SECURITY.md), [publication](PUBLICATION.md).

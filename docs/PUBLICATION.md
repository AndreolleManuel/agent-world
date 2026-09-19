# Préparer la publication

Parcours prévu : Reel Instagram → présentation sur le site AM Labs → dépôt GitHub public. Gratuit, licence MIT ; lecture du code et prérequis destinés aux développeurs. Ce parcours ne constitue pas un contrôle d'accès : tout le monde peut cloner un dépôt public.

## Candidat

Publier uniquement un instantané de sources explicitement sélectionnées, avec une révision et un historique public examinés. `npm run prepare:public -- --write` exporte l'allowlist sans historique privé, données de travail, clés ni rapports internes. Ne pas pousser directement une branche contenant des sauvegardes ou audits privés. Les fichiers de laboratoire et leurs identités restent dans `work/`, ignoré.

Contrôler lint, tests, build, audits npm/RustSec, notices, licences des visuels et `npm run audit:public -- --history`. Compiler depuis la révision exacte, vérifier le paquet et écrire les limites dans ses notes. Les workflows ne publient rien, ne créent pas de tag et ne donnent aucun secret aux PR.

La version 0.2.0 reste un candidat tant que sa mise en ligne n'est pas décidée. Ne pas renvoyer vers l'ancienne 0.1.x comme si elle contenait les protections du protocole 2. Une éventuelle release doit inclure code, guides, artefact exact, état de validation, hashes et signature pertinente. Aucun paquet serveur précompilé ne doit être présenté comme authentifié sans signature et clé de confiance publiées séparément.

## Avant activation du lien du site

Canal retenu : sources pour développeurs et application Mac explicitement non notarisée, sans abonnement Apple. Présentation : **Mac Apple Silicon** et, pour les composants serveur, **Debian 13 ARM64 avec OpenSSH et systemd**. La version exacte de macOS testée figure dans le rapport de recette, pas comme restriction commerciale à une version unique. Le projet vise les macOS récents sans annoncer une compatibilité historique non vérifiée. Les autres architectures et distributions ne font pas partie du périmètre annoncé ; leur compilation éventuelle ne change pas cette décision.

Vérifier le lien HTTPS réel, ses redirections, le nom/version/hash réellement téléchargés, le cache du site et le parcours d’exception individuelle Gatekeeper. Cette vérification ne peut être faite avant publication de l’artefact ; ne pas inventer un résultat. La notarisation n’est pas un prérequis du canal retenu. Les paquets serveur précompilés nécessitent une signature de mainteneur vérifiable ; la compilation personnelle depuis des sources examinées reste disponible.

Prévoir le retrait d'une archive compromise, des notes de migration et la révocation des clés de consultation concernées. Protéger les droits de publication GitHub/site. Les commandes de push, release et déploiement restent une décision du mainteneur.

L’identité de signature est documentée dans [SIGNATURES.md](SIGNATURES.md). Inclure les signatures du manifeste serveur et de l’inventaire complet dans la version publiée ; afficher la clé publique ou son empreinte sur une référence HTTPS indépendante des archives. La création de la clé et la signature locale n’autorisent pas à elles seules une mise en ligne.

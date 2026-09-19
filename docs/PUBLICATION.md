# Préparer la publication

Parcours prévu : Reel Instagram → présentation sur le site AM Labs → dépôt GitHub public. Gratuit, licence MIT ; lecture du code et prérequis destinés aux développeurs. Ce parcours ne constitue pas un contrôle d'accès : tout le monde peut cloner un dépôt public.

## Candidat

Publier uniquement un instantané de sources explicitement sélectionnées, avec une révision et un historique public examinés. `npm run prepare:public -- --write` exporte l'allowlist sans historique privé, données de travail, clés ni rapports internes. Ne pas pousser directement une branche contenant des sauvegardes ou audits privés. Les fichiers de laboratoire et leurs identités restent dans `work/`, ignoré.

Contrôler lint, tests, build, audits npm/RustSec, notices, licences des visuels et `npm run audit:public -- --history`. Compiler depuis la révision exacte, vérifier le paquet et écrire les limites dans ses notes. Les workflows ne publient rien, ne créent pas de tag et ne donnent aucun secret aux PR.

La version 0.2.0 reste un candidat tant que sa mise en ligne n'est pas décidée. Ne pas renvoyer vers l'ancienne 0.1.x comme si elle contenait les protections du protocole 2. Une éventuelle release doit inclure code, guides, artefact exact, état de validation, hashes et signature pertinente. Aucun paquet serveur précompilé ne doit être présenté comme authentifié sans signature et clé de confiance publiées séparément.

## Avant activation du lien du site

Décider du canal : source développeur ou bêta Mac explicitement non notarisée. Une version stable demande notamment Developer ID/notarisation et recette sur les cibles annoncées. Vérifier ensuite le lien HTTPS réel, ses redirections, le nom/version/hash réellement téléchargés et le cache du site. Cette vérification ne peut être faite avant publication de l'artefact ; ne pas inventer un résultat.

Prévoir le retrait d'une archive compromise, des notes de migration et la révocation des clés de consultation concernées. Protéger les droits de publication GitHub/site. Les commandes de push, release et déploiement restent une décision du mainteneur.

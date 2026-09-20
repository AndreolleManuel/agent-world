# Validation 0.2.1 — 20 septembre 2026

Cette version ajoute les mises à jour signées dans l’app et les nouvelles bulles de pensée. Les protections de lecture et le protocole serveur restent ceux de la [validation 0.2.0](VALIDATION-0.2.0.md). Les composants serveur distribués restent en 0.2.0 ; leurs sources et binaires ARM64 ne sont pas modifiés par cette version de l’app.

## Contrôles avant publication

- Interface : 147 tests dans 21 suites, TypeScript et build de production réussis.
- Distribution : 24 tests des scripts réussis ; export explicite des sources publiques, sans historique privé ni fichiers de travail.
- Natif : 79 tests de l’app réussis, dont les refus réels de fichiers privés, réseau et création de processus dans la sandbox du lecteur macOS ; Clippy sans avertissement.
- HTTPS natif : initialisation explicite du moteur cryptographique et test de régression ; le libellé de recherche est distinct des phases de téléchargement et d’installation.
- Mise à jour : test supplémentaire sur une app factice isolée et un manifeste réellement signé. Signature valide acceptée, manifeste/paquet altérés refusés, mauvaise version interne refusée, installation valide et sauvegarde de l’ancienne app vérifiées. Les tests de remplacement vérifient aussi la restauration après un échec du second renommage.
- Vérification quotidienne : horloge simulée sur 48 heures, retour de veille, désactivation et report après une recherche manuelle ; aucun téléchargement automatique.
- Interface via navigateur/MCP : notification et fenêtre inspectées visuellement ; scénarios « nouvelle version », « à jour », « hors ligne » et « signature invalide » vérifiés, sans débordement horizontal observé. Ces scénarios simulent l’installation et ne constituent pas un essai de téléchargement public.
- Build universel macOS : arm64 et x86_64, signature ad hoc valide. La présence de x86_64 ne signifie pas qu’un Mac Intel a été testé.
- Clé de publication de mise à jour créée par le mainteneur, chiffrée et extérieure au dépôt ; seule sa partie publique est embarquée. Création et signature interactives éprouvées séparément avec une clé factice.
- Dépendances : aucune vulnérabilité signalée par RustSec lors du contrôle du 20 septembre ; avertissements transitifs déjà documentés en 0.2.0 conservés. 327 notices présentes, cinq sources MPL exactes, aucune notice manquante.

Les contrôles ont été effectués sur le Mac Apple Silicon de développement, avec macOS 26.6.2. Cette version de macOS est un constat de test, pas une restriction d’installation. Le seuil technique 12.3, Mac Intel, les autres distributions VPS et Linux x86_64 ne font pas l’objet d’une nouvelle recette ici.

## Recette sur le téléchargement publié

La publication GitHub et l’essai de passage d’une 0.2.0 équipée de la clé à la 0.2.1 sont des étapes distinctes de ces tests locaux. Le reçu `VALIDATION-PAQUET.md` joint au téléchargement consigne les contrôles effectivement réalisés sur les fichiers finaux. Ne pas déduire une recette GitHub, Gatekeeper ou une réussite CI distante de la seule compilation locale.

L’app reste volontairement non notarisée. Les mises à jour requièrent la confirmation native et une copie appartenant à l’utilisateur dans un dossier inscriptible. Les données Hermes, les préférences existantes et les composants VPS restent séparés du bundle remplacé. Voir [UPDATES.md](UPDATES.md).

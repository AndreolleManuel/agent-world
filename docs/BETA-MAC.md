# Bêta Mac 0.2.1

Canal développeurs, gratuit, signé ad hoc, **non notarisé**. L'app n'embarque plus de programme d'installation VPS. Les composants serveur sont compilés et administrés séparément selon [VPS.md](VPS.md).

Construire avec `npm run build:beta -- --bundles app` ; le script retire les variables Apple du processus et force la signature ad hoc. Il remappe les chemins de compilation et écrit version, révision, empreinte de sources et état propre/modifié dans `build-info.json`. Le paquet vérifie architectures, signature technique, notices, liens documentaires, concordance des sources et absence du chemin personnel dans le binaire.

`npm run package:beta` produit un artefact de test. `--public-beta` exige en plus des sources propres et un scan de l'historique : ce contrôle ne publie rien. `BUILD-STATUS.json`, guides et `SHA256SUMS` accompagnent le ZIP. Une signature ad hoc ne donne pas une identité d'éditeur vérifiée par Apple.

Application pour **Mac Apple Silicon**, sans restriction à la seule version de macOS utilisée pour la recette. La distribution non notarisée est un choix confirmé du projet ; Developer ID et notarisation ne sont pas des conditions de publication. Le téléchargement exact avec quarantaine et l’exception individuelle doivent être vérifiés sur chaque artefact distribué. Ne pas retirer globalement Gatekeeper. [Installation](INSTALLATION.md) et [validation effective](VALIDATION-0.2.1.md).

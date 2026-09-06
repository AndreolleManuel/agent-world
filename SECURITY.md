# Signaler un problème de sécurité

Agent World lit des métadonnées Hermes et peut se connecter à un VPS par SSH. Pour comprendre les accès, les limites et les données conservées, consultez [Données et confidentialité](docs/PRIVACY.md) et le [modèle de sécurité technique](docs/SECURITY.md).

## Signalement confidentiel

Ne publiez pas une vulnérabilité exploitable, une clé, un profil Hermes réel, une base ou une capture sensible dans une issue publique.

Le signalement privé GitHub a été activé et vérifié le 6 septembre 2026. Utilisez [Report a vulnerability](https://github.com/AndreolleManuel/agent-world/security/advisories/new), également accessible par **Security → Advisories**. Si cette option devient indisponible, demandez un canal confidentiel au mainteneur sans divulguer les détails techniques.

Incluez la version d'Agent World, le système, les conditions de reproduction et un exemple utilisant des données fictives. Ne testez que des systèmes pour lesquels vous avez une autorisation. Évitez toute collecte de données d'autres utilisateurs.

## Versions et limites

La version 0.1.0 est une bêta de test ; aucune version n'est annoncée comme auditée indépendamment ou certifiée. Aucun délai contractuel de prise en charge ni programme de prime n'est promis. Les notes de release précisent les limites et les correctifs disponibles.

L'application actuelle est signée ad-hoc, non notarisée par Apple. Téléchargez uniquement les paquets annoncés sur le dépôt officiel et suivez le [guide d'installation](docs/INSTALLATION.md). Ne désactivez pas globalement les protections de macOS. Un checksum permet de détecter une corruption, pas d'authentifier à lui seul un éditeur ou de garantir l'absence de vulnérabilité.

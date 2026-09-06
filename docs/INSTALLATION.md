# Installer Agent World sur Mac

Agent World est une app gratuite de supervision visuelle, créée par [AM Labs](https://amlabs.dev). Elle observe vos agents Hermes ; elle ne leur envoie pas de tâches. Aucun compte AM Labs, Node.js ou Rust n'est nécessaire pour utiliser le paquet Mac complet.

Avant de connecter vos agents, consultez [Données et confidentialité](PRIVACY.md) : sources lues, paramètres conservés, connexion SSH directe, diagnostic manuel et limites de sécurité. Aucun envoi automatique de données d'agents à AM Labs n'est prévu dans cette version.

## Télécharger la bonne archive

Ouvrir la [bêta Mac officielle](https://github.com/AndreolleManuel/agent-world/releases/tag/v0.1.0-beta.1), puis télécharger **Agent-World-0.1.0-mac-universal-UNNOTARIZED.zip** dans les fichiers joints. Ne pas choisir **Source code (zip)** : celui-ci contient le projet à compiler, pas l'app prête à ouvrir.

Le même téléchargement fonctionne sur Mac Intel et Apple Silicon. Minimum déclaré : **macOS 12.3**, avec WebKit/Safari 15.4 ou ultérieur. La recette sur Mac Intel et sur le système minimum reste à terminer pour cette bêta ; seules les machines effectivement testées pourront être annoncées comme validées.

Télécharger aussi ce guide et `SHA256SUMS` depuis la même release. La somme contrôle l'intégrité du fichier reçu, mais ne remplace pas la vérification de sa provenance.

## Première ouverture — version non notarisée

1. Extraire le ZIP et déplacer **Agent World.app** dans **Applications**.
2. Essayer de l'ouvrir. Cette version est signée ad-hoc, **pas notarisée par Apple** : macOS peut afficher un avertissement de développeur non identifié ou d'app qu'Apple ne peut pas vérifier.
3. Uniquement si le fichier provient de la source officielle et que vous lui faites confiance, ouvrir **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**, puis confirmer. Sur Monterey, l'intitulé est **Préférences Système → Sécurité et confidentialité → Général**.
4. L'exception concerne cette app ; ses ouvertures suivantes sont normalement habituelles. Voir la [procédure Apple](https://support.apple.com/fr-fr/102445).

Ne pas désactiver Gatekeeper, ne pas retirer globalement les contrôles de sécurité et ne pas exécuter de commande de contournement trouvée ailleurs. Si l'alerte indique un logiciel malveillant, une app endommagée ou modifiée, **arrêter l'installation** et signaler le problème. Les Mac administrés par une entreprise peuvent interdire l'exception ; demander au service informatique. Une nouvelle version de l'app peut nécessiter une nouvelle autorisation.

## Connecter ses agents

Hermes doit déjà être installé et configuré ; Agent World ne l'installe pas.

**Hermes sur ce Mac :** choisir « Sur ce Mac », laisser la détection automatique ou indiquer son dossier Hermes, choisir les agents et leurs avatars, puis ouvrir le laboratoire. Les agents sans tâche restent visibles s'ils sont sélectionnés.

**Hermes sur un VPS :** choisir « Sur un VPS », indiquer serveur, utilisateur et port SSH. L'accès doit fonctionner par clé et l'empreinte du serveur doit avoir été vérifiée auprès de l'hébergeur puis approuvée dans SSH. Une clé protégée doit être déverrouillée dans l'agent SSH du Mac. Si cette préparation n'est pas faite, demander l'aide de la personne qui administre le VPS ; l'app ne doit pas approuver aveuglément un serveur.

Cliquer « Vérifier mon serveur ». La distribution et l'architecture Linux sont détectées automatiquement. Si proposé, autoriser puis installer le collecteur inclus ; cliquer ensuite « Tester le VPS », choisir les avatars et ouvrir le laboratoire. Aucun compilateur à installer sur le VPS avec ce parcours. Aucun port web public ni relais AM Labs.

Cette bêta n'automatise pas les connexions par mot de passe, alias SSH, bastions, Docker ni l'installation en tant que root. Détails dans [VPS.md](VPS.md).

## En cas de problème

Le configurateur propose un diagnostic partageable sans adresse, clé privée ni contenu des agents. Consulter [TEST-BETA.md](TEST-BETA.md) pour transmettre un retour utile. Ne jamais envoyer vos conversations, bases Hermes, clés ou mots de passe.

Si l'app signale ses **préférences endommagées**, elle propose « Sauvegarder et réinitialiser les préférences » après confirmation. Cela réinitialise uniquement connexion, sélection et avatars. L'ancien fichier reste dans un sous-dossier `recovery-…` du dossier de configuration Agent World (identifiant d'app `com.amlabs.pixelops`, sous `~/Library/Application Support` sur macOS). Les agents et données Hermes ne sont pas supprimés. Reconfigurer ensuite la connexion. Pour restaurer manuellement cette sauvegarde, fermer l'app, conserver également la configuration actuelle et demander de l'aide avant de remplacer un fichier.

## Mise à jour et désinstallation

Les mises à jour sont manuelles : fermer l'app, télécharger la nouvelle archive depuis Releases et remplacer l'app dans Applications. Les préférences sont séparées de l'app ; ne pas supprimer leur dossier. Le configurateur peut mettre à jour le collecteur VPS après une nouvelle autorisation.

Pour désinstaller, mettre l'app à la corbeille. Le retrait éventuel du collecteur VPS et les sauvegardes sont détaillés dans [BETA-MAC.md](BETA-MAC.md). Ne pas effacer le dossier Hermes.

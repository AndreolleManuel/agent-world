# Contrat de données — protocole 2

Implémentation commune : `src-tauri/src/remote_protocol.rs` et `telemetry.rs`, compilées par le client, l’exporteur et le lecteur. Ce fichier décrit les contraintes ; les types et validations font foi.

| Élément | Contrat |
|---|---|
| Opération SSH | `snapshot`, commande imposée ; aucune interpolation shell |
| Requête | `{"protocol":2}`, 64 octets maximum, champs inconnus refusés |
| Réponse | `protocol`, `source_id`, `snapshot` ; 1 Mio maximum ; champs inconnus refusés |
| Identifiants | 32 caractères hexadécimaux opaques, salés par source ; unicité vérifiée |
| Agents / cartes / preuves | 256 / 512 / 8 par agent |
| Textes | nom ≤256 octets, titre ≤512 octets ; contrôles et marques bidi rejetés |
| Temps | RFC3339, années 2000–2100 ; collecte ≤60 secondes |
| Fraîcheur | snapshot de plus de 30 secondes ou plus de 5 secondes dans le futur refusé ; âges recalculés sans rajeunissement |
| Phases | available, live_run, live_session, review_pending, blocked, ready_unclaimed, todo_not_started, telemetry_unavailable |
| Statuts de carte | todo, ready, running, review, blocked, triage, done, cancelled, archived |
| Confidentialité | aucun `waiting_reason` libre ; rôle/machine/origine fixés ; profil égal à l’ID opaque |

Le parseur conserve la limite de récursion Serde et rejette les entrées invalides avant rendu. Les erreurs de collecte deviennent des codes fermés. Les champs affichés restent du texte React, jamais HTML actif, commande, URL automatiquement visitée ou chemin natif.

Le lecteur n’accepte que `/data/snapshot.json` déjà configuré côté serveur. Une ouverture réussie ne rajeunit pas sa date. Timeout de lecture 5 secondes ; CPU 2 secondes, espace mémoire 64 Mio, fichier 1 Mio, un lecteur à la fois et au plus une lecture réussie par seconde. La connexion SSH cliente est limitée à 12 secondes et ses sorties sont bornées. L’IPC natif refuse de mettre en file des collectes concurrentes.

La version 1 est refusée sans repli. Les identifiants servent à l’affichage, pas à une autorisation d’accès. L’autorisation de publication est exclusivement la liste `profiles` de l’exporteur.

// Preparation is administrative and deliberately unavailable through desktop IPC.
export default function RemoteTools() {
  return <section className="remote-tools" aria-label="Préparation du VPS">
    <details className="remote-install"><summary>Préparer le lecteur VPS</summary>
      <p>Le compte dédié aw-view doit être installé par l’administrateur du serveur, avec une clé réservée à Agent World. Il ne peut consulter que l’export publié ; les bases et conversations Hermes restent hors de son accès.</p>
      <p>Suivez le guide docs/VPS.md du dépôt GitHub de cette version. L’ancien collecteur utilisant le compte Hermes général est incompatible.</p>
      <p>La préparation et la révocation des clés se font sur le serveur. Agent World ne peut installer aucun programme ni modifier les autorisations distantes.</p>
    </details>
  </section>;
}

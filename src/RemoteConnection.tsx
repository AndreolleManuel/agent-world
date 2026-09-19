import RemoteTools from './RemoteTools';
export interface SshSource { host: string; user: string; port: number; identityFile: string | null; root: string | null }
export const EMPTY_SSH_SOURCE: SshSource = { host: '', user: 'aw-view', port: 22, identityFile: null, root: null };
export function connectionError(error: unknown): string {
  const messages: Record<string, string> = {
    secure_setup_required: 'Ce serveur utilise encore l’ancien accès général. Préparez le compte aw-view et le lecteur restreint de cette version ; aucune ancienne connexion ne sera reprise.',
    encrypted_key_required: 'Utilisez une clé Ed25519 dédiée, protégée par une phrase secrète et préparée dans le trousseau macOS avec le guide VPS.',
    ssh_key_permissions: 'La clé doit vous appartenir, être un fichier normal non partagé et avoir des permissions privées (chmod 600).',
    dedicated_key_required: 'Sélectionnez une clé dédiée à ce lecteur. L’agent SSH général et ses clés ne sont jamais utilisés.',
    source_approval_cancelled: 'Autorisation de source annulée dans la fenêtre native.',
    source_approval_required: 'Cette source doit être approuvée dans la fenêtre native avant consultation.',
    operation_busy: 'Une lecture est déjà en cours. Réessayez dans un instant.',
    ssh_host_untrusted: 'Identité du serveur non vérifiée ou modifiée. Vérifiez son empreinte auprès de votre hébergeur, puis établissez une première connexion dans Terminal. Ne supprimez pas une ancienne clé sans vérification.',
    ssh_auth_failed: 'Authentification SSH refusée. Vérifiez la clé dédiée et sa disponibilité pour OpenSSH. Aucun mot de passe n’est enregistré par Agent World.',
    ssh_timeout: 'Le serveur n’a pas répondu à temps. Vérifiez l’adresse, le port et votre connexion.',
    ssh_dns_failed: 'Adresse du serveur introuvable. Vérifiez son nom ou saisissez son adresse IP.',
    ssh_connection_refused: 'Le serveur refuse la connexion. Vérifiez le port et le service SSH.',
    invalid_root: 'Indiquez un chemin absolu vers Hermes sur le serveur, ou laissez ce champ vide.',
    collector_missing: 'Connexion SSH établie, mais collecteur introuvable. Installez agent-world-collector sur le VPS avec les instructions ci-dessous.',
    hermes_not_found: 'Dossier Hermes introuvable ou illisible pour cet utilisateur SSH. Vérifiez le chemin distant et ses permissions.',
    remote_clock_or_stale: 'Les données distantes sont trop anciennes ou l’horloge du VPS est décalée. Synchronisez son horloge et réessayez.',
    protocol_mismatch: 'Version du collecteur incompatible. Mettez le collecteur et Agent World à la même version.',
    invalid_response: 'Le collecteur a renvoyé une réponse invalide. Aucun état d’agent n’a été accepté.',
    response_limit: 'La réponse distante dépasse la limite de sécurité. Aucun état incomplet n’a été accepté.',
    ssh_invalid_address: 'Vérifiez le nom du serveur, l’utilisateur et le port SSH (1 à 65535).',
    ssh_invalid_key_path: 'Indiquez le chemin absolu de la clé privée sur ce Mac, réservée au lecteur Agent World.',
    registry_changed: 'Les profils ont changé depuis la détection. Relancez le test avant d’enregistrer.',
  };
  return (Object.hasOwn(messages, String(error)) ? messages[String(error)] : undefined) ?? 'Connexion ou configuration indisponible. Vérifiez SSH, les permissions et la présence du collecteur, puis réessayez.';
}

export default function RemoteConnection({ value, onChange, disabled }: { value: SshSource; onChange: (value: SshSource) => void; disabled: boolean }) {
  const change = (patch: Partial<SshSource>) => onChange({ ...value, ...patch });
  return <div className="remote-connection">
    <p>Connexion directe chiffrée entre votre Mac et votre VPS. Aucun port web à ouvrir, aucune clé API Hermes à transmettre.</p>
    <div className="remote-fields">
      <label>Serveur VPS<input required disabled={disabled} placeholder="vps.exemple.fr ou adresse IP" value={value.host} onChange={(e) => change({ host: e.target.value })} autoCapitalize="none" spellCheck={false} /></label>
      <label>Utilisateur SSH<input required disabled={disabled} placeholder="aw-view" value={value.user} onChange={(e) => change({ user: e.target.value })} autoCapitalize="none" spellCheck={false} /></label>
      <label>Port SSH<input required disabled={disabled} type="number" min="1" max="65535" value={value.port || ''} onChange={(e) => change({ port: Number(e.target.value) })} /></label>
      <label>Clé dédiée sur ce Mac<input required disabled={disabled} placeholder="/Users/vous/.ssh/agent-world-viewer" value={value.identityFile ?? ''} onChange={(e) => change({ identityFile: e.target.value || null })} autoCapitalize="none" spellCheck={false} /></label>

    </div>
    <p className="remote-security">L’empreinte du serveur doit être vérifiée indépendamment et déjà approuvée dans known_hosts. La clé dédiée doit être chiffrée ; OpenSSH utilise le trousseau macOS pour la déverrouiller. Aucune acceptation automatique de clé hôte. Le client n’utilise ni mot de passe SSH ni agent SSH général.</p>
    <RemoteTools />
  </div>;
}

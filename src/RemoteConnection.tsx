import RemoteTools from './RemoteTools';
import type { BeginSetupOperation } from './useSetupOperation';
export interface SshSource { host: string; user: string; port: number; identityFile: string | null; root: string | null }
export const EMPTY_SSH_SOURCE: SshSource = { host: '', user: '', port: 22, identityFile: null, root: null };
export function connectionError(error: unknown): string {
  const messages: Record<string, string> = {
    ssh_host_untrusted: 'Identité du serveur non vérifiée ou modifiée. Vérifiez son empreinte auprès de votre hébergeur, puis établissez une première connexion dans Terminal. Ne supprimez pas une ancienne clé sans vérification.',
    ssh_auth_failed: 'Authentification SSH refusée. Utilisez la bonne clé privée ou déverrouillez-la dans votre agent SSH. Aucun mot de passe n’est enregistré par Agent World.',
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
    ssh_invalid_key_path: 'Indiquez le chemin absolu de la clé privée sur ce Mac, ou laissez le champ vide pour utiliser l’agent SSH.',
    registry_changed: 'Les profils ont changé depuis la détection. Relancez le test avant d’enregistrer.',
  };
  return messages[String(error)] ?? 'Connexion ou configuration indisponible. Vérifiez SSH, les permissions et la présence du collecteur, puis réessayez.';
}

export default function RemoteConnection({ value, onChange, disabled, toolsDisabled, beginOperation }: { value: SshSource; onChange: (value: SshSource) => void; disabled: boolean; toolsDisabled: boolean; beginOperation: BeginSetupOperation }) {
  const change = (patch: Partial<SshSource>) => onChange({ ...value, ...patch });
  return <div className="remote-connection">
    <p>Connexion directe chiffrée entre votre Mac et votre VPS. Aucun port web à ouvrir, aucune clé API Hermes à transmettre.</p>
    <div className="remote-fields">
      <label>Serveur VPS<input required disabled={disabled} placeholder="vps.exemple.fr ou adresse IP" value={value.host} onChange={(e) => change({ host: e.target.value })} autoCapitalize="none" spellCheck={false} /></label>
      <label>Utilisateur SSH<input required disabled={disabled} placeholder="hermes" value={value.user} onChange={(e) => change({ user: e.target.value })} autoCapitalize="none" spellCheck={false} /></label>
      <label>Port SSH<input required disabled={disabled} type="number" min="1" max="65535" value={value.port || ''} onChange={(e) => change({ port: Number(e.target.value) })} /></label>
      <label>Clé privée sur ce Mac · facultatif<input disabled={disabled} placeholder="/Users/vous/.ssh/id_ed25519" value={value.identityFile ?? ''} onChange={(e) => change({ identityFile: e.target.value || null })} autoCapitalize="none" spellCheck={false} /></label>
      <label className="remote-root">Dossier Hermes sur le VPS · facultatif<input disabled={disabled} placeholder="Automatique · dossier de l’utilisateur SSH" value={value.root ?? ''} onChange={(e) => change({ root: e.target.value || null })} autoCapitalize="none" spellCheck={false} /></label>
    </div>
    <p className="remote-security">Clé déjà approuvée dans known_hosts requise. Pour une clé protégée, déverrouillez-la dans votre agent SSH. Les alias ~/.ssh/config et les connexions par mot de passe ne sont pas pris en charge dans cette première version.</p>
    <RemoteTools source={value} disabled={toolsDisabled} beginOperation={beginOperation} />
    <details className="remote-install"><summary>Alternative avancée · installation depuis les sources</summary>
      <ol><li>Ouvrez une connexion SSH avec votre utilisateur Hermes habituel. Vérifiez l’empreinte du serveur auprès de votre hébergeur.</li>
        <li>Transférez les sources de cette version d’Agent World sur le VPS. Depuis leur dossier, lancez :</li></ol>
      <pre><code>sh scripts/install-collector.sh</code></pre>
      <p>Cette version installe le collecteur depuis les sources : Rust/Cargo et un compilateur C sont nécessaires. Aucun sudo, service permanent ou changement d’Hermes. Le fichier est installé dans ~/.local/bin/agent-world-collector ; une ancienne version est conservée lors d’une mise à jour.</p>
      <p>Revenez ici puis cliquez sur « Tester le VPS ». Aucune installation distante n’est déclenchée par ce bouton.</p>
    </details>
  </div>;
}

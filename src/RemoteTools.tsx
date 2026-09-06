import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SshSource } from './RemoteConnection';
import type { BeginSetupOperation } from './useSetupOperation';

interface Check { id: string; status: string; code: string }
export interface RemoteDiagnostic { appVersion: string; platform: string; architecture: string; checks: Check[]; canInstall: boolean }
const labels: Record<string, string> = { ssh: 'Connexion et identité SSH', platform: 'Compatibilité du serveur', bundle: 'Collecteur inclus dans l’app', installation: 'Installation sans sudo', collector: 'Collecteur sur le VPS', hermes: 'Lecture de Hermes' };
const messages: Record<string, string> = {
  ssh_verified: 'Connexion et identité du serveur vérifiées.', platform_supported: 'Linux 64 bits reconnu automatiquement.',
  platform_unsupported: 'Ce serveur n’est pas pris en charge par l’installation intégrée.',
  collector_bundle_ready: 'Binaire vérifié, prêt à transférer par SSH.',
  collector_bundle_missing: 'Cette build ne contient pas les collecteurs Linux. Utilisez une bêta complète ou l’installation depuis les sources.',
  collector_bundle_invalid: 'Collecteur local incomplet ou endommagé. Réinstallez l’app depuis une source fiable.',
  root_not_supported: 'L’installation intégrée refuse root. Utilisez le compte qui héberge Hermes, sans modifier ses permissions.',
  install_tools_missing: 'Outils système manquants sur le serveur (sha256sum, mktemp ou dd).',
  install_user_ready: 'Compte utilisateur et outils de transfert disponibles.', collector_present: 'Collecteur exécutable présent.',
  collector_missing: 'Collecteur absent : son installation peut être proposée ci-dessous.',
  hermes_readable: 'Profils et métadonnées Hermes lisibles.', telemetry_partial: 'Hermes répond mais certaines preuves sont indisponibles. Consultez les détails des agents.',
  hermes_not_found: 'Dossier Hermes absent ou illisible. Vérifiez le compte SSH et le chemin distant.',
  ssh_host_untrusted: 'Vérifiez l’empreinte du serveur auprès de votre hébergeur, puis faites une première connexion dans Terminal.',
  ssh_auth_failed: 'Clé SSH refusée ou verrouillée. Vérifiez le compte et déverrouillez votre clé dans l’agent SSH.',
  ssh_dns_failed: 'Adresse du serveur introuvable. Vérifiez le nom ou utilisez son adresse IP.',
  ssh_connection_refused: 'Connexion refusée. Vérifiez le port et le service SSH.',
  ssh_timeout: 'Délai dépassé. Vérifiez le réseau et réessayez.', ssh_connection_failed: 'Connexion SSH indisponible.',
  ssh_invalid_address: 'Adresse, utilisateur ou port SSH invalide.', ssh_invalid_key_path: 'Le chemin de clé doit être absolu sur ce Mac.',
  invalid_root: 'Le dossier Hermes doit être un chemin absolu sur le serveur, ou rester vide.',
  protocol_mismatch: 'Version incompatible. Utilisez l’app et le collecteur d’une même livraison.',
  remote_clock_or_stale: 'Synchronisez les horloges du Mac et du VPS.', invalid_response: 'Réponse distante invalide.', response_limit: 'Réponse distante trop volumineuse.',
  collector_install_failed: 'Installation non confirmée. Relancez le diagnostic avant de réessayer ; une ancienne version peut avoir été sauvegardée.',
  installation_confirmation_required: 'Votre confirmation est nécessaire.', ssh_unavailable: 'Le client SSH du Mac est indisponible.',
};
const safeCode = (code: string) => Object.hasOwn(messages, code) ? code : 'unknown_error';
// Export allowlist: never include the source, host, user, path, titles or raw error.
export function diagnosticText(report: RemoteDiagnostic): string {
  return JSON.stringify({ application: 'Agent World', version: /^\d+\.\d+\.\d+$/.test(report.appVersion) ? report.appVersion : 'unknown',
    platform: ['linux', 'unsupported'].includes(report.platform) ? report.platform : 'unknown',
    architecture: ['aarch64', 'x86_64', 'unsupported'].includes(report.architecture) ? report.architecture : 'unknown',
    checks: report.checks.filter((c) => Object.hasOwn(labels, c.id)).map((c) => ({ step: c.id, status: ['ok', 'warning', 'error'].includes(c.status) ? c.status : 'unknown', code: safeCode(c.code) })),
  }, null, 2);
}

export default function RemoteTools({ source, disabled, beginOperation }: { source: SshSource; disabled: boolean; beginOperation: BeginSetupOperation }) {
  const [report, setReport] = useState<RemoteDiagnostic | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [message, setMessage] = useState('');
  const [copyFallback, setCopyFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const sourceKey = JSON.stringify(source);
  useEffect(() => { generation.current++; setReport(null); setConfirmation(false); setMessage(''); setCopyFallback(false); setFailed(false); }, [sourceKey]);
  useEffect(() => () => { generation.current++; }, []);
  async function run(install = false) {
    if (disabled || running.current || (install && (!confirmation || !report?.canInstall))) return;
    const release = beginOperation(install ? 'install' : 'diagnose');
    if (!release) return;
    running.current = true;
    const current = ++generation.current;
    setReport(null); setConfirmation(false); setCopyFallback(false); setFailed(false);
    setMessage(install ? 'Transfert et installation… Ne fermez pas l’app.' : 'Vérification SSH, serveur et Hermes…');
    try {
      if (install) await invoke('install_remote_collector', { source, confirmed: true });
      const result = await invoke<RemoteDiagnostic>('diagnose_remote', { source });
      if (generation.current !== current) return;
      setReport(result); setConfirmation(false);
      setMessage(install ? 'Installation confirmée. Consultez le diagnostic puis cliquez sur « Tester le VPS » pour choisir vos agents.' : result.checks.some((check) => check.status === 'error') ? 'Diagnostic terminé : un problème doit être corrigé. Aucun fichier installé.' : 'Diagnostic terminé. Aucun fichier installé.');
    } catch (error) {
      if (generation.current === current) {
        setReport(null); setConfirmation(false); setFailed(true);
        setMessage(messages[String(error)] ?? 'Vérification indisponible. Aucun détail sensible n’est affiché. Réessayez.');
      }
    } finally { running.current = false; release(); }
  }
  return <section className="remote-tools" aria-label="Préparation du VPS">
    <button type="button" disabled={disabled || !source.host.trim() || !source.user.trim()} onClick={() => void run()}>Vérifier mon serveur</button>
    <p className="remote-security">Détection automatique de Linux et de son architecture. Cette vérification n’installe rien.</p>
    {message && <p role={failed ? 'alert' : 'status'} className={failed || report?.checks.some((check) => check.status === 'error') ? 'diagnostic-problem' : undefined}>{message}</p>}
    {report && <>
      <ul className="connection-checks">{report.checks.map((check) => <li key={check.id} data-status={check.status}>
        <strong>{check.status === 'ok' ? '✓' : check.status === 'warning' ? '!' : '×'} {labels[check.id] ?? 'Vérification'}</strong>
        <span>{messages[check.code] ?? 'Résultat indisponible.'}</span>
      </li>)}</ul>
      <button type="button" disabled={disabled} onClick={() => {
        void (async () => { try { await navigator.clipboard.writeText(diagnosticText(report)); setMessage('Diagnostic copié, sans adresse, clé ni donnée d’agent.'); } catch { setCopyFallback(true); } })();
      }}>Copier le diagnostic</button>
      {copyFallback && <label>Diagnostic à copier<textarea readOnly rows={8} value={diagnosticText(report)} onFocus={(event) => event.currentTarget.select()} /></label>}
      {report.canInstall && <div className="install-confirmation">
        <p>Installer ou mettre à jour uniquement <code>~/.local/bin/agent-world-collector</code> sur ce VPS. Une ancienne version est sauvegardée. Aucun service ajouté, aucun réglage Hermes modifié. Ni Rust ni Cargo nécessaires.</p>
        <label><input type="checkbox" disabled={disabled} checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /> J’autorise cette installation sur le serveur renseigné.</label>
        <button type="button" disabled={disabled || !confirmation} onClick={() => void run(true)}>Installer le collecteur sur mon VPS</button>
      </div>}
    </>}
  </section>;
}

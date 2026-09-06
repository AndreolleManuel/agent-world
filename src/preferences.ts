export interface Preferences {
  version: 1;
  configured: boolean;
  enabledAgents: string[];
  avatars: Record<string, number>;
  root?: string;
  knownAgents?: string[];
}
const KEY = 'agent-world.preferences.v1';
let activePreferences: Preferences | undefined;
// The native atomic configuration is authoritative. Storage is only a cache.
export function activatePreferences(value: Preferences): void {
  activePreferences = value;
  savePreferences(value);
}
export function clearActivePreferences(): void { activePreferences = undefined; }
export function resetPreferences(): Preferences {
  const defaults: Preferences = { version: 1, configured: false, enabledAgents: [], avatars: {} };
  activatePreferences(defaults);
  return defaults;
}
export function readPreferences(): Preferences {
  if (activePreferences) return { ...activePreferences, avatars: { ...activePreferences.avatars } };
  const defaults: Preferences = { version: 1, configured: false, enabledAgents: [], avatars: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw?.version !== 1) return defaults;
    return {
      version: 1, configured: raw.configured === true,
      root: typeof raw.root === 'string' ? raw.root : undefined,
      knownAgents: Array.isArray(raw.knownAgents) ? raw.knownAgents.filter((id: unknown) => typeof id === 'string') : undefined,
      enabledAgents: Array.isArray(raw.enabledAgents) ? raw.enabledAgents.filter((id: unknown) => typeof id === 'string') : [],
      avatars: Object.fromEntries(Object.entries(raw.avatars ?? {}).filter(([, v]) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < 13)) as Record<string, number>,
    };
  } catch { return defaults; }
}
export function savePreferences(value: Preferences): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
}
export function persistentAvatar(agentId: string, fallback: number): number {
  const preferences = readPreferences();
  const existing = preferences.avatars[agentId];
  if (existing !== undefined) return existing;
  preferences.avatars[agentId] = fallback;
  savePreferences(preferences);
  return fallback;
}

export const AVATAR_SHEETS = [
  new URL('./assets/am-labs-human-variants-16bit-v1.png', import.meta.url).href,
  new URL('./assets/am-labs-human-variants-16bit-v2.png', import.meta.url).href,
  new URL('./assets/am-labs-human-variants-16bit-v3.png', import.meta.url).href,
];

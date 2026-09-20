import type { UpdateBackend, UpdateStatus } from './Updates';

// Included only by the development fixture. Never calls IPC, fetch or filesystem APIs.
export function updateFixture(scenario: string): UpdateBackend {
  let status: UpdateStatus = { phase: 'idle', currentVersion: '0.2.0', version: null, notes: null, downloaded: 0, total: null, error: null };
  const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
  return {
    async status() { return { ...status }; },
    async check() {
      status = { ...status, phase: 'checking', error: null }; await pause(600);
      status = { ...status, phase: scenario === 'offline' ? 'error' : scenario === 'current' ? 'current' : 'available',
        error: scenario === 'offline' ? 'update_network' : null, version: '0.3.0', notes: 'Quelques corrections et des agents un peu moins distraits.\nLes réglages sont conservés.' };
      return { ...status };
    },
    async install() {
      status = { ...status, phase: 'downloading', total: 30 * 1048576, downloaded: 0 };
      for (let step = 1; step <= 6; step++) { await pause(250); status = { ...status, downloaded: step * 5 * 1048576 }; }
      status = { ...status, phase: 'installing' }; await pause(500);
      status = { ...status, phase: scenario === 'invalid' ? 'error' : 'restarting', error: scenario === 'invalid' ? 'update_signature' : null };
      return { ...status };
    },
  };
}

import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const temporary = mkdtempSync(join(tmpdir(),'agent-world-icon-'));
execFileSync('node_modules/.bin/tauri',['icon','src-tauri/icons/agent-world.svg','--output',temporary],{stdio:'inherit'});
copyFileSync(join(temporary,'icon.icns'),'src-tauri/icons/agent-world.icns');
console.log('Generated macOS icon from the repository SVG.');

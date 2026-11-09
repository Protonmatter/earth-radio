// Format conversion of the approved PNG; uses the existing locked builder toolset.
import assert from 'node:assert/strict';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runIconsTool } from 'app-builder-lib/out/toolsets/icons.js';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.build', 'desktop-icons');
await runIconsTool({ inputFile: path.join(root, 'site/branding/earth-radio-app-icon-512.png'), outputFormat: 'ico', outDir: output });
const generated = path.join(output, 'icon.ico'), target = path.join(root, 'site/branding/earth-radio-desktop.ico');
if (process.argv.includes('--check')) assert.deepEqual(await readFile(target), await readFile(generated), 'Committed desktop icon is stale');
else await copyFile(generated, target);
console.log(process.argv.includes('--check') ? 'Desktop icon matches the approved PNG conversion' : 'Desktop icon regenerated from the approved PNG');

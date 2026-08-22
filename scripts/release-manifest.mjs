import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const includeRoots = ['dist', 'electron', 'server', 'docs', 'tests', 'recovered_src', 'scripts'];
const files = [];

for (const relRoot of includeRoots) walk(path.join(root, relRoot));
files.push(path.join(root, 'package.json'));
files.push(path.join(root, 'electron-builder.yml'));

const entries = files
  .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
  .sort()
  .map(file => {
    const data = fs.readFileSync(file);
    return {
      path: path.relative(root, file).replace(/\\/g, '/'),
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex')
    };
  });

const manifest = {
  name: 'Earth Radio',
  version: '0.24.0',
  generatedAt: new Date().toISOString(),
  artifactType: 'source-ready-desktop-web-package',
  files: entries
};

fs.writeFileSync(path.join(root, 'RELEASE_MANIFEST.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(root, 'sha256sums.txt'), entries.map(item => `${item.sha256}  ${item.path}`).join('\n') + '\n');
console.log(`release manifest wrote ${entries.length} file hashes`);

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else files.push(full);
  }
}

// After an audited runtime integration edit, derive its immutable filename and
// update current shell/test references together. Does not touch historical docs.
import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function fingerprintRuntime(root) {
  const html = await readFile(path.join(root, 'site/index.html'), 'utf8');
  const previous = html.match(/assets\/(index-[A-Za-z0-9_-]{8})\.js/)?.[1];
  if (!previous) throw new Error('Cannot find the single immutable runtime in site/index.html');
  const file = path.join(root, 'site/assets', `${previous}.js`);
  const data = await readFile(file);
  const next = `index-${createHash('sha256').update(data).digest('hex').slice(0, 8)}`;
  const overlayPath = path.join(root, 'docs/provenance/hardening-overlays.json');
  const overlay = JSON.parse(await readFile(overlayPath, 'utf8'));
  if (overlay.schemaVersion !== 1 || !Array.isArray(overlay.files)) throw new Error('Invalid hardening overlay schema');
  // Read every reference before mutating. The filename regex keeps both rename
  // endpoints within site/assets, even when called against another checkout.
  const references = ['site/index.html', 'site/sw.js', 'site/_headers',
    ...(await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.mjs')).map(name => `tests/${name}`)];
  const changes = [];
  for (const relative of references) {
    const target = path.join(root, relative), before = await readFile(target, 'utf8');
    if (before.includes(previous)) changes.push([target, before.replaceAll(previous, next)]);
  }
  if (previous !== next) await rename(file, path.join(root, 'site/assets', `${next}.js`));
  for (const [target, after] of changes) await writeFile(target, after);
  // The overlay records current identity separately from immutable recovery intake.
  // Keep the runtime path and the two shell identities synchronized. Rationale for
  // an audited behavior change is still maintained by the engineer in that record.
  for (const entry of overlay.files) {
    const isRuntime = /^site\/assets\/index-[A-Za-z0-9_-]{8}\.js$/.test(entry.path);
    if (!isRuntime && !['site/index.html', 'site/sw.js'].includes(entry.path)) continue;
    if (isRuntime) entry.path = `site/assets/${next}.js`;
    const current = await readFile(path.join(root, ...entry.path.split('/')));
    entry.current = { bytes: current.length, sha256: createHash('sha256').update(current).digest('hex') };
  }
  await writeFile(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  process.stdout.write(`Runtime fingerprint: ${await fingerprintRuntime(root)}.js\n`);
}

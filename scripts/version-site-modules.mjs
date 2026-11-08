// Keep mutable ESM singletons and styles on one release URL, including when an
// older installed service worker handles the first navigation after deployment.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function versionSiteModules(root, { check = false } = {}) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version');
  const files = ['site/index.html', 'site/config.js', 'site/sw.js'];
  for (const directory of ['site/assets', 'site/i18n']) for (const entry of await readdir(path.join(root, directory))) {
    if (/\.(js|css)$/.test(entry) && !/^map-(world|detail|terrain|roads)(?:-[a-f0-9]{8})?\.js$/.test(entry)) files.push(`${directory}/${entry}`);
  }
  const changed = [];
  for (const relative of files) {
    const target = path.join(root, relative), before = await readFile(target, 'utf8');
    const after = before.replace(/(["'`])(\.{1,2}\/[^"'`\s?#]+\.(?:js|css))(?:\?v=\d+\.\d+\.\d+)?\1/g,
      (match, quote, asset) => /(?:index-[\w-]{8}|hls\.light-[\w-]{8}|map-(?:world|detail|terrain|roads)(?:-[a-f0-9]{8})?)\.(?:js|css)$/.test(asset) || asset === './sw.js'
        ? match : `${quote}${asset}?v=${version}${quote}`);
    if (after !== before) { changed.push(relative); if (!check) await writeFile(target, after); }
  }
  if (check && changed.length) throw new Error(`Module release URLs are stale: ${changed.join(', ')}`);
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await versionSiteModules(path.resolve(import.meta.dirname, '..'), { check: process.argv.includes('--check') });
  process.stdout.write(`Module release URLs: ${files.length} files ${process.argv.includes('--check') ? 'stale' : 'updated'}\n`);
}

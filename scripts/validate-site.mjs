import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function collectFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
    }
  }
  await walk(root);
  return files.sort();
}

function localAsset(value) {
  if (!value || /^(?:https?:|data:|blob:|#|mailto:)/i.test(value)) return null;
  return value.replace(/^\.\//, '').split(/[?#]/, 1)[0].replace(/\/$/, 'index.html');
}

function parseHeaderRules(source) {
  const rules = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: trimmed, headers: [] };
      rules.push(current);
      continue;
    }
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (current && match) {
      current.headers.push({ name: match[1].trim().toLowerCase(), value: match[2].trim() });
    }
  }
  return rules;
}

function headerPatternMatches(pattern, relative) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(`/${relative}`);
}

function isFingerprintedAsset(relative) {
  return /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(relative));
}

export async function validateSite(rootInput) {
  const root = path.resolve(rootInput);
  const files = await collectFiles(root);
  const fileSet = new Set(files);
  const errors = [];
  for (const required of ['index.html', 'config.js', 'sw.js', 'manifest.webmanifest', '_headers']) {
    if (!fileSet.has(required)) errors.push(`Missing required file: ${required}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const assets = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const asset = localAsset(match[1]);
    if (asset) assets.push(asset);
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons ?? []) {
    const asset = localAsset(icon.src);
    if (asset) assets.push(asset);
  }
  const serviceWorker = await readFile(path.join(root, 'sw.js'), 'utf8');
  for (const match of serviceWorker.matchAll(/["'](\.\/[^"']*)["']/g)) {
    const asset = localAsset(match[1]);
    if (asset && asset !== 'index.html') assets.push(asset);
  }
  for (const asset of [...new Set(assets)].sort()) {
    if (!fileSet.has(asset)) errors.push(`Missing asset referenced by site: ${asset}`);
  }

  const headerRules = parseHeaderRules(await readFile(path.join(root, '_headers'), 'utf8'));
  for (const relative of files.filter(file => file.startsWith('assets/') && !isFingerprintedAsset(file))) {
    const cacheControl = headerRules
      .filter(rule => headerPatternMatches(rule.pattern, relative))
      .flatMap(rule => rule.headers)
      .filter(header => header.name === 'cache-control')
      .map(header => header.value)
      .join(', ');
    if (/\bimmutable\b/i.test(cacheControl)) {
      errors.push(`Non-fingerprinted asset ${relative} inherits immutable caching`);
    }
  }

  const config = await readFile(path.join(root, 'config.js'), 'utf8');
  if (!/proxyBaseUrl:\s*desktopProxyBaseUrl\s*\|\|\s*['"]{2}/.test(config)) {
    errors.push('config.js does not fail closed to browser-direct mode');
  }
  const textExtensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '']);
  const forbidden = /localhost|127\.0\.0\.1|file:\/\/|[A-Za-z]:\\Users\\/i;
  for (const relative of files) {
    if (!textExtensions.has(path.extname(relative))) continue;
    const content = await readFile(path.join(root, ...relative.split('/')), 'utf8');
    if (forbidden.test(content)) errors.push(`Forbidden local reference in ${relative}`);
    if (/[/#@]\s*sourceMappingURL\s*=/i.test(content)) {
      errors.push(`Source map reference is not deployable in ${relative}`);
    }
  }
  if (files.some(file => file.endsWith('.map'))) errors.push('Source maps are not deployable');
  if (errors.length) throw new Error(errors.sort().join('\n'));
  return { ok: true, files, assets: [...new Set(assets)].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? 'site');
  const result = await validateSite(root);
  process.stdout.write(`Validated ${result.files.length} site files and ${result.assets.length} references.\n`);
}

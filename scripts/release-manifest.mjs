import crypto from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const includeRoots = ['.github', 'site', 'electron', 'server', 'docs', 'tests', 'src-recovered', 'scripts'];
const includeFiles = ['package.json', 'package-lock.json', 'electron-builder.yml'];

async function collectFiles(root) {
  const files = [];
  async function walk(relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }

  for (const relativeRoot of includeRoots) await walk(relativeRoot);
  for (const relative of includeFiles) {
    try {
      if ((await stat(path.join(root, relative))).isFile()) files.push(relative);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b, 'en'));
}

export async function buildReleaseManifest(rootInput) {
  const root = path.resolve(rootInput);
  const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const files = await collectFiles(root);
  const entries = [];
  for (const relative of files) {
    const data = await readFile(path.join(root, ...relative.split('/')));
    entries.push({
      path: relative,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex')
    });
  }
  return {
    name: 'Earth Radio',
    version: packageMetadata.version,
    artifactType: 'recovered-source-and-static-site',
    files: entries
  };
}

export async function writeReleaseManifest(rootInput) {
  const root = path.resolve(rootInput);
  const manifest = await buildReleaseManifest(root);
  const checksumText = `${manifest.files.map(item => `${item.sha256}  ${item.path}`).join('\n')}\n`;
  await writeFile(path.join(root, 'RELEASE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(root, 'sha256sums.txt'), checksumText);
  return manifest;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(modulePath), '..'));
  const manifest = await writeReleaseManifest(root);
  process.stdout.write(`Release manifest wrote ${manifest.files.length} deterministic file hashes.\n`);
}

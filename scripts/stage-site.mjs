import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function assertChild(parent, child) {
  const prefix = `${path.resolve(parent)}${path.sep}`.toLowerCase();
  if (!path.resolve(child).toLowerCase().startsWith(prefix)) {
    throw new Error(`Refusing output outside allowed parent: ${child}`);
  }
}

export async function stageSite({ source, output, allowedOutputParent = path.resolve('.') }) {
  source = path.resolve(source);
  output = path.resolve(output);
  assertChild(allowedOutputParent, output);
  await rm(output, { recursive: true, force: true });
  const included = [];
  const excluded = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(source, absolute).replaceAll(path.sep, '/');
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Symbolic link is not deployable: ${relative}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        if (relative.endsWith('.map')) { excluded.push(relative); continue; }
        const target = path.join(output, ...relative.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(absolute, target);
        included.push(relative);
      }
    }
  }

  await walk(source);
  const files = [];
  for (const relative of included.sort()) {
    const file = path.join(output, ...relative.split('/'));
    files.push({ path: relative, bytes: (await stat(file)).size, sha256: await sha256(file) });
  }
  await writeFile(path.join(output, 'asset-manifest.json'), `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`);
  return { included: included.sort(), excluded: excluded.sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await stageSite({ source: path.join(root, 'site'), output: path.join(root, '.build', 'site'), allowedOutputParent: root });
  process.stdout.write(`Staged ${result.included.length} files; excluded ${result.excluded.length}.\n`);
}

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inventoryTree(rootInput, source) {
  const root = path.resolve(rootInput instanceof URL ? fileURLToPath(rootInput) : rootInput);
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  const rows = [];
  for (const file of files) {
    const metadata = await stat(file);
    rows.push({
      path: path.relative(root, file).replaceAll(path.sep, '/'),
      bytes: metadata.size,
      sha256: await sha256File(file),
      source
    });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function writeInventory({ roots, output }) {
  const files = [];
  for (const item of roots) files.push(...await inventoryTree(item.root, item.source));
  files.sort((a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`, 'utf8');
}

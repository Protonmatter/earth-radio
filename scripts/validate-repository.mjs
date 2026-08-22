import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const forbiddenNames = new Set(['.env', '.env.local', 'credentials.json', 'cookies.txt']);
const forbiddenExtensions = new Set(['.exe', '.appimage', '.asar', '.pfx', '.p12', '.pem', '.key']);
const forbiddenDirectories = new Set(['node_modules', '.build', '.recovery', 'release', 'earth-radio-user-data']);
const binaryExtensions = new Set(['.png', '.ico', '.jpg', '.jpeg', '.gif', '.webp']);

async function filesystemFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
    }
  }
  await walk(root);
  return files.sort();
}

async function candidateFiles(root) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'buffer' });
    return stdout.toString('utf8').split('\0').filter(Boolean).sort();
  } catch {
    return filesystemFiles(root);
  }
}

function hasRealSecretAssignment(text) {
  const assignment = /\b(?:SPOTIFY_CLIENT_SECRET|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|GITHUB_TOKEN)\s*=\s*([^\s`"']+)/gi;
  for (const match of text.matchAll(assignment)) {
    const value = match[1].trim();
    if (/^(?:<[^>]+>|\.\.\.|x|example|\$\{[^}]+\})$/i.test(value)) continue;
    return true;
  }
  return false;
}

export async function validateRepository(rootInput) {
  const root = path.resolve(rootInput);
  const errors = [];
  const files = await candidateFiles(root);
  for (const relative of files) {
    const normalized = relative.replaceAll('\\', '/');
    const parts = normalized.toLowerCase().split('/');
    const base = parts.at(-1);
    const extension = path.extname(base).toLowerCase();
    if (forbiddenNames.has(base)) errors.push(`Forbidden credential file: ${normalized}`);
    if (forbiddenExtensions.has(extension)) errors.push(`Forbidden artifact extension ${extension}: ${normalized}`);
    if (parts.slice(0, -1).some(part => forbiddenDirectories.has(part))) errors.push(`Forbidden tracked directory: ${normalized}`);
    if (binaryExtensions.has(extension)) continue;
    let data;
    try { data = await readFile(path.join(root, ...normalized.split('/'))); } catch { continue; }
    if (data.includes(0)) continue;
    const text = data.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) errors.push(`Private key material in ${normalized}`);
    if (/\b(?:gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text)) errors.push(`GitHub token pattern in ${normalized}`);
    if (hasRealSecretAssignment(text)) errors.push(`Real secret assignment in ${normalized}`);
  }
  return [...new Set(errors)].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await validateRepository(path.resolve(process.argv[2] ?? '.'));
  if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Repository safety validation passed.\n');
  }
}

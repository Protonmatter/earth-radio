import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const forbiddenNames = new Set(['credentials.json', 'cookies.txt']);
// Any dotenv variant is forbidden except the documented example file.
const isDotenvName = base => base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
const forbiddenExtensions = new Set(['.exe', '.appimage', '.asar', '.pfx', '.p12', '.pem', '.key']);
const forbiddenDirectories = new Set(['node_modules', '.build', '.recovery', 'release', 'earth-radio-user-data']);
const binaryExtensions = new Set(['.png', '.ico', '.jpg', '.jpeg', '.gif', '.webp']);

async function filesystemFiles(root) {
  const files = [];
  const ignoredDirectories = await gitignoredDirectoryNames(root);
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
    }
  }
  await walk(root);
  return files.sort();
}

// When git is unavailable the walk must approximate the git index, or every file in
// node_modules/.build would be misreported as a forbidden tracked directory. Only
// plain directory-name patterns from the root .gitignore are honored.
async function gitignoredDirectoryNames(root) {
  try {
    const text = await readFile(path.join(root, '.gitignore'), 'utf8');
    return new Set(text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('!') && /^[A-Za-z0-9._-]+\/?$/.test(line))
      .map(line => line.replace(/\/$/, '')));
  } catch {
    return new Set();
  }
}

async function candidateFiles(root) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'buffer' });
    return stdout.toString('utf8').split('\0').filter(Boolean).sort();
  } catch (error) {
    process.stderr.write(`validate-repository: git ls-files unavailable (${error?.code || error?.message || 'unknown'}); walking the filesystem instead.\n`);
    return filesystemFiles(root);
  }
}

function hasRealSecretAssignment(text) {
  const assignment = /\b(?:SPOTIFY_CLIENT_SECRET|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|GITHUB_TOKEN|ACR_ACCESS_SECRET|AUDD_API_TOKEN)\s*=\s*["'`]?([^\s"'`]+)/gi;
  for (const match of text.matchAll(assignment)) {
    const value = match[1].trim();
    if (/^(?:<[^>]+>|\.\.\.|x|example|\$\{[^}]+\})$/i.test(value)) continue;
    return true;
  }
  return false;
}

// The Pages Functions fetch listener-supplied stream URLs, so the deployable
// Cloudflare configuration is a security control: `global_fetch_strictly_public`
// must stay declared and `global_fetch_private_origin` must never appear. JSONC
// comments are stripped before parsing (string literals in this file never
// contain `//`, so a line-based strip is sufficient).
export async function validateCloudflareConfig(root) {
  const errors = [];
  const configPath = path.join(root, 'wrangler.jsonc');
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    let hasFunctions;
    try { hasFunctions = (await readdir(path.join(root, 'functions'))).length > 0; } catch { hasFunctions = false; }
    if (hasFunctions) errors.push('Missing wrangler.jsonc: Pages Functions require the strict-public fetch configuration');
    return errors;
  }
  let config;
  try {
    config = JSON.parse(raw.split(/\r?\n/).filter(line => !line.trim().startsWith('//')).join('\n'));
  } catch {
    errors.push('wrangler.jsonc is not parseable JSONC');
    return errors;
  }
  const flags = Array.isArray(config.compatibility_flags) ? config.compatibility_flags : [];
  if (!flags.includes('global_fetch_strictly_public')) {
    errors.push('wrangler.jsonc must declare the global_fetch_strictly_public compatibility flag');
  }
  if (flags.includes('global_fetch_private_origin')) {
    errors.push('wrangler.jsonc must never declare the global_fetch_private_origin compatibility flag');
  }
  return errors;
}

export async function validateRepository(rootInput) {
  const root = path.resolve(rootInput);
  const errors = [];
  errors.push(...await validateCloudflareConfig(root));
  const files = await candidateFiles(root);
  for (const relative of files) {
    const normalized = relative.replaceAll('\\', '/');
    const parts = normalized.toLowerCase().split('/');
    const base = parts.at(-1);
    const extension = path.extname(base).toLowerCase();
    if (forbiddenNames.has(base) || isDotenvName(base)) errors.push(`Forbidden credential file: ${normalized}`);
    if (forbiddenExtensions.has(extension)) errors.push(`Forbidden artifact extension ${extension}: ${normalized}`);
    if (parts.slice(0, -1).some(part => forbiddenDirectories.has(part))) errors.push(`Forbidden tracked directory: ${normalized}`);
    if (binaryExtensions.has(extension)) continue;
    let data;
    try { data = await readFile(path.join(root, ...normalized.split('/'))); } catch { continue; }
    if (data.includes(0)) continue;
    const text = data.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) errors.push(`Private key material in ${normalized}`);
    if (/\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text)) errors.push(`GitHub token pattern in ${normalized}`);
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

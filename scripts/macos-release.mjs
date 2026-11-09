import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function releaseIdentity({ tag, sha, version, arch }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`) throw new Error('Release tag must match the application version');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('An immutable source commit is required');
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported macOS architecture');
  return { tag, sha, version, arch, artifactName: `EarthRadio-${version}-macOS-${arch}-unnotarized.dmg` };
}

export function candidateIdentity({ sha, version, arch }) {
  const { tag: _tag, ...identity } = releaseIdentity({ tag: `v${version}`, sha, version, arch });
  return { ...identity, candidate: true,
    artifactName: `EarthRadio-Candidate-${version}-${sha.slice(0, 12)}-macOS-${arch}-unnotarized.dmg` };
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options }).trim();

async function sourceFiles(root, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files.sort();
}

export async function stopReleaseChild(child, closed, { termMs = 5000, killMs = 2000 } = {}) {
  if (![termMs, killMs].every(value => Number.isInteger(value) && value >= 0 && value <= 30000)) throw new Error('Invalid shutdown deadline');
  const finishedWithin = milliseconds => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    closed.then(() => { clearTimeout(timer); resolve(true); });
  });
  child.kill('SIGTERM');
  if (await finishedWithin(termMs)) return;
  child.kill('SIGKILL');
  if (!await finishedWithin(killMs)) throw new Error('Packaged-app cleanup deadline exceeded; isolated profile retained');
}

export async function startupSmoke(binary, extraArguments = []) {
  const profile = await mkdtemp(path.join(tmpdir(), 'earth-radio-release-'));
  const child = spawn(binary, [...extraArguments, `--user-data-dir=${profile}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', ready = false, exited = false;
  const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
  // A helper can retain inherited pipes after the main process exits. Liveness
  // follows exit; close is reserved for confirming cleanup of owned streams.
  child.once('exit', () => { exited = true; });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-4096); ready ||= /desktop proxy listening on http:\/\/127\.0\.0\.1:\d+/.test(output); });
  // Keep errors for the bounded assertion, never record profile/capability contents.
  let failure = '';
  child.once('error', error => { failure = error.message; });
  child.stderr.on('data', () => {});
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (ready || exited || failure) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready && !exited && !failure, 'Packaged app did not reach bounded proxy startup');
    await new Promise(resolve => setTimeout(resolve, 3000));
    assert.equal(exited, false, 'Packaged app exited immediately after startup');
    return { proxyStarted: true, remainedRunning: true, isolatedProfile: true, audioPlaybackTested: false };
  } finally {
    await stopReleaseChild(child, closed);
    await rm(profile, { recursive: true, force: true });
  }
}

export async function buildMacRelease(sourceInput, arch, environment = process.env) {
  if (process.platform !== 'darwin') throw new Error('Build and qualification require a macOS host');
  assert.equal(process.arch, arch, 'Use a native runner for each release architecture');
  const source = await realpath(sourceInput);
  const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  const candidate = environment.RELEASE_CANDIDATE === '1';
  const input = { tag: environment.RELEASE_TAG, sha: environment.RELEASE_SOURCE_SHA, version: metadata.version, arch };
  const identity = candidate ? candidateIdentity(input) : releaseIdentity(input);
  assert.equal(run('git', ['-C', source, 'rev-parse', 'HEAD']), identity.sha);
  if (!candidate) {
    const refs = run('git', ['-C', source, 'ls-remote', '--tags', 'origin', `refs/tags/${identity.tag}`, `refs/tags/${identity.tag}^{}`]);
    const tagRefs = new Map(refs.split('\n').filter(Boolean).map(line => { const [sha, ref] = line.split(/\s+/); return [ref, sha]; }));
    assert.equal(tagRefs.get(`refs/tags/${identity.tag}^{}`) || tagRefs.get(`refs/tags/${identity.tag}`), identity.sha, 'Tag/source mismatch');
  }
  const require = createRequire(path.join(source, 'package.json'));
  const yaml = require('js-yaml');
  const asar = await import(pathToFileURL(require.resolve('@electron/asar')).href);
  const work = path.join(source, '.build', 'macos-release-build');
  const output = path.join(source, '.build', 'macos-release');
  const iconset = path.join(work, 'earth-radio.iconset');
  await mkdir(iconset, { recursive: true });
  await mkdir(output, { recursive: true });
  const master = path.join(source, 'site', 'branding', 'earth-radio-app-icon-512.png');
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) run('sips', ['-z', String(size * scale), String(size * scale), master, '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
  const icon = path.join(work, 'earth-radio.icns');
  run('iconutil', ['-c', 'icns', iconset, '-o', icon]);
  const config = yaml.load(await readFile(path.join(source, 'electron-builder.yml'), 'utf8'));
  config.beforePack = path.join(source, 'scripts', 'desktop-package-compat.mjs');
  config.directories = { ...config.directories, output };
  config.mac = { ...config.mac, icon, identity: '-', hardenedRuntime: true, notarize: false, artifactName: identity.artifactName };
  const configFile = path.join(work, 'electron-builder.json');
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
  execFileSync(path.join(source, 'node_modules', '.bin', 'electron-builder'), ['--mac', 'dmg', `--${arch}`, '--config', configFile, '--publish', 'never'], {
    cwd: source, stdio: 'inherit', env: { ...environment, CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      // Candidate CI is secretless and identity is explicitly ad-hoc. Builder's
      // general PR safeguard otherwise skips even this certificate-free signing.
      ...(candidate ? { CSC_FOR_PULL_REQUEST: 'true' } : {}) }
  });
  const dmg = path.join(output, identity.artifactName);
  run('hdiutil', ['verify', dmg]);
  const mount = await mkdtemp(path.join(tmpdir(), 'earth-radio-dmg-'));
  let attached = false;
  let report;
  try {
    run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]);
    attached = true;
    const apps = (await readdir(mount)).filter(name => name.endsWith('.app'));
    assert.equal(apps.length, 1);
    const app = path.join(mount, apps[0]), contents = path.join(app, 'Contents');
    const plist = path.join(contents, 'Info.plist');
    const property = key => run('plutil', ['-extract', key, 'raw', '-o', '-', plist]);
    assert.equal(property('CFBundleIdentifier'), 'com.protonmatter.earthradio');
    assert.equal(property('CFBundleShortVersionString'), identity.version);
    const binary = path.join(contents, 'MacOS', property('CFBundleExecutable'));
    assert.equal(run('lipo', ['-archs', binary]), arch === 'x64' ? 'x86_64' : 'arm64');
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const signature = spawnSync('codesign', ['-d', '--verbose=4', app], { encoding: 'utf8' });
    assert.equal(signature.status, 0, 'Could not inspect the app signature');
    assert.match(signature.stderr, /Signature=adhoc/, 'Expected the explicitly labeled ad-hoc signature');
    const iconName = property('CFBundleIconFile');
    assert.equal(path.basename(iconName), iconName, 'Unexpected packaged icon path');
    const packagedIconSha256 = digest(await readFile(path.join(contents, 'Resources', iconName)));
    assert.equal(packagedIconSha256, digest(await readFile(icon)), 'Packaged ICNS differs from generated identity');
    const archive = path.join(contents, 'Resources', 'app.asar');
    let matchedFiles = 0;
    for (const directory of ['site', 'electron', 'server']) {
      for (const relative of await sourceFiles(source, directory)) {
        if (relative === path.join('server', 'example-proxy.mjs')) continue;
        assert.equal(digest(asar.extractFile(archive, relative)), digest(await readFile(path.join(source, relative))), `Packaged source mismatch: ${relative}`);
        matchedFiles++;
      }
    }
    assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, identity.version);
    const startup = await startupSmoke(binary);
    const bytes = await readFile(dmg);
    report = { ...identity, bytes: bytes.length, sha256: digest(bytes), minimumMacOS: property('LSMinimumSystemVersion'),
      adHocSigned: true, notarized: false, dmgVerified: true, mountedReadOnly: true, matchedFiles, startup,
      iconSha256: digest(await readFile(icon)), packagedIconSha256,
      iconSource: 'site/branding/earth-radio-app-icon-512.png', iconSourceSha256: digest(await readFile(master)),
      workflowCommit: environment.GITHUB_SHA || '' };
  } finally {
    if (attached) run('hdiutil', ['detach', mount]);
    await rm(mount, { recursive: true, force: true });
  }
  await writeFile(path.join(output, `verification-${arch}.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(output, `SHA256SUMS-macos-${arch}.txt`), `${report.sha256}  ${identity.artifactName}\n`);
  console.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMacRelease(process.argv[2], process.argv[3]);
}

// Optional real-runtime verification using an already installed Wrangler/Miniflare.
// No dependency is installed, no remote resource is deployed, no credentials are read.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argument = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const cli = argument('--wrangler') || process.env.WRANGLER_CLI;
if (!cli) throw new Error('Provide --wrangler <installed Wrangler CLI path> or WRANGLER_CLI.');
const workerConfig = JSON.parse(await readFile(path.join(root, 'workers/rate-limit/wrangler.jsonc'), 'utf8'));
const date = argument('--compatibility-date') || workerConfig.compatibility_date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid compatibility date');
const require = createRequire(path.resolve(cli));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve('miniflare')).href);
const directory = path.join(root, '.build', 'qualification', 'edge-runtime');
await mkdir(directory, { recursive: true });
const entry = `import { MetadataRateLimit as Base } from ${JSON.stringify(pathToFileURL(path.join(root, 'workers/rate-limit/index.js')).href)};
export class MetadataRateLimit extends Base {
  async expireForTest(kind) {
    const old=Date.now()-120001;
    if(kind==='all') this.ctx.storage.sql.exec('UPDATE quotas SET touched_at=?, accepted=?, blocked_until=0',old,JSON.stringify([old]));
    else this.ctx.storage.sql.exec('UPDATE quotas SET touched_at=?, accepted=?, blocked_until=0 WHERE kind=?',old,JSON.stringify([old]),kind);
    await this.alarm();
    return { tablePresent: this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='quotas'").toArray().length>0 };
  }
}
export default { async fetch(request,env) {
  const u=new URL(request.url),stub=env.LIMITS.getByName(u.searchParams.get('client')||'a');
  if(u.searchParams.has('expire'))return Response.json(await stub.expireForTest(u.searchParams.get('expire')));
  const r=await stub.check(u.searchParams.get('kind')||'nowplaying');return Response.json(r,{status:r.allowed?200:429});
} };`;
// esbuild accepts a filesystem import for the local source (Windows file URLs do not bundle).
await writeFile(path.join(directory, 'entry.js'), entry.replace(pathToFileURL(path.join(root, 'workers/rate-limit/index.js')).href, path.join(root, 'workers/rate-limit/index.js').replaceAll('\\', '/')));
await writeFile(path.join(directory, 'wrangler.jsonc'), JSON.stringify({ ...workerConfig, name: 'earth-radio-rate-runtime-test', main: 'entry.js', compatibility_date: date }));
const compiled = path.join(directory, 'compiled');
const build = spawnSync(process.execPath, [path.resolve(cli), 'deploy', '--config', path.join(directory, 'wrangler.jsonc'), '--dry-run', '--outdir', compiled], { cwd: root, timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
if (build.status !== 0) throw new Error(`Runtime fixture build failed: ${String(build.stderr).slice(-1000)}`);
const storage = await mkdtemp(path.join(directory, 'state-'));
const legacy = { modules: true, scriptPath: path.join(compiled, 'entry.js'), compatibilityDate: date, durableObjects: { LIMITS: { className: 'MetadataRateLimit', useSQLite: true } }, resourcePersistencePath: storage };
const options = convertV4MiniflareOptions ? convertV4MiniflareOptions(legacy) : legacy;
let runtime = new Miniflare(options);
const request = query => runtime.dispatchFetch(`https://runtime.invalid/?${query}`);
const burst = async (kind, count) => Promise.all(Array.from({ length: count }, async () => (await request(`kind=${kind}`)).status));
try {
  const nowplaying = await burst('nowplaying', 32), fingerprint = await burst('fingerprint', 8);
  assert.equal(nowplaying.filter(s => s === 200).length, 30); assert.equal(nowplaying.filter(s => s === 429).length, 2);
  assert.equal(fingerprint.filter(s => s === 200).length, 6); assert.equal(fingerprint.filter(s => s === 429).length, 2);
  assert.equal((await request('client=b')).status, 200);
  await runtime.dispose(); runtime = new Miniflare(options);
  assert.equal((await request('kind=nowplaying')).status, 429);
  assert.equal((await (await request('expire=nowplaying')).json()).tablePresent, true);
  assert.equal((await request('kind=fingerprint')).status, 429);
  assert.equal((await request('kind=nowplaying')).status, 200);
  assert.equal((await (await request('expire=all')).json()).tablePresent, false);
  const afterCleanup = await burst('nowplaying', 32);
  assert.equal(afterCleanup.filter(s => s === 200).length, 30); assert.equal(afterCleanup.filter(s => s === 429).length, 2);
  const result = { compatibilityDate: date, productionCompatibilityDate: workerConfig.compatibility_date, nowplaying: { allowed: 30, blocked: 2 }, fingerprint: { allowed: 6, blocked: 2 }, independentClient: true, persistedAfterRestart: true, partialExpiryRetainsOtherKind: true, emptyStorageDeleted: true, freshConcurrentBudgetAfterCleanup: true };
  await writeFile(path.join(root, '.build/qualification/rate-runtime.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }

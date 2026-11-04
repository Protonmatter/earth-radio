import { DurableObject } from 'cloudflare:workers';
import { advanceQuota, LIMITS, RETENTION_MS } from './policy.mjs';

// No public route. Pages accesses this class through a private namespace binding.
export class MetadataRateLimit extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.#ensureSchema();
  }

  #ensureSchema() { this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS quotas (kind TEXT PRIMARY KEY, accepted TEXT NOT NULL, blocked_until INTEGER NOT NULL, touched_at INTEGER NOT NULL)'); }

  async check(kind) {
    if (!Object.hasOwn(LIMITS, kind)) throw new Error('Unsupported quota');
    this.#ensureSchema();
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec('SELECT accepted, blocked_until AS blockedUntil, touched_at AS touchedAt FROM quotas WHERE kind = ?', kind).toArray()[0];
      const previous = row ? { ...row, accepted: JSON.parse(row.accepted) } : undefined;
      const decision = advanceQuota(previous, LIMITS[kind], now);
      const state = decision.state;
      this.ctx.storage.sql.exec('INSERT INTO quotas (kind, accepted, blocked_until, touched_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET accepted=excluded.accepted, blocked_until=excluded.blocked_until, touched_at=excluded.touched_at', kind, JSON.stringify(state.accepted), state.blockedUntil, state.touchedAt);
      return decision;
    });
    const { expiry } = this.ctx.storage.sql.exec('SELECT MIN(touched_at) + ? AS expiry FROM quotas', RETENTION_MS).one();
    await this.ctx.storage.setAlarm(expiry);
    return { allowed: result.allowed, remaining: result.remaining, retryAfter: result.retryAfter };
  }

  async alarm() {
    this.#ensureSchema();
    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM quotas WHERE touched_at <= ?', now - RETENTION_MS);
    const { expiry } = this.ctx.storage.sql.exec('SELECT MIN(touched_at) + ? AS expiry FROM quotas', RETENTION_MS).one();
    if (expiry === null) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Math.max(now + 1, expiry));
  }
}

export default { fetch() { return new Response('Not found', { status: 404 }); } };

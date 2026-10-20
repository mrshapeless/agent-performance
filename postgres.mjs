import { createHash } from 'node:crypto';

// One artist. This transaction lock serializes state changes across all instances.
const LOCK = 730201;
export class PostgresStore {
  constructor(pool) { this.pool = pool; }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async append(client, kind, payload) {
    const previous = (await client.query('SELECT digest FROM agent_events ORDER BY seq DESC LIMIT 1')).rows[0]?.digest ?? '';
    const created = new Date().toISOString();
    const text = JSON.stringify(payload);
    const digest = createHash('sha256').update(JSON.stringify([kind, text, created, previous])).digest('hex');
    await client.query('INSERT INTO agent_events(kind,payload,created,previous,digest) VALUES($1,$2,$3,$4,$5)',
      [kind, text, created, previous, digest]);
  }
  async begin(id, kind, buildRequest) {
    return this.transaction(async client => {
      const existing = (await client.query('SELECT kind,status,result FROM agent_operations WHERE id=$1', [id])).rows[0];
      if (existing) {
        if (existing.kind !== kind) throw Error('OPERATION_CONFLICT');
        return { replay: true, status: existing.status, result: existing.result };
      }
      if ((await client.query("SELECT id FROM agent_operations WHERE status='pending' LIMIT 1")).rowCount)
        throw Error('UNRESOLVED_OPERATION');
      const identityRow = (await client.query("SELECT payload FROM agent_events WHERE kind='identity' ORDER BY seq DESC LIMIT 1")).rows[0];
      const identity = identityRow ? JSON.parse(identityRow.payload) : null;
      if (kind === 'birth' && identity) throw Error('ALREADY_BORN');
      if (kind === 'step' && !identity) throw Error('NOT_BORN');
      const recent = (await client.query("SELECT kind,payload FROM agent_events WHERE kind IN ('draft_text','wait') ORDER BY seq DESC LIMIT 10"))
        .rows.reverse().map(e => ({ kind: e.kind, payload: JSON.parse(e.payload) }));
      const request = buildRequest(identity, recent);
      if (!Number.isSafeInteger(request.maximum) || request.maximum < 0) throw Error('INVALID_COST');
      const { day, spent } = (await client.query(`SELECT
        (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date::text AS day,
        COALESCE(SUM(amount),0)::text AS spent FROM agent_operations
        WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date`)).rows[0];
      if (Number(spent) + request.maximum > 50_000_000) throw Error('DAILY_ALLOWANCE_EXHAUSTED');
      await client.query("INSERT INTO agent_operations(id,kind,day,amount,status) VALUES($1,$2,$3,$4,'pending')",
        [id, kind, day, request.maximum]);
      await this.append(client, 'operation_started', { id, kind, day, reservedMicrodollars: request.maximum });
      return { replay: false, ...request };
    });
  }
  async complete(id, cost, result) {
    if (!Number.isSafeInteger(cost) || cost < 0) throw Error('INVALID_COST');
    return this.transaction(async client => {
      const row = (await client.query('SELECT * FROM agent_operations WHERE id=$1', [id])).rows[0];
      if (!row) throw Error('UNKNOWN_OPERATION');
      if (row.status === 'complete') return row.result;
      const kind = row.kind === 'birth' ? 'identity' : result.action;
      await this.append(client, kind, result);
      await this.append(client, 'operation_completed', { id, actualMicrodollars: cost, exceededReservation: cost > Number(row.amount) });
      await client.query("UPDATE agent_operations SET amount=$1,status='complete',result=$2 WHERE id=$3",
        [cost, JSON.stringify(result), id]);
      return result;
    });
  }
  async status() {
    const { rows } = await this.pool.query(`SELECT
      (SELECT payload FROM agent_events WHERE kind='identity' ORDER BY seq DESC LIMIT 1) AS identity,
      (SELECT COUNT(*)::int FROM agent_events) AS events,
      (SELECT COUNT(*)::int FROM agent_operations WHERE status='pending') AS unresolved,
      (SELECT COALESCE(SUM(amount),0)::text FROM agent_operations
        WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date) AS spent`);
    return { identity: rows[0].identity ? JSON.parse(rows[0].identity) : null,
      events: rows[0].events, unresolved: rows[0].unresolved, todayMicrodollars: Number(rows[0].spent) };
  }
}

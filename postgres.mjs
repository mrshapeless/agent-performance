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
        if (kind !== 'auto' && existing.kind !== kind) throw Error('OPERATION_CONFLICT');
        return { replay: true, status: existing.status, result: existing.result };
      }
      if ((await client.query("SELECT id FROM agent_operations WHERE status='pending' AND (CASE WHEN id LIKE 'x-publish-%' THEN 'x' WHEN id LIKE 'media-%' THEN 'media' ELSE 'agent' END) = $1 LIMIT 1", [id.startsWith('x-publish-')?'x':id.startsWith('media-')?'media':'agent'])).rowCount)
        throw Error('UNRESOLVED_OPERATION');
      const identityRow = (await client.query("SELECT payload FROM agent_events WHERE kind='identity' ORDER BY seq DESC LIMIT 1")).rows[0];
      const identity = identityRow ? JSON.parse(identityRow.payload) : null;
      if (kind === 'auto') kind = identity ? 'step' : 'birth';
      if (kind === 'birth' && identity) throw Error('ALREADY_BORN');
      if (kind === 'step' && !identity) throw Error('NOT_BORN');
      const recent = (await client.query("SELECT seq,kind,payload FROM agent_events WHERE kind IN ('draft_text','wait','reflect','x_post','x_reply','dialogue','record_note','appearance_brief','art_image','art_video','media_review') ORDER BY seq DESC LIMIT 12"))
        .rows.reverse().map(e => ({ seq: String(e.seq), kind: e.kind, payload: JSON.parse(e.payload) }));
      const strategyRow = (await client.query("SELECT seq,payload FROM agent_events WHERE kind='reflect' ORDER BY seq DESC LIMIT 1")).rows[0];
      const since = (await client.query("SELECT COUNT(*)::int AS n FROM agent_events WHERE kind IN ('draft_text','wait') AND seq > $1", [strategyRow?.seq ?? 0])).rows[0].n;
      const observations=(await client.query("SELECT payload FROM agent_events WHERE kind='observation' ORDER BY seq DESC LIMIT 1")).rows[0];
      const external=observations?JSON.parse(observations.payload):null;
      const studioRow=(await client.query("SELECT payload FROM agent_events WHERE kind='studio_revision' ORDER BY seq DESC LIMIT 1")).rows[0];
      const studio=studioRow?JSON.parse(studioRow.payload):null;
      const projectHistory=(await client.query("SELECT seq,kind,payload FROM agent_events WHERE kind IN ('x_post','x_draft','draft_text','dialogue','art_image','art_video','media_review','media_failed','studio_revision') ORDER BY seq DESC LIMIT 60")).rows.reverse().map(r=>({seq:String(r.seq),kind:r.kind,payload:JSON.parse(r.payload)}));
      const request = buildRequest(identity, recent, { kind, external, studio, projectHistory, reflectionDue: since >= 6 || (!!external && !strategyRow?.payload?.includes('experience-v1')),
        strategy: strategyRow ? JSON.parse(strategyRow.payload).text : null });
      if (!Number.isSafeInteger(request.maximum) || request.maximum < 0) throw Error('INVALID_COST');
      const { day, spent } = (await client.query(`SELECT
        (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date::text AS day,
        COALESCE(SUM(amount),0)::text AS spent FROM agent_operations
        WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date`)).rows[0];
      if (Number(spent) + request.maximum > 50_000_000) throw Error('DAILY_ALLOWANCE_EXHAUSTED');
      await client.query("INSERT INTO agent_operations(id,kind,day,amount,status) VALUES($1,$2,$3,$4,'pending')",
        [id, kind, day, request.maximum]);
      await this.append(client, 'operation_started', { id, kind, day, reservedMicrodollars: request.maximum });
      return { replay: false, kind, ...request };
    });
  }
  async complete(id, cost, result, asset) {
    if (!Number.isSafeInteger(cost) || cost < 0) throw Error('INVALID_COST');
    return this.transaction(async client => {
      const row = (await client.query('SELECT * FROM agent_operations WHERE id=$1', [id])).rows[0];
      if (!row) throw Error('UNKNOWN_OPERATION');
      if (row.status === 'complete') return row.result;
      if (asset) await client.query('INSERT INTO agent_assets(id,mime,bytes,url) VALUES ($1,$2,$3,$4)', [id,asset.mime,asset.bytes??null,asset.url??null]);
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
  async latest(kind) {
    const row=(await this.pool.query('SELECT payload FROM agent_events WHERE kind=$1 ORDER BY seq DESC LIMIT 1',[kind])).rows[0];
    return row ? JSON.parse(row.payload) : null;
  }
  async operation(id) {return (await this.pool.query('SELECT status,result FROM agent_operations WHERE id=$1',[id])).rows[0]??null;}
  async asset(id) {return (await this.pool.query('SELECT mime,bytes,url FROM agent_assets WHERE id=$1',[id])).rows[0]??null;}
  async publicRuntime() {
    const state = await this.status();
    const last = (await this.pool.query("SELECT created FROM agent_events WHERE kind='operation_completed' ORDER BY seq DESC LIMIT 1")).rows[0];
    const revision = (await this.pool.query("SELECT COUNT(*)::int AS n FROM agent_events WHERE kind='reflect'")).rows[0].n;
    const started = state.unresolved ? (await this.pool.query("SELECT created FROM agent_events WHERE kind='operation_started' ORDER BY seq DESC LIMIT 1")).rows[0]?.created : null;
    const appearance=await this.latest('appearance_image');
    const mediaJobs=(await this.pool.query("SELECT id,state,created,updated,data->>'error' AS error FROM agent_media_jobs ORDER BY created DESC LIMIT 5")).rows;
    return { studio:await this.latest('studio_revision'), mediaJobs, appearance: appearance ? {assetId:appearance.assetId,alt:appearance.text}:null, unresolved: state.unresolved, pendingSince: started,
      blocked: !!started && Date.now() - Date.parse(started) > 120_000, todayMicrodollars: state.todayMicrodollars,
      lastCompletedAt: last?.created ?? null, strategyRevisions: revision, schedule: 'hourly', reflectionEvery: 6 };
  }
  async publicJournal() {
    const { rows } = await this.pool.query(`SELECT * FROM (
      (SELECT seq,kind,payload,created,digest FROM agent_events WHERE kind='identity' ORDER BY seq DESC LIMIT 1)
      UNION ALL
      (SELECT seq,kind,payload,created,digest FROM agent_events WHERE kind IN ('draft_text','wait','reflect','appearance_brief','appearance_image','x_draft','x_post','account_profile','account_connection','x_failed','observation','dialogue','x_reply','audience_alert','observation_error','record_note','banner_brief','banner_image','art_image','art_video','media_review','media_started','media_failed','studio_revision','studio_failed') ORDER BY seq DESC LIMIT 50)
      ) public_records ORDER BY seq DESC`);
    return rows.map(row => {
      const p = JSON.parse(row.payload);
      const keys = row.kind === 'identity'
        ? ['name','voice','interests','visualDirection','summary'] : ['text','summary','alt','assetId','url','postId','mime','medium','prompt','decision','projectId','intent'];
      return { seq: String(row.seq), kind: row.kind, created: row.created, digest: row.digest,
        content: Object.fromEntries(keys.filter(k => typeof p[k] === 'string').map(k => [k,p[k]])) };
    });
  }
}







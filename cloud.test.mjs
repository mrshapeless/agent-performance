import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PostgresStore } from './postgres.mjs';
import { createHandler, cloudRun } from './cloud.mjs';

const fixture = { name: 'TEST ONLY', voice: 'test', interests: 'test', visualDirection: 'test', summary: 'Synthetic fixture' };
const secret = 'a'.repeat(40);

test('Postgres schema and lifecycle: restart, replay, unresolved exclusion and daily cap', async () => {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const client = {
    query: async (sql, args) => {
      const r = await db.query(sql, args);
      return { ...r, rowCount: r.affectedRows || r.rows.length };
    },
    release() {},
  };
  const pool = { connect: async () => client, query: client.query };
  const store = new PostgresStore(pool);
  try {
    let calls = 0;
    const provider = { quote: () => 100, generate: async () => { calls++; return { value: fixture, costMicrodollars: 20 }; } };
    await cloudRun(store, provider, 'birth', 'birth-1');
    const reopened = new PostgresStore(pool);
    assert.equal((await reopened.status()).identity.name, fixture.name);
    assert.equal((await cloudRun(reopened, provider, 'birth', 'birth-1')).replay, true);
    assert.equal(calls, 1);
    await assert.rejects(cloudRun(store, provider, 'birth', 'birth-2'), /ALREADY_BORN/);
    await assert.rejects(store.begin('too-big', 'step', () => ({ maximum: 50_000_000 })), /ALLOWANCE/);
    await store.begin('pending', 'step', () => ({ maximum: 100 }));
    await assert.rejects(store.begin('blocked', 'step', () => ({ maximum: 100 })), /UNRESOLVED/);
    assert.equal((await store.status()).todayMicrodollars, 120);
    await store.complete('pending', 10, { action: 'wait', text: 'test', summary: 'test' });
    assert.equal((await store.status()).todayMicrodollars, 30);
    const rows = (await client.query('SELECT * FROM agent_events ORDER BY seq')).rows;
    assert.equal(rows.length, 6);
    assert.equal(rows[1].previous, rows[0].digest);
  } finally { await db.close(); }
});

test('HTTP gates deny unauthorized/preview/disabled requests before touching DB', async () => {
  const env = { AGENT_ADMIN_SECRET: secret, VERCEL_ENV: 'production', AGENT_ENABLED: 'true' };
  let opens = 0;
  const handler = createHandler({ env, openStore: async () => { opens++; throw Error('secret-db-url'); } });
  const req = (auth, method = 'POST') => new Request('https://example.com/api/agent?action=birth', {
    method, headers: { authorization: auth, 'idempotency-key': 'one' },
  });
  assert.equal((await handler(req('Bearer wrong'))).status, 401);
  env.VERCEL_ENV = 'preview';
  assert.equal((await handler(req(`Bearer ${secret}`))).status, 403);
  env.VERCEL_ENV = 'production'; env.AGENT_ENABLED = 'false';
  assert.equal((await handler(req(`Bearer ${secret}`))).status, 409);
  assert.equal(opens, 0);
  const error = await handler(req(`Bearer ${secret}`, 'GET'));
  assert.equal(error.status, 503);
  assert.equal((await error.text()).includes('secret-db-url'), false);
});

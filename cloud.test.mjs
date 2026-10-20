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
    await client.query("INSERT INTO agent_events(kind,payload,created,previous,digest) VALUES('private_memory',$1,'now','','')", [JSON.stringify({text:'PRIVATE'})]);
    const journal = await store.publicJournal();
    assert.equal(journal.length, 2);
    assert.equal(JSON.stringify(journal).includes('PRIVATE'), false);
    assert.equal(journal.some(e => e.kind === 'operation_started'), false);
  } finally { await db.close(); }
});

test('public reads expose only journal; public flag never authorizes a POST', async () => {
  const handler = createHandler({ env: {}, openStore: async () => ({
    latest: async () => null, publicJournal: async () => [], publicRuntime: async () => ({}), close: async () => {},
    status: () => { throw Error('must not expose status'); },
  }) });
  const result = await handler(new Request('https://example.com/api/agent?view=public'));
  assert.equal(result.status, 200);
  const body=await result.json(); assert.deepEqual(body.events,[]); assert.equal(body.enabled,false); assert.equal(body.runtime.accounts.stage,'preparing_profile');
  assert.equal((await handler(new Request('https://example.com/api/agent?view=public',{method:'POST'}))).status,401);
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


test('automatic birth, hourly replay, strategy revision and reuse in next episode', async () => {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const client = { query: async (sql,args) => { const r=await db.query(sql,args); return {...r,rowCount:r.affectedRows||r.rows.length}; }, release(){} };
  const store = new PostgresStore({connect:async()=>client, query:client.query});
  let calls=0, prompts=[];
  const provider={quote:()=>100,generate:async(_,prompt)=>{
    prompts.push(prompt);calls++;
    return {costMicrodollars:20,value:prompt.startsWith('Choose your initial')?fixture:
      prompt.startsWith('Review your recorded')?{action:'reflect',text:'Explore silence through short forms.',summary:'Change based on recent records.'}:
      {action:'draft_text',text:'A test work.',summary:'A synthetic test decision.'}};
  }};
  const env={CRON_SECRET:secret,AGENT_ADMIN_SECRET:'b'.repeat(40),VERCEL_ENV:'production',AGENT_ENABLED:'true'};
  let date=new Date('2026-10-20T10:00:00Z');
  const handler=createHandler({env,openStore:async()=>store,createProvider:()=>provider,now:()=>date});
  const req=()=>new Request('https://example.com/api/tick',{headers:{authorization:`Bearer ${secret}`}});
  try {
    assert.equal((await handler(new Request('https://example.com/api/tick?view=public'))).status,401);
    assert.equal((await handler(new Request('https://example.com/api/tick',{headers:{authorization:`Bearer ${env.AGENT_ADMIN_SECRET}`}}))).status,401);
    assert.equal((await handler(req())).status,200);
    assert.equal((await handler(req())).status,200);
    assert.equal(calls,1);
    for(let h=11;h<=18;h++){date=new Date(`2026-10-20T${h}:00:00Z`);assert.equal((await handler(req())).status,200);}
    assert.equal(calls,9);
    assert.equal(prompts[7].startsWith('Review your recorded'),true);
    assert.equal(prompts[8].includes('Explore silence through short forms.'),true);
    const runtime=await store.publicRuntime();
    assert.equal(runtime.strategyRevisions,1);
    assert.equal(runtime.unresolved,0);
    assert.equal((await store.publicJournal()).filter(e=>e.kind==='reflect').length,1);
    env.AGENT_ENABLED='false';assert.equal((await handler(req())).status,409);
    env.AGENT_ENABLED='true';env.VERCEL_ENV='preview';assert.equal((await handler(req())).status,403);
  } finally {await db.close();}
});

test('uncertain provider result blocks later automatic spending', async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},release(){}};
  const store=new PostgresStore({connect:async()=>client,query:client.query});let calls=0;
  const provider={quote:()=>100,generate:async()=>{calls++;throw Error('timeout');}};
  try{
    await assert.rejects(cloudRun(store,provider,'auto','tick-1'),/timeout/);
    await assert.rejects(cloudRun(store,provider,'auto','tick-2'),/UNRESOLVED_OPERATION/);
    assert.equal(calls,1);assert.equal((await store.publicRuntime()).unresolved,1);
  }finally{await db.close();}
});


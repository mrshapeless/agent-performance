import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {scopedPool,instanceEnv,ACTIVE_INSTANCE} from './instance.mjs';
import {PostgresStore} from './postgres.mjs';
test('fresh generation cannot read old identity, pending operations or assets; archive survives',async()=>{
 const db=new PGlite();const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');await db.exec(schema);
 const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const pool={query:client.query,connect:async()=>client};const old=new PostgresStore(pool);
 try{
 await old.begin('birth','birth',()=>({maximum:1}));await old.complete('birth',1,{name:'Archived agent'});
 await old.begin('pending','step',()=>({maximum:1}));
 await db.exec(`CREATE SCHEMA "${ACTIVE_INSTANCE}"; SET search_path TO "${ACTIVE_INSTANCE}";`+schema+'SET search_path TO public;');
 const fresh=new PostgresStore(scopedPool(pool));assert.equal((await fresh.status()).identity,null);assert.equal((await fresh.status()).unresolved,0);assert.equal((await fresh.publicJournal()).length,0);
 await fresh.begin('birth','birth',()=>({maximum:1}));await fresh.complete('birth',1,{name:'New independent agent'});
 assert.equal((await old.status()).identity.name,'Archived agent');assert.equal((await old.status()).unresolved,1);assert.equal((await fresh.status()).identity.name,'New independent agent');
 }finally{await db.close()}
});
test('old X credentials never carry over to a new generation',()=>{
 const old={X_ENABLED:'true',X_API_KEY:'old',X_EXPECTED_USERNAME:'CaliperNine'};const env=instanceEnv(old);assert.equal(env.X_ENABLED,'false');assert.equal(env.X_API_KEY,undefined);assert.equal(env.X_EXPECTED_USERNAME,undefined);
 assert.equal(instanceEnv({...old,X_ACCOUNT_INSTANCE:ACTIVE_INSTANCE}).X_API_KEY,'old');
 assert.throws(()=>scopedPool({query(){}},'evil;drop').query('SELECT * FROM agent_events'),/INVALID_INSTANCE/);
});

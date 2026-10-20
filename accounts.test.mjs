import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSetup, accountStatus } from './accounts.mjs';
import { PostgresStore } from './postgres.mjs';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test('agent-authored profile survives restart; absent access neither registers nor repeatedly spends',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const pool={connect:async()=>client,query:client.query};const store=new PostgresStore(pool);
 try {
 await store.begin('birth','birth',()=>({maximum:100}));await store.complete('birth',1,{name:'Chosen identity'});
 let calls=0;const provider={quote:()=>100,generate:async(_,prompt)=>{calls++;assert.match(prompt,/Chosen identity/);return {costMicrodollars:5,value:{username:'caliper_test',alternative1:'caliper_alt1',alternative2:'caliper_alt2',displayName:'Caliper',bio:'Autonomous AI artist.',summary:'My choice.'}}}};
 assert.equal((await accountSetup(store,provider,{})).status,'profile_ready');
 const reopened=new PostgresStore(pool);
 assert.equal((await accountSetup(reopened,provider,{})).status,'owner_action_required');assert.equal(calls,1);
 const status=await accountStatus(reopened,{X_API_KEY:'PRIVATE_VALUE'});
 assert.equal(status.stage,'owner_action_required');assert.equal(status.profile.username,'caliper_test');assert.equal(status.registrationVerified,false);
 assert.equal(JSON.stringify(status).includes('PRIVATE_VALUE'),false);
 assert.equal((await store.publicJournal()).some(e=>e.kind==='account_profile'),true);
 assert.equal((await store.status()).unresolved,0);
 }finally{await db.close()}
});
test('configuration does not imply verification; account mismatch never reports ready',async()=>{
 const env=Object.fromEntries(['X_API_KEY','X_API_SECRET','X_ACCESS_TOKEN','X_ACCESS_TOKEN_SECRET'].map(k=>[k,'secret']));env.X_EXPECTED_USERNAME='artist';env.X_ENABLED='true';
 let connection=null;const store={latest:async kind=>kind==='account_profile'?{username:'artist'}:connection};
 assert.equal((await accountStatus(store,env)).stage,'verification_pending');
 connection={status:'verified',username:'another'};assert.equal((await accountStatus(store,env)).stage,'verification_pending');
 connection={status:'verified',username:'artist'};assert.equal((await accountStatus(store,env)).stage,'posting_enabled');
 env.X_ENABLED='false';assert.equal((await accountStatus(store,env)).stage,'activation_required');
});

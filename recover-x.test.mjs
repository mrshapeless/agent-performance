import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {recoverRejectedX} from './recover-x.mjs';
import {socialStep} from './integrations.mjs';
test('reconcile only the confirmed 402; retry once, preserve unknown writes and prevent duplicates',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});
 const now=new Date('2026-10-21T19:20:00Z'),env={X_ENABLED:'true'};let calls=0;
 try{
 await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'test'});
 const studioId='studio-'+Math.floor(now.getTime()/21600000)+'-persona-v1';await s.begin(studioId,'step',()=>({maximum:0}));await s.complete(studioId,0,{action:'studio_failed',errorCode:'TEST_SKIP',text:'Studio is outside this recovery test.'});
 await s.begin('x-plan-248973','step',()=>({maximum:1}));await s.complete('x-plan-248973',1,{action:'x_draft',text:'original',summary:'choice'});
 await s.begin('x-publish-248973','step',()=>({maximum:210000}));
 await recoverRejectedX(c,'other');assert.equal((await s.status()).unresolved,1);
 await recoverRejectedX(c,'generation_02');await recoverRejectedX(c,'generation_02');assert.equal((await s.status()).unresolved,0);assert.equal((await s.publicJournal()).filter(e=>e.kind==='x_failed').length,1);
 const client=()=>({post:async text=>{calls++;assert.equal(text,'original');return {id:'123',url:'https://x.com/i/web/status/123'}}});
 assert.equal((await socialStep(s,null,env,now,client)).status,'published');await socialStep(s,null,env,now,client);assert.equal(calls,1);
 const later=new Date('2026-10-21T21:00:00Z');await s.begin('x-plan-248974','step',()=>({maximum:1}));await s.complete('x-plan-248974',1,{action:'x_draft',text:'next',summary:'choice'});
 const rejected=()=>({post:async()=>{throw Error('X_HTTP_402')}});
 assert.equal((await socialStep(s,null,env,later,rejected)).status,'payment_required');assert.equal((await s.status()).unresolved,0);
 const timeout=()=>({post:async()=>{calls++;throw Error('timeout')}});
 await assert.rejects(socialStep(s,null,env,later,timeout),/timeout/);assert.equal((await s.status()).unresolved,1);
 await socialStep(s,null,env,later,timeout);assert.equal(calls,2);await recoverRejectedX(c,'generation_02');assert.equal((await s.status()).unresolved,1);
 }finally{await db.close()}
});

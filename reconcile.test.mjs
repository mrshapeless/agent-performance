import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {reconcileX} from './integrations.mjs';
import {XClient} from './x.mjs';
test('recover a real timeline match; incomplete reads preserve pending; X does not block other work',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});
 try{
  await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'test'});
  await s.begin('x-plan-1','step',()=>({maximum:1}));await s.complete('x-plan-1',1,{action:'x_draft',text:'original'});
  await s.begin('x-publish-1','step',()=>({maximum:210000}));
  await s.begin('tick-independent','step',()=>({maximum:1}));await s.complete('tick-independent',1,{action:'wait',text:'work continues'});
  const later=new Date(Date.now()+600000);
  await assert.rejects(reconcileX(s,{recentPosts:async()=>{throw Error('X_HTTP_503')}},later),/503/);
  assert.equal((await s.operation('x-publish-1')).status,'pending');
  assert.equal((await reconcileX(s,{recentPosts:async()=>[{id:'123',text:'original'}]},later)).status,'reconciled_published');
  assert.equal((await s.latest('x_post')).postId,'123');
  assert.equal(await reconcileX(s,{},later),null);
  await s.begin('x-plan-2','step',()=>({maximum:1}));await s.complete('x-plan-2',1,{action:'x_draft',text:'another'});
  await s.begin('x-publish-2','step',()=>({maximum:210000}));
  assert.equal((await reconcileX(s,{recentPosts:async()=>[]},later)).status,'reconciled_absent');
  assert.equal((await s.status()).unresolved,0);
 }finally{await db.close()}
});
test('timeline reads reject partial pages and retry a transient GET without any write',async()=>{
 let calls=0;const x=new XClient({X_EXPECTED_USERNAME:'artist'},async url=>{
  calls++;if(calls===1)return new Response('',{status:503});
  return Response.json(url.endsWith('/me')?{data:{id:'1',username:'artist'}}:{data:[],meta:{result_count:0,next_token:'more'}});
 },async()=> 'token');
 await assert.rejects(x.recentPosts(Date.now()-600000),/RECONCILIATION_INCOMPLETE/);assert.equal(calls,3);
});

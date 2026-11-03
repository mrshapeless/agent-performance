import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from '../src/postgres.mjs';
import {hourlyOriginalStep,validateHourlyCandidates} from '../src/hourly-original.mjs';
import {socialStep,reconcileX} from '../src/integrations.mjs';
const board={status:'refresh_needed',formats:[]};
const candidates=['My taste is impeccable. My bookmarks have requested a second opinion.','The algorithm knows me so well it keeps recommending a different personality.','Minimalism is going well. I have three folders of things to remove.'].map(text=>({text,mechanism:'synthetic test reversal',setup:'assertion',turn:'contradiction',sourceUrl:'',evidenceType:'original_experiment',departure:'different premise'}));
const accepted={selectedIndex:0,standalone:true,realTurn:true,distinctFromRecent:true,noFabricatedExperience:true,reason:'Specific reversal in actual words.'};
async function fixture(){
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Fixture'});
 return {s,db};
}
test('hourly production entry prepares without a commission, independently reviews, waits, then publishes once',async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const x={post:async text=>{posts++;assert.equal(text,candidates[0].text);return {id:'123',url:'https://example.test/123'}}};
 try{
  await s.transaction(c=>s.append(c,'x_post',{postId:'old',text:'Unrelated previous original'}));
  const now=new Date();const run=()=>socialStep(s,provider,{X_ENABLED:'true'},now,()=>x);
  assert.equal((await run()).status,'hourly_prepared');assert.equal((await run()).status,'hourly_reviewed');assert.equal((await run()).status,'hourly_ready');assert.equal(posts,0);
  await db.query("UPDATE agent_events SET created=$1 WHERE kind='x_post'",[new Date(Date.now()-61*60000).toISOString()]);
  assert.equal((await run()).status,'published');assert.equal(posts,1);
  // Next cycle starts preparation rather than delivering missed slots.
  await run();assert.equal(posts,1);
 }finally{await db.close();}
});
test('rejected jokes never publish; revision is bounded to one new set',async()=>{
 const {s,db}=await fixture();let posts=0,calls=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:{...accepted,selectedIndex:-1,realTurn:false}})};
 try{for(let i=0;i<6;i++)await hourlyOriginalStep(s,provider,{},new Date(),{post:async()=>{posts++;}},board);assert.equal(calls,4);assert.equal(posts,0);}finally{await db.close();}
});
test('uncertain publication uses approved text for reconciliation, never blindly reposts',async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const x={post:async()=>{posts++;throw Error('timeout')},recentPosts:async()=>[{id:'456',text:candidates[0].text}]};
 try{
  for(let i=0;i<2;i++)await hourlyOriginalStep(s,provider,{},new Date(),x,board);
  await assert.rejects(hourlyOriginalStep(s,provider,{},new Date(),x,board),/timeout/);
  await db.query("UPDATE agent_events SET created=$1 WHERE kind='operation_started'",[new Date(Date.now()-6*60000).toISOString()]);
  assert.equal((await reconcileX(s,x,new Date())).status,'reconciled_published');assert.equal(posts,1);
 }finally{await db.close();}
});
test('fabricated trend provenance and duplicated post text are rejected',()=>{
 assert.throws(()=>validateHourlyCandidates({candidates:candidates.map(c=>({...c,evidenceType:'observed_format',sourceUrl:'https://example.test/invented'}))},board),/UNSUPPORTED_MEME_SOURCE/);
 assert.throws(()=>validateHourlyCandidates({candidates},board,[{text:candidates[0].text}]),/INVALID_HOURLY_TEXT/);
});

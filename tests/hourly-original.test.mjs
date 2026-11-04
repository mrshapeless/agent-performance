import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from '../src/postgres.mjs';
import {hourlyOriginalStep,validateHourlyCandidates} from '../src/hourly-original.mjs';
import {socialStep,reconcileX} from '../src/integrations.mjs';
import {VISUAL_CONTRACT} from '../src/visual-contract.mjs';
const env={X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};
const board={status:'refresh_needed',formats:[]};
const candidates=['My taste is impeccable. My bookmarks have requested a second opinion.','The algorithm knows me so well it keeps recommending a different personality.','Minimalism is going well. I have three folders of things to remove.'].map((text,i)=>({visual:{concept:'Synthetic '+i,visualMechanism:'Visual reversal '+i,composition:'Frame '+i,viewerExperience:'Discovery '+i,renderPrompt:'Synthetic image construction '+i,personalStake:'A particular choice',alt:'Synthetic image',ratio:'1:1',renderer:'single'},text,mechanism:'synthetic test reversal',setup:'assertion',turn:'contradiction',sourceUrl:'',evidenceType:'original_experiment',departure:'different premise'}));
const accepted={visualEssential:true,noGenericTableau:true,selectedIndex:0,standalone:true,realTurn:true,distinctFromRecent:true,noFabricatedExperience:true,reason:'Specific reversal in actual words.'};
async function fixture(){
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Fixture'});
 return {s,db};
}
test('hourly production entry prepares without a commission, independently reviews, waits, then publishes once',async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const x={post:async (text,reply,media)=>{posts++;assert.equal(media,'999');assert.equal(text,candidates[0].text);return {id:'123',url:'https://example.test/123'}}};
 try{
  await s.transaction(c=>s.append(c,'x_post',{postId:'old',text:'Unrelated previous original'}));
  const now=new Date();const run=()=>socialStep(s,provider,env,now,()=>x);
  assert.equal((await run()).status,'hourly_prepared');assert.equal((await run()).status,'hourly_reviewed');assert.equal((await run()).status,'hourly_media_pending');assert.equal(posts,0);await makeReady(db);assert.equal((await run()).status,'hourly_ready');
  await db.query("UPDATE agent_events SET created=$1 WHERE kind='x_post'",[new Date(Date.now()-61*60000).toISOString()]);
  assert.equal((await run()).status,'published');assert.equal(posts,1);
  // Next cycle starts preparation rather than delivering missed slots.
  await run();assert.equal(posts,1);
 }finally{await db.close();}
});
test('rejected jokes never publish; revision is bounded to one new set',async()=>{
 const {s,db}=await fixture();let posts=0,calls=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:{...accepted,selectedIndex:-1,realTurn:false}})};
 try{for(let i=0;i<6;i++)await hourlyOriginalStep(s,provider,env,new Date(),{post:async()=>{posts++;}},board);assert.equal(calls,4);assert.equal(posts,0);}finally{await db.close();}
});
test('uncertain publication uses approved text for reconciliation, never blindly reposts',async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const x={post:async()=>{posts++;throw Error('timeout')},recentPosts:async()=>[{id:'456',text:candidates[0].text,attachments:{media_keys:['3_999']}}]};
 try{
  for(let i=0;i<2;i++)await hourlyOriginalStep(s,provider,env,new Date(),x,board);
  assert.equal((await hourlyOriginalStep(s,provider,env,new Date(),x,board)).status,'hourly_media_pending');await makeReady(db);
  await assert.rejects(hourlyOriginalStep(s,provider,env,new Date(),x,board),/timeout/);
  await db.query("UPDATE agent_events SET created=$1 WHERE kind='operation_started'",[new Date(Date.now()-6*60000).toISOString()]);
  assert.equal((await reconcileX(s,x,new Date())).status,'reconciled_published');assert.equal(posts,1);
 }finally{await db.close();}
});
test('fabricated trend provenance and duplicated post text are rejected',()=>{
 assert.throws(()=>validateHourlyCandidates({candidates:candidates.map(c=>({...c,evidenceType:'observed_format',sourceUrl:'https://example.test/invented'}))},board),/UNSUPPORTED_MEME_SOURCE/);
 assert.throws(()=>validateHourlyCandidates({candidates},board,[{text:candidates[0].text}]),/INVALID_HOURLY_TEXT/);
});

async function makeReady(db,overrides={}){
 const gate={decision:'publish',visualLanguageResult:'supported',integrityResult:'supported',editorialResult:'supported',commissionResult:'supported'};
 const data={publicationPolicy:VISUAL_CONTRACT,review:{...gate,text:candidates[0].text,alt:'Synthetic image'},styleAudit:gate,mediaId:'999',assetId:'synthetic-asset',mime:'image/png',finalized:true,expiresAt:Date.now()+86400000,...overrides};
 await db.query("UPDATE agent_media_jobs SET state='ready',data=$1",[JSON.stringify(data)]);
}
test('image failure, missing pixel gate and expired upload never fall back to text',async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const run=()=>hourlyOriginalStep(s,provider,env,new Date(),{post:async()=>{posts++}},board);
 try{
  await run();await run();assert.equal((await run()).status,'hourly_media_pending');
  await makeReady(db,{styleAudit:{decision:'publish'}});assert.equal((await run()).status,'hourly_editorial_blocked');
  await makeReady(db,{expiresAt:Date.now()-1});assert.equal((await run()).status,'hourly_editorial_blocked');
  await db.query("UPDATE agent_media_jobs SET state='failed'");assert.equal((await run()).status,'hourly_editorial_blocked');
  assert.equal(posts,0);
 }finally{await db.close();}
});

for(const matching of [true,false])test('pixel revision reconciles only its own attachment: '+matching,async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const x={post:async(text,reply,media)=>{posts++;assert.equal(media,'999');throw Error('timeout')},recentPosts:async()=>[{id:'789',text:candidates[0].text,attachments:{media_keys:[matching?'3_999':'3_wrong']}}]};
 const run=()=>hourlyOriginalStep(s,provider,env,new Date(),x,board);
 try{
  await run();await run();await run();
  const parent=(await db.query('SELECT * FROM agent_media_jobs')).rows[0];
  await db.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state) VALUES('child','x-plan-revision-synthetic',$1,'queued')",[JSON.stringify({...parent.plan,revisionOf:parent.id,revisionAttempt:1})]);
  await makeReady(db);
  await db.query("UPDATE agent_media_jobs SET state='rejected',data=data || '{\"revisionJobId\":\"child\"}'::jsonb WHERE id=$1",[parent.id]);
  await assert.rejects(run(),/timeout/);
  assert.equal((await s.operation('x-plan-revision-synthetic')).result.medium,'image');
  await db.query("UPDATE agent_events SET created=$1 WHERE kind='operation_started'",[new Date(Date.now()-6*60000).toISOString()]);
  assert.equal((await reconcileX(s,x,new Date())).status,matching?'reconciled_published':'reconciled_absent');assert.equal(posts,1);
  assert.equal((await db.query("SELECT state FROM agent_media_jobs WHERE id='child'")).rows[0].state,matching?'published':'ready');
 }finally{await db.close();}
});

test('paid billing recovery retries once, persists success and never loops on continued 402',async()=>{
 for(const recovered of [true,false]){
  const {s,db}=await fixture();let calls=0;
  const provider={quote:()=>1,generate:async()=>{calls++;if(calls<=2||!recovered)throw Error('Gemini HTTP 402');return {costMicrodollars:1,value:calls===3?{candidates}:accepted}}};
  const run=()=>hourlyOriginalStep(s,provider,env,new Date(),{post:async()=>{throw Error('must not publish without media')}},board);
  try{
   assert.equal((await run()).status,'hourly_planning_failed');
   assert.equal((await run()).status,'hourly_planning_failed');
   assert.equal((await run()).status,recovered?'hourly_prepared':'hourly_planning_failed');
   for(let i=0;i<4;i++)await run();
   assert.equal(calls,recovered?4:3);
   assert.equal((await run()).status,recovered?'hourly_media_pending':'hourly_editorial_blocked');
  }finally{await db.close();}
 }
});

test('terminal pixel rejection starts a new learned commission only after hourly cooldown',async()=>{
 const {s,db}=await fixture();let calls=0,posts=0;const prompts=[];
 const provider={quote:()=>1,generate:async(system,prompt)=>{prompts.push(prompt);return {costMicrodollars:1,value:++calls%2?{candidates}:accepted}}};
 let now=new Date();const run=()=>hourlyOriginalStep(s,provider,env,now,{post:async()=>{posts++;return {id:'new',url:'https://example.test/new'}}},board);
 try{
  await run();await run();await run();
  const parent=(await db.query('SELECT * FROM agent_media_jobs')).rows[0];
  await db.query("UPDATE agent_media_jobs SET state='rejected',data=$1 WHERE id=$2",[JSON.stringify({review:{visualLanguageResult:'partly',referenceComparison:'Too much crisp surface detail; simplify the whole frame.'}}),parent.id]);
  for(let i=0;i<4;i++)assert.equal((await run()).status,'hourly_editorial_cooldown');
  assert.equal(calls,2);assert.equal(posts,0);
  now=new Date(new Date(parent.created).getTime()+3600001);
  assert.equal((await run()).status,'hourly_prepared');assert.match(prompts.at(-1),/Too much crisp surface detail/);
  assert.equal((await run()).status,'hourly_reviewed');assert.equal((await run()).status,'hourly_media_pending');
  assert.equal((await run()).status,'hourly_media_pending');assert.equal(calls,4);
  const jobs=(await db.query('SELECT * FROM agent_media_jobs ORDER BY created')).rows;assert.equal(jobs.length,2);assert.notEqual(jobs[0].plan_id,jobs[1].plan_id);
  await makeReady(db);await db.query("UPDATE agent_media_jobs SET state='rejected' WHERE id=$1",[parent.id]);
  assert.equal((await run()).status,'published');assert.equal(posts,1);
 }finally{await db.close()}
});

test('rejected revision cannot restart while an operation outcome is unknown',async()=>{
 const {s,db}=await fixture();let calls=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?{candidates}:accepted})};
 const run=()=>hourlyOriginalStep(s,provider,env,new Date(Date.now()+7200000),{},board);
 try{
  await run();await run();await run();await db.query("UPDATE agent_media_jobs SET state='rejected'");
  await s.begin('x-publish-uncertain','step',()=>({maximum:1}));
  assert.equal((await run()).status,'hourly_recovery_pending');assert.equal(calls,2);
 }finally{await db.close()}
});

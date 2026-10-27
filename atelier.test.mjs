import {scopedSQL} from './instance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {createHandler} from './cloud.mjs';
import {axes,trainTaste,validateProfile,tasteBrief} from './taste.mjs';
import {atelierStep,atelierHandler,atelierStatus,creativeMemory} from './atelier.mjs';
const profile=n=>({observation:'Synthetic layered composition '+n,traits:Object.fromEntries(axes.map(k=>[k,k==='collage'?n:0.5]))});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Test'});return {s,db};}
test('preferences learn direction from comparisons without treating missing labels as rejection',()=>{
 const profiles=[0,1].map(n=>({asset_id:'a'+n,...profile(n)}));
 assert.equal(trainTaste(profiles,[]).status,'collecting');
 assert.equal(trainTaste(profiles,[]).rank[0].score,0.5);
 const m=trainTaste(profiles,[{asset_id:'a1',other_id:'a0',verdict:'prefer'}]);assert.equal(m.rank[0].assetId,'a1');assert.equal(m.validation,null);
 const flipped=trainTaste(profiles,[{asset_id:'a0',other_id:'a1',verdict:'prefer'}]);assert.equal(flipped.rank[0].assetId,'a0');
 assert.throws(()=>validateProfile({...profile(1),traits:{collage:NaN}}));
 assert.equal(tasteBrief(profiles,[]).tendencies.length,0);
});
test('actual pixels inspected once, persisted, private preferences reach the next planning context',async()=>{
 const {s,db}=await fixture();let calls=0;
 try{
  for(const id of ['a','b']){await s.pool.query('INSERT INTO agent_assets(id,mime,bytes) VALUES($1,$2,$3)',[id,'image/png',Buffer.from('pixels-'+id)]);await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data) VALUES($1,$1,$2,'published',$3)",[id,JSON.stringify({medium:'image',text:'Synthetic caption',prompt:'PRIVATE_DRAFT'}),JSON.stringify({assetId:id})]);}
  const provider={quote:()=>1,generate:async(_s,_p,media)=>{calls++;assert.match(media.bytes.toString(),/pixels-/);return {value:profile(calls%2),costMicrodollars:1}}};
  assert.equal((await atelierStep(s,provider)).status,'profiled');assert.equal((await atelierStep(s,provider)).status,'profiled');assert.equal((await atelierStep(s,provider)).status,'up_to_date');assert.equal(calls,2);
  const req=b=>new Request('https://test/api/atelier',{method:'POST',body:JSON.stringify(b)});
  for(let i=0;i<2;i++)assert.equal((await atelierHandler(req({action:'feedback',assetId:'a',verdict:'like'}),s)).status,200);
  assert.equal((await atelierStatus(s)).feedbackCount,1);
  await atelierHandler(req({action:'feedback',assetId:'a',otherId:'b',verdict:'prefer'}),s);
  await atelierHandler(req({action:'feedback',assetId:'b',otherId:'a',verdict:'prefer'}),s);
  assert.equal((await atelierStatus(s)).feedbackCount,2); // flipped pair replaces, never double counts
  await s.begin('next','step',(_i,_r,c)=>{assert.equal(c.taste.operatorJudgments,2);return {maximum:0};});await s.complete('next',0,{action:'wait'});
  assert.doesNotMatch(JSON.stringify(await s.publicJournal()),/Synthetic layered|PRIVATE_DRAFT|taste-logistic/);
  assert.equal((await atelierHandler(req({action:'feedback',assetId:'missing',verdict:'like'}),s)).status,409);
  await atelierHandler(req({action:'feedback',assetId:'a',verdict:'clear'}),s);
  assert.equal((await creativeMemory(s.pool.query)).operatorJudgments,1);
 }finally{await db.close();}
});
test('private studio cannot be opened with public view or cron token',async()=>{
 let opens=0;const h=createHandler({env:{AGENT_ADMIN_SECRET:'a'.repeat(32),CRON_SECRET:'c'.repeat(32)},openStore:()=>{opens++;throw Error('unexpected');}});
 for(const path of ['/api/atelier','/api/atelier?view=public','/api/atelier-worker?view=public'])assert.equal((await h(new Request('https://test'+path))).status,401);
 assert.equal((await h(new Request('https://test/api/atelier',{headers:{Authorization:'Bearer '+'c'.repeat(32)}}))).status,401);assert.equal(opens,0);
});
test('failed inspection records failure and does not automatically repeat paid call',async()=>{
 const {s,db}=await fixture();try{await s.pool.query("INSERT INTO agent_assets(id,mime,bytes) VALUES('a','image/png',$1)",[Buffer.from('pixels')]);await s.pool.query(`INSERT INTO agent_media_jobs(id,plan_id,plan,state,data) VALUES('a','a','{"medium":"image"}','published','{"assetId":"a"}')`);
 let calls=0;const provider={quote:()=>1,generate:async()=>{calls++;throw Error('private provider error');}};
 assert.equal((await atelierStep(s,provider)).status,'profile_failed');assert.equal((await atelierStep(s,provider)).status,'up_to_date');assert.equal(calls,1);assert.equal((await s.status()).unresolved,0);
 }finally{await db.close();}
});

test("visual memory tables are scoped to the active generation",()=>{for(const table of ["agent_visual_profiles","agent_taste_feedback"])assert.equal(scopedSQL("SELECT * FROM "+table),'SELECT * FROM "generation_02".'+table);});

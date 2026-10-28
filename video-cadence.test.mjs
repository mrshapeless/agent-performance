import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {videoDay,videoCadence,claimVideoCadence,videoCadenceDirection} from './video-cadence.mjs';
import {socialStep,planningReferenceBoards} from './integrations.mjs';
import {studioOperationId} from './studio.mjs';
import {mediaStep} from './media.mjs';
const env={REPLICATE_API_TOKEN:'synthetic',BLOB_READ_WRITE_TOKEN:'synthetic'},now=new Date('2026-10-28T10:00:00Z');
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},release(){}};return {db,s:new PostgresStore({query:c.query,connect:async()=>c})};}
async function job(s,id,state,{created=now,updated=now,assetId=id}={}){await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data,created,updated) VALUES($1,$2,'{\"medium\":\"video\"}',$3,$4,$5,$6)",[id,'plan-'+id,state,JSON.stringify({assetId}),created.toISOString(),updated.toISOString()]);}
async function post(s,id,assetId,when=now){await s.pool.query("INSERT INTO agent_events(kind,payload,created,previous,digest) VALUES('x_post',$1,$2,'','synthetic')",[JSON.stringify({postId:id,assetId,mime:'video/mp4'}),when.toISOString()]);}
test('Moscow day rolls over at 21:00 UTC, including month/year boundaries',()=>{
 assert.deepEqual(videoDay(new Date('2026-12-31T21:00:00Z')),{day:'2027-01-01',start:'2026-12-31T21:00:00.000Z',end:'2027-01-01T21:00:00.000Z'});
 assert.equal(videoDay(new Date('2026-10-27T20:59:59Z')).day,'2026-10-27');assert.equal(videoDay(new Date('2026-10-27T21:00:00Z')).day,'2026-10-28');
});
test('one video is required, second optional, two published is maximum; event and job are not counted twice',async()=>{
 const {s,db}=await fixture();try{
  assert.equal((await videoCadence(s,env,now)).required,true);
  await job(s,'first','published');await post(s,'p1','first');await post(s,'p1','first');
  let state=await videoCadence(s,env,now);assert.equal(state.published,1);assert.equal(state.optional,true);assert.match(videoCadenceDirection(state),/second is optional/);
  await job(s,'second','published');state=await videoCadence(s,env,now);assert.equal(state.published,2);assert.equal(state.status,'daily_maximum');assert.equal(videoCadenceDirection(state),'');
 }finally{await db.close();}
});
test('old in-flight work prevents a new launch; failed charged render is not auto-retried that day',async()=>{
 const {s,db}=await fixture();try{
  const yesterday=new Date('2026-10-26T12:00:00Z');await job(s,'pending','processing',{created:yesterday,updated:yesterday});assert.equal((await videoCadence(s,env,now)).status,'in_progress');
  await s.pool.query("UPDATE agent_media_jobs SET state='failed' WHERE id='pending'");
  await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status,budget_provider) VALUES('pending-render','step','2026-10-28',4000000,'pending','replicate')");
  assert.equal((await videoCadence(s,env,now)).status,'needs_attention');
 }finally{await db.close();}
});
test('only real Replicate reservations constrain cadence and configured access is required',async()=>{
 const {s,db}=await fixture();try{
  assert.equal((await videoCadence(s,{},now)).status,'not_configured');
  await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status) VALUES('other','step','2026-10-28',999999999,'complete')");assert.equal((await videoCadence(s,env,now)).required,true);
  await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status,budget_provider) VALUES('paid','step','2026-10-28',47000000,'complete','replicate')");assert.equal((await videoCadence(s,env,now)).status,'replicate_budget_unavailable');
 }finally{await db.close();}
});
test('durable claim is once per daily slot, never a charge, and no pending lane is left',async()=>{
 const {s,db}=await fixture();try{
  assert.equal((await claimVideoCadence(s,env,now)).claimed,true);assert.equal((await claimVideoCadence(s,env,now)).claimed,false);
  const ops=(await s.pool.query('SELECT * FROM agent_operations')).rows;assert.equal(ops.length,1);assert.equal(Number(ops[0].amount),0);assert.equal(ops[0].status,'complete');
  await job(s,'one','published');await post(s,'p1','one');assert.equal((await claimVideoCadence(s,env,now)).claimed,false);assert.equal((await claimVideoCadence(s,env,now,{optional:true})).claimed,true);
 }finally{await db.close();}
});

async function socialFixture(){
 const f=await fixture(),s=f.s;
 await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic artist'});
 await s.transaction(async c=>{await s.append(c,'studio_revision',{projects:[],interests:[]});await s.append(c,'cognitive_decision',{choice:'commission',taskId:'original-image'});});
 await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step) VALUES('original-image','','commissioned','An independent image','Create an image with overlapping signs.')");
 const sid=await studioOperationId(s,now);await s.begin(sid,'step',()=>({maximum:0}));await s.complete(sid,0,{action:'studio_test_ready'});
 return f;
}
const film=()=>({action:'x_draft',intent:'experiment',projectId:null,medium:'video',text:'An imagined interruption.',summary:'A moving experiment.',prompt:'An unused generic prompt.',alt:'Animated overlapping signs.',ratio:'16:9',duration:4,referenceIds:[],selectedId:'one',diversityComparison:'Different temporal structures.',alternatives:['one','two','three'].map(id=>({id,concept:'Concept '+id,visualMechanism:'Mechanism '+id,composition:'Composition '+id,viewerExperience:'Experience '+id,renderPrompt:'Opening signs hold still; '+id+' bursts into movement; ending freezes; audio cuts to silence.'}))});
test('social cadence writes a separate screenplay, preserves image commission, queues and renders through existing media pipeline',async()=>{
 const {s,db}=await socialFixture();let calls=0,starts=0,posts=0;
 const enabled={...env,X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};
 const provider={quote:()=>1,generate:async(_system,p,_media,schema)=>{calls++;if(schema.properties.repeatedMechanism)return {costMicrodollars:1,value:{repeatedMechanism:false,lostCommission:false,polishedAgainstRemit:false,legibleHook:true,reason:'Temporal contrast',revision:'No revision needed'}};assert.match(p,/Daily moving-image commission/);assert.deepEqual(schema.properties.medium.enum,['video']);return {costMicrodollars:1,value:film()};}};
 const x={post:async()=>{posts++;return {id:'test-post',url:'https://example.org/test-post'};}};
 try{
  const result=await socialStep(s,provider,enabled,now,()=>x);assert.equal(result.status,'video_planned');
  let task=(await s.pool.query("SELECT * FROM agent_agenda WHERE id='original-image'")).rows[0];assert.equal(task.status,'commissioned');assert.match(task.next_step,/overlapping signs/);
  const plan=await s.operation(result.planId);assert.equal(plan.result.medium,'video');assert.equal(plan.result.agendaId,null);assert.equal(plan.result.prompt,film().alternatives[0].renderPrompt);assert.equal(posts,0);
  const services={videoQuote:()=>4_000_000,startVideo:async p=>{starts++;assert.equal(p.prompt,film().alternatives[0].renderPrompt);return {id:'synthetic-prediction'};}};
  assert.equal((await mediaStep(s,provider,enabled,services,()=>x)).status,'creative_preflight');assert.equal((await mediaStep(s,provider,enabled,services,()=>x)).status,'creative_preflight');assert.equal((await mediaStep(s,provider,enabled,services,()=>x)).status,'video_started');assert.equal(starts,1);assert.equal(posts,0);
  const paid=(await s.pool.query("SELECT * FROM agent_operations WHERE budget_provider='replicate'")).rows;assert.equal(paid.length,1);assert.equal(Number(paid[0].amount),4_000_000);
  // Publishing becomes possible only after the existing media worker confirms upload readiness.
  await s.pool.query("UPDATE agent_media_jobs SET state='ready',data=data||$1::jsonb",[JSON.stringify({mediaId:'synthetic-media',assetId:'synthetic-art',expiresAt:now.getTime()+3600000,review:{text:'A completed synthetic film.',summary:'Reviewed film',alt:'Moving signs'}})]);
  assert.equal((await socialStep(s,provider,enabled,now,()=>x)).status,'published');assert.equal(posts,1);assert.equal(starts,1);assert.equal(calls,2);
  task=(await s.pool.query("SELECT * FROM agent_agenda WHERE id='original-image'")).rows[0];assert.equal(task.status,'commissioned');
 }finally{await db.close();}
});
test('failed daily planning gets only one bounded settled repair then ordinary image commission proceeds',async()=>{
 const {s,db}=await socialFixture();let daily=0,normal=0;const enabled={...env,X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};
 const provider={quote:()=>1,generate:async(_s,p,_m,schema)=>{if(p.startsWith('Daily moving-image')){daily++;throw Error('synthetic failure');}normal++;assert.deepEqual(schema.properties.medium.enum,['text','image']);return {costMicrodollars:1,value:{action:'x_draft',intent:'experiment',projectId:null,medium:'text',text:'Independent image planning continues.',summary:'A short draft.'}};}};
 try{const first=await socialStep(s,provider,enabled,now,()=>({}));assert.equal(first.status,'video_planning_failed');assert.equal(first.failureCode,'VIDEO_PLANNER_PROVIDER_FAILED');const repair=await socialStep(s,provider,enabled,now,()=>({}));assert.equal(repair.status,'video_planning_failed');assert.equal(repair.planId,first.planId+'-repair1');assert.equal((await socialStep(s,provider,enabled,now,()=>({}))).status,'planned');assert.equal(daily,2);assert.equal(normal,1);assert.equal((await s.pool.query('SELECT * FROM agent_media_jobs')).rows.length,0);}finally{await db.close();}
});
test('settled legacy planner failure can recover without a second claim or repeating a charged render',async()=>{
 const {s,db}=await socialFixture();const enabled={...env,X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};let generated=0;
 try{
  const claim=await claimVideoCadence(s,env,now),id='x-plan-'+claim.claimId;await s.begin(id,'step',()=>({maximum:1}));await s.complete(id,1,{action:'wait',text:'Earlier planner failure.'});
  const provider={quote:()=>1,generate:async()=>{generated++;return {costMicrodollars:1,value:film()};}};
  const result=await socialStep(s,provider,enabled,now,()=>({}));assert.equal(result.status,'video_planned');assert.equal(result.planId,id+'-repair1');assert.equal(generated,1);
  assert.equal((await s.pool.query("SELECT id FROM agent_operations WHERE id LIKE 'video-cadence-%'")).rows.length,1);
  assert.equal((await s.pool.query('SELECT * FROM agent_media_jobs')).rows.length,1);
 }finally{await db.close();}
});
test('a render operation prevents screenplay repair even if its media job is missing',async()=>{
 const {s,db}=await socialFixture();const enabled={...env,X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};let daily=0;
 try{
  const claim=await claimVideoCadence(s,env,now),id='x-plan-'+claim.claimId;await s.begin(id,'step',()=>({maximum:1}));await s.complete(id,1,{action:'wait'});
  await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status,budget_provider) VALUES($1,'step',$2,4000000,'complete','replicate')",['media-'+id.replace('x-plan-','')+'-render',claim.day]);
  const provider={quote:()=>1,generate:async(_s,p)=>{if(p.startsWith('Daily moving-image'))daily++;return {costMicrodollars:1,value:{action:'x_draft',medium:'text',intent:'experiment',projectId:null,text:'A separate thought.',summary:'Continue the original task.'}};}};
  assert.equal((await socialStep(s,provider,enabled,now,()=>({}))).status,'planned');assert.equal(daily,0);assert.equal(await s.operation(id+'-repair1'),null);
 }finally{await db.close();}
});
test('claim-only crash resumes original ID once with reference pixels for planning only',async()=>{
 const {s,db}=await socialFixture();const enabled={...env,X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};let generated=0,loaded=0;
 const refs=[{id:25,mime:'image/png',bytes:Buffer.from('synthetic board A')},{id:26,mime:'image/png',bytes:Buffer.from('synthetic board B')}];
 try{
  const claim=await claimVideoCadence(s,env,now),id='x-plan-'+claim.claimId;
  const provider={quote:()=>1,generate:async(_s,p,media,schema,attachments)=>{generated++;assert.equal(media,null);assert.deepEqual(attachments,refs);assert.match(p,/not video conditioning inputs/);assert.equal(schema.properties.referenceIds.maxItems,0);return {costMicrodollars:1,value:film()};}};
  const load=async()=>{loaded++;return refs;};
  const result=await socialStep(s,provider,enabled,now,()=>({}),load);assert.equal(result.status,'video_planned');assert.equal(result.planId,id);
  const saved=await s.operation(id);assert.deepEqual(saved.result.referenceIds,[]);assert.deepEqual(saved.result.planningReferenceIds,[25,26]);assert.equal(await s.operation(id+'-repair1'),null);
  // Simulate repeated delivery before the media worker: no second daily request.
  const nextProvider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:{action:'wait',intent:'wait',projectId:null,medium:'text',text:'Wait for this separate task.',summary:'A deliberate pause.'}})};
  await socialStep(s,nextProvider,enabled,now,()=>({}),load);assert.equal(generated,1);assert.equal(loaded,1);assert.equal((await s.pool.query('SELECT * FROM agent_media_jobs')).rows.length,1);
 }finally{await db.close();}
});
test('unknown pending daily plan is never repeated or repaired',async()=>{
 const {s,db}=await socialFixture();const enabled={...env,X_ENABLED:'true',GEMINI_API_KEY:'synthetic'};let calls=0;
 try{const claim=await claimVideoCadence(s,env,now),id='x-plan-'+claim.claimId;await s.begin(id,'step',()=>({maximum:1}));
  const provider={quote:()=>1,generate:async()=>{calls++;throw Error('must not execute');}};
  assert.equal((await socialStep(s,provider,enabled,now,()=>({}))).status,'video_planning_pending');assert.equal(calls,0);assert.equal(await s.operation(id+'-repair1'),null);
 }finally{await db.close();}
});
test('planning reference selection uses actual board assets rather than remote subject examples',async()=>{
 let selected;
 const result=await planningReferenceBoards(now,[{id:1,url:'https://example.org/not-a-board'},{id:25,file:'reference-board-25.png'},{id:26,file:'reference-board-26.png'}],async ids=>{selected=ids;return ids.map(id=>({id,bytes:Buffer.from('synthetic')}));});
 assert.equal(result.length,2);assert.deepEqual(new Set(selected),new Set([25,26]));assert.deepEqual(await planningReferenceBoards(now,[],()=>{throw Error('unexpected load');}),[]);
});

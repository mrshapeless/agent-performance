import test from 'node:test';
import assert from 'node:assert/strict';
import { XClient, signOAuth } from './x.mjs';
import { AppearanceImage } from './appearance.mjs';
import { setupAppearance,socialStep } from './integrations.mjs';
import {CREATIVE_REVISION,reconcileCreativeRevision} from './creative-revision.mjs';
import {studioOperationId} from './studio.mjs';
import { PostgresStore } from './postgres.mjs';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const env={X_API_KEY:'key',X_API_SECRET:'secret',X_ACCESS_TOKEN:'token',X_ACCESS_TOKEN_SECRET:'token-secret',X_EXPECTED_USERNAME:'artist'};

async function plannerFixture(project=''){
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c}),now=new Date('2026-10-28T12:00:00Z');
 await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic artist'});await reconcileCreativeRevision(s);
 await s.transaction(async c=>{await s.append(c,'studio_revision',{projects:project?[{id:project,status:'active'}]:[]});await s.append(c,'cognitive_decision',{choice:'commission'});});
 await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step) VALUES('fresh',$1,'commissioned','A fresh choice','Write a personal observation')",[project]);
 const sid=await studioOperationId(s,now);await s.begin(sid,'step',()=>({maximum:0}));await s.complete(sid,0,{action:'studio_test_ready'});
 const id='x-plan-'+CREATIVE_REVISION+'-'+Math.floor(now.getTime()/7200000);
 const run=(provider,x=()=>({post:async()=>({id:'123',url:'https://x.com/i/status/123'})}))=>socialStep(s,provider,{X_ENABLED:'true',VIDEO_CADENCE_ENABLED:'false'},now,x,async()=>[]);
 return {s,db,id,run};
}
const textPlan=()=>({action:'x_draft',medium:'text',intent:'experiment',projectId:null,text:'A personal observation.',summary:'A fresh choice.'});
test('commission schema binds project and intent before the model call, without removing intentional waits',async()=>{
 for(const project of ['','current-project']){
  const {db,run}=await plannerFixture(project);try{
   const provider={quote:()=>1,generate:async(_system,_prompt,_media,schema)=>{
    assert.deepEqual(schema.properties.projectId,project?{type:'string',enum:[project]}:{type:'null'});
    assert.deepEqual(schema.properties.intent.enum,[project?'project':'experiment','wait']);
    return {costMicrodollars:1,value:{...textPlan(),projectId:project||null,intent:project?'project':'experiment'}};
   }};
   assert.equal((await run(provider)).status,'planned');
  }finally{await db.close()}
 }
});
test('failed social validation has safe diagnostics and one durable planner repair, then publishes exactly once',async()=>{
 const {s,db,id,run}=await plannerFixture();try{
 let calls=0,posts=0;const provider={quote:()=>10,generate:async()=>({costMicrodollars:3,value:++calls===1?{...textPlan(),intent:'project',projectId:'inactive'}:textPlan()})};
 const first=await run(provider);assert.equal(first.failureCode,'PROJECT_NOT_ACTIVE');assert.equal(first.stage,'validate');assert.equal((await s.operation(id)).result.failureKind,'social_planning');
 assert.equal((await run(provider)).status,'planned');assert.equal((await s.operation(id+'-repair1')).result.creativeRevision,CREATIVE_REVISION);
 const x=()=>({post:async()=>{posts++;return {id:'123',url:'https://x.com/i/status/123'}}});
 assert.equal((await run(provider,x)).status,'published');await run(provider,x);assert.equal(calls,2);assert.equal(posts,1);
 }finally{await db.close()}
});
test('social repair recognizes only exact historical failure, records a safe provider code, and stops after one retry',async()=>{
 const {s,db,id,run}=await plannerFixture();try{
 await s.begin(id,'step',()=>({maximum:1}));await s.complete(id,1,{action:'wait',text:'This planning attempt could not be completed.',summary:'No publication was sent. Retained the cost reservation; a later slot may make a new decision.'});
 let calls=0;const provider={quote:()=>1,generate:async()=>{calls++;throw Error('Gemini HTTP 402 private response should never be recorded');}};
 const result=await run(provider);assert.equal(result.planId,id+'-repair1');assert.equal(result.failureCode,'GEMINI_HTTP_402');assert.equal(result.stage,'provider');
 assert.doesNotMatch(JSON.stringify((await s.operation(id+'-repair1')).result),/private response/);
 assert.equal((await run(provider)).status,'wait');assert.equal(calls,1);
 }finally{await db.close()}
});
test('intentional waits, unknown planners and any downstream generation prevent planner repair',async()=>{
 for(const mode of ['wait','pending','render']){
  const {s,db,id,run}=await plannerFixture();try{
   await s.begin(id,'step',()=>({maximum:0}));
   if(mode!=='pending')await s.complete(id,0,mode==='wait'?{action:'wait',text:'I choose to pause.',summary:'Intentional rest.'}:{action:'wait',failureKind:'social_planning'});
   if(mode==='render')await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status,result) VALUES($1,'step',CURRENT_DATE,10,'complete','{}')",['media-'+id.replace('x-plan-','')+'-render']);
   const provider={quote:()=>{throw Error('REPAIR_NOT_ALLOWED');},generate:()=>{throw Error('REPAIR_NOT_ALLOWED');}};
   assert.equal((await run(provider)).status,mode==='pending'?'pending':'wait');assert.equal(await s.operation(id+'-repair1'),null);
  }finally{await db.close()}
 }
});
test('X verifies token owner before any write and returns only real post URL',async()=>{
 let calls=[];const wrong=new XClient(env,async(url)=>{calls.push(url);return Response.json({data:{username:'other'}})});
 await assert.rejects(wrong.post('hello'),/ACCOUNT_MISMATCH/);assert.equal(calls.length,1);
 const correct=new XClient(env,async(url,opts)=>{assert.match(opts.headers.authorization,/^OAuth /);return Response.json(url.endsWith('/me')?{data:{username:'artist'}}:{data:{id:'123456'}})});
 assert.equal((await correct.post('hello')).url,'https://x.com/i/web/status/123456');
 await assert.rejects(correct.post('x'.repeat(281)),/INVALID_TEXT/);
 assert.equal(signOAuth('GET','https://api.x.com/2/users/me',env,'nonce',10),signOAuth('GET','https://api.x.com/2/users/me',env,'nonce',10));
 assert.notEqual(signOAuth('GET','https://api.x.com/2/users/me',env,'nonce',10),signOAuth('POST','https://api.x.com/2/users/me',env,'nonce',10));
});
test('image request uses agent prompt, non-stored interaction and parses only model image output',async()=>{
 const image=new AppearanceImage({GEMINI_API_KEY:'test'},async(url,opts)=>{
  const body=JSON.parse(opts.body);assert.match(body.input,/RENDER DIRECTION: lo-fi retro girl/);assert.ok(body.input.endsWith('SCENE: agent authored'));assert.equal(body.store,false);assert.equal(body.response_format.image_size,'1K');
  return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'image',mime_type:'image/png',data:Buffer.from('fixture').toString('base64')}]}],usage:{total_input_tokens:10,total_output_tokens:1120,total_thought_tokens:20}});
 });const r=await image.generate('agent authored');assert.equal(r.bytes.toString(),'fixture');assert.equal(r.costMicrodollars,34215);
});
test('appearance brief is agent authored, replay-safe; asset is committed with its public record',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},release(){}};
 const store=new PostgresStore({connect:async()=>client,query:client.query});
 try{
  await store.begin('birth','birth',()=>({maximum:100}));await store.complete('birth',1,{name:'Test',voice:'test',interests:'test',visualDirection:'test',summary:'test'});
  let calls=0;const provider={quote:()=>100,generate:async()=>{calls++;return {costMicrodollars:1,value:{prompt:'My own chosen form.',alt:'Chosen form',summary:'I chose this.'}}}};
  await setupAppearance(store,provider,{});assert.equal(calls,1);assert.equal((await store.latest('appearance_brief')).text,'My own chosen form.');
  await store.begin('appearance-image-v2','step',()=>({maximum:100}));await store.complete('appearance-image-v2',1,{action:'appearance_image',text:'Chosen form',assetId:'appearance-image-v2',summary:'test'},{mime:'image/png',bytes:Buffer.from('fixture')});
  assert.equal((await setupAppearance(store,provider,{})).status,'complete');assert.equal(calls,1);
  const reopened=new PostgresStore({connect:async()=>client,query:client.query});assert.equal(Buffer.from((await reopened.asset('appearance-image-v2')).bytes).toString(),'fixture');
  assert.equal((await store.publicJournal()).some(e=>e.content.assetId==='appearance-image-v2'),true);
 }finally{await db.close();}
});

test('OAuth signing matches RFC 5849 reference vector',()=>{
 const auth=signOAuth('GET','http://photos.example.net/photos?file=vacation.jpg&size=original',{
 X_API_KEY:'dpf43f3p2l4k3l03',X_API_SECRET:'kd94hf93k423kf44',X_ACCESS_TOKEN:'nnch734d00sl2jdk',X_ACCESS_TOKEN_SECRET:'pfkkdhi9sl3r4s00'},'kllo9940pd9333jh',1191242096);
 assert.match(auth,/oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"/);
});


test('OAuth2 refreshes a rejected token once and never retries an uncertain POST',async()=>{
 const headers=[];let refreshes=0;
 const bearer=async rejected=>{if(rejected){assert.equal(rejected,'old');refreshes++;return 'new';}return refreshes?'new':'old';};
 const x=new XClient(env,async(url,opts)=>{headers.push(opts.headers.authorization);if(opts.headers.authorization==='Bearer old')return new Response('',{status:401});return Response.json(url.endsWith('/me')?{data:{username:'artist'}}:{data:{id:'456'}});},bearer);
 assert.equal((await x.post('test')).id,'456');assert.equal(refreshes,1);assert.deepEqual(headers,['Bearer old','Bearer new','Bearer new']);
 let writes=0;
 const uncertain=new XClient(env,async url=>{if(url.endsWith('/me'))return Response.json({data:{username:'artist'}});writes++;throw Error('timeout');},async()=> 'token');
 await assert.rejects(uncertain.post('test'),/timeout/);assert.equal(writes,1);
 const denied=new XClient(env,async()=>new Response('',{status:401}),async()=> 'bad');
 await assert.rejects(denied.post('test'),e=>e.message==='X_HTTP_401'&&e.phase==='verify');
});

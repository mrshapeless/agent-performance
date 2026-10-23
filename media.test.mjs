import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {mediaStep,enqueueMedia,validateMediaPlan,readyMedia} from './media.mjs';
import {socialStep} from './integrations.mjs';
import {MediaProviders,readMedia,trustedMediaURL} from './media-providers.mjs';
import {XClient} from './x.mjs';
const env={X_ENABLED:'true',GEMINI_API_KEY:'test',REPLICATE_API_TOKEN:'test',BLOB_READ_WRITE_TOKEN:'test'};
const plan={action:'x_draft',medium:'image',text:'A line becomes a shoreline.',prompt:'An original moving shoreline made of ink.',alt:'A black ink shoreline',ratio:'1:1',summary:'Testing a visual idea.'};
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const store=new PostgresStore({query:c.query,connect:async()=>c});await store.begin('birth','birth',()=>({maximum:1}));await store.complete('birth',1,{name:'test'});return {store,db};}
async function seed(s,p=plan){await s.begin('x-plan-1','step',()=>({maximum:1}));await s.complete('x-plan-1',1,p);await enqueueMedia(s,'x-plan-1',p);}
const services={imageQuote:()=>500000,image:async()=>({bytes:Buffer.from('fixture'),mime:'image/jpeg',costMicrodollars:40000}),load:async a=>({...a,bytes:Buffer.from(a.bytes??'fixture')}),videoQuote:()=>4000000,startVideo:async()=>({id:'pred1'}),videoStatus:async()=>({status:'succeeded',output:'https://replicate.delivery/movie.mp4'}),archiveVideo:async()=>({mime:'video/mp4',url:'https://test.public.blob.vercel-storage.com/movie.mp4'})};
function reviewer(decision='publish'){return {quote:()=>100,generate:async(system,prompt,asset)=>{assert.ok(asset.bytes.length);return {costMicrodollars:300,value:{action:decision,text:'An ink shoreline, imagined.',alt:'A wavering ink line',summary:'The observed result fits the experiment.'}}}};}
test('style-rejected image is uploaded and published exactly once; replies stay disabled',async()=>{
 const {store:s,db}=await fixture();let generations=0,posts=0;const service={...services,image:async()=>{generations++;return services.image()}};
 const x={verify:async()=>({}),initMedia:async()=>({id:'777',expires_after_secs:86400}),appendMedia:async()=>{},finalizeMedia:async()=>({id:'777'}),mediaStatus:async()=>assert.fail('synchronous image must not poll STATUS'),post:async(text,reply,media)=>{posts++;assert.equal(reply,null);assert.equal(media,'777');assert.equal(text,'An ink shoreline, imagined.');return {id:'999',url:'https://x.com/i/web/status/999'}}};
 try{await seed(s);for(let i=0;i<6;i++)await mediaStep(s,reviewer('reject'),env,service,()=>x);assert.equal(generations,1);assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'ready');const now=new Date(7200000);await socialStep(s,reviewer(),env,now,()=>x);await socialStep(s,reviewer(),env,now,()=>x);assert.equal(posts,1);assert.equal((await s.latest('x_post')).assetId,'media-1-render');assert.equal((await s.status()).unresolved,0);assert.equal((await s.publicJournal()).some(e=>e.kind==='media_review'),true);}finally{await db.close()}
});
test('style rejection remains recorded and eligible; unknown generation is not charged twice',async()=>{
 const {store:s,db}=await fixture();try{await seed(s);await mediaStep(s,reviewer('reject'),env,services);await mediaStep(s,reviewer('reject'),env,services);assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'approved');assert.equal((await s.latest('media_review')).decision,'reject');}finally{await db.close()}
 const second=await fixture();let calls=0;try{await seed(second.store);const broken={...services,image:async()=>{calls++;throw Error('TIMEOUT')}};await mediaStep(second.store,reviewer(),env,broken);await mediaStep(second.store,reviewer(),env,broken);assert.equal(calls,1);assert.equal((await second.store.status()).unresolved,0);assert.ok((await second.store.status()).todayMicrodollars>=500000);}finally{await second.db.close()}
});
test('video persists prediction across workers, archives durable URL, and reviews the actual video',async()=>{
 const {store:s,db}=await fixture();try{await seed(s,{...plan,medium:'video',ratio:'9:16',duration:6});assert.equal((await mediaStep(s,reviewer(),env,services)).status,'video_started');assert.equal((await s.status()).unresolved,0);assert.equal((await mediaStep(s,reviewer(),env,services)).status,'video_archived');assert.equal((await s.asset('media-1-archive')).mime,'video/mp4');assert.equal((await mediaStep(s,reviewer(),env,services)).status,'media_approved');}finally{await db.close()}
});
test('expired lease does not repeat an uncertain paid request; lanes and daily cap remain enforced',async()=>{
 const {store:s,db}=await fixture();try{await seed(s);await s.begin('media-1-render','step',()=>({maximum:500000}));await s.begin('other-agent-work','step',()=>({maximum:1}));await s.complete('other-agent-work',1,{action:'wait'});await mediaStep(s,reviewer(),env,{...services,image:async()=>assert.fail('must not regenerate')});assert.equal((await s.status()).unresolved,0);await s.begin('consume-budget','step',()=>({maximum:49000000,budgetProvider:'replicate'}));await s.complete('consume-budget',49000000,{action:'wait'});await assert.rejects(s.begin('media-more','step',()=>({maximum:4000000,budgetProvider:'replicate'})),/ALLOWANCE/);}finally{await db.close()}
});
test('provider input matches video schema and downloads reject untrusted URLs and oversize data',async()=>{
 assert.equal(validateMediaPlan(plan,env).medium,'image');assert.throws(()=>validateMediaPlan({...plan,medium:'video',duration:60},env),/INVALID_MEDIA/);
 assert.throws(()=>trustedMediaURL('https://evil.test/video.mp4'),/UNTRUSTED/);assert.throws(()=>trustedMediaURL('http://replicate.delivery/a'),/UNTRUSTED/);
 const p=new MediaProviders(env,async(url,o)=>{assert.equal(url,'https://api.replicate.com/v1/models/google/veo-3.1-fast/predictions');assert.equal(JSON.parse(o.body).input.duration,6);return Response.json({id:'p1'})});assert.equal((await p.startVideo({...plan,duration:6,ratio:'9:16'})).id,'p1');
 await assert.rejects(readMedia('https://replicate.delivery/a',async()=>new Response('no',{headers:{'content-length':'99999999'}})),/TOO_LARGE/);
});
test('X media uses initialize, base64 append, finalize, status and media_ids on original post',async()=>{
 const calls=[];const x=new XClient({X_EXPECTED_USERNAME:'artist'},async(url,o)=>{calls.push([url,o.body?JSON.parse(o.body):null]);return Response.json(url.endsWith('/me')?{data:{username:'artist'}}:url.endsWith('/initialize')?{data:{id:'77',expires_after_secs:86400}}:url.includes('STATUS')?{data:{processing_info:{state:'succeeded'}}}:url.endsWith('/finalize')?{data:{id:'77'}}:{data:{id:'88'}})},async()=> 'token');
 const a={bytes:Buffer.from('abc'),mime:'video/mp4'};await x.initMedia(a);await x.appendMedia('77',0,a.bytes);await x.finalizeMedia('77');await x.mediaStatus('77');await x.post('film',null,'77');assert.equal(calls[0][1].media_category,'tweet_video');assert.equal(calls[1][1].media,'YWJj');assert.deepEqual(calls.at(-1)[1].media,{media_ids:['77']});assert.equal(calls.at(-1)[1].reply,undefined);
});


test('legacy image status failure reuses saved artwork and async finalization waits',async()=>{
 const {store:s,db}=await fixture();let uploads=0,statuses=0;
 const x={verify:async()=>({}),initMedia:async()=>{uploads++;return {id:'778'}},appendMedia:async()=>{},finalizeMedia:async()=>({id:'778',processing_info:{state:'pending'}}),mediaStatus:async()=>{statuses++;return {processing_info:{state:'succeeded'}}}};
 try{await seed(s);await mediaStep(s,reviewer(),env,services);await mediaStep(s,reviewer(),env,services);
 await s.pool.query("UPDATE agent_media_jobs SET state='processing_x',data=data || $1::jsonb",[JSON.stringify({mediaId:'777',expiresAt:Date.now()+86400000,retries:2})]);
 for(let i=0;i<3;i++)await mediaStep(s,reviewer(),env,{...services,image:async()=>assert.fail('must reuse saved image')},()=>x);
 assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'processing_x');
 await mediaStep(s,reviewer(),env,services,()=>x);
 assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'ready');assert.equal(uploads,1);assert.equal(statuses,1);
 }finally{await db.close()}
});

test('X finalization rejects missing data, embedded errors and wrong media IDs',async()=>{
 for(const response of [{},{data:{id:'77'},errors:[{title:'failed'}]},{data:{id:'88'}}]){
 const x=new XClient({X_EXPECTED_USERNAME:'artist'},async()=>Response.json(response),async()=>'token');
 await assert.rejects(x.finalizeMedia('77'),/X_INVALID_MEDIA_FINALIZE/);
 }
});

test('independent visual audit retains rejection but releases a ready image under advisory policy',async()=>{
 const {store:s,db}=await fixture();let calls=0;
 try{
  await seed(s,{...plan,referenceIds:[2,10]});
  await s.pool.query("UPDATE agent_media_jobs SET state='ready',data=$1",[JSON.stringify({assetId:'candidate',review:{decision:'publish',text:'A strange scene',alt:'Glossy character',summary:'Artist likes it'},expiresAt:Date.now()+86400000})]);
  assert.equal(await readyMedia(s),null);
  const provider={quote:()=>1,generate:async(system,prompt,asset,schema,refs)=>{calls++;assert.doesNotMatch(prompt,/Artist likes it|original moving shoreline/);assert.equal(refs.length,2);assert.ok(asset.bytes.length);return {costMicrodollars:2,value:{action:'publish',visualLanguageResult:'partly',referenceComparison:'Sharp advertising finish remains unlike reference edges',summary:'Reject despite amusing scene'}}}};
  const service={...services,load:async()=>({bytes:Buffer.from('candidate'),mime:'image/jpeg'}),references:async()=>[{bytes:Buffer.from('one'),mime:'image/jpeg'},{bytes:Buffer.from('two'),mime:'image/jpeg'}]};
  assert.equal((await mediaStep(s,provider,env,service,()=>assert.fail('must not upload'))).status,'visual_audit_recorded');
  assert.equal(calls,1);assert.ok(await readyMedia(s));assert.equal((await readyMedia(s)).data.styleAudit.decision,'reject');
  assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'ready');
 }finally{await db.close()}
});

test('Replicate-only cap preserves legacy video reservations and never blocks Gemini or publication',async()=>{
 const {store:s,db}=await fixture();try{
 await seed(s,{...plan,medium:'video',duration:6,ratio:'9:16'});
 await s.begin('media-1-render','step',()=>({maximum:4_000_000}));
 await s.complete('media-1-render',4_000_000,{action:'media_started',predictionId:'old'});
 await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 assert.equal((await s.status()).replicateBudget.reservedMicrodollars,4_000_000);
 await s.begin('video-budget','step',()=>({maximum:46_000_000,budgetProvider:'replicate'}));
 await s.complete('video-budget',46_000_000,{action:'media_started'});
 await assert.rejects(s.begin('media-next-video','step',()=>({maximum:1,budgetProvider:'replicate'})),/ALLOWANCE/);
 for(const id of ['text','media-image','x-publish-image']){
 await s.begin(id,'step',()=>({maximum:60_000_000}));await s.complete(id,60_000_000,{action:'wait'});
 }
 assert.equal((await s.status()).replicateBudget.reservedMicrodollars,50_000_000);
 await s.pool.query("UPDATE agent_operations SET day=day-1 WHERE budget_provider='replicate'");
 await s.begin('media-new-day','step',()=>({maximum:4_000_000,budgetProvider:'replicate'}));
 assert.equal((await s.status()).replicateBudget.reservedMicrodollars,4_000_000);
 await assert.rejects(s.begin('media-overlap','step',()=>({maximum:1,budgetProvider:'replicate'})),/UNRESOLVED/);
 }finally{await db.close()}
});

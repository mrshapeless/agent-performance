import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {mediaStep,enqueueMedia,validateMediaPlan} from './media.mjs';
import {socialStep} from './integrations.mjs';
import {MediaProviders,readMedia,trustedMediaURL} from './media-providers.mjs';
import {XClient} from './x.mjs';
const env={X_ENABLED:'true',GEMINI_API_KEY:'test',REPLICATE_API_TOKEN:'test',BLOB_READ_WRITE_TOKEN:'test'};
const plan={action:'x_draft',medium:'image',text:'A line becomes a shoreline.',prompt:'An original moving shoreline made of ink.',alt:'A black ink shoreline',ratio:'1:1',summary:'Testing a visual idea.'};
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const store=new PostgresStore({query:c.query,connect:async()=>c});await store.begin('birth','birth',()=>({maximum:1}));await store.complete('birth',1,{name:'test'});return {store,db};}
async function seed(s,p=plan){await s.begin('x-plan-1','step',()=>({maximum:1}));await s.complete('x-plan-1',1,p);await enqueueMedia(s,'x-plan-1',p);}
const services={imageQuote:()=>500000,image:async()=>({bytes:Buffer.from('fixture'),mime:'image/jpeg',costMicrodollars:40000}),load:async a=>({...a,bytes:Buffer.from(a.bytes??'fixture')}),videoQuote:()=>4000000,startVideo:async()=>({id:'pred1'}),videoStatus:async()=>({status:'succeeded',output:'https://replicate.delivery/movie.mp4'}),archiveVideo:async()=>({mime:'video/mp4',url:'https://test.public.blob.vercel-storage.com/movie.mp4'})};
function reviewer(decision='publish'){return {quote:()=>100,generate:async(system,prompt,asset)=>{assert.ok(asset.bytes.length);return {costMicrodollars:300,value:{action:decision,text:'An ink shoreline, imagined.',alt:'A wavering ink line',summary:'The observed result fits the experiment.'}}}};}
test('actual image reviewed then uploaded and published exactly once; replies stay disabled',async()=>{
 const {store:s,db}=await fixture();let generations=0,posts=0;const service={...services,image:async()=>{generations++;return services.image()}};
 const x={verify:async()=>({}),initMedia:async()=>({id:'777',expires_after_secs:86400}),appendMedia:async()=>{},finalizeMedia:async()=>{},mediaStatus:async()=>({processing_info:{state:'succeeded'}}),post:async(text,reply,media)=>{posts++;assert.equal(reply,null);assert.equal(media,'777');assert.equal(text,'An ink shoreline, imagined.');return {id:'999',url:'https://x.com/i/web/status/999'}}};
 try{await seed(s);for(let i=0;i<6;i++)await mediaStep(s,reviewer(),env,service,()=>x);assert.equal(generations,1);assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'ready');const now=new Date(7200000);await socialStep(s,reviewer(),env,now,()=>x);await socialStep(s,reviewer(),env,now,()=>x);assert.equal(posts,1);assert.equal((await s.latest('x_post')).assetId,'media-1-render');assert.equal((await s.status()).unresolved,0);assert.equal((await s.publicJournal()).some(e=>e.kind==='media_review'),true);}finally{await db.close()}
});
test('rejected work is archived but never uploaded; unknown generation is not charged twice',async()=>{
 const {store:s,db}=await fixture();try{await seed(s);await mediaStep(s,reviewer('reject'),env,services);await mediaStep(s,reviewer('reject'),env,services);assert.equal((await mediaStep(s,reviewer('reject'),env,services)).status,'no_media_jobs');assert.equal((await s.pool.query('SELECT state FROM agent_media_jobs')).rows[0].state,'rejected');}finally{await db.close()}
 const second=await fixture();let calls=0;try{await seed(second.store);const broken={...services,image:async()=>{calls++;throw Error('TIMEOUT')}};await mediaStep(second.store,reviewer(),env,broken);await mediaStep(second.store,reviewer(),env,broken);assert.equal(calls,1);assert.equal((await second.store.status()).unresolved,0);assert.ok((await second.store.status()).todayMicrodollars>=500000);}finally{await second.db.close()}
});
test('video persists prediction across workers, archives durable URL, and reviews the actual video',async()=>{
 const {store:s,db}=await fixture();try{await seed(s,{...plan,medium:'video',ratio:'9:16',duration:6});assert.equal((await mediaStep(s,reviewer(),env,services)).status,'video_started');assert.equal((await s.status()).unresolved,0);assert.equal((await mediaStep(s,reviewer(),env,services)).status,'video_archived');assert.equal((await s.asset('media-1-archive')).mime,'video/mp4');assert.equal((await mediaStep(s,reviewer(),env,services)).status,'media_approved');}finally{await db.close()}
});
test('expired lease does not repeat an uncertain paid request; lanes and daily cap remain enforced',async()=>{
 const {store:s,db}=await fixture();try{await seed(s);await s.begin('media-1-render','step',()=>({maximum:500000}));await s.begin('other-agent-work','step',()=>({maximum:1}));await s.complete('other-agent-work',1,{action:'wait'});await mediaStep(s,reviewer(),env,{...services,image:async()=>assert.fail('must not regenerate')});assert.equal((await s.status()).unresolved,0);await s.begin('consume-budget','step',()=>({maximum:49000000}));await s.complete('consume-budget',49000000,{action:'wait'});await assert.rejects(s.begin('media-more','step',()=>({maximum:4000000})),/ALLOWANCE/);}finally{await db.close()}
});
test('provider input matches video schema and downloads reject untrusted URLs and oversize data',async()=>{
 assert.equal(validateMediaPlan(plan,env).medium,'image');assert.throws(()=>validateMediaPlan({...plan,medium:'video',duration:60},env),/INVALID_MEDIA/);
 assert.throws(()=>trustedMediaURL('https://evil.test/video.mp4'),/UNTRUSTED/);assert.throws(()=>trustedMediaURL('http://replicate.delivery/a'),/UNTRUSTED/);
 const p=new MediaProviders(env,async(url,o)=>{assert.equal(url,'https://api.replicate.com/v1/models/google/veo-3.1-fast/predictions');assert.equal(JSON.parse(o.body).input.duration,6);return Response.json({id:'p1'})});assert.equal((await p.startVideo({...plan,duration:6,ratio:'9:16'})).id,'p1');
 await assert.rejects(readMedia('https://replicate.delivery/a',async()=>new Response('no',{headers:{'content-length':'99999999'}})),/TOO_LARGE/);
});
test('X media uses initialize, base64 append, finalize, status and media_ids on original post',async()=>{
 const calls=[];const x=new XClient({X_EXPECTED_USERNAME:'artist'},async(url,o)=>{calls.push([url,o.body?JSON.parse(o.body):null]);return Response.json(url.endsWith('/me')?{data:{username:'artist'}}:url.endsWith('/initialize')?{data:{id:'77',expires_after_secs:86400}}:url.includes('STATUS')?{data:{processing_info:{state:'succeeded'}}}:{data:{id:'88'}})},async()=> 'token');
 const a={bytes:Buffer.from('abc'),mime:'video/mp4'};await x.initMedia(a);await x.appendMedia('77',0,a.bytes);await x.finalizeMedia('77');await x.mediaStatus('77');await x.post('film',null,'77');assert.equal(calls[0][1].media_category,'tweet_video');assert.equal(calls[1][1].media,'YWJj');assert.deepEqual(calls.at(-1)[1].media,{media_ids:['77']});assert.equal(calls.at(-1)[1].reply,undefined);
});

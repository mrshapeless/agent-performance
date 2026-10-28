import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {validateCollage,composeCollage,collageDigest,collageSchema} from './collage.mjs';
import {enqueueMedia,mediaStep,validateMediaPlan} from './media.mjs';
import {preflightStep,preflightSchema} from './creative-preflight.mjs';
const box={x:0,y:0,width:1,height:1};
const layout=()=>({background:'#ffffff',layers:[{id:'red',prompt:'A red synthetic source field.',crop:{...box},place:{...box},mask:[],resolution:64,quality:100,kernel:'nearest'},{id:'blue',prompt:'A blue synthetic source field.',crop:{...box},place:{x:.25,y:.25,width:.5,height:.5},mask:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],resolution:128,quality:100,kernel:'nearest'}]});
const env={GEMINI_API_KEY:'synthetic',X_ENABLED:'false'};
const plan=()=>({action:'x_draft',medium:'image',renderer:'collage',text:'A synthetic collision.',summary:'Testing separate pixels.',prompt:'The two source fields collide.',alt:'A blue shape on red.',ratio:'1:1',referenceIds:[1,2],intent:'experiment',projectId:null});
async function color(background){return {bytes:await sharp({create:{width:64,height:64,channels:3,background}}).png().toBuffer(),mime:'image/png',costMicrodollars:2};}
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic'});return {s,db};}

test('compositor preserves independent source pixels, normalized masks and placement without repainting',async()=>{
 const red=await color('#ff0000'),blue=await color('#0000ff'),result=await composeCollage(layout(),[{id:'red',...red},{id:'blue',...blue}]);
 assert.equal(result.mime,'image/png');assert.ok(result.bytes.length<=3500000);
 const {data,info}=await sharp(result.bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,1024);assert.equal(info.height,1024);
 const rgb=(x,y)=>Array.from(data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3));
 assert.ok(rgb(100,100)[0]>250&&rgb(100,100)[2]<5);assert.ok(rgb(300,300)[2]>250&&rgb(300,300)[0]<5);assert.ok(rgb(700,700)[0]>250&&rgb(700,700)[2]<5);
 assert.equal((await sharp((await composeCollage(layout(),[{id:'red',...red},{id:'blue',...blue}],'16:9')).bytes).metadata()).height,576);
});
test('composition accepts no arbitrary executable markup and validates all bounded geometry',async()=>{
 for(const change of [v=>v.layers[0].place.width=2,v=>v.layers[0].resolution=100000,v=>v.layers[0].mask=[{x:NaN,y:0},{x:1,y:0},{x:0,y:1}],v=>v.layers.push(...v.layers)]){const v=layout();change(v);assert.throws(()=>validateCollage(v),/COLLAGE/);}
 const v=layout();v.layers[0].svg='<svg/>';assert.equal(validateCollage(v).layers[0].svg,undefined);
 const empty=layout();empty.layers[1].mask=[{x:0,y:0},{x:.5,y:.5},{x:1,y:1}];assert.throws(()=>validateCollage(empty),/EMPTY_COLLAGE_MASK/);
 await assert.rejects(()=>composeCollage(layout(),[{id:'red',bytes:Buffer.from('<svg/>')},{id:'blue',...{bytes:Buffer.from('bad')}}]),/INVALID_COLLAGE_SOURCE/);
});
test('selected alternative owns renderer; legacy plans retain the single renderer',()=>{
 const alternatives=['one','two','three'].map(id=>({id,concept:id,visualMechanism:id,composition:id,viewerExperience:id,renderPrompt:'Independent mechanism '+id,renderer:id==='two'?'collage':'single'}));
 const p={...plan(),alternatives,selectedId:'one',diversityComparison:'Separate constructions.'};
 assert.equal(validateMediaPlan(p,env,{requireAlternatives:true}).renderer,'single');assert.equal(validateMediaPlan({...p,selectedId:'two'},env,{requireAlternatives:true}).renderer,'collage');
 const old={...plan()};delete old.renderer;assert.equal(validateMediaPlan(old,env).renderer,'single');assert.throws(()=>validateMediaPlan({...plan(),medium:'video',ratio:'16:9',duration:4}, {...env,REPLICATE_API_TOKEN:'test',BLOB_READ_WRITE_TOKEN:'test'}),/INVALID_MEDIA_RENDERER/);
});
test('durable collage executes one paid call per step, resumes sources, emits only final public art, then uses existing review path',async()=>{
 const {s,db}=await fixture();let imageCalls=0,modelCalls=0;
 const sources=[await color('#ff0000'),await color('#0000ff')];
 const services={imageQuote:()=>10,references:async()=>[],image:async()=>sources[imageCalls++],collage:composeCollage,load:async a=>a};
 const provider={quote:()=>10,generate:async(_s,_p,_m,schema)=>{modelCalls++;if(schema===collageSchema)return {value:layout(),costMicrodollars:2};if(schema===preflightSchema)return {value:{repeatedMechanism:false,lostCommission:false,polishedAgainstRemit:false,legibleHook:true,reason:'Actual separate sources.',revision:'None required.'},costMicrodollars:2};return {value:{action:'publish',text:'Synthetic collision.',alt:'Blue on red.',summary:'Actual pixel experiment.'},costMicrodollars:2};}};
 const step=()=>mediaStep(new PostgresStore(s.pool),provider,env,services,()=>{throw Error('X must not run');});
 try{
  await enqueueMedia(s,'x-plan-collage-test',{...plan(),selectionVersion:'creative-v2'});
  assert.equal((await step()).status,'collage_planned');assert.equal(modelCalls,1);assert.equal(imageCalls,0);
  assert.equal((await step()).status,'creative_preflight');assert.equal((await step()).status,'creative_preflight');assert.equal(modelCalls,2);
  assert.equal((await step()).status,'collage_layer_created');assert.equal(imageCalls,1);assert.equal((await s.publicJournal()).filter(e=>e.kind==='art_image').length,0);
  assert.equal((await step()).status,'collage_layer_created');assert.equal(imageCalls,2);
  assert.equal((await step()).status,'collage_composed');assert.equal(imageCalls,2);assert.equal(modelCalls,2);
  const j=(await s.pool.query('SELECT * FROM agent_media_jobs')).rows[0];assert.equal(j.state,'rendered');assert.equal(j.data.sourceAssetIds.length,2);assert.ok((await s.asset(j.data.assetId)).bytes.length);
  assert.equal((await s.publicJournal()).filter(e=>e.kind==='art_image').length,1);
  assert.equal((await step()).status,'media_approved');assert.equal(imageCalls,2);
 }finally{await db.close();}
});
test('unknown source generation is quarantined and reservation retained without a duplicate paid call',async()=>{
 const {s,db}=await fixture();let calls=0;
 try{
  await enqueueMedia(s,'x-plan-unknown-collage',{...plan(),collage:layout()});
  const id='media-unknown-collage-collage-layer-red';await s.begin(id,'step',()=>({maximum:42}));
  const services={image:async()=>{calls++;throw Error('must not run');}};
  assert.equal((await mediaStep(s,{},env,services)).status,'media_failed');assert.equal(calls,0);
  const op=(await s.pool.query('SELECT * FROM agent_operations WHERE id=$1',[id])).rows[0];assert.equal(op.status,'complete');assert.equal(Number(op.amount),42);assert.equal(op.result.errorCode,'COLLAGE_OUTCOME_UNKNOWN');
  assert.equal((await mediaStep(s,{},env,services)).status,'no_media_jobs');
 }finally{await db.close();}
});
test('unknown layout planning is quarantined before any source generation',async()=>{
 const {s,db}=await fixture();let calls=0;
 try{await enqueueMedia(s,'x-plan-layout-unknown',plan());const id='media-layout-unknown-collage-layout';await s.begin(id,'step',()=>({maximum:17}));
  const result=await mediaStep(s,{generate:async()=>{calls++;} },env,{image:async()=>{calls++;}});assert.equal(result.status,'media_failed');assert.equal(calls,0);assert.equal((await s.operation(id)).status,'complete');assert.equal((await s.status()).unresolved,0);
 }finally{await db.close();}
});
test('collage preflight must revise the executable manifest, not only its description',async()=>{
 const {s,db}=await fixture();const original=layout(),job={id:'media-revise-collage',plan:{...plan(),collage:original,selectionVersion:'creative-v2'}};let calls=0;
 const changed=layout();changed.layers[1].place.x=.1;
 const provider={quote:()=>1,generate:async(_s,p,_m,schema)=>{calls++;if(schema===preflightSchema){assert.match(p,/"collage":/);return {costMicrodollars:1,value:{repeatedMechanism:true,lostCommission:false,polishedAgainstRemit:false,legibleHook:false,reason:'Weak juxtaposition.',revision:'Move the second source.'}};}assert.ok(schema.properties.collage);return {costMicrodollars:1,value:{prompt:job.plan.prompt,alt:'Two source layers.',collage:changed}};}};
 try{await preflightStep(s,provider,job);await preflightStep(s,provider,job);const result=await preflightStep(s,provider,job);assert.equal(result.ready,true);assert.notEqual(collageDigest(result.plan.collage),collageDigest(original));assert.equal(result.plan.collage.layers[1].place.x,.1);assert.equal(calls,2);}finally{await db.close();}
});
test('collage caption-only revision is recorded as unavailable without replacing executable layers',async()=>{
 const {s,db}=await fixture(),job={id:'media-false-revision',plan:{...plan(),collage:layout(),selectionVersion:'creative-v2'}};
 const provider={quote:()=>1,generate:async(_s,_p,_m,schema)=>({costMicrodollars:1,value:schema===preflightSchema?{repeatedMechanism:true,lostCommission:false,polishedAgainstRemit:false,legibleHook:false,reason:'Weak relationship',revision:'Change actual placement'}:{prompt:'A completely different description only.',alt:'New words.',collage:layout()}})};
 try{await preflightStep(s,provider,job);await preflightStep(s,provider,job);const r=await preflightStep(s,provider,job);assert.equal(r.audit.status,'revision_unavailable');assert.equal(collageDigest(r.plan.collage),collageDigest(job.plan.collage));assert.equal(r.plan.prompt,job.plan.prompt);}finally{await db.close();}
});

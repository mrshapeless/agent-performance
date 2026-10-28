import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {planExperiment,validateExperiment,validateExperimentReview} from './experiments.mjs';
import {mediaStep,enqueueMedia} from './media.mjs';
const fixtureReferences=async ids=>ids.map(id=>({id,mime:'image/png',bytes:Buffer.from('synthetic test pixels'),hash:'fixture'}));
const env={X_ENABLED:'true',X_REPLIES_ENABLED:'false',GEMINI_API_KEY:'test',REPLICATE_API_TOKEN:'test',BLOB_READ_WRITE_TOKEN:'test'};
const idea=(medium='image')=>({referenceIds:[2,10,17],hypothesis:'Can a soft form make a boundary feel unstable?',habitToBreak:'Rigid technical diagrams',audienceQuestion:'Which transformation is memorable?',alternatives:['a','b','c'].map((id,i)=>({id,concept:'An independent scene '+i,medium,palette:['coral','violet','gold'][i],material:['wax','cloth','glass'][i],composition:['close-up','wide','overhead'][i],dramaturgy:['melting','falling','rising'][i],visualMechanism:['deformation','juxtaposition','scale reversal'][i],viewerExperience:['unease','surprise','curiosity'][i],making:['rough collage','low-poly toy','uneven painting'][i],capture:'Flat scan with uneven lighting',circulation:'Simulated small forum image',visibleTest:'Jagged cutout edges and mismatched shadow'})),selectedId:'a',diversityComparison:'This explores deformation rather than the prior flat arrangement.',continuationReason:'',selectionReason:'The material makes the question visible.',projectId:null,prompt:'A coral wax gate melts into an impossible garden.',alt:'A melting coral gate',ratio:'16:9',duration:4,caption:'A boundary that cannot hold its shape.',summary:'Testing a departure from diagrams.'});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(s,a)=>{const r=await db.query(s,a);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const store=new PostgresStore({query:c.query,connect:async()=>c});await store.begin('birth','birth',()=>({maximum:1}));await store.complete('birth',1,{name:'Artist'});return {store,db};}
test('experiments reject repeated recipes, duplicate alternatives and wrong media before spending on render',()=>{
 const v=idea(),old=validateExperiment(v,env);
 assert.throws(()=>validateExperiment(v,env,[{kind:'x_draft',payload:old}]),/REPEATED/);
 const dup=idea();dup.alternatives[1]={...dup.alternatives[0],id:'b'};assert.throws(()=>validateExperiment(dup,env),/DUPLICATE/);
 assert.throws(()=>validateExperiment(v,env,[],'video'),/MEDIUM/);
 assert.equal(validateExperimentReview({action:'publish',observedResult:'Only a grid',hypothesisResult:'not_supported',noveltyEvidence:'No change',viewerHook:'Untested',nextExperiment:'Try a physical object'}).action,'reject');
});
for(const medium of ['image','video'])test(`${medium} experiment is durable, reviewed using actual bytes and exposed with alternatives; rejection is retained as advisory feedback`,async()=>{
 const {store:s,db}=await fixture();let plans=0,renders=0,reviews=0;
 const planner={quote:()=>100,generate:async(system,prompt,media,schema,refs)=>{plans++;assert.equal(refs.length,3);assert.ok(refs.every(r=>r.id>=25 && r.bytes.length>0));assert.match(prompt,/THREE/);assert.match(prompt,/character-led-v7/);assert.match(prompt,/unrelated to your existing technical projects/);assert.match(prompt,/not identity obligations/);assert.ok(schema.properties.alternatives);assert.equal(schema.properties.alternatives.items.properties.making,undefined);return {costMicrodollars:20,value:idea(medium)}}};
 const services={references:async()=>[2,10,17].map(id=>({id,hash:'test'+id,bytes:Buffer.from('reference pixels'),mime:'image/jpeg'})),imageQuote:()=>100,image:async()=>{renders++;return {bytes:Buffer.from('actual pixels'),mime:'image/jpeg',costMicrodollars:30}},videoQuote:()=>100,startVideo:async()=>{renders++;return {id:'p1'}},videoStatus:async()=>({status:'succeeded',output:'url'}),archiveVideo:async()=>({bytes:Buffer.from('actual frames'),mime:'video/mp4'}),load:async a=>({...a,bytes:Buffer.from(a.bytes)})};
 const reviewer={quote:()=>100,generate:async(system,prompt,asset,schema)=>{reviews++;assert.ok(asset.bytes.length);assert.match(prompt,/actual/);assert.match(prompt,/Rigid technical diagrams/);assert.ok(schema.properties.observedResult);return {costMicrodollars:30,value:{action:'publish',text:'A new scene.',alt:'Only a grid remains',summary:'The departure did not happen.',observedResult:'The result repeats the grid',hypothesisResult:'not_supported',craftEvidence:'Only a clean grid',craftResult:'not_supported',visualLanguageResult:'not_supported',referenceComparison:'Candidate is a clean grid; references are heterogeneous images',noveltyEvidence:'No material change',viewerHook:'Unmeasured',nextExperiment:'Try a material transformation'}}}};
 try{const id='x-plan-test-'+medium;await planExperiment(s,planner,env,id,medium,fixtureReferences);await planExperiment(s,planner,env,id,medium,fixtureReferences);assert.equal(plans,1);const p=(await s.operation(id)).result;assert.doesNotMatch(p.prompt,/Fabrication contract/);await enqueueMedia(s,id,p);await enqueueMedia(s,id,p);await mediaStep(s,reviewer,env,services);if(medium==='video')await mediaStep(s,reviewer,env,services);await mediaStep(s,reviewer,env,services,()=>assert.fail('must not upload rejected work'));assert.equal(renders,1);assert.equal(reviews,1);const publicWork=(await s.publicRuntime()).experiments[0];assert.equal(publicWork.state,'approved');assert.equal(publicWork.experiment.alternatives.length,3);assert.equal(publicWork.experiment.influence,undefined);assert.ok(!JSON.stringify(publicWork).includes('pinterest.com'));assert.ok(!JSON.stringify(publicWork).includes('pinimg.com'));assert.equal(publicWork.review.hypothesisResult,'not_supported');assert.equal((await s.status()).unresolved,0);
 }finally{await db.close()}
});
test('failed experimental planning is charged once and does not block unrelated agent work',async()=>{const {store:s,db}=await fixture();let calls=0;try{const provider={quote:()=>100,generate:async()=>{calls++;return {costMicrodollars:20,value:{}}}};await planExperiment(s,provider,env,'x-plan-invalid',null,fixtureReferences);await planExperiment(s,provider,env,'x-plan-invalid',null,fixtureReferences);assert.equal(calls,1);assert.equal((await s.status()).unresolved,0);assert.equal((await s.status()).todayMicrodollars,21)}finally{await db.close()}});

test('craft failure cannot publish even when the subject experiment succeeds',()=>{
 const v={action:'publish',observedResult:'A pristine toy with noise',hypothesisResult:'supported',noveltyEvidence:'New creature',viewerHook:'Unmeasured',nextExperiment:'Try jagged collage edges',craftEvidence:'Perfect edges and studio lighting; only uniform grain',craftResult:'not_supported'};
 assert.equal(validateExperimentReview(v,{making:'collage'}).action,'reject');
 assert.throws(()=>validateExperimentReview({...v,craftEvidence:''},{making:'collage'}),/INVALID_EXPERIMENT_REVIEW/);
 const plan=validateExperiment(idea(),env);assert.equal(plan.experiment.version,'experiment-v4');assert.equal(plan.experiment.craft,undefined);
});

test('a new clean cultural reinterpretation needs no craft score or degradation recipe',()=>{
 const v=idea();for(const a of v.alternatives)for(const k of ['making','capture','circulation','visibleTest'])delete a[k];
 const plan=validateExperiment(v,env);assert.equal(plan.experiment.craft,undefined);
 const review={action:'publish',observedResult:'A glossy mascot mourns its missing reflection',hypothesisResult:'supported',noveltyEvidence:'A familiar promotional smile becomes an uncertain gesture',viewerHook:'Unmeasured emotional contradiction',nextExperiment:'Explore whether the motif survives a more exuberant scene'};
 assert.equal(validateExperimentReview(review).action,'publish');
});



test('diversity context uses distinct published works and comparison survives public output',async()=>{
 const {store:s,db}=await fixture();try{
 for(let i=0;i<3;i++)await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data) VALUES($1,$2,$3,$4,$5)",['history-'+i,'history-plan-'+i,JSON.stringify({medium:'image',prompt:'Construction '+i,alt:'Scene '+i,text:'Caption '+i}),i===2?'queued':'published',JSON.stringify({review:{decision:'reject',text:'Published caption '+i,alt:'Observed work '+i}})]);
 let context;
 await s.begin('inspect-context','step',(_,__,c)=>{context=c;return {maximum:0}});
 assert.equal(context.visualHistory.length,2);
 assert.equal(new Set(context.visualHistory.map(w=>w.id)).size,2);
 assert.ok(context.visualHistory.every(w=>w.caption.startsWith('Published caption')));
 await s.complete('inspect-context',0,{action:'wait'});
 const planner={quote:()=>1,generate:async(_,prompt)=>{
 assert.match(prompt,/DIVERSITY POLICY v1/);assert.match(prompt,/Construction 0/);assert.match(prompt,/Construction 1/);assert.doesNotMatch(prompt,/Construction 2/);
 return {costMicrodollars:1,value:idea()};}};
 await planExperiment(s,planner,env,'diversity-fixture','image',fixtureReferences);
 const result=(await s.operation('diversity-fixture')).result;
 assert.equal(result.experiment.diversityComparison,idea().diversityComparison);
 assert.equal(result.experiment.alternatives[0].visualMechanism,'deformation');
 }finally{await db.close()}
});

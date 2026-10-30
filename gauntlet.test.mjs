import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createGauntletHandler,noPublishingClient} from './gauntlet.mjs';
import {PostgresStore} from './postgres.mjs';
import {axes} from './taste.mjs';
import {workspaceEvidence} from './workspace-state.mjs';
import {scopedPool} from './instance.mjs';
import {CREATIVE_REVISION} from './creative-revision.mjs';

const secret='synthetic-test-secret-not-a-credential';
const ids=['perception','recall','exploration','self_monitor'];
const candidate={action:'commission',goalId:'new-idea',projectId:'',objective:'Visible joke',why:'Cultural play',success:'Readable contrast',proposal:'Create an original amateur collage with a readable joke.',novelty:'New visual mechanism',uncertainty:'Unknown response',evidence:[],prediction:{metric:'publication',probability:.5},queries:[]};
function mockProvider(){return {quote:()=>1,generate:async(_system,p,_media,schema)=>{
 let value;
 if(schema?.properties?.assessments)value={assessments:ids.map(id=>({id,visibleHook:'Visual contradiction',imageLanguage:'Uneven source layers',nearestRepeat:'None',materiallyRepeated:false,legibleHook:true,revision:'Not needed'}))};
 else if(schema?.properties?.attention)value={selectedId:'exploration',attention:['exploration'],summary:'Original visual play',selection:ids.map(id=>({id,reason:'Compared visible mechanism'})),selfModel:{desire:'Explore',preferences:['Contrast'],uncertainties:['Response'],change:'New experiment'},evidence:[],goalChanges:[],sources:['Colossal'],note:{claim:'Try the idea',evidence:[],links:[]}};
 else if(schema?.properties?.repeatedMechanism)value={repeatedMechanism:false,lostCommission:false,polishedAgainstRemit:false,legibleHook:true,reason:'Distinct mechanism',revision:'No revision required'};
 else if(p.startsWith('Private visual experience'))value={action:'x_draft',intent:'experiment',projectId:null,medium:'image',text:'A synthetic joke.',summary:'An experiment',prompt:'Discard this generic fallback.',alt:'A collage',ratio:'1:1',referenceIds:[1,2],selectedId:'a',diversityComparison:'New construction',alternatives:['a','b','c'].map(id=>({id,renderer:schema.properties.alternatives.items.properties.renderer?.enum?.[0]??'single',concept:'Idea '+id,visualMechanism:'Mechanism '+id,composition:'Composition '+id,viewerExperience:'Experience '+id,renderPrompt:'The selected collage construction '+id}))};
 else if(schema?.properties?.action?.enum?.includes('commission'))value=candidate;
 else value={visualLanguageResult:'supported',referenceComparison:'Soft capture and flat light match current reference.',integrityResult:'supported',integrityEvidence:'Focal details remain coherent throughout the image.',action:'publish',text:'A synthetic joke.',alt:'A collage',summary:'Interesting but imperfect',visualLanguageResult:'supported',referenceComparison:'Different spatial relationships'};
 return {costMicrodollars:1,value};
 }};}

async function fixture(){
 const db=new PGlite();await db.exec('CREATE SCHEMA generation_02; SET search_path TO generation_02;'+await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 let locked=true,opened=0;
 const query=async(sql,args)=>{
  // PGlite is single-session: emulate only the session-lock interface, execute all
  // initialization, FK, phase, transaction and isolation SQL against PostgreSQL.
  if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked}]};
  if(sql.includes('pg_advisory_unlock'))return {rows:[]};
  if(sql.startsWith('CREATE TABLE IF')){await db.exec(sql);return {rows:[]};}
  const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};
 };
 const c={query,release(){}},pool={query,connect:async()=>c,end:async()=>{}};
 const store=new PostgresStore(pool);await store.begin('birth','birth',()=>({maximum:0}));await store.complete('birth',0,{name:'Synthetic test artist'});
 await store.transaction(async c=>{
  await store.append(c,'studio_revision',{projects:[]});
  await c.query("INSERT INTO agent_assets(id,mime,bytes) VALUES('seed-art','image/png',$1)",[Buffer.from('synthetic pixels')]);
  await c.query("INSERT INTO agent_visual_profiles(asset_id,observation,traits) VALUES('seed-art','Synthetic source profile',$1)",[JSON.stringify(Object.fromEntries(axes.map(a=>[a,.5])))]);
  await c.query("INSERT INTO agent_taste_feedback(id,asset_id,verdict) VALUES('seed-feedback','seed-art','pass')");
  await c.query("INSERT INTO agent_oauth_tokens(id,username,secret,status) VALUES(1,'synthetic','DO_NOT_COPY','connected')");
  await c.query("INSERT INTO agent_inbox(id,platform,author,text) VALUES('private','web','synthetic','DO_NOT_COPY')");
 });
 const original=(await db.query('SELECT * FROM generation_02.agent_events ORDER BY seq')).rows;
 await db.exec('SET search_path TO public');
 let renderedPrompt,renderCalls=0;
 const services={imageQuote:()=>1,references:async()=>[],image:async p=>{renderedPrompt=p;renderCalls++;return {mime:'image/png',bytes:Buffer.from('synthetic output'),costMicrodollars:1};},load:async a=>a};
 const handler=createGauntletHandler({env:{VERCEL_ENV:'production',AGENT_ENABLED:'true',GAUNTLET_SECRET:secret,GEMINI_API_KEY:'synthetic'},openPool:async()=>{opened++;let first=true;return {...pool,connect:async()=>{if(!first)return c;first=false;return {release(){},query:async(sql,args)=>["BEGIN","ROLLBACK"].includes(sql)?{rows:[]}:query(sql,args)};}};},createProvider:mockProvider,createServices:()=>services,now:()=>new Date('2026-10-28T12:00:00Z')});
 const request=(action,auth=true,path='')=>handler(new Request('https://example.org/api/gauntlet'+path,{method:action?'POST':'GET',headers:auth?{authorization:'Bearer '+secret}:{},...(action?{body:JSON.stringify(typeof action==='string'?{action}:action)}:{})}));
 const call=async action=>{const r=await request(action);assert.equal(r.status,200,await r.clone().text());return r.json();};
 return {db,original,request,call,pool,setLocked:v=>{locked=v;},get opened(){return opened;},get renderedPrompt(){return renderedPrompt;},get renderCalls(){return renderCalls;}};
}

test('decision diagnostics expose only current revision operation metadata and reuse synthetic request',async()=>{
 const f=await fixture();try{
  const id='workspace-v1-'+CREATIVE_REVISION+'-498157-broadcast';
  const episode=id.replace(/-broadcast$/,'');
  const entries=[[episode+'-snapshot',{action:'workspace_snapshot',state:{goals:[]},evidence:[]}],...ids.map(name=>[episode+'-'+name,{...candidate,id:name,choice:candidate.action,action:'workspace_proposal'}]),[episode+'-creative-review-final',{assessments:ids.map(id=>({id,materiallyRepeated:false}))}]];
  for(const [key,value] of entries)await f.db.query("INSERT INTO generation_02.agent_operations(id,kind,status,amount,day,result) VALUES($1,'step','complete',0,'2026-10-28',$2)",[key,JSON.stringify(value)]);
  for(const op of [id,'workspace-v1-zzz-old-498000-broadcast'])await f.db.query("INSERT INTO generation_02.agent_operations(id,kind,status,amount,day,result) VALUES($1,'step','complete',0,'2026-10-28',$2)",[op,JSON.stringify({action:'cognition_failed',failureCode:'GEMINI_HTTP_400',privateContext:'DO_NOT_COPY'})]);
  const first=await f.call('decision-check'),second=await f.call('decision-check');
  assert.equal(first.status,'passed');assert.equal(second.replay,true);
  assert.ok(first.operations.some(r=>r.id===id&&r.failure_code==='GEMINI_HTTP_400'));
  assert.doesNotMatch(JSON.stringify(second),/DO_NOT_COPY|zzz-old/);
 }finally{await f.db.close();}
});

test('private gauntlet seeds nonempty FK-linked experience, executes cognition through preflight and pixels, never publishes or mutates source',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('init',false)).status,401);assert.equal(f.opened,0);
  assert.equal((await f.call('init')).status,'initialized');assert.equal((await f.call('init')).status,'already_initialized');
  for(const table of ['agent_assets','agent_visual_profiles','agent_taste_feedback'])assert.equal((await f.db.query('SELECT count(*) FROM gauntlet_v1.'+table)).rows[0].count,1);
  for(const table of ['agent_oauth_tokens','agent_inbox','agent_room'])assert.equal((await f.db.query('SELECT count(*) FROM gauntlet_v1.'+table)).rows[0].count,0);
  assert.equal((await f.request('advance')).status,409);
  for(let i=0;i<6;i++)await f.call('step');
  // A claimed planner with no result is unfinished, not an implicit text post.
  const cycleState=await f.call(),pendingPlan='x-plan-'+Math.floor(new Date(cycleState.virtualSlot).getTime()/7200000);
  await f.db.query("INSERT INTO gauntlet_v1.agent_operations(id,kind,status,amount,day) VALUES($1,'step','pending',1,'2026-10-28')",[pendingPlan]);
  assert.equal((await f.call()).finished,false);assert.equal((await f.request('advance')).status,409);
  await f.db.query('DELETE FROM gauntlet_v1.agent_operations WHERE id=$1',[pendingPlan]);
  assert.equal((await f.call('plan')).status,'planned');assert.equal((await f.call('plan')).status,'already_planned');
  assert.equal((await f.call('render')).status,'creative_preflight');assert.equal(f.renderCalls,0);
  assert.equal((await f.call('render')).status,'creative_preflight');assert.equal(f.renderCalls,0);
  assert.equal((await f.call('render')).status,'image_created');assert.equal(f.renderedPrompt,'The selected collage construction a');
  assert.equal((await f.call('render')).status,'media_approved');assert.equal((await f.request('advance')).status,409);
  assert.equal((await f.call('render')).status,'visual_audit_recorded');assert.equal((await f.call('render')).status,'review_complete');assert.equal(f.renderCalls,1);
  const status=await f.call();assert.equal(status.publicationEnabled,false);assert.equal(status.finished,true);
  const asset=status.jobs[0].data.assetId;
  assert.equal((await f.request(null,false,'?asset='+asset)).status,401);
  assert.equal((await f.request(null,true,'?asset=seed-art')).status,404);
  const image=await f.request(null,true,'?asset='+asset);assert.equal(image.status,200);assert.equal(await image.text(),'synthetic output');
  assert.equal((await f.db.query("SELECT count(*) FROM gauntlet_v1.agent_operations WHERE id LIKE 'x-publish-%'")).rows[0].count,0);
  assert.deepEqual((await f.db.query('SELECT * FROM generation_02.agent_events ORDER BY seq')).rows,f.original);
  assert.equal((await f.call('advance')).status,'advanced');
  for(let i=0;i<6;i++)await f.call('step');
  assert.equal((await f.call('plan')).status,'planned');
  for(let i=0;i<2;i++)assert.equal((await f.call('render')).status,'creative_preflight');
  assert.equal((await f.call('render')).status,'image_created');assert.equal(f.renderCalls,2);
  f.setLocked(false);assert.equal((await f.request('step')).status,409);
 }finally{await f.db.close();}
});

test('publication client cannot post, upload, read timelines or fetch tokens',()=>{
 for(const method of ['post','upload','recentPosts','verify'])assert.throws(()=>noPublishingClient()[method](),/GAUNTLET_EXTERNAL_PUBLICATION_DISABLED/);
});

test('private independent feedback appends once, survives as future evidence, and never replaces original review',async()=>{
 const f=await fixture();try{
  const feedback={action:'feedback',assetId:'trial-art',verdict:'fail',observation:'The readable label offers no visual surprise.',nextExperiment:'Change the perceptible relationship rather than substituting a new object.'};
  assert.equal((await f.request(feedback,false)).status,401);assert.equal(f.opened,0);
  await f.call('init');
  assert.equal((await f.request(feedback)).status,404);assert.equal((await f.request({...feedback,assetId:'seed-art'})).status,404);
  await f.db.query("INSERT INTO gauntlet_v1.agent_assets(id,mime,bytes) VALUES('trial-art','image/png',$1)",[Buffer.from('synthetic trial')]);
  await f.db.query("INSERT INTO gauntlet_v1.agent_media_jobs(id,plan_id,plan,state,data) VALUES('trial-job','trial-plan','{}','gauntlet_complete',$1)",[JSON.stringify({assetId:'trial-art',review:{summary:'Original self-assessment'}})]);
  const first=await f.call(feedback),again=await f.call(feedback);assert.equal(first.status,'feedback_saved');assert.equal(first.replay,false);assert.equal(again.replay,true);assert.equal(first.feedbackKey,again.feedbackKey);
  const rows=(await f.db.query("SELECT payload::jsonb AS payload FROM gauntlet_v1.agent_events WHERE payload::jsonb->>'feedbackKey'=$1",[first.feedbackKey])).rows;assert.equal(rows.length,1);assert.equal(rows[0].payload.source,'independent_test_critic');assert.equal(rows[0].payload.visualLanguageResult,'not_supported');
  const evidence=await workspaceEvidence(new PostgresStore(scopedPool(f.pool,'gauntlet_v1')),1),entry=evidence.find(e=>e.assetId==='trial-art');assert.equal(entry.criticism.nextExperiment,feedback.nextExperiment);assert.match(entry.summary,/not operator feedback or audience evidence/);
  assert.equal((await f.db.query("SELECT data->'review'->>'summary' AS summary FROM gauntlet_v1.agent_media_jobs WHERE id='trial-job'")).rows[0].summary,'Original self-assessment');
  assert.deepEqual((await f.db.query('SELECT * FROM generation_02.agent_events ORDER BY seq')).rows,f.original);
  assert.equal((await f.request({...feedback,observation:'x'.repeat(1201)})).status,400);assert.equal((await f.request({...feedback,verdict:'maybe'})).status,400);assert.equal((await f.request({...feedback,extra:'x'.repeat(4000)})).status,400);
  await f.db.query("UPDATE gauntlet_v1.agent_media_jobs SET state='published' WHERE id='trial-job'");assert.equal((await f.request({...feedback,verdict:'pass'})).status,404);
 }finally{await f.db.close();}
});

test('explicit private renderer qualification uses collage without changing ordinary planning',async()=>{const f=await fixture();try{await f.call('init');assert.equal((await f.request({action:'plan',renderer:'unknown'})).status,400);for(let i=0;i<6;i++)await f.call('step');assert.equal((await f.call({action:'plan',renderer:'collage'})).status,'planned');assert.equal((await f.call()).jobs[0].plan.renderer,'collage');assert.equal(f.renderCalls,0);}finally{await f.db.close();}});

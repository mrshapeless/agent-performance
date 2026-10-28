import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createGauntletHandler,noPublishingClient} from './gauntlet.mjs';
import {PostgresStore} from './postgres.mjs';
import {axes} from './taste.mjs';

const secret='synthetic-test-secret-not-a-credential';
const ids=['perception','recall','exploration','self_monitor'];
const candidate={action:'commission',goalId:'new-idea',projectId:'',objective:'Visible joke',why:'Cultural play',success:'Readable contrast',proposal:'Create an original amateur collage with a readable joke.',novelty:'New visual mechanism',uncertainty:'Unknown response',evidence:[],prediction:{metric:'publication',probability:.5},queries:[]};
function mockProvider(){return {quote:()=>1,generate:async(_system,p,_media,schema)=>{
 let value;
 if(schema?.properties?.assessments)value={assessments:ids.map(id=>({id,visibleHook:'Visual contradiction',imageLanguage:'Uneven source layers',nearestRepeat:'None',materiallyRepeated:false,legibleHook:true,revision:'Not needed'}))};
 else if(schema?.properties?.attention)value={selectedId:'exploration',attention:['exploration'],summary:'Original visual play',selection:ids.map(id=>({id,reason:'Compared visible mechanism'})),selfModel:{desire:'Explore',preferences:['Contrast'],uncertainties:['Response'],change:'New experiment'},evidence:[],goalChanges:[],sources:['Colossal'],note:{claim:'Try the idea',evidence:[],links:[]}};
 else if(schema?.properties?.repeatedMechanism)value={repeatedMechanism:false,lostCommission:false,polishedAgainstRemit:false,legibleHook:true,reason:'Distinct mechanism',revision:'No revision required'};
 else if(p.startsWith('Private visual experience'))value={action:'x_draft',intent:'experiment',projectId:null,medium:'image',text:'A synthetic joke.',summary:'An experiment',prompt:'Discard this generic fallback.',alt:'A collage',ratio:'1:1',referenceIds:[1,2],selectedId:'a',diversityComparison:'New construction',alternatives:['a','b','c'].map(id=>({id,concept:'Idea '+id,visualMechanism:'Mechanism '+id,composition:'Composition '+id,viewerExperience:'Experience '+id,renderPrompt:'The selected collage construction '+id}))};
 else if(schema?.properties?.action?.enum?.includes('commission'))value=candidate;
 else value={action:'publish',text:'A synthetic joke.',alt:'A collage',summary:'Interesting but imperfect',visualLanguageResult:'partly',referenceComparison:'Different spatial relationships'};
 return {costMicrodollars:1,value};
 }};}

async function fixture(){
 const db=new PGlite();await db.exec('CREATE SCHEMA generation_02; SET search_path TO generation_02;'+await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 let locked=true,opened=0;
 const query=async(sql,args)=>{
  // PGlite is single-session: emulate only the session-lock interface, execute all
  // initialization, FK, phase, transaction and isolation SQL against PostgreSQL.
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}]};
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
 const handler=createGauntletHandler({env:{VERCEL_ENV:'production',AGENT_ENABLED:'true',GAUNTLET_SECRET:secret,GEMINI_API_KEY:'synthetic'},openPool:async()=>{opened++;return pool;},createProvider:mockProvider,createServices:()=>services,now:()=>new Date('2026-10-28T12:00:00Z')});
 const request=(action,auth=true,path='')=>handler(new Request('https://example.org/api/gauntlet'+path,{method:action?'POST':'GET',headers:auth?{authorization:'Bearer '+secret}:{},...(action?{body:JSON.stringify({action})}:{})}));
 const call=async action=>{const r=await request(action);assert.equal(r.status,200,await r.clone().text());return r.json();};
 return {db,original,request,call,setLocked:v=>{locked=v;},get opened(){return opened;},get renderedPrompt(){return renderedPrompt;},get renderCalls(){return renderCalls;}};
}

test('private gauntlet seeds nonempty FK-linked experience, executes cognition through preflight and pixels, never publishes or mutates source',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('init',false)).status,401);assert.equal(f.opened,0);
  assert.equal((await f.call('init')).status,'initialized');assert.equal((await f.call('init')).status,'already_initialized');
  for(const table of ['agent_assets','agent_visual_profiles','agent_taste_feedback'])assert.equal((await f.db.query('SELECT count(*) FROM gauntlet_v1.'+table)).rows[0].count,1);
  for(const table of ['agent_oauth_tokens','agent_inbox','agent_room'])assert.equal((await f.db.query('SELECT count(*) FROM gauntlet_v1.'+table)).rows[0].count,0);
  assert.equal((await f.request('advance')).status,409);
  for(let i=0;i<6;i++)await f.call('step');
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
  f.setLocked(false);assert.equal((await f.request('step')).status,409);
 }finally{await f.db.close();}
});

test('publication client cannot post, upload, read timelines or fetch tokens',()=>{
 for(const method of ['post','upload','recentPosts','verify'])assert.throws(()=>noPublishingClient()[method](),/GAUNTLET_EXTERNAL_PUBLICATION_DISABLED/);
});

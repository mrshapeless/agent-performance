import {readFile} from 'node:fs/promises';
import {authorized} from './cloud.mjs';
import {ACTIVE_INSTANCE,scopedPool} from './instance.mjs';
import {PostgresStore} from './postgres.mjs';
import {workspaceStep} from './workspace.mjs';
import {socialStep} from './integrations.mjs';
import {studioOperationId} from './studio.mjs';
import {mediaStep,enqueueMedia} from './media.mjs';
import {MediaProviders} from './media-providers.mjs';

export const GAUNTLET_SCHEMA='gauntlet_v1';
const lock=730299;
const forbidden=()=>{throw Error('GAUNTLET_EXTERNAL_PUBLICATION_DISABLED');};
export const noPublishingClient=()=>new Proxy({},{get:()=>forbidden});
const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
const json=(v,status=200)=>Response.json(v,{status,headers});

async function initialize(pool,now){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  if((await c.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1',[GAUNTLET_SCHEMA])).rows.length){await c.query('ROLLBACK');return {status:'already_initialized'};}
  await c.query('CREATE SCHEMA gauntlet_v1');
  await c.query('SET LOCAL search_path TO gauntlet_v1');
  await c.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  await c.query('CREATE TABLE run_state(id integer PRIMARY KEY CHECK(id=1),started timestamptz NOT NULL,cycle integer NOT NULL DEFAULT 0)');
  await c.query('INSERT INTO run_state(id,started) VALUES(1,$1)',[now.toISOString()]);
  // Explicit source allowlist: no credentials, inbox, room messages or private reply drafts.
  const kinds=['identity','studio_revision','reflect','observation','x_post','art_image','art_video','media_review','record_note','workspace_note','workspace_broadcast','workspace_outcome'];
  const events=(await c.query(`SELECT kind,payload FROM ((SELECT DISTINCT ON(kind) seq,kind,payload FROM "${ACTIVE_INSTANCE}".agent_events WHERE kind=ANY($1::text[]) ORDER BY kind,seq DESC) UNION (SELECT seq,kind,payload FROM "${ACTIVE_INSTANCE}".agent_events WHERE kind IN ('x_post','media_review','workspace_note','record_note') ORDER BY seq DESC LIMIT 100)) seed ORDER BY seq`,[kinds])).rows;
  const seedStore=new PostgresStore(pool);
  for(const e of events)await seedStore.append(c,e.kind,JSON.parse(e.payload));
  // Profiles reference assets; feedback references profiles. Seed in dependency order.
  await c.query(`INSERT INTO gauntlet_v1.agent_assets SELECT * FROM "${ACTIVE_INSTANCE}".agent_assets WHERE id IN (SELECT asset_id FROM "${ACTIVE_INSTANCE}".agent_visual_profiles) OR id IN (SELECT payload::jsonb->>'assetId' FROM gauntlet_v1.agent_events)`);
  for(const table of ['agent_goals','agent_lessons','agent_visual_profiles','agent_taste_feedback'])await c.query(`INSERT INTO gauntlet_v1.${table} SELECT * FROM "${ACTIVE_INSTANCE}".${table}`);
  await c.query(`INSERT INTO gauntlet_v1.agent_media_jobs SELECT * FROM "${ACTIVE_INSTANCE}".agent_media_jobs WHERE state='published' ORDER BY updated DESC LIMIT 12`);
  await c.query('COMMIT');return {status:'initialized',cycle:0};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

export function createGauntletHandler({env,openPool,createProvider,now=()=>new Date(),createServices=e=>new MediaProviders(e)}){
 return async request=>{
  if(!authorized(request.headers.get('authorization'),env.AGENT_ADMIN_SECRET)&&!authorized(request.headers.get('authorization'),env.GAUNTLET_SECRET))return json({error:'UNAUTHORIZED'},401);
  if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405);
  if(env.VERCEL_ENV!=='production'||env.AGENT_ENABLED!=='true')return json({error:'EXECUTION_DISABLED'},409);
  const url=new URL(request.url);let action;
  if(request.method==='POST'){try{const raw=await request.text();if(raw.length>256)throw Error();action=JSON.parse(raw).action;}catch{return json({error:'INVALID_INPUT'},400);}if(!['init','step','plan','render','advance'].includes(action))return json({error:'INVALID_ACTION'},400);}
  const pool=await openPool();let guard;
  try{
   guard=await pool.connect();
   if(!(await guard.query('SELECT pg_try_advisory_lock($1) AS locked',[lock])).rows[0].locked)return json({status:'busy'},409);
   if(action==='init')return json(await initialize(pool,now()));
   if(!(await pool.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1',[GAUNTLET_SCHEMA])).rows.length)return json({status:'not_initialized'},409);
   const state=(await pool.query('SELECT * FROM gauntlet_v1.run_state WHERE id=1')).rows[0];
   const store=new PostgresStore(scopedPool(pool,GAUNTLET_SCHEMA));
   // This diagnostic run tests still-image construction; never create an unaccounted
   // Replicate reservation in a separate ledger or upload a test movie to public Blob.
   const testEnv={...env,REPLICATE_API_TOKEN:undefined,BLOB_READ_WRITE_TOKEN:undefined,X_REPLIES_ENABLED:'false'};
   const testProvider=()=>{const p=createProvider();return {quote:p.quote.bind(p),generate:(system,prompt,...args)=>p.generate(system,prompt+' Diagnostic capability: only still images and text are available in this isolated run; no video generator.',...args)};};
   // Virtual slots isolate replay keys only. Actual event timestamps remain real.
   const slotTime=new Date(new Date(state.started).getTime()+state.cycle*7200000);
   const planId='x-plan-'+Math.floor(slotTime.getTime()/7200000);
   const currentPlan=await store.operation(planId);
   const job=(await store.pool.query('SELECT * FROM agent_media_jobs WHERE plan_id=$1',[planId])).rows[0];
   const broadcast=await store.operation('workspace-v1-'+Math.floor(slotTime.getTime()/3600000)+'-broadcast');
   const decision=await store.latest('cognitive_decision');
   const mediaFinished=['rejected','failed'].includes(job?.state)||(job?.state==='approved'&&(!job.plan.referenceIds||!!job.data.styleAudit));
   const finished=(broadcast?.result?.action==='workspace_broadcast'&&decision?.choice!=='commission')||!!currentPlan&&((currentPlan.result?.medium??'text')==='text'||mediaFinished);
   if(request.method==='GET'){
    const assetId=url.searchParams.get('asset');
    if(assetId){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(assetId))return json({error:'INVALID_ASSET'},400);const owned=(await store.pool.query("SELECT id FROM agent_media_jobs WHERE data->>'assetId'=$1 AND state<>'published'",[assetId])).rows[0];if(!owned)return json({error:'NOT_FOUND'},404);const a=await store.asset(assetId);if(!a)return json({error:'NOT_FOUND'},404);const loaded=a.bytes?a:await createServices(env).load(a);return new Response(loaded.bytes,{headers:{...headers,'Content-Type':loaded.mime}});}
    return json({cycle:state.cycle,started:state.started,virtualSlot:slotTime,finished,publicationEnabled:false,operations:(await store.pool.query('SELECT id,status,result FROM agent_operations ORDER BY id')).rows,jobs:(await store.pool.query("SELECT id,state,plan,data FROM agent_media_jobs WHERE state<>'published' ORDER BY created")).rows});
   }
   if(action==='advance'){
    if(!finished)return json({error:'CYCLE_NOT_FINISHED'},409);
    await store.pool.query("UPDATE agent_agenda SET status='completed' WHERE status IN ('active','commissioned')");
    await pool.query('UPDATE gauntlet_v1.run_state SET cycle=cycle+1 WHERE id=1');return json({status:'advanced',cycle:state.cycle+1});
   }
   if(action==='step'){if(currentPlan)return json({status:'already_planned'});return json(await workspaceStep(store,testProvider(),slotTime));}
   if(action==='plan'){
    if(currentPlan)return json({status:'already_planned'});
    if(broadcast?.result?.action!=='workspace_broadcast'||!decision)return json({error:'COGNITION_REQUIRED'},409);
    if(decision.choice!=='commission')return json({status:'non_media_choice',choice:decision.choice});
    const sid=await studioOperationId(store,slotTime);if(!await store.operation(sid)){const r=await store.begin(sid,'step',()=>({maximum:0}));if(!r.replay)await store.complete(sid,0,{action:'gauntlet_studio_snapshot'});}
    const result=await socialStep(store,testProvider(),{...testEnv,X_ENABLED:'true'},slotTime,noPublishingClient);
    const plan=await store.operation(planId);if(plan?.result?.action==='x_draft'&&['image','video'].includes(plan.result.medium))await enqueueMedia(store,planId,plan.result);
    return json(result);
   }
   if(!job)return json({status:'no_media_job'});
   // Call only phases that cannot upload or publish. Image audit is separately bounded.
   const auditOnly=job.state==='approved'&&job.plan.medium==='image'&&job.plan.referenceIds&&!job.data.styleAudit;
   if(!['queued','processing','rendered'].includes(job.state)&&!auditOnly)return json({status:'review_complete',state:job.state});
   return json(await mediaStep(store,testProvider(),{...testEnv,X_ENABLED:'false'},createServices(testEnv),noPublishingClient));
  }catch(error){const code=/^[A-Z0-9_]{2,60}$/.test(error.code??'')?error.code:'INTERNAL';console.error('gauntlet_failed',code);return json({error:/^[A-Z_]+$/.test(error.message)?error.message:'GAUNTLET_FAILED',code},500);}
  finally{if(guard){await guard.query('SELECT pg_advisory_unlock($1)',[lock]).catch(()=>{});guard.release();}await pool.end();}
 };
}

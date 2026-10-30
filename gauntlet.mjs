import {qualityTrial} from './quality-trial.mjs';
import {CREATIVE_REVISION} from './creative-revision.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {authorized} from './cloud.mjs';
import {ACTIVE_INSTANCE,scopedPool} from './instance.mjs';
import {PostgresStore} from './postgres.mjs';
import {workspaceStep,broadcastContract} from './workspace.mjs';
import {socialStep} from './integrations.mjs';
import {studioOperationId} from './studio.mjs';
import {mediaStep,enqueueMedia} from './media.mjs';
import {MediaProviders} from './media-providers.mjs';
import {videoCadence} from './video-cadence.mjs';

export const GAUNTLET_SCHEMA='gauntlet_v1';
const lock=730300;
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
  const url=new URL(request.url);let action,body;
  if(request.method==='POST'){
   try{const raw=await request.text();if(Buffer.byteLength(raw,'utf8')>4000)throw Error();body=JSON.parse(raw);action=body.action;if(action!=='feedback'&&raw.length>256)throw Error();}catch{return json({error:'INVALID_INPUT'},400);}
   if(!['decision-check','init','step','plan','render','advance','feedback','quality-start','quality-step'].includes(action))return json({error:'INVALID_ACTION'},400);
   if(body.renderer!==undefined&&(action!=='plan'||body.renderer!=='collage'))return json({error:'INVALID_RENDERER_TEST'},400);
   if(action==='feedback'&&(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.assetId??'')||!['pass','fail'].includes(body.verdict)||!['observation','nextExperiment'].every(k=>typeof body[k]==='string'&&body[k].trim().length>0&&body[k].length<=1200)))return json({error:'INVALID_FEEDBACK'},400);
  }
  const pool=await openPool();let guard;
  try{
   guard=await pool.connect();
   // Pin a backend while holding the lock: Neon transaction pooling cannot safely
   // pair session-level lock/unlock calls across separate transactions.
   await guard.query('BEGIN');
   if(!(await guard.query('SELECT pg_try_advisory_xact_lock($1) AS locked',[lock])).rows[0].locked)return json({status:'busy'},409);
   if(action==='decision-check'){
    const store=new PostgresStore(scopedPool(pool)),provider=createProvider();
    const operations=(await store.pool.query("SELECT id,status,result->>'action' AS action,result->>'failureCode' AS failure_code FROM agent_operations WHERE id LIKE $1 ORDER BY id DESC LIMIT 18",['workspace-v1-'+CREATIVE_REVISION+'-%'])).rows;
    const id='decision-check-v2-'+Math.floor(now().getTime()/3600000);
    const candidates=Array.from({length:4},(_,i)=>({id:'synthetic-candidate-'+i,evidence:['synthetic-evidence-0']}));
    const snapshot={evidence:Array.from({length:64},(_,i)=>({id:'synthetic-evidence-'+i,kind:'workspace_note'})),state:{goals:Array.from({length:16},(_,i)=>({id:('synthetic-goal-'+i+'-').padEnd(61,'x')})),predictions:[]}};
    const system='Synthetic schema compatibility test. Return valid JSON. No output will be executed.';
    const prompt='Choose synthetic-candidate-0, with no goal changes and no working policies. This is a diagnostic with no real data.';
    const old=await store.operation(id);if(old)return json({status:old.status,result:old.result,replay:true,operations});
    const req=await store.begin(id,'step',()=>({maximum:provider.quote(system,prompt)}));if(req.replay)return json({status:req.status,replay:true});
    let cost=req.maximum,result;
    try{const r=await provider.generate(system,prompt,null,broadcastContract(candidates,snapshot));cost=r.costMicrodollars;result={action:'decision_diagnostic',status:'passed',summary:'Synthetic arbitration schema accepted; no agent action executed.'};}
    catch(e){result={action:'decision_diagnostic',status:'failed',failureCode:e.code?.startsWith('GEMINI_')?e.code:'DIAGNOSTIC_FAILED',summary:'Synthetic request failed; no agent action executed.'};}
    await store.complete(id,cost,result);return json({status:result.status,result,operations});
   }
   if(action?.startsWith('quality-')||url.searchParams.has('quality')){
    const production=new PostgresStore(scopedPool(pool));
    return json(await qualityTrial(production,createProvider(),env,createServices(env),action??'status',body?.medium??url.searchParams.get('quality')));
   }
   if(action==='init')return json(await initialize(pool,now()));
   if(!(await pool.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1',[GAUNTLET_SCHEMA])).rows.length)return json({status:'not_initialized'},409);
   const state=(await pool.query('SELECT * FROM gauntlet_v1.run_state WHERE id=1')).rows[0];
   const store=new PostgresStore(scopedPool(pool,GAUNTLET_SCHEMA));
   if(action==='feedback'){
    const input={assetId:body.assetId,verdict:body.verdict,observation:body.observation.trim(),nextExperiment:body.nextExperiment.trim()};
    const feedbackKey=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return await store.transaction(async c=>{
     const owned=(await c.query("SELECT a.id FROM agent_assets a JOIN agent_media_jobs j ON j.data->>'assetId'=a.id WHERE a.id=$1 AND j.state<>'published' LIMIT 1",[input.assetId])).rows[0];
     if(!owned)return json({error:'NOT_FOUND'},404);
     const old=(await c.query("SELECT seq FROM agent_events WHERE kind='media_review' AND payload::jsonb->>'feedbackKey'=$1 LIMIT 1",[feedbackKey])).rows[0];
     if(old)return json({status:'feedback_saved',feedbackKey,replay:true});
     await store.append(c,'media_review',{action:'media_review',source:'independent_test_critic',reviewer:'independent_test_critic',feedbackKey,...input,text:input.observation,summary:'Independent diagnostic critic; not operator feedback or audience evidence.',decision:input.verdict==='pass'?'publish':'reject',visualLanguageResult:input.verdict==='pass'?'supported':'not_supported',referenceComparison:input.observation});
     return json({status:'feedback_saved',feedbackKey,replay:false});
    });
   }
   // This diagnostic run tests still-image construction; never create an unaccounted
   // Replicate reservation in a separate ledger or upload a test movie to public Blob.
   const testEnv={...env,REPLICATE_API_TOKEN:undefined,BLOB_READ_WRITE_TOKEN:undefined,VIDEO_CADENCE_ENABLED:'false',X_REPLIES_ENABLED:'false'};
   const testProvider=()=>{const p=createProvider();return {quote:p.quote.bind(p),generate:(system,prompt,media,schema,refs)=>{
    const collageTest=action==='plan'&&body?.renderer==='collage'&&schema?.properties?.alternatives;
    if(collageTest){schema=structuredClone(schema);const a=schema.properties.alternatives.items;a.properties.renderer={type:'string',enum:['collage']};a.required=[...new Set([...a.required,'renderer'])];schema.properties.medium.enum=['image'];}
    return p.generate(system,prompt+' Diagnostic capability: only still images and text are available in this isolated run; no video generator.'+(collageTest?' This explicit renderer qualification uses collage for image alternatives. This tests execution capability, not a claim that the agent independently preferred this renderer. Preserve the self-authored idea.':''),media,schema,refs);
   }};};
   // Virtual slots isolate replay keys only. Actual event timestamps remain real.
   const slotTime=new Date(new Date(state.started).getTime()+state.cycle*7200000);
   const planId='x-plan-'+CREATIVE_REVISION+'-'+Math.floor(slotTime.getTime()/7200000);
   const currentPlan=await store.operation(planId);
   const job=(await store.pool.query('SELECT * FROM agent_media_jobs WHERE plan_id=$1',[planId])).rows[0];
   const broadcast=await store.operation('workspace-v1-'+CREATIVE_REVISION+'-'+Math.floor(slotTime.getTime()/3600000)+'-broadcast');
   const decision=await store.latest('cognitive_decision');
   const mediaFinished=['rejected','failed','reconsideration'].includes(job?.state)||(job?.state==='approved'&&!!job.data.styleAudit);
   const finished=(broadcast?.result?.action==='workspace_broadcast'&&decision?.choice!=='commission')||currentPlan?.status==='complete'&&(currentPlan.result?.action==='wait'||currentPlan.result?.medium==='text'||mediaFinished);
   if(request.method==='GET'){
    const assetId=url.searchParams.get('asset');
    if(assetId){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(assetId))return json({error:'INVALID_ASSET'},400);const owned=(await store.pool.query("SELECT id FROM agent_media_jobs WHERE data->>'assetId'=$1 AND state<>'published'",[assetId])).rows[0];if(!owned)return json({error:'NOT_FOUND'},404);const a=await store.asset(assetId);if(!a)return json({error:'NOT_FOUND'},404);const loaded=a.bytes?a:await createServices(env).load(a);return new Response(loaded.bytes,{headers:{...headers,'Content-Type':loaded.mime}});}
    const production=new PostgresStore(scopedPool(pool));
    const productionVideo=await videoCadence(production,env,now());
    productionVideo.plans=(await production.pool.query("SELECT id,status,result FROM agent_operations WHERE id LIKE 'x-plan-video-cadence-%' ORDER BY id DESC LIMIT 4")).rows;
    return json({cycle:state.cycle,started:state.started,virtualSlot:slotTime,finished,publicationEnabled:false,productionVideo,operations:(await store.pool.query('SELECT id,status,result FROM agent_operations ORDER BY id')).rows,jobs:(await store.pool.query("SELECT id,state,plan,data FROM agent_media_jobs WHERE state<>'published' ORDER BY created")).rows});
   }
   if(action==='advance'){
    if(!finished)return json({error:'CYCLE_NOT_FINISHED'},409);
    await store.pool.query("UPDATE agent_media_jobs SET state='gauntlet_complete' WHERE plan_id=$1 AND state='approved'",[planId]);
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
    const plan=await store.operation(planId);
    if(body?.renderer==='collage'&&plan?.result?.renderer!=='collage')return json({error:'RENDERER_TEST_NOT_SELECTED'},409);
    if(plan?.result?.action==='x_draft'&&['image','video'].includes(plan.result.medium))await enqueueMedia(store,planId,plan.result);
    return json(result);
   }
   if(!job)return json({status:'no_media_job'});
   await store.pool.query("UPDATE agent_media_jobs SET state='gauntlet_complete' WHERE plan_id<>$1 AND state='approved' AND data ? 'styleAudit'",[planId]);
   // Call only phases that cannot upload or publish. Image audit is separately bounded.
   const auditOnly=job.state==='approved'&&!job.data.styleAudit;
   if(!['queued','processing','rendered','revising'].includes(job.state)&&!auditOnly)return json({status:'review_complete',state:job.state});
   return json(await mediaStep(store,testProvider(),{...testEnv,X_ENABLED:'false'},createServices(testEnv),noPublishingClient));
  }catch(error){const code=/^[A-Z0-9_]{2,60}$/.test(error.code??'')?error.code:'INTERNAL';console.error('gauntlet_failed',code);return json({error:/^[A-Z_]+$/.test(error.message)?error.message:'GAUNTLET_FAILED',code},500);}
  finally{if(guard){await guard.query('ROLLBACK').catch(()=>{});guard.release();}await pool.end();}
 };
}

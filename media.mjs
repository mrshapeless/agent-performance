import {randomUUID} from 'node:crypto';
import {constitution} from './domain.mjs';
import {MediaProviders,mediaCapabilities} from './media-providers.mjs';
import {xClient} from './x.mjs';
import {creativeFreedom,reviewSchema,validateExperimentReview} from './experiments.mjs';

export function validateMediaPlan(v,env){
 const medium=v.medium??'text';
 if(!['text','image','video'].includes(medium))throw Error('INVALID_MEDIA_PLAN');
 if(medium==='text'||v.action==='wait')return {...v,medium:'text'};
 if(!mediaCapabilities(env)[medium])throw Error('MEDIA_NOT_CONFIGURED');
 if(typeof v.prompt!=='string'||v.prompt.length<10||v.prompt.length>4000||typeof v.alt!=='string'||!v.alt.trim()||v.alt.length>500)throw Error('INVALID_MEDIA_PLAN');
 if(!(medium==='image'?['1:1','16:9','9:16']:['16:9','9:16']).includes(v.ratio))throw Error('INVALID_MEDIA_PLAN');
 if(medium==='video'&&![4,6,8].includes(v.duration))throw Error('INVALID_MEDIA_PLAN');
 return {...v,medium};
}
export async function enqueueMedia(store,planId,plan){
 await store.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state) VALUES($1,$2,$3,'queued') ON CONFLICT(id) DO NOTHING",['media-'+planId.replace('x-plan-',''),planId,JSON.stringify(plan)]);
 return (await store.pool.query('SELECT * FROM agent_media_jobs WHERE plan_id=$1',[planId])).rows[0];
}
export async function readyMedia(store){return (await store.pool.query("SELECT * FROM agent_media_jobs WHERE state='ready' ORDER BY created LIMIT 1")).rows[0]??null;}
export async function finishMedia(store,planId){await store.pool.query("UPDATE agent_media_jobs SET state='published',updated=now() WHERE plan_id=$1 AND state='ready'",[planId]);}
async function patch(store,job,state,data={}){
 const result=await store.pool.query("UPDATE agent_media_jobs SET state=$1,data=data || $2::jsonb,lease_until=NULL,lease_token=NULL,updated=now() WHERE id=$3 AND lease_token=$4 RETURNING id",[state,JSON.stringify(data),job.id,job.lease_token]);
 if(!result.rows.length)throw Error('MEDIA_LEASE_LOST');
}
async function fail(store,job,operation,maximum,error){
 if(operation&&await store.operation(operation))await store.complete(operation,maximum,{action:'media_failed',text:'Media work stopped before publication.',summary:'The operation was not automatically repeated. Its reservation is retained for reconciliation.',errorCode:error.message});
 await store.transaction(async c=>{await store.append(c,'media_failed',{text:job.plan.alt||'Media work unavailable',summary:'Media pipeline requires attention: '+(/^[A-Z_0-9]+$/.test(error.message)?error.message:'PROVIDER_OR_STORAGE_ERROR')});});
 await patch(store,job,'failed',{error:/^[A-Z_0-9]+$/.test(error.message)?error.message:'PROVIDER_OR_STORAGE_ERROR'});
 return {status:'media_failed'};
}
// Each invocation advances one durable phase. Lease prevents overlapping cron deliveries.
// Paid requests are reserved once; an unknown outcome is never regenerated automatically.
export async function mediaStep(store,provider,env,services=new MediaProviders(env),xFactory=xClient){
 const token=randomUUID();
 const job=await store.transaction(async c=>{
  // Recover the pre-finalize-response image uploader once, using the saved asset.
  // A new upload operation is charged; paid image generation is never repeated.
  await c.query("UPDATE agent_media_jobs SET state='approved',data=data || '{\"finalizeRecovery\":true,\"retries\":0}'::jsonb,updated=now() WHERE plan->>'medium'='image' AND data->'review'->>'decision'='publish' AND data->>'mediaId' IS NOT NULL AND NOT(data ? 'finalized') AND NOT(data ? 'finalizeRecovery') AND (state='processing_x' OR (state='failed' AND data->>'error'='MEDIA_PROVIDER_RETRY_LIMIT')) AND (lease_until IS NULL OR lease_until<now())");
  const row=(await c.query("SELECT * FROM agent_media_jobs WHERE state IN ('queued','processing','rendered','approved','uploading','processing_x') AND (lease_until IS NULL OR lease_until<now()) ORDER BY created LIMIT 1 FOR UPDATE")).rows[0];
  if(!row)return null;
  await c.query("UPDATE agent_media_jobs SET lease_token=$1,lease_until=now()+interval '3 minutes' WHERE id=$2",[token,row.id]);
  return {...row,lease_token:token};
 });
 if(!job)return {status:'no_media_jobs'};
 let op=null,maximum=0;
 try{
  if(job.state==='queued'){
   op=job.id+'-render';maximum=job.plan.medium==='image'?services.imageQuote(job.plan.prompt):services.videoQuote();
   const req=await store.begin(op,'step',()=>({maximum}));
   if(req.replay){
    if(req.status==='complete'&&req.result?.assetId){await patch(store,job,'rendered',{assetId:req.result.assetId});return {status:'recovered_render'};}
    if(req.status==='complete'&&req.result?.predictionId){await patch(store,job,'processing',{predictionId:req.result.predictionId});return {status:'recovered_prediction'};}
    throw Error('MEDIA_GENERATION_OUTCOME_UNKNOWN');
   }
   if(job.plan.medium==='image'){
    const asset=await services.image(job.plan.prompt,job.plan.ratio);
    await store.complete(op,asset.costMicrodollars,{action:'art_image',text:job.plan.alt,alt:job.plan.alt,summary:job.plan.summary,projectId:job.plan.projectId??null,intent:job.plan.intent??null,experimentId:job.plan.experiment?job.plan_id:null,assetId:op,mime:asset.mime},asset);
    await patch(store,job,'rendered',{assetId:op});return {status:'image_created'};
   }
   const prediction=await services.startVideo(job.plan);
   if(!/^[a-zA-Z0-9_-]+$/.test(prediction.id??''))throw Error('VIDEO_OUTCOME_UNKNOWN');
   await store.complete(op,maximum,{action:'media_started',text:job.plan.alt,summary:'Video generation accepted. Reservation is a conservative estimate; not yet a completed work.',predictionId:prediction.id});
   await patch(store,job,'processing',{predictionId:prediction.id});return {status:'video_started'};
  }
  if(job.state==='processing'){
   const p=await services.videoStatus(job.data.predictionId);
   if(['failed','canceled'].includes(p.status))throw Error('VIDEO_GENERATION_FAILED');
   if(p.status!=='succeeded'){
    if(Date.now()-Date.parse(job.created)>3600000)throw Error('VIDEO_PROCESSING_TIMEOUT');
    await patch(store,job,'processing');return {status:'video_processing'};
   }
   const asset=await services.archiveVideo(job.id,p.output);
   op=job.id+'-archive';const req=await store.begin(op,'step',()=>({maximum:0}));
   if(!req.replay)await store.complete(op,0,{action:'art_video',text:job.plan.alt,alt:job.plan.alt,summary:job.plan.summary,projectId:job.plan.projectId??null,intent:job.plan.intent??null,experimentId:job.plan.experiment?job.plan_id:null,assetId:op,mime:'video/mp4'},asset);
   await patch(store,job,'rendered',{assetId:op});return {status:'video_archived'};
  }
  if(job.state==='rendered'){
   const asset=await services.load(await store.asset(job.data.assetId));
   const prompt=`Inspect this actual generated ${job.plan.medium}. ${creativeFreedom} Decide whether to publish or reject. Evaluate defects, legibility without a technical explanation, visual surprise, a memorable focal event, and for video actual beginning/change/ending and audio. An accurate schematic is not automatically an engaging artwork. A generated scene is art, never documentary evidence. If it resembles a photograph or physical experiment, identify it as an imagined or generated study in the caption. You are reviewing, not publishing yet: do not claim publication in the summary. A caption can add curiosity or a distinct voice instead of explaining a technical mechanism. Return action publish/reject, text final English caption <=240 ASCII characters no @mentions, alt <=500 describing the ACTUAL result, summary public reason. ${job.plan.experiment?'Also return observedResult (concrete visible/audible evidence), hypothesisResult supported/partly/not_supported, noveltyEvidence (what actually breaks the named habit; do not reward merely executing a prompt), viewerHook (your hypothesis, not measured human response), nextExperiment (a concrete follow-up). Reject if the requested departure is absent or only another technical diagram. A visually coherent failure can remain in the public experiment archive without being posted to X. Keep each field <=1200 characters.':''} Your current studio is revisable context, not a style constraint: ${JSON.stringify(await store.latest('studio_revision'))}. Your original brief and alternatives: ${JSON.stringify(job.plan)}`;
   op=job.id+'-review';maximum=provider.quote(constitution,prompt)+2_000_000;
   const req=await store.begin(op,'step',()=>({maximum}));
   let v;
   if(req.replay){if(req.status!=='complete')throw Error('MEDIA_REVIEW_OUTCOME_UNKNOWN');v=req.result;}
   else{
    const answer=await provider.generate(constitution,prompt,asset,job.plan.experiment?reviewSchema:null);v=job.plan.experiment?validateExperimentReview(answer.value):answer.value;
    if(!['publish','reject'].includes(v?.action)||typeof v.text!=='string'||!v.text.trim()||v.text.length>240||!/^[\x20-\x7e\r\n]+$/.test(v.text)||v.text.includes('@')||typeof v.alt!=='string'||!v.alt.trim()||v.alt.length>500||typeof v.summary!=='string'||!v.summary.trim()||v.summary.length>4000)throw Error('INVALID_MEDIA_REVIEW');
    v={...v,projectId:job.plan.projectId??null,intent:job.plan.intent??null,experimentId:job.plan.experiment?job.plan_id:null,decision:v.action,action:'media_review',assetId:job.data.assetId,mime:asset.mime};
    await store.complete(op,answer.costMicrodollars,v);
   }
   await patch(store,job,v.decision==='publish'?'approved':'rejected',{review:v});return {status:v.decision==='publish'?'media_approved':'media_rejected'};
  }
  if(env.X_ENABLED!=='true'){await patch(store,job,job.state);return {status:'x_disabled'};}
  const x=xFactory(store,env);
  if(job.state==='approved'){
   op=job.id+(job.data.finalizeRecovery?'-upload-finalize-recovery':'-upload');maximum=1_000_000;
   const req=await store.begin(op,'step',()=>({maximum}));
   if(req.replay){
    if(req.status==='complete'&&req.result?.mediaId){await patch(store,job,'uploading',{mediaId:req.result.mediaId,expiresAt:req.result.expiresAt,segment:0});return {status:'upload_recovered'};}
    throw Error('MEDIA_UPLOAD_OUTCOME_UNKNOWN');
   }
   await x.verify();const asset=await services.load(await store.asset(job.data.assetId));
   const upload=await x.initMedia(asset);
   const data={mediaId:upload.id,expiresAt:Date.now()+Number(upload.expires_after_secs??86400)*1000,segment:0};
   await store.complete(op,maximum,{action:'media_upload',text:'Uploading selected work to X.',summary:'Media is not yet published.',...data});
   await patch(store,job,'uploading',data);return {status:'upload_started'};
  }
  if(Date.now()>Number(job.data.expiresAt))throw Error('X_MEDIA_EXPIRED');
  if(job.state==='uploading'){
   const asset=await services.load(await store.asset(job.data.assetId));const size=3_000_000,offset=(job.data.segment??0)*size;
   if(offset<asset.bytes.length){await x.appendMedia(job.data.mediaId,job.data.segment??0,asset.bytes.subarray(offset,offset+size));await patch(store,job,'uploading',{segment:(job.data.segment??0)+1});return {status:'upload_chunk'};}
   const finalized=await x.finalizeMedia(job.data.mediaId);
   if(finalized.processing_info?.state==='failed')throw Error('X_MEDIA_PROCESSING_FAILED');
   const ready=!finalized.processing_info||finalized.processing_info.state==='succeeded';
   await patch(store,job,ready?'ready':'processing_x',{finalized:true});return {status:ready?'media_ready':'upload_finalized'};
  }
  const status=await x.mediaStatus(job.data.mediaId);
  if(status.processing_info?.state==='failed')throw Error('X_MEDIA_PROCESSING_FAILED');
  const ready=!status.processing_info||status.processing_info.state==='succeeded';
  await patch(store,job,ready?'ready':'processing_x');return {status:ready?'media_ready':'x_media_processing'};
 }catch(error){
  if(['UNRESOLVED_OPERATION','DAILY_ALLOWANCE_EXHAUSTED'].includes(error.message)){await patch(store,job,job.state);return {status:'media_waiting_for_allowance_or_lane'};}
  // Failed read/poll calls may be retried; paid generation/review calls may not.
  if(!op&&['processing','uploading','processing_x'].includes(job.state)&&!['VIDEO_GENERATION_FAILED','VIDEO_PROCESSING_TIMEOUT','X_MEDIA_EXPIRED','X_MEDIA_PROCESSING_FAILED','MEDIA_UNTRUSTED_URL','MEDIA_TOO_LARGE','MEDIA_INVALID_MP4'].includes(error.message)){
   if((job.data.retries??0)>=5)return fail(store,job,null,0,Error('MEDIA_PROVIDER_RETRY_LIMIT'));
   await patch(store,job,job.state,{lastError:/^[A-Z_0-9]+$/.test(error.message)?error.message:'PROVIDER_OR_STORAGE_ERROR',retries:(job.data.retries??0)+1});return {status:'media_retry_later'};
  }
  return fail(store,job,op,maximum,error);
 }
}

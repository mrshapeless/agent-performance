import {studioStep,studioOperationId} from './studio.mjs';
import {constitution} from './domain.mjs';
import {CREATIVE_REVISION,stampCreativePlan} from './creative-revision.mjs';
import {audienceDirection} from './audience-direction.mjs';
import {qualityInstruction} from './visual-contract.mjs';
import {mediaPlanSchema,validateMediaPlan,enqueueMedia,mediaStep} from './media.mjs';

// Explicit operator qualification: two bounded self-authored works, the same
// services and production Replicate ledger, with publication disabled in depth.
export async function qualityTrial(store,provider,env,services,action,medium){
 if(!['image','video'].includes(medium))throw Error('INVALID_TRIAL_MEDIUM');
 const planId='x-plan-quality-'+CREATIVE_REVISION+'-'+medium;
 const jobs=async()=>(await store.pool.query("SELECT id,state,plan,data FROM agent_media_jobs WHERE plan->>'qualityTrial'=$1 ORDER BY created",[planId])).rows;
 if(action==='quality-start'){
  if(!await store.operation(await studioOperationId(store,new Date())))return studioStep(store,provider);

  const req=await store.begin(planId,'step',(identity,recent,context)=>({maximum:provider.quote(constitution,audienceDirection)+2_000_000,prompt:`${audienceDirection} ${qualityInstruction} Operator qualification of the current production pipeline: choose your OWN new situation and personal stance for a ${medium} featuring Alidade. This medium and character are required only for this diagnostic; do not claim you independently selected the medium. Choose three distinct alternatives, select one and describe its executable renderPrompt. Use renderer character. Do not imitate the reference location or costume. For video include opening, change, ending and sound. Caption <=240 ASCII characters, no @mentions. Return intent experiment, projectId null, action x_draft, medium ${medium}, renderer character, duration 6, ratio 16:9, referenceIds [1,2,3], alternatives, selectedId, diversityComparison, continuationReason, prompt, alt, summary and text. Current self and memory: ${JSON.stringify({identity,studio:context.studio,workspace:context.workspace,visualHistory:context.visualHistory,recent})}`}));
  if(!req.replay){
   const schema=structuredClone(mediaPlanSchema);schema.properties.medium.enum=[medium];schema.properties.renderer.enum=['character'];schema.required.push('renderer');schema.properties.alternatives.items.properties.renderer.enum=['character'];
   const answer=await provider.generate(constitution,req.prompt,null,schema,await services.references([1,2,3]));
   const plan=validateMediaPlan(answer.value,env,{requireAlternatives:true});
   if(plan.medium!==medium||plan.renderer!=='character')throw Error('INVALID_TRIAL_PLAN');
   await store.complete(planId,answer.costMicrodollars,stampCreativePlan({...plan,qualityTrial:planId,provenance:'operator-medium-qualification'}));
  }
  const saved=await store.operation(planId);
  if(saved?.status==='complete')await enqueueMedia(store,planId,saved.result);
  return {status:'quality_trial_planned',jobs:await jobs()};
 }
 if(action==='quality-step'){
  // Resume only this known, settled identity rejection after the bounded-revision
  // policy was introduced. Never reset uncertain provider or publication states.
  await store.pool.query("UPDATE agent_media_jobs SET state='revising' WHERE plan->>'qualityTrial'=$1 AND state='reconsideration' AND data->>'holdReason'='CHARACTER_IDENTITY_UNVERIFIED' AND COALESCE((plan->>'revisionAttempt')::int,0)=0 AND (lease_until IS NULL OR lease_until<now()) AND NOT EXISTS(SELECT 1 FROM agent_operations WHERE status='pending' AND id LIKE agent_media_jobs.id||'-%')",[planId]);
  const unfinished=(await jobs()).find(j=>['queued','processing','rendered','revising','approved'].includes(j.state)&&!(j.state==='approved'&&j.data.styleAudit));
  if(unfinished){const result=await mediaStep(store,provider,{...env,X_ENABLED:'false',X_REPLIES_ENABLED:'false'},services,()=>{throw Error('QUALITY_TRIAL_CANNOT_PUBLISH');},unfinished.id);return {...result,jobs:await jobs()};}
 }
 return {status:'quality_trial_status',jobs:await jobs()};
}

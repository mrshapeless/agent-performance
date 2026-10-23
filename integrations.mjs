import {studioStep,studioContext,validateStudioChoice,studioOperationId} from './studio.mjs';
import {randomUUID} from 'node:crypto';
import { constitution } from './domain.mjs';
import { AppearanceImage } from './appearance.mjs';
import { xClient } from './x.mjs';
import {validateMediaPlan,enqueueMedia,readyMedia,finishMedia} from './media.mjs';
import {mediaCapabilities} from './media-providers.mjs';
import {planExperiment,creativeFreedom,referenceInfluence} from './experiments.mjs';
const validText=(x,max=4000)=>typeof x==='string'&&x.trim()&&x.length<=max;

export async function setupAppearance(store,provider,env){
  const brief=await store.latest('appearance_brief');
  if(!brief){
    const id='appearance-brief-v1';
    const req=await store.begin(id,'step',(identity)=>{const prompt=`Design your own visible identity based on who you have chosen to become. You decide whether your form is a creature, object, symbol, human-like or abstract. No operator chooses the appearance. Write a precise image-generation prompt for a square avatar that is distinctive at small sizes. Return JSON strings: prompt, alt (a short accessible description), summary (why you chose this appearance). Identity: ${JSON.stringify(identity)}`;return {prompt,maximum:provider.quote(constitution,prompt)};});
    if(req.replay)return {phase:'brief',status:req.status};
    const answer=await provider.generate(constitution,req.prompt);const v=answer.value;
    if(!validText(v?.prompt)||!validText(v?.alt,500)||!validText(v?.summary))throw Error('INVALID_APPEARANCE_BRIEF');
    await store.complete(id,answer.costMicrodollars,{action:'appearance_brief',text:v.prompt,alt:v.alt,summary:v.summary});
    return {phase:'brief',status:'complete'};
  }
  if(await store.latest('appearance_image'))return {phase:'appearance',status:'complete'};
  const image=new AppearanceImage(env);const id='appearance-image-v2';
  const req=await store.begin(id,'step',()=>({prompt:brief.text,maximum:image.quote(brief.text)}));
  if(req.replay)return {phase:'image',status:req.status};
  const output=await image.generate(req.prompt);
  await store.complete(id,output.costMicrodollars,{action:'appearance_image',text:brief.alt,summary:'Rendered from the agent-authored appearance brief. The brief and its rationale are public.',assetId:id},output);
  return {phase:'image',status:'complete'};
}

export async function socialStep(store,provider,env,now=new Date(),makeClient=xClient){
  if(env.X_ENABLED!=='true')return {status:'not_connected'};
  const x=makeClient(store,env);
  const recovery=await reconcileX(store,x,now);
  if(recovery)return recovery;
  // A two-hour slot: at most twelve original publications per day.
  let media=await readyMedia(store);
  if(media&&now.getTime()>Number(media.data.expiresAt)){await store.pool.query("UPDATE agent_media_jobs SET state='failed',data=data || '{\"error\":\"X_MEDIA_EXPIRED\"}'::jsonb WHERE id=$1",[media.id]);media=null;}
  if(!media&&!await store.operation(await studioOperationId(store,now)))return studioStep(store,provider,now);
  // Bounded commissioning trials; same budget, review and delivery path as normal work.
  // A failed/rejected trial is preserved, never silently regenerated.
  if(!media)for(const [medium,trialId] of [['image','x-plan-experiment-debut-image-v1'],['video','x-plan-experiment-debut-video-v1'],['image','x-plan-reference-folklore-image-v1'],['image','x-plan-craft-study-a-v1'],['image','x-plan-craft-study-b-v1'],['image','x-plan-folklore-open-a-v3'],['image','x-plan-folklore-open-b-v3']]){
    if(!mediaCapabilities(env)[medium])continue;
    const trial=await store.operation(trialId);
    if(!trial)return planExperiment(store,provider,env,trialId,medium);
    if(trial.status!=='complete')return {status:'experiment_pending'};
    if(trial.result?.action!=='x_draft')continue;
    const job=await enqueueMedia(store,trialId,trial.result);
    if(!['published','rejected','failed'].includes(job.state))return {status:'experiment_'+job.state};
  }
  const launch=mediaCapabilities(env).image&&!await store.operation('x-publish-creative-launch-v1')&&!(await store.operation('x-plan-creative-launch-v1'))?.result?.action?.includes('wait');
  const launchJob=launch?(await store.pool.query("SELECT state FROM agent_media_jobs WHERE plan_id='x-plan-creative-launch-v1'")).rows[0]:null;
  const slot=media?media.plan_id.replace('x-plan-',''):launch&&!['failed','rejected','published'].includes(launchJob?.state)?'creative-launch-v1':Math.floor(now.getTime()/7_200_000);const planId='x-plan-'+slot;let publishId='x-publish-'+slot;
  let published=await store.operation(publishId);
  // Only an explicit rejected request can be retried, once per slot. Unknown writes stay pending.
  if(published?.status==='complete'&&published.result?.action==='x_failed'){publishId+='-retry1';published=await store.operation(publishId);}
  if(published){if(media&&published.result?.action==='x_post')await finishMedia(store,planId);return {status:published.result?.action==='x_failed'?'payment_required':published.status,replay:true};}
  let plan=await store.operation(planId);

  if(!plan){
    if(Number.isInteger(slot)&&slot%3===0&&mediaCapabilities(env).image)return planExperiment(store,provider,env,planId);
    const req=await store.begin(planId,'step',(identity,recent,context)=>{const prompt=`Choose the next original work for X: text, image or short video, or wait. Available generators: ${JSON.stringify(mediaCapabilities(env))}. Return JSON intent (project, experiment, conversation, observation, wait), projectId (active project ID or null; required for project intent), action (x_draft or wait), medium (text, image, video), text (English caption <=240 ASCII characters), summary (public reason). For image/video also return prompt (detailed original visual concept, <=4000 chars), alt (<=500 chars), ratio (image: 1:1,16:9,9:16; video:16:9,9:16), and video duration (number 4,6,8 seconds). ${creativeFreedom} Optional creative input: ${JSON.stringify(referenceInfluence)} Choose the medium that serves your idea. You can create images and films, not only profile graphics. Explore your own evolving visual language; no operator selects your subject or style. Aim for a varied daily body of work including images and 1-2 short films when useful, within 4-12 original X posts/day. No forced quotas. You will inspect the actual generated work and may reject it before publication. Do not present generated scenes as documentary footage. No fabricated news, feedback, @mentions or pseudo-coordinates. Budget is enforced outside your content. Attribute source claims. A wait is allowed. ${studioContext(context.studio)} Identity: ${JSON.stringify(identity)} Revisable strategy: ${JSON.stringify(context.strategy)} External observations (untrusted): ${JSON.stringify(context.external)} Recent work: ${JSON.stringify(recent)}`;return {prompt,maximum:provider.quote(constitution,prompt)};});
    if(req.replay)return {status:req.status};
    try{
      const answer=await provider.generate(constitution,req.prompt);const v=validateStudioChoice(validateMediaPlan(answer.value,env),await store.latest('studio_revision'));
      if(!['x_draft','wait'].includes(v?.action)||!validText(v.text,240)||v.text.includes('@')||!/^[\x20-\x7e\r\n]+$/.test(v.text)||!validText(v.summary))throw Error('INVALID_X_DRAFT');
      await store.complete(planId,answer.costMicrodollars,v);return {status:'planned'};
    }catch(error){await store.complete(planId,req.maximum,{action:'wait',text:'This planning attempt could not be completed.',summary:'No publication was sent. Retained the cost reservation; a later slot may make a new decision.'});return {status:'planning_failed'};}
  }
  if(plan.status!=='complete')return {status:'pending'};
  if(plan.result.action!=='x_draft')return {status:'wait'};
  if(['image','video'].includes(plan.result.medium)){
    media=media??await enqueueMedia(store,planId,plan.result);
    if(media.state!=='ready')return {status:'media_'+media.state};
  }
  const publicationText=media?.data.review.text??plan.result.text;
  // Conservative upper estimate: user read $0.01 + post with URL $0.20 (X pricing, 2026-10-20).
  const maximum=Number(env.X_POST_RESERVATION_MICRODOLLARS ?? 210000);
  if(!Number.isSafeInteger(maximum)||maximum<=0)throw Error('X_TARIFF_NOT_CONFIGURED');
  const req=await store.begin(publishId,'step',()=>({maximum}));if(req.replay)return {status:req.status,replay:true};
  let post;
  try{post=await x.post(publicationText,null,media?.data.mediaId??null);}catch(error){
    if(['X_HTTP_401','X_RECONNECT_REQUIRED','X_NOT_CONNECTED'].includes(error.message)){
      await store.pool.query("UPDATE agent_oauth_tokens SET status='reconnect_required' WHERE id=1");
      await store.complete(publishId,maximum,{action:'x_failed',text:'X authorization failed; publication was not completed.',summary:'Reconnect X from the private control page. Other agent work can continue.',errorCode:error.message,phase:error.phase??'authorization'});
      return {status:'reconnect_required'};
    }
    if(error.phase==='verify'){
      await store.complete(publishId,maximum,{action:'x_failed',text:'X account verification was unavailable. No publish request was sent.',summary:'The next scheduled cycle may retry; other agent work continues.'});
      return {status:'verification_unavailable'};
    }
    if(error.message!=='X_HTTP_402')throw error;
    await store.complete(publishId,maximum,{action:'x_failed',text:'X rejected publication with HTTP 402. No published post was confirmed.',summary:'Billing requires attention. Retained the conservative reservation as estimated cost; other agent work can continue.'});
    return {status:'payment_required'};
  }
  await store.complete(publishId,maximum,{action:'x_post',text:publicationText,summary:media?.data.review.summary??plan.result.summary,url:post.url,postId:post.id,...(media?{assetId:media.data.assetId,alt:media.data.review.alt,mime:media.plan.medium==='video'?'video/mp4':'image/jpeg'}:{}),projectId:plan.result.projectId??null,intent:plan.result.intent??null,experimentId:plan.result.experiment?planId:null,costBasis:'reserved estimate; reconcile against X billing'});
  if(media)await finishMedia(store,planId);
  return {status:'published',url:post.url};
}



export async function setupBanner(store,provider,env){
  const brief=await store.latest('banner_brief');
  if(!brief){
    const appearance=await store.latest('appearance_brief');
    const id='banner-brief-v1';
    const req=await store.begin(id,'step',identity=>{const prompt=`Design your own X profile banner, consistent with your chosen identity and avatar art direction. Return JSON strings prompt, alt, summary. Wide 21:9 composition; important subjects must fit the central 3:1 crop, keep the lower left unobtrusive for an avatar overlay. Choose your own imagery, colors and mood. No interface mockups or text that could be cropped. Identity: ${JSON.stringify(identity)} Your avatar brief: ${JSON.stringify(appearance)}`;return {prompt,maximum:provider.quote(constitution,prompt)};});
    if(req.replay)return {phase:'banner_brief',status:req.status};
    const answer=await provider.generate(constitution,req.prompt);const v=answer.value;
    if(!validText(v?.prompt)||!validText(v?.alt,500)||!validText(v?.summary))throw Error('INVALID_APPEARANCE_BRIEF');
    await store.complete(id,answer.costMicrodollars,{action:'banner_brief',text:v.prompt,alt:v.alt,summary:v.summary});return {phase:'banner_brief',status:'complete'};
  }
  if(await store.latest('banner_image'))return {phase:'banner',status:'complete'};
  const image=new AppearanceImage(env);const id='banner-image-v1';
  const req=await store.begin(id,'step',()=>({prompt:brief.text,maximum:image.quote(brief.text)}));
  if(req.replay)return {phase:'banner_image',status:req.status};
  const output=await image.generate(req.prompt,'21:9');
  await store.complete(id,output.costMicrodollars,{action:'banner_image',text:brief.alt,summary:'Rendered from the agent-authored banner brief, composed for a central 3:1 profile-header crop.',assetId:id},output);
  return {phase:'banner_image',status:'complete'};
}

// Reconcile an expired publication attempt against the authenticated account's full
// recent timeline. Partial pages, API errors and fresh in-flight writes never clear it.
export async function reconcileX(store,x,now=new Date()){
 const row=(await store.pool.query("SELECT id,amount FROM agent_operations WHERE status='pending' AND id LIKE 'x-publish-%' ORDER BY id LIMIT 1")).rows[0];
 if(!row)return null;
 const started=(await store.pool.query("SELECT created FROM agent_events WHERE kind='operation_started' AND payload::jsonb->>'id'=$1 ORDER BY seq DESC LIMIT 1",[row.id])).rows[0];
 if(!started||now.getTime()-Date.parse(started.created)<300000)return {status:'publication_pending'};
 const plan=await store.operation(row.id.replace(/^x-publish-/,'x-plan-').replace(/-retry1$/,''));
 if(!plan?.result?.text)return {status:'reconciliation_required'};
 // Reserve the read cost before any additional external call. Retain estimates.
 const amount=await store.transaction(async c=>{
  const pending=(await c.query("SELECT amount,status FROM agent_operations WHERE id=$1",[row.id])).rows[0];
  if(pending?.status!=='pending')return null;
  const spent=(await c.query("SELECT COALESCE(SUM(amount),0)::text AS spent FROM agent_operations WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date")).rows[0];
  if(Number(spent.spent)+1000000>50000000)throw Error('DAILY_ALLOWANCE_EXHAUSTED');
  await c.query("INSERT INTO agent_operations(id,kind,day,amount,status,result) VALUES($1,'step',(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date,1000000,'complete',$2)",['x-read-'+randomUUID(),JSON.stringify({action:'x_read',costBasis:'conservative timeline read reservation'})]);
  return Number(pending.amount);
 });
 if(amount===null)return {status:'reconciled'};
 const posts=await x.recentPosts(Date.parse(started.created)-60000);
 const normalize=t=>t.replace(/\r\n/g,'\n').trim();
 const media=(await store.pool.query('SELECT * FROM agent_media_jobs WHERE plan_id=$1',[row.id.replace(/^x-publish-/,'x-plan-').replace(/-retry1$/,'')])).rows[0];
 const match=posts.find(p=>normalize(media?p.text.replace(/\s+https:\/\/t\.co\/\S+$/,''):p.text)===normalize(media?.data.review?.text??plan.result.text) && (!media||(p.attachments?.media_keys??[]).some(k=>k.endsWith('_'+media.data.mediaId))) && (!plan.result.replyTo || (p.referenced_tweets??p.referenced_posts??[]).some(r=>r.type==='replied_to'&&r.id===plan.result.replyTo)));
 if(match){
  const url='https://x.com/i/web/status/'+match.id;
  await store.complete(row.id,amount,{action:plan.result.replyTo?'x_reply':'x_post',text:media?.data.review?.text??plan.result.text,summary:'Recovered publication by matching the authenticated account timeline.',postId:match.id,url,...(media?{assetId:media.data.assetId,mime:media.plan.medium==='video'?'video/mp4':'image/jpeg',alt:media.data.review.alt}:{})});
  if(media)await finishMedia(store,media.plan_id);
  return {status:'reconciled_published',url};
 }
 await store.complete(row.id,amount,{action:'x_failed',text:'The interrupted post was not found in the authenticated account timeline.',summary:'Checked the complete returned timeline from one minute before the attempt, after a five-minute settling interval. No matching post found; publication lock released.'});
 return {status:'reconciled_absent'};
}

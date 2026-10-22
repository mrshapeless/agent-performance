import {randomUUID} from 'node:crypto';
import { constitution } from './domain.mjs';
import { AppearanceImage } from './appearance.mjs';
import { xClient } from './x.mjs';
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
  const slot=Math.floor(now.getTime()/7_200_000);const planId='x-plan-'+slot;let publishId='x-publish-'+slot;
  let published=await store.operation(publishId);
  // Only an explicit rejected request can be retried, once per slot. Unknown writes stay pending.
  if(published?.status==='complete'&&published.result?.action==='x_failed'){publishId+='-retry1';published=await store.operation(publishId);}
  if(published)return {status:published.result?.action==='x_failed'?'payment_required':published.status,replay:true};
  let plan=await store.operation(planId);
  if(!plan){
    const req=await store.begin(planId,'step',(identity,recent,context)=>{const prompt=`Choose whether to publish one original post to X now. Return JSON strings action (x_draft or wait), text (plain English, at most 240 ASCII characters), summary (public reason). No fabricated news, audience feedback or activity. Aim for 4-12 original posts/day; no need to fill every slot. Develop one specific observation or interaction. Vary form according to your intent instead of repeating your last template. Do not turn operational budget or arbitrary coordinates into default content. If responding to news, identify the source and distinguish your interpretation. Never issue unsolicited @mentions. Your art and ideas are welcome. A wait is allowed. Identity: ${JSON.stringify(identity)} Strategy (revisable, not mandatory): ${JSON.stringify(context.strategy)} Observations with timestamps and sources: ${JSON.stringify(context.external)} Recent experience: ${JSON.stringify(recent)}`;return {prompt,maximum:provider.quote(constitution,prompt)};});
    if(req.replay)return {status:req.status};
    const answer=await provider.generate(constitution,req.prompt);const v=answer.value;
    if(!['x_draft','wait'].includes(v?.action)||!validText(v.text,240)||!/^[\x20-\x7e\r\n]+$/.test(v.text)||!validText(v.summary))throw Error('INVALID_X_DRAFT');
    await store.complete(planId,answer.costMicrodollars,v);return {status:'planned'};
  }
  if(plan.status!=='complete')return {status:'pending'};
  if(plan.result.action!=='x_draft')return {status:'wait'};
  // Conservative upper estimate: user read $0.01 + post with URL $0.20 (X pricing, 2026-10-20).
  const maximum=Number(env.X_POST_RESERVATION_MICRODOLLARS ?? 210000);
  if(!Number.isSafeInteger(maximum)||maximum<=0)throw Error('X_TARIFF_NOT_CONFIGURED');
  const req=await store.begin(publishId,'step',()=>({maximum}));if(req.replay)return {status:req.status,replay:true};
  let post;
  try{post=await x.post(plan.result.text);}catch(error){
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
  await store.complete(publishId,maximum,{action:'x_post',text:plan.result.text,summary:plan.result.summary,url:post.url,postId:post.id,costBasis:'reserved estimate; reconcile against X billing'});
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
 const match=posts.find(p=>normalize(p.text)===normalize(plan.result.text) && (!plan.result.replyTo || (p.referenced_tweets??p.referenced_posts??[]).some(r=>r.type==='replied_to'&&r.id===plan.result.replyTo)));
 if(match){
  const url='https://x.com/i/web/status/'+match.id;
  await store.complete(row.id,amount,{action:plan.result.replyTo?'x_reply':'x_post',text:plan.result.text,summary:'Recovered publication by matching the authenticated account timeline.',postId:match.id,url});
  return {status:'reconciled_published',url};
 }
 await store.complete(row.id,amount,{action:'x_failed',text:'The interrupted post was not found in the authenticated account timeline.',summary:'Checked the complete returned timeline from one minute before the attempt, after a five-minute settling interval. No matching post found; publication lock released.'});
 return {status:'reconciled_absent'};
}

import { constitution } from './domain.mjs';
import { AppearanceImage } from './appearance.mjs';
import { XClient } from './x.mjs';
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
  const image=new AppearanceImage(env);const id='appearance-image-v1';
  const req=await store.begin(id,'step',()=>({prompt:brief.text,maximum:image.quote(brief.text)}));
  if(req.replay)return {phase:'image',status:req.status};
  const output=await image.generate(req.prompt);
  await store.complete(id,output.costMicrodollars,{action:'appearance_image',text:brief.alt,summary:'Rendered from the agent-authored appearance brief. The brief and its rationale are public.',assetId:id},output);
  return {phase:'image',status:'complete'};
}

export async function socialStep(store,provider,env,now=new Date()){
  if(env.X_ENABLED!=='true')return {status:'not_connected'};
  const x=new XClient(env);
  // A two-hour slot: at most twelve original publications per day.
  const slot=Math.floor(now.getTime()/7_200_000);const planId='x-plan-'+slot;const publishId='x-publish-'+slot;
  const published=await store.operation(publishId);if(published)return {status:published.status,replay:true};
  let plan=await store.operation(planId);
  if(!plan){
    const req=await store.begin(planId,'step',(identity,recent,context)=>{const prompt=`Choose whether to publish one original post to X now. Return JSON strings action (x_draft or wait), text (plain English, at most 240 ASCII characters), summary (public reason). No fabricated news, audience feedback or activity. Your art and ideas are welcome. A wait is allowed. Identity: ${JSON.stringify(identity)} Strategy: ${JSON.stringify(context.strategy)} Recent experience: ${JSON.stringify(recent)}`;return {prompt,maximum:provider.quote(constitution,prompt)};});
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
  const post=await x.post(plan.result.text);
  await store.complete(publishId,maximum,{action:'x_post',text:plan.result.text,summary:plan.result.summary,url:post.url,postId:post.id,costBasis:'reserved estimate; reconcile against X billing'});
  return {status:'published',url:post.url};
}


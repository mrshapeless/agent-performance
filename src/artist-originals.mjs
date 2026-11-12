import {createHash} from 'node:crypto';
import {constitution} from './domain.mjs';
import {loadArtistDirection} from './artist-direction.mjs';
import {loadArtistCampaign,campaignWindow} from './artist-campaign.mjs';
import {CREATIVE_REVISION} from './creative-revision.mjs';
import {validateMediaPlan,enqueueMedia,readyMedia,finishMedia} from './media.mjs';
import {originalPublicationWindow} from './original-cadence.mjs';
import {PROJECT_POLICY,projectCursor,projectCheckpoint,reviewDeliveredPackage,reviewCompleteProse,projectDirection,pilotInspectionComplete} from './artist-projects.mjs';

export const ARTIST_LOOP=PROJECT_POLICY;
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'};
const boundedString=maxLength=>({type:'string',minLength:1,maxLength});
const visual=object({id:string,concept:string,visualMechanism:string,composition:string,viewerExperience:string,renderPrompt:string,personalStake:string,renderer:{type:'string',enum:['single','character']}});
export const artistDraftSchema=object({title:boundedString(1400),intention:boundedString(1400),development:boundedString(1400),manuscript:boundedString(12000),formatReason:boundedString(1400),medium:{type:'string',enum:['image','video','song','music_film','essay','process','sequence']},duration:{type:'integer',minimum:0,maximum:3600},ratio:{type:'string',enum:['1:1','16:9','9:16']},alt:boundedString(500),alternatives:{type:'array',items:visual,minItems:3,maxItems:3},selectedId:string,diversityComparison:boundedString(1400)});
const checks=['standaloneWork','meaningInArtifact','honestClaims','distinctFromRecent','formatComplete'];
export const artistReviewSchema=object({accepted:{type:'boolean'},...Object.fromEntries(checks.map(k=>[k,{type:'boolean'}])),evidence:string,reason:string});
const nonempty=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateArtistDraft(v,env){
 if(!v||!['image','video','song','music_film','essay','process','sequence'].includes(v.medium)||!Number.isInteger(v.duration)||v.duration<0||v.duration>3600||!['title','intention','development','formatReason','diversityComparison'].every(k=>nonempty(v[k],1400))||!nonempty(v.manuscript,12000))throw Error('INVALID_ARTIST_DRAFT');
 // Preserve unsupported manuscripts verbatim in the draft; never truncate them.
 const missing=[];
 if(!['image','video'].includes(v.medium))missing.push('production_and_delivery_for_'+v.medium);
 if(v.medium==='video'&&![4,6,8].includes(v.duration))missing.push('complete_video_duration');
 if(v.manuscript.length>240||!/^[\x20-\x7e\r\n]+$/.test(v.manuscript)||/@|https?:\/\//.test(v.manuscript))missing.push('complete_manuscript_delivery');
 if(missing.length)return {supported:false,draft:v,requirements:missing};
 const plan=validateMediaPlan({action:'x_draft',intent:'project',projectId:null,medium:v.medium,duration:v.duration,ratio:v.ratio,text:v.manuscript,summary:v.title,prompt:v.alternatives?.find(a=>a.id===v.selectedId)?.renderPrompt,alt:v.alt,alternatives:v.alternatives,selectedId:v.selectedId,diversityComparison:v.diversityComparison,referenceIds:[1,2,3],stylePolicy:'reference',creativeRevision:CREATIVE_REVISION},env,{requireAlternatives:true});
 return {supported:true,draft:v,plan};
}
export function acceptsArtistReview(v){
 if(!v||typeof v.accepted!=='boolean'||checks.some(k=>typeof v[k]!=='boolean')||!nonempty(v.evidence,2000)||!nonempty(v.reason,1600))throw Error('INVALID_ARTIST_REVIEW');
 return v.accepted&&checks.every(k=>v[k]);
}
async function record(store,id,value){const req=await store.begin(id,'step',()=>({maximum:0}));if(!req.replay)await store.complete(id,0,value);}

export async function artistOriginalStep(store,provider,env,now,x,direction=loadArtistDirection(),campaign=loadArtistCampaign(),services,pilotReady=pilotInspectionComplete()){
 if(!direction)return {status:'artist_direction_required'};
 if(!campaign)return {status:'artist_campaign_state_required'};
 const recent=(await store.pool.query("SELECT seq,payload,created FROM agent_events WHERE kind='x_post' ORDER BY seq DESC LIMIT 12")).rows.map(r=>({...r,payload:typeof r.payload==='string'?JSON.parse(r.payload):r.payload}));
 const project=await projectCursor(store,provider,direction,now);
 if(!project.id)return project;
 const baseRoot=project.id;
 const recovered=recent.find(r=>r.payload.projectId===baseRoot);
 if(recovered){await projectCheckpoint(store,baseRoot,'published',{title:project.intention.title,url:recovered.payload.url});return {status:'artist_project_published',url:recovered.payload.url};}
 const blockedRow=(await store.pool.query("SELECT payload,created FROM agent_events WHERE kind='artist_publication_blocked' AND payload::jsonb->>'root'=$1 ORDER BY seq DESC LIMIT 1",[baseRoot])).rows[0];
 const priorBlock=blockedRow?(typeof blockedRow.payload==='string'?JSON.parse(blockedRow.payload):blockedRow.payload):null;
 if(priorBlock&&!['CONCEPT_ATTEMPTS_EXHAUSTED','MEDIA_REJECTED'].includes(priorBlock.failureCode))return {status:'artist_publication_blocked',failureCode:priorBlock.failureCode};
 if(priorBlock&&now.getTime()<Date.parse(blockedRow.created)+3600000)return {status:'artist_editorial_cooldown',nextAt:new Date(Date.parse(blockedRow.created)+3600000).toISOString()};
 const root=priorBlock?baseRoot+'-r-'+createHash('sha256').update(priorBlock.cycle).digest('hex').slice(0,12):baseRoot;
 const blocked=async(status,code)=>{await record(store,root+'-blocked',{action:'artist_publication_blocked',root:baseRoot,cycle:root,failureCode:code,summary:status});await projectCheckpoint(store,baseRoot,'blocked',{title:project.intention.title,failureCode:code,nextAction:'Inspect saved material and review in the private studio; resolve this specific failure without resending unknown X operations.'});return {status,failureCode:code};};
 let selected;
 // Two concept attempts per publication cycle. Rejections do not become an
 // unlimited paid loop. Unknown/provider failures retain their durable operation.
 for(let attempt=0;attempt<2;attempt++){
  const id='x-plan-'+root+'-'+attempt;
  let draft=await store.operation(id);
  if(!draft){
   const prior=attempt?await store.operation('x-plan-'+root+'-0-review'):null;
   const prompt=projectDirection+' Develop the actual complete material for the saved intention. Choose the form because it carries the work: image, video, song, music_film, essay, process or sequence. Write the complete reader-visible text required by the accepted intention. If the accepted work is an image with a short caption, that caption is the entire manuscript: do not expand it into an essay or include production directions. Preserve full prose or lyrics when those are the intended work; never shorten them to fit delivery. Up to12000 characters is a storage bound, not a target. Do not optimize to any publishing limit. selectedId must exactly match one supplied alternative id, and that alternative must describe the chosen medium. For film/song specify full duration and use development for the complete audible/visible arc. For prose supply the complete prose. For a still, identify a relationship discoverable in the image without private explanation. Compare three genuinely different constructions; each renderPrompt <=2000 chars, other alternative fields <=600. Other decision fields <=1400, alt <=500. Unsupported production will become a visible execution request, never a substituted image. Preserve approved identity if depicted; otherwise no replacement woman. No invented technical facts or making-of history. '+JSON.stringify({intention:project.intention,artistBrief:direction.brief,completedCampaign:{project:campaign.project,status:'complete; native release handled separately'},recent:recent.map(r=>({text:r.payload.text,created:r.created})),priorCritique:prior?.result??null});
   const req=await store.begin(id,'step',()=>({prompt,maximum:provider.quote(constitution,prompt)}));if(req.replay)return {status:'artist_preparation_pending'};
   let cost=req.maximum;
   try{const r=await provider.generate(constitution,prompt,null,artistDraftSchema);cost=r.costMicrodollars;const value=validateArtistDraft(r.value,env);await store.complete(id,cost,{action:'artist_draft_internal',...value});await projectCheckpoint(store,baseRoot,'material',{title:r.value.title});return {status:'artist_work_prepared'};}
   catch(e){await store.complete(id,cost,{action:'artist_preparation_failed',failureCode:/^Gemini HTTP \d{3}/.exec(e.message)?.[0]??'INVALID_ARTIST_DRAFT'});return {status:'artist_preparation_failed'};}
  }
  if(draft.status!=='complete')return {status:'artist_preparation_pending'};
  if(draft.result?.action!=='artist_draft_internal'){if(draft.result?.failureCode==='INVALID_ARTIST_DRAFT')continue;return {status:'artist_preparation_failed'};}
  let review=await store.operation(id+'-review');
  if(!review){
   const prompt=projectDirection+' Independently edit the complete material, without adapting it to any platform limit. Accept only when each criterion is supported; cite concrete relationships and compare actual prior captions without inventing prior pixels. Reject a portrait whose music prop is its only artist connection, a cryptic sentence supplying absent meaning, or literal claims about material behavior unsupported by evidence. For process writing, absent real before/after evidence is a rejection. This is a proposal and manuscript review before media production: do not require generated pixels or treat imagined future scenes as claims of completed production. Reject concrete internal contradictions or unsupported claims presented as factual history, citing exact text. Do not speculate that a visual detail is impossible to render; actual media receives its own inspection. No medium is preferred: previous still images do not establish a static-image preference or justify rejecting video, sequence, music or temporal development. Do not replace the proposed medium with your preferred one. Concept assessment is not pixel inspection. Do not rewrite the manuscript. '+JSON.stringify({draft:draft.result.draft,recent:recent.map(r=>r.payload.text)});
   const req=await store.begin(id+'-review','step',()=>({prompt,maximum:provider.quote(constitution,prompt)}));if(req.replay)return {status:'artist_review_pending'};
   let cost=req.maximum;
   try{const r=await provider.generate(constitution,prompt,null,artistReviewSchema);cost=r.costMicrodollars;const accepted=acceptsArtistReview(r.value);await store.complete(id+'-review',cost,{action:'artist_concept_review',...r.value,accepted});return {status:'artist_concept_reviewed'};}
   catch{await store.complete(id+'-review',cost,{action:'artist_review_failed'});return {status:'artist_review_failed'};}
  }
  if(review.status!=='complete')return {status:'artist_review_pending'};
  if(review.result?.action!=='artist_concept_review')return {status:'artist_review_failed'};
  if(!review.result.accepted)continue;
  if(!draft.result.supported){
   if(draft.result.draft.medium==='essay'||draft.result.requirements.includes('complete_manuscript_delivery')){
    const independent=await reviewCompleteProse(store,provider,draft.result.draft.manuscript,draft.result.draft.medium);
    if(independent.status)return independent;
    if(!independent.accepted){
     await projectCheckpoint(store,baseRoot,'editorial_revision_required',{title:draft.result.draft.title,materialId:id,critique:independent.review,nextAction:'Revise the complete prose against the independent reader critique. Unsupported factual or production claims need actual evidence or removal; no companion-portrait substitution.'});
     return {status:'artist_prose_revision_required',projectId:baseRoot};
    }
   }
   await projectCheckpoint(store,baseRoot,'execution_required',{title:draft.result.draft.title,requirements:draft.result.requirements,materialId:id,nextAction:'Produce and deliver the complete saved work in its required format. Do not shorten it or generate a replacement postcard.'});
   return {status:'artist_format_delivery_required',projectId:baseRoot,requirements:draft.result.requirements};
  }
  selected={id,draft:draft.result};break;
 }
 if(!selected)return blocked('artist_editorial_blocked','CONCEPT_ATTEMPTS_EXHAUSTED');
 const planId=selected.id+'-selected';
 const v=selected.draft.draft;
 await record(store,planId,{...selected.draft.plan,projectId:root,artistWork:{version:ARTIST_LOOP,title:v.title,intention:v.intention,development:v.development,manuscript:v.manuscript,formatReason:v.formatReason},preparationCycle:root});
 const canonical=await store.operation(planId);
 if(canonical.status!=='complete')return {status:'artist_preparation_pending'};
 let media=await enqueueMedia(store,planId,canonical.result);
 if(media.data?.revisionJobId){const child=(await store.pool.query('SELECT * FROM agent_media_jobs WHERE id=$1',[media.data.revisionJobId])).rows[0];if(!child||child.plan?.revisionOf!==media.id)return blocked('artist_media_blocked','INVALID_MEDIA_REVISION');media=child;}
 if(['failed','held','rejected','superseded','reconsideration'].includes(media.state))return blocked('artist_media_blocked','MEDIA_'+media.state.toUpperCase());
 if(media.state!=='ready')return {status:'artist_media_pending'};
 const approved=await readyMedia(store,media.plan_id);
 if(!approved||approved.data.styleAudit?.commissionResult!=='supported'||approved.data.review?.text!==v.manuscript||!approved.data.assetId||!approved.data.mediaId||!approved.data.finalized||!Number.isFinite(Number(approved.data.expiresAt))||Number(approved.data.expiresAt)<=now.getTime())return blocked('artist_package_blocked','PACKAGE_NOT_VERIFIED');
 const editorial=await reviewDeliveredPackage(store,provider,env,approved,v.manuscript,services);
 if(editorial.status)return editorial;
 if(!editorial.accepted){await projectCheckpoint(store,baseRoot,'editorial_revision_required',{title:v.title,materialId:selected.id,assetId:approved.data.assetId,critique:editorial.review,nextAction:'Revise the actual work or full manuscript using this reader-visible critique; no unchanged resubmission.'});return blocked('artist_package_rejected','READER_PACKAGE_REJECTED');}
 await projectCheckpoint(store,baseRoot,'ready',{title:v.title,materialId:selected.id,assetId:approved.data.assetId});
 if(!pilotReady){await projectCheckpoint(store,baseRoot,'pilot_inspection_required',{title:v.title,materialId:selected.id,assetId:approved.data.assetId,nextAction:'Inspect the first actual complete package under this policy and record the private pilot receipt. A model review or successful deploy is not this inspection.'});return {status:'artist_pilot_inspection_required',projectId:baseRoot};}
 const window=await originalPublicationWindow(store.pool.query.bind(store.pool),now),native=campaignWindow(campaign,now);
 if(!native.due)return native;
 if(!window.due)return {status:'artist_ready',nextAt:window.nextAt};
 // Include native/manual originals and quotes. Replies do not consume this interval.
 const observation=await store.latest('artist_account_observation');
 if(observation?.nextAt&&now.getTime()<Date.parse(observation.nextAt))return {status:'artist_ready',nextAt:observation.nextAt};
 const actual=await x.recentPosts(now.getTime()-121*60000);
 const originals=actual.filter(p=>!(p.referenced_tweets??[]).some(r=>r.type==='replied_to'||r.type==='retweeted'));
 if(originals.some(p=>!Number.isFinite(Date.parse(p.created_at))))return {status:'artist_timeline_verification_required'};
 const latest=Math.max(0,...originals.map(p=>Date.parse(p.created_at)));
 if(now.getTime()<latest+7200000){const nextAt=new Date(latest+7200000).toISOString();await record(store,'artist-account-observation-'+latest,{action:'artist_account_observation',nextAt,observedAt:now.toISOString(),summary:'Observed recent account original; wait without repeating timeline reads.'});return {status:'artist_ready',nextAt};}
 const deliveryId=media.plan_id;
 await record(store,deliveryId,{...media.plan,text:v.manuscript});
 let publishId=deliveryId.replace(/^x-plan-/,'x-publish-');
 if((await store.operation(publishId))?.result?.action==='x_failed')publishId+='-retry1';
 const maximum=Number(env.X_POST_RESERVATION_MICRODOLLARS??210000);if(!Number.isSafeInteger(maximum)||maximum<=0)throw Error('X_TARIFF_NOT_CONFIGURED');
 const req=await store.begin(publishId,'step',()=>({maximum,originalPublication:true}));if(req.replay)return {status:req.result?.action==='artist_publish_rejected'?'artist_publication_blocked':req.status,replay:true};
 let post;
 try{post=await x.post(v.manuscript,null,approved.data.mediaId);}
 catch(e){if(e.phase==='verify'||/^X_HTTP_(400|401|402|403|422|429)$/.test(e.message)){await store.complete(publishId,maximum,{action:'artist_publish_rejected',failureCode:e.message,summary:'X explicitly rejected the request; no success claimed.'});return {status:'artist_publication_blocked'};}throw e;}
 // Keep the X operation pending until exact text AND attachment are read back.
 // A verification timeout goes through normal timeline reconciliation, never resend.
 await x.verifyPost(post.id,v.manuscript,approved.data.mediaId);
 await store.complete(publishId,maximum,{action:'x_post',text:v.manuscript,url:post.url,postId:post.id,assetId:approved.data.assetId,mime:approved.data.mime,alt:approved.data.review.alt,projectId:root,intent:'project',summary:'Complete independent artwork; exact text and attachment verified.',artistWorkVersion:ARTIST_LOOP,costBasis:'reserved estimate; reconcile against X billing'});
 await finishMedia(store,deliveryId);
 await projectCheckpoint(store,baseRoot,'published',{title:v.title,url:post.url});
 return {status:'published',url:post.url};
}

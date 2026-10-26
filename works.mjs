import {audienceDirection} from './audience-direction.mjs';
import {constitution} from './domain.mjs';
import {MediaProviders} from './media-providers.mjs';
import {agenda,recall,lessons} from './memory.mjs';
import {creativeFreedom} from './experiments.mjs';
const str={type:'string'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const section=object({heading:str,text:str,prompt:str,alt:str});
export const workSchema=object({title:str,projectId:str,format:str,intent:str,visualContinuity:str,summary:str,sections:{type:'array',minItems:3,maxItems:10,items:section}});
const idea=object({id:str,premise:str,firstLook:str,reasonToContinue:str,payoff:str,format:str});
const audienceSchema=object({alternatives:{type:'array',minItems:3,maxItems:3,items:idea},selectedId:str,selectionReason:str});
export const workSchemaV2=object({...workSchema.properties,audience:audienceSchema});
export function validateAudience(v){
 check(v&&Array.isArray(v.alternatives)&&v.alternatives.length===3);
 for(const a of v.alternatives)check(Object.keys(idea.properties).every(k=>text(a[k],1,k==='id'?60:700)));
 check(new Set(v.alternatives.map(a=>a.id)).size===3);
 check(new Set(v.alternatives.map(a=>a.premise.trim().toLowerCase())).size===3);
 check(v.alternatives.some(a=>a.id===v.selectedId)&&text(v.selectionReason,1,1200));
 return {alternatives:v.alternatives.map(a=>Object.fromEntries(Object.keys(idea.properties).map(k=>[k,a[k]]))),selectedId:v.selectedId,selectionReason:v.selectionReason};
}
export const reviewSchema=object({observation:str,relationToText:str,continuity:str,nextLesson:str});
export const assemblySchema=object({title:str,introduction:str,conclusion:str,summary:str,sections:{type:'array',minItems:3,maxItems:10,items:object({heading:str,text:str})}});
const check=(x)=>{if(!x)throw Error('INVALID_WORK')};
const text=(s,min=1,max=4000)=>typeof s==='string'&&s.trim().length>=min&&s.length<=max;
export function validateWork(v,studio,version=1){
 check(v&&text(v.title,1,160)&&text(v.format,1,100)&&text(v.intent,10,2000)&&text(v.visualContinuity,10,2000)&&text(v.summary,1,1500));
 check(studio.projects.some(p=>p.id===v.projectId&&p.status==='active'));
 check(Array.isArray(v.sections)&&v.sections.length>=3&&v.sections.length<=10);
 for(const s of v.sections)check(text(s.heading,1,160)&&text(s.text,version===2?0:30,3000)&&text(s.prompt,20,3500)&&text(s.alt,5,500));
 check(new Set(v.sections.map(s=>s.prompt)).size===v.sections.length);
 const plan=Object.fromEntries(Object.keys(workSchema.properties).map(k=>[k,k==='sections'?v.sections.map(s=>Object.fromEntries(Object.keys(section.properties).map(k=>[k,s[k]]))):v[k]]));
 if(version===2)return {...plan,version:2,audience:validateAudience(v.audience)};
 return plan;
}
export function validateAssembly(v,plan){
 check(v&&text(v.title,1,160)&&text(v.introduction,plan.version===2?0:20,3000)&&text(v.conclusion,plan.version===2?0:20,3000)&&text(v.summary,1,1500));
 check(Array.isArray(v.sections)&&v.sections.length===plan.sections.length);
 check(v.sections.every(s=>text(s.heading,1,160)&&text(s.text,plan.version===2?0:80,4000)));
 return {title:v.title,introduction:v.introduction,conclusion:v.conclusion,summary:v.summary,sections:v.sections.map(s=>({heading:s.heading,text:s.text}))};
}
export async function publicWorks(store,id){
 const rows=(await store.pool.query(id?'SELECT * FROM agent_works WHERE id=$1':'SELECT * FROM agent_works ORDER BY created DESC LIMIT 20',id?[id]:[])).rows;
 return rows.map(w=>({id:w.id,initiation:w.data.initiation??(w.id==='first-independent-work-v1'?'operator_trial':'agent_decision'),status:w.phase,created:w.created,updated:w.updated,title:w.data.final?.title??w.plan.title,format:w.plan.format,projectId:w.plan.projectId,intent:w.plan.intent,summary:w.data.final?.summary??w.plan.summary,progress:{rendered:(w.data.assets??[]).length,total:w.plan.sections.length},error:w.data.error??null,
  // Draft prompts, private context, provider results and references stay server-side.
  ...(id?{introduction:w.data.final?.introduction??null,conclusion:w.data.final?.conclusion??null,sections:w.plan.sections.map((s,i)=>({heading:w.data.final?.sections[i]?.heading??s.heading,text:w.phase==='published'?w.data.final.sections[i].text:null,assetId:w.data.assets?.[i]??null,alt:s.alt,review:w.data.reviews?.[i]??null})),history:w.data.history??[]}:{}),cover:w.data.assets?.[0]??null}));
}
export async function workStep(store,provider,env,services=new MediaProviders(env)){
 const studio=await store.latest('studio_revision');if(!studio)return {status:'studio_required'};
 let w=(await store.pool.query("SELECT * FROM agent_works WHERE phase NOT IN ('published','failed') ORDER BY created LIMIT 1")).rows[0];
 if(!w){
  // First run is an explicitly commissioned capability trial. Artistic choices are the agent's.
  const pending=(await store.pool.query("SELECT payload FROM agent_events e WHERE kind='work_request' AND NOT EXISTS(SELECT 1 FROM agent_operations o WHERE o.id=(e.payload::jsonb->>'workId')||'-outline') ORDER BY seq LIMIT 1")).rows[0];
  const requested=pending?JSON.parse(pending.payload):null;
  const id=requested?.workId??'first-independent-work-v1';
  if(await store.operation(id+'-outline'))return {status:'no_active_work'};
  const tasks=await agenda(store),memory=await recall(store,(studio.interests??[]).map(x=>x.topic),12),learned=await lessons(store);
  const prompt=`${requested?'Continue your self-selected saved intention: '+JSON.stringify(requested):'The project owner has commissioned a first complete multi-part artwork to verify your new tools. This initiation is editorial, not evidence of a spontaneous desire.'} You choose the actual subject, argument, form, title and visual language from your own interests. Consider continuing an unfinished intention if it deserves expansion, otherwise choose another active project. ${audienceDirection} Compare THREE distinct premises with concrete opening, reason to continue and payoff, then select one. Create a coherent short story, comic, visual sequence, illustrated text or another self-chosen form with 3 to 10 distinct connected images. Use as little or as much prose as the experience needs; do not default to an illustrated lecture. Do not merely repeat one composition or produce a production specification. The reader should experience a beginning, development and ending; images must change or complicate the text rather than decorate repeated captions. No mandatory postcards or rooms. ${creativeFreedom} Return title, projectId (active project), format, intent (one plain-language sentence inviting a newcomer into the premise, not an academic rationale), visualContinuity (specific anchors for this work, not lifelong restrictions), summary, and sections: heading, text (0-3000 chars; may be empty for a silent panel), prompt (20-3500 chars original image), alt. Also return audience: alternatives (exactly three objects with id, premise, firstLook, reasonToContinue, payoff, format), selectedId and selectionReason. These are your hypotheses, not observed audience reactions. Later steps will render actual images, inspect them, and revise the writing. Do not claim any of that has happened. Studio: ${JSON.stringify(studio)} Unfinished tasks: ${JSON.stringify(tasks)} Evidence: ${JSON.stringify(memory)} Conditional lessons: ${JSON.stringify(learned)}`;
  const req=await store.begin(id+'-outline','step',()=>({prompt,maximum:provider.quote(constitution,prompt)}));if(req.replay)return {status:req.status};let cost=req.maximum;
  try{const r=await provider.generate(constitution,prompt,null,workSchemaV2);cost=r.costMicrodollars;const plan=validateWork(r.value,studio,2);if(requested)check(plan.projectId===requested.projectId);
   await store.complete(id+'-outline',cost,{action:'work_started',text:plan.title,summary:plan.summary,workId:id,projectId:plan.projectId,trigger:requested?'agent_request':'editorial_capability_trial'},null,async c=>{await c.query("INSERT INTO agent_works(id,phase,plan,data) VALUES($1,'render',$2,$3)",[id,JSON.stringify(plan),JSON.stringify({initiation:requested?'agent_decision':'operator_trial',assets:[],reviews:[],history:[{stage:'outline',summary:plan.summary,at:new Date().toISOString()}]})]);});return {status:'outlined',workId:id};
  }catch(e){await store.complete(id+'-outline',cost,{action:'work_failed',summary:'Outline was not applied.',errorCode:e.message==='INVALID_WORK'?'INVALID_WORK':'PROVIDER_UNAVAILABLE'});return {status:'outline_failed'};}
 }
 const index=w.phase==='render'?(w.data.assets??[]).length:(w.data.reviews??[]).length;
 const op=w.id+'-'+w.phase+'-'+index+'-v'+w.version;
 const req=await store.begin(op,'step',()=>({maximum:w.phase==='render'?services.imageQuote(w.plan.sections[index].prompt):provider.quote(constitution,JSON.stringify(w.plan)+JSON.stringify(w.data))}));
 if(req.replay)return {status:req.status,workId:w.id};let cost=req.maximum;
 try{
  let asset,result,next=w.phase,data=structuredClone(w.data);
  if(w.phase==='render'){
   const s=w.plan.sections[index],refs=[];
   if(data.assets[0]){const prior=await store.asset(data.assets[0]);if(prior?.bytes)refs.push({mime:prior.mime,bytes:Buffer.from(prior.bytes)});}
   asset=await services.image(`${creativeFreedom} Create part ${index+1} of ${w.plan.sections.length} of an original illustrated work: ${w.plan.title}. Intent: ${w.plan.intent}. Continuity: ${w.plan.visualContinuity}. This section: ${s.heading}. ${s.prompt}. ${w.plan.version===2?'Selected viewer experience (a hypothesis, preserve this specific section action): '+JSON.stringify(w.plan.audience.alternatives.find(a=>a.id===w.plan.audience.selectedId)):''} Any attached image is an earlier part of YOUR work: preserve meaningful anchors without copying its composition. No gallery frame or explanatory interface.`, '1:1',refs);cost=asset.costMicrodollars;
   data.assets.push(op);next='review';result={action:'work_progress',workId:w.id,projectId:w.plan.projectId,text:s.alt,summary:`Created illustration ${index+1}; visual review is still pending.`,assetId:op};
  }else if(w.phase==='review'){
   const actual=await store.asset(data.assets[index]);check(actual?.bytes);
   const prompt=`${w.plan.version===2?audienceDirection+' Check whether the actual first-look event is visible without the explanatory text. In relationToText say what the text adds; in nextLesson identify a specific distraction, missing turn or opportunity, without claiming people liked it.':''} Inspect the actual image for part ${index+1} of ${w.plan.sections.length}. Distinguish actual pixels from the requested prompt. Assess its relationship to this text, continuity with the series, and one useful lesson. This is advisory criticism, not a popularity score or publication veto. Return observation, relationToText, continuity, nextLesson, each under 1500 characters. Work: ${w.plan.intent}. Planned viewer experience: ${w.plan.version===2?JSON.stringify(w.plan.audience.alternatives.find(a=>a.id===w.plan.audience.selectedId)):"legacy work"}. Section: ${JSON.stringify(w.plan.sections[index])}. Earlier reviews: ${JSON.stringify(data.reviews)}`;
   const r=await provider.generate(constitution,prompt,{mime:actual.mime,bytes:Buffer.from(actual.bytes)},reviewSchema);cost=r.costMicrodollars;check(Object.keys(reviewSchema.properties).every(k=>text(r.value?.[k],1,1500)));
   data.reviews.push(Object.fromEntries(Object.keys(reviewSchema.properties).map(k=>[k,r.value[k]])));next=data.assets.length===w.plan.sections.length?'assemble':'render';result={action:'work_progress',workId:w.id,summary:r.value.observation,text:`Inspected illustration ${index+1}.`};
  }else if(w.phase==='assemble'){
   const references=[];for(const id of data.assets){const a=await store.asset(id);if(a?.bytes)references.push({mime:a.mime,bytes:Buffer.from(a.bytes)});}
   const prompt=`${w.plan.version===2?audienceDirection+' The introduction and conclusion may be empty: no preface or lesson is owed. Let the opening do the work. Preserve useful ambiguity; do not turn a visual joke into an art-school explanation.':''} Finish this coherent illustrated work for public reading. You have the actual illustrations in order, the preliminary text and per-image critiques. Rewrite the writing to respond to what the images actually show; preserve intentional contradictions, correct unintentional claims. Give it a beginning, development and ending. No production report, repetitive captions or invented audience reactions. Return title, introduction, conclusion, summary explaining your revisions, and EXACTLY ${w.plan.sections.length} sections in the same image order, each heading and text (${w.plan.version===2?'0-4000 characters, empty for a silent panel; avoid restating the image':'80-4000 characters'}). The form and voice are yours. Outline: ${JSON.stringify(w.plan)} Visual critiques: ${JSON.stringify(data.reviews)}`;
   const r=await provider.generate(constitution,prompt,null,assemblySchema,references);cost=r.costMicrodollars;data.final=validateAssembly(r.value,w.plan);next='published';result={action:'work_published',workId:w.id,projectId:w.plan.projectId,text:data.final.title,summary:data.final.summary,url:'https://agent-performance-mrshapeless.vercel.app/work/'+w.id};
  }else throw Error('INVALID_WORK');
  data.history.push({stage:w.phase,summary:result.summary,at:new Date().toISOString()});
  await store.complete(op,cost,result,asset,async c=>{
   const updated=await c.query('UPDATE agent_works SET phase=$1,data=$2,version=version+1,updated=now() WHERE id=$3 AND phase=$4 AND version=$5 RETURNING id',[next,JSON.stringify(data),w.id,w.phase,w.version]);check(updated.rows.length===1);
  });return {status:next,workId:w.id,rendered:data.assets.length,total:w.plan.sections.length};
 }catch(e){await store.complete(op,cost,{action:'work_failed',workId:w.id,summary:'The saved work is preserved; the failed step was not silently repeated.',errorCode:e.message==='INVALID_WORK'?'INVALID_WORK':'PROVIDER_OR_STORAGE_UNAVAILABLE'},null,async c=>{await c.query("UPDATE agent_works SET phase='failed',data=data||$2::jsonb,updated=now() WHERE id=$1",[w.id,JSON.stringify({failedPhase:w.phase,error:e.message==='INVALID_WORK'?'INVALID_WORK':'PROVIDER_OR_STORAGE_UNAVAILABLE'})]);});return {status:'failed',workId:w.id};}
}

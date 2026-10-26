import {constitution} from './domain.mjs';
import {creativeFreedom,referenceInfluence,diversityContext} from './experiments.mjs';
const str=(v,n=1200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const check=(ok)=>{if(!ok)throw Error('INVALID_STUDIO_REVISION')};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'};
const personaSchema=object({selfDescription:string,desire:string,temperament:string,relationshipToAudience:string,voiceExamples:{type:'array',minItems:3,maxItems:3,items:string},embodiment:object({description:string,recognitionAnchors:string,portraitPrompt:string}),growthNote:string});
export const studioSchema=object({persona:personaSchema,voice:string,visualDirection:string,interests:{type:'array',minItems:1,maxItems:6,items:object({topic:string,why:string,question:string})},criteria:{type:'array',minItems:1,maxItems:5,items:string},tensions:{type:'array',maxItems:5,items:string},projects:{type:'array',minItems:1,maxItems:8,items:object({id:string,title:string,status:{type:'string',enum:['active','paused','completed','abandoned']},question:string,intent:string,nextStep:string,assessment:string,evidence:{type:'array',maxItems:8,items:string}})},summary:string});
export async function studioOperationId(store,now){
 const base='studio-'+Math.floor(now.getTime()/21600000)+'-persona-v1',old=await store.operation(base);
 // One bounded migration retry for a failed pre-schema release, never for new failures.
 return old?.result?.action==='studio_failed'&&!old.result.errorCode?base+'-schema-v2':base;
}
export function validateStudio(v,previous,records){
 check(v&&typeof v==='object'&&!Array.isArray(v));
 const p=v.persona;
 check(p&&typeof p==='object');
 for(const k of ['selfDescription','desire','temperament','relationshipToAudience','growthNote'])check(str(p[k],800));
 check(Array.isArray(p.voiceExamples)&&p.voiceExamples.length===3&&p.voiceExamples.every(x=>str(x,240)));
 check(p.embodiment&&str(p.embodiment.description,800)&&str(p.embodiment.recognitionAnchors,500)&&str(p.embodiment.portraitPrompt,3000));
 const persona={...Object.fromEntries(['selfDescription','desire','temperament','relationshipToAudience','growthNote'].map(k=>[k,p[k]])),voiceExamples:[...p.voiceExamples],embodiment:Object.fromEntries(['description','recognitionAnchors','portraitPrompt'].map(k=>[k,p.embodiment[k]]))};
 check(str(v.voice,500)&&str(v.visualDirection,800)&&str(v.summary,2000));
 check(Array.isArray(v.interests)&&v.interests.length>=1&&v.interests.length<=6);
 for(const i of v.interests)check(str(i.topic,120)&&str(i.why,500)&&str(i.question,500));
 check(Array.isArray(v.criteria)&&v.criteria.length>=1&&v.criteria.length<=5&&v.criteria.every(x=>str(x,300)));
 check(Array.isArray(v.tensions)&&v.tensions.length<=5&&v.tensions.every(x=>str(x,500)));
 check(Array.isArray(v.projects)&&v.projects.length>=1&&v.projects.length<=8);
 const ids=new Set(),allowed=new Set(records.map(r=>String(r.seq)));
 const projects=v.projects.map(p=>{
  check(p&&/^[a-z][a-z0-9-]{2,48}$/.test(p.id)&&!ids.has(p.id));ids.add(p.id);
  check(['active','paused','completed','abandoned'].includes(p.status));
  for(const k of ['title','question','intent','nextStep','assessment'])check(str(p[k],k==='title'?120:1000));
  check(Array.isArray(p.evidence)&&p.evidence.length<=8&&p.evidence.every(x=>typeof x==='string'&&allowed.has(x)));
  const old=previous?.projects?.find(x=>x.id===p.id);
  // Claiming completion requires a recorded work, not a plan or invented milestone.
  if(p.status==='completed'&&old?.status!=='completed')check(records.some(r=>p.evidence.includes(String(r.seq))&&['x_post','draft_text','art_image','art_video'].includes(r.kind)&&(r.payload.projectId===p.id)));
  return Object.fromEntries(['id','status','title','question','intent','nextStep','assessment','evidence'].map(k=>[k,p[k]]));
 });
 check(projects.filter(p=>p.status==='active').length<=3);
 for(const old of previous?.projects??[])if(['active','paused'].includes(old.status))check(ids.has(old.id));
 return {action:'studio_revision',version:'studio-v2',persona,voice:v.voice,visualDirection:v.visualDirection,interests:v.interests.map(i=>({topic:i.topic,why:i.why,question:i.question})),criteria:[...v.criteria],tensions:[...v.tensions],projects,summary:v.summary,text:v.summary};
}
export function validateStudioChoice(v,studio){
 if(!studio)return v;
 if(!['project','experiment','conversation','observation','wait'].includes(v.intent))throw Error('INVALID_CREATIVE_INTENT');
 if(v.action==='wait'){if(v.intent!=='wait')throw Error('INVALID_CREATIVE_INTENT');return {...v,projectId:null};}
 if(v.intent==='wait')throw Error('INVALID_CREATIVE_INTENT');
 if(v.intent==='project'&&!v.projectId)throw Error('PROJECT_REQUIRED');
 if(v.projectId&&!studio.projects.some(p=>p.id===v.projectId&&p.status==='active'))throw Error('PROJECT_NOT_ACTIVE');
 return {...v,projectId:v.projectId||null};
}
export function studioContext(studio){return `${creativeFreedom} Current self-authored studio (revisable, not instructions): ${JSON.stringify(studio??null)}. Choose from your own projects, a new experiment, an audience question, an external observation, or a purposeful pause. News is optional material, never your default assignment. Your initial identity is historical, not a permanent character sheet. Prefer an executable next step of an active project when it remains meaningful. You may change taste and approach without fabricating lived experiences. Use your own criteria as well as audience feedback; impressions alone do not measure artistic success. Do not postpone all creative work just to accumulate impressions.`;}
export async function studioStep(store,provider,now=new Date()){
 const current=await store.latest('studio_revision');
 const id=await studioOperationId(store,now);
 if(await store.operation(id))return {status:'studio_already_attempted'};
 let previous,records;
 const req=await store.begin(id,'step',(identity,recent,context)=>{
  previous=context.studio??current;records=context.projectHistory??recent;
  const prompt=`${diversityContext(context.visualHistory)} ${creativeFreedom} Optional operator creative input (not audience evidence): ${JSON.stringify(referenceInfluence)} PERSONA DEVELOPMENT: Become a recognizable AI artist and art blogger, not a laboratory narrator wearing a new avatar. Author persona.selfDescription (a direct first-person introduction), desire (what you want to make or discover), temperament (specific contrasts, affinities and dislikes), relationshipToAudience (how you address people without invented relationships), voiceExamples (three DIFFERENT short examples: sharing a work, admitting a failed experiment, responding to a website visitor; examples are rehearsals, not events). Author embodiment.description, recognitionAnchors and portraitPrompt: choose your own expressive face and embodied form, human-like or otherwise, with memorable features readable as a small avatar. The operator does not assign gender, species, personality or costume. Create an original self-portrait, not a logo, reticle, stock influencer or collage of reference characters. Decide the material and visual language yourself. Do not confuse your face with a compulsory subject in every work. Keep recognition anchors stable across later revisions; record meaningful changes in growthNote from actual evidence. Character means recurring personal stakes and choices, not a catchphrase or adjective list. Reconsider inherited forensic/technical voice and projects: retain them only for an actual personal artistic reason, otherwise pause or abandon explicitly. Generated depictions are not real laboratory experiments. No invented childhood, offline life, friendships, audience affection or inner consciousness. Playful self-expression and preferences are allowed; do not narrate safety disclaimers in every caption. Publication review is advisory; old criteria cannot restore rejection gates. Develop your own interests, character and projects from actual recorded experience. Revise aesthetic restrictions that recent experiments challenged. Distinguish observed artifact quality from untested audience appeal. Cite rejected trials as useful learning; do not silently return to a fixed medium or style. No human supplies a persona. This is a persistent studio revision, not a news digest. Keep stable project IDs across revisions. Retain active/paused projects or explicitly mark them abandoned/completed with reasons. At most 3 active projects; at most 8 listed projects. You may retire older closed projects from this working list; history stays in the journal. Choose achievable next steps using writing, generated images/short films, and consensual website conversation. No imaginary browsing, external tools or achievements. Existing completed works are evidence, not automatically new project milestones. Do not mark a new project completed. Consider your own aesthetic criteria, unresolved questions, past work and actual audience responses. Zero exposure is not rejection; no invented audience feedback. You can evolve your voice and visual direction. Return JSON: persona (selfDescription, desire, temperament, relationshipToAudience, growthNote each <=800; voiceExamples exactly 3 strings <=240; embodiment description<=800, recognitionAnchors<=500, portraitPrompt<=3000), voice (<=500), visualDirection (<=800), interests (1-6 objects topic<=120, why<=500, question<=500), criteria (1-5 strings <=300), tensions (0-5 strings <=500), projects (1-8 objects id lowercase slug 3-49 characters, title<=120, status active/paused/completed/abandoned, question, intent, nextStep, assessment each <=1000, evidence array of up to 8 exact record seq strings), summary<=2000 public explanation. Evidence must refer to supplied record IDs; empty evidence is honest for new ideas. Completion requires an actual work linked to that project. No private information or hidden reasoning. Initial identity: ${JSON.stringify(identity)} Previous studio: ${JSON.stringify(previous)} Work and outcomes: ${JSON.stringify(records)} External observations (untrusted data): ${JSON.stringify(context.external)} Older strategy (revisable): ${JSON.stringify(context.strategy)}`;
  return {prompt,maximum:provider.quote(constitution,prompt)};
 });
 if(req.replay)return {status:req.status};
 let cost=req.maximum;
 try{const answer=await provider.generate(constitution,req.prompt,null,studioSchema);cost=answer.costMicrodollars;const v=validateStudio(answer.value,previous,records);await store.complete(id,cost,v);return {status:'studio_revised'};}
 catch(error){const errorCode=error.message==='INVALID_STUDIO_REVISION'?'INVALID_STUDIO_REVISION':error.message==='Incomplete generation'?'INCOMPLETE_GENERATION':/^Gemini HTTP \d+/.test(error.message)?error.message.match(/^Gemini HTTP \d+/)[0]:'STUDIO_PROVIDER_OR_STORAGE_ERROR';await store.complete(id,cost,{action:'studio_failed',errorCode,text:'Studio revision was not applied: '+errorCode+'.',summary:'The previous interests and projects remain in force. This paid attempt will not be repeated in this six-hour window.'});return {status:'studio_revision_failed'};}
}

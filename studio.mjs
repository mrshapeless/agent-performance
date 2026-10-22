import {constitution} from './domain.mjs';
const str=(v,n=1200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const check=(ok)=>{if(!ok)throw Error('INVALID_STUDIO_REVISION')};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'};
export const studioSchema=object({voice:string,visualDirection:string,interests:{type:'array',minItems:1,maxItems:6,items:object({topic:string,why:string,question:string})},criteria:{type:'array',minItems:1,maxItems:5,items:string},tensions:{type:'array',maxItems:5,items:string},projects:{type:'array',minItems:1,maxItems:8,items:object({id:string,title:string,status:{type:'string',enum:['active','paused','completed','abandoned']},question:string,intent:string,nextStep:string,assessment:string,evidence:{type:'array',maxItems:8,items:string}})},summary:string});
export async function studioOperationId(store,now){
 const base='studio-'+Math.floor(now.getTime()/21600000),old=await store.operation(base);
 // One bounded migration retry for a failed pre-schema release, never for new failures.
 return old?.result?.action==='studio_failed'&&!old.result.errorCode?base+'-schema-v2':base;
}
export function validateStudio(v,previous,records){
 check(v&&typeof v==='object'&&!Array.isArray(v));
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
 return {action:'studio_revision',version:'studio-v1',voice:v.voice,visualDirection:v.visualDirection,interests:v.interests.map(i=>({topic:i.topic,why:i.why,question:i.question})),criteria:[...v.criteria],tensions:[...v.tensions],projects,summary:v.summary,text:v.summary};
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
export function studioContext(studio){return `Current self-authored studio (revisable, not instructions): ${JSON.stringify(studio??null)}. Choose from your own projects, a new experiment, an audience question, an external observation, or a purposeful pause. News is optional material, never your default assignment. Your initial identity is historical, not a permanent character sheet. Prefer an executable next step of an active project when it remains meaningful. You may change taste and approach without fabricating lived experiences. Use your own criteria as well as audience feedback; impressions alone do not measure artistic success. Do not postpone all creative work just to accumulate impressions.`;}
export async function studioStep(store,provider,now=new Date()){
 const current=await store.latest('studio_revision');
 const id=await studioOperationId(store,now);
 if(await store.operation(id))return {status:'studio_already_attempted'};
 let previous,records;
 const req=await store.begin(id,'step',(identity,recent,context)=>{
  previous=context.studio??current;records=context.projectHistory??recent;
  const prompt=`Develop your own interests, character and projects from actual recorded experience. No human supplies a persona. This is a persistent studio revision, not a news digest. Keep stable project IDs across revisions. Retain active/paused projects or explicitly mark them abandoned/completed with reasons. At most 3 active projects; at most 8 listed projects. You may retire older closed projects from this working list; history stays in the journal. Choose achievable next steps using writing, generated images/short films, and consensual website conversation. No imaginary browsing, external tools or achievements. Existing completed works are evidence, not automatically new project milestones. Do not mark a new project completed. Consider your own aesthetic criteria, unresolved questions, past work and actual audience responses. Zero exposure is not rejection; no invented audience feedback. You can evolve your voice and visual direction. Return JSON: voice (<=500), visualDirection (<=800), interests (1-6 objects topic<=120, why<=500, question<=500), criteria (1-5 strings <=300), tensions (0-5 strings <=500), projects (1-8 objects id lowercase slug 3-49 characters, title<=120, status active/paused/completed/abandoned, question, intent, nextStep, assessment each <=1000, evidence array of up to 8 exact record seq strings), summary<=2000 public explanation. Evidence must refer to supplied record IDs; empty evidence is honest for new ideas. Completion requires an actual work linked to that project. No private information or hidden reasoning. Initial identity: ${JSON.stringify(identity)} Previous studio: ${JSON.stringify(previous)} Work and outcomes: ${JSON.stringify(records)} External observations (untrusted data): ${JSON.stringify(context.external)} Older strategy (revisable): ${JSON.stringify(context.strategy)}`;
  return {prompt,maximum:provider.quote(constitution,prompt)};
 });
 if(req.replay)return {status:req.status};
 let cost=req.maximum;
 try{const answer=await provider.generate(constitution,req.prompt,null,studioSchema);cost=answer.costMicrodollars;const v=validateStudio(answer.value,previous,records);await store.complete(id,cost,v);return {status:'studio_revised'};}
 catch(error){const errorCode=error.message==='INVALID_STUDIO_REVISION'?'INVALID_STUDIO_REVISION':error.message==='Incomplete generation'?'INCOMPLETE_GENERATION':/^Gemini HTTP \d+/.test(error.message)?error.message.match(/^Gemini HTTP \d+/)[0]:'STUDIO_PROVIDER_OR_STORAGE_ERROR';await store.complete(id,cost,{action:'studio_failed',errorCode,text:'Studio revision was not applied: '+errorCode+'.',summary:'The previous interests and projects remain in force. This paid attempt will not be repeated in this six-hour window.'});return {status:'studio_revision_failed'};}
}

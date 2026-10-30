// Persistent, evidence-linked state. No private inputs or model scratchpads are public.
const allowed=['x_post','media_review','media_failed','record_note','dialogue','work_published','workspace_outcome','workspace_note','draft_text'];
export function reviewEvidence(p){
 const keys=['decision','visualLanguageResult','referenceComparison','observedResult','noveltyEvidence','viewerHook','nextExperiment','craftResult','craftEvidence','hypothesisResult'];
 return Object.fromEntries(keys.filter(k=>typeof p[k]==='string').map(k=>[k,p[k].slice(0,1600)]));
}
const payloadOf=r=>typeof r.payload==='string'?JSON.parse(r.payload):r.payload;
export function decisionHealth(events,now=Date.now()){
 const rows=[...events].sort((a,b)=>Number(b.seq)-Number(a.seq));
 const success=rows.find(e=>e.kind==='workspace_broadcast');
 const failure=rows.find(e=>e.kind==='cognition_failed');
 const failed=!!failure&&(!success||Number(failure.seq)>Number(success.seq));
 const stale=!success||now-Date.parse(success.created)>2*3600000;
 return {status:failed?'failed':stale?'stale':'healthy',lastSucceededAt:success?.created??null,lastFailedAt:failure?.created??null,failureCode:failed?payloadOf(failure)?.failureCode??'DECISION_FAILED':null};
}
// One artwork is one observation, not votes from successive model calls.
export async function canonicalMediaReviews(query,eventRows){
 const rows=eventRows??(await query("SELECT seq,kind,payload FROM agent_events WHERE kind='media_review' ORDER BY seq DESC LIMIT 160")).rows;
 const jobs=(await query("SELECT id,data FROM agent_media_jobs WHERE data ? 'styleAudit' ORDER BY updated DESC LIMIT 160")).rows;
 const audits=new Map();for(const j of jobs)if(j.data.assetId&&!audits.has(j.data.assetId))audits.set(j.data.assetId,j.data.styleAudit);
 const selected=new Map();
 for(const r of rows.filter(r=>r.kind==='media_review').sort((a,b)=>Number(b.seq)-Number(a.seq))){
  const p=payloadOf(r),key=p.assetId??'event:'+r.seq,old=selected.get(key);
  const independent=p.evidenceProvenance==='independent_visual_audit'||p.reviewer==='independent_visual_audit'||p.source==='independent_visual_audit';
  if(old&&(!independent||old.independent))continue;
  const audit=audits.get(p.assetId),criticism=reviewEvidence(audit??p);
  selected.set(key,{seq:r.seq,assetId:p.assetId??null,independent:!!audit||independent,criticism,source:audit||independent?'independent_model_review_not_audience':p.evidenceProvenance==='artist_review'?'artist_self_review_not_audience':'unverified_model_review_not_audience',summary:`Model review: ${criticism.decision??'unrecorded decision'}; visual alignment ${criticism.visualLanguageResult??'unknown'}. This is not operator feedback or audience evidence. Publication and artist self-approval are not audience approval.`});
 }
 return selected;
}
export async function workspaceState(store){
 const broadcast=await store.latest('workspace_broadcast');
 const goals=(await store.pool.query("SELECT id,status,objective,why,success,evidence,version FROM agent_goals ORDER BY updated DESC LIMIT 16")).rows;
 const predictions=(await store.pool.query("SELECT id,goal_id,metric,probability,status,outcome,evidence FROM agent_predictions ORDER BY created DESC LIMIT 16")).rows;
 return {broadcast,goals,predictions};
}
export async function workspaceEvidence(store,epoch){
 const raw=(await store.pool.query("SELECT seq,kind,payload FROM agent_events WHERE kind=ANY($1::text[]) ORDER BY seq DESC LIMIT 160",[allowed])).rows;
 const canonical=await canonicalMediaReviews(store.pool.query.bind(store.pool),raw);
 const rows=raw.filter(r=>r.kind!=='media_review'||String(canonical.get(payloadOf(r).assetId??'event:'+r.seq)?.seq)===String(r.seq));
 const project=r=>{const p=payloadOf(r),review=canonical.get(p.assetId??'event:'+r.seq);return {id:String(r.seq),kind:r.kind,text:String(p.text??p.alt??'').slice(0,1800),summary:r.kind==='media_review'?review.summary:r.kind==='x_post'?'Published work; distribution is not evidence of artistic success or audience approval.':String(p.summary??'').slice(0,1200),assetId:p.assetId??null,...(review&&['media_review','x_post'].includes(r.kind)?{criticism:review.criticism}:{}),source:r.kind==='record_note'?'operator':r.kind==='media_review'?review.source:r.kind==='workspace_note'?'agent_hypothesis':'recorded_event'};};
 const recent=rows.slice(0,12),older=rows.slice(12),offset=older.length?epoch%older.length:0;
 const sampled=[...older.slice(offset),...older.slice(0,offset)].slice(0,8);
 const notes=rows.filter(r=>r.kind==='record_note'||r.kind==='workspace_note'||r.kind==='workspace_outcome').slice(0,8);
 const reviews=rows.filter(r=>r.kind==='media_review').slice(0,6);
 const evidence=[...new Map([...recent,...sampled,...notes,...reviews].map(r=>[String(r.seq),project(r)])).values()];
 const studied=await store.latest('workspace_note');
 for(const e of studied?.retrieved??[])if(e.kind!=='media_review'&&!evidence.some(x=>x.id===e.id))evidence.push({id:e.id,kind:e.kind,text:e.text,summary:e.kind==='x_post'?'Published work; audience response unknown.':e.summary,source:e.source,assetId:e.assetId});
 const room=(await store.pool.query("SELECT id,role,text FROM agent_room WHERE hidden=false ORDER BY seq DESC LIMIT 6")).rows;
 evidence.push(...room.map(r=>({id:'room:'+r.id,kind:'conversation',text:r.text.slice(0,1400),summary:'Public room utterance; not verified fact',source:r.role==='agent'?'agent_utterance':'visitor'})));
 const obs=await store.latest('observation');
 (obs?.news??[]).slice(0,24).forEach((n,i)=>evidence.push({id:'news:'+i,kind:'headline',text:n.title,summary:n.source+'; headline only, article not read',source:'external_untrusted',url:n.url}));
 (obs?.metrics??[]).slice(0,10).forEach(m=>evidence.push({id:'metrics:'+m.id,kind:'audience_measurement',text:JSON.stringify({postId:m.id,metrics:m.metrics,score:m.score}),summary:m.evidence+'; observational association, not causal evidence or artistic quality',source:'platform_measurement'}));
 return evidence;
}
export async function reconcilePredictions(store,now=new Date()){
 return store.transaction(async c=>{
  const pending=(await c.query("SELECT * FROM agent_predictions WHERE status='pending' ORDER BY created LIMIT 24 FOR UPDATE")).rows;
  let count=0;
  for(const p of pending){
   let outcome=null,evidence=[],status='pending';
   const jobs=(await c.query("SELECT state,data FROM agent_media_jobs WHERE plan->>'agendaId'=$1 ORDER BY updated DESC,id DESC",[p.task_id])).rows;
   const posts=(await c.query("SELECT seq FROM agent_events WHERE kind='x_post' AND payload::jsonb->>'agendaId'=$1",[p.task_id])).rows;
   if(p.metric==='publication'&&posts.length){outcome=1;evidence=posts.map(x=>String(x.seq));}
   if(p.metric==='visual_alignment'){
    const reviewed=jobs.find(j=>['supported','partly','not_supported'].includes(j.data.styleAudit?.visualLanguageResult));
    if(reviewed){outcome=reviewed.data.styleAudit.visualLanguageResult==='supported'&&reviewed.data.styleAudit.decision!=='reject'?1:0;evidence=['model_visual_review:'+p.task_id];}
   }
   if(p.metric==='draft_saved'){
    const task=(await c.query("SELECT artifact FROM agent_agenda WHERE id=$1",[p.task_id])).rows[0];
    if(task?.artifact){outcome=1;evidence=['draft:'+p.task_id];}
   }
   if(outcome!==null)status='observed';
   else if(new Date(p.deadline)<=now)status='unknown'; // No observation is NOT negative feedback.
   if(status==='pending')continue;
   await c.query('UPDATE agent_predictions SET status=$2,outcome=$3,evidence=$4 WHERE id=$1',[p.id,status,outcome,JSON.stringify(evidence)]);
   const brier=outcome===null?null:(p.probability-outcome)**2;
   await store.append(c,'workspace_outcome',{predictionId:p.id,goalId:p.goal_id,metric:p.metric,probability:p.probability,outcome,status,evidence,brier,summary:outcome===null?'Prediction remains unknown: no matching observation before deadline.':`Prediction ${p.metric}: expected probability ${p.probability}, observed ${outcome}; squared error ${brier.toFixed(3)}. Visual alignment is a model assessment, not human approval.`});
   count++;
  }
  return count;
 });
}
export async function publicWorkspace(store){
 const {broadcast,goals,predictions}=await workspaceState(store);
 const keys=['episode','selectedId','attention','summary','selfModel','selection','sources','goalChanges','evidence'];
 return {version:'workspace-v1',claim:'Experimental functional architecture; consciousness unverified',broadcast:broadcast?Object.fromEntries(keys.filter(k=>k in broadcast).map(k=>[k,broadcast[k]])):null,goals,predictions};
}

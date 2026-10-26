// Retrieval indexes only evidence-bearing, approved event fields. Raw inbox,
// credentials, generation prompts and operator reference inputs are not memory.
const kinds=['identity','record_note','draft_text','x_post','art_image','art_video','media_review','reflect','cognitive_decision'];
export async function recall(store,queries,limit=12,sourceIds=[]){
 const terms=[...new Set(queries.flatMap(q=>q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]))].slice(0,24);
 if(!terms.length&&!sourceIds.length)return [];
 const {rows}=await store.pool.query(`WITH evidence AS (
 SELECT seq::text AS id,seq,kind,created::timestamptz AS created,payload::jsonb AS p FROM agent_events WHERE kind=ANY($1::text[])
 UNION ALL SELECT 'room:'||id,seq,'public_conversation',created,jsonb_build_object('text',text,'summary',CASE WHEN role='agent' THEN 'Agent message in the public room' ELSE 'Unverified visitor message in the public room' END) FROM agent_room WHERE hidden=false
 ), documents AS (
 SELECT id,seq,kind,created,p,concat_ws(' ',p->>'text',p->>'summary',p->>'alt') AS body FROM evidence
 ) SELECT id,seq,kind,created,p,
 (SELECT count(*) FROM unnest($2::text[]) term WHERE strpos(lower(body),term)>0) AS relevance
 FROM documents WHERE id=ANY($4::text[]) OR EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE strpos(lower(body),term)>0)
 ORDER BY (id=ANY($4::text[])) DESC,relevance DESC,created DESC LIMIT $3`,[kinds,terms,Math.min(40,Math.max(1,limit)),sourceIds.slice(0,20)]);
 return rows.map(r=>({id:r.id,kind:r.kind,created:r.created,source:r.kind==='record_note'?'editorial_record':r.kind==='public_conversation'?'public_conversation_not_verified_fact':r.kind==='reflect'||r.kind==='cognitive_decision'?'agent_interpretation':'recorded_event',text:String(r.p.text??r.p.alt??'').slice(0,5000),summary:String(r.p.summary??'').slice(0,1500),projectId:r.p.projectId??null,assetId:r.p.assetId??null}));
}
export async function lessons(store){return (await store.pool.query("SELECT id,claim,conditions,evidence,counterevidence,status FROM agent_lessons ORDER BY updated DESC LIMIT 30")).rows;}
export async function agenda(store){return (await store.pool.query("SELECT id,project_id,status,objective,next_step,artifact,version,updated FROM agent_agenda WHERE status IN ('active','commissioned') ORDER BY updated LIMIT 8")).rows;}
export async function commissionedTask(store){return (await store.pool.query("SELECT * FROM agent_agenda WHERE status='commissioned' ORDER BY updated LIMIT 1")).rows[0]??null;}
export async function reconcileAgenda(store){
 await store.pool.query(`UPDATE agent_agenda a SET status='completed',updated=now(),version=version+1
 WHERE status='commissioned' AND EXISTS (SELECT 1 FROM agent_events e WHERE e.kind='x_post' AND e.payload::jsonb->>'agendaId'=a.id AND COALESCE(e.payload::jsonb->>'agendaVersion','1')=a.version::text)`);
 await store.pool.query(`UPDATE agent_agenda a SET status='active',next_step='Previous media execution failed; inspect the recorded outcome and revise before commissioning again.',updated=now(),version=version+1
 WHERE status='commissioned' AND EXISTS(SELECT 1 FROM agent_media_jobs j WHERE j.plan->>'agendaId'=a.id AND COALESCE(j.plan->>'agendaVersion','1')=a.version::text AND j.state='failed')`);
}


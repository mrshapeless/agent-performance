import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';


export function workerAuthorized(header,hash) {
 if(!/^[a-f0-9]{64}$/.test(hash??'')||!/^Bearer [a-zA-Z0-9_-]{43,128}$/.test(header??''))return false;
 const actual=createHash('sha256').update(header.slice(7)).digest();
 return timingSafeEqual(actual,Buffer.from(hash,'hex'));
}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function inferenceRole(schema){
 const p=schema?.properties;
 if(p?.accepted||(p?.decision&&p?.claims&&p?.completeInDeliveredForm))return 'critic';
 // A complete authored work includes artistic planning, not just caption drafting.
 if(p?.question||(p?.intention&&p?.alternatives&&p?.selectedId&&p?.manuscript))return 'planner';
 return null;
}
export async function enqueueInference(store,input,operationId=null) {
 if(typeof input.system!=='string'||typeof input.prompt!=='string'||JSON.stringify(input).length>12_000_000)throw Error('INVALID_LOCAL_INPUT');
 const id=digest(input);
 await store.pool.query("INSERT INTO agent_local_inference(id,input,state,operation_id) VALUES($1,$2,'queued',$3) ON CONFLICT(id) DO NOTHING",[id,JSON.stringify(input),operationId]);
 return id;
}
export async function claimInference(store) {
 return store.transaction(async c=>{
  const row=(await c.query("SELECT id,input FROM agent_local_inference WHERE state='queued' OR (state='running' AND lease_until<now()) ORDER BY created LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
  if(!row)return null;
  const token=randomUUID();
  await c.query("UPDATE agent_local_inference SET state='running',lease_token=$2,lease_until=now()+interval '10 minutes',attempts=attempts+1,updated=now() WHERE id=$1",[row.id,token]);
  return {...row,leaseToken:token};
 });
}
export async function returnInference(store,{id,leaseToken,result}) {
 const terminalFailure=result?.failure?.code==='HERMES_REPAIR_FAILED'&&result.value===undefined;
 if(!/^[a-f0-9]{64}$/.test(id??'')||!result||(!terminalFailure&&(typeof result.value!=='object'||result.value===null||result.failure!==undefined))||result.costMicrodollars!==0||JSON.stringify(result).length>2_000_000)throw Error('INVALID_LOCAL_RESULT');
 return store.transaction(async c=>{
  const row=(await c.query('SELECT state,lease_token,result FROM agent_local_inference WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw Error('UNKNOWN_LOCAL_JOB');
  // A lost response can be reconciled with exactly the same saved result.
  if(row.state==='complete') {if(digest(row.result)!==digest(result))throw Error('RESULT_CONFLICT');return {status:'complete',replay:true};}
  if(row.state!=='running'||row.lease_token!==leaseToken)throw Error('STALE_LEASE');
  await c.query("UPDATE agent_local_inference SET state='complete',result=$2,lease_until=NULL,updated=now() WHERE id=$1",[id,JSON.stringify(result)]);
  return {status:'complete',replay:false};
 });
}
export class LocalInference {
 constructor(store,{timeoutMs=90000,pollMs=1000}={}){this.store=store;this.timeoutMs=timeoutMs;this.pollMs=pollMs;this.local=true;}
 quote(){return 0;}
 async generate(system,prompt,media=null,schema=null,references=[]) {
  const pixels=[...(media?[media]:[]),...references];
  if(pixels.some(m=>!['image/png','image/jpeg','image/webp'].includes(m.mime)||!m.bytes))throw Error('LOCAL_MEDIA_UNSUPPORTED');
  const input={system,prompt,schema,role:inferenceRole(schema),media:pixels.map((m,i)=>({mime:m.mime,data:Buffer.from(m.bytes).toString('base64'),label:media&&i===0?'CANDIDATE':'REFERENCE '+(media?i:i+1)+' (not the candidate)'})),operationId:this.store.localOperationId??null};
  return this.waitInput(input);
 }
 async image(prompt,ratio,plan){
  if(plan?.renderer==='character')throw Error('LOCAL_IDENTITY_NOT_VERIFIED');
  if(!['1:1','16:9','9:16','21:9'].includes(ratio))throw Error('IMAGE_INVALID_RATIO');
  const answer=await this.waitInput({kind:'art_draft',system:'',prompt,ratio,depictsAlidade:false,operationId:this.store.localOperationId??null});
  const {data,mime}=answer.value;
  if(mime!=='image/jpeg'||typeof data!=='string')throw Error('IMAGE_INVALID');
  const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>3_500_000)throw Error('IMAGE_TOO_LARGE');
  return {bytes,mime,costMicrodollars:0};
 }
 async waitInput(input){
  const saved=this.store.localOperationId?(await this.store.pool.query('SELECT id FROM agent_local_inference WHERE operation_id=$1',[this.store.localOperationId])).rows[0]:null;
  const id=saved?.id??await enqueueInference(this.store,input,this.store.localOperationId??null),deadline=Date.now()+this.timeoutMs;
  do {
   const row=(await this.store.pool.query('SELECT state,result FROM agent_local_inference WHERE id=$1',[id])).rows[0];
   if(row?.state==='complete'){
    if(row.result?.failure){const error=Error('LOCAL_INFERENCE_FAILED');error.failureCode=row.result.failure.code;throw error;}
    return row.result;
   }
   await new Promise(r=>setTimeout(r,this.pollMs));
  }while(Date.now()<deadline);
  const error=Error('LOCAL_INFERENCE_PENDING');error.code='LOCAL_INFERENCE_PENDING';throw error;
 }
}

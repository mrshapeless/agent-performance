import {PostgresStore} from './postgres.mjs';
// Only inference-owned operations are replayable. X uploads/posts and unknown
// historical operations retain the original pending/uncertain protection.
export class LocalInferenceStore extends PostgresStore {
 async localId(id){
  const old=await super.operation(id);
  // This provider rejection occurred before generation. Preserve its receipt;
  // retry locally under a different ID, never reset publication/history rows.
  return old?.status==='complete'&&old.result?.action==='artist_preparation_failed'&&['GEMINI_BILLING_REQUIRED','Gemini HTTP 402'].includes(old.result.failureCode)?id+'-local-v1':id;
 }
 async operation(id){
  id=await this.localId(id);
  const op=await super.operation(id);
  if(op?.status==='pending'&&(await this.pool.query('SELECT id FROM agent_local_inference WHERE operation_id=$1',[id])).rows.length)return null;
  return op;
 }
 async begin(id,kind,buildRequest){
  id=await this.localId(id);
  const existing=(await this.pool.query('SELECT input FROM agent_local_inference WHERE operation_id=$1',[id])).rows[0];
  const op=existing?(await this.pool.query('SELECT status,kind FROM agent_operations WHERE id=$1',[id])).rows[0]:null;
  if(existing&&op?.status==='pending'){this.localOperationId=id;return {replay:false,kind:op.kind??kind,prompt:existing.input.prompt,maximum:0};}
  const result=await super.begin(id,kind,buildRequest);
  this.localOperationId=result.replay?null:id;return result;
 }
 async complete(id,...args){
  id=await this.localId(id);
  const pending=(await this.pool.query("SELECT id FROM agent_local_inference WHERE operation_id=$1 AND state<>'complete'",[id])).rows[0];
  if(pending)throw Error('LOCAL_INFERENCE_PENDING');
  const result=await super.complete(id,...args);if(this.localOperationId===id)this.localOperationId=null;return result;
 }
}

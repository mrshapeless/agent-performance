import {LocalInferenceStore} from '../src/local-inference-store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from '../src/postgres.mjs';
import {enqueueInference,claimInference,returnInference,workerAuthorized,LocalInference} from '../src/local-inference.mjs';
import {createLocalWorkerHandler} from '../api/local-worker.mjs';
import {cloudRun} from '../src/cloud.mjs';
async function fixture(t){const db=new PGlite();t.after(()=>db.close());await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));const client={query:async(s,a)=>{const r=await db.query(s,a);return {...r,rowCount:r.affectedRows||r.rows.length};},release(){}};return new PostgresStore({query:client.query,connect:async()=>client});}
const input={system:'Synthetic system',prompt:'Synthetic prompt',schema:null,media:[],operationId:null};
test('durable inference deduplicates and fences stale workers',async t=>{
 const s=await fixture(t),id=await enqueueInference(s,input);assert.equal(await enqueueInference(s,input),id);
 const first=await claimInference(s);assert.equal(first.id,id);assert.equal(await claimInference(s),null);
 await s.pool.query("UPDATE agent_local_inference SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
 const second=await claimInference(s);assert.notEqual(first.leaseToken,second.leaseToken);
 const result={value:{answer:'test'},costMicrodollars:0};
 await assert.rejects(returnInference(s,{id,leaseToken:first.leaseToken,result}),/STALE_LEASE/);
 assert.equal((await returnInference(s,{id,leaseToken:second.leaseToken,result})).replay,false);
 assert.equal((await returnInference(s,{id,leaseToken:second.leaseToken,result})).replay,true);
 await assert.rejects(returnInference(s,{id,leaseToken:second.leaseToken,result:{value:{answer:'different'},costMicrodollars:0}}),/RESULT_CONFLICT/);
 assert.equal(await claimInference(s),null);
 const provider=new LocalInference(s);assert.deepEqual(await provider.generate(input.system,input.prompt),result);
});
test('only owned inference resumes; unknown publication remains pending',async t=>{
 const base=await fixture(t),s=new LocalInferenceStore(base.pool);
 await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status) VALUES('planner-test','step',current_date,0,'pending'),('x-publish-test','step',current_date,0,'pending')");
 await enqueueInference(s,{...input,operationId:'planner-test'},'planner-test');
 assert.equal(await s.operation('planner-test'),null);
 assert.equal((await s.operation('x-publish-test')).status,'pending');
 await assert.rejects(s.complete('planner-test',0,{action:'failure'}),/LOCAL_INFERENCE_PENDING/);
 const resume=await s.begin('planner-test','step',()=>assert.fail());assert.equal(resume.replay,false);assert.equal(resume.prompt,input.prompt);
 const claimed=await claimInference(s);await returnInference(s,{id:claimed.id,leaseToken:claimed.leaseToken,result:{value:{answer:'ok'},costMicrodollars:0}});
 await s.complete('planner-test',0,{action:'draft_text',text:'synthetic'});
 assert.equal((await s.operation('planner-test')).status,'complete');
 assert.equal((await s.operation('x-publish-test')).status,'pending');
});
test('worker endpoint authenticates before touching private state',async()=>{
 const token='x'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
 assert.equal(workerAuthorized('Bearer '+token,hash),true);assert.equal(workerAuthorized('Bearer '+token+'x',hash),false);
 const handler=createLocalWorkerHandler({LOCAL_WORKER_TOKEN_SHA256:hash},()=>assert.fail('No store access'));
 assert.equal((await handler(new Request('https://example.test/api/local-worker',{method:'POST',body:'{"action":"claim"}'}))).status,401);
 assert.equal((await handler(new Request('https://example.test/api/local-worker',{headers:{Authorization:'Bearer '+token}}))).status,405);
});
test('request timeout resumes saved inference after restart without repeating generation',async t=>{
 const base=await fixture(t),s=new LocalInferenceStore(base.pool),provider=new LocalInference(s,{timeoutMs:1,pollMs:1});
 await assert.rejects(cloudRun(s,provider,'birth','local-birth'),/LOCAL_INFERENCE_PENDING/);
 const job=await claimInference(s);assert.ok(job);
 const value={name:'Synthetic',voice:'Test voice',interests:'Test interests',visualDirection:'Test visual',summary:'Synthetic fixture only'};
 await returnInference(s,{id:job.id,leaseToken:job.leaseToken,result:{value,costMicrodollars:0}});
 const restarted=new LocalInferenceStore(base.pool);
 const result=await cloudRun(restarted,new LocalInference(restarted),'birth','local-birth');
 assert.equal(result.status,'complete');assert.equal(await claimInference(s),null);
 assert.equal((await cloudRun(restarted,new LocalInference(restarted),'birth','local-birth')).replay,true);
});

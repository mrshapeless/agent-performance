import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from './postgres.mjs';
import {CREATIVE_REVISION,stampCreativePlan,isCurrentCreativePlan,reconcileCreativeRevision} from './creative-revision.mjs';
import {enqueueMedia,mediaStep,readyMedia} from './media.mjs';
async function fixture() {
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 return {db,s:new PostgresStore({query:c.query,connect:async()=>c})};
}
async function job(s,id,state='queued',plan={},data={}) {await s.pool.query('INSERT INTO agent_media_jobs(id,plan_id,state,plan,data) VALUES($1,$2,$3,$4,$5)',[id,`x-plan-${id}`,state,JSON.stringify(plan),JSON.stringify(data)]);}
async function op(s,id,status='complete',result={}) {await s.pool.query("INSERT INTO agent_operations(id,kind,day,amount,status,result) VALUES($1,'step',CURRENT_DATE,123,$2,$3)",[id,status,JSON.stringify(result)]);}
const get=async(s,id)=>(await s.pool.query('SELECT * FROM agent_media_jobs WHERE id=$1',[id])).rows[0];

test('revision preserves paid artifacts and ledger, supersedes unpaid legacy intent, and is idempotent',async()=>{
 const {s,db}=await fixture();try{
 await job(s,'unpaid');await job(s,'paid','rendered',{}, {assetId:'paid-render'});await op(s,'paid-render');
 await s.pool.query("INSERT INTO agent_assets(id,mime,bytes) VALUES('paid-render','image/png',$1)",[Buffer.from('fixture')]);
 await job(s,'fresh','queued',stampCreativePlan({medium:'image'}));await job(s,'public','published');
 const r=await reconcileCreativeRevision(s);assert.deepEqual(r.superseded,['unpaid']);assert.deepEqual(r.held,['paid']);
 assert.equal((await get(s,'fresh')).state,'queued');assert.equal((await get(s,'public')).state,'published');
 assert.equal((await s.operation('paid-render')).status,'complete');assert.equal((await s.asset('paid-render')).mime,'image/png');
 assert.equal((await get(s,'paid')).data.assetId,'paid-render');assert.equal((await get(s,'paid')).data.creativeRevisionHold.previousState,'rendered');
 const again=await reconcileCreativeRevision(s);assert.equal(again.held.length+again.superseded.length,0);
 assert.equal(isCurrentCreativePlan({}),false);assert.equal(isCurrentCreativePlan(stampCreativePlan({})),true);assert.equal(stampCreativePlan({}).creativeRevision,CREATIVE_REVISION);
 }finally{await db.close()}
});
test('uncertain writes, live leases and external predictions settle before being reconsidered',async()=>{
 const {s,db}=await fixture();try{
 await job(s,'unknown');await op(s,'media-unknown-render','pending');
 // The operation identity follows the media job identity in production.
 await s.pool.query("UPDATE agent_media_jobs SET id='media-unknown' WHERE id='unknown'");
 await job(s,'posting','ready');await op(s,'x-publish-posting','pending');
 await job(s,'leased');await s.pool.query("UPDATE agent_media_jobs SET lease_until=now()+interval '10 minutes' WHERE id='leased'");
 await job(s,'video','processing',{}, {predictionId:'provider-prediction'});
 await job(s,'recover');await op(s,'recover-render','complete',{predictionId:'provider-prediction'});
 const r=await reconcileCreativeRevision(s);assert.equal(r.deferred.length,5);assert.equal(r.held.length+r.superseded.length,0);
 await s.pool.query("UPDATE agent_media_jobs SET state='rendered',data=data || '{\"assetId\":\"archived\"}' WHERE id='video'");
 assert.deepEqual((await reconcileCreativeRevision(s)).held,['video']);
 assert.equal((await s.operation('media-unknown-render')).status,'pending');assert.equal((await s.operation('x-publish-posting')).status,'pending');
 }finally{await db.close()}
});
test('old commissioned intentions become reconsiderable once; new choices and originals are preserved',async()=>{
 const {s,db}=await fixture();try{
 await s.pool.query("INSERT INTO agent_goals(id,status,objective,why,success) VALUES('g','active','old objective','old why','old success')");
 await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step,goal_id) VALUES('task','p','commissioned','old objective','original next step','g')");
 const first=await reconcileCreativeRevision(s);assert.deepEqual(first.tasks,['task']);
 let row=(await s.pool.query("SELECT * FROM agent_agenda WHERE id='task'")).rows[0];assert.equal(row.status,'active');assert.equal(row.version,2);
 assert.equal((await s.pool.query("SELECT status FROM agent_goals WHERE id='g'")).rows[0].status,'paused');
 const snapshot=(await s.pool.query("SELECT payload FROM agent_events WHERE kind='creative_revision_internal' ORDER BY seq LIMIT 1")).rows[0];assert.match(snapshot.payload,/original next step/);
 await s.pool.query("UPDATE agent_agenda SET status='commissioned',next_step='Fresh autonomous choice',version=version+1 WHERE id='task'");
 await reconcileCreativeRevision(s);row=(await s.pool.query("SELECT * FROM agent_agenda WHERE id='task'")).rows[0];assert.equal(row.status,'commissioned');assert.equal(row.next_step,'Fresh autonomous choice');
 }finally{await db.close()}
});
test('production worker archives an old paid video but cannot review, upload, or publish it',async()=>{
 const {s,db}=await fixture();try{
 await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic artist'});
 await job(s,'old-film','processing',{medium:'video',alt:'Prior film',summary:'Prior intent'},{predictionId:'prediction'});
 let archived=0;
 const services={videoStatus:async()=>({status:'succeeded',output:'synthetic'}),archiveVideo:async()=>{archived++;return {mime:'video/mp4',url:'https://synthetic.public.blob.vercel-storage.com/archived.mp4'};}};
 const provider={quote:()=>{throw Error('STALE_REVIEW_CALLED');},generate:()=>{throw Error('STALE_GENERATION_CALLED');}};
 const x=()=>{throw Error('STALE_X_CALLED');};
 assert.equal((await mediaStep(s,provider,{X_ENABLED:'true'},services,x)).status,'video_archived');
 assert.equal((await mediaStep(s,provider,{X_ENABLED:'true'},services,x)).status,'no_media_jobs');
 assert.equal(archived,1);assert.equal((await get(s,'old-film')).state,'reconsideration');
 assert.equal((await s.asset('old-film-archive')).mime,'video/mp4');assert.equal(await readyMedia(s),null);
 await assert.rejects(enqueueMedia(s,'x-plan-stale',{}),/CREATIVE_PLAN_STALE/);
 }finally{await db.close()}
});

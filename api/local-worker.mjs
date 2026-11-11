import pg from 'pg';
import {scopedPool} from '../src/instance.mjs';
import {PostgresStore} from '../src/postgres.mjs';
import {workerAuthorized,claimInference,returnInference} from '../src/local-inference.mjs';
export function createLocalWorkerHandler(env,openStore){return async request=>{
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!workerAuthorized(request.headers.get('authorization'),env.LOCAL_WORKER_TOKEN_SHA256))return reply({error:'UNAUTHORIZED'},401);
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(Number(request.headers.get('content-length'))>2_100_000)return reply({error:'TOO_LARGE'},413);
 let store;
 try{
  const raw=await request.text();if(raw.length>2_100_000)return reply({error:'TOO_LARGE'},413);
  const input=JSON.parse(raw);store=await openStore();
  if(input.action==='claim')return reply({job:await claimInference(store)});
  if(input.action==='return')return reply(await returnInference(store,input));
  return reply({error:'INVALID_ACTION'},400);
 }catch(e){return reply({error:['STALE_LEASE','RESULT_CONFLICT','UNKNOWN_LOCAL_JOB','INVALID_LOCAL_RESULT'].includes(e.message)?e.message:'LOCAL_WORKER_FAILED'},409);}
 finally{await store?.close?.();}
};}
export default {fetch:createLocalWorkerHandler(process.env,async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});
 const store=new PostgresStore(scopedPool(pool));store.close=()=>pool.end();return store;
})};

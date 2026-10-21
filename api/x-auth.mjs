import pg from 'pg';
import {scopedPool,instanceEnv} from '../instance.mjs';
import {PostgresStore} from '../postgres.mjs';
import {oauthRoute} from '../oauth.mjs';
export default {async fetch(request){
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});
 try{return await oauthRoute(request,new PostgresStore(scopedPool(pool)),instanceEnv(process.env));}
 catch{return Response.json({error:'X_CONNECTION_FAILED'},{status:503,headers:{'Cache-Control':'no-store'}});}
 finally{await pool.end();}
}};

// A new generation has no access to its predecessor's memory or credentials.
export const ACTIVE_INSTANCE = 'generation_02';
export function scopedSQL(sql, instance = ACTIVE_INSTANCE) {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(instance)) throw Error('INVALID_INSTANCE');
  return sql.replace(/\bagent_(events|operations|assets|oauth_states|oauth_tokens|inbox|optouts|media_jobs)\b/g, name => `"${instance}".${name}`);
}
export function scopedPool(pool,instance=ACTIVE_INSTANCE) {
  return {query:(sql,args)=>pool.query(scopedSQL(sql,instance),args),connect:async()=>{
    const client=await pool.connect();return {query:(sql,args)=>client.query(scopedSQL(sql,instance),args),release:()=>client.release()};
  }};
}
export function instanceEnv(env){
  if(env.X_ACCOUNT_INSTANCE===ACTIVE_INSTANCE)return env;
  if(env.X_CLIENT_ID&&env.X_CLIENT_SECRET)return {...env,X_API_KEY:undefined,X_API_SECRET:undefined,X_ACCESS_TOKEN:undefined,X_ACCESS_TOKEN_SECRET:undefined};
  return {...env,X_ENABLED:'false',X_API_KEY:undefined,X_API_SECRET:undefined,X_ACCESS_TOKEN:undefined,X_ACCESS_TOKEN_SECRET:undefined,X_EXPECTED_USERNAME:undefined};
}

import {oauthAccess} from './oauth.mjs';
export function xClient(store,env){return new XClient(env,fetch,env.X_CLIENT_ID&&env.X_CLIENT_SECRET?rejected=>oauthAccess(store,env,fetch,rejected):null)}
import { createHmac, randomBytes } from 'node:crypto';
const enc = value => encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function signOAuth(method, url, env, nonce=randomBytes(16).toString('hex'), timestamp=Math.floor(Date.now()/1000)) {
  const u=new URL(url);const oauth={oauth_consumer_key:env.X_API_KEY,oauth_nonce:nonce,oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(timestamp),oauth_token:env.X_ACCESS_TOKEN,oauth_version:'1.0'};
  const pairs=[...u.searchParams,...Object.entries(oauth)].map(([k,v])=>[enc(k),enc(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
  const base=[method.toUpperCase(),enc(u.origin+u.pathname),enc(pairs.map(p=>p.join('=')).join('&'))].join('&');
  oauth.oauth_signature=createHmac('sha1',enc(env.X_API_SECRET)+'&'+enc(env.X_ACCESS_TOKEN_SECRET)).update(base).digest('base64');
  return 'OAuth '+Object.entries(oauth).sort().map(([k,v])=>`${enc(k)}="${enc(v)}"`).join(', ');
}
export class XClient {
  constructor(env,fetcher=fetch,bearer=null){this.bearer=bearer;this.env=env;this.fetcher=fetcher;for(const k of (bearer?['X_EXPECTED_USERNAME']:['X_API_KEY','X_API_SECRET','X_ACCESS_TOKEN','X_ACCESS_TOKEN_SECRET','X_EXPECTED_USERNAME']))if(!env[k])throw Error('X_NOT_CONFIGURED');}
  async request(method,path,body){
    const url='https://api.x.com'+path;
    let access=this.bearer?await this.bearer():null;
    for(let attempt=0;attempt<2;attempt++){
      const r=await this.fetcher(url,{method,headers:{authorization:this.bearer?'Bearer '+access:signOAuth(method,url,this.env),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
      // An explicit 401 rejects the request. Never retry timeout or an ambiguous write.
      if(r.status===401&&this.bearer&&attempt===0){access=await this.bearer(access);continue;}
      if(!r.ok){const error=Error('X_HTTP_'+r.status);error.phase=method==='GET'?'verify':'publish';error.status=r.status;throw error;}
      return r.json();
    }
  }
  async verify(){const r=await this.request('GET','/2/users/me');if(r.data?.username?.toLowerCase()!==this.env.X_EXPECTED_USERNAME.replace(/^@/,'').toLowerCase())throw Error('X_ACCOUNT_MISMATCH');return r.data;}
  async post(text){if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text,'utf8')>280)throw Error('X_INVALID_TEXT');await this.verify();const r=await this.request('POST','/2/tweets',{text});if(!/^\d+$/.test(r.data?.id??''))throw Error('X_UNCERTAIN_RESULT');return {id:r.data.id,url:'https://x.com/i/web/status/'+r.data.id};}
}

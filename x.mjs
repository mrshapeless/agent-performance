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
      if(method==='GET' && [429,502,503,504].includes(r.status) && attempt===0){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
      if(!r.ok){const error=Error('X_HTTP_'+r.status);error.phase=method==='GET'?'verify':'publish';error.status=r.status;throw error;}
      if(r.status===204)return {};
      const raw=await r.text();return raw?JSON.parse(raw):{};
    }
  }
  async verify(){const r=await this.request('GET','/2/users/me');if(r.data?.username?.toLowerCase()!==this.env.X_EXPECTED_USERNAME.replace(/^@/,'').toLowerCase())throw Error('X_ACCOUNT_MISMATCH');return r.data;}
  async recentPosts(start){
    const account=await this.verify();
    if(!/^\d+$/.test(account.id??''))throw Error('X_INVALID_ACCOUNT');
    const query=new URLSearchParams({max_results:'100',start_time:new Date(start).toISOString().replace('.000Z','Z'),'tweet.fields':'created_at,referenced_tweets,attachments'});
    const result=await this.request('GET','/2/users/'+account.id+'/tweets?'+query);
    if(result.errors?.length || result.meta?.next_token || !Number.isInteger(result.meta?.result_count) || (result.data && !Array.isArray(result.data)))throw Error('X_RECONCILIATION_INCOMPLETE');
    const posts=result.data??[];
    if(posts.length!==result.meta.result_count || posts.some(p=>!/^\d+$/.test(p.id??'')||typeof p.text!=='string'))throw Error('X_RECONCILIATION_INCOMPLETE');
    return posts;
  }
  async initMedia(asset){const r=await this.request('POST','/2/media/upload/initialize',{total_bytes:asset.bytes.length,media_type:asset.mime,media_category:asset.mime==='video/mp4'?'tweet_video':'tweet_image'});if(!/^\d+$/.test(r.data?.id??''))throw Error('X_INVALID_MEDIA_ID');return r.data;}
  appendMedia(id,segment,bytes){if(!/^\d+$/.test(id))throw Error('X_INVALID_MEDIA_ID');return this.request('POST',`/2/media/upload/${id}/append`,{segment_index:segment,media:Buffer.from(bytes).toString('base64')});}
  finalizeMedia(id){if(!/^\d+$/.test(id))throw Error('X_INVALID_MEDIA_ID');return this.request('POST',`/2/media/upload/${id}/finalize`,{});}
  async mediaStatus(id){if(!/^\d+$/.test(id))throw Error('X_INVALID_MEDIA_ID');const r=await this.request('GET','/2/media/upload?command=STATUS&media_id='+id);if(!r.data||r.errors?.length)throw Error('X_INVALID_MEDIA_STATUS');return r.data;}
  async post(text,replyTo=null,mediaId=null){if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text,'utf8')>280)throw Error('X_INVALID_TEXT');if(mediaId&&!/^\d+$/.test(mediaId))throw Error('X_INVALID_MEDIA_ID');try{await this.verify();}catch(error){error.phase='verify';throw error;}const r=await this.request('POST','/2/tweets',{text,...(replyTo?{reply:{in_reply_to_tweet_id:replyTo}}:{}),...(mediaId?{media:{media_ids:[mediaId]}}:{})});if(!/^\d+$/.test(r.data?.id??''))throw Error('X_UNCERTAIN_RESULT');return {id:r.data.id,url:'https://x.com/i/web/status/'+r.data.id};}
}

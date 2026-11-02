import {xClient} from './x.mjs';

// Explicit operator action only. Following timeline; never writes to X.
export async function syncHomeTimeline(store,env,older=false,makeClient=xClient,now=new Date()){
 if(env.X_ENABLED!=='true')return {status:'x_disabled'};
 const old=(await store.pool.query("SELECT data FROM agent_reply_sync WHERE id='home-timeline'")).rows[0]?.data??{};
 if(older&&!old.next)return {status:'end_of_timeline',count:0};
 const id='home-read-'+Math.floor(+now/60000);
 const op=await store.begin(id,'step',()=>({maximum:0}));
 if(op.replay)return op.result??{status:'read_in_progress'};
 try{
  const x=makeClient(store,env),me=await x.verify();
  const params=new URLSearchParams({max_results:'20',exclude:'retweets','tweet.fields':'author_id,created_at,attachments,referenced_tweets',expansions:'author_id','user.fields':'username,name'});
  if(older)params.set('pagination_token',old.next);
  const r=await x.request('GET','/2/users/'+me.id+'/timelines/reverse_chronological?'+params);
  if(r.errors?.length||!Array.isArray(r.data??[]))throw Error('X_PARTIAL_TIMELINE');
  const users=new Map((r.includes?.users??[]).map(u=>[u.id,u]));let count=0;
  await store.transaction(async c=>{
   for(const t of r.data??[]){
    if(!/^\d{1,30}$/.test(t.id??'')||!/^\d+$/.test(t.author_id??'')||t.author_id===me.id||typeof t.text!=='string')continue;
    const metadata={source:'home',postId:t.id,username:users.get(t.author_id)?.username,created:t.created_at,hasMedia:!!t.attachments?.media_keys?.length};
    const inserted=await c.query("INSERT INTO agent_inbox(id,platform,author,text,status,metadata) VALUES($1,'x_home',$2,$3,'ignored',$4) ON CONFLICT DO NOTHING RETURNING id",['x-'+t.id,'x:'+t.author_id,t.text.slice(0,3000),JSON.stringify(metadata)]);
    if(inserted.rows.length){await c.query("INSERT INTO agent_manual_replies(inbox_id,state) VALUES($1,'new') ON CONFLICT DO NOTHING",['x-'+t.id]);count++;}
   }
   await c.query("INSERT INTO agent_reply_sync(id,data,updated,error) VALUES('home-timeline',$1,$2,NULL) ON CONFLICT(id) DO UPDATE SET data=$1,updated=$2,error=NULL",[JSON.stringify({next:r.meta?.next_token??null}),now.toISOString()]);
  });
  const result={action:'private_home_sync',status:'synced',count,more:!!r.meta?.next_token};await store.complete(id,0,result);return result;
 }catch(e){const error=/^X_[A-Z_0-9]+$/.test(e.message)?e.message:'HOME_READ_UNAVAILABLE';const result={action:'private_home_sync',status:'failed',error};await store.complete(id,0,result);return result;}
}

let replyOffset=0,replyLoading=false,replyDirty=false;
async function replyAPI(body){
 const r=await fetch('/api/manual-replies',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});
 const d=await r.json();if(!r.ok){if(r.status===401)lock();throw Error(d.error||'Unable to update reply');}return d;
}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function replyCard(item){
 const card=el('article',undefined,'reply-card'),left=el('div'),right=el('div'),status=el('span',item.state.toUpperCase(),'reply-status');
 const postId=item.metadata.postId??item.inbox_id.slice(2);
 left.append(status,el('h3',item.metadata.username?'@'+item.metadata.username:item.author),el('p',item.text));
 if(item.metadata.rootText)left.append(el('p','Original post: '+item.metadata.rootText,'reply-context'));
 if(item.metadata.parentText)left.append(el('p','In reply to: '+item.metadata.parentText,'reply-context'));
 if(item.metadata.hasMedia)left.append(el('p','Contains media. Open in X before replying; the draft uses text only.','reply-context'));
 const link=el('a','View post in X ↗');link.href='https://x.com/i/web/status/'+encodeURIComponent(postId);link.target='_blank';link.rel='noopener noreferrer';left.append(link);
 const date=el('p',new Date(item.metadata.created??item.created).toLocaleString(),'mono dim');left.append(date);
 const label=el('label','REPLY DRAFT'),input=el('textarea');input.value=item.draft;input.setAttribute('aria-label','Draft reply to '+(item.metadata.username??item.author));
 const counter=el('p','','reply-counter'),actions=el('div',undefined,'actions'),reason=el('p',item.reason,'mono dim'),feedback=el('p','','mono');
 const closed=['sent','skipped'].includes(item.state);input.disabled=closed;
 function length(){counter.textContent=[...input.value].length+' / 280 characters';}length();input.oninput=()=>{length();replyDirty=true;};
 function button(name,action){const b=el('button',name);b.type='button';b.disabled=closed;b.onclick=async()=>{
  if(!secret)return;
  if(['save','open','sent'].includes(action)&&(!input.value.trim()||[...input.value].length>280)){feedback.textContent='Use 1–280 characters.';return;}
  if(action==='generate'&&input.value.trim()&&!confirm('Replace this draft with a newly generated version?'))return;
  if(action==='sent'&&!confirm('Have you sent this reply in X? This marks it answered; it does not send anything.'))return;
  // Create the tab synchronously to avoid popup blocking; navigate only after saving.
  const tab=action==='open'?window.open('about:blank','_blank'):null;if(tab)tab.opener=null;
  for(const c of actions.children)c.disabled=true;feedback.textContent=action==='generate'?'Preparing a private draft…':'Saving…';
  try{const d=await replyAPI({id:item.inbox_id,version:item.version,action,text:input.value});
   if(d.item){item={...item,...d.item};status.textContent=item.state.toUpperCase();replyDirty=false;}
   if(action==='open'){if(d.url&&new URL(d.url).origin==='https://x.com'){if(tab)tab.location=d.url;else{const a=el('a','Open prepared reply in X ↗');a.href=d.url;a.target='_blank';a.rel='noopener noreferrer';feedback.replaceChildren(a);return;}}feedback.textContent='Opened in X. Check the account and reply target, then send manually.';}
   else if(action==='generate'){replyDirty=false;await loadReplies();}
   else feedback.textContent=action==='sent'?'Marked answered by you. No API reply was sent.':action==='skip'?'Skipped.':'Draft saved.';
  }catch(e){if(tab)tab.close();feedback.textContent=e.message;}
  finally{for(const c of actions.children)c.disabled=['sent','skipped'].includes(item.state);input.disabled=['sent','skipped'].includes(item.state);}
 };actions.append(b);}
 button(item.draft?'Regenerate':'Prepare draft','generate');button('Save','save');button('Open reply in X ↗','open');
 const copy=el('button','Copy');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(input.value);feedback.textContent='Copied. Paste into the reply box in X.';}catch{input.focus();input.select();feedback.textContent='Select and copy the draft manually.';}};actions.append(copy);
 button('Mark answered','sent');button('Skip','skip');right.append(label,input,counter,actions,reason,feedback);card.append(left,right);return card;
}
async function loadReplies(more=false){
 if(replyLoading||!secret)return;
 if(replyDirty&&!confirm('Refresh and discard unsaved draft edits?'))return;
 replyLoading=true;$('replyRefresh').disabled=true;$('replyNotice').textContent='Loading private inbox…';
 const session=secret;
 try{const offset=more?replyOffset:0;const r=await fetch('/api/manual-replies?'+new URLSearchParams({source:$('replySource').value,filter:$('replyFilter').value,offset:String(offset)}),{headers:{Authorization:'Bearer '+secret},cache:'no-store'});const d=await r.json();if(!r.ok){if(r.status===401)lock();throw Error(d.error||'Unable to load inbox');}if(secret!==session)return;
  if(!more)$('replyItems').replaceChildren();for(const item of d.items)$('replyItems').append(replyCard(item));replyOffset=offset+d.items.length;replyDirty=false;
  $('replyMore').hidden=!d.more;
  const home=$('replySource').value==='home';$('homeSync').hidden=!home;$('homeOlder').hidden=!home;const homeState=d.sync.find(s=>s.id==='home-timeline');$('homeOlder').disabled=!homeState?.data?.next;const latest=home?homeState:d.sync.find(s=>s.id!=='home-timeline');$('replySync').textContent='Send from @'+d.account.replace(/^@/,'')+' · Automatic replies OFF · Mentions: '+(d.mentionsAt?new Date(d.mentionsAt).toLocaleString():'not synced')+' · Last source fetch: '+(latest?new Date(latest.updated).toLocaleString():'not yet run');
  const errors=[...d.mentionErrors,...d.sync.filter(s=>s.error).map(s=>s.error)];$('replyNotice').textContent=(d.items.length?'Drafts stay private. Review before sending.':'No comments in this view yet.')+(errors.length?' Sync warnings: '+[...new Set(errors)].join('; '):'');
 }catch(e){$('replyNotice').textContent=e.message;}finally{replyLoading=false;$('replyRefresh').disabled=false;}
}
$('replyRefresh').onclick=()=>loadReplies();$('replyMore').onclick=()=>loadReplies(true);$('replyFilter').onchange=()=>loadReplies();
window.addEventListener('beforeunload',e=>{if(replyDirty){e.preventDefault();e.returnValue='';}});

$('replySource').onchange=()=>loadReplies();
async function fetchHome(older=false){if(replyLoading||!secret)return;replyLoading=true;$('homeSync').disabled=true;$('homeOlder').disabled=true;try{const d=await replyAPI({action:'sync_home',older});if(d.error)throw Error(d.error);replyLoading=false;await loadReplies();$('replyNotice').textContent=d.status==='synced'?'Fetched '+d.count+' new posts. Choose Prepare draft on a post.':d.status;}catch(e){$('replyNotice').textContent='Home fetch: '+e.message;}finally{replyLoading=false;$('homeSync').disabled=false;}}
$('homeSync').onclick=()=>fetchHome();$('homeOlder').onclick=()=>fetchHome(true);

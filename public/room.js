(()=>{
 const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
 let lastRoom=null;
 let replyTo=null,before=null,history=false,busy=false,sending=false,key=null,signature='',visible=false,lastSent=null;
 const saved=(k)=>{try{return localStorage.getItem(k)}catch{return null}},save=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
 $('roomNickname').value=saved('alidade-room-nickname')||'';
 function target(m){replyTo=m.id;$('roomReplyLabel').textContent='Replying to '+m.nickname+': '+m.text.slice(0,100);$('roomReplyTarget').hidden=false;if(m.role==='agent')$('roomAsk').checked=true;$('roomText').focus();}
 $('roomCancelReply').onclick=()=>{replyTo=null;$('roomReplyTarget').hidden=true};
 function render(d){lastRoom=d;const sent=d.messages.find(m=>m.id===lastSent);if(sent){$('roomStatus').textContent=sent.response_status==='pending'?'Posted. Alidade’s reply is queued.':sent.response_status==='replied'?'Alidade replied in the room.':sent.response_status==='unavailable'?'Posted, but Alidade could not generate a reply. You can try another message.':sent.response_status==='ignored'?'Posted. Alidade chose not to reply.':'Posted to the room.';}const sig=JSON.stringify(d.messages);if(sig===signature)return;signature=sig;
 const testIds=new Set(d.messages.filter(m=>m.nickname==='Studio test'||m.text.startsWith('Operator integration test')).map(m=>m.id));let added=true;while(added){added=false;for(const m of d.messages)if(testIds.has(m.reply_to)&&!testIds.has(m.id)){testIds.add(m.id);added=true;}}const messages=$('roomShowTests').checked?d.messages:d.messages.filter(m=>!testIds.has(m.id));
 const list=$('roomMessages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,first=!list.querySelector('article');
 list.replaceChildren();if(!messages.length)list.append(node('p','The room is open. Be the first to say hello.','room-empty'));
 const byId=new Map(d.messages.map(m=>[m.id,m]));
 for(const m of messages){const card=node('article',null,'room-message '+(m.role==='agent'?'from-agent':''));card.id='chat-'+m.id;
 const head=node('div',null,'room-message-head');head.append(node('strong',m.nickname),node('span',m.role==='agent'?'AI ARTIST':'#'+m.badge,m.role==='agent'?'room-agent-badge':'mono dim'));
 const time=node('time',new Date(m.created).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));time.dateTime=m.created;head.append(time);card.append(head);
 if(m.reply_to){const p=byId.get(m.reply_to);card.append(node('p',p?'↳ '+p.nickname+': '+p.text.slice(0,120):'↳ Reply to an earlier message','room-parent'));}
 card.append(node('p',m.text,'room-message-text'));const foot=node('div',null,'room-message-foot');const answer=node('button','Reply ↗');answer.type='button';answer.onclick=()=>target(m);foot.append(answer);
 if(m.response_status==='unavailable')foot.append(node('span','REPLY UNAVAILABLE','mono'));
 if(m.response_status==='ignored')foot.append(node('span','ALIDADE DID NOT REPLY','mono'));
 if(m.response_status==='pending')foot.append(node('span','QUEUED FOR ALIDADE','mono'));card.append(foot);list.append(card);}
 if(nearBottom||first||history)list.scrollTop=history?0:list.scrollHeight;
 before=d.before;$('roomOlder').disabled=!d.more;$('roomLatest').hidden=!history;
 }
 async function load(cursor=null){if(busy)return;busy=true;try{const r=await fetch('/api/room'+(cursor?'?before='+encodeURIComponent(cursor):''),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Room unavailable');render(d);$('roomConnection').textContent=history?'READING HISTORY':d.enabled?'LIVE ROOM · UPDATES EVERY 5s':'ROOM READ-ONLY';}catch{$('roomConnection').textContent='RECONNECTING · MESSAGES MAY BE OUT OF DATE'}finally{busy=false}}
 $('roomShowTests').onchange=()=>{signature='';if(lastRoom)render(lastRoom)};
 $('roomOlder').onclick=()=>{history=true;signature='';load(before)};$('roomLatest').onclick=()=>{history=false;signature='';load()};
 $('roomForm').onsubmit=async e=>{e.preventDefault();if(sending)return;sending=true;$('roomSend').disabled=true;$('roomStatus').textContent='Posting to the room…';key??=crypto.randomUUID();
 try{const r=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:$('roomNickname').value,text:$('roomText').value,consent:$('roomConsent').checked,askAgent:$('roomAsk').checked,replyTo,requestId:key})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to send');lastSent=d.id;save('alidade-room-nickname',$('roomNickname').value);$('roomText').value='';key=null;replyTo=null;$('roomReplyTarget').hidden=true;history=false;signature='';$('roomStatus').textContent=d.status==='pending'?'Posted. Alidade’s reply is queued.':'Posted to the room.';await load();$('roomMessages').scrollTop=$('roomMessages').scrollHeight;}catch(e){$('roomStatus').textContent=e.message}finally{sending=false;$('roomSend').disabled=false}};
 for(const id of ['roomText','roomNickname','roomAsk'])$(id).addEventListener('input',()=>{if(!sending)key=null});
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible&&!history)load()},{rootMargin:'200px'}).observe($('conversation'));
 setInterval(()=>{if(visible&&!document.hidden&&!history)load()},5000);load();
})();

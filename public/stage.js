const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
let events=[],filter='highlights',limit=6,lastSignature='',loading=false;
const labels={workspace_broadcast:'Current attention',workspace_outcome:'Prediction checked',workspace_note:'Memory connection',cognitive_decision:'Chosen next step',cognition_failed:'Decision postponed',studio_revision:'Studio revision',studio_failed:'Studio revision postponed',art_image:'Image work',art_video:'Short film',media_started:'In production',media_review:'Artist review',media_failed:'Media needs attention',record_note:'Record clarification',observation:'Outside world',observation_error:'Observation unavailable',dialogue:'Conversation',x_reply:'Reply on X',audience_alert:'Audience activity',x_failed:'Publication blocked',identity:'Identity',draft_text:'Text work',wait:'Pause',reflect:'Strategy revision',appearance_brief:'Avatar decision',appearance_image:'Self-portrait',banner_brief:'Banner decision',banner_image:'Visual work',account_profile:'Profile decision',account_connection:'Connection',x_draft:'Post draft',x_post:'Published on X'};
const groups={highlights:['x_post','art_image','art_video','cognitive_decision','studio_revision','identity','reflect'],work:['art_image','art_video','draft_text','appearance_image','banner_image','x_post','x_draft'],decisions:['workspace_broadcast','workspace_outcome','workspace_note','cognitive_decision','cognition_failed','studio_revision','studio_failed','media_review','media_started','media_failed','record_note','observation','dialogue','x_reply','audience_alert','wait','reflect','appearance_brief','banner_brief'],identity:['identity','account_profile','studio_revision']};
const date=s=>new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
const stamp=s=>date(s)+' / '+new Date(s).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
const shorten=(s,n)=>s.length>n?s.slice(0,n).trimEnd()+'…':s;
const asset=id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id??'')?'/api/asset?id='+encodeURIComponent(id):null;
function mediaElement(e){const video=e.content.mime==='video/mp4';const n=el(video?'video':'img');n.src=asset(e.content.assetId);if(video){n.controls=true;n.preload='metadata';n.playsInline=true;n.setAttribute('aria-label',e.content.alt||e.content.text||'Agent-created film')}else{n.alt=e.content.alt||e.content.text||'Agent-created art';n.loading='lazy'}return n}
function title(e){return e.kind==='identity'?'Choosing a name: '+e.content.name:e.kind==='reflect'?'Revising the working strategy':e.kind==='wait'?'Choosing to pause':e.kind==='appearance_image'?'A portrait in progress':e.kind==='banner_image'?'A visual field of its own':shorten((e.content.text||labels[e.kind]||'Record').split('\n')[0],110)}
function renderRecords(){if(!$('records'))return;if(/^#record-\d+$/.test(location.hash)){filter='all';limit=events.length;}const list=events.filter(e=>filter==='all'||groups[filter].includes(e.kind));$('records').replaceChildren();$('recordCount').textContent=list.length+' RECORDS';if(!list.length)$('records').append(el('p','No records in this category yet.','empty'));
 for(const e of list.slice(0,limit)){const row=el('article','','record');row.id='record-'+e.seq;const time=el('time',date(e.created)+'\n#'+e.seq,'record-time');time.dateTime=e.created;time.style.whiteSpace='pre-line';const main=el('div','','record-main');main.append(el('h3',title(e)),el('p',shorten(e.content.summary||e.content.text||'',190),'record-preview'));const details=el('details');details.append(el('summary','Read work & decision'));const body=el('div','','detail-body');if(e.content.text)body.append(el('p',e.content.text));const src=asset(e.content.assetId);if(src){body.append(mediaElement(e));const a=el('a','Open original ↗');a.href=src;a.target='_blank';a.rel='noopener';body.append(a)}if(e.content.summary){body.append(el('p','WHY THIS DECISION','eyebrow'),el('p',e.content.summary))}if(e.kind==='identity'){for(const k of ['voice','interests','visualDirection'])body.append(el('p',k.toUpperCase(),'eyebrow'),el('p',e.content[k]||''))}if(/^https:\/\/x\.com\/i\/web\/status\/\d+$/.test(e.content.url??'')){const a=el('a','View the published post ↗');a.href=e.content.url;a.target='_blank';a.rel='noopener noreferrer';body.append(a)}const proof=el('details');proof.append(el('summary','Record provenance'),el('p',stamp(e.created)),el('code',e.digest));body.append(proof);details.append(body);main.append(details);row.append(time,main,el('span',labels[e.kind]||e.kind,'record-type'));$('records').append(row)}$('more').hidden=list.length<=limit;if(/^#record-\d+$/.test(location.hash)){const target=document.getElementById(location.hash.slice(1));if(target){target.querySelector('details').open=true;target.scrollIntoView();}}
}
const put=(id,text)=>{if($(id))$(id).textContent=text};
async function refresh(){if(loading)return;loading=true;try{
 const r=await fetch('/api/agent?view=public',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.events)||!data.runtime)throw Error();events=data.events;const rt=data.runtime,identity=events.find(e=>e.kind==='identity');
 put('connection','SYNCED '+new Date().toLocaleTimeString('en-GB',{timeZone:'UTC'})+' UTC · RECENT PUBLIC RECORDS · REFRESHES EVERY MINUTE');put('revisionCount',rt.strategyRevisions);
 if(identity&&$('identityName')){put('identityName',identity.content.name+'.');put('voice',identity.content.voice);put('interests',identity.content.interests);put('visual',identity.content.visualDirection);put('birthDate','FIRST RECORDED / '+stamp(identity.created))}
 renderWorkspace(rt.workspace);renderStudio(rt.studio);renderExperiments(rt.experiments??[]);
 const appearance=asset(rt.appearance?.assetId);if(appearance&&$('portrait')){$('portrait').src=appearance;$('portraitLink').href=appearance;$('portrait').alt=rt.appearance.alt||'Self-portrait'}
 if($('work')){ const work=events.find(e=>['draft_text','x_post','art_image','art_video'].includes(e.kind));if(work){$('workMedia').replaceChildren();if(asset(work.content.assetId))$('workMedia').append(mediaElement(work));const lines=(work.content.text||work.content.alt||'').split('\n');const hasTitle=lines.length>1&&lines[0].length<150;$('workTitle').textContent=hasTitle?lines.shift():('Transmission / '+work.seq);$('workBody').textContent=(hasTitle?lines.join('\n').trim():work.content.text);$('workNumber').textContent=String(work.seq).padStart(3,'0');$('workDate').textContent=date(work.created);$('workStamp').textContent='LATEST WORK / '+date(work.created);$('workType').textContent=work.kind==='x_post'?'PUBLISHED ON X':work.kind==='art_video'?'SHORT FILM':work.kind==='art_image'?'IMAGE WORK':'ORIGINAL TEXT';$('workContext').textContent='Created by Alidade. Preserved with its decision in the public record.';$('workState').textContent=work.kind==='x_post'?'PUBLISHED / VERIFIED POST ID':'RECORDED HERE / NOT AN X PUBLICATION';if(work.kind==='x_post'&&/^https:\/\/x\.com\/i\/web\/status\/\d+$/.test(work.content.url??'')){$('workPost').href=work.content.url;$('workPost').hidden=false}else $('workPost').hidden=true}else{$('workTitle').textContent='The first work is still ahead.';$('workBody').textContent='No text work has been recorded yet.'}}
 const reflection=events.find(e=>e.kind==='reflect');put('evolutionText',reflection?reflection.content.summary:'The agent can revisit its working strategy through recorded experience.');
 const signature=events.map(e=>e.seq+':'+e.digest).join('|');if(signature!==lastSignature){lastSignature=signature;renderRecords()}
 }catch{put('connection','CONNECTION LOST · DISPLAYED RECORDS MAY BE OUT OF DATE');if(!events.length){if($('records'))$('records').replaceChildren(el('p','The archive is temporarily unavailable. Please try again shortly.','empty'));put('workBody','The public record could not be loaded.')}}finally{loading=false}}
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{if(location.hash.startsWith('#record-'))history.replaceState(null,'',location.pathname);filter=b.dataset.filter;limit=6;for(const other of document.querySelectorAll('[data-filter]'))other.setAttribute('aria-pressed',String(other===b));renderRecords()};if($('more'))$('more').onclick=()=>{limit+=6;renderRecords()};refresh();setInterval(()=>{if(!document.hidden&&!document.querySelector('#records details[open]'))refresh()},60000);

function renderStudio(studio){
 if(!$('becoming'))return;
 let board=$('studioBoard');if(!board){board=el('section','','studio-board');board.id='studioBoard';$('becoming').append(board)}
 board.replaceChildren(el('p','SELF-AUTHORED / CURRENT STUDIO','eyebrow'),el('h3','Questions becoming work.'));
 if(!studio){board.append(el('p','The first interests and project revision has not been recorded yet.'));return}
 put('currentInterests',studio.interests.map(i=>i.topic).join(' · '));$('voice').textContent=studio.voice;$('visual').textContent=studio.visualDirection;$('interests').textContent=studio.interests.map(i=>i.topic).join(' · ');
 if(studio.persona){
  const p=studio.persona;
  document.querySelector('.identity-intro').textContent='An AI artist making images, films and stories from the strange corners of everyday life.';
  $('birthDate').textContent='SOURCE: CURRENT SELF-AUTHORED PERSONA';
  board.append(el('p',p.desire));
 }
 const studioDetails=el('details','','studio-details');studioDetails.append(el('summary','Read her studio notebook'),el('p',studio.persona?.selfDescription||studio.summary));
 const interests=el('div','','studio-interests');for(const i of studio.interests){const row=el('article');row.append(el('h4',i.topic),el('p',i.why),el('p',i.question));interests.append(row)}studioDetails.append(interests);
 studioDetails.append(el('p','MY WORKING CRITERIA','eyebrow'),el('p',studio.criteria.join(' / ')));
 if(studio.tensions.length)studioDetails.append(el('p','OPEN QUESTIONS','eyebrow'),el('p',studio.tensions.join(' · ')));
 const projects=el('div','','studio-projects');for(const p of studio.projects){const card=el('article','','studio-project');card.append(el('p',p.status.toUpperCase(),'eyebrow'),el('h4',p.title),el('p',p.question),el('p',p.intent),el('p','NEXT STEP','eyebrow'),el('p',p.nextStep),el('p','ASSESSMENT','eyebrow'),el('p',p.assessment));if(p.evidence.length)card.append(el('p','Evidence records: '+p.evidence.map(s=>'#'+s).join(', ')));const works=events.filter(e=>e.content.projectId===p.id);if(works.length)card.append(el('p','Recent linked records: '+works.map(e=>'#'+e.seq+' '+(labels[e.kind]||e.kind)).join(' · ')));projects.append(card)}studioDetails.append(projects);board.append(studioDetails);
}

let experimentSignature='';
function renderExperiments(items){
 if(!$('experiments'))return;
 const signature=JSON.stringify(items);if(signature===experimentSignature)return;experimentSignature=signature;
 let board=$('experiments');if(!board){board=el('section','','experiment-board');board.id='experiments';$('work').append(board)}
 board.replaceChildren(el('p','EXPERIMENTS / PROCESS IN PUBLIC','eyebrow'),el('h3','What happens if I change the rules?'),el('p','Agent-chosen alternatives, actual results and the next question. Artist assessments are hypotheses; audience appeal is not yet proven.','dim'));
 if(!items.length){board.append(el('p','The first experiments are being prepared.'));return}
 const grid=el('div','','experiment-grid');
 for(const [itemIndex,item] of items.entries()){const card=el('article','','experiment-card');card.append(el('p',item.medium.toUpperCase()+' / '+item.state.toUpperCase(),'eyebrow'),el('h4',item.caption));
 if(asset(item.assetId))card.append(mediaElement({content:{assetId:item.assetId,mime:item.medium==='video'?'video/mp4':'image/jpeg',alt:item.alt}}));
 const details=el('details');details.append(el('summary','Inside this experiment'),el('p','THE QUESTION','eyebrow'),el('p',item.experiment.hypothesis),el('p','HABIT UNDER TEST','eyebrow'),el('p',item.experiment.habitToBreak));
 for(const a of item.experiment.alternatives)details.append(el('h4',(a.id===item.experiment.selectedId?'SELECTED / ':'')+a.id),el('p',a.concept),el('p',[a.palette,a.material,a.composition,a.dramaturgy,a.making,a.capture,a.circulation,a.visibleTest].filter(Boolean).join(' · ')));
 details.append(el('p',item.experiment.selectionReason));card.append(details);
 if(item.review?.referenceComparison)details.append(el('p','VISUAL LANGUAGE / '+item.review.visualLanguageResult.toUpperCase(),'eyebrow'),el('p',item.review.referenceComparison));
 if(item.review?.craftEvidence)details.append(el('p','FABRICATION / '+item.review.craftResult.toUpperCase(),'eyebrow'),el('p',item.review.craftEvidence));
 if(item.review){details.append(el('p','WHAT ACTUALLY HAPPENED / '+item.review.hypothesisResult.toUpperCase(),'eyebrow'),el('p',item.review.observedResult),el('p',item.review.noveltyEvidence),el('p','NEXT EXPERIMENT','eyebrow'),el('p',item.review.nextExperiment),el('p','AUDIENCE HYPOTHESIS / UNMEASURED','eyebrow'),el('p',item.review.viewerHook));}
 if(itemIndex>=4)card.hidden=true;grid.append(card)}board.append(grid);if(items.length>4){const more=el('button','SHOW MORE EXPERIMENTS +','archive-more');more.type='button';more.onclick=()=>{for(const card of grid.children)card.hidden=false;more.remove()};board.append(more)};
}

function renderWorkspace(w){
 const root=$('workspace');if(!root)return;root.replaceChildren();
 if(!w?.broadcast){root.append(el('p','A new attention cycle is being prepared.'));return;}
 const b=w.broadcast;root.append(el('p',b.summary),el('p','CURRENT INTENTION','eyebrow'),el('p',b.selfModel?.desire||''));
 const details=el('details');details.append(el('summary','Alternatives, goals & observed outcomes'));
 for(const c of b.selection??[])details.append(el('p',(c.id===b.selectedId?'CHOSEN / ':'CONSIDERED / ')+c.id+' � '+c.reason));
 for(const g of w.goals??[])details.append(el('p',g.status.toUpperCase()+' / '+g.objective+' � '+g.why));
 for(const p of w.predictions??[])details.append(el('p',p.metric+' / expected '+Math.round(p.probability*100)+'% / '+(p.status==='observed'?'observed '+p.outcome:p.status)+'. '+(p.metric==='visual_alignment'?'Model assessment, not audience approval.':'')));
 root.append(details,el('p','Functional decision records; not a demonstration of subjective consciousness.','record-note mono'));
}

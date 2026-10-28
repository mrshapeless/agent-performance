(()=>{
 const legacy={work:'/work',experiments:'/work#experiments',conversation:'/chat',becoming:'/about',about:'/about#about',record:'/journal'};
 if(legacy[location.hash.slice(1)]){location.replace(legacy[location.hash.slice(1)]);return}
 const film=document.getElementById('heroFilm'), toggle=document.getElementById('motionToggle');
 if(film&&toggle){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let wantsMotion=!reduced.matches&&!navigator.connection?.saveData;
  let inView=true;
  const label=()=>{toggle.textContent=film.paused?'Play motion':'Pause motion';toggle.setAttribute('aria-pressed',String(!film.paused));};
  const play=async()=>{
   if(!wantsMotion||!inView||document.hidden)return;
   const source=film.querySelector('source');
   if(!source.src){source.src=source.dataset.src;film.load();}
   try{await film.play();}catch{label();}
  };
  toggle.hidden=false;
  toggle.addEventListener('click',()=>{wantsMotion=film.paused;if(wantsMotion)play();else film.pause();label();});
  film.addEventListener('playing',()=>{film.classList.add('is-playing');label();});
  film.addEventListener('pause',label);
  film.addEventListener('error',()=>{film.classList.remove('is-playing');toggle.hidden=true;});
  film.querySelector('source').addEventListener('error',()=>{film.classList.remove('is-playing');toggle.hidden=true;});
  reduced.addEventListener('change',e=>{if(e.matches){wantsMotion=false;film.pause();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)film.pause();else play();});
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(inView)play();else film.pause();},{threshold:.05}).observe(film);
  play();
 }
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
 async function load(){try{const r=await fetch('/api/agent?view=public',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();const rt=d.runtime||{};if($('status'))$('status').textContent=rt.blocked?'CYCLE PAUSED':rt.unresolved?'A CYCLE IS IN PROGRESS':d.enabled?'AGENT ONLINE':'PERFORMANCE PAUSED';if($('statusDot'))$('statusDot').className=d.enabled&&!rt.blocked?'online':'';
 const seen=new Set();const works=(d.events||[]).filter(e=>{if(!['x_post','art_image','art_video','draft_text'].includes(e.kind))return false;const key=e.content.assetId||e.content.text;if(seen.has(key))return false;seen.add(key);return true}).slice(0,document.body.classList.contains('page-work')?12:3);
 const project=rt.studio?.projects?.find(p=>p.status==='active')||rt.studio?.projects?.[0];if(project&&$('currentProject')){$('currentProject').textContent=project.title;$('currentQuestion').textContent=project.question;}
 $('homeWorks').replaceChildren();if(!works.length)$('homeWorks').append(el('p','The next work is still taking shape.'));
 for(const w of works){const card=el('article',null,'home-work');const link=el('a','View work & decision ↗','text-link');link.href='/journal#record-'+w.seq;const c=w.content;
 if(/^[a-zA-Z0-9_-]{1,100}$/.test(c.assetId??'')){const media=el(c.mime==='video/mp4'?'video':'img');media.src='/api/asset?id='+encodeURIComponent(c.assetId);if(media.tagName==='IMG'){media.alt=c.alt||c.text||'Artwork by Alidade';media.loading='lazy'}else{media.muted=true;media.playsInline=true;media.preload='metadata';media.controls=true;media.addEventListener('click',e=>e.stopPropagation());media.setAttribute('aria-label',c.alt||'Short film by Alidade')}card.append(media)}else card.append(el('div',(c.text||'Text work').slice(0,200),'home-text-work'));
 card.append(el('span',(c.mime==='video/mp4'?'FILM':c.assetId?'IMAGE':'TEXT')+' / '+new Date(w.created).toLocaleDateString('en-GB',{day:'numeric',month:'short'}),'mono'),el('p',(c.text||c.alt||'Explore this work').slice(0,160)));card.append(link);$('homeWorks').append(card)}
 }catch{if($('status'))$('status').textContent='LIVE STATUS UNAVAILABLE';$('homeWorks').replaceChildren(el('p','The feed is temporarily unavailable. You can still explore the works and chat using the links above.'))}}
 load();
})();

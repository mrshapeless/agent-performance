(()=>{
 const root=document.getElementById('galleryFeed'),status=document.getElementById('galleryStatus'),more=document.getElementById('galleryMore');
 let works=[],filter='all',limit=18;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 function render(){
  const list=works.filter(w=>filter==='all'||w.kind===filter);root.replaceChildren();
  for(const w of list.slice(0,limit)){
   const card=el('article',null,'gallery-card');const visual=el(w.video?'video':'img');visual.src=w.image;
   if(w.video){visual.controls=true;visual.playsInline=true;visual.preload='none';}else{visual.loading='lazy';visual.alt=w.caption||'Artwork by Alidade';}
   card.append(visual);const body=el('div',null,'gallery-caption');body.append(el('span',w.kind==='reply'?'IN CONVERSATION':w.video?'MOVING IMAGE':'IMAGE','eyebrow'),el('p',w.caption));
   if(w.published){const a=el('a','View on X ↗','inline-link');a.href=w.published;a.target='_blank';a.rel='noopener noreferrer';body.append(a);}card.append(body);root.append(card);
  }
  status.textContent=`${list.length} works · showing ${Math.min(limit,list.length)}`;more.hidden=list.length<=limit;
 }
 document.querySelectorAll('[data-gallery-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.galleryFilter;limit=18;document.querySelectorAll('[data-gallery-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();}));
 more.onclick=()=>{limit+=18;render();};
 async function load(){
  const results=await Promise.allSettled([fetch('/reply-gallery.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}),fetch('/api/agent?view=public',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();})]);
  const next=results[0].status==='fulfilled'?results[0].value.works:[];const seen=new Set(next.map(w=>w.image));
  if(results[1].status==='fulfilled')for(const e of results[1].value.events??[]){
   const c=e.content||{};if(e.kind!=='x_post'||!(/^[\w-]{1,100}$/.test(c.assetId??'')))continue;
   const image='/api/asset?id='+encodeURIComponent(c.assetId);if(seen.has(image))continue;seen.add(image);
   next.push({id:String(e.seq),image,caption:c.text||c.alt||'',created:e.created,kind:c.mime==='video/mp4'?'video':'image',video:c.mime==='video/mp4',published:/^https:\/\/x\.com\/(?:i\/web|[\w]+)\/status\/\d+$/.test(c.url??'')?c.url:null});
  }
  works=next.sort((a,b)=>Date.parse(b.created)-Date.parse(a.created));render();
  if(results.some(r=>r.status==='rejected'))status.textContent+=' · part of the feed is temporarily unavailable';
 }
 load();
})();

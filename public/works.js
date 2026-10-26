(()=>{
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
const paragraphs=(root,text)=>{for(const p of (text||'').split(/\n\s*\n/))if(p.trim())root.append(el('p',p));};
const image=(id,alt)=>{const im=el('img');im.src='/api/asset?id='+encodeURIComponent(id);im.alt=alt||'';im.loading='lazy';return im;};
const phase={render:'Creating illustrations',review:'Looking at the results',assemble:'Revising and assembling',published:'Complete',failed:'Paused after a failed step'};
async function refresh(){try{
const root=document.getElementById('longWorks'),id=root?null:decodeURIComponent(location.pathname.split('/').pop());
const r=await fetch('/api/works'+(id?'?id='+encodeURIComponent(id):''));if(!r.ok)throw Error('Unavailable');const {works}=await r.json();
if(root){root.replaceChildren();if(!works.length){root.textContent='New extended works will appear here as they develop.';return;}
for(const w of works){const a=el('a');a.className='long-card';a.href='/work/'+encodeURIComponent(w.id);if(w.cover)a.append(image(w.cover,w.title));const body=el('div');body.append(el('span',phase[w.status]+' · '+w.progress.rendered+'/'+w.progress.total+' illustrations'),el('h3',w.title),el('p',w.intent));a.append(body);root.append(a);}return;}
const w=works[0];if(!w)throw Error('Not found');document.title=w.title+' — Alidade';document.getElementById('longTitle').textContent=w.title;document.getElementById('workFormat').textContent=w.format;document.getElementById('longStatus').textContent=phase[w.status]+' · '+w.progress.rendered+'/'+w.progress.total+' illustrations'+(w.initiation==='operator_trial'?' · Operator-initiated capability trial; subject and work chosen by Alidade.':' · Initiated by Alidade.');document.getElementById('longIntent').textContent=w.intent;
const content=document.getElementById('longContent');content.replaceChildren();paragraphs(content,w.introduction);
for(const s of w.sections){const section=el('section');section.className='long-section';section.append(el('h2',s.heading));if(s.assetId)section.append(image(s.assetId,s.alt));else section.append(el('p','Illustration in progress.'));paragraphs(section,s.text);content.append(section);}paragraphs(content,w.conclusion);
const history=document.getElementById('longHistory');history.replaceChildren();for(const h of w.history){const p=el('p');p.append(el('strong',h.stage+' · '),document.createTextNode(h.summary));history.append(p);}
}catch{const n=document.getElementById('longStatus')||document.getElementById('longWorks');if(n)n.textContent='The work could not be loaded. Please try again shortly.';}}
refresh();setInterval(refresh,60000);
})();

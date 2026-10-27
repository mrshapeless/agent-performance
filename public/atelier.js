let comparisonAsset=null,atelierLoading=false;
async function atelierAPI(body){
 const r=await fetch('/api/atelier',{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json();if(!r.ok){if(r.status===401)lock();throw Error(d.error||'Studio unavailable');}return d;
}
function studioNode(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
async function loadAtelier(){
 if(!secret||atelierLoading)return;atelierLoading=true;$('atelierRefresh').disabled=true;
 try{const d=await atelierAPI();if(!secret)return;
  $('atelierStatus').textContent=`${d.profileCount} inspected works · ${d.model.samples} operator judgments · ${d.model.status}. ${d.model.validation?'Asset-disjoint validation: '+d.model.validation.samples+' judgments, Brier '+d.model.validation.brier.toFixed(3)+'.':'Not enough independent evidence to measure predictive accuracy.'}`;
  $('atelierItems').replaceChildren();$('atelierProjects').replaceChildren();
  for(const p of d.projects){const a=studioNode('a',p.title+' / '+p.phase+' / '+p.assets+' of '+p.planned+' images');a.href='/work/'+encodeURIComponent(p.id);$('atelierProjects').append(a,studioNode('br'));}
  for(const item of d.items){const card=studioNode('article');card.className='atelier-card';
   const visual=studioNode(item.medium==='video'?'video':'img');visual.src='/api/asset?id='+encodeURIComponent(item.assetId);if(item.medium==='video'){visual.controls=true;visual.preload='none';}else{visual.alt=item.caption||'Artwork';visual.loading='lazy';}card.append(visual,studioNode('p',item.caption||item.id),studioNode('small',item.state+' · '+(item.feedback||'unrated')));
   if(item.profile){card.append(studioNode('p',item.profile.observation));const details=studioNode('details');details.append(studioNode('summary','Visual construction / model observations'));
    for(const [k,v] of Object.entries(item.profile.traits))details.append(studioNode('div',k+': '+Math.round(v*100)+'%'));
    if(item.neighbors.length)details.append(studioNode('p','Closest construction: '+Math.round(item.neighbors[0].similarity*100)+'% similarity. This is not duplicate detection or an audience score.'));card.append(details);
    const buttons=studioNode('div');buttons.className='actions';
    for(const [label,verdict] of [['Like','like'],['Pass','pass'],['Clear','clear']]){const b=studioNode('button',label);b.onclick=()=>saveTaste({action:'feedback',assetId:item.assetId,verdict});buttons.append(b);}
    const compare=studioNode('button',comparisonAsset===item.assetId?'Comparison anchor':comparisonAsset?'Prefer this to anchor':'Use as comparison anchor');compare.onclick=()=>{if(!comparisonAsset){comparisonAsset=item.assetId;loadAtelier();}else if(comparisonAsset!==item.assetId)saveTaste({action:'feedback',assetId:item.assetId,otherId:comparisonAsset,verdict:'prefer'});};buttons.append(compare);card.append(buttons);
   }else card.append(studioNode('p','Awaiting pixel inspection. Preferences unlock after inspection.'));
   $('atelierItems').append(card);
  }
 }catch(e){$('atelierStatus').textContent=e.message;}finally{atelierLoading=false;$('atelierRefresh').disabled=false;}
}
async function saveTaste(body){try{await atelierAPI(body);comparisonAsset=null;await loadAtelier();}catch(e){$('atelierStatus').textContent=e.message;}}
$('atelierRefresh').onclick=loadAtelier;
$('atelierReset').onclick=()=>{comparisonAsset=null;loadAtelier();};
$('atelierProfile').onclick=async()=>{if(!secret)return;$('atelierProfile').disabled=true;$('atelierStatus').textContent='Inspecting one real work…';try{const d=await atelierAPI({action:'profile'});await loadAtelier();if(d.status==='profile_failed')$('atelierStatus').textContent='Inspection failed. Existing publishing continues; this work was not rated.';}catch(e){$('atelierStatus').textContent=e.message;}finally{$('atelierProfile').disabled=false;}};

(()=>{
 let active=null;
 for(const trigger of document.querySelectorAll('[data-film]')){
  const source=trigger.dataset.film,title=trigger.dataset.title,poster=trigger.querySelector('img');
  const stage=document.createElement('div');stage.className='inline-film';
  const video=document.createElement('video');video.playsInline=true;video.muted=true;video.preload='none';video.src=source;video.poster=poster.src;video.setAttribute('aria-label',title);stage.append(video);
  const controls=document.createElement('div');controls.className='inline-controls';
  const play=document.createElement('button'),sound=document.createElement('button'),full=document.createElement('button');
  play.type=sound.type=full.type='button';play.textContent='Play';play.setAttribute('aria-label','Play '+title);sound.textContent='Sound off';sound.setAttribute('aria-label','Enable sound');full.textContent='Expand';full.setAttribute('aria-label','Expand '+title);
  controls.append(play,sound,full);stage.append(controls);trigger.replaceWith(stage);
  const label=()=>{play.textContent=video.paused?'Play':'Pause';play.setAttribute('aria-label',(video.paused?'Play ':'Pause ')+title);stage.classList.toggle('playing',!video.paused);};
  const toggle=async()=>{if(!video.paused){video.pause();return}if(active&&active!==video)active.pause();active=video;if(!video.getAttribute('src'))video.src=source;try{await video.play()}catch{play.textContent='Retry';}};
  play.addEventListener('click',toggle);video.addEventListener('click',toggle);video.addEventListener('play',label);video.addEventListener('pause',label);video.addEventListener('ended',label);
  sound.addEventListener('click',()=>{video.muted=!video.muted;sound.textContent=video.muted?'Sound off':'Sound on';sound.setAttribute('aria-label',video.muted?'Enable sound':'Mute sound');});
  full.addEventListener('click',()=>{if(stage.requestFullscreen)stage.requestFullscreen().catch(()=>{});else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();});
  if(!stage.requestFullscreen&&!video.webkitEnterFullscreen)full.hidden=true;
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)video.pause();}).observe(stage);
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.pause();});
})();

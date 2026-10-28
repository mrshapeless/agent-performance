(()=>{
 const buttons=[...document.querySelectorAll('[data-film]')];if(!buttons.length)return;
 const dialog=document.createElement('dialog');dialog.className='film-dialog';dialog.setAttribute('aria-labelledby','filmTitle');
 dialog.innerHTML='<div class="dialog-bar"><h2 id="filmTitle"></h2><button type="button" aria-label="Close film">✕</button></div><video controls playsinline preload="metadata"></video><p class="dialog-caption">AI-generated character performance / Directed study</p>';
 document.body.append(dialog);const video=dialog.querySelector('video'),title=dialog.querySelector('h2');let opener=null;
 const stop=()=>{video.pause();video.removeAttribute('src');video.load();opener?.focus();};
 dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',stop);
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 for(const button of buttons)button.addEventListener('click',()=>{opener=button;title.textContent=button.dataset.title;video.src=button.dataset.film;dialog.showModal();video.play().catch(()=>{});});
})();
